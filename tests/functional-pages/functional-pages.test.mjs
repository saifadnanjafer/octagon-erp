// Product Recovery 1 — functional page acceptance.
//
// Distinct from tests/navigation (proves a page ACTIVATES) and
// tests/page-consolidation (proves a demoted page stays reachable): this
// proves a retained P0/P1 primary workspace is actually USABLE — meaningful
// content or a documented, evidence-backed reason it isn't yet, not merely
// "the page opened without throwing."
//
// Deliberately browser-free, same reasoning as
// tests/page-consolidation/consolidation-contract.test.mjs: it asserts on
// the generated ledgers (docs/product/PAGE_REALITY_LEDGER.json,
// PAGE_RUNTIME_ERROR_LEDGER.json), which are themselves derived from a real
// Chromium runtime inspection (scripts/product/inspect-pages.mjs). Re-run
// `npm run product:inspect-pages && npm run product:ledger && npm run
// product:reality-ledger && npm run product:runtime-error-ledger` before
// this suite if source code changed — it is a regression gate over the
// ledger snapshot, not a live re-inspection on every run (that lives in
// scripts/product/inspect-pages.mjs itself, which needs a running review
// server and is comparatively slow).
//
// What this suite does NOT prove: that a button click persists data.
// scripts/product/inspect-pages.mjs is read-only by design (never clicks a
// page's own action buttons), so no ledger-derived test can claim that.
// Each retained P0/P1 row's actionPersistenceEvidence field says so
// explicitly, and this suite asserts that field is present and honest
// rather than silently absent -- see the "documents its persistence gap"
// test below.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const P = (...parts) => path.join(root, ...parts);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const realityPath = P('docs', 'product', 'PAGE_REALITY_LEDGER.json');
const errorLedgerPath = P('docs', 'product', 'PAGE_RUNTIME_ERROR_LEDGER.json');

test('docs/product/PAGE_REALITY_LEDGER.json exists (run npm run product:reality-ledger)', () => {
  assert.ok(fs.existsSync(realityPath), `missing ${path.relative(root, realityPath)} — run product:inspect-pages, product:ledger, then product:reality-ledger`);
});

const reality = fs.existsSync(realityPath) ? readJson(realityPath) : null;
const errorLedger = fs.existsSync(errorLedgerPath) ? readJson(errorLedgerPath) : null;

const p0p1 = (reality?.rows || []).filter((row) => row.reviewPriority === 'P0' || row.reviewPriority === 'P1');

test('every P0/P1 page was actually inspected', { skip: !reality }, () => {
  const notObserved = p0p1.filter((row) => row.functionalState === 'NOT_OBSERVED');
  assert.deepEqual(
    notObserved.map((row) => row.pageId),
    [],
    'P0/P1 pages missing runtime evidence — re-run npm run product:inspect-pages',
  );
});

test('no P0/P1 page is BROKEN', { skip: !reality }, () => {
  const broken = p0p1.filter((row) => row.functionalState === 'BROKEN');
  assert.deepEqual(
    broken.map((row) => `${row.pageId}: ${row.functionalEvidence}`),
    [],
    'a retained P0/P1 workspace is crashing or erroring on load — see docs/product/PAGE_REALITY_LEDGER.md',
  );
});

test('every THIN P0/P1 page has a recorded, non-BROKEN emptiness cause (not silently unexplained)', { skip: !reality }, () => {
  const unexplained = p0p1.filter((row) => row.functionalState === 'THIN' && !row.emptinessCause);
  assert.deepEqual(
    unexplained.map((row) => row.pageId),
    [],
    'a THIN P0/P1 page has no recorded root cause — the reality-ledger classifier should always produce one for THIN states; investigate scripts/product/build-reality-ledger.mjs',
  );
});

test('every retained (KEEP_PRIMARY) P0/P1 page documents its action-persistence gap rather than omitting it', { skip: !reality }, () => {
  const retained = p0p1.filter((row) => (row.recommendedDisposition || '').startsWith('KEEP_PRIMARY'));
  const undocumented = retained.filter((row) => !row.actionPersistenceEvidence);
  assert.deepEqual(
    undocumented.map((row) => row.pageId),
    [],
    'a retained P0/P1 page has no actionPersistenceEvidence field — this suite must never let a page silently imply proof of persistence it does not have',
  );
});

test('no CLIENT_CONTRACT_BUG / BROKEN_ENDPOINT / SERVER_ERROR signature remains unresolved on a retained P0/P1 page', { skip: !errorLedger }, () => {
  const unresolved = (errorLedger?.needsFix || []).filter((row) => ['CLIENT_CONTRACT_BUG', 'BROKEN_ENDPOINT', 'SERVER_ERROR', 'UNHANDLED_EXCEPTION'].includes(row.category));
  assert.deepEqual(
    unresolved.map((row) => `${row.category}: ${row.signature} (${row.retainedP0P1Pages.join(', ')})`),
    [],
    'a real bug (not an expected-auth/fixture-gap) is hitting a retained P0/P1 page — see docs/product/PAGE_RUNTIME_ERROR_LEDGER.md',
  );
});

test('P0/P1 page count is stable (page-count guard)', { skip: !reality }, () => {
  // Not a hardcoded target -- a sanity floor. This recovery pass explicitly
  // forbids arbitrary new primary pages; a large unexplained jump here is a
  // signal to check docs/product/PAGE_DISPOSITION_REPORT.md, not to raise
  // this number to make the test pass.
  assert.ok(p0p1.length >= 40 && p0p1.length <= 80, `P0/P1 count ${p0p1.length} moved outside the expected 40-80 range -- confirm this is an intentional, evidence-backed change`);
});
