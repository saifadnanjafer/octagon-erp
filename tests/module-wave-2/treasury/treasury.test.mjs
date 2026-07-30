// tests/module-wave-2/treasury/treasury.test.mjs — Integration tests for W2-M8 Treasury.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m074 } from '../../../database/migrations/074_treasury_and_cash_management.mjs';
import * as trsService from '../../../platform/domains/treasury/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-trs-${n}-${Date.now()}-${process.pid}.db`); }

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

test('1. Migration 074: Up, rerun, and schema verification', async () => {
  const env = await setup('m074-schema');
  try {
    await m074.up(env.db);

    const tables = env.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bank_accounts', 'bank_statements', 'bank_statement_lines', 'cash_reconciliations', 'cash_transfers')
    `).all().map(r => r.name);

    assert.equal(tables.length, 5);

    // Rerun check
    await m074.up(env.db);
  } finally {
    cleanup(env);
  }
});

test('2. Bank Account Setup and Statement Import', async () => {
  const env = await setup('bnk-stmt');
  try {
    await m074.up(env.db);

    const bnk = trsService.createBankAccount(env.db, {
      company_id: 'company-alpha',
      account_number: '1000-8800-1122',
      bank_name: 'Trade Bank of Iraq',
      currency: 'USD',
      gl_account_code: '1110-CASH-TBI',
      initial_balance: 150000.0
    });
    assert.equal(bnk.current_balance, 150000.0);

    const stmt = trsService.importBankStatement(env.db, {
      company_id: 'company-alpha',
      bank_account_id: bnk.id,
      statement_date: '2026-07-31',
      starting_balance: 150000.0,
      ending_balance: 165000.0
    });
    assert.equal(stmt.status, 'imported');
    assert.ok(stmt.statement_number.startsWith('STMT-2026-'));
  } finally {
    cleanup(env);
  }
});

test('3. Statement Line Matching and Finalized Reconciliation', async () => {
  const env = await setup('reconcile');
  try {
    await m074.up(env.db);

    const bnk = trsService.createBankAccount(env.db, { company_id: 'company-alpha', account_number: '9900', bank_name: 'TBI', gl_account_code: '1110' });
    const stmt = trsService.importBankStatement(env.db, { company_id: 'company-alpha', bank_account_id: bnk.id, statement_date: '2026-07-31', starting_balance: 0, ending_balance: 5000 });

    const line = trsService.addStatementLine(env.db, {
      company_id: 'company-alpha',
      bank_statement_id: stmt.id,
      transaction_date: '2026-07-28',
      reference_number: 'WIRE-55412',
      counterparty_name: 'Client Acme Corp',
      amount: 5000.0
    });
    assert.equal(line.status, 'unmatched');

    // Attempting to finalize with unmatched lines fails
    assert.throws(() => {
      trsService.finalizeReconciliation(env.db, {
        company_id: 'company-alpha',
        bank_statement_id: stmt.id,
        reconciled_by: 'auditor-01'
      });
    }, /statement line\(s\) remain unmatched/);

    // Match statement line to journal entry
    const matched = trsService.matchStatementLine(env.db, {
      company_id: 'company-alpha',
      statement_line_id: line.id,
      matched_journal_entry_id: 'je-recv-8891'
    });
    assert.equal(matched.status, 'matched');

    // Finalize reconciliation
    const rec = trsService.finalizeReconciliation(env.db, {
      company_id: 'company-alpha',
      bank_statement_id: stmt.id,
      reconciled_by: 'auditor-01',
      notes: 'Fully matched to General Ledger'
    });
    assert.equal(rec.status, 'finalized');
    assert.equal(rec.reconciled_amount, 5000.0);
    assert.ok(rec.reconciliation_number.startsWith('REC-2026-'));
  } finally {
    cleanup(env);
  }
});

test('4. Inter-Account Cash Transfer with FX conversion & Insufficient Funds Protection', async () => {
  const env = await setup('transfer-test');
  try {
    await m074.up(env.db);

    const bnkUSD = trsService.createBankAccount(env.db, { company_id: 'company-alpha', account_number: 'USD-01', bank_name: 'Bank A', currency: 'USD', gl_account_code: '1110', initial_balance: 10000.0 });
    const bnkIQD = trsService.createBankAccount(env.db, { company_id: 'company-alpha', account_number: 'IQD-01', bank_name: 'Bank B', currency: 'IQD', gl_account_code: '1112', initial_balance: 0.0 });

    // Transfer $2,000 USD to IQD account @ rate 1310 IQD per USD = 2,620,000 IQD
    const trf = trsService.executeCashTransfer(env.db, {
      company_id: 'company-alpha',
      from_bank_account_id: bnkUSD.id,
      to_bank_account_id: bnkIQD.id,
      amount: 2000.0,
      fx_rate: 1310.0,
      transfer_date: '2026-07-30',
      initiated_by: 'treasurer-01'
    });
    assert.equal(trf.status, 'completed');
    assert.equal(trf.converted_amount, 2620000.0);
    assert.ok(trf.transfer_number.startsWith('TRF-2026-'));

    const updatedUSD = env.db.prepare('SELECT current_balance FROM bank_accounts WHERE id = ?').get(bnkUSD.id);
    const updatedIQD = env.db.prepare('SELECT current_balance FROM bank_accounts WHERE id = ?').get(bnkIQD.id);

    assert.equal(updatedUSD.current_balance, 8000.0); // 10000 - 2000
    assert.equal(updatedIQD.current_balance, 2620000.0);

    // Overdraft protection test ($15,000 > remaining $8,000 balance)
    assert.throws(() => {
      trsService.executeCashTransfer(env.db, {
        company_id: 'company-alpha',
        from_bank_account_id: bnkUSD.id,
        to_bank_account_id: bnkIQD.id,
        amount: 15000.0,
        transfer_date: '2026-07-30',
        initiated_by: 'treasurer-01'
      });
    }, /Insufficient funds in bank account/);
  } finally {
    cleanup(env);
  }
});
