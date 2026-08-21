import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'product', 'inspect-pages.mjs'), 'utf8');
const build12Source = fs.readFileSync(path.join(repoRoot, 'modules', 'build12-workspaces.js'), 'utf8');
const build10BoardsSource = fs.readFileSync(path.join(repoRoot, 'modules', 'build10', 'renderers', 'boards.js'), 'utf8');
const build10WorkspacesSource = fs.readFileSync(path.join(repoRoot, 'modules', 'build10-workspaces.js'), 'utf8');
const budgetingSource = fs.readFileSync(path.join(repoRoot, 'modules', 'budgeting.js'), 'utf8');

test('runtime page inspection waits for the authenticated warehouse context before navigation', () => {
  assert.match(source, /async function waitForReviewRuntimeContext\(page, timeout = 15000\)/);
  assert.match(source, /context\?\.ready && context\.userId && context\.companyId && context\.warehouseId/);
  const reload = source.indexOf("await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });");
  const readiness = source.indexOf('await waitForReviewRuntimeContext(page);');
  const navigation = source.indexOf('for (const item of planned)');
  assert.ok(reload >= 0 && readiness > reload && navigation > readiness, 'wait must occur after reload and before any page navigation');
});

test('runtime page inspection gives governed workspaces time to hydrate after activation', () => {
  assert.match(source, /await sleep\(activated \? 1250 : 250\);/);
  assert.match(source, /Their observed local range is\s*\/\/ 100–1200 ms/);
});

test('runtime page inspection recognises BUILD-09 governed list rows as data surfaces', () => {
  assert.match(source, /\.b09r-pool-row/);
  assert.match(source, /\.b09r-queue-row/);
  assert.match(source, /\.b09r-tree-row/);
  assert.match(source, /new Set\(\[\.\.\.host\.querySelectorAll/);
  assert.match(source, /governedRecordItems/);
  assert.match(source, /\.b09r-card/);
  assert.match(source, /\.b09r-downtime-row/);
});

test('governed Build-12 tables present serialized policy metadata as labelled values', () => {
  assert.match(build12Source, /const displayValue = \(value\) =>/);
  assert.match(build12Source, /JSON\.parse\(candidate\)/);
  assert.match(build12Source, /key\.replaceAll\('_', ' '\)/);
  assert.match(build12Source, /const text = \(v\) => esc\(displayValue\(v\)\);/);
});

test('large-screen boards do not present illustrative values as live operational facts', () => {
  assert.match(build10BoardsSource, /Live metric not verified; open the governed source\./);
  assert.match(build10BoardsSource, /value: '—'/);
  assert.match(build10BoardsSource, /onclick="switchPage\('\$\{c\.target\}'\)"/);
  for (const destination of ['device_health_center', 'pick_task_queue', 'shopfloor_terminal', 'device_alerts']) {
    assert.match(build10BoardsSource, new RegExp(destination));
  }
  assert.match(build10WorkspacesSource, /root\.Build10BoardsRenderer\.render\(pageKey, null, isRtl, readOnly\)/);
  assert.doesNotMatch(build10WorkspacesSource, /<h3>Active Assets<\/h3>/);
  assert.doesNotMatch(build10WorkspacesSource, /<div class="b10-board-metric">142<\/div>/);
});

test('P0 budgeting does not offer fabricated budget lines as operational data', () => {
  assert.doesNotMatch(budgetingSource, /bgLoadDemo|budget_demo|بيانات تجريبية/);
  assert.match(budgetingSource, /bgSaveLine/);
  assert.match(budgetingSource, /getFinanceTransactions/);
});
