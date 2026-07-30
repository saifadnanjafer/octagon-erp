// tests/module-wave-2/financial_planning/financial_planning.test.mjs — Integration tests for W2-M7 Financial Planning.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m073 } from '../../../database/migrations/073_budgeting_and_financial_planning.mjs';
import * as fpService from '../../../platform/domains/financial_planning/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-fp-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);
  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 073: Up, rerun, and schema verification', async () => {
  const env = await setup('m073-schema');
  try {
    await m073.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('fiscal_budgets', 'budget_lines', 'cost_centers', 'budget_commitments', 'budget_reallocations', 'financial_forecasts')
    `).all().map(r => r.name);

    assert.equal(tables.length, 6);

    // Rerun check
    await m073.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Cost Center & Fiscal Budget Creation & Line Addition', async () => {
  const env = await setup('bdg-life');
  try {
    await m073.up(env.db);

    const cc = fpService.createCostCenter(env.db, {
      company_id: 'company-alpha',
      code: 'CC-ENG',
      name: 'Engineering & Operations'
    });
    assert.equal(cc.code, 'CC-ENG');

    const bdg = fpService.createFiscalBudget(env.db, {
      company_id: 'company-alpha',
      fiscal_year: 2026,
      title: 'FY2026 Operational Budget'
    });
    assert.equal(bdg.status, 'draft');
    assert.ok(bdg.budget_number.startsWith('BDG-2026-'));

    const line1 = fpService.addBudgetLine(env.db, {
      company_id: 'company-alpha',
      budget_id: bdg.id,
      cost_center_id: cc.id,
      gl_account_code: '6000-IT-HARDWARE',
      period_month: 1,
      budgeted_amount: 50000.0
    });
    assert.equal(line1.budgeted_amount, 50000.0);

    const activeBDG = fpService.approveFiscalBudget(env.db, {
      id: bdg.id,
      company_id: 'company-alpha',
      approved_by: 'cfo-admin'
    });
    assert.equal(activeBDG.status, 'active');
  } finally {
    cleanup(env);
  }
});

test('3. Budget Encumbrance & Over-budget Commitment Protection', async () => {
  const env = await setup('bdg-commit');
  try {
    await m073.up(env.db);

    const bdg = fpService.createFiscalBudget(env.db, { company_id: 'company-alpha', fiscal_year: 2026, title: 'Server Upgrade Budget' });
    const line = fpService.addBudgetLine(env.db, { company_id: 'company-alpha', budget_id: bdg.id, gl_account_code: '6100-SERVERS', period_month: 2, budgeted_amount: 10000.0 });
    fpService.approveFiscalBudget(env.db, { id: bdg.id, company_id: 'company-alpha', approved_by: 'cfo' });

    // Valid commitment ($4,000 <= $10,000)
    const commit1 = fpService.commitBudgetAmount(env.db, {
      company_id: 'company-alpha',
      budget_line_id: line.id,
      source_document_type: 'purchase_order',
      source_document_id: 'po-1001',
      amount: 4000.0
    });
    assert.equal(commit1.amount, 4000.0);

    const updatedLine = env.db.prepare('SELECT committed_amount FROM budget_lines WHERE id = ?').get(line.id);
    assert.equal(updatedLine.committed_amount, 4000.0);

    // Over-budget commitment attempt ($7,000 when remaining available is $6,000)
    assert.throws(() => {
      fpService.commitBudgetAmount(env.db, {
        company_id: 'company-alpha',
        budget_line_id: line.id,
        source_document_type: 'purchase_order',
        source_document_id: 'po-1002',
        amount: 7000.0
      });
    }, /Insufficient budget available/);
  } finally {
    cleanup(env);
  }
});

test('4. Budget Reallocation between Lines', async () => {
  const env = await setup('bdg-realloc');
  try {
    await m073.up(env.db);

    const bdg = fpService.createFiscalBudget(env.db, { company_id: 'company-alpha', fiscal_year: 2026, title: 'Department Budget' });
    const lineA = fpService.addBudgetLine(env.db, { company_id: 'company-alpha', budget_id: bdg.id, gl_account_code: '6200-TRAINING', period_month: 3, budgeted_amount: 20000.0 });
    const lineB = fpService.addBudgetLine(env.db, { company_id: 'company-alpha', budget_id: bdg.id, gl_account_code: '6300-SOFTWARE', period_month: 3, budgeted_amount: 10000.0 });
    fpService.approveFiscalBudget(env.db, { id: bdg.id, company_id: 'company-alpha', approved_by: 'cfo' });

    // Transfer $5,000 from Line A to Line B
    const real = fpService.reallocateBudget(env.db, {
      company_id: 'company-alpha',
      from_budget_line_id: lineA.id,
      to_budget_line_id: lineB.id,
      amount: 5000.0,
      reason: 'Reallocate unused training funds to software licenses',
      requested_by: 'user-cfo'
    });
    assert.equal(real.amount, 5000.0);
    assert.ok(real.reallocation_number.startsWith('REAL-2026-'));

    const updatedA = env.db.prepare('SELECT budgeted_amount FROM budget_lines WHERE id = ?').get(lineA.id);
    const updatedB = env.db.prepare('SELECT budgeted_amount FROM budget_lines WHERE id = ?').get(lineB.id);

    assert.equal(updatedA.budgeted_amount, 15000.0); // 20000 - 5000
    assert.equal(updatedB.budgeted_amount, 15000.0); // 10000 + 5000
  } finally {
    cleanup(env);
  }
});

test('5. Financial Forecast Creation', async () => {
  const env = await setup('fcst-test');
  try {
    await m073.up(env.db);

    const fcst = fpService.createFinancialForecast(env.db, {
      company_id: 'company-alpha',
      title: 'Q3 2026 Revenue & Cashflow Model',
      scenario: 'optimistic',
      period_start: '2026-07-01',
      period_end: '2026-09-30'
    });

    assert.equal(fcst.scenario, 'optimistic');
    assert.ok(fcst.forecast_number.startsWith('FCST-2026-'));
  } finally {
    cleanup(env);
  }
});
