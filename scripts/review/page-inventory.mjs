#!/usr/bin/env node
// Review Freeze 2 — Phase B: page inventory generator.
//
// Deterministically derives a full inventory of every registered page in
// index.html/views/*.html by parsing the SAME source files the running app
// itself reads (index.html nav markup, server.js's INTERNAL_ROUTELESS_VIEWS,
// app.js's page->DOM/view-file maps, services/permissionService.js's
// PAGE_METADATA/PAGE_PERMISSIONS gates, and the review database's
// authorization_route_coverage / saas_plan_entitlements tables) rather than
// hand-maintained data. Re-running this script after the app changes will
// pick up the change automatically.
//
// Outputs:
//   docs/review/PAGE_INVENTORY.md   (human-readable table + findings)
//   docs/review/PAGE_INVENTORY.json (machine-readable array)
//
// This is inventory/reporting ONLY — it never edits any page, view, or
// route. Findings (duplicates, orphans, missing wiring, placeholders, etc.)
// are recorded for reviewers, not "fixed" here.
//
// Usage: node scripts/review/page-inventory.mjs   (or: npm run review:page-inventory)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const reviewDbPath = path.join(repoRoot, '.review-data', 'octagon-review.db');
const outDir = path.join(repoRoot, 'docs', 'review');
const mdPath = path.join(outDir, 'PAGE_INVENTORY.md');
const jsonPath = path.join(outDir, 'PAGE_INVENTORY.json');

const ARABIC_RE = /[؀-ۿ]/;

// The 10 Phase A fixture domains (scripts/review/setup.mjs), in seeding order.
const FIXTURE_DOMAINS = [
  'workshop', 'warehouse', 'production', 'quality', 'commercial-saas',
  'al-warsha-pack', 'ai', 'people-development', 'marketing', 'events',
];

// ---------------------------------------------------------------------------
// Generic source-literal extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a brace-balanced `{ ... }` object-literal substring starting at the
 * first `{` found after `markerRegex` matches in `src`, honoring quoted
 * strings (so a `}` or `{` inside a string doesn't unbalance the scan).
 */
function extractObjectLiteral(src, markerRegex) {
  const m = markerRegex.exec(src);
  if (!m) throw new Error(`marker not found: ${markerRegex}`);
  let i = m.index + m[0].length;
  while (src[i] === ' ') i++;
  if (src[i] !== '{') throw new Error(`expected "{" after marker ${markerRegex}, found ${JSON.stringify(src[i])}`);
  let depth = 0;
  let inStr = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (c === '\\') { j++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced braces after marker ${markerRegex}`);
}

/** Safely evaluate a trusted, repo-local JS object/array literal string. */
function evalLiteral(literalSrc) {
  return new Function(`return (${literalSrc})`)();
}

/** Top-level `key:` names of a flat, one-entry-per-line object literal (for duplicate-key detection — object evaluation silently collapses dupes). */
function topLevelKeysByIndent(objLiteralSrc, indentSpaces) {
  const re = new RegExp(`^ {${indentSpaces}}(?:'([^']+)'|([A-Za-z_$][\\w$-]*))\\s*:`);
  const keys = [];
  for (const line of objLiteralSrc.split('\n')) {
    const m = re.exec(line);
    if (m) keys.push(m[1] || m[2]);
  }
  return keys;
}

function duplicates(arr) {
  const counts = new Map();
  for (const item of arr) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

function loadSources() {
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
  const serverJs = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
  const permissionServiceJs = fs.readFileSync(path.join(repoRoot, 'services', 'permissionService.js'), 'utf8');

  const viewsDir = path.join(repoRoot, 'views');
  const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));

  const modulesDir = path.join(repoRoot, 'modules');
  const moduleFiles = fs.readdirSync(modulesDir).filter((f) => f.endsWith('.js'));
  let modulesCorpus = '';
  const moduleFileTexts = new Map();
  for (const f of moduleFiles) {
    const text = fs.readFileSync(path.join(modulesDir, f), 'utf8');
    moduleFileTexts.set(f, text);
    modulesCorpus += `\n// ---- modules/${f} ----\n${text}`;
  }

  return { indexHtml, serverJs, appJs, permissionServiceJs, viewsDir, viewFiles, moduleFiles, moduleFileTexts, modulesCorpus };
}

// ---------------------------------------------------------------------------
// index.html nav parsing
// ---------------------------------------------------------------------------

/**
 * Returns an ordered array of { navGroupId, navGroupTitle, pageId, order,
 * labelAr, labelEn, labelSource } for every `data-page="X"` nav-btn found
 * inside a `<div class="nav-group" data-nav-group="...">` block.
 */
