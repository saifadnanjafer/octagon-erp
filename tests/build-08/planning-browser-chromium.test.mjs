import assert from 'node:assert/strict';
import test from 'node:test';
import { browserAction, browserQuery, openBuild08Browser } from './browser-harness.mjs';

test('real Chromium completes forecast override publication and MPS proposal approval', async (t) => {
  const fixture = await openBuild08Browser(t, { name: 'planning', companyId: 'company-a', initialPage: 'forecast_versions' });
  const { authority, consoleErrors, ctx, page } = fixture;
  const horizon = authority.forecastingService.createHorizon({ name: 'Browser horizon', startDate: '2027-01-01', endDate: '2027-03-31', frozenUntil: '2027-01-14', planningFenceUntil: '2027-02-01' }, ctx);
  const snapshot = authority.forecastingService.snapshotHistory({
    horizonId: horizon.id,
    idempotencyKey: 'browser-history',
    lines: [20, 30, 40].map((quantity, index) => ({ productId: 'browser-product', bucketStart: `2026-1${index}-01`, quantity, sourceReference: `sale-${index}` }))
  }, ctx);

  const version = await browserAction(page, 'forecast:version_create', { horizonId: horizon.id, snapshotId: snapshot.id, name: 'Browser consensus', method: 'moving_average', parameters: { window: 3, targetBucket: '2027-01-08' }, assumptions: ['Chromium acceptance'] });
  const calculated = await browserAction(page, 'forecast:calculate', { version_id: version.id });
  assert.equal(calculated.status, 'calculated');
  const override = await browserAction(page, 'forecast:override_submit', { versionId: version.id, lineId: calculated.lines[0].id, quantity: 42, reason: 'Confirmed browser workflow demand' });
  assert.equal((await browserAction(page, 'forecast:override_approve', { override_id: override.id })).status, 'approved');
  assert.equal((await browserAction(page, 'forecast:publish', { version_id: version.id })).status, 'published');

  const run = await browserAction(page, 'mps:run', {
    horizonId: horizon.id, forecastVersionId: version.id, idempotencyKey: 'browser-mps',
    facts: [{ productId: 'browser-product', bucketStart: '*', beginningInventory: 5, confirmedDemand: 20, safetyStock: 8, scheduledReceipts: 0, openProduction: 0, capacityPerUnit: 1, capacityAvailable: 100, supplyType: 'production' }]
  });
  assert.equal(run.proposals.length, 1);
  assert.equal((await browserAction(page, 'mps:proposal_approve', { proposal_id: run.proposals[0].id, reason: 'Browser capacity review accepted' })).status, 'approved');

  await page.evaluate(async () => { await window.ensurePageTemplateLoaded('mps_proposals'); window.switchPage('mps_proposals'); });
  await page.waitForFunction(() => document.querySelector('[data-build08-page="mps_proposals"] tbody tr[data-record-id]'));
  const visibleProposal = await page.$eval('[data-build08-page="mps_proposals"] tbody', (element) => element.textContent);
  assert.match(visibleProposal, /approved/i);
  assert.equal((await browserQuery(page, 'planning/forecasts')).length, 1);
  assert.equal((await browserQuery(page, 'mps/proposals')).length, 1);

  await page.setViewport({ width: 390, height: 844 });
  const mobileLayout = await page.$eval('[data-build08-page="mps_proposals"] .b08-table td', (element) => getComputedStyle(element).display);
  assert.equal(mobileLayout, 'grid');
  await page.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; window.OctagonBuild08.renderPage('mps_proposals'); });
  assert.equal(await page.$eval('html', (element) => element.dir), 'ltr');
  await page.evaluate(() => { window.__BUILD08_FORCE_READ_ONLY__ = true; window.OctagonBuild08.renderPage('mps_proposals'); });
  assert.ok(await page.$eval('[data-build08-page="mps_proposals"] [data-action-id]', (button) => button.disabled));
  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
