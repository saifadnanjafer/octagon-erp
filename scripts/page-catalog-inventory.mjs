#!/usr/bin/env node
// scripts/page-catalog-inventory.mjs
//
// Final Page Catalog — FP-0 page inventory scanner.
//
// Reads the ACTUAL registration surfaces of the original Octagon shell and
// produces one machine-checkable inventory of every page. No roadmap names,
// no assumptions: a page only exists here if a real file/registration exists.
//
// Registration surfaces read:
//   1. app.js  ensurePageTemplateLoaded pageMap   -> page id -> DOM section id
//   2. app.js  switchPage pageMap                 -> core synchronous page map
//   3. app.js  navGroupPages                      -> sidebar navigation registry
//   4. app.js  prefetchAllViews                   -> background template prefetch
//   5. index.html .nav-btn[data-page]             -> sidebar buttons
//   6. index.html id="pageXxx"                    -> inline page sections
//   7. views/*.html                               -> view fragments
//   8. services/permissionService.js PAGE_PERMISSIONS -> page permission registry
//   9. modules/*.js                               -> page controllers (by host id)
//  10. platform/domains/*/index.mjs               -> backend modules + actions
//
// Usage:
//   node scripts/page-catalog-inventory.mjs            # human summary
//   node scripts/page-catalog-inventory.mjs --json     # machine JSON
//   node scripts/page-catalog-inventory.mjs --markdown # evidence markdown

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (_) {
    return '';
  }
};

