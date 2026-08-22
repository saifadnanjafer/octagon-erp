#!/usr/bin/env node
/* Navigation Recovery 1 — merge serial visible-click evidence into the registry. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const docs = path.join(root, 'docs');
const navDocs = path.join(docs, 'navigation');
const evidence = path.join(docs, 'autopilot', 'evidence');
const reportPath = path.join(navDocs, 'NAVIGATION_FORENSIC_REPORT.json');
const auditNames = ['NAVIGATION-RECOVERY-1-click-audit-all.json', 'NAVIGATION-RECOVERY-1-click-audit-40.json', 'NAVIGATION-RECOVERY-1-click-audit-80.json', 'NAVIGATION-RECOVERY-1-click-audit-120.json', 'NAVIGATION-RECOVERY-1-click-audit-160.json', 'NAVIGATION-RECOVERY-1-click-audit-200.json'];
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const audits = auditNames.map(name => JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8')));
const results = new Map(audits.flatMap(audit => audit.items.map(item => [item.id, item])));
const primary = report.items.filter(item => item.visibleInPrimaryNavigation);
const missing = primary.filter(item => !results.has(item.id)).map(item => item.id);
const failed = primary.filter(item => results.get(item.id)?.status !== 'PASS').map(item => item.id);
if (missing.length || failed.length || results.size !== primary.length) throw new Error(`click-audit mismatch: primary=${primary.length}, results=${results.size}, missing=${missing.join(',')}, failed=${failed.join(',')}`);

for (const item of report.items) {
  const result = results.get(item.id);
  item.activationResult = result ? 'PASS_VISIBLE_CHROMIUM_CLICK' : 'NOT_PRIMARY_NAVIGATION';
  item.status = result ? 'active_verified' : item.status;
  item.recommendedFutureAction = result ? 'Retain in the governed navigation registry.' : 'Keep outside primary navigation; owner decision governs future consolidation.';
}
report.runtimeAcceptance = {
  method: 'authenticated Chromium visible clicks only; no direct switchPage calls',
  auditedAt: new Date().toISOString(),
  primaryNavigationItems: primary.length,
  passed: primary.length,
  failed: 0,
  evidenceFiles: auditNames
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(evidence, 'NAVIGATION-RECOVERY-1-click-audit.json'), `${JSON.stringify({ ...report.runtimeAcceptance, audits }, null, 2)}\n`);

const inventoryRows = report.items.map(item => `| ${item.id} | ${item.labelAr} | ${item.labelEn} | ${item.kind.toUpperCase()} | ${item.topLevelSection} | ${item.sidebarGroup || '—'} | ${item.parentPageId || '—'} | ${item.activationResult} |`).join('\n');
const orphanRows = report.orphanViews.map(item => `- \`${item.id}\`: **${item.classification}** — ${item.rationale}`).join('\n');
fs.writeFileSync(path.join(navDocs, 'NAVIGATION_FORENSIC_REPORT.md'), `# Navigation Forensic Report\n\nNavigation Recovery 1 source inventory and runtime acceptance.\n\n- Registered descriptors: ${report.inventory.registeredItems}\n- Primary navigation pages: ${primary.length}\n- Embedded tabs: ${report.classificationCounts.TAB}\n- Compatibility aliases: ${report.classificationCounts.ALIAS}\n- Orphan views retained outside primary navigation: ${report.inventory.orphanViews}\n- Visible Chromium click acceptance: **${primary.length}/${primary.length} passed**\n\n## Registry\n\n| ID | Arabic | English | Kind | Section | Group | Parent | Runtime result |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${inventoryRows}\n\n## Orphan views\n\n${orphanRows}\n`);

const groups = new Map();
for (const item of primary) { const key = `${item.topLevelSection}::${item.sidebarGroup}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
const mapSections = [...groups].map(([key, items]) => { const [section, group] = key.split('::'); return `### ${section} / ${group}\n\n${items.map(item => `- ${item.icon} ${item.labelAr} — ${item.labelEn} (\`${item.id}\`)`).join('\n')}`; }).join('\n\n');
fs.writeFileSync(path.join(navDocs, 'OCTAGON_NAVIGATION_MAP.md'), `# Octagon Navigation Map\n\nThe primary sidebar contains ${primary.length} verified workspaces arranged into seven top-level domains. Each group is collapsed by default except the active group; only one domain is visible at a time.\n\n${mapSections}\n`);

const nonPrimary = report.items.filter(item => !item.visibleInPrimaryNavigation);
fs.writeFileSync(path.join(navDocs, 'PAGE_CONSOLIDATION_CANDIDATES.md'), `# Page Consolidation Candidates\n\nNo candidate below has been deleted or merged. These are explicit classifications for owner review.\n\n## Already removed from primary navigation\n\n${nonPrimary.map(item => `- **${item.kind.toUpperCase()}** \`${item.id}\` → \`${item.parentPageId}\`: ${item.classificationRationale}`).join('\n')}\n\n## Orphan view candidates\n\n${orphanRows}\n`);
fs.writeFileSync(path.join(navDocs, 'OWNER_CONSOLIDATION_DECISIONS.md'), `# Owner Consolidation Decisions\n\nStatus: **human decision required**. Navigation Recovery 1 made no irreversible deletion or merge.\n\nApprove, revise, or reject each proposed consolidation:\n\n${nonPrimary.map(item => `- [ ] Retain \`${item.id}\` as ${item.kind.toUpperCase()} under \`${item.parentPageId}\`.`).join('\n')}\n\n${report.orphanViews.filter(item => ['duplicate_candidate', 'alias'].includes(item.classification)).map(item => `- [ ] Decide whether orphan \`${item.id}\` should remain a compatibility surface, move under its canonical owner, or be retired through a separate approved change.`).join('\n')}\n`);
fs.writeFileSync(path.join(evidence, 'NAVIGATION-RECOVERY-1-completion.md'), `# Navigation Recovery 1 Completion Evidence\n\n- Correct worktree and protected freeze tag were verified before changes.\n- Runtime inventory: ${report.inventory.registeredItems} descriptors, ${primary.length} primary pages, ${nonPrimary.length} non-primary classified controls, and ${report.inventory.orphanViews} orphan views.\n- Chromium acceptance: **${primary.length}/${primary.length} primary pages passed** through visible UI clicks against the disposable review environment at ${audits[0].baseUrl}.\n- Fixed defects: late module pages were registered; Build 10 no longer re-renders sidebar controls or clears foreign pages; Build 11/12 self-rendered pages gain \`page-active\`; self-rendered pages skip nonexistent template requests; WhatsApp module is loaded.\n- Human decision remains required for the non-primary controls and orphan/duplicate candidates listed in the navigation decision document.\n`);
console.log(`Merged ${primary.length}/${primary.length} verified primary destinations.`);
