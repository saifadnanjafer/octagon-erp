import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'docs', 'page-specs');
const inv = JSON.parse(fs.readFileSync(path.join(root, 'docs/review/PAGE_INVENTORY.json'), 'utf8'));
const forensic = JSON.parse(fs.readFileSync(path.join(root, 'docs/navigation/NAVIGATION_FORENSIC_REPORT.json'), 'utf8'));
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const navPages = forensic.items.filter((item) => item.kind === 'page' && item.visibleInPrimaryNavigation);
const invById = new Map(inv.map((item) => [item.pageId, item]));
const sourceCache = new Map();
const read = (rel) => {
  if (!rel) return '';
  const abs = path.join(root, rel.replaceAll('/', path.sep));
  if (!sourceCache.has(abs)) {
    try { sourceCache.set(abs, fs.readFileSync(abs, 'utf8')); } catch { sourceCache.set(abs, ''); }
  }
  return sourceCache.get(abs);
};
const q = (value) => value == null ? 'null' : JSON.stringify(String(value));
const qa = (values) => JSON.stringify([...new Set(values.filter(Boolean))]);
const rel = (value) => value?.replaceAll(path.sep, '/') || null;
const cleanText = (value) => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();
const safeId = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '_');

function parseRoles(value) {
  if (!value || value === 'permissionService page policy') return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function classifyKind(id, title, rendererType) {
  const text = `${id} ${title}`.toLowerCase();
  if (/(^|[_-])kiosk|mobile_/.test(text)) return 'KIOSK';
  if (/queue|worklist|inbox|exceptions|discrepanc/.test(text)) return 'QUEUE';
  if (/board|overview|dashboard|command_center|health_center|cash_position|large_screen/.test(text)) return 'DASHBOARD';
  if (/analytics|report|forecast|accuracy|performance|timeline|telemetry|balance/.test(text)) return 'ANALYTICS';
  if (/setup|registry|catalogue|catalog|polic|profile|configuration|rules|entitlement|plans|limits/.test(text)) return 'SETUP';
  if (/order|invoice|receipt|payment|transaction|request|run|reconciliation|returns|checkin|receiving|picking|execution|issue_return/.test(text)) return 'TRANSACTION';
  if (rendererType === 'view' && /list|directory|customers|products|locations|warehouses/.test(text)) return 'LIST';
  return 'PAGE';
}

function actualSources(page, item) {
  const candidates = [];
  if (page.viewPath) candidates.push(page.viewPath);
  if (page.rendererSource?.startsWith('modules/')) candidates.push(page.rendererSource);
  if (page.rendererSource?.startsWith('views/')) candidates.push(page.rendererSource);
  if (page.rendererSource === 'app.js switchPage') candidates.push('app.js');
  candidates.push('index.html', 'services/permissionService.js');
  const moduleCandidates = [
    'modules/build12-workspaces.js',
    'modules/build11-workspaces.js',
    'modules/build10-workspaces.js',
    'modules/build09-action-forms.js',
    'modules/build09-count-workspace.js',
    'modules/build09-dock-workspace.js',
    'modules/build09-downtime-workspace.js',
    'modules/build09-expiration-workspace.js',
    'modules/build09-mobile-picking.js',
    'modules/build09-mobile-receiving.js',
    'modules/build09-pick-task-queue-workspace.js',
    'modules/build09-production-material-workspaces.js',
    'modules/build09-putaway-workspace.js',
    'modules/build09-quality-workspace.js',
    'modules/build09-receiving-discrepancy-workspace.js',
    'modules/build09-shopfloor-workspace.js',
    'modules/build09-topology-workspace.js',
    'modules/build09-trace-workspace.js',
    'modules/build09-wave-workspace.js'
  ];
  for (const candidate of moduleCandidates) {
    const text = read(candidate);
    if (text.includes(`${page.id}:`) || text.includes(`'${page.id}'`) || text.includes(`"${page.id}"`)) candidates.push(candidate);
  }
  return [...new Set(candidates.filter((candidate) => read(candidate)))];
}

function extractActions(text) {
  const actions = [];
  const buttonRe = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let match;
  while ((match = buttonRe.exec(text)) && actions.length < 20) {
    const label = cleanText(match[2]);
    const handler = match[1].match(/(?:onclick|data-action)=["']([^"']+)["']/i)?.[1] || null;
    if (label || handler) actions.push({ label: label || 'NOT VERIFIED', handler: handler || 'NOT VERIFIED' });
  }
  for (const match of text.matchAll(/action\(['"]([^'"]+)['"]/g)) {
    if (actions.length >= 20) break;
    actions.push({ label: 'dynamic action', handler: match[1] });
  }
  return actions.filter((action, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(action)) === index);
}

function extractApis(text) {
  const found = [];
  for (const match of text.matchAll(/\/api\/v1\/[A-Za-z0-9_?=&${}./:-]+/g)) found.push(match[0].replace(/["'`),;]+$/, ''));
  return [...new Set(found)].slice(0, 20);
}

function extractReferencedPages(text, pageId, pageIds) {
  const refs = [];
  for (const candidate of pageIds) {
    if (candidate === pageId) continue;
    if (new RegExp(`(?:switchPage|data-page|pageId|page=)[^\\n]{0,100}\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) refs.push(candidate);
  }
  return refs.slice(0, 20);
}

function surfaceSummary(sourceTexts, item) {
  const text = sourceTexts.join('\n');
  const counts = {
    headings: (text.match(/<h[1-6]\b/gi) || []).length,
    buttons: (text.match(/<button\b/gi) || []).length,
    inputs: (text.match(/<(?:input|select|textarea)\b/gi) || []).length,
    tables: (text.match(/<table\b/gi) || []).length,
    forms: (text.match(/<form\b/gi) || []).length,
    apiCalls: extractApis(text).length
  };
  const viewPath = item.viewPath || (item.resolvedViewFile ? `views/${item.resolvedViewFile}.html` : null);
  const view = viewPath ? `The registered view is ${viewPath}.` : 'No dedicated views/*.html file is registered; the page is created by JavaScript or a shell.';
  return `${view} Static source counts at baseline: ${counts.headings} headings, ${counts.buttons} button tags, ${counts.inputs} input/select/textarea controls, ${counts.tables} tables, ${counts.forms} forms, and ${counts.apiCalls} literal /api/v1 calls. Dynamic content not visible in static source is NOT VERIFIED.`;
}

function purpose(item, nav) {
  return item.primaryPurpose || `NOT VERIFIED — the baseline inventory has no purpose statement for ${nav.labelEn || nav.id}.`;
}

function buildPage(nav) {
  const item = invById.get(nav.id) || {
    pageId: nav.id,
    labelAr: nav.labelAr,
    labelEn: nav.labelEn,
    moduleDomain: nav.topLevelSection,
    navGroup: nav.sidebarGroup,
    navGroupId: nav.sidebarGroup,
    route: `switchPage('${nav.id}')`,
    requiredPermission: nav.requiredPermission,
    requiredEntitlement: nav.requiredEntitlement || 'none/global (not in PAGE_INVENTORY.json)',
    intendedRoles: nav.supportedRoles,
    primaryPurpose: null,
    keyVisibleActions: 'NOT VERIFIED — page absent from PAGE_INVENTORY.json',
    canonicalApi: 'not discoverable via static analysis',
    requiredFixture: 'NOT VERIFIED',
    expectedEmptyState: 'NOT VERIFIED',
    expectedDeniedState: 'NOT VERIFIED',
    rtlStatus: 'NOT VERIFIED',
    ltrStatus: 'NOT VERIFIED',
    mobileStatus: 'NOT VERIFIED',
    reviewPriority: 'NOT VERIFIED',
    wiringFound: true,
    hasViewFile: Boolean(nav.viewPath),
    resolvedViewFile: nav.viewPath?.replace(/^views\//, '').replace(/\.html$/, '') || null
  };
  const sources = actualSources(nav, item);
  let sourceTexts = sources.map(read);
  const actualModule = sources.find((source) => source.startsWith('modules/')) || null;
  const pageSurfaceSources = sources.filter((source) => {
    if (source === 'index.html' || source === 'services/permissionService.js') return false;
    if (source === 'app.js' && actualModule) return false;
    return source === item.viewPath || source === nav.rendererSource || source.startsWith('modules/');
  });
  const pageSurfaceTexts = pageSurfaceSources.map(read);
  const pageSurfaceText = pageSurfaceTexts.join('\n');
  sourceTexts = pageSurfaceTexts;
  const sourceApis = extractApis(pageSurfaceText);
  const canonicalApi = item.canonicalApi && !/not discoverable/i.test(item.canonicalApi) ? [item.canonicalApi] : [];
  const apiSources = [...new Set([...canonicalApi, ...sourceApis])];
  const actions = extractActions(pageSurfaceText);
  const inventoryActions = item.keyVisibleActions && !/^\(no |not verified/i.test(item.keyVisibleActions)
    ? item.keyVisibleActions.split(';').map((value) => value.trim()).filter(Boolean)
    : [];
  const pageSpecificModule = actualModule && actualModule !== 'app.js';
  const genericShellRisk = nav.rendererType === 'shell' && !pageSpecificModule;
  const missingActionPath = actions.length === 0 && inventoryActions.length === 0;
  const missingBackendPath = apiSources.length === 0;
  const refs = extractReferencedPages(pageSurfaceTexts, nav.id, navPages.map((page) => page.id));
  const status = genericShellRisk ? 'DISPLAY_ONLY' : (missingActionPath && missingBackendPath ? 'THIN' : 'CONNECTED');
  const score = genericShellRisk ? 'EMPTY' : (pageSpecificModule && actions.length && apiSources.length ? 'STRONG' : (actions.length || apiSources.length ? 'USABLE' : 'THIN'));
  const gaps = [];
  if (genericShellRisk) gaps.push({ id: `PAGE-${safeId(nav.id)}-GAP-001`, type: 'DOMAIN_CAPABILITY', severity: 'P1', text: 'The primary route is recorded as an app.js shell with no page-specific renderer evidence in this baseline; the visible destination is not proof of a completed business workflow.' });
  if (missingActionPath) gaps.push({ id: `PAGE-${safeId(nav.id)}-GAP-002`, type: 'ACTION', severity: 'P1', text: 'No meaningful primary action path was verified in the inspected source.' });
  if (missingBackendPath) gaps.push({ id: `PAGE-${safeId(nav.id)}-GAP-003`, type: 'API', severity: 'P1', text: 'No literal backend API path was verified in the inspected page-specific source; server capability remains NOT VERIFIED.' });
  if (item.looksCommercial && item.entitlementMapped === false) gaps.push({ id: `PAGE-${safeId(nav.id)}-GAP-004`, type: 'PERMISSION', severity: 'P1', text: 'The review inventory flags this commercial/SaaS page as lacking a matching entitlement mapping in the disposable review database.' });
  if (nav.rendererSource === 'app.js switchPage' && pageSpecificModule) gaps.push({ id: `PAGE-${safeId(nav.id)}-GAP-005`, type: 'TEST', severity: 'P2', text: 'Documentation contradiction: NAVIGATION_FORENSIC_REPORT.json records app.js switchPage, while the module registry also contains this page. Reconcile renderer ownership after Product Recovery.' });
  const testSources = [`docs/navigation/NAVIGATION_FORENSIC_REPORT.json`, `docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json`];
  const testFiles = fs.existsSync(path.join(root, 'tests')) ? walk(path.join(root, 'tests')).filter((file) => read(file).includes(nav.id)).slice(0, 8) : [];
  testSources.push(...testFiles);
  const sourceEvidence = [...new Set([...sources, 'docs/review/PAGE_INVENTORY.json', 'docs/navigation/NAVIGATION_FORENSIC_REPORT.json'])];
  const businessDomain = nav.topLevelSection || nav.businessDomain || item.moduleDomain || 'unknown';
  const pageKind = classifyKind(nav.id, nav.labelEn, pageSpecificModule ? 'javascript' : nav.rendererType);
  const frontMatter = [
    '---',
    `page_id: ${q(nav.id)}`,
    `title_en: ${q(nav.labelEn || item.labelEn || nav.id)}`,
    `title_ar: ${q(nav.labelAr || item.labelAr || 'NOT VERIFIED')}`,
    `domain: ${q(businessDomain)}`,
    `navigation_group: ${q(nav.sidebarGroup || item.navGroup || 'NOT VERIFIED')}`,
    `kind: ${pageKind}`,
    'canonical_status: PRIMARY',
    `canonical_home: ${q(nav.id)}`,
    `parent_page: ${q(nav.parentPageId)}`,
    'aliases: []',
    `roles: ${qa(parseRoles(item.intendedRoles || nav.supportedRoles))}`,
    `permission: ${q(item.requiredPermission || nav.requiredPermission || 'NOT VERIFIED')}`,
    `entitlement: ${q(item.requiredEntitlement || nav.requiredEntitlement || null)}`,
    `renderer_type: ${q(pageSpecificModule ? 'javascript' : nav.rendererType || 'unknown')}`,
    `renderer_sources: ${qa([...new Set([nav.rendererSource, actualModule].filter(Boolean))])}`,
    `view_sources: ${qa([nav.viewPath])}`,
    `api_sources: ${qa(apiSources)}`,
    `domain_sources: ${qa(sources.filter((source) => source.startsWith('platform/') || source.startsWith('services/') || source.startsWith('modules/')))}`,
    'tables_or_entities: []',
    `test_sources: ${qa(testSources)}`,
    `catalog_baseline_sha: ${q(baseline)}`,
    `last_verified_sha: ${q(baseline)}`,
    `evidence_confidence: ${q(nav.activationResult === 'PASS_VISIBLE_CHROMIUM_CLICK' && sources.length ? 'HIGH' : 'MEDIUM')}`,
    `implementation_status: ${q(sources.length ? 'IMPLEMENTED_AT_BASELINE' : 'NOT_VERIFIED')}`,
    `functional_status: ${q(status)}`,
    `usability_status: ${q(score)}`,
    `review_status: ${q(genericShellRisk || gaps.some((gap) => gap.severity === 'P1') ? 'REQUIRES_PRODUCT_RECOVERY' : 'BASELINE_REVIEWED')}`,
    '---'
  ].join('\n');
  const actionLines = [
    ...inventoryActions.map((label) => `- UI label: ${label}; action ID/API/domain handler/persistence: NOT VERIFIED by the baseline inventory.`),
    ...actions.slice(0, 12).map((action) => `- UI label: ${action.label}; handler/action ID: ${action.handler}; permission and persisted result: NOT VERIFIED unless a page-specific API is listed above.`)
  ];
  const gapLines = gaps.length ? gaps.map((gap) => `- **${gap.id}** (${gap.severity}, ${gap.type}) — ${gap.text}`) : ['- No P0/P1 gap was derived from the inspected baseline sources. This is not a claim that the workspace is complete.'];
  const purposeSentence = `User opens this page to work with the ${nav.labelEn || nav.id} workspace. The exact business completion goal is ${item.primaryPurpose ? 'supported by the review inventory purpose statement above' : 'NOT VERIFIED from baseline evidence'}.`;
  const md = `${frontMatter}\n\n# 1. Identity\n\n- Page ID: \`${nav.id}\`\n- English: ${nav.labelEn || item.labelEn || 'NOT VERIFIED'}\n- Arabic: ${nav.labelAr || item.labelAr || 'NOT VERIFIED'}\n- Domain: \`${businessDomain}\`; navigation group: \`${nav.sidebarGroup || item.navGroup || 'NOT VERIFIED'}\`\n- Route: ${item.route || `switchPage('${nav.id}')`}\n- Page type: ${pageKind}\n\n# 2. Business Purpose\n\n${purpose(item, nav)}\n\n# 3. Primary Users\n\n- Declared roles: ${item.intendedRoles || nav.supportedRoles || 'NOT VERIFIED'}\n- Viewer/operator/reviewer/manager/administrator split: NOT VERIFIED beyond the declared permission gate.\n\n# 4. Primary User Goal\n\n${purposeSentence}\n\n# 5. AS-IS Runtime Surface\n\n${surfaceSummary(sourceTexts, item)}\n\n- Renderer evidence: ${nav.rendererSource || 'NOT VERIFIED'}\n- Visible action inventory: ${item.keyVisibleActions || 'NOT VERIFIED'}\n- Empty state: ${item.expectedEmptyState || 'NOT VERIFIED'}\n- Denied state: ${item.expectedDeniedState || 'NOT VERIFIED'}\n- Generic-shell risk: ${genericShellRisk ? 'YES — the forensic report names app.js switchPage without page-specific renderer evidence.' : 'NO from the inspected page-specific source.'}\n\n# 6. Data Sources\n\n- UI → renderer: ${nav.rendererSource || 'NOT VERIFIED'}\n- Renderer → API/query: ${apiSources.length ? apiSources.join(', ') : 'NOT VERIFIED'}\n- Domain service → table/entity: NOT VERIFIED; no table is asserted without direct source evidence.\n- Required fixture: ${item.requiredFixture || 'NOT VERIFIED'}\n\n# 7. Actions\n\n${actionLines.length ? actionLines.join('\n') : '- No current action was verified. This is a documented gap, not an inferred absence from the page title.'}\n\n# 8. Inputs\n\n- Static controls: ${item.keyVisibleActions || 'NOT VERIFIED'}\n- Governed selectors versus raw IDs: NOT VERIFIED from the page inventory; inspect the page-specific renderer before implementation.\n\n# 9. Outputs\n\nThe intended output is the page’s named ${nav.labelEn || nav.id} record, decision, view, or operational state. Exact persisted object: NOT VERIFIED.\n\n# 10. Workflow Position\n\n- Upstream: ${nav.parentPageId ? `parent page \`${nav.parentPageId}\`` : 'NOT VERIFIED from explicit workflow metadata.'}\n- Downstream: ${refs.length ? refs.map((ref) => `\`${ref}\``).join(', ') : 'NOT VERIFIED from page-specific source.'}\n\n# 11. States\n\n- LOADING: ${pageSpecificModule ? 'module source contains async loading paths; exact copy/state transitions require browser proof.' : 'NOT VERIFIED'}\n- READY: route activation passed visible Chromium audit.\n- EMPTY: ${item.expectedEmptyState || 'NOT VERIFIED'}\n- DENIED: ${item.expectedDeniedState || 'NOT VERIFIED'}\n- VALIDATION_ERROR: NOT VERIFIED\n- SERVER_ERROR: NOT VERIFIED\n- SUCCESS: NOT VERIFIED\n- Domain lifecycle states: NOT VERIFIED.\n\n# 12. Permissions & Scope\n\n- Client page gate: ${item.requiredPermission || nav.requiredPermission || 'NOT VERIFIED'}\n- Entitlement: ${item.requiredEntitlement || nav.requiredEntitlement || 'NOT VERIFIED'}\n- Tenant/company/branch/warehouse/employee scope: NOT VERIFIED in page-specific evidence.\n- Client visibility and server authorization must be treated separately; the navigation click audit proves neither server mutation authorization nor data isolation.\n\n# 13. Arabic / English\n\n- Arabic label: ${nav.labelAr || item.labelAr || 'NOT VERIFIED'}\n- English label: ${nav.labelEn || item.labelEn || 'NOT VERIFIED'}\n- Baseline language metadata: ${nav.supportedLanguages?.join(', ') || `${item.rtlStatus || 'NOT VERIFIED'}; ${item.ltrStatus || 'NOT VERIFIED'}`}\n- Missing labels: NOT VERIFIED beyond static inventory evidence.\n\n# 14. Responsive Requirements\n\n- Desktop/laptop: the visible navigation audit covered route activation, not layout quality.\n- Mobile: ${item.mobileStatus || 'NOT VERIFIED'}; operational mobile behavior requires a separate browser contract.\n\n# 15. AS-IS Functional Assessment\n\n**${score}** — ${genericShellRisk ? 'The route was visibly clickable, but the baseline forensic renderer record identifies a shell without a verified page-specific workflow.' : `The baseline contains ${pageSpecificModule ? 'a page-specific JavaScript renderer' : 'a registered view/renderer'}${apiSources.length ? ' and API evidence' : ', but no literal API evidence was found in the inspected source'}.`} This score is evidence-based and does not claim domain completion.\n\n# 16. Target Business Contract\n\nThe ${nav.labelEn || nav.id} workspace should give its governed users a page-specific way to complete the named business task: load scoped records, accept governed inputs where needed, execute authorized actions, persist the resulting state through the domain authority, and expose explicit loading/empty/denied/validation/server-error/success states. Exact fields and lifecycle transitions remain **NOT VERIFIED** where the baseline source does not define them.\n\n# 17. Identified Gaps\n\n${gapLines.join('\n')}\n\n# 18. Consolidation Analysis\n\n- Remain a primary workspace: **YES pending owner review**, because it is classified as a primary navigation page in the baseline forensic report.\n- Tab/master-detail child/dialog/action/alias/internal-view alternative: NOT VERIFIED; do not consolidate from page title alone.\n- Canonical candidate: \`${nav.id}\` unless a later owner decision records another home.\n\n# 19. Acceptance Criteria\n\n- A user with the declared permission can open \`${nav.id}\` through the visible navigation and see a non-error page-specific surface.\n- The page exposes only actions whose permission, API/domain handler, required inputs, persisted result, and next state are documented and server-authorized.\n- The page distinguishes LOADING, READY, EMPTY, DENIED, VALIDATION_ERROR, SERVER_ERROR, and SUCCESS in a real browser.\n- A scoped browser test proves the named ${nav.labelEn || nav.id} workflow; the current 231/231 click audit is route activation evidence only.\n\n# 20. Test Evidence\n\n- **REAL_BROWSER_VISIBLE_UI:** ${testSources[1]} — authenticated Chromium visible click audit; 231/231 primary navigation items passed, including this page.\n- **STATIC:** docs/review/PAGE_INVENTORY.json and docs/navigation/NAVIGATION_FORENSIC_REPORT.json.\n- **API / DOMAIN:** ${testFiles.length ? testFiles.join(', ') : 'NOT VERIFIED by a page-id-specific test in tests/.'}\n- **REAL_BROWSER_DIRECT:** NOT VERIFIED; no direct action lifecycle proof is attributed here.\n\n# 21. Known Limitations\n\n- This catalog is a forensic specification at baseline ${baseline}; it does not describe uncommitted engineering changes.\n- Navigation activation is not functional, permission-isolation, lifecycle, or persistence proof.\n- Table/entity ownership is intentionally left NOT VERIFIED unless exact source evidence is available.\n${nav.rendererSource === 'app.js switchPage' && pageSpecificModule ? '- The navigation forensic renderer classification conflicts with the page-specific module registry; reconcile after Product Recovery.\n' : ''}\n\n# 22. Source Evidence\n\n${sourceEvidence.map((source) => `- \`${source}\``).join('\n')}\n\n# 23. Change History\n\n- ${new Date().toISOString().slice(0, 10)} — catalog created from baseline ${baseline}.\n- Future reconciliation must append the Product Recovery SHA and preserve the AS-IS/TARGET separation.\n\n## CAPABILITIES OWNED\n\n- ${nav.labelEn || nav.id} workspace presentation and its explicitly verified page-specific actions: ${actions.length ? actions.map((action) => action.handler).join(', ') : 'NOT VERIFIED'}.\n\n## CAPABILITIES CONSUMED\n\n- Navigation activation, declared page permission gate, and any API paths listed in the front matter. Exact domain capabilities: NOT VERIFIED where no backend path was found.\n`;
  return { nav, item, businessDomain, pageKind, status, score, genericShellRisk, missingActionPath, missingBackendPath, apiSources, refs, sources, testSources, gaps, md };
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(rel(path.relative(root, full)));
  }
  return files;
}

fs.mkdirSync(out, { recursive: true });
const pages = navPages.map(buildPage);
const domains = [...new Set(pages.map((page) => page.businessDomain))].sort();
for (const page of pages) {
  const directory = path.join(out, page.businessDomain);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${page.nav.id}.md`), page.md, 'utf8');
}

const manifestPages = pages.map((page) => ({
  pageId: page.nav.id,
  domain: page.businessDomain,
  upstream: page.nav.parentPageId ? [page.nav.parentPageId] : [],
  downstream: page.refs,
  parent: page.nav.parentPageId || null,
  aliases: [],
  consolidationCandidate: null,
  capabilitiesOwned: [`${page.nav.id}:workspace`],
  capabilitiesConsumed: page.apiSources,
  sourceFiles: page.sources,
  lastVerifiedSha: baseline
}));
const manifest = {
  schemaVersion: 1,
  catalogBaselineSha: baseline,
  lastVerifiedSha: baseline,
  generatedAt: new Date().toISOString(),
  primaryWorkspaceCount: pages.length,
  embeddedTabs: forensic.items.filter((item) => item.kind === 'tab').map((item) => item.id),
  compatibilityAliases: forensic.items.filter((item) => item.kind === 'alias').map((item) => item.id),
  pages: manifestPages
};
fs.writeFileSync(path.join(out, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const counts = Object.fromEntries(['STRONG', 'USABLE', 'THIN', 'EMPTY', 'CONFUSING', 'BROKEN'].map((score) => [score, pages.filter((page) => page.score === score).length]));
const rows = domains.map((domain) => {
  const domainPages = pages.filter((page) => page.businessDomain === domain);
  const lines = domainPages.map((page) => `| \`${page.nav.id}\` | ${page.nav.labelEn || 'NOT VERIFIED'} | ${page.nav.labelAr || 'NOT VERIFIED'} | ${page.pageKind} | PRIMARY | ${page.score} | ${page.score} | ${page.genericShellRisk ? 'Product Recovery attention' : 'Retain and reconcile'} | [spec](./${domain}/${page.nav.id}.md) |`);
  return `\n### ${domain}\n\n| Page ID | English | Arabic | Kind | Status | Functional | Usability | Recommended disposition | Spec |\n|---|---|---|---|---|---|---|---|---|\n${lines.join('\n')}`;
}).join('\n');
const index = `# Octagon Page Specification Catalog\n\nBaseline: \`${baseline}\`  \nPrimary workspaces: **${pages.length}**  \nEmbedded tabs excluded from primary specs: **${manifest.embeddedTabs.join(', ')}**  \nCompatibility alias excluded from primary specs: **${manifest.compatibilityAliases.join(', ')}**\n\n## Counts\n\n- STRONG: ${counts.STRONG}\n- USABLE: ${counts.USABLE}\n- THIN: ${counts.THIN}\n- EMPTY: ${counts.EMPTY}\n- CONFUSING: ${counts.CONFUSING}\n- BROKEN: ${counts.BROKEN}\n- Generic-shell risks: ${pages.filter((page) => page.genericShellRisk).length}\n- Consolidation candidates: ${pages.filter((page) => page.nav.status === 'duplicate_candidate').length}\n- Missing meaningful primary action: ${pages.filter((page) => page.missingActionPath).length}\n- No verified backend path: ${pages.filter((page) => page.missingBackendPath).length}\n- Fixture-empty or fixture not verified: ${pages.filter((page) => !page.item.requiredFixture || /empty|not verified/i.test(page.item.requiredFixture)).length}\n\n## Domains\n\n${domains.map((domain) => `- ${domain}: ${pages.filter((page) => page.businessDomain === domain).length}`).join('\n')}\n${rows}\n`;
fs.writeFileSync(path.join(out, 'INDEX.md'), index, 'utf8');

const readme = `# Octagon ERP Page Specification Catalog\n\nThis is a documentation-only catalog of the **231 primary workspaces** registered at baseline \`${baseline}\`. It was built in the isolated worktree/branch \`codex/octagon-page-spec-catalog\` while the engineering worktree was concurrently changing.\n\n## Scope\n\n- One canonical Markdown specification per current primary navigation workspace.\n- Four embedded tabs and one POS compatibility alias are recorded in MANIFEST.json but do not receive primary workspace specs.\n- AS-IS implementation, TARGET BUSINESS CONTRACT, and GAP are kept separate in every file.\n- Visible Chromium navigation evidence proves route activation only; it is not presented as workflow or persistence proof.\n- Unknowns are explicitly marked NOT VERIFIED.\n\n## Files\n\n- [INDEX.md](./INDEX.md) — domain index and reconciled counts.\n- [MANIFEST.json](./MANIFEST.json) — machine-readable page graph and source evidence.\n- [STALE_SPEC_RECONCILIATION.md](./STALE_SPEC_RECONCILIATION.md) — post-Product-Recovery refresh procedure.\n- [tools/generate-catalog.mjs](./tools/generate-catalog.mjs) — reproducible baseline generator.\n\n## Important baseline contradiction\n\nThe navigation forensic report records 24 BUILD-12 destinations as \`app.js switchPage\`, while the baseline also contains their page registry and renderers in \`modules/build12-workspaces.js\`. The affected specs preserve both facts and flag reconciliation rather than collapsing the evidence.\n`;
fs.writeFileSync(path.join(out, 'README.md'), readme, 'utf8');

const stale = `# Stale Spec Reconciliation\n\nEvery page spec records \`catalog_baseline_sha\` and \`last_verified_sha\`. At creation both are \`${baseline}\`. The catalog intentionally does not follow later engineering changes.\n\n## Procedure\n\n1. Obtain the Product Recovery final SHA.\n2. Run \`git diff --name-status ${baseline}..PRODUCT_RECOVERY_FINAL_SHA\` in a read-only clone or checkout.\n3. Map changed \`index.html\`, \`app.js\`, \`server.js\`, \`services/\`, \`modules/\`, \`platform/\`, \`views/\`, migrations, and tests to affected page IDs using MANIFEST.json sourceFiles plus page-id search.\n4. Reopen only affected specs. Update AS-IS sections to the final SHA; preserve TARGET BUSINESS CONTRACT text unless the owner changes the contract.\n5. Recompute GAP, functional/usability assessments, actions, API evidence, and relationship edges.\n6. Set \`last_verified_sha\` to the Product Recovery final SHA and append a dated Change History entry.\n7. Re-run the catalog validator/generator in a dedicated documentation worktree; do not write product, navigation, or autopilot documents from this branch.\n\n## Reconciliation rules\n\n- A source change does not automatically mean a business contract changed.\n- A navigation click pass does not replace real browser lifecycle proof.\n- Preserve historical specs when a page is later consolidated; change canonical status and add canonical_home rather than deleting the file.\n- Resolve the BUILD-12 renderer-source contradiction explicitly after Product Recovery.\n`;
fs.writeFileSync(path.join(out, 'STALE_SPEC_RECONCILIATION.md'), stale, 'utf8');

console.log(JSON.stringify({ baseline, primary: pages.length, specs: pages.length, domains, counts, genericShellRisks: pages.filter((page) => page.genericShellRisk).length, missingActions: pages.filter((page) => page.missingActionPath).length, missingBackend: pages.filter((page) => page.missingBackendPath).length }, null, 2));