const listDir = (rel) => {
  try {
    return fs.readdirSync(path.join(ROOT, rel));
  } catch (_) {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

/**
 * Pull an object literal that follows `marker` out of `source` by walking
 * braces. Regex alone cannot do this safely across ~37k lines.
 */
function extractObjectLiteral(source, marker, fromIndex = 0) {
  const at = source.indexOf(marker, fromIndex);
  if (at === -1) return null;
  const open = source.indexOf('{', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { body: source.slice(open, i + 1), end: i + 1 };
    }
  }
  return null;
}

function extractArrayLiteral(source, marker) {
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const open = source.indexOf('[', at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

/** key: 'value' pairs at any depth of a flat map literal. */
function parseStringMap(body) {
  const out = {};
  if (!body) return out;
  const re = /['"]?([A-Za-z0-9_$-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2];
  return out;
}

/** key: [ 'a', 'b' ] pairs. */
function parseArrayMap(body) {
  const out = {};
  if (!body) return out;
  const re = /['"]?([A-Za-z0-9_$-]+)['"]?\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = (m[2].match(/['"]([^'"]+)['"]/g) || []).map((s) => s.slice(1, -1));
  }
  return out;
}

function parseStringArray(body) {
  if (!body) return [];
  return (body.match(/['"]([^'"]+)['"]/g) || []).map((s) => s.slice(1, -1));
}

// ---------------------------------------------------------------------------
// Read every registration surface
// ---------------------------------------------------------------------------

export function collectInventory() {
  const appJs = read('app.js');
  const indexHtml = read('index.html');
  const permissionJs = read('services/permissionService.js');

  // 1. ensurePageTemplateLoaded pageMap (the authoritative page id -> section id map).
  //    Anchor on the function, then take the first object literal inside it —
  //    matching on an embedded newline is fragile across CRLF/LF checkouts.
  const templateFnIdx = appJs.indexOf('ensurePageTemplateLoaded = async function');
  const templateMapBlock = templateFnIdx === -1
    ? null
    : extractObjectLiteral(appJs, 'const pageMap = {', templateFnIdx);
  const templatePageMap = parseStringMap(templateMapBlock && templateMapBlock.body);

  // 2. switchPage pageMap (core synchronous map)
  const switchIdx = appJs.indexOf('function switchPage(page) {');
  const switchMapBlock = switchIdx === -1 ? null : extractObjectLiteral(appJs, 'const pageMap = {', switchIdx);
  const switchPageMap = parseStringMap(switchMapBlock && switchMapBlock.body);

  // 3. navGroupPages
  const navGroupPages = parseArrayMap(extractObjectLiteral(appJs, 'const navGroupPages =')?.body);
  const navGroupMetaBody = extractObjectLiteral(appJs, 'const navGroupMeta =')?.body || '';
  const navGroupMeta = {};
  {
    const re = /([A-Za-z0-9_]+)\s*:\s*\{\s*label:\s*'([^']*)'\s*,\s*domain:\s*'([^']*)'\s*,\s*icon:\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(navGroupMetaBody)) !== null) {
      navGroupMeta[m[1]] = { label: m[2], domain: m[3], icon: m[4] };
    }
  }

  // 4. prefetchAllViews
  const prefetch = parseStringArray(extractArrayLiteral(appJs, 'window.prefetchAllViews = function () {'));

  // 5. index.html nav buttons
  const navButtons = [...indexHtml.matchAll(/data-page=["']([^"']+)["']/g)].map((m) => m[1]);

  // 6. index.html inline page sections
  const inlineSections = [...indexHtml.matchAll(/id=["'](page[A-Za-z0-9_]+)["']/g)].map((m) => m[1]);

  // 7. views/*.html
  const viewFiles = listDir('views').filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, ''));
  const viewSectionIds = {};
  viewFiles.forEach((v) => {
    const html = read(`views/${v}.html`);
    const m = html.match(/id=["'](page[A-Za-z0-9_]+)["']/);
    if (m) viewSectionIds[v] = m[1];
  });

  // 8. PAGE_PERMISSIONS
  const pagePermissions = parseArrayMap(extractObjectLiteral(permissionJs, 'const PAGE_PERMISSIONS =')?.body);

  // 9. modules/*.js -> which DOM section ids each one hosts
  const moduleFiles = listDir('modules').filter((f) => f.endsWith('.js'));
  const controllerBySection = {};
  moduleFiles.forEach((f) => {
    const src = read(`modules/${f}`);
    [...src.matchAll(/getElementById\(['"](page[A-Za-z0-9_]+)['"]\)/g)].forEach((m) => {
      (controllerBySection[m[1]] ||= new Set()).add(`modules/${f}`);
    });
  });

  // 10. backend domain modules + their registered actions / permissions
  const domainDirs = listDir('platform/domains').filter((d) => {
    try {
      return fs.statSync(path.join(ROOT, 'platform/domains', d)).isDirectory();
    } catch (_) { return false; }
  });
  const domains = {};
  domainDirs.forEach((d) => {
    const idx = read(`platform/domains/${d}/index.mjs`);
    // Wave 2 shipped two registration shapes:
    //   executor.registerAction('id', {...})       (crm/contracts/subscriptions/rental)
    //   actionRegistry.register('id', handler)     (the remaining W2 domains)
    // Count both so the inventory reflects declared intent, not one dialect.
    const actions = [
      ...[...idx.matchAll(/registerAction\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
      ...[...idx.matchAll(/\.register\(\s*['"]([a-z_]+:[a-z0-9_:-]+)['"]/gi)].map((m) => m[1]),
    ];
    const permissions = [...idx.matchAll(/permission:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const declared = parseStringArray(extractArrayLiteral(idx, '_PERMISSIONS = ['));
    const registerFns = [...idx.matchAll(/export function (register[A-Za-z0-9_]+)/g)].map((m) => m[1]);
    domains[d] = {
      actions,
      permissions: [...new Set(permissions.concat(declared))],
      registerFns,
      hasQueryService: fs.existsSync(path.join(ROOT, 'platform/domains', d, 'query-service.mjs')),
    };
  });

  // Which register* functions are actually wired into the running runtime?
  const bridge = read('platform-runtime-bridge.mjs');
  Object.keys(domains).forEach((d) => {
    domains[d].wired = domains[d].registerFns.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(bridge));
  });

  // ---- merge into one page record set --------------------------------------
  const pageIds = new Set([
    ...Object.keys(templatePageMap),
    ...Object.keys(switchPageMap),
    ...Object.values(navGroupPages).flat(),
    ...navButtons,
    ...Object.keys(pagePermissions),
    ...prefetch,
  ]);

  // view files that no page id points at are still real assets — record them
  const viewFileForPage = (page) => ({
    products: 'products_and_materials',
    parties: 'customers_and_suppliers',
    warehouses: 'warehouses_and_locations',
    locations: 'warehouses_and_locations',
  })[page] || page;

  const pages = [...pageIds].sort().map((id) => {
    const sectionId = templatePageMap[id] || switchPageMap[id] || null;
    const viewFile = viewFiles.includes(viewFileForPage(id)) ? `views/${viewFileForPage(id)}.html` : null;
    const navGroup = Object.keys(navGroupPages).find((g) => navGroupPages[g].includes(id)) || null;
    const controllers = sectionId && controllerBySection[sectionId]
      ? [...controllerBySection[sectionId]].sort()
      : [];
    return {
      id,
      sectionId,
      viewFile,
      inlineSection: sectionId ? inlineSections.includes(sectionId) : false,
      navGroup,
      navDomain: navGroup ? (navGroupMeta[navGroup]?.domain || null) : null,
      navButton: navButtons.includes(id),
      permissionRegistered: Object.prototype.hasOwnProperty.call(pagePermissions, id),
      permissions: pagePermissions[id] || null,
      prefetched: prefetch.includes(id),
      inTemplateMap: Object.prototype.hasOwnProperty.call(templatePageMap, id),
      inSwitchMap: Object.prototype.hasOwnProperty.call(switchPageMap, id),
      controllers,
    };
  });

  const orphanViews = viewFiles
    .filter((v) => !pages.some((p) => p.viewFile === `views/${v}.html`))
    .map((v) => `views/${v}.html`);

  return {
    pages,
    navGroupPages,
    navGroupMeta,
    viewFiles,
    viewSectionIds,
    orphanViews,
    domains,
    counts: {
      pages: pages.length,
      views: viewFiles.length,
      navGroups: Object.keys(navGroupPages).length,
      modules: moduleFiles.length,
      domains: Object.keys(domains).length,
      domainsWired: Object.values(domains).filter((d) => d.wired).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Classification — the FP-0 disposition of every discovered page
// ---------------------------------------------------------------------------

export function classify(page) {
  const blockers = [];
  if (!page.sectionId) blockers.push('no DOM section id registered');
  if (!page.viewFile && !page.inlineSection && !page.controllers.length) {
    blockers.push('no view fragment, no inline section, no controller');
  }
  if (!page.permissionRegistered) blockers.push('no page permission registered');
  if (!page.navGroup) blockers.push('not in any navigation group');
  if (!page.navButton) blockers.push('no sidebar nav button');

  if (blockers.length === 0) return { status: 'COMPLETE', blockers };
  if (!page.sectionId) return { status: 'BLOCKED', blockers };
  if (!page.navGroup || !page.navButton) return { status: 'EXISTING — NEEDS UPGRADE', blockers };
  if (!page.permissionRegistered) return { status: 'EXISTING — NEEDS UPGRADE', blockers };
  return { status: 'PARTIAL UI', blockers };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function main() {
  const inv = collectInventory();
  const mode = process.argv.includes('--json') ? 'json'
    : process.argv.includes('--markdown') ? 'markdown' : 'text';

  const rows = inv.pages.map((p) => ({ ...p, ...classify(p) }));
  const byStatus = rows.reduce((acc, r) => {
    (acc[r.status] ||= []).push(r);
    return acc;
  }, {});

  if (mode === 'json') {
    process.stdout.write(JSON.stringify({ ...inv, rows }, null, 2));
    return;
  }

  if (mode === 'markdown') {
    const lines = [];
    lines.push('| Page ID | Section ID | View fragment | Nav group | Nav btn | Permission | Controller(s) | Status |');
    lines.push('|---|---|---|---|---|---|---|---|');
    rows.forEach((r) => {
      lines.push('| ' + [
        '`' + r.id + '`',
        r.sectionId ? '`' + r.sectionId + '`' : '—',
        r.viewFile ? '`' + r.viewFile + '`' : (r.inlineSection ? 'inline (index.html)' : '—'),
        r.navGroup || '—',
        r.navButton ? 'yes' : 'no',
        r.permissionRegistered ? '`' + (r.permissions.length ? r.permissions.join(', ') : 'public') + '`' : '**missing**',
        r.controllers.length ? r.controllers.map((c) => '`' + c + '`').join('<br>') : '—',
        r.status,
      ].join(' | ') + ' |');
    });
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  console.log('=== OCTAGON FINAL PAGE CATALOG — STARTING INVENTORY ===');
  console.log(`pages discovered : ${inv.counts.pages}`);
  console.log(`view fragments   : ${inv.counts.views}`);
  console.log(`nav groups       : ${inv.counts.navGroups}`);
  console.log(`client modules   : ${inv.counts.modules}`);
  console.log(`backend domains  : ${inv.counts.domains} (wired into runtime: ${inv.counts.domainsWired})`);
  console.log('');
  Object.keys(byStatus).sort().forEach((s) => {
    console.log(`${s.padEnd(28)} ${byStatus[s].length}`);
  });
  console.log('');
  console.log('--- pages with blockers ---');
  rows.filter((r) => r.blockers.length).forEach((r) => {
    console.log(`  ${r.id.padEnd(26)} ${r.status.padEnd(28)} ${r.blockers.join('; ')}`);
  });
  console.log('');
  console.log('--- backend domains NOT wired into the running runtime ---');
  Object.entries(inv.domains).filter(([, d]) => !d.wired).forEach(([name, d]) => {
    console.log(`  ${name.padEnd(22)} actions=${String(d.actions.length).padStart(2)} query-service=${d.hasQueryService ? 'yes' : 'no '}`);
  });
  if (inv.orphanViews.length) {
    console.log('');
    console.log('--- view fragments with no registered page id ---');
    inv.orphanViews.forEach((v) => console.log(`  ${v}`));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
