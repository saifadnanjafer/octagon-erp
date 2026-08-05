import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('production material workspaces use only registered governed contracts', () => {
  const ui = read('modules/build09-production-material-workspaces.js');
  const handlers = read('platform/manufacturing/index.mjs');
  const permissions = read('database/migrations/079_build09_shopfloor_material_performance.mjs');
  const lookups = read('modules/octagon-governed-lookups.js');
  const actions = [...ui.matchAll(/api\.call\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(actions)].sort(), [
    'shopfloor:material_acknowledge', 'shopfloor:material_approve', 'shopfloor:material_availability',
    'shopfloor:material_request', 'shopfloor:material_request_canonical',
  ]);
  for (const action of actions) {
    assert.match(handlers, new RegExp(`'${action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `${action} needs a handler`);
  }
  for (const permission of ['shopfloor:material:request', 'shopfloor:material:approve', 'shopfloor:material:issue']) assert.match(permissions, new RegExp(permission));
  for (const resource of ['productionOrders', 'workOrders', 'products', 'locations']) assert.match(lookups, new RegExp(`${resource}:`));
  for (const field of ['production_order_id', 'work_order_id', 'product_id', 'source_location_id', 'destination_location_id', 'requested_quantity', 'request_type', 'request_id', 'canonical_result_id']) assert.match(ui, new RegExp(field));
  assert.doesNotMatch(ui, /throw new Error\(t\('Enter the canonical/);
  assert.doesNotMatch(ui, /JSON\.parse|<textarea[^>]*json/i);
});

test('all three production material overrides remain distinct and registered', () => {
  const ui = read('modules/build09-production-material-workspaces.js');
  for (const page of ['production_material_requests', 'production_issue_return', 'production_receipt']) {
    assert.match(ui, new RegExp(`pageId:\\s*'${page}'`));
    assert.ok(ui.includes(`registerOverride('${page}'`));
  }
  assert.match(read('index.html'), /modules\/build09-production-material-workspaces\.js/);
});
