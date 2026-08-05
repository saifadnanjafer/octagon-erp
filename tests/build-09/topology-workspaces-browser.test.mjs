import assert from 'node:assert/strict';
import test from 'node:test';
import { openBuild09Browser } from './browser-harness.mjs';

const MODULES = ['build09r-shared.js', 'build09-topology-workspace.js'];

test('real Chromium creates a warehouse-scoped zone and Inventory-backed bin profile', async (t) => {
  const { consoleErrors, dialect, page, seed } = await openBuild09Browser(t, { name: 'topology-ui', initialPage: 'warehouse_topology', extraModules: MODULES });
  const topologyHost = '[data-build09-page="warehouse_topology"]';
  await page.waitForSelector(`${topologyHost} [data-role="topology-zone-form"]`, { timeout: 15000 });
  await page.type(`${topologyHost} [name="code"]`, 'A-01');
  await page.type(`${topologyHost} [name="name"]`, 'Primary Storage');
  await page.click(`${topologyHost} [data-role="topology-zone-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => [...document.querySelectorAll(`${selector} [data-role="topology-zones"] .b09r-card`)]
    .some((node) => node.textContent.includes('A-01')) || !!document.querySelector(`${selector} [data-role="topology-alert"]`), { timeout: 15000 }, topologyHost);
  const zoneAlert = await page.$(`${topologyHost} [data-role="topology-alert"]`);
  assert.equal(zoneAlert, null, zoneAlert ? await zoneAlert.evaluate((node) => node.textContent) : '');
  const zone = dialect.prepare('SELECT * FROM wms_zones WHERE code=?').get('A-01');
  assert.equal(zone.warehouse_id, seed.warehouse.id);

  await page.evaluate(() => window.switchPage('zone_bin_management'));
  const binHost = '[data-build09-page="zone_bin_management"]';
  await page.waitForSelector(`${binHost} [data-role="bins-location-form"]`, { timeout: 15000 });
  await page.type(`${binHost} [name="location_code"]`, 'A-01-01');
  await page.type(`${binHost} [name="name"]`, 'Primary bin');
  await page.select(`${binHost} [name="zone_id"]`, zone.id);
  await page.$eval(`${binHost} [name="capacity_units"]`, (node) => { node.value = ''; });
  await page.type(`${binHost} [name="capacity_units"]`, '40');
  await page.click(`${binHost} [data-role="bins-location-form"] button[type="submit"]`);
  await page.waitForFunction((selector) => [...document.querySelectorAll(selector)].some((node) => node.textContent.includes('A-01-01')), { timeout: 15000 }, `${binHost} [data-role="topology-locations"] .b09r-card`);
  const profile = dialect.prepare('SELECT * FROM wms_location_profiles WHERE location_code=?').get('A-01-01');
  assert.equal(profile.warehouse_id, seed.warehouse.id);
  assert.equal(profile.zone_id, zone.id);
  assert.equal(Number(profile.capacity_units), 40);
  assert.equal(consoleErrors.filter((message) => !/403|409/.test(message)).length, 0, consoleErrors.join('\n'));
});
