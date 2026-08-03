import assert from 'node:assert/strict';
import test from 'node:test';
import { openBuild09Browser } from './browser-harness.mjs';

// Real Chromium flow 1 (runtime context): proves the fix in modules/octagon-runtime-context.js
// end to end in a live browser — auto-selection of the single accessible warehouse, the
// warehouse reaching the DOM <select> (the bug this session found and fixed), preference
// persistence across a reload, and stale-preference recovery when the saved id is no longer valid.
test('real Chromium resolves company/warehouse context, persists and recovers warehouse preference', async (t) => {
  const { consoleErrors, page, seed } = await openBuild09Browser(t, { name: 'runtime', initialPage: 'warehouse_topology' });

  const snapshot = await page.evaluate(() => window.OctagonRuntimeContext.snapshot());
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.companyId, seed.companyId);
  assert.equal(snapshot.warehouseId, seed.warehouse.id, 'the single accessible warehouse should auto-select');

  const warehouseSelectValue = await page.$eval('[data-build09-page="warehouse_topology"] [data-role="warehouse"]', (el) => el.value);
  assert.equal(warehouseSelectValue, seed.warehouse.id, 'the warehouse <select> in the DOM should reflect the runtime context, not stay empty');

  // Auto-selection of the sole warehouse is implicit (it re-derives every refresh) and
  // intentionally does not touch localStorage; only an explicit user selection is a "preference".
  await page.evaluate((id) => window.OctagonRuntimeContext.setWarehouse(id), seed.warehouse.id);
  const storedPreference = await page.evaluate(() => localStorage.getItem('octagon_active_warehouse_id'));
  assert.equal(storedPreference, seed.warehouse.id, 'an explicit setWarehouse() call should persist the preference');

  await page.evaluate(() => localStorage.setItem('octagon_active_warehouse_id', 'wh_does_not_exist'));
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction((pageId) => document.querySelector(`[data-build09-page="${pageId}"]`)?.classList.contains('page-active'), {}, 'warehouse_topology');
  const recovered = await page.evaluate(() => window.OctagonRuntimeContext.snapshot());
  assert.equal(recovered.warehouseId, seed.warehouse.id, 'an invalid saved preference must be discarded and recovered to a real accessible warehouse, not left dangling');
  const clearedInvalidPreference = await page.evaluate(() => localStorage.getItem('octagon_active_warehouse_id'));
  assert.notEqual(clearedInvalidPreference, 'wh_does_not_exist', 'the invalid preference must be removed from localStorage, not just ignored in memory');

  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
