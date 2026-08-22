/**
 * Per-page scorecard: readiness, functionality, a percentage, and whether the
 * page is safe to merge.
 *
 * The percentage is deliberately NOT a judgement call. It is ten independent
 * checks, each measured from the runtime inspection or the functional ledger,
 * scored 1 point each. Every column below can be recomputed from the same two
 * generated files, so the number can be audited rather than trusted.
 *
 * "Ready to merge" is separate from the score on purpose: a page can score 100%
 * and still not be mergeable, because it is waiting on an owner decision about
 * what it should be. Those are listed, not silently marked green.
 */
import fs from 'node:fs';

const inspection = JSON.parse(fs.readFileSync('docs/product/PAGE_RUNTIME_INSPECTION.json', 'utf8'));
const ledger = JSON.parse(fs.readFileSync('docs/product/PAGE_FUNCTIONAL_LEDGER.json', 'utf8'));

// Pages whose FATE is an open owner decision — recorded in
// FINAL_PAGE_CONSOLIDATION_MAP.md and BUILD13_FEATURE_GAP_REGISTER.md.
const OWNER_DECISION = new Map([
  ['inventory', 'Legacy vs canonical stock authority (GAP-001)'],
  ['canonical_inventory', 'Legacy vs canonical stock authority (GAP-001)'],
  ['contracts', 'Contracts vs sales_contracts ownership'],
  ['sales_contracts', 'Contracts vs sales_contracts ownership'],
  ['home', 'home vs wfl_home — which is the canonical landing page'],
  ['wfl_home', 'home vs wfl_home — which is the canonical landing page'],
  ['content_approvals', 'Generic approvals queue cannot model content targets (C-028)'],
  ['approvals', 'Generic approvals queue cannot model content targets (C-028)'],
]);

const obs = new Map(inspection.pages.map((p) => [p.id, p.observation || {}]));
const ARCHETYPES_WITHOUT_TABLES = /FORM|ENTRY|ACTION|DETAIL|READ|BOARD/i;

function scorePage(row) {
  const o = obs.get(row.pageId) || {};
  const measured = row.measured || {};
  const englishControls = (o.controlLabels || []).filter((x) => /[A-Za-z]{3}/.test(x) && !/[\u0621-\u064A]/.test(x));
  const dataSurface = (measured.tableRows || 0) > 0 || (measured.listItems || 0) > 0
    || ARCHETYPES_WITHOUT_TABLES.test(row.pageArchetype || '');

  const checks = [
    ['renders', !!o.resolved],
    ['noConsoleErrors', (o.consoleErrors || []).length === 0],
    ['noFailedRequests', (o.failedRequests || []).length === 0],
    ['hasTitle', !!o.title],
    ['hasControls', (measured.controls || 0) > 0],
    ['notDeadEnd', row.deadEnd !== true],
    ['noRawJson', !measured.rawJson],
    ['noRawIds', (measured.rawIds || 0) === 0],
    ['arabicChrome', englishControls.length === 0],
    ['dataSurface', dataSurface],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return { checks, passed, pct: Math.round((passed / checks.length) * 100), englishControls };
}

const rows = ledger.rows.map((row) => {
  const s = scorePage(row);
  const blocker = OWNER_DECISION.get(row.pageId) || null;
  const functional = row.functionalState;
  const readiness = row.usabilityState;
  const clean = s.pct === 100;
  const mergeable = !blocker && functional !== 'THIN' && readiness !== 'THIN'
    && row.deadEnd !== true && s.checks.every(([k, ok]) => ok || k === 'arabicChrome' || k === 'dataSurface');
  return {
    id: row.pageId,
    labelAr: row.labelAr || '',
    domain: row.domain || '',
    group: row.sidebarGroup || '',
    priority: row.reviewPriority || '',
    readiness,
    functional,
    pct: s.pct,
    clean,
    mergeable,
    blocker,
    failing: s.checks.filter(([, ok]) => !ok).map(([k]) => k),
    english: s.englishControls,
  };
});

rows.sort((a, b) => a.pct - b.pct || a.id.localeCompare(b.id));

const summary = {
  total: rows.length,
  at100: rows.filter((r) => r.pct === 100).length,
  mergeable: rows.filter((r) => r.mergeable).length,
  blocked: rows.filter((r) => r.blocker).length,
  avgPct: Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length),
  functional: rows.reduce((acc, r) => { acc[r.functional] = (acc[r.functional] || 0) + 1; return acc; }, {}),
  readiness: rows.reduce((acc, r) => { acc[r.readiness] = (acc[r.readiness] || 0) + 1; return acc; }, {}),
};

fs.writeFileSync('docs/product/PAGE_SCORECARD.json', JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
console.log(JSON.stringify(summary, null, 2));
