import assert from 'node:assert/strict';
import test from 'node:test';
import { openBuild09Browser } from './browser-harness.mjs';

const PAGE_IDS = [
  'warehouse_topology', 'zone_bin_management', 'putaway_rules', 'putaway_task_queue',
  'replenishment_rules', 'replenishment_proposals', 'mobile_receiving', 'receiving_discrepancies',
  'mobile_picking', 'pick_task_queue', 'wave_planning', 'wave_execution',
  'cycle_count_plans', 'count_session', 'variance_review', 'dock_schedule',
  'dock_checkin', 'staging_board', 'crossdock_workspace', 'lot_serial_traceability',
  'expiration_queue', 'recall_analysis', 'shopfloor_terminal', 'workcenter_queue',
  'production_material_requests', 'production_issue_return', 'production_receipt', 'quality_hold_queue',
  'rework_workspace', 'scrap_approval', 'downtime_board', 'operational_performance',
];

// Real Chromium 32-page matrix: for every BUILD-09 page, navigation activates it, the
// runtime-context-derived warehouse select is populated (not empty - the bug this whole arc
// started from), the query settles to a real terminal phase (not stuck 'loading'), and no
// page produces a severe console error. This does not assert every page has rows - most of
// this disposable database's domains have no seeded records, so 'empty' is the honest,
// correct, and expected terminal state for them (see section 13 "honest states"); the point
// is that no page crashes, hangs, or silently shows nothing without explanation.
test('real Chromium activates all 32 BUILD-09 pages with a populated scope and no console errors', async (t) => {
  const { consoleErrors, page, seed } = await openBuild09Browser(t, { name: 'matrix', initialPage: PAGE_IDS[0] });

  const results = [];
  for (const pageId of PAGE_IDS) {
    const errorsBefore = consoleErrors.length;
    await page.evaluate((id) => window.switchPage(id), pageId);
    await page.waitForFunction((id) => document.querySelector(`[data-build09-page="${id}"]`)?.classList.contains('page-active'), {}, pageId);
    await page.waitForFunction((id) => {
      const status = document.querySelector(`[data-build09-page="${id}"] [data-role="status"]`);
      return status && status.dataset.phase !== 'loading' && status.dataset.phase !== 'idle';
    }, { timeout: 10000 }, pageId);
    const state = await page.evaluate((id) => {
      const host = document.querySelector(`[data-build09-page="${id}"]`);
      return {
        warehouseSelectValue: host.querySelector('[data-role="warehouse"]').value,
        warehouseOptionCount: host.querySelector('[data-role="warehouse"]').options.length,
        phase: host.querySelector('[data-role="status"]').dataset.phase,
        statusText: host.querySelector('[data-role="status"]').textContent,
      };
    }, pageId);
    results.push({ pageId, ...state, newConsoleErrors: consoleErrors.slice(errorsBefore) });
  }

  const brokenWarehouseScope = results.filter((r) => r.warehouseOptionCount <= 1);
  assert.deepEqual(brokenWarehouseScope.map((r) => r.pageId), [], `these pages did not get a populated warehouse select (the original "same warehouse error on every page" bug): ${JSON.stringify(brokenWarehouseScope.map((r) => r.pageId))}`);

  const crashedPages = results.filter((r) => r.phase === 'error');
  assert.deepEqual(crashedPages.map((r) => `${r.pageId}: ${r.statusText}`), [], 'these pages reached an unexpected error phase instead of ready/empty/denied');

  const pagesWithConsoleErrors = results.filter((r) => r.newConsoleErrors.length > 0);
  assert.deepEqual(pagesWithConsoleErrors.map((r) => `${r.pageId}: ${r.newConsoleErrors.join(' | ')}`), [], 'these pages produced a console error during activation');

  assert.equal(results.length, 32, `expected exactly 32 pages in the matrix, walked ${results.length}`);
});
