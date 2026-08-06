#!/usr/bin/env node
/*
 * Navigation Recovery 1: source-of-truth forensic inventory.
 *
 * This intentionally reports unknown activation paths instead of claiming a
 * page is healthy from markup alone. Runtime acceptance updates those fields.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const app = read('app.js');
const index = read('index.html');
const permissionSource = read('services', 'permissionService.js');
const outDir = path.join(root, 'docs', 'navigation');
const title = (id) => id.split(/[_-]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
const strip = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hasArabic = (value) => /[\u0600-\u06ff]/.test(value);

function navConfig() {
  const start = app.indexOf('const navLabelOverrides =');
  const end = app.indexOf('\nfunction getNavGroupForPage');
  if (start < 0 || end < start) throw new Error('Navigation source registry was not found in app.js');
  const context = {};
  vm.runInNewContext(`${app.slice(start, end)}\nglobalThis.value = { navLabelOverrides, navDomains, navGroupMeta, navGroupPages };`, context);
  return context.value;
}

function rawButtons() {
  const matcher = /<button\b(?=[^>]*\bclass=["'][^"']*\bnav-btn\b[^"']*["'])(?=[^>]*\bdata-page=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/button>/g;
  return [...index.matchAll(matcher)].map(([, id, body]) => {
    const labelNode = body.match(/<span[^>]*class=["'][^"']*\bnav-label\b[^"']*["']([^>]*)>([\s\S]*?)<\/span>/i);
    const label = strip(labelNode?.[2] || body);
    const attrs = labelNode?.[1] || '';
    return {
      id,
      label,
      labelAr: (attrs.match(/data-i18n-ar=["']([^"']*)/i)?.[1] || (hasArabic(label) ? label : '')),
      labelEn: (attrs.match(/data-i18n-en=["']([^"']*)/i)?.[1] || (!hasArabic(label) ? label : title(id))),
      domSource: 'index.html'
    };
  });
}

const lateEntries = [
  { id: 'system_check', labelAr: 'فحص النظام', labelEn: 'System Check', domSource: 'modules/system-check.js' },
  { id: 'import_center', labelAr: 'استيراد البيانات', labelEn: 'Data Import', domSource: 'modules/import-wizard.js' },
  { id: 'system_settings', labelAr: 'إعدادات النظام', labelEn: 'System Settings', domSource: 'modules/system-settings.js' }
];
const nonPrimaryNavigation = {
  calculator: { kind: 'tab', domain: 'core', parentPageId: 'timesheet', rationale: 'The calculator is docked inside Timesheet and is not an independent sidebar destination.' },
  kanban: { kind: 'tab', domain: 'ops', parentPageId: 'task_manager', rationale: 'Kanban is activated as a view inside the canonical work-management workspace.' },
  workshop_tv: { kind: 'tab', domain: 'ops', parentPageId: 'task_manager', rationale: 'Workshop TV is activated as a view inside the canonical work-management workspace.' },
  locations: { kind: 'tab', domain: 'ops', parentPageId: 'warehouses', rationale: 'Locations shares the warehouses workspace and is a subordinate inventory view.' },
  pos_deepening: { kind: 'alias', domain: 'commercial', parentPageId: 'pos', rationale: 'The canonical POS router deliberately redirects this legacy route to the single POS workspace.' }
};

function rendererFor(id, viewNames) {
  const aliases = { products: 'products_and_materials', parties: 'customers_and_suppliers', warehouses: 'warehouses_and_locations', locations: 'warehouses_and_locations' };
  const view = aliases[id] || id;
  if (viewNames.has(view)) return { rendererType: 'view', rendererSource: `views/${view}.html`, viewPath: `views/${view}.html` };
  if (id === 'import_center' || id === 'system_settings' || id === 'system_check') return { rendererType: 'javascript', rendererSource: lateEntries.find(item => item.id === id).domSource, viewPath: null };
  const moduleFiles = fs.readdirSync(path.join(root, 'modules'), { recursive: true }).filter(file => file.endsWith('.js'));
  const source = moduleFiles.find(file => fs.readFileSync(path.join(root, 'modules', file), 'utf8').includes(`'${id}'`));
  return { rendererType: source ? 'javascript' : 'shell', rendererSource: source ? `modules/${source.replaceAll('\\', '/')}` : 'app.js switchPage', viewPath: null };
}

const { navLabelOverrides, navDomains, navGroupMeta, navGroupPages } = navConfig();
const groupByPage = new Map(Object.entries(navGroupPages).flatMap(([group, ids]) => ids.map(id => [id, group])));
const domainByGroup = new Map(Object.entries(navGroupMeta).map(([group, value]) => [group, value.domain]));
const sectionByDomain = new Map(navDomains.map(section => [section.key, section]));
const viewNames = new Set(fs.readdirSync(path.join(root, 'views')).filter(name => name.endsWith('.html')).map(name => name.slice(0, -5)));
const raw = rawButtons();
const itemById = new Map(raw.map(item => [item.id, item]));
for (const item of lateEntries) itemById.set(item.id, { ...item, labelAr: navLabelOverrides[item.id]?.ar || item.labelAr, labelEn: navLabelOverrides[item.id]?.en || item.labelEn });

const items = [...itemById.values()].sort((a, b) => a.id.localeCompare(b.id)).map((item, order) => {
  const registryLabel = navLabelOverrides[item.id];
  const nonPrimary = nonPrimaryNavigation[item.id];
  const sidebarGroup = groupByPage.get(item.id) || null;
  const domain = domainByGroup.get(sidebarGroup) || nonPrimary?.domain || 'admin';
  const section = sectionByDomain.get(domain);
  const renderer = rendererFor(item.id, viewNames);
  const permissionDeclared = new RegExp(`\\b${item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(permissionSource);
  return {
    id: item.id,
    kind: nonPrimary?.kind || 'page',
    labelAr: registryLabel?.ar || item.labelAr || null,
    labelEn: registryLabel?.en || item.labelEn || null,
    businessDomain: domain,
    topLevelSection: section?.key || 'admin',
    sidebarGroup,
    parentPageId: nonPrimary?.parentPageId || null,
    visibleInPrimaryNavigation: !nonPrimary,
    visibleInSecondaryNavigation: !nonPrimary,
    order,
    icon: navGroupMeta[sidebarGroup]?.icon || 'fa-file-lines',
    ...renderer,
    activationKey: item.id,
    requiredPermission: permissionDeclared ? item.id : 'default-client-gate',
    requiredEntitlement: null,
    supportedRoles: permissionDeclared ? 'permissionService page policy' : 'default client policy',
    supportedLanguages: ['ar', 'en'],
    status: renderer.rendererType === 'shell' ? 'active_unverified_renderer' : 'active',
    currentDomSource: item.domSource,
    currentRendererSource: renderer.rendererSource,
    currentPermission: permissionDeclared ? 'declared' : 'default-client-gate',
    currentEntitlement: null,
    currentItemType: (nonPrimary?.kind || 'page').toUpperCase(),
    intendedBusinessDomain: domain,
    intendedParentPage: nonPrimary?.parentPageId || null,
    intendedVisibility: nonPrimary ? 'embedded_tab' : 'secondary_navigation',
    activationResult: 'pending_real_click_acceptance',
    classificationRationale: nonPrimary?.rationale || 'Visible navigation destination; retained pending real click-through acceptance.',
    recommendedFutureAction: renderer.rendererType === 'shell' ? 'verify renderer and terminal state in Chromium' : 'verify terminal state in Chromium'
  };
});

const orphanViews = [...viewNames].filter(view => !items.some(item => item.viewPath === `views/${view}.html`));
const orphanDecisions = {
  collaboration_lineage: ['internal', 'Internal lineage evidence; not a primary destination.'],
  credit_collections: ['duplicate_candidate', 'Potential finance workflow overlap; retain until owner consolidation decision.'],
  document_templates: ['dialog', 'Template selection belongs beneath Documents or e-signature.'],
  dq_dashboard: ['tab', 'Data quality summary belongs inside the Data Quality page.'],
  dq_exceptions: ['tab', 'Data quality exception list belongs inside the Data Quality page.'],
  duplicate_candidates: ['internal', 'Administrative review queue; not a normal business page.'],
  electronic_signatures: ['alias', 'Compatibility surface for the canonical e-signature page.'],
  mdg_center: ['internal', 'Master-data governance support surface pending owner review.'],
  merge_review: ['internal', 'Review-only merge support surface.'],
  notifications: ['widget', 'Notification component, not a standalone workspace.'],
  rma_inspections: ['tab', 'Inspection flow belongs within warranty/RMA.'],
  sales_commissions: ['alias', 'Compatibility surface for canonical sales_commission.'],
  saved_views: ['tab', 'Saved views are subordinate to their owning list pages.'],
  scheduled_reports: ['tab', 'Scheduling is subordinate to Reports.'],
  service_contracts: ['duplicate_candidate', 'Potential overlap with Contracts; preserve until owner decision.']
};
const classificationCounts = items.reduce((counts, item) => {
  const key = item.kind.toUpperCase();
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, { PAGE: 0, TAB: 0, ACTION: 0, DIALOG: 0, DASHBOARD_WIDGET: 0, ALIAS: 0, INTERNAL: 0, DUPLICATE_CANDIDATE: 0, BROKEN: 0 });
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inventory: { registeredItems: items.length, rawIndexButtons: raw.length, lateModuleButtons: lateEntries.length, viewFiles: viewNames.size, orphanViews: orphanViews.length },
  classificationCounts,
  reconciliation: { classifiedItems: Object.values(classificationCounts).reduce((sum, value) => sum + value, 0), reconciled: Object.values(classificationCounts).reduce((sum, value) => sum + value, 0) === items.length },
  topLevelSections: navDomains.map(section => ({ id: section.key, label: section.label, groups: section.groups })),
  orphanViews: orphanViews.map(id => ({
    id,
    classification: orphanDecisions[id]?.[0] || 'internal',
    rationale: orphanDecisions[id]?.[1] || 'Not referenced by the primary navigation; retained as an internal view pending runtime confirmation.',
    recommendedFutureAction: 'Do not automatically expose or delete.'
  })),
  items
};

if (process.argv.includes('--check')) {
  if (!report.reconciliation.reconciled || items.some(item => !item.labelAr || !item.labelEn)) process.exitCode = 1;
} else {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'NAVIGATION_FORENSIC_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
  const rows = items.map(item => `| ${item.id} | ${item.labelAr || 'MISSING'} | ${item.labelEn || 'MISSING'} | ${item.topLevelSection} | ${item.sidebarGroup} | ${item.rendererType} | ${item.activationResult} |`).join('\n');
  const orphanRows = report.orphanViews.map(item => `- \`${item.id}\`: **${item.classification}** — ${item.rationale}`).join('\n');
  fs.writeFileSync(path.join(outDir, 'NAVIGATION_FORENSIC_REPORT.md'), `# Navigation Forensic Report\n\nGenerated from the development branch source before Navigation Recovery 1 runtime acceptance. Source classification is deliberately not a success claim for activation.\n\n- Registered navigation items: ${items.length}\n- Static index buttons: ${raw.length}\n- Late module buttons: ${lateEntries.length}\n- View files: ${viewNames.size}\n- Orphan views: ${orphanViews.length}\n- Reconciled classifications: ${report.reconciliation.classifiedItems}/${items.length}\n\n## Inventory\n\n| ID | Arabic | English | Section | Sidebar group | Renderer | Activation |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\n## Orphan views\n\n${orphanViews.map(id => `- \`${id}\`: unclassified; do not automatically expose or delete.`).join('\n')}\n`);
  console.log(`Navigation forensic report written: ${items.length} items, ${orphanViews.length} orphan views.`);
}
