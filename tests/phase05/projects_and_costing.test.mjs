import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock,
  accountBalance, unbalancedEntries, CTX, approverCtx,
} from './helpers.mjs';
import { projects, costing, reports } from '../../platform/projects/index.mjs';
import { FROZEN_COLLECTIONS, assertNotFrozen, frozenZoneDigest } from '../../platform/kernel/domain/kit.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let material;
let customer;
let role;

before(async () => {
  fx = await buildFixture('projects');
  accounts = seedAccounts(fx.db);
  unit = seedUnit(fx.db);
  warehouse = fx.execute('warehouse:create', { name: 'Main', code: 'MAIN' }, 'wh');
  supplier = fx.execute('stock:location:create', { name: 'Supplier', usage: 'supplier' }, 'sup');
  fx.execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.laborAbsorption,
    overhead_absorption_account_id: accounts.overheadAbsorption,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'mapping');

  customer = fx.execute('party:create', { name: 'Basra Steel Works', party_type: 'customer' }, 'cust');
  material = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Cable Reel', sku: 'RM-CABLE', unitId: unit.id, categoryName: 'Project materials',
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: material.variantId,
    unitId: unit.id, quantity: 500, unitCost: 12, key: 'cable',
  });

  role = fx.db.prepare(`
    INSERT INTO project_roles (id, company_id, code, name, standard_cost_per_hour, standard_bill_per_hour, currency, created_at)
    VALUES ('prjrole_eng', ?, 'ENG', 'Engineer', 20, 45, 'IQD', ?) RETURNING *
  `).get(CTX.companyId, new Date().toISOString());
});

after(() => teardown(fx));

function activeProject(key, extra = {}) {
  const project = fx.execute('project:create', {
    name: `Project ${key}`, customer_party_id: customer.id,
    contract_value: 100_000, billing_method: 'milestone', ...extra,
  }, `prj-${key}`);
  fx.execute('project:approve', { project_id: project.id }, `prj-${key}-approve`);
  fx.execute('project:activate', { project_id: project.id }, `prj-${key}-activate`);
  return project;
}