function parseNavEntries(indexHtml) {
  const groupRe = /<div class="nav-group" data-nav-group="([^"]+)">\s*<button class="nav-group-toggle"[^>]*>([\s\S]*?)<\/button>\s*<div class="nav-group-body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const entries = [];
  let order = 0;
  let groupMatch;
  while ((groupMatch = groupRe.exec(indexHtml))) {
    const [, navGroupId, toggleInner, bodyInner] = groupMatch;
    const navGroupTitle = stripTags(toggleInner).replace(/⌄/g, '').trim();

    const btnRe = /<button\s+([^>]*)>([\s\S]*?)<\/button>/g;
    let btnMatch;
    while ((btnMatch = btnRe.exec(bodyInner))) {
      const [, attrs, inner] = btnMatch;
      if (!/class="[^"]*\bnav-btn\b/.test(attrs)) continue;
      const pageIdMatch = /data-page="([^"]+)"/.exec(attrs);
      if (!pageIdMatch) continue;
      const pageId = pageIdMatch[1];

      const arAttr = /data-i18n-ar="([^"]*)"/.exec(inner);
      const enAttr = /data-i18n-en="([^"]*)"/.exec(inner);
      // Drop icon/indicator/status-dot spans before deriving plain-text label —
      // they carry no label text but their emoji/glyph content would otherwise
      // get concatenated onto the real label (e.g. "🏠 الرئيسية").
      const labelOnly = inner
        .replace(/<span class="nav-icon"[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<span class="nav-indicator"[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<span class="status-dot[^"]*"[^>]*>[\s\S]*?<\/span>/g, '');
      const plainText = decodeEntities(stripTags(labelOnly)).trim();

      let labelAr = null, labelEn = null, labelSource;
      if (arAttr || enAttr) {
        labelAr = arAttr ? decodeEntities(arAttr[1]) : null;
        labelEn = enAttr ? decodeEntities(enAttr[1]) : null;
        labelSource = 'data-i18n-ar/en attributes';
      } else if (ARABIC_RE.test(plainText)) {
        labelAr = plainText;
        labelSource = 'nav-btn text (Arabic, no English source in markup)';
      } else if (plainText) {
        labelEn = plainText;
        labelSource = 'nav-btn text (Latin, no Arabic source in markup)';
      } else {
        labelSource = 'no label text found in nav markup';
      }

      entries.push({ navGroupId, navGroupTitle, pageId, order: order++, labelAr, labelEn, labelSource });
    }
  }
  return entries;
}

function stripTags(html) { return html.replace(/<[^>]*>/g, ' '); }
function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// app.js / server.js / services/permissionService.js structured extraction
// ---------------------------------------------------------------------------

function loadAppJsMaps(appJs) {
  const anchor = appJs.indexOf('window.ensurePageTemplateLoaded = async function (page) {');
  if (anchor === -1) throw new Error('window.ensurePageTemplateLoaded not found in app.js — app.js structure changed, update this script');
  const fnBody = appJs.slice(anchor);

  const domIdMap = evalLiteral(extractObjectLiteral(fnBody, /const pageMap = /));
  const jsRenderedSrc = /const JS_RENDERED_PAGES = new Set\((\[[^\]]*\])\);/.exec(fnBody);
  const jsRenderedPages = new Set(jsRenderedSrc ? evalLiteral(jsRenderedSrc[1]) : []);
  const viewFileNameMap = evalLiteral(extractObjectLiteral(fnBody, /const viewFileNameMap = /));

  return { domIdMap, jsRenderedPages, viewFileNameMap };
}

function loadServerJsInternalViews(serverJs) {
  const m = /const INTERNAL_ROUTELESS_VIEWS = (\[[^\]]*\]);/.exec(serverJs);
  if (!m) throw new Error('INTERNAL_ROUTELESS_VIEWS not found in server.js — update this script');
  return evalLiteral(m[1]);
}

function loadPermissionServiceMaps(permissionServiceJs) {
  const metaSrc = extractObjectLiteral(permissionServiceJs, /const PAGE_METADATA = /);
  const permSrc = extractObjectLiteral(permissionServiceJs, /const PAGE_PERMISSIONS = /);
  const pageMetadata = evalLiteral(metaSrc);
  const pagePermissions = evalLiteral(permSrc);
  const metadataDupeKeys = duplicates(topLevelKeysByIndent(metaSrc, 4));
  const permissionDupeKeys = duplicates(topLevelKeysByIndent(permSrc, 4));
  return { pageMetadata, pagePermissions, metadataDupeKeys, permissionDupeKeys };
}

// ---------------------------------------------------------------------------
// Review database queries
// ---------------------------------------------------------------------------

