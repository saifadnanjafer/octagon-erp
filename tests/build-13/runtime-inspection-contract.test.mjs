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
const fleetSource = fs.readFileSync(path.join(repoRoot, 'modules', 'fleet.js'), 'utf8');
const subscriptionsSource = fs.readFileSync(path.join(repoRoot, 'modules', 'subscriptions.js'), 'utf8');
const enterpriseSuiteSource = fs.readFileSync(path.join(repoRoot, 'modules', 'enterprise-suite.js'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const financeViews = ['receipt.html', 'income.html', 'finance.html', 'expenses.html', 'customers.html', 'cashbox.html']
  .map((file) => fs.readFileSync(path.join(repoRoot, 'views', file), 'utf8'))
  .join('\n');

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

test('Fleet does not expose controls that claim to load or reload demo operations', () => {
  assert.doesNotMatch(fleetSource, /flLoadDemo|Load Demo Data|Reload Mock Demo Data/);
  assert.match(fleetSource, /flSaveVehicle/);
  assert.match(fleetSource, /flLogFuel/);
  assert.match(fleetSource, /flLogTrip/);
});

test('Subscriptions does not seed commercial plans, customers, or invoices as demo data', () => {
  assert.doesNotMatch(subscriptionsSource, /subLoadDemo|sub_demo|cust_demo_|بيانات تجريبية/);
  assert.match(subscriptionsSource, /subSavePlan/);
  assert.match(subscriptionsSource, /subGenerateInvoice/);
});

test('Enterprise Suite accepts operator-provided bank and contract inputs without demo seeders', () => {
  assert.doesNotMatch(enterpriseSuiteSource, /entLoadDemo|entLoadMockBankStatement|entUploadMockContract|doc_create_mock/);
  assert.match(enterpriseSuiteSource, /entHandleReconCsvUpload/);
  assert.match(enterpriseSuiteSource, /accept="\.csv,text\/csv"/);
  assert.match(enterpriseSuiteSource, /entHandleDmsContractFile/);
  assert.match(enterpriseSuiteSource, /entOpenDmsContractImport/);
  assert.match(enterpriseSuiteSource, /doc_create_upload/);
});

test('P0 finance pages do not append fabricated cash movements or customers', () => {
  assert.doesNotMatch(appSource, /function addFinanceDemoData/);
  assert.doesNotMatch(financeViews, /addFinanceDemoData|إضافة أمثلة تجريبية|إضافة بيانات تجريبية/);
  assert.match(appSource, /function addFinanceTransaction/);
  assert.match(appSource, /function openCashboxTransactionModal/);
});
