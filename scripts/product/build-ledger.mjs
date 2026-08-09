#!/usr/bin/env node
/*
 * Page Consolidation & Functional Depth — functional ledger + overlap matrix.
 *
 * Joins four evidence sources, none of which is sufficient alone:
 *   1. docs/navigation/NAVIGATION_FORENSIC_REPORT.json — the canonical primary
 *      page registry (mechanical: domain, sidebar group, permission, renderer).
 *   2. docs/review/PAGE_INVENTORY.json — statically-derived business purpose,
 *      intended roles, key visible actions, review priority (P0..P3).
 *   3. docs/product/PAGE_RUNTIME_INSPECTION.json — what each page ACTUALLY
 *      renders and requests in real Chromium (scripts/product/inspect-pages.mjs).
 *   4. docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json —
 *      terminal navigation state per page.
 *
 * Every qualitative field is DERIVED FROM A MEASURED SIGNAL and carries the
 * evidence that produced it, so a reader can disagree with a classification by
 * pointing at the number behind it rather than at an opinion. Where a source is
 * missing, the field says so explicitly instead of guessing.
 *
 * Outputs:
 *   docs/product/PAGE_FUNCTIONAL_LEDGER.json
 *   docs/product/PAGE_FUNCTIONAL_LEDGER.md
 *   docs/product/PAGE_OVERLAP_MATRIX.md
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

const forensic = readJson(P('docs', 'navigation', 'NAVIGATION_FORENSIC_REPORT.json'));
const inventory = readJson(P('docs', 'review', 'PAGE_INVENTORY.json'), []);
const runtime = readJson(P('docs', 'product', 'PAGE_RUNTIME_INSPECTION.json'));
const clickAudit = readJson(P('docs', 'autopilot', 'evidence', 'NAVIGATION-RECOVERY-1-click-audit-all.json'));

if (!forensic) throw new Error('NAVIGATION_FORENSIC_REPORT.json is required');

const inventoryById = new Map(inventory.map((entry) => [entry.pageId, entry]));
const runtimeById = new Map((runtime?.pages || []).map((entry) => [entry.id, entry]));
const clickById = new Map((clickAudit?.items || []).map((entry) => [entry.id, entry]));
const primary = forensic.items.filter((item) => item.visibleInPrimaryNavigation);

const UNKNOWN = 'NOT_OBSERVED (runtime inspection missing — run scripts/product/inspect-pages.mjs)';

/* ---------------------------------------------------------------------------
 * Archetype: what KIND of workspace this is. Derived from the balance of
 * rendered surfaces, because the same source file can render very differently
 * once real data lands.
 * ------------------------------------------------------------------------- */
function deriveArchetype(observation) {
  if (!observation?.resolved) return UNKNOWN;
  const { tableCount, tableRows, listItems, inputCount, controlCount, textLength } = observation;
  if (tableCount > 0 && tableRows > 0) return 'LIST/REGISTER';
  if (tableCount > 0) return 'LIST/REGISTER (currently empty)';
  if (inputCount >= 5) return 'FORM/ENTRY';
  if (listItems >= 6 && controlCount >= 2) return 'BOARD/QUEUE';
  if (/\d/.test(observation.title || '') || (controlCount <= 3 && textLength > 400 && listItems >= 3)) return 'DASHBOARD/SUMMARY';
  if (controlCount >= 3) return 'ACTION WORKSPACE';
  if (textLength > 200) return 'DETAIL/READ';
  return 'MINIMAL';
}

/* ---------------------------------------------------------------------------
 * Functional state — does the page actually DO its job?
 * Ordered most-severe first; the first matching rule wins and its reason is
 * recorded so the score is always explainable.
 * ------------------------------------------------------------------------- */