function queryDatabase() {
  const dialect = openMigrationDatabase(reviewDbPath);
  try {
    const routeCoverage = dialect.prepare(
      'SELECT method, route, module_id, permission, public, rationale FROM authorization_route_coverage'
    ).all();

    const entitlementCapabilities = new Set();
    for (const table of ['saas_plan_entitlements', 'saas_addon_entitlements']) {
      try {
        const rows = dialect.prepare(`SELECT DISTINCT capability FROM ${table} WHERE capability LIKE 'page:%'`).all();
        for (const r of rows) entitlementCapabilities.add(r.capability.slice('page:'.length));
      } catch (_) { /* table absent in this schema revision — treat as no data */ }
    }

    return { routeCoverage, entitlementCapabilities };
  } finally {
    dialect.close();
  }
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifyModuleDomain(pageId, meta, navGroupId) {
  if (meta?.sensitivity) {
    const seg = meta.sensitivity.split('/')[0];
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }
  const groupNames = {
    octagon: 'Core Platform (original app)', omni_ops: 'Operations', omni_analytics: 'Analytics',
    omni_business: 'Business/Verticals', omni_dev: 'Developer/Diagnostics',
  };
  return groupNames[navGroupId] || `(inferred from nav group "${navGroupId}")`;
}

const P0_EXACT = new Set(['home', 'command_center', 'workshop_command_center', 'my_work', 'sales', 'inventory', 'canonical_inventory', 'canonical_console', 'admin_panel', 'settings', 'tenant_directory', 'tenant_detail', 'multi_entity', 'security_center']);
const P0_PREFIXES = ['mobile_receiving', 'receiving_discrepancies', 'mobile_picking', 'pick_task_queue', 'wave_planning', 'wave_execution', 'dock_schedule', 'dock_checkin'];
const P0_PRODUCTION = new Set(['shopfloor_terminal', 'workcenter_queue', 'production_material_requests', 'production_issue_return', 'production_receipt', 'mrp', 'work_orders', 'machines']);
const P0_QUALITY = new Set(['qc_center', 'quality_hold_queue', 'rework_workspace', 'scrap_approval', 'recall_analysis', 'expiration_queue']);

const P1_FLEET_PREFIXES = ['fleet', 'vehicle_', 'geofence', 'speed_and_driver', 'fuel_', 'suspected_fuel'];
const P1_MOBILE_PREFIXES = ['offline_', 'sync_', 'mobile_inventory'];
const P1_EXACT = new Set(['workshop_readiness', 'maintenance_triggers', 'conflict_resolution', 'offline_capability_policies', 'subscriptions', 'people_development_overview', 'skills_catalog', 'competency_profiles', 'person_skill_evidence', 'development_plans', 'learning_and_certifications']);
const P1_AI_ASSISTANT = new Set(['ai_overview', 'ai_assistant', 'ai_proposal_inbox', 'ai_run_history', 'ai_policy_registry', 'ai_prompt_templates', 'ai_context_sources', 'ai_queue', 'ai_status']);

const P2_EXACT = new Set(['usage_and_quotas', 'analytics', 'nl_reports', 'vertical_packs', 'workshop_pack_setup', 'extension_marketplace', 'extension_installations', 'putaway_rules', 'replenishment_rules', 'geofence_management', 'gateway_management', 'sensor_management', 'device_enrollment']);
const P2_PREFIXES = ['marketing', 'event', 'campaign', 'content_calendar', 'content_approvals', 'attribution_insights'];

const P3_EXACT = new Set(['ai_factory', 'ai_tools', 'rollout_simulator', 'billing_simulator', 'account_mapping', 'help_manual', 'knowledge_base']);
const P3_SUBSTRINGS = ['registry', 'catalogue', 'lineage'];

function classifyPriority(pageId, navGroupId, meta) {
  // Registry/catalogue/lineage/simulator-style low-frequency admin pages are
  // checked FIRST: a couple of them (e.g. consolidation_lineage,
  // account_mapping) carry a "high"/"critical" finance riskLevel in
  // PAGE_METADATA, which would otherwise wrongly promote them to P0 via the
  // finance-critical rule below.
  if (P3_EXACT.has(pageId)) return ['P3', 'low-frequency administration (explicit list)'];
  if (P3_SUBSTRINGS.some((s) => pageId.includes(s))) return ['P3', 'registry/catalogue/lineage (low-frequency administration)'];

  if (P0_EXACT.has(pageId)) return ['P0', 'critical operations (explicit list)'];
  if (P0_PREFIXES.some((p) => pageId.startsWith(p))) return ['P0', 'receiving/picking (critical operations)'];
  if (P0_PRODUCTION.has(pageId)) return ['P0', 'production (critical operations)'];
  if (P0_QUALITY.has(pageId)) return ['P0', 'quality (critical operations)'];
  // "Finance-critical" is scoped to the foundational/day-to-day finance
  // surface (phase !== 'build08'): BUILD-08 is the advanced treasury/
  // consolidation/intercompany planning workspace — specialized back-office
  // tooling, not a front-line critical-operations page, even though its
  // own PAGE_METADATA riskLevel is high/critical. It lands in P2 below
  // (supporting management) via the default fallback instead.
  if (meta && String(meta.sensitivity || '').startsWith('finance') && (meta.riskLevel === 'high' || meta.riskLevel === 'critical') && meta.phase !== 'build08') {
    return ['P0', 'finance-critical (high/critical risk finance page, core/day-to-day surface)'];
  }

  if (P1_AI_ASSISTANT.has(pageId) && !P3_EXACT.has(pageId)) return ['P1', 'AI assistant (daily operations)'];
  if (P1_FLEET_PREFIXES.some((p) => pageId.startsWith(p))) return ['P1', 'fleet/maintenance (daily operations)'];
  if (P1_MOBILE_PREFIXES.some((p) => pageId.startsWith(p))) return ['P1', 'mobile execution (daily operations)'];
  if (P1_EXACT.has(pageId)) return ['P1', 'daily operations (explicit list)'];

  if (P2_EXACT.has(pageId)) return ['P2', 'supporting management (explicit list)'];
  if (P2_PREFIXES.some((p) => pageId.startsWith(p) || pageId.includes(p))) return ['P2', 'marketing/events/packs (supporting management)'];

  return ['P2', 'default — no explicit rule matched, judgment default to supporting management'];
}

const FIXTURE_RULES = [
  [/^workshop\/quality/, 'quality'],
  [/^workshop\/production/, 'production'],
  [/^workshop\/logistics/, 'warehouse'],
  [/^workshop\/inventory/, 'warehouse'],
  [/^commercial\//, 'commercial-saas'],
  [/^build12\/ai/, 'ai'],
  [/^build12\/(people|skills|competencies|evidence|development-plans|learning)/, 'people-development'],
  [/^build12\/(marketing|campaigns|content|attribution)/, 'marketing'],
  [/^build12\/(events|event-planner|registrations|checkin)/, 'events'],
  [/^build12\/(packs|pack-installations)/, 'al-warsha-pack'],
];
const FIXTURE_PAGE_OVERRIDES = {
  command_center: 'workshop', workshop_command_center: 'workshop', my_work: 'workshop', kanban: 'workshop',
  workflow: 'workshop', task_manager: 'workshop', op_packs: 'workshop', sop: 'workshop', home: 'workshop',
  mrp: 'production', work_orders: 'production', machines: 'production',
  qc_center: 'quality',
};

function classifyFixtureDomain(pageId, meta) {
  if (FIXTURE_PAGE_OVERRIDES[pageId]) return FIXTURE_PAGE_OVERRIDES[pageId];
  const sensitivity = meta?.sensitivity || '';
  for (const [re, domain] of FIXTURE_RULES) if (re.test(sensitivity)) return domain;
  return 'none/global';
}

// ---------------------------------------------------------------------------
// Wiring / API discovery (best-effort static grep over app.js + modules/*.js)
// ---------------------------------------------------------------------------

function findWiring(pageId, resolvedViewFile, viewFiles, jsRenderedPages, appJs, modulesCorpus) {
  if (resolvedViewFile && viewFiles.includes(resolvedViewFile)) {
    return { found: true, note: `views/${resolvedViewFile}.html (fetched by app.js ensurePageTemplateLoaded)` };
  }
  if (jsRenderedPages.has(pageId)) {
    return { found: true, note: 'self-rendering JS module (app.js JS_RENDERED_PAGES — no views/*.html template)' };
  }
  const keyRe = new RegExp(`['"\`]?\\b${escapeRegExp(pageId)}\\b['"\`]?\\s*:`);
  if (keyRe.test(appJs)) return { found: true, note: 'referenced as an object key in app.js (renderer/config map)' };
  if (keyRe.test(modulesCorpus)) return { found: true, note: 'referenced as an object key in modules/*.js (renderer/config map)' };
  return { found: false, note: 'NOT FOUND — no view file, not in JS_RENDERED_PAGES, no object-key reference in app.js or modules/*.js' };
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function findApiRef(pageId, corpus) {
  const idx = corpus.indexOf(`'${pageId}'`) !== -1 ? corpus.indexOf(`'${pageId}'`) : corpus.indexOf(`"${pageId}"`);
  if (idx === -1) return null;
  const window_ = corpus.slice(Math.max(0, idx - 1500), idx + 1500);
  const m = /\/api\/[a-zA-Z0-9_\-/.:]+/.exec(window_);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// Per-page best-effort content signals
// ---------------------------------------------------------------------------

function readViewFile(viewsDir, resolvedViewFile) {
  if (!resolvedViewFile) return null;
  const p = path.join(viewsDir, `${resolvedViewFile}.html`);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function findEmptyStateNote(viewHtml) {
  if (!viewHtml) return 'not verified (no view file to inspect — JS-rendered page)';
  if (/empty-state|no-data|لا توجد بيانات|لا يوجد/i.test(viewHtml)) return 'has empty-state markup/copy in view file';
  return 'not verified — no empty-state markup found in static view file (may be rendered dynamically by JS)';
}

function findDeniedStateNote(permissionGroups) {
  if (!permissionGroups) return 'not mapped in PAGE_PERMISSIONS — denial behavior unknown';
  if (permissionGroups.length === 0) return 'none — public/open page, no permission gate (PAGE_PERMISSIONS entry is empty array)';
  return 'toast "عذراً، ليس لديك صلاحية للوصول إلى هذا القسم" + redirect to calculator/login (app.js switchPage generic denial handling)';
}

function findMobileStatus(pageId, navGroupId, meta) {
  const sensitivity = meta?.sensitivity || '';
  if (/mobile|kiosk|_tv$/.test(pageId) || /^(kiosk|offline)\//.test(sensitivity) || ['build10_kiosk', 'build10_offline'].includes(navGroupId)) {
    return 'mobile/kiosk-oriented page (id or nav group signals mobile use)';
  }
  return 'not verified — no mobile-specific markers found (desktop-oriented by default)';
}

function findRtlStatus(labelAr) {
  return labelAr ? 'Arabic label present (RTL content available)' : 'no Arabic label found — needs review';
}
function findLtrStatus(labelEn, labelSource) {
  if (!labelEn) return 'no English label found — needs review';
  if (labelSource === 'auto-derived from page id') return 'English label auto-derived (no confident source in markup/metadata) — needs review';
  return 'English label present';
}

function titleCaseFromId(pageId) {
  return pageId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function findPlaceholderSignal(viewHtml) {
  if (!viewHtml) return false;
  return /coming soon|not implemented|قريبا|قريباً|لم يتم التنفيذ/i.test(viewHtml);
}

function extractKeyVisibleActions(viewHtml) {
  if (!viewHtml) return '(rendered by JS module — not statically inspectable)';
  const buttonTexts = [...viewHtml.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => decodeEntities(stripTags(m[1])))
    .filter((t) => t && t.length <= 30 && !/^[\W\d\s]*$/.test(t));
  const unique = [...new Set(buttonTexts)].slice(0, 5);
  return unique.length ? unique.join('; ') : '(no <button> labels found in static view file)';
}

// ---------------------------------------------------------------------------
// Raw JSON / raw ID display grep (repo-wide, best-effort — see report notes)
// ---------------------------------------------------------------------------

function findRawIdDisplaySignals(modulesCorpus, appJs) {
  const re = />\$\{[a-zA-Z_][\w.]*\.?[Ii]d\}</g;
  const hits = [];
  for (const [label, text] of [['app.js', appJs], ['modules/*.js', modulesCorpus]]) {
    let m;
    const localRe = new RegExp(re.source, 'g');
    while ((m = localRe.exec(text))) {
      const lineNo = text.slice(0, m.index).split('\n').length;
      hits.push(`${label}:${lineNo} — \`${m[0]}\``);
      if (hits.length > 20) return hits;
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

function buildRecords(sources, dbData) {
  const { indexHtml, appJs, serverJs, permissionServiceJs, viewsDir, viewFiles, modulesCorpus } = sources;

  const navEntries = parseNavEntries(indexHtml);
  const { domIdMap, jsRenderedPages, viewFileNameMap } = loadAppJsMaps(appJs);
  const internalRoutelessViews = loadServerJsInternalViews(serverJs);
  const { pageMetadata, pagePermissions, metadataDupeKeys, permissionDupeKeys } = loadPermissionServiceMaps(permissionServiceJs);

  // Duplicate data-page registrations (literal attribute duplicated in nav markup).
  const navPageIdDuplicates = duplicates(navEntries.map((e) => e.pageId));

  // Collapse nav entries to one record per unique page id, in first-seen order.
  const seen = new Set();
  const uniqueEntries = [];
  for (const e of navEntries) {
    if (seen.has(e.pageId)) continue;
    seen.add(e.pageId);
    uniqueEntries.push(e);
  }

  const records = uniqueEntries.map((entry) => {
    const { pageId, navGroupId, navGroupTitle } = entry;
    const meta = pageMetadata[pageId] || null;
    const permissionGroups = Object.prototype.hasOwnProperty.call(pagePermissions, pageId) ? pagePermissions[pageId] : null;
    const resolvedViewFile = jsRenderedPages.has(pageId) ? null : (viewFileNameMap[pageId] || pageId);
    const domId = domIdMap[pageId] || null;

    let labelAr = entry.labelAr;
    let labelEn = entry.labelEn;
    let labelSource = entry.labelSource;
    if (!labelEn && meta?.label) { labelEn = meta.label; labelSource += ' + PAGE_METADATA.label (English)'; }
    if (!labelEn) { labelEn = titleCaseFromId(pageId); labelSource = 'auto-derived from page id'; }
    if (!labelAr) labelAr = '(no Arabic label found)';

    const wiring = findWiring(pageId, resolvedViewFile, viewFiles, jsRenderedPages, appJs, modulesCorpus);
    const apiRef = findApiRef(pageId, modulesCorpus + appJs);
    const viewHtml = readViewFile(viewsDir, resolvedViewFile);
    const fixtureDomain = classifyFixtureDomain(pageId, meta);
    const [priority, priorityReason] = classifyPriority(pageId, navGroupId, meta);
    const moduleDomain = classifyModuleDomain(pageId, meta, navGroupId);

    const entitlementMapped = dbData.entitlementCapabilities.has(pageId);
    const looksCommercial = /^commercial\//.test(meta?.sensitivity || '') || /^build12\//.test(meta?.sensitivity || '') || navGroupId === 'build11_commercial';
    let requiredEntitlement;
    if (entitlementMapped) requiredEntitlement = `page:${pageId} (found in saas_plan_entitlements)`;
    else if (looksCommercial) requiredEntitlement = 'UNMAPPED — commercial/SaaS page, no literal saas_plan_entitlements "page:*" row found';
    else requiredEntitlement = 'none/global (not a commercial/SaaS-gated page)';

    return {
      pageId,
      labelAr,
      labelEn,
      labelSource,
      moduleDomain,
      navGroup: navGroupTitle,
      navGroupId,
      route: `switchPage('${pageId}') / views/${resolvedViewFile || '(none — JS-rendered)'}.html`,
      domId,
      requiredPermission: permissionGroups === null ? 'UNMAPPED (no PAGE_PERMISSIONS entry)' : (permissionGroups.length ? permissionGroups.join(', ') : 'none (public/open)'),
      requiredEntitlement,
      entitlementMapped,
      looksCommercial,
      intendedRoles: permissionGroups && permissionGroups.length ? permissionGroups.join(', ') : (permissionGroups === null ? 'unknown' : 'any authenticated user'),
      primaryPurpose: meta?.label ? `${meta.label} — ${meta.sensitivity || 'domain n/a'} (risk: ${meta.riskLevel || 'n/a'}, phase: ${meta.phase || 'n/a'})` : `(no PAGE_METADATA entry — inferred label only: ${labelEn})`,
      keyVisibleActions: extractKeyVisibleActions(viewHtml),
      canonicalApi: apiRef || 'not discoverable via static analysis',
      requiredFixture: fixtureDomain,
      expectedEmptyState: findEmptyStateNote(viewHtml),
      expectedDeniedState: findDeniedStateNote(permissionGroups),
      rtlStatus: findRtlStatus(entry.labelAr),
      ltrStatus: findLtrStatus(labelEn, labelSource),
      mobileStatus: findMobileStatus(pageId, navGroupId, meta),
      reviewPriority: priority,
      reviewPriorityReason: priorityReason,
      wiringFound: wiring.found,
      wiringNote: wiring.note,
      hasViewFile: !!(resolvedViewFile && viewFiles.includes(resolvedViewFile)),
      resolvedViewFile,
      hasPlaceholder: findPlaceholderSignal(viewHtml),
      hasPageMetadata: !!meta,
      hasPagePermissions: permissionGroups !== null,
    };
  });

  // ---- cross-cutting findings ----

  const findings = {};

  findings.duplicateRegistrations = {
    duplicateNavDataPage: navPageIdDuplicates,
    pageIdsSharingOneViewFile: Object.entries(
      records.reduce((acc, r) => {
        if (!r.resolvedViewFile) return acc;
        (acc[r.resolvedViewFile] = acc[r.resolvedViewFile] || []).push(r.pageId);
        return acc;
      }, {})
    ).filter(([, ids]) => ids.length > 1),
    duplicateKeysInPageMetadata: metadataDupeKeys,
    duplicateKeysInPagePermissions: permissionDupeKeys,
  };

  findings.navEntriesWithNoPageOrView = records.filter((r) => !r.wiringFound).map((r) => r.pageId);

  const registeredViewNames = new Set(records.filter((r) => r.resolvedViewFile).map((r) => r.resolvedViewFile));
  findings.orphanViewFiles = viewFiles.filter((f) => !registeredViewNames.has(f) && !internalRoutelessViews.includes(f));
  findings.internalRoutelessViews = internalRoutelessViews;

  findings.viewFileNoWiringFound = records.filter((r) => r.hasViewFile === false && r.wiringFound === false).map((r) => r.pageId);

  findings.noPermissionMappingInRouteCoverage = {
    routeCoverageRowCount: dbData.routeCoverage.length,
    note: dbData.routeCoverage.length === 0
      ? 'authorization_route_coverage is EMPTY in this build (0 rows) — nothing in server.js/platform-runtime-bridge.mjs calls routeCoverage.register() at boot, so no route is ever registered into this table. A route→permission join against it is therefore not possible for ANY page; the effective, enforced mapping is the client-side PAGE_PERMISSIONS gate in services/permissionService.js (used above as "Required permission").'
      : 'joined by route text where possible',
    pagesUnmappedInPagePermissions: records.filter((r) => !r.hasPagePermissions).map((r) => r.pageId),
  };

  findings.noEntitlementMappingWhereExpected = records.filter((r) => r.looksCommercial && !r.entitlementMapped).map((r) => r.pageId);

  findings.placeholderPages = records.filter((r) => r.hasPlaceholder).map((r) => r.pageId);

  findings.rawIdDisplaySignals = findRawIdDisplaySignals(modulesCorpus, appJs);

  return { records, findings };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMarkdown(records, findings) {
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const r of records) byPriority[r.reviewPriority]++;

  const lines = [];
  lines.push('# Octagon Review Freeze 2 — Page Inventory');
  lines.push('');
  lines.push(`Generated by \`scripts/review/page-inventory.mjs\` on ${new Date().toISOString()}.`);
  lines.push('');
  lines.push('This is an automatically-derived inventory, parsed directly from `index.html`, `views/*.html`, `app.js`, `server.js`, `services/permissionService.js`, and the disposable review database (`.review-data/octagon-review.db`). Re-run `npm run review:page-inventory` after any page/nav/permission change to refresh it. This document is inventory/reporting only — no page was redesigned or fixed while generating it.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total active pages (unique \`data-page\` ids in the sidebar nav): **${records.length}**`);
  lines.push(`- Review priority breakdown: P0 = ${byPriority.P0}, P1 = ${byPriority.P1}, P2 = ${byPriority.P2}, P3 = ${byPriority.P3}`);
  lines.push(`- View files on disk: ${records.filter(r => r.hasViewFile).length + findings.orphanViewFiles.length + findings.internalRoutelessViews.length} (${records.filter(r => r.hasViewFile).length} wired to a nav page, ${findings.orphanViewFiles.length} orphaned, ${findings.internalRoutelessViews.length} intentionally routeless per \`server.js\` \`INTERNAL_ROUTELESS_VIEWS\`)`);
  lines.push('');

  lines.push('## Findings requiring reviewer attention');
  lines.push('');

  lines.push('### 1. Duplicate page registrations');
  lines.push('');
  lines.push(`- Duplicate \`data-page\` attribute in nav markup: ${inlineListOrNone(findings.duplicateRegistrations.duplicateNavDataPage)}`);
  lines.push(`- Two or more nav entries resolving to the same \`views/*.html\` file:`);
  if (findings.duplicateRegistrations.pageIdsSharingOneViewFile.length === 0) lines.push('  - none');
  for (const [file, ids] of findings.duplicateRegistrations.pageIdsSharingOneViewFile) lines.push(`  - \`views/${file}.html\` ← ${ids.map(i => `\`${i}\``).join(', ')}`);
  lines.push(`- Duplicate top-level keys inside \`services/permissionService.js\` \`PAGE_METADATA\` (silently shadowed — last definition wins): ${inlineListOrNone(findings.duplicateRegistrations.duplicateKeysInPageMetadata)}`);
  lines.push(`- Duplicate top-level keys inside \`services/permissionService.js\` \`PAGE_PERMISSIONS\`: ${inlineListOrNone(findings.duplicateRegistrations.duplicateKeysInPagePermissions)}`);
  lines.push('');

  lines.push('### 2. Navigation entries with no corresponding page/view found');
  lines.push('');
  lines.push('A page id in the sidebar nav with no `views/*.html` file, no entry in `app.js`\'s `JS_RENDERED_PAGES`, and no object-key reference anywhere in `app.js` or `modules/*.js` (best-effort static grep):');
  lines.push('');
  lines.push(listOrNone(findings.navEntriesWithNoPageOrView, true));
  lines.push('');

  lines.push('### 3. View files with no navigation entry (orphans)');
  lines.push('');
  lines.push('Files in `views/*.html` that no nav `data-page` id (directly or via `app.js`\'s `viewFileNameMap`) resolves to, excluding the 2 files `server.js` explicitly marks routeless:');
  lines.push('');
  lines.push(listOrNone(findings.orphanViewFiles, true));
  lines.push(`- Intentionally routeless per \`server.js\` \`INTERNAL_ROUTELESS_VIEWS\`: ${findings.internalRoutelessViews.join(', ')}`);
  lines.push('');

  lines.push('### 4. Pages with a view file but no renderer wiring found');
  lines.push('');
  lines.push('(Subset of finding 2 — pages that DO have a `views/*.html` file, so the fetch-hydration path should work, but no additional JS reference was found; empty by construction unless a page has a view file yet is unreachable for another reason.)');
  lines.push('');
  lines.push(listOrNone(findings.viewFileNoWiringFound, true));
  lines.push('');

  lines.push('### 5. Pages with no permission mapping in `authorization_route_coverage`');
  lines.push('');
  lines.push(`- Rows currently in \`authorization_route_coverage\` (review DB): **${findings.noPermissionMappingInRouteCoverage.routeCoverageRowCount}**`);
  lines.push(`- ${findings.noPermissionMappingInRouteCoverage.note}`);
  lines.push(`- Pages with no entry at all in the client-side \`PAGE_PERMISSIONS\` gate (used as the effective "Required permission" column below): ${inlineListOrNone(findings.noPermissionMappingInRouteCoverage.pagesUnmappedInPagePermissions)}`);
  lines.push('');

  lines.push('### 6. Pages with no entitlement mapping where one seems expected (SaaS/commercial pages)');
  lines.push('');
  lines.push('Pages under the commercial/SaaS module (`sensitivity` starting `commercial/`, any BUILD-12 page, or the `build11_commercial` nav group) with no literal `page:<id>` row in `saas_plan_entitlements`/`saas_addon_entitlements` in the review database (only `page:home` is seeded there today):');
  lines.push('');
  lines.push(listOrNone(findings.noEntitlementMappingWhereExpected, true));
  lines.push('');

  lines.push('### 7. Pages using generic placeholders ("Coming soon" / "TODO" / "Not implemented" / Arabic equivalents)');
  lines.push('');
  lines.push(listOrNone(findings.placeholderPages, true));
  lines.push('');

  lines.push('### 8. Pages displaying raw JSON or raw IDs as primary labels (best-effort grep signal, not exhaustive)');
  lines.push('');
  lines.push('Repo-wide grep for a raw `.id`/`Id` field interpolated directly as element text (`>${...id}<`) in `app.js`/`modules/*.js`. This is a code-level signal, not attributed to a specific page — treat as "worth spot-checking", not a page list:');
  lines.push('');
  lines.push(listOrNone(findings.rawIdDisplaySignals, true));
  lines.push('');

  lines.push('## Full page inventory');
  lines.push('');
  lines.push('| # | Page id | Arabic label | English label | Module/domain | Nav group | Route/key | Required permission | Required entitlement | Intended roles | Priority | Fixture | Wiring |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  records.forEach((r, i) => {
    lines.push(`| ${i + 1} | \`${r.pageId}\` | ${mdEscape(r.labelAr)} | ${mdEscape(r.labelEn)} | ${mdEscape(r.moduleDomain)} | ${mdEscape(r.navGroup)} | ${mdEscape(r.route)} | ${mdEscape(r.requiredPermission)} | ${mdEscape(r.requiredEntitlement)} | ${mdEscape(r.intendedRoles)} | ${r.reviewPriority} | ${r.requiredFixture} | ${r.wiringFound ? 'OK' : 'MISSING'} |`);
  });
  lines.push('');
  lines.push('Additional per-page fields (primary purpose, key visible actions, canonical API, expected empty/denied state, RTL/LTR/mobile status) are in `docs/review/PAGE_INVENTORY.json` — they did not fit a readable Markdown table at this width.');
  lines.push('');

  return lines.join('\n');
}

function listOrNone(arr, code = false) {
  if (!arr || arr.length === 0) return '- none found';
  if (code) return arr.map((x) => `- \`${x}\``).join('\n');
  return arr.map((x) => `\`${x}\``).join(', ');
}
/** Inline variant for use after "label: " on the same line — no leading bullet. */
function inlineListOrNone(arr) {
  if (!arr || arr.length === 0) return 'none found';
  return arr.map((x) => `\`${x}\``).join(', ');
}
function mdEscape(s) { return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(reviewDbPath)) {
    console.error(`[page-inventory] FATAL: review database not found at ${reviewDbPath}`);
    console.error('[page-inventory] run "npm run review:setup" first.');
    process.exit(1);
  }

  console.log('[page-inventory] loading sources…');
  const sources = loadSources();

  console.log('[page-inventory] querying review database…');
  const dbData = queryDatabase();

  console.log('[page-inventory] parsing nav, views, permissions, and building records…');
  const { records, findings } = buildRecords(sources, dbData);

  fs.mkdirSync(outDir, { recursive: true });

  console.log('[page-inventory] writing docs/review/PAGE_INVENTORY.json…');
  fs.writeFileSync(jsonPath, JSON.stringify(records, null, 2) + '\n', 'utf8');

  console.log('[page-inventory] writing docs/review/PAGE_INVENTORY.md…');
  fs.writeFileSync(mdPath, renderMarkdown(records, findings), 'utf8');

  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const r of records) byPriority[r.reviewPriority]++;

  console.log('[page-inventory] DONE.');
  console.log(`[page-inventory]   total pages: ${records.length}`);
  console.log(`[page-inventory]   P0=${byPriority.P0} P1=${byPriority.P1} P2=${byPriority.P2} P3=${byPriority.P3}`);
  console.log(`[page-inventory]   wiring missing: ${findings.navEntriesWithNoPageOrView.length}`);
  console.log(`[page-inventory]   orphan view files: ${findings.orphanViewFiles.length}`);
  console.log(`[page-inventory]   entitlement gaps (commercial pages): ${findings.noEntitlementMappingWhereExpected.length}`);
}

main();