test('project work is a canonical Work Item and no project task table exists', () => {
  const project = activeProject('workitems');
  const phase = fx.execute('project:phase:create', { project_id: project.id, name: 'Site survey' }, 'phase-1');

  const item = fx.execute('project:work_item:create', {
    project_id: project.id, title: 'Survey the substation', phase_id: phase.id,
    estimated_hours: 12, priority: 'high',
  }, 'wi-1');

  assert.equal(item.source_type, 'project');
  assert.equal(item.project_ref, project.id);
  assert.equal(item.source_line_id, phase.id);

  const tables = fx.db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND name IN ('project_tasks', 'project_task', 'projects_tasks')
  `).all();
  assert.deepEqual(tables, [], 'projects must contribute a dimension, not a second task table');

  const loaded = projects.getProject(fx.db, project.id, CTX.companyId);
  assert.equal(loaded.work_items.length, 1);
  assert.equal(loaded.work_items[0].id, item.id);
});

test('a budget cannot be approved by the person who created it, and one revision supersedes the last', () => {
  const project = activeProject('budget');
  const budget = fx.execute('project:budget:create', {
    project_id: project.id,
    lines: [
      { cost_type: 'labor', amount: 30_000, description: 'Engineering' },
      { cost_type: 'material', amount: 40_000, description: 'Cable' },
    ],
  }, 'budget-1');
  assert.equal(budget.total_amount, 70_000);
  assert.equal(budget.status, 'draft');

  assert.throws(
    () => fx.execute('project:budget:approve', { budget_id: budget.id }, 'budget-1-self'),
    /cannot be approved by the person who created it/,
  );

  const approved = fx.executor.execute('project:budget:approve', {
    budget_id: budget.id, idempotency_key: 'budget-1-approve',
  }, approverCtx());
  assert.equal(approved.status, 'approved');

  const revision = fx.execute('project:budget:revise', {
    budget_id: budget.id,
    lines: [
      { cost_type: 'labor', amount: 35_000 },
      { cost_type: 'material', amount: 40_000 },
    ],
  }, 'budget-2');
  assert.equal(revision.revision, 2);
  fx.executor.execute('project:budget:approve', {
    budget_id: revision.id, idempotency_key: 'budget-2-approve',
  }, approverCtx());

  assert.equal(costing.getBudget(fx.db, budget.id, CTX.companyId).status, 'superseded');
  assert.equal(costing.approvedBudget(fx.db, CTX.companyId, project.id).id, revision.id);
});

test('a commitment beyond the approved budget is refused when budget control is on', () => {
  const project = activeProject('control');
  const budget = fx.execute('project:budget:create', {
    project_id: project.id, lines: [{ cost_type: 'material', amount: 1_000 }],
  }, 'control-budget');
  fx.executor.execute('project:budget:approve', {
    budget_id: budget.id, idempotency_key: 'control-budget-approve',
  }, approverCtx());

  const first = fx.execute('project:commitment:record', {
    project_id: project.id, amount: 600, commitment_type: 'purchase_order', enforce_budget: true,
  }, 'commit-1');
  assert.equal(first.status, 'open');

  assert.throws(
    () => fx.execute('project:commitment:record', {
      project_id: project.id, amount: 500, commitment_type: 'purchase_order', enforce_budget: true,
    }, 'commit-2'),
    /would exceed the approved budget/,
  );

  const control = costing.budgetControl(fx.db, CTX.companyId, project.id);
  assert.equal(control.budget_amount, 1_000);
  assert.equal(control.open_commitments, 600);
  assert.equal(control.remaining, 400);

  const released = fx.execute('project:commitment:release', { commitment_id: first.id, amount: 600 }, 'commit-release');
  assert.equal(released.status, 'released');
  assert.equal(costing.budgetControl(fx.db, CTX.companyId, project.id).open_commitments, 0);
});

test('project labour cost uses a project rate and never reads payroll data', () => {
  const project = activeProject('labour');
  fx.execute('project:member:assign', {
    project_id: project.id, member_ref: 'emp-114', role_id: role.id,
  }, 'member-1');

  const effort = fx.execute('project:effort:record', {
    project_id: project.id, member_ref: 'emp-114', hours: 8,
    labor_cost_account_id: accounts.projectLabour,
    labor_absorption_account_id: accounts.payrollClearing,
  }, 'effort-1');

  assert.equal(effort.cost_rate_per_hour, 20, 'the rate came from the project role');
  assert.equal(effort.bill_rate_per_hour, 45);
  assert.equal(effort.amount, 160);
  assert.equal(effort.payroll_touched, false);
  assert.ok(effort.finance_document_id, 'labour cost posts through the Phase 03 pipeline');

  // A member with no role and no explicit rate fails closed rather than
  // reaching for a payroll figure.
  assert.throws(
    () => fx.execute('project:effort:record', {
      project_id: project.id, member_ref: 'emp-999', hours: 3,
    }, 'effort-norate'),
    /never reads payroll data/,
  );
});

test('the frozen-zone guard fires rather than merely existing', () => {
  const project = activeProject('frozen');
  for (const collection of FROZEN_COLLECTIONS) {
    assert.throws(() => assertNotFrozen(collection), /FROZEN|read-only/i, `${collection} must be refused`);
  }
  assert.throws(
    () => fx.execute('project:effort:record', {
      project_id: project.id, member_ref: 'emp-1', hours: 1,
      cost_rate_per_hour: 10, source_collection: 'employee_payroll_closings',
    }, 'effort-frozen'),
    /read-only/,
  );

  // Phase 05 created none of the frozen tables.
  const digest = frozenZoneDigest(fx.db);
  for (const collection of FROZEN_COLLECTIONS) {
    assert.equal(digest[collection].present, false, `${collection} must not exist as a Phase 05 table`);
  }
});

test('project material issue moves canonical stock and records the project cost', () => {
  const project = activeProject('material');
  const inventoryBefore = accountBalance(fx.db, accounts.inventory);

  const issued = fx.execute('project:material:issue', {
    project_id: project.id, product_id: material.variantId, quantity: 10,
    warehouse_id: warehouse.id,
  }, 'prj-material');

  assert.equal(issued.quantity, 10);
  assert.equal(issued.value, 120, '10 reels at 12.00');
  assert.ok(issued.stock_move_id);
  assert.ok(issued.finance_document_id);
  assert.equal(accountBalance(fx.db, accounts.inventory), inventoryBefore - 120);

  const fact = fx.db.prepare('SELECT * FROM project_cost_facts WHERE id = ?').get(issued.cost_fact_id);
  assert.equal(fact.cost_type, 'material');
  assert.equal(fact.stock_move_id, issued.stock_move_id);
});

test('milestone billing posts through the finance pipeline and withholds retainage', () => {
  const project = activeProject('billing', { contract_value: 50_000, retainage_percent: 10 });
  fx.execute('project:billing_rule:set', {
    project_id: project.id, billing_method: 'milestone',
    revenue_account_id: accounts.revenue,
    receivable_account_id: accounts.receivable,
    retainage_account_id: accounts.retainage,
    retainage_percent: 10,
  }, 'rule-1');

  const milestone = fx.execute('project:milestone:create', {
    project_id: project.id, name: 'Design accepted', billing_amount: 20_000, is_billable: true,
  }, 'ms-1');

  assert.throws(
    () => fx.execute('project:bill', { project_id: project.id, milestone_id: milestone.id }, 'bill-early'),
    /only an achieved milestone can be billed/,
  );

  fx.execute('project:milestone:achieve', { milestone_id: milestone.id }, 'ms-1-achieve');

  const receivableBefore = accountBalance(fx.db, accounts.receivable);
  const revenueBefore = accountBalance(fx.db, accounts.revenue);
  const retainageBefore = accountBalance(fx.db, accounts.retainage);

  const billed = fx.execute('project:bill', { project_id: project.id, milestone_id: milestone.id }, 'bill-1');
  assert.equal(billed.amount, 20_000);
  assert.equal(billed.retainage_amount, 2_000);
  assert.equal(billed.receivable_amount, 18_000);
  assert.ok(billed.finance_document_id);

  assert.equal(accountBalance(fx.db, accounts.receivable), receivableBefore + 18_000);
  assert.equal(accountBalance(fx.db, accounts.retainage), retainageBefore + 2_000);
  assert.equal(accountBalance(fx.db, accounts.revenue), revenueBefore - 20_000, 'revenue is a credit balance');

  const released = fx.execute('project:retainage:release', { project_id: project.id }, 'retainage-1');
  assert.equal(released.amount, 2_000);
  assert.equal(accountBalance(fx.db, accounts.retainage), retainageBefore);
});

test('time-and-material billing bills unbilled effort exactly once', () => {
  const project = activeProject('tm', { billing_method: 'time_and_material', contract_value: 0 });
  fx.execute('project:billing_rule:set', {
    project_id: project.id, billing_method: 'time_and_material',
    revenue_account_id: accounts.revenue, receivable_account_id: accounts.receivable,
    default_bill_rate: 50,
  }, 'rule-tm');
  fx.execute('project:member:assign', { project_id: project.id, member_ref: 'emp-200', role_id: role.id }, 'member-tm');

  fx.execute('project:effort:record', { project_id: project.id, member_ref: 'emp-200', hours: 10 }, 'effort-tm-1');
  fx.execute('project:effort:record', { project_id: project.id, member_ref: 'emp-200', hours: 6 }, 'effort-tm-2');

  const billed = fx.execute('project:bill', { project_id: project.id }, 'bill-tm');
  assert.equal(billed.amount, 720, '16 hours at the 45/hour role bill rate');
  assert.equal(billed.effort_entries_billed, 2);

  assert.throws(
    () => fx.execute('project:bill', { project_id: project.id }, 'bill-tm-again'),
    /no unbilled billable effort/,
  );
});

test('progress billing bills only the newly earned portion', () => {
  const project = activeProject('progress', { billing_method: 'progress', contract_value: 40_000 });
  fx.execute('project:billing_rule:set', {
    project_id: project.id, billing_method: 'progress',
    revenue_account_id: accounts.revenue, receivable_account_id: accounts.receivable,
  }, 'rule-prog');

  const first = fx.execute('project:bill', { project_id: project.id, percent_complete: 25 }, 'bill-prog-1');
  assert.equal(first.amount, 10_000);
  const second = fx.execute('project:bill', { project_id: project.id, percent_complete: 60 }, 'bill-prog-2');
  assert.equal(second.amount, 14_000, '60% of 40,000 less the 10,000 already billed');
  assert.throws(
    () => fx.execute('project:bill', { project_id: project.id, percent_complete: 60 }, 'bill-prog-3'),
    /no new amount/,
  );
});

test('profitability, forecast at completion and cash flow are derived, not stored twice', () => {
  const project = activeProject('profit', { contract_value: 100_000 });
  const budget = fx.execute('project:budget:create', {
    project_id: project.id, lines: [{ cost_type: 'material', amount: 60_000 }],
  }, 'profit-budget');
  fx.executor.execute('project:budget:approve', {
    budget_id: budget.id, idempotency_key: 'profit-budget-approve',
  }, approverCtx());

  fx.execute('project:expense:record', {
    project_id: project.id, amount: 30_000,
    expense_account_id: accounts.expense, credit_account_id: accounts.cash,
  }, 'profit-expense');
  fx.execute('project:update', { project_id: project.id, percent_complete: 40 }, 'profit-progress');

  const report = reports.profitability(fx.db, { company_id: CTX.companyId, project_id: project.id });
  assert.equal(report.budget_amount, 60_000);
  assert.equal(report.actual_cost, 30_000);
  assert.equal(report.earned_value, 24_000, '40% of the 60,000 budget');
  assert.equal(report.cost_performance_index, 0.8, '24,000 earned for 30,000 spent');
  assert.equal(report.forecast_at_completion, 75_000, '60,000 ÷ 0.8');
  assert.equal(report.forecast_variance, -15_000, 'the project is forecast to overrun');
  assert.equal(report.margin_amount, 70_000);

  const snapshot = fx.execute('project:snapshot:profitability', { project_id: project.id }, 'profit-snapshot');
  assert.ok(snapshot.snapshot_id);
  const stored = fx.db.prepare('SELECT * FROM project_profitability_snapshots WHERE id = ?').get(snapshot.snapshot_id);
  assert.equal(stored.forecast_at_completion, 75_000);

  const cash = reports.projectCashFlow(fx.db, { company_id: CTX.companyId, project_id: project.id });
  assert.equal(cash.cost_incurred, 30_000);
  assert.equal(cash.cash_received, 0, 'nothing has been collected yet');
});

test('a project cannot be completed with open work and cannot be closed with open commitments', () => {
  const project = activeProject('close');
  const item = fx.execute('project:work_item:create', { project_id: project.id, title: 'Punch list' }, 'close-wi');
  assert.throws(
    () => fx.execute('project:complete', { project_id: project.id }, 'close-complete-early'),
    /work item\(s\) are still open/,
  );

  fx.execute('work_item:update', { id: item.id, status: 'done' }, 'close-wi-done');
  const commitment = fx.execute('project:commitment:record', {
    project_id: project.id, amount: 500, commitment_type: 'purchase_order',
  }, 'close-commit');

  fx.execute('project:complete', { project_id: project.id }, 'close-complete');
  assert.throws(
    () => fx.execute('project:close', { project_id: project.id }, 'close-close-early'),
    /commitment\(s\) are still open/,
  );

  fx.execute('project:commitment:release', { commitment_id: commitment.id }, 'close-commit-release');
  const closed = fx.execute('project:close', { project_id: project.id }, 'close-close');
  assert.equal(closed.state, 'closed');
});

test('a change order moves the contract value only after an independent approval', () => {
  const project = activeProject('change', { contract_value: 10_000 });
  const change = fx.execute('project:change_order:create', {
    project_id: project.id, title: 'Extra bay', contract_value_delta: 2_500, budget_delta: 1_800,
  }, 'co-1');

  assert.throws(
    () => fx.execute('project:change_order:approve', { change_order_id: change.id }, 'co-1-self'),
    /cannot be approved by the person who requested it/,
  );

  const approved = fx.executor.execute('project:change_order:approve', {
    change_order_id: change.id, idempotency_key: 'co-1-approve',
  }, approverCtx());
  assert.equal(approved.status, 'approved');
  assert.equal(approved.budget_revision_required, true, 'a budget delta needs its own approved revision');
  assert.equal(
    projects.getProject(fx.db, project.id, CTX.companyId).contract_value, 12_500,
  );
});

test('manufacturing cost is absorbed into a project without posting the GL a second time', () => {
  const project = activeProject('mfg');
  const finished = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Panel Assembly', sku: 'FG-PANEL', unitId: unit.id, categoryName: 'Project assemblies',
    stockAccountId: accounts.finishedGoods,
  });
  const bom = fx.execute('manufacturing:bom:create', {
    product_id: finished.variantId, quantity: 1, code: 'BOM-PANEL',
    lines: [{ product_id: material.variantId, quantity: 2 }],
  }, 'mfg-bom');
  fx.execute('manufacturing:bom:approve', { bom_id: bom.id }, 'mfg-bom-approve');

  const order = fx.execute('manufacturing:order:create', {
    product_id: finished.variantId, planned_quantity: 5,
    warehouse_id: warehouse.id, project_id: project.id,
  }, 'mfg-mo');
  fx.execute('manufacturing:order:approve', { order_id: order.id }, 'mfg-mo-approve');
  fx.execute('manufacturing:order:release', { order_id: order.id }, 'mfg-mo-release');
  fx.execute('manufacturing:material:issue', {
    order_id: order.id, product_id: material.variantId, quantity: 10,
  }, 'mfg-mo-issue');
  fx.execute('manufacturing:order:complete', { order_id: order.id, quantity: 5 }, 'mfg-mo-complete');

  const journalBefore = fx.db.prepare('SELECT COUNT(*) AS n FROM finance_journal_entries').get().n;
  const absorbed = fx.execute('project:manufacturing:absorb', {
    project_id: project.id, production_order_id: order.id,
  }, 'mfg-absorb');

  assert.equal(absorbed.amount, 120, '10 reels at 12.00 capitalised into the assembly');
  assert.equal(absorbed.gl_already_posted_by, 'manufacturing');
  assert.equal(
    fx.db.prepare('SELECT COUNT(*) AS n FROM finance_journal_entries').get().n,
    journalBefore,
    'absorbing manufacturing cost must not post a second journal entry',
  );

  assert.throws(
    () => fx.execute('project:manufacturing:absorb', {
      project_id: project.id, production_order_id: order.id,
    }, 'mfg-absorb-again'),
    /already been absorbed/,
  );
});

test('project material never lands in the manufacturing WIP account', () => {
  // Regression: projects, maintenance and fleet once shared the manufacturing
  // `production` location, which pushed their consumption into the WIP account
  // and broke the manufacturing WIP-to-GL reconciliation with value no
  // manufacturing order could ever clear.
  const project = activeProject('wipboundary');
  const wipBefore = accountBalance(fx.db, accounts.wip);

  const issued = fx.execute('project:material:issue', {
    project_id: project.id, product_id: material.variantId, quantity: 5,
    warehouse_id: warehouse.id,
  }, 'wipboundary-issue');
  assert.ok(issued.value > 0);

  assert.equal(
    accountBalance(fx.db, accounts.wip), wipBefore,
    'project material must not touch the manufacturing WIP account',
  );

  const destination = fx.db.prepare(
    'SELECT l.usage, l.name FROM stock_moves m JOIN stock_locations l ON l.id = m.location_dest_id WHERE m.id = ?',
  ).get(issued.stock_move_id);
  assert.equal(destination.usage, 'consumption');
  assert.equal(destination.name, 'Project Consumption');
});

test('every posted journal entry in the project suite balances', () => {
  assert.deepEqual(unbalancedEntries(fx.db), []);
});
