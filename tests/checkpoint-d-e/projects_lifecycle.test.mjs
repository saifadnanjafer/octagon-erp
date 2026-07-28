// Checkpoint D1 — canonical Projects lifecycle, budget, costing and billing.
//
// Every suite uses a DISPOSABLE database under os.tmpdir() (freshInstall of
// migrations 001-052). The operational database.db / database.json files in
// the repo root are never opened.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { costing, effort } from '../../platform/projects/index.mjs';

let tempDir;
let dbPath;
let db;
let executor;
let ctx;
let ikCount = 0;

function ik(prefix) {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

const execute = (actionId, input, key) => executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

function newProject(tag, overrides = {}) {
  return execute('projects:project:create', {
    name: `Project ${tag}`,
    contract_value: 100000,
    billing_method: 'milestone',
    retention_percent: 5,
    ...overrides,
  }, ik(`prj${tag}`));
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-checkpoint-d-projects-'));
  dbPath = path.join(tempDir, 'checkpoint-d-projects.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'checkpoint-d-projects-test' });
  db = openMigrationDatabase(dbPath);
  executor = createPlatformAuthority(db).actionExecutor;
  ctx = {
    tenantId: 'default',
    companyId: 'default',
    branchId: 'default',
    userId: 'checkpoint-d-projects-test',
    sourceChannel: 'node-test',
  };
  setApprovalAuthorityLimit(db, ctx, {
    role_or_user: ctx.userId,
    limit_type: 'post',
    max_amount: 1_000_000_000,
  });
});

after(() => {
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Register, structure, and status governance
// ---------------------------------------------------------------------------

test('project create assigns a sequential number and starts in draft', () => {
  const first = newProject('A');
  assert.match(first.project_number, /^PRJ-\d{5}$/);
  assert.equal(first.status, 'draft');
  assert.equal(first.company_id, 'default');

  const second = newProject('B');
  assert.notEqual(first.project_number, second.project_number);
});

test('project status transitions are governed, not free-form', () => {
  const project = newProject('C');

  // draft -> completed is not a legal transition
  assert.throws(
    () => execute('projects:project:set_status', { project_id: project.id, status: 'completed' }, ik('badC')),
    (error) => error.code === 'PROJECT_TRANSITION_INVALID',
  );

  const active = execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actC'));
  assert.equal(active.status, 'active');

  const done = execute('projects:project:set_status', { project_id: project.id, status: 'completed' }, ik('doneC'));
  assert.equal(done.status, 'completed');
});

test('a project with an unresolved critical issue cannot be completed', () => {
  const project = newProject('D');
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actD'));
  const issue = execute('projects:issue:create', {
    project_id: project.id, title: 'Structural defect', severity: 'critical',
  }, ik('issD'));

  assert.throws(
    () => execute('projects:project:set_status', { project_id: project.id, status: 'completed' }, ik('blockD')),
    (error) => error.code === 'PROJECT_HAS_OPEN_CRITICAL_ISSUES',
  );

  execute('projects:issue:resolve', { issue_id: issue.id, resolution: 'Reinforced' }, ik('resD'));
  const completed = execute('projects:project:set_status', { project_id: project.id, status: 'completed' }, ik('okD'));
  assert.equal(completed.status, 'completed');
});

test('applying a template materialises phases, milestones, and cost codes', () => {
  const template = execute('projects:template:create', {
    name: 'Fit-out',
    code: 'TPL-FITOUT',
    phases: [{ key: 'design', name: 'Design', sequence: 10 }, { key: 'build', name: 'Build', sequence: 20 }],
    milestones: [{ name: 'Design signed off', phase_key: 'design', is_billable: true, billing_amount: 20000 }],
    cost_codes: [{ code: 'MAT', name: 'Materials', cost_type: 'material' }, { code: 'LAB', name: 'Labour', cost_type: 'labor' }],
  }, ik('tpl1'));

  const project = newProject('E', { template_id: template.id });
  assert.equal(project.phases.length, 2);
  assert.equal(project.milestones.length, 1);
  assert.equal(project.cost_codes.length, 2);
  assert.equal(project.milestones[0].phase_id, project.phases.find((p) => p.name === 'Design').id);
});

// ---------------------------------------------------------------------------
// Tasks use the canonical Work Item authority — no second task table
// ---------------------------------------------------------------------------

test('project tasks are canonical work_items, not a second task table', () => {
  const project = newProject('F');
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actF'));

  const task = execute('projects:task:create', {
    project_id: project.id,
    title: 'Pour foundation',
    estimated_hours: 12,
  }, ik('taskF'));

  const row = db.prepare('SELECT * FROM work_items WHERE id = ?').get(task.id);
  assert.ok(row, 'task must be stored in the canonical work_items table');
  assert.equal(row.project_ref, project.id);
  assert.equal(row.source_type, 'project');

  // There must be no competing project task table.
  const rival = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('project_tasks','projects_tasks','project_task')",
  ).all();
  assert.equal(rival.length, 0, 'Projects must not introduce a second task authority');
});

// ---------------------------------------------------------------------------
// Budget governance
// ---------------------------------------------------------------------------

test('commitments require an approved budget line', () => {
  const project = newProject('G');
  const costCode = execute('projects:cost_code:create', {
    project_id: project.id, code: 'MAT', name: 'Materials', cost_type: 'material',
  }, ik('ccG'));
  execute('projects:budget:set_line', {
    project_id: project.id, cost_code_id: costCode.id, amount: 50000,
  }, ik('blG'));

  assert.throws(
    () => execute('projects:commitment:record', {
      project_id: project.id, cost_code_id: costCode.id, amount: 1000, source_type: 'purchase_order',
    }, ik('cmG1')),
    (error) => error.code === 'PROJECT_BUDGET_NOT_APPROVED',
  );

  execute('projects:budget:approve', { project_id: project.id }, ik('apG'));
  const commitment = execute('projects:commitment:record', {
    project_id: project.id, cost_code_id: costCode.id, amount: 1000, source_type: 'purchase_order',
  }, ik('cmG2'));
  assert.equal(commitment.state, 'open');
  assert.equal(commitment.budget_amount, 50000);
});

test('an approved budget line cannot be silently overwritten', () => {
  const project = newProject('H');
  const costCode = execute('projects:cost_code:create', {
    project_id: project.id, code: 'MAT', name: 'Materials',
  }, ik('ccH'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 10000 }, ik('blH'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apH'));

  assert.throws(
    () => execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 99999 }, ik('blH2')),
    (error) => error.code === 'PROJECT_BUDGET_ALREADY_APPROVED',
  );

  const revised = execute('projects:budget:revise', {
    project_id: project.id, cost_code_id: costCode.id, amount: 12000,
  }, ik('rvH'));
  assert.equal(revised.state, 'revised');
  assert.equal(revised.revision_no, 1);
  assert.equal(revised.approved_amount, 10000, 'the approved baseline must remain auditable');
  assert.equal(revised.revised_amount, 12000);
});

test('a budget revision cannot fall below open commitments', () => {
  const project = newProject('I');
  const costCode = execute('projects:cost_code:create', { project_id: project.id, code: 'SUB', name: 'Subcontract' }, ik('ccI'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 20000 }, ik('blI'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apI'));
  execute('projects:commitment:record', {
    project_id: project.id, cost_code_id: costCode.id, amount: 15000, source_type: 'subcontract',
  }, ik('cmI'));

  assert.throws(
    () => execute('projects:budget:revise', { project_id: project.id, cost_code_id: costCode.id, amount: 5000 }, ik('rvI')),
    (error) => error.code === 'PROJECT_BUDGET_BELOW_COMMITMENTS',
  );
});

test('a commitment cannot be over-released', () => {
  const project = newProject('J');
  const costCode = execute('projects:cost_code:create', { project_id: project.id, code: 'MAT', name: 'Materials' }, ik('ccJ'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 9000 }, ik('blJ'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apJ'));
  const commitment = execute('projects:commitment:record', {
    project_id: project.id, cost_code_id: costCode.id, amount: 3000, source_type: 'purchase_order',
  }, ik('cmJ'));

  const partial = execute('projects:commitment:release', { commitment_id: commitment.id, amount: 1000 }, ik('rlJ1'));
  assert.equal(partial.state, 'partially_released');

  assert.throws(
    () => execute('projects:commitment:release', { commitment_id: commitment.id, amount: 5000 }, ik('rlJ2')),
    (error) => error.code === 'PROJECT_COMMITMENT_OVER_RELEASE',
  );

  const full = execute('projects:commitment:release', { commitment_id: commitment.id }, ik('rlJ3'));
  assert.equal(full.state, 'released');
});

test('an approved change order revises budget and contract value through the governed path', () => {
  const project = newProject('K', { contract_value: 50000 });
  const costCode = execute('projects:cost_code:create', { project_id: project.id, code: 'MAT', name: 'Materials' }, ik('ccK'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 30000 }, ik('blK'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apK'));

  const co = execute('projects:change_order:create', {
    project_id: project.id, title: 'Extra floor', cost_impact: 5000, revenue_impact: 8000,
  }, ik('coK'));
  assert.match(co.change_number, /^CO-\d{4}$/);

  const approved = execute('projects:change_order:approve', {
    change_order_id: co.id, cost_code_id: costCode.id, reason: 'Client approved',
  }, ik('coKa'));
  assert.equal(approved.state, 'approved');
  assert.equal(approved.revised_budget_line.revised_amount, 35000);

  const refreshed = db.prepare('SELECT contract_value FROM projects WHERE id = ?').get(project.id);
  assert.equal(refreshed.contract_value, 58000);

  // A decided change order is terminal.
  assert.throws(
    () => execute('projects:change_order:approve', { change_order_id: co.id }, ik('coKb')),
    (error) => error.code === 'PROJECT_CHANGE_ORDER_CLOSED',
  );
});

// ---------------------------------------------------------------------------
// Effort — frozen-zone safety
// ---------------------------------------------------------------------------

test('effort cost comes from configured standard rates, never from payroll', () => {
  const project = newProject('L');
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actL'));

  const entry = execute('projects:effort:record', {
    project_id: project.id,
    hours: 8,
    role_key: 'engineer',
    employee_ref: 'EMP-001',
    effort_date: '2026-07-20',
  }, ik('efL'));

  assert.equal(entry.hours, 8);
  assert.equal(entry.hourly_cost, 9.0, 'engineer role rate from project_cost_rates');
  assert.equal(entry.total_cost, 72);
  assert.equal(entry.rate_source, 'role');
  assert.equal(entry.cost_basis, 'configured_standard_rate');
  assert.equal(entry.payroll_consulted, false);
});

test('effort must be anchored to a canonical execution context', () => {
  assert.throws(
    () => execute('projects:effort:record', { hours: 4, role_key: 'engineer' }, ik('efM')),
    (error) => error.code === 'PROJECT_EFFORT_UNANCHORED',
  );
});

test('frozen payroll tables are rejected fail-closed', () => {
  for (const table of effort.FROZEN_TABLES) {
    assert.throws(
      () => effort.assertNotFrozen(table),
      (error) => error.code === 'FROZEN_ZONE_WRITE_DENIED',
      `${table} must be denied`,
    );
  }
  // A non-frozen table passes.
  assert.equal(effort.assertNotFrozen('projects'), true);
});

test('the Projects module never references a frozen payroll table', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../platform/projects');
  const frozen = ['employee_payroll_closings', 'payroll_payments', 'payroll_periods', 'employee_advances'];
  for (const file of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    // Strip comments so the documented frozen-table list does not self-trip.
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const table of frozen) {
      assert.ok(
        !new RegExp(`(FROM|JOIN|INTO|UPDATE)\\s+${table}\\b`, 'i').test(code),
        `${file} must not query the frozen table ${table}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Milestones and billing
// ---------------------------------------------------------------------------

test('milestone billing requires an achieved milestone and cannot double-bill', () => {
  const project = newProject('N', { contract_value: 40000 });
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actN'));
  const milestone = execute('projects:milestone:create', {
    project_id: project.id, name: 'Phase 1 complete', is_billable: true, billing_amount: 10000,
  }, ik('msN'));

  assert.throws(
    () => execute('projects:billing:request', {
      project_id: project.id, amount: 10000, billing_method: 'milestone', milestone_id: milestone.id,
    }, ik('brN1')),
    (error) => error.code === 'PROJECT_MILESTONE_NOT_ACHIEVED',
  );

  execute('projects:milestone:achieve', { milestone_id: milestone.id }, ik('achN'));
  const request = execute('projects:billing:request', {
    project_id: project.id, amount: 10000, billing_method: 'milestone', milestone_id: milestone.id,
  }, ik('brN2'));

  assert.equal(request.state, 'draft');
  assert.equal(request.gross_amount, 10000);
  assert.equal(request.retention_percent, 5);
  assert.equal(request.retention_amount, 500);
  assert.equal(request.net_amount, 9500);

  assert.throws(
    () => execute('projects:billing:request', {
      project_id: project.id, amount: 10000, billing_method: 'milestone', milestone_id: milestone.id,
    }, ik('brN3')),
    (error) => error.code === 'PROJECT_MILESTONE_ALREADY_BILLED',
  );

  // Achieving twice is a governed denial.
  assert.throws(
    () => execute('projects:milestone:achieve', { milestone_id: milestone.id }, ik('achN2')),
    (error) => error.code === 'PROJECT_MILESTONE_ALREADY_ACHIEVED',
  );
});

test('billing cannot exceed the contract value', () => {
  const project = newProject('O', { contract_value: 5000, billing_method: 'fixed_price', retention_percent: 0 });
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actO'));
  execute('projects:billing:request', { project_id: project.id, amount: 4000, billing_method: 'fixed_price' }, ik('brO1'));

  assert.throws(
    () => execute('projects:billing:request', { project_id: project.id, amount: 2000, billing_method: 'fixed_price' }, ik('brO2')),
    (error) => error.code === 'PROJECT_BILLING_EXCEEDS_CONTRACT',
  );
});

test('time-and-material billing cannot exceed recorded unbilled effort', () => {
  const project = newProject('P', { billing_method: 'time_and_material', contract_value: 0, retention_percent: 0 });
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actP'));

  assert.throws(
    () => execute('projects:billing:request', {
      project_id: project.id, amount: 500, billing_method: 'time_and_material',
    }, ik('brP1')),
    (error) => error.code === 'PROJECT_NO_BILLABLE_EFFORT',
  );

  execute('projects:effort:record', { project_id: project.id, hours: 10, role_key: 'engineer' }, ik('efP'));
  assert.throws(
    () => execute('projects:billing:request', {
      project_id: project.id, amount: 500, billing_method: 'time_and_material', effort_hours: 40,
    }, ik('brP2')),
    (error) => error.code === 'PROJECT_EFFORT_OVER_BILLED',
  );

  const ok = execute('projects:billing:request', {
    project_id: project.id, amount: 500, billing_method: 'time_and_material', effort_hours: 10,
  }, ik('brP3'));
  assert.equal(ok.effort_hours, 10);
});

test('billing approval without an account mapping does not touch the general ledger', () => {
  const project = newProject('Q', { contract_value: 9000, billing_method: 'fixed_price', retention_percent: 10 });
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actQ'));
  const request = execute('projects:billing:request', {
    project_id: project.id, amount: 1000, billing_method: 'fixed_price',
  }, ik('brQ'));

  const before = db.prepare('SELECT COUNT(*) AS c FROM finance_documents').get().c;
  const approved = execute('projects:billing:approve', { billing_request_id: request.id }, ik('bapQ'));
  const after = db.prepare('SELECT COUNT(*) AS c FROM finance_documents').get().c;

  assert.equal(approved.state, 'approved');
  assert.equal(approved.finance_document_id, null);
  assert.equal(approved.gl_writer, 'platform.finance');
  assert.equal(before, after, 'Projects must never write the GL on its own');

  assert.throws(
    () => execute('projects:billing:approve', { billing_request_id: request.id }, ik('bapQ2')),
    (error) => error.code === 'PROJECT_BILLING_REQUEST_CLOSED',
  );
});

// ---------------------------------------------------------------------------
// Derived costing and profitability
// ---------------------------------------------------------------------------

test('project cost and profitability are derived from canonical facts, not stored', () => {
  const project = newProject('R', { contract_value: 20000, billing_method: 'fixed_price', retention_percent: 0 });
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actR'));

  const costCode = execute('projects:cost_code:create', { project_id: project.id, code: 'SUB', name: 'Subcontract', cost_type: 'subcontract' }, ik('ccR'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: costCode.id, amount: 10000 }, ik('blR'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apR'));
  const commitment = execute('projects:commitment:record', {
    project_id: project.id, cost_code_id: costCode.id, amount: 4000, source_type: 'subcontract',
  }, ik('cmR'));
  execute('projects:commitment:release', { commitment_id: commitment.id, amount: 4000 }, ik('rlR'));

  execute('projects:effort:record', {
    project_id: project.id, cost_code_id: costCode.id, hours: 10, role_key: 'technician',
  }, ik('efR'));

  const breakdown = costing.projectCostBreakdown(db, ctx, project.id);
  assert.equal(breakdown.subcontract_cost, 4000);
  assert.equal(breakdown.labor_cost, 60, '10h technician @ 6.0');
  assert.equal(breakdown.actual_cost, 4060);
  assert.equal(breakdown.derived, true);

  // No stored total anywhere on the project row.
  const projectRow = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
  assert.equal(projectRow.actual_cost, undefined, 'actual cost must not be a stored project column');
  assert.equal(projectRow.margin, undefined, 'margin must not be a stored project column');

  execute('projects:billing:request', { project_id: project.id, amount: 12000, billing_method: 'fixed_price' }, ik('brR'));
  const requestId = db.prepare('SELECT id FROM project_billing_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(project.id).id;
  execute('projects:billing:approve', { billing_request_id: requestId }, ik('bapR'));

  const profit = costing.projectProfitability(db, ctx, project.id);
  assert.equal(profit.recognised_revenue, 12000);
  assert.equal(profit.actual_cost, 4060);
  assert.equal(profit.margin, 7940);

  // Derivation reacts to new facts without any recalculation step.
  execute('projects:effort:record', {
    project_id: project.id, cost_code_id: costCode.id, hours: 10, role_key: 'technician',
  }, ik('efR2'));
  const profit2 = costing.projectProfitability(db, ctx, project.id);
  assert.equal(profit2.actual_cost, 4120);
  assert.equal(profit2.margin, 7880);
});

test('budget vs actual reports committed and actual per cost code', () => {
  const project = newProject('S');
  const mat = execute('projects:cost_code:create', { project_id: project.id, code: 'MAT', name: 'Materials' }, ik('ccS1'));
  const lab = execute('projects:cost_code:create', { project_id: project.id, code: 'LAB', name: 'Labour', cost_type: 'labor' }, ik('ccS2'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: mat.id, amount: 10000 }, ik('blS1'));
  execute('projects:budget:set_line', { project_id: project.id, cost_code_id: lab.id, amount: 5000 }, ik('blS2'));
  execute('projects:budget:approve', { project_id: project.id }, ik('apS'));
  execute('projects:commitment:record', { project_id: project.id, cost_code_id: mat.id, amount: 3000, source_type: 'purchase_order' }, ik('cmS'));
  execute('projects:project:set_status', { project_id: project.id, status: 'active' }, ik('actS'));
  execute('projects:effort:record', { project_id: project.id, cost_code_id: lab.id, hours: 5, role_key: 'operator' }, ik('efS'));

  const report = costing.projectBudgetVsActual(db, ctx, project.id);
  const matLine = report.lines.find((l) => l.code === 'MAT');
  const labLine = report.lines.find((l) => l.code === 'LAB');

  assert.equal(matLine.effective_budget, 10000);
  assert.equal(matLine.open_committed, 3000);
  assert.equal(matLine.actual_cost, 0);
  assert.equal(labLine.actual_cost, 25, '5h operator @ 5.0');
  assert.equal(report.totals.effective_budget, 15000);
});

test('project reports return canonical rows', () => {
  for (const report of ['profitability', 'budget_vs_actual', 'commitments', 'cost_by_code', 'milestones', 'risks', 'overdue_work', 'revenue']) {
    const rows = costing.projectReport(db, ctx, report);
    assert.ok(Array.isArray(rows), `${report} must return an array`);
  }
  assert.throws(
    () => costing.projectReport(db, ctx, 'not_a_report'),
    (error) => error.code === 'PROJECT_REPORT_UNKNOWN',
  );
});

// ---------------------------------------------------------------------------
// Scope and idempotency
// ---------------------------------------------------------------------------

test('a caller cannot assert its own company scope', () => {
  assert.throws(
    () => executor.execute('projects:project:create', {
      name: 'Spoofed', company_id: 'other-co', idempotency_key: ik('spoof'),
    }, ctx),
    (error) => error.code === 'UNTRUSTED_ACTION_SCOPE',
  );
});

test('repeating an idempotency key does not create a duplicate project', () => {
  const key = ik('idem');
  const first = execute('projects:project:create', { name: 'Idempotent' }, key);
  const second = execute('projects:project:create', { name: 'Idempotent' }, key);
  assert.equal(first.id, second.id);
  const count = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE name = ?').get('Idempotent').c;
  assert.equal(count, 1);
});
