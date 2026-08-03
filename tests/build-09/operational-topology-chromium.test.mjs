import assert from 'node:assert/strict';
import test from 'node:test';
import { openBuild09Browser } from './browser-harness.mjs';

// Real Chromium flow 2 (topology): unlike operational-browser-chromium.test.mjs, this
// drives the actual governed action-form dialog (real clicks, real field names, real
// governed lookup search) instead of calling POST /api/v1/action/:id directly — proving
// the modules/build09-action-forms.js registry (and its governed lookups) actually work
// end to end, not just that their source text matches a pattern.
test('real Chromium creates a zone and a location through the governed dialog forms', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'topology', initialPage: 'warehouse_topology' });

  await page.waitForSelector('[data-build09-page="warehouse_topology"] [data-action="wms:zone_create"]:not([disabled])', { timeout: 15000 });
  await page.click('[data-build09-page="warehouse_topology"] [data-action="wms:zone_create"]');
  await page.waitForSelector('#build09ActionDialog[open] #b09f-code', { timeout: 5000 });
  await page.type('#b09f-code', 'TESTZONE');
  await page.type('#b09f-name', 'Test Zone Alpha');
  await page.select('#b09f-zone_type', 'storage');
  await page.click('#build09ActionDialog [data-command="submit"]');
  await page.waitForFunction(() => !document.getElementById('build09ActionDialog').open, { timeout: 10000 });

  const zoneRow = dialect.prepare('SELECT id, code, name, zone_type FROM wms_zones WHERE company_id=? AND warehouse_id=? AND code=?').get(seed.companyId, seed.warehouse.id, 'TESTZONE');
  assert.ok(zoneRow, 'zone was not created in the database');
  assert.equal(zoneRow.name, 'Test Zone Alpha');
  assert.equal(zoneRow.zone_type, 'storage');

  await page.click('[data-build09-page="warehouse_topology"] [data-action="wms:location_create"]');
  await page.waitForSelector('#build09ActionDialog[open] #b09f-location_code', { timeout: 5000 });
  await page.type('#b09f-location_code', 'TESTLOC');
  await page.type('#b09f-name', 'Test Location Alpha');
  await page.select('#b09f-location_type', 'bin');
  await page.type('#build09ActionDialog [data-lookup-resource="zones"] .b09-lookup-query', 'TESTZONE');
  await page.waitForFunction(() => {
    const zoneSelect = document.querySelector('#build09ActionDialog [data-lookup-resource="zones"] .b09-lookup-select');
    return zoneSelect && zoneSelect.options.length > 1;
  }, { timeout: 5000 });
  await page.select('#build09ActionDialog [data-lookup-resource="zones"] .b09-lookup-select', zoneRow.id);
  await page.click('#build09ActionDialog [data-command="submit"]');
  await page.waitForFunction(() => !document.getElementById('build09ActionDialog').open, { timeout: 10000 });

  const locationRow = dialect.prepare('SELECT location_id, location_code, zone_id, location_type FROM wms_location_profiles WHERE company_id=? AND warehouse_id=? AND location_code=?').get(seed.companyId, seed.warehouse.id, 'TESTLOC');
  assert.ok(locationRow, 'location was not created in the database');
  assert.equal(locationRow.zone_id, zoneRow.id, 'location was not linked to the zone selected via the governed lookup');
  assert.equal(locationRow.location_type, 'bin');

  await page.evaluate(() => window.switchPage('zone_bin_management'));
  await page.waitForFunction(() => document.querySelector('[data-build09-page="zone_bin_management"] tbody tr[data-record-id]'), { timeout: 10000 });

  assert.equal(consoleErrors.length, 0, consoleErrors.join('\n'));
});
