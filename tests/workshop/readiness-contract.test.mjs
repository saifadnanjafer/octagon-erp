import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Readiness shell route, view, page map, and manager permission are complete', () => {
  const html = read('index.html');
  const app = read('app.js');
  const permissions = read('services/permissionService.js');
  const view = read('views/workshop_readiness.html');
  assert.equal((html.match(/data-page="workshop_readiness"/g) || []).length, 1);
  assert.match(html, /view:workshop_readiness/);
  assert.match(app, /workshop_readiness:\s*'pageWorkshopReadiness'/);
  assert.match(app, /renderWorkshopReadiness/);
  assert.match(permissions, /workshop_readiness:\s*\['workshop\.manager',\s*'system\.admin'\]/);
  assert.match(view, /id="workshopReadinessFormula"/);
});

test('Readiness browser visibly renders formula, states, canonical links, and zero-mutation policy', () => {
  const module = read('modules/workshop-readiness.js');
  const view = read('views/workshop_readiness.html');
  assert.match(module, /formula\.expression/);
  assert.match(module, /formula\.exclusions/);
  assert.match(module, /PERMISSION_DENIED/);
  assert.match(module, /WorkshopShell\.navigate/);
  assert.match(view, /Zero-mutation policy/i);
  assert.doesNotMatch(module, /OctagonApiClient\.post|fetch\([^)]*method:\s*['"]POST/);
});

test('Readiness server catalog contains all required state labels and category identifiers', () => {
  const catalog = read('platform/workshop/readiness-catalog.mjs');
  for (const state of ['READY','WARNING','MISSING','BLOCKED','OPTIONAL','PERMISSION_DENIED','NOT_SUPPORTED']) assert.match(catalog, new RegExp(`['"]${state}['"]`));
  for (const category of ['organization','users','products','warehouse','production','quality','delivery','maintenance_fleet','devices','governance']) assert.match(catalog, new RegExp(`id: ['"]${category}['"]`));
});

test('all three internal workshop pages remain unique in the shell manifest', () => {
  const html = read('index.html');
  for (const page of ['workshop_command_center','my_work','workshop_readiness']) {
    assert.equal((html.match(new RegExp(`data-page="${page}"`, 'g')) || []).length, 1);
    assert.equal((html.match(new RegExp(`view:${page}`, 'g')) || []).length, 1);
  }
});

