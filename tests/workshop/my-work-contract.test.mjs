import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('My Work shell route, view, page map, and permission map are complete', () => {
  const html = read('index.html');
  const app = read('app.js');
  const permissions = read('services/permissionService.js');
  const view = read('views/my_work.html');
  assert.equal((html.match(/data-page="my_work"/g) || []).length, 1);
  assert.match(html, /view:my_work/);
  assert.match(app, /my_work:\s*'pageMyWork'/);
  assert.match(app, /renderMyWork/);
  assert.match(permissions, /my_work:\s*\['workshop\.user'/);
  assert.match(view, /id="pageMyWork"/);
  assert.match(view, /id="myWorkFilters"/);
});

test('My Work browser supports required daily views, filters, mobile cards, and saved views', () => {
  const source = read('modules/workshop-my-work.js');
  const css = read('modules/workshop-operations.css');
  for (const view of ['assigned','waiting','approvals','today','overdue','blocked','recent']) assert.match(source, new RegExp(`['"]${view}['"]`));
  for (const filter of ['task_family','status','priority','due','warehouse_id']) assert.match(source, new RegExp(filter));
  assert.match(source, /platform\/saved-views\?entity=work_item/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*\.my-work-item/);
});

test('My Work server sources use actual assignee columns and active scopes', () => {
  const sources = read('platform/workshop/my-work-sources.mjs');
  const domain = read('platform/workshop/my-work.mjs');
  assert.match(sources, /assigned_user_id=\?/);
  assert.match(sources, /assigned_to=\?/);
  assert.match(sources, /operator_id=\?/);
  assert.match(domain, /actor filter cannot exceed signed-in actor scope/);
  assert.match(domain, /companyId/);
  assert.doesNotMatch(domain, /assume|infer.*assign/i);
});

