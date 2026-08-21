#!/usr/bin/env node
/*
 * Product Recovery 1 — page reality ledger.
 *
 * This does NOT re-run the browser. It is a second derivation pass over the
 * evidence scripts/product/build-ledger.mjs already collected and computed
 * (docs/product/PAGE_FUNCTIONAL_LEDGER.json + PAGE_RUNTIME_INSPECTION.json),
 * adding the two things the functional ledger deliberately does not attempt:
 *
 *   1. emptinessCause — WHY a THIN/BROKEN/zero-record page looks the way it
 *      does, using the taxonomy the owner specified (no fixture / legitimate
 *      zero-row / UI disconnected / wrong endpoint / permission-scoped /
 *      missing context / generic shell / no domain impl / shouldn't be a
 *      page). Every value is either MEASURED (traced to a concrete signal:
 *      a denied state, a 401/403/404, a null canonicalApi) or INFERRED
 *      (a heuristic guess, labelled as such, for cases with no error signal
 *      at all — a page can render zero rows with no error either because the
 *      fixture never seeded that resource, or because zero is the correct
 *      state, and no runtime signal distinguishes those two automatically).
 *
 *   2. recommendedDisposition — the Phase-G action (FIX_FIXTURE /
 *      FIX_CONNECTION / STRENGTHEN / CONSOLIDATE / HIDE / SIMULATOR_LABEL /
 *      DEFER) that follows mechanically from the cause.
 *
 * It also carries forward an explicit, honest gap rather than a fabricated
 * field: inspect-pages.mjs never clicks a page's own action buttons (by
 * design — it must stay read-only), so no ledger row can claim to have
 * PROVEN that an action persists. `actionPersistenceEvidence` says so on
 * every row instead of implying verification that never happened.
 *
 * Outputs:
 *   docs/product/PAGE_REALITY_LEDGER.json
 *   docs/product/PAGE_REALITY_LEDGER.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const P = (...parts) => path.join(root, ...parts);
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

const ledger = readJson(P('docs', 'product', 'PAGE_FUNCTIONAL_LEDGER.json'));
const runtime = readJson(P('docs', 'product', 'PAGE_RUNTIME_INSPECTION.json'));
const forensic = readJson(P('docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'));
const overlap = readJson(P('docs', 'product', 'PAGE_OVERLAP_MATRIX.json'), null); // may not exist as JSON; matrix is md-only today

if (!ledger) throw new Error('docs/product/PAGE_FUNCTIONAL_LEDGER.json is required — run `npm run product:ledger` first');
if (!runtime) throw new Error('docs/product/PAGE_RUNTIME_INSPECTION.json is required — run `npm run product:inspect-pages` first');

const runtimeById = new Map((runtime.pages || []).map((entry) => [entry.id, entry]));

// How many primary pages share a rendererSource — a weak signal on its own
// (legitimate domain modules also serve several related pages from one
// file), only used in combination with near-zero rendered content below.
const sourceCounts = new Map();
(forensic?.items || []).filter((item) => item.visibleInPrimaryNavigation).forEach((item) => {
  sourceCounts.set(item.rendererSource, (sourceCounts.get(item.rendererSource) || 0) + 1);
});

const CAUSES = {
  NO_FIXTURE_DATA: 'A — no fixture records exist for this resource',
  ZERO_ROW_LEGITIMATE: 'B — API returns a legitimate zero-row result',
  UI_DISCONNECTED: 'C — backend capability exists but the UI is not wired to it correctly',
  WRONG_ENDPOINT: 'D — UI calls the wrong endpoint',
  PERMISSION_SCOPE: 'E — permission/tenant/company scope rejects the data',
  MISSING_CONTEXT: 'F — required context (e.g. a selected parent record) is missing',
  GENERIC_SHELL: 'G — renderer is only a generic shell with no page-specific implementation',
  NO_DOMAIN_IMPL: 'H — page has no meaningful domain implementation behind it',
  NOT_A_REAL_PAGE: 'I — this should never have been a primary page',
  NOT_AN_EMPTINESS_CASE: 'not an emptiness case — page is BROKEN (crash/server error), fix the defect before re-classifying',
};

function deriveEmptinessCause(row) {
  const rt = runtimeById.get(row.pageId);
  if (!rt || !rt.observation) return { cause: null, confidence: null, evidence: 'not applicable — page not inspected' };

  const obs = rt.observation;
  const hasDataSurface = obs.tableCount > 0 || obs.listItems >= 3;
  const hasRecords = obs.tableRows > 0 || obs.listItems >= 3;
  const looksEmpty = row.functionalState === 'THIN' || (hasDataSurface && !hasRecords) || (!hasDataSurface && obs.controlCount <= 1);

  // BROKEN pages are a different defect class (a crash/5xx), not an
  // "emptiness" question — force-fitting them into the A-I taxonomy would
  // hide the real bug behind a fixture-shaped label.
  if (row.functionalState === 'BROKEN') {
    const detail = rt.error || (rt.pageErrors || [])[0]
      || ((rt.failedRequests || []).find((r) => r.status >= 500) ? `server error on ${(rt.failedRequests.find((r) => r.status >= 500)).path}` : 'renders an error state');
    return { cause: CAUSES.NOT_AN_EMPTINESS_CASE, confidence: 'MEASURED', evidence: detail };
  }

  if (!looksEmpty) return { cause: null, confidence: null, evidence: 'not applicable — page has meaningful rendered content' };

  const denied = obs.stateSignals?.denied || (rt.failedRequests || []).some((r) => r.status === 401 || r.status === 403);
  if (denied) {
    const req = (rt.failedRequests || []).find((r) => r.status === 401 || r.status === 403);
    return { cause: CAUSES.PERMISSION_SCOPE, confidence: 'MEASURED', evidence: req ? `${req.status} on ${req.path}` : 'page rendered a denied/forbidden state' };
  }

  const notFound = (rt.failedRequests || []).find((r) => r.status === 404);
  if (notFound) return { cause: CAUSES.WRONG_ENDPOINT, confidence: 'MEASURED', evidence: `404 on ${notFound.path}` };

  const clientError = (rt.failedRequests || []).find((r) => r.status >= 400 && r.status < 500);
  if (clientError) return { cause: CAUSES.MISSING_CONTEXT, confidence: 'MEASURED', evidence: `${clientError.status} on ${clientError.path} — request rejected, likely missing a required parameter` };

  const sharedCount = sourceCounts.get(row.rendererSource) || 1;
  const looksGeneric = sharedCount >= 4 && obs.textLength < 250 && obs.controlCount <= 2;
  if (looksGeneric) return { cause: CAUSES.GENERIC_SHELL, confidence: 'INFERRED', evidence: `renderer source shared by ${sharedCount} primary pages, and this instance renders almost nothing page-specific (${obs.textLength} chars, ${obs.controlCount} controls)` };

  if (!row.canonicalApi && obs.controlCount <= 1 && !hasDataSurface) {
    return { cause: CAUSES.NO_DOMAIN_IMPL, confidence: 'INFERRED', evidence: 'no discoverable canonical API and no rendered data surface or actions — nothing to point a fixture at' };
  }

  if (row.pageArchetype === 'DETAIL/READ' && obs.controlCount === 0 && !hasDataSurface && obs.textLength < 200) {
    return { cause: CAUSES.MISSING_CONTEXT, confidence: 'INFERRED', evidence: 'detail-shaped page with no records and no controls — likely opened without a selected parent record in this review fixture' };
  }

  if (hasDataSurface && !hasRecords && !(rt.consoleErrors || []).length && !(rt.failedRequests || []).length) {
    return {
      cause: `${CAUSES.NO_FIXTURE_DATA} — most likely (A), but could be (B); no runtime signal distinguishes them`,
      confidence: 'INFERRED',
      evidence: `table/list surface renders but 0 rows, no console errors, no failed requests — either the Golden Workshop Dataset never seeded this resource, or 0 is genuinely this page's correct state; needs one owner/product judgment call, not another automated pass`,
    };
  }

  return {
    cause: CAUSES.NO_DOMAIN_IMPL,
    confidence: 'INFERRED',
    evidence: `${obs.controlCount} controls, ${obs.textLength} chars rendered, no error signal — thin with no clear technical cause found; treat as unproven until reviewed`,
  };
}

function recommendDisposition(causeResult, row) {
  if (!causeResult.cause) return row.functionalState === 'STRONG' || row.functionalState === 'USABLE' ? 'KEEP_PRIMARY' : null;
  const c = causeResult.cause;
  if (c === CAUSES.NOT_AN_EMPTINESS_CASE) return 'FIX_CONNECTION — resolve the crash/server error first, re-run product:inspect-pages, re-classify';
  if (c === CAUSES.PERMISSION_SCOPE) return 'FIX_FIXTURE — grant the review sysadmin role/company scope this page needs, or confirm the restriction is intentional';
  if (c === CAUSES.WRONG_ENDPOINT) return 'FIX_CONNECTION — UI is calling a path that does not exist server-side';
  if (c === CAUSES.MISSING_CONTEXT) return 'STRENGTHEN — page needs a guarded empty-state or a required-context guard rather than a raw failed request';
  if (c === CAUSES.GENERIC_SHELL) return 'STRENGTHEN or CONSOLIDATE — confirm this page has page-specific value beyond the shared template, else fold into a sibling';
  if (c === CAUSES.NO_DOMAIN_IMPL) return 'DEFER — no implementation to seed a fixture against yet';
  if (c.startsWith(CAUSES.NOT_A_REAL_PAGE)) return 'MOVE_TO_TAB or HIDE';
  if (c.startsWith('A —') || c.includes('most likely (A)')) return 'FIX_FIXTURE — extend the Golden Workshop Dataset to cover this resource, then re-inspect';
  return 'DEFER — needs owner review';
}

const rows = ledger.rows.map((row) => {
  const causeResult = deriveEmptinessCause(row);
  const disposition = recommendDisposition(causeResult, row);
  const rt = runtimeById.get(row.pageId);
  const p0 = row.reviewPriority === 'P0' || row.reviewPriority === 'P1';
  return {
    ...row,
    emptinessCause: causeResult.cause,
    emptinessCauseConfidence: causeResult.confidence,
    emptinessCauseEvidence: causeResult.evidence,
    recommendedDisposition: disposition,
    whatUserAccomplishes: row.businessPurpose && row.actionsAvailable
      ? `${row.labelEn}: ${row.businessPurpose.split('—')[0].trim()} — available here: ${row.actionsAvailable === 'none rendered' ? 'no actions currently rendered' : row.actionsAvailable}${row.downstreamWorkflow && !row.downstreamWorkflow.startsWith('none') && !row.downstreamWorkflow.startsWith('NOT_OBSERVED') ? `, then hands off to ${row.downstreamWorkflow}` : ''}.`
      : null,
    actionPersistenceEvidence: row.focusedFunctionalBlocker
      ? `VERIFIED_FAILURE_BY_FOCUSED_FUNCTIONAL_TEST — ${row.focusedFunctionalBlocker.test}: ${row.focusedFunctionalBlocker.proof}`
      : row.focusedFunctionalEvidence
      ? `VERIFIED_BY_FOCUSED_FUNCTIONAL_TEST — ${row.focusedFunctionalEvidence.test}: ${row.focusedFunctionalEvidence.proof}`
      : rt?.observation?.resolved
      ? (p0
        ? 'NOT_MEASURED — scripts/product/inspect-pages.mjs is read-only by design (never clicks a page\'s own action buttons); this P0/P1 page needs coverage in test:functional-pages before any action can be called proven to persist'
        : 'NOT_MEASURED — read-only runtime inspection only; no automated proof an action here writes data')
      : 'NOT_OBSERVED',
  };
});

const emptinessCounts = rows.reduce((acc, row) => {
  if (!row.emptinessCause) return acc;
  const key = row.emptinessCause.split(' — ')[0].split(' (')[0].trim();
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const dispositionCounts = rows.reduce((acc, row) => {
  if (!row.recommendedDisposition) return acc;
  const key = row.recommendedDisposition.split(' — ')[0].split(' or ')[0].trim();
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const output = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/product/build-reality-ledger.mjs',
  builtOn: `docs/product/PAGE_FUNCTIONAL_LEDGER.json (${ledger.generatedAt})`,
  note: 'This is a derivation pass over the existing functional ledger, not a re-inspection. Root-cause fields are heuristic where marked INFERRED; treat those as a starting hypothesis for owner review, not a proven fact.',
  totalPrimaryPages: rows.length,
  emptinessCauseCounts: emptinessCounts,
  recommendedDispositionCounts: dispositionCounts,
  rows,
};
fs.writeFileSync(P('docs', 'product', 'PAGE_REALITY_LEDGER.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
const clip = (value, max) => { const text = cell(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

const md = [];
md.push('# Page Reality Ledger');
md.push('');
md.push('Generated by `scripts/product/build-reality-ledger.mjs` — do not hand-edit.');
md.push(`Built on docs/product/PAGE_FUNCTIONAL_LEDGER.json (generated ${ledger.generatedAt}).`);
md.push('');
md.push('This file adds two things the functional ledger deliberately left out:');
md.push('**why** a thin/broken/zero-record page looks that way (an A-I root-cause taxonomy),');
md.push('and what to **do** about it. Every cause is labelled MEASURED (traced to a concrete');
md.push('runtime signal — a denied state, a 4xx/5xx, a null canonical API) or INFERRED (a');
md.push('heuristic guess for the cases where no runtime signal distinguishes "nobody seeded');
md.push('this resource" from "zero is correct" — those need one owner judgment call, not');
md.push('another automated pass).');
md.push('');
md.push('**Action-persistence evidence, stated plainly**: the read-only inspection proves no button');
md.push('write. Focused browser/domain tests may add either a verified persistence result or a');
md.push('verified failure; every remaining row says `NOT_MEASURED` rather than implying proof that');
md.push('was never gathered — see `actionPersistenceEvidence`.');
md.push('');
md.push('## Emptiness cause distribution (THIN/BROKEN pages and zero-record surfaces only)');
md.push('');
md.push('| Cause | Pages |');
md.push('|---|---|');
Object.entries(emptinessCounts).sort((a, b) => b[1] - a[1]).forEach(([cause, count]) => md.push(`| ${cause} | ${count} |`));
md.push('');
md.push('## Recommended disposition distribution');
md.push('');
md.push('| Disposition | Pages |');
md.push('|---|---|');
Object.entries(dispositionCounts).sort((a, b) => b[1] - a[1]).forEach(([d, count]) => md.push(`| ${d} | ${count} |`));
md.push('');

const flagged = rows.filter((row) => row.emptinessCause);
md.push(`## Pages with a classified cause (${flagged.length} of ${rows.length})`);
md.push('');
md.push('| Page | Priority | Functional | Cause | Confidence | Evidence | Disposition |');
md.push('|---|---|---|---|---|---|---|');
flagged
  .sort((a, b) => (a.reviewPriority || '').localeCompare(b.reviewPriority || '') || a.pageId.localeCompare(b.pageId))
  .forEach((row) => {
    md.push(`| \`${row.pageId}\` | ${cell(row.reviewPriority)} | ${cell(row.functionalState)} | ${clip(row.emptinessCause, 70)} | ${cell(row.emptinessCauseConfidence)} | ${clip(row.emptinessCauseEvidence, 90)} | ${clip(row.recommendedDisposition, 60)} |`);
  });
md.push('');
fs.writeFileSync(P('docs', 'product', 'PAGE_REALITY_LEDGER.md'), `${md.join('\n')}\n`, 'utf8');

console.log(`Reality ledger: ${rows.length} pages, ${flagged.length} with a classified cause -> docs/product/PAGE_REALITY_LEDGER.{json,md}`);
console.log(`  causes: ${JSON.stringify(emptinessCounts)}`);
console.log(`  dispositions: ${JSON.stringify(dispositionCounts)}`);