function deriveFunctionalState(entry) {
  const observation = entry.observation;
  const reasons = [];
  // A page that was never inspected is UNKNOWN, not broken. Conflating the two
  // would let a missing evidence run masquerade as 231 real defects.
  if (!entry.inspected) return { state: 'NOT_OBSERVED', reasons: ['runtime inspection missing — run scripts/product/inspect-pages.mjs'] };
  if (entry.error) return { state: 'BROKEN', reasons: [`navigation failed: ${entry.error}`] };
  if (!observation?.resolved) return { state: 'BROKEN', reasons: ['no active page host resolved after navigation'] };
  if ((entry.pageErrors || []).length) return { state: 'BROKEN', reasons: [`uncaught page error: ${entry.pageErrors[0]}`] };
  const serverErrors = (entry.failedRequests || []).filter((request) => request.status >= 500);
  if (serverErrors.length) return { state: 'BROKEN', reasons: [`server error ${serverErrors[0].status} on ${serverErrors[0].path}`] };

  const { textLength, controlCount, tableCount, tableRows, listItems, inputCount, searchInputCount, linkTargets, stateSignals } = observation;
  const hasData = tableRows > 0 || listItems >= 3;
  const hasDataSurface = tableCount > 0 || listItems >= 3;
  const hasActions = controlCount >= 1;

  if (stateSignals.error && textLength < 300) return { state: 'BROKEN', reasons: ['renders an error state with almost no content'] };
  if (textLength < 200 && !hasActions && !hasDataSurface) return { state: 'THIN', reasons: [`almost no rendered content (${textLength} chars, ${controlCount} controls, no data surface)`] };

  if (controlCount <= 1 && !hasDataSurface) { reasons.push(`only ${controlCount} control(s) and no data surface`); return { state: 'THIN', reasons }; }
  if (!hasActions && hasDataSurface) { reasons.push('shows data but exposes no action'); return { state: 'THIN', reasons }; }

  const strong = controlCount >= 3 && hasDataSurface && (searchInputCount > 0 || inputCount > 0 || linkTargets.length > 0);
  if (strong && hasData) { reasons.push(`${controlCount} controls, ${tableRows || listItems} rendered records, ${linkTargets.length} workflow link(s)`); return { state: 'STRONG', reasons }; }
  if (strong) { reasons.push(`${controlCount} controls and filters present, but no records rendered in the review fixture`); return { state: 'USABLE', reasons }; }
  reasons.push(`${controlCount} controls, ${tableRows || listItems} records, ${linkTargets.length} link(s)`);
  return { state: 'USABLE', reasons };
}

/* ---------------------------------------------------------------------------
 * Usability state — can a user TELL what to do here? A page can be perfectly
 * functional and still be confusing (raw ids, no title, no next step).
 * ------------------------------------------------------------------------- */
function deriveUsabilityState(entry, functionalState) {
  const observation = entry.observation;
  if (!observation?.resolved) return { state: UNKNOWN, reasons: [] };
  const reasons = [];
  const { title, rawJson, rawIdCount, controlCount, linkTargets, arabicChars, latinChars, textLength } = observation;

  if (rawJson) reasons.push('raw JSON visible to a normal user');
  if (rawIdCount > 0) reasons.push(`${rawIdCount} raw internal identifier(s) rendered (e.g. ${(observation.rawIdSamples || []).join(', ')})`);
  if (!title) reasons.push('no rendered heading — the page does not name itself');
  if (controlCount === 0 && linkTargets.length === 0 && textLength > 200) reasons.push('dead end: content but no action and no onward workflow link');
  if (arabicChars === 0 && textLength > 200) reasons.push('no Arabic content rendered on an Arabic-first workspace');

  if (rawJson || (!title && controlCount === 0)) return { state: 'CONFUSING', reasons };
  if (reasons.length >= 2) return { state: 'CONFUSING', reasons };
  if (functionalState === 'BROKEN') return { state: 'BROKEN', reasons };
  if (functionalState === 'THIN') return { state: 'THIN', reasons: reasons.length ? reasons : ['little to act on'] };
  if (reasons.length === 1) return { state: 'USABLE', reasons };
  if (functionalState === 'STRONG') return { state: 'STRONG', reasons: ['titled, actionable, and links onward'] };
  return { state: 'USABLE', reasons: ['titled and actionable'] };
}

function isDeadEnd(entry) {
  const observation = entry.observation;
  if (!observation?.resolved) return false;
  return observation.textLength > 200 && observation.controlCount === 0 && observation.linkTargets.length === 0;
}

/* Token set for label/purpose similarity in the overlap matrix. */
const STOP = new Set(['and', 'the', 'of', 'for', 'to', 'a', 'in', 'on', 'my', 'all', 'new', 'page', 'workspace', 'management', 'إدارة', 'ال', 'في', 'من']);
function tokens(...values) {
  return new Set(values.filter(Boolean).join(' ').toLowerCase()
    .replace(/[^a-z0-9؀-ۿ ]+/g, ' ').split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token)));
}
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((value) => { if (b.has(value)) shared += 1; });
  return shared / (a.size + b.size - shared);
};

