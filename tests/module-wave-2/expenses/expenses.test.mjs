// tests/module-wave-2/expenses/expenses.test.mjs — Integration tests for W2-M4 Expenses.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m070 } from '../../../database/migrations/070_expenses_and_business_travel.mjs';
import * as expenseService from '../../../platform/domains/expenses/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-exp-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed Employee
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('emp-101', 'company-alpha', 'Sarah Ahmad (Consultant)', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 070: Up, rerun, and schema verification', async () => {
  const env = await setup('m070-schema');
  try {
    await m070.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'expense_%' OR name LIKE 'travel_%'
    `).all().map(r => r.name);

    assert.ok(tables.includes('expense_categories'));
    assert.ok(tables.includes('expense_reports'));
    assert.ok(tables.includes('expense_lines'));
    assert.ok(tables.includes('travel_requests'));
    assert.ok(tables.includes('expense_audit_logs'));

    // Rerun check
    await m070.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Category & Travel Request Pre-approval Lifecycle', async () => {
  const env = await setup('trv-life');
  try {
    await m070.up(env.db);

    const cat = expenseService.createCategory(env.db, {
      company_id: 'company-alpha',
      name: 'Airfare',
      code: 'AIR',
      gl_account_code: '6100-TRAVEL'
    });
    assert.equal(cat.name, 'Airfare');

    const trv = expenseService.createTravelRequest(env.db, {
      company_id: 'company-alpha',
      employee_id: 'emp-101',
      title: 'Erbil Tech Summit 2026',
      destination: 'Erbil, Iraq',
      start_date: '2026-08-10',
      end_date: '2026-08-14',
      estimated_cost: 1200.0,
      purpose: 'Keynote Speaker & Partner Meetings'
    });
    assert.equal(trv.status, 'requested');
    assert.ok(trv.request_number.startsWith('TRV-2026-'));

    const approved = expenseService.approveTravelRequest(env.db, {
      id: trv.id,
      company_id: 'company-alpha',
      approved_by: 'mgr-admin'
    });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.approved_by, 'mgr-admin');
  } finally {
    cleanup(env);
  }
});

test('3. Expense Line Receipt Policy Violation Detection', async () => {
  const env = await setup('policy-viol');
  try {
    await m070.up(env.db);

    const cat = expenseService.createCategory(env.db, {
      company_id: 'company-alpha',
      name: 'Meals & Client Entertainment',
      code: 'MEAL',
      requires_receipt: 1,
      receipt_threshold_amount: 25.0
    });

    const report = expenseService.createExpenseReport(env.db, {
      company_id: 'company-alpha',
      employee_id: 'emp-101',
      title: 'Client Lunch in Baghdad'
    });

    // Line > $25 without receipt -> policy violation flag set
    const lineWithViolation = expenseService.addExpenseLine(env.db, {
      company_id: 'company-alpha',
      expense_report_id: report.id,
      category_id: cat.id,
      expense_date: '2026-07-28',
      merchant_name: 'Al-Mansour Restaurant',
      amount: 85.0,
      receipt_attached: 0
    });

    assert.equal(lineWithViolation.policy_violation_flag, 1);
    assert.ok(lineWithViolation.policy_violation_reason.includes('Receipt required'));

    // Line with receipt -> no violation
    const lineCompliant = expenseService.addExpenseLine(env.db, {
      company_id: 'company-alpha',
      expense_report_id: report.id,
      category_id: cat.id,
      expense_date: '2026-07-29',
      merchant_name: 'Baghdad Cafe',
      amount: 15.0,
      receipt_attached: 0
    });
    assert.equal(lineCompliant.policy_violation_flag, 0);
  } finally {
    cleanup(env);
  }
});

test('4. Full Expense Report Lifecycle: Draft -> Submit -> Approve -> Pay', async () => {
  const env = await setup('full-lifecycle');
  try {
    await m070.up(env.db);

    const cat = expenseService.createCategory(env.db, {
      company_id: 'company-alpha',
      name: 'Hotel & Lodging',
      code: 'LODG'
    });

    const report = expenseService.createExpenseReport(env.db, {
      company_id: 'company-alpha',
      employee_id: 'emp-101',
      title: 'July Field Trip Expenses'
    });
    assert.equal(report.status, 'draft');

    expenseService.addExpenseLine(env.db, {
      company_id: 'company-alpha',
      expense_report_id: report.id,
      category_id: cat.id,
      expense_date: '2026-07-25',
      merchant_name: 'Babylon Hotel',
      amount: 350.0,
      receipt_attached: 1
    });

    const submitted = expenseService.submitExpenseReport(env.db, {
      id: report.id,
      company_id: 'company-alpha',
      submitted_by: 'emp-101'
    });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.total_amount, 350.0);

    const approved = expenseService.approveExpenseReport(env.db, {
      id: report.id,
      company_id: 'company-alpha',
      approved_by: 'fin-mgr-01',
      comments: 'Approved per policy limits'
    });
    assert.equal(approved.status, 'approved');

    const paid = expenseService.payExpenseReport(env.db, {
      id: report.id,
      company_id: 'company-alpha',
      payment_reference: 'BANK-TRF-909182',
      journal_entry_id: 'je-exp-5501',
      paid_by: 'treasury-clerk'
    });
    assert.equal(paid.status, 'paid');
    assert.equal(paid.payment_reference, 'BANK-TRF-909182');

    // Audit logs verify
    const logs = env.db.prepare('SELECT action FROM expense_audit_logs WHERE expense_report_id = ? ORDER BY created_at ASC').all(report.id);
    const actions = logs.map(l => l.action);
    assert.deepEqual(actions, ['submitted', 'approved', 'paid']);
  } finally {
    cleanup(env);
  }
});