// PAGE_INVENTORY's primaryPurpose is templated:
//   "Wave Planning — warehouse/ops (risk: medium, phase: build-09)"
// Tokenizing the whole string makes every warehouse page look ~0.78 similar to
// every other warehouse page, which drowns real duplicates in lifecycle pairs
// (wave_planning/wave_execution, mps/mps_proposals) that are legitimately
// distinct steps. Only the functional category between the dash and the
// parenthesis carries signal, and it is a category — compared by equality, not
// by token overlap.
function purposeCategory(purpose) {
  if (!purpose) return null;
  const match = /—\s*([^(]+)/.exec(purpose);
  return match ? match[1].trim().toLowerCase() : null;
}

const rows = primary.map((item) => {
  const inv = inventoryById.get(item.id) || {};
  const rt = runtimeById.has(item.id) ? { ...runtimeById.get(item.id), inspected: true } : { inspected: false };
  const click = clickById.get(item.id) || {};
  const observation = rt.observation;
  const functional = deriveFunctionalState(rt);
  const usability = deriveUsabilityState(rt, functional.state);

  const observedActions = observation?.controlLabels?.length
    ? observation.controlLabels.join(' | ')
    : (observation?.resolved ? 'none rendered' : UNKNOWN);

  return {
    pageId: item.id,
    labelAr: item.labelAr,
    labelEn: item.labelEn,
    domain: item.topLevelSection,
    sidebarGroup: item.sidebarGroup,
    reviewPriority: inv.reviewPriority || 'UNCLASSIFIED',
    reviewPriorityReason: inv.reviewPriorityReason || null,
    roles: inv.intendedRoles || item.supportedRoles || null,
    permission: item.requiredPermission || null,
    entitlement: item.requiredEntitlement || null,
    rendererType: item.rendererType,
    rendererSource: item.rendererSource,

    businessPurpose: inv.primaryPurpose || null,
    owningDomain: inv.moduleDomain || item.businessDomain,
    canonicalApi: inv.canonicalApi && !/not discoverable/i.test(inv.canonicalApi) ? inv.canonicalApi : null,
    observedEndpoints: (rt.failedRequests || []).map((request) => request.path),

    pageArchetype: deriveArchetype(observation),
    observedTitle: observation?.title || null,
    actionsAvailable: observedActions,
    actionsDeclaredStatic: inv.keyVisibleActions || null,
    upstreamWorkflow: null,
    downstreamWorkflow: observation?.linkTargets?.length ? observation.linkTargets.join(', ') : (observation?.resolved ? 'none — no onward workflow link rendered' : UNKNOWN),

    functionalState: functional.state,
    functionalEvidence: functional.reasons.join('; '),
    usabilityState: usability.state,
    usabilityEvidence: usability.reasons.join('; '),
    deadEnd: isDeadEnd(rt),

    measured: observation?.resolved ? {
      textLength: observation.textLength,
      controls: observation.controlCount,
      inputs: observation.inputCount,
      searchInputs: observation.searchInputCount,
      tables: observation.tableCount,
      tableRows: observation.tableRows,
      listItems: observation.listItems,
      links: observation.linkTargets.length,
      states: observation.stateSignals,
      rawIds: observation.rawIdCount,
      rawJson: observation.rawJson,
      arabicChars: observation.arabicChars,
      latinChars: observation.latinChars,
    } : null,
    runtimeConsoleErrors: (rt.consoleErrors || []).length,
    runtimeFailedRequests: (rt.failedRequests || []).length,
    navigationStatus: click.status || null,

    consolidationRecommendation: null,
    canonicalDestination: null,
    consolidationRationale: null,
  };
});

/* ---------------------------------------------------------------------------
 * Upstream links are the inverse of the observed downstream links.
 * ------------------------------------------------------------------------- */
const upstream = new Map();
rows.forEach((row) => {
  const observation = runtimeById.get(row.pageId)?.observation;
  (observation?.linkTargets || []).forEach((target) => {
    if (!upstream.has(target)) upstream.set(target, new Set());
    upstream.get(target).add(row.pageId);
  });
});
rows.forEach((row) => {
  const sources = upstream.get(row.pageId);
  row.upstreamWorkflow = sources && sources.size
    ? [...sources].join(', ')
    : (row.measured ? 'none — no other workspace links here' : UNKNOWN);
});

/* ---------------------------------------------------------------------------
 * Overlap matrix. Two pages overlap when they serve the same domain AND their
 * purpose/label vocabulary converges. Classification is intentionally
 * conservative: only near-identical pairs are proposed for consolidation, and
 * NOTHING is auto-merged — this file is input to an owner decision.
 * ------------------------------------------------------------------------- */
const pairs = [];
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i];
    const b = rows[j];
    if (a.domain !== b.domain) continue;
    const labelSimilarity = jaccard(tokens(a.labelEn, a.labelAr), tokens(b.labelEn, b.labelAr));
    const categoryA = purposeCategory(a.businessPurpose);
    const sameCategory = Boolean(categoryA) && categoryA === purposeCategory(b.businessPurpose);
    const sameGroup = a.sidebarGroup === b.sidebarGroup;
    const sameArchetype = a.pageArchetype === b.pageArchetype;
    const score = (labelSimilarity * 0.6) + (sameCategory ? 0.15 : 0) + (sameGroup ? 0.15 : 0) + (sameArchetype ? 0.1 : 0);
    if (score < 0.34) continue;
    let klass = 'C — RELATED, KEEP SEPARATE';
    if (labelSimilarity >= 0.6 && sameGroup && sameCategory) klass = 'A — NEAR-DUPLICATE, CONSOLIDATION CANDIDATE';
    else if (score >= 0.55) klass = 'B — OVERLAPPING, REVIEW';
    pairs.push({
      a: a.pageId, b: b.pageId, domain: a.domain, sameGroup, klass,
      labelSimilarity: Number(labelSimilarity.toFixed(2)),
      purposeSimilarity: sameCategory ? 'same category' : 'different',
      score: Number(score.toFixed(2)),
      aState: `${a.functionalState}/${a.usabilityState}`,
      bState: `${b.functionalState}/${b.usabilityState}`,
    });
  }
}
pairs.sort((x, y) => y.score - x.score);

/* --------------------------------- output -------------------------------- */
const domainCounts = {};
rows.forEach((row) => { domainCounts[row.domain] = (domainCounts[row.domain] || 0) + 1; });
const stateCounts = (key) => rows.reduce((acc, row) => { acc[row[key]] = (acc[row[key]] || 0) + 1; return acc; }, {});

const ledger = {
  generatedAt: new Date().toISOString(),
  generator: 'scripts/product/build-ledger.mjs',
  sources: {
    registry: 'docs/navigation/NAVIGATION_FORENSIC_REPORT.json',
    staticInventory: 'docs/review/PAGE_INVENTORY.json',
    runtimeInspection: runtime ? `docs/product/PAGE_RUNTIME_INSPECTION.json (${runtime.generatedAt})` : 'MISSING',
    clickAudit: clickAudit ? `docs/autopilot/evidence/NAVIGATION-RECOVERY-1-click-audit-all.json (${clickAudit.generatedAt})` : 'MISSING',
  },
  totalPrimaryPages: rows.length,
  domainCounts,
  functionalStateCounts: stateCounts('functionalState'),
  usabilityStateCounts: stateCounts('usabilityState'),
  priorityCounts: stateCounts('reviewPriority'),
  deadEndCount: rows.filter((row) => row.deadEnd).length,
  rows,
};
fs.writeFileSync(P('docs', 'product', 'PAGE_FUNCTIONAL_LEDGER.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');

const cell = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim() || '—';
const clip = (value, max) => { const text = cell(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

const md = [];
md.push('# Page Functional Ledger');
md.push('');
md.push(`Generated by \`scripts/product/build-ledger.mjs\` — do not hand-edit. Regenerate after re-running the runtime inspection.`);
md.push('');
md.push(`- Canonical primary workspaces: **${rows.length}**`);
md.push(`- Runtime inspection: ${ledger.sources.runtimeInspection}`);
md.push(`- Dead-end pages (content, but no action and no onward link): **${ledger.deadEndCount}**`);
md.push('');
md.push('Every qualitative column is derived from a measured runtime signal, and the');
md.push('measurement that produced it is shown in the evidence column, so a');
md.push('classification can be challenged with a number rather than an opinion.');
md.push('');
md.push('## Functional state distribution');
md.push('');
md.push('| State | Pages |');
md.push('|---|---|');
Object.entries(ledger.functionalStateCounts).sort((a, b) => b[1] - a[1]).forEach(([state, count]) => md.push(`| ${state} | ${count} |`));
md.push('');
md.push('## Usability state distribution');
md.push('');
md.push('| State | Pages |');
md.push('|---|---|');
Object.entries(ledger.usabilityStateCounts).sort((a, b) => b[1] - a[1]).forEach(([state, count]) => md.push(`| ${state} | ${count} |`));
md.push('');

const priorityOrder = ['P0', 'P1', 'P2', 'P3', 'UNCLASSIFIED'];
for (const priority of priorityOrder) {
  const group = rows.filter((row) => row.reviewPriority === priority)
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.pageId.localeCompare(b.pageId));
  if (!group.length) continue;
  md.push(`## ${priority} (${group.length} pages)`);
  md.push('');
  md.push('| Page | Label (EN) | Domain | Purpose | Archetype | Actions available | Missing / evidence | Upstream | Downstream | Functional | Usability | Consolidation |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of group) {
    md.push(`| \`${row.pageId}\` | ${clip(row.labelEn, 40)} | ${cell(row.domain)} | ${clip(row.businessPurpose, 70)} | ${cell(row.pageArchetype)} | ${clip(row.actionsAvailable, 90)} | ${clip([row.functionalEvidence, row.usabilityEvidence].filter(Boolean).join(' · '), 110)} | ${clip(row.upstreamWorkflow, 45)} | ${clip(row.downstreamWorkflow, 45)} | ${cell(row.functionalState)} | ${cell(row.usabilityState)} | ${cell(row.consolidationRecommendation || 'RETAIN')} |`);
  }
  md.push('');
}
fs.writeFileSync(P('docs', 'product', 'PAGE_FUNCTIONAL_LEDGER.md'), `${md.join('\n')}\n`, 'utf8');

const om = [];
om.push('# Page Overlap Matrix');
om.push('');
om.push('Generated by `scripts/product/build-ledger.mjs`. **Nothing here has been merged or deleted.**');
om.push('This file is the input to an owner consolidation decision.');
om.push('');
om.push('Pairs are scored only within the same top-level domain, combining label-vocabulary');
om.push('similarity (0.6), same functional purpose category (0.15), same sidebar group (0.15)');
om.push('and same rendered archetype (0.1). Only pairs scoring ≥ 0.34 are listed.');
om.push('');
om.push('Purpose is compared by CATEGORY equality rather than token overlap: the inventory\'s');
om.push('`primaryPurpose` is templated, so token overlap made every warehouse page look ~0.78');
om.push('similar to every other one and buried real duplicates under lifecycle pairs');
om.push('(`wave_planning`/`wave_execution`, `mps`/`mps_proposals`) that are distinct steps.');
om.push('');
om.push('- **A — near-duplicate**: consolidation candidate (same group, same category, ≥0.6 label similarity).');
om.push('- **B — overlapping**: needs review; likely a tab/alias relationship rather than two destinations.');
om.push('- **C — related**: genuinely distinct business objects that merely share vocabulary. Keep separate.');
om.push('');
const classCounts = pairs.reduce((acc, pair) => { acc[pair.klass] = (acc[pair.klass] || 0) + 1; return acc; }, {});
om.push('| Class | Pairs |');
om.push('|---|---|');
Object.entries(classCounts).sort().forEach(([klass, count]) => om.push(`| ${klass} | ${count} |`));
om.push('');
om.push(`Total scored pairs: **${pairs.length}**`);
om.push('');
om.push('| Class | Page A | Page B | Domain | Same group | Label sim | Purpose sim | Score | A state | B state |');
om.push('|---|---|---|---|---|---|---|---|---|---|');
pairs.forEach((pair) => {
  om.push(`| ${pair.klass.split(' —')[0]} | \`${pair.a}\` | \`${pair.b}\` | ${pair.domain} | ${pair.sameGroup ? 'yes' : 'no'} | ${pair.labelSimilarity} | ${pair.purposeSimilarity} | ${pair.score} | ${pair.aState} | ${pair.bState} |`);
});
om.push('');
fs.writeFileSync(P('docs', 'product', 'PAGE_OVERLAP_MATRIX.md'), `${om.join('\n')}\n`, 'utf8');

console.log(`Ledger:  ${rows.length} pages -> docs/product/PAGE_FUNCTIONAL_LEDGER.{json,md}`);
console.log(`         functional ${JSON.stringify(ledger.functionalStateCounts)}`);
console.log(`         usability  ${JSON.stringify(ledger.usabilityStateCounts)}`);
console.log(`         dead ends  ${ledger.deadEndCount}`);
console.log(`Overlap: ${pairs.length} scored pairs -> docs/product/PAGE_OVERLAP_MATRIX.md ${JSON.stringify(classCounts)}`);
