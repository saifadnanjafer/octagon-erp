// tests/module-wave-2/contracts/contracts.test.mjs — Integration tests for W2-M1 Contracts.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../../database/migration-runner/index.mjs';
import { migration as m067 } from '../../../database/migrations/067_contracts_and_legal_management.mjs';
import * as contractService from '../../../platform/domains/contracts/service.mjs';

function tmp(n) { return path.join(os.tmpdir(), `octagon-cnt-${n}-${Date.now()}-${process.pid}.db`); }

async function setup(name) {
  const p = tmp(name);
  await freshInstall({ dbPath: p });
  const db = openMigrationDatabase(p);

  // Seed sample Party
  db.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('party-c1', 'company-alpha', 'Al-Rashid Trading Co.', datetime('now'), datetime('now'))
  `).run();

  return { db, path: p };
}

function cleanup(env) {
  env.db.close();
  for (const s of ['', '-wal', '-shm']) {
    try { if (fs.existsSync(env.path + s)) fs.unlinkSync(env.path + s); } catch {}
  }
}

test('1. Migration 067: Up, rerun, and structure verification', async () => {
  const env = await setup('t1');
  try {
    // Rerun up to verify idempotency
    m067.up(env.db, { dialect: 'sqlite' });

    const types = env.db.prepare('SELECT COUNT(*) as n FROM contract_types').get();
    assert.ok(types.n >= 4, 'Default contract types should be seeded');

    const library = env.db.prepare('SELECT COUNT(*) as n FROM contract_clause_library').get();
    assert.ok(library.n >= 2, 'Default clauses should be seeded');
  } finally {
    cleanup(env);
  }
});

test('2. Contract Lifecycle: Create, status transitions, and versioning', async () => {
  const env = await setup('t2');
  try {
    const user = { id: 'usr-lawyer-1' };

    // Create Contract
    const contract = contractService.createContract(env.db, {
      company_id: 'company-alpha',
      title_ar: 'عقد صيانة المعدات',
      title_en: 'Equipment Maintenance Contract',
      type_id: 'ct-comm-01',
      party_id: 'party-c1',
      contract_value: 50000000,
      currency: 'IQD',
      start_date: '2026-08-01',
      end_date: '2027-07-31',
      owner_user_id: 'usr-lawyer-1'
    }, user);

    assert.ok(contract.id, 'Contract ID generated');
    assert.match(contract.contract_number, /^CNT-2026-\d{4}$/, 'Contract number matches pattern');
    assert.equal(contract.status, 'draft', 'Initial status is draft');
    assert.equal(contract.version, 1, 'Initial version is 1');

    // Transition draft -> internal_review
    const r1 = contractService.transitionContractStatus(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      target_status: 'internal_review'
    }, user);
    assert.equal(r1.status, 'internal_review');

    // Transition internal_review -> approved
    const r2 = contractService.transitionContractStatus(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      target_status: 'approved'
    }, user);
    assert.equal(r2.status, 'approved');

    // Transition approved -> active
    const r3 = contractService.transitionContractStatus(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      target_status: 'active'
    }, user);
    assert.equal(r3.status, 'active');

    // Attempt invalid transition active -> draft (should throw)
    assert.throws(() => {
      contractService.transitionContractStatus(env.db, {
        contract_id: contract.id,
        company_id: 'company-alpha',
        target_status: 'draft'
      }, user);
    }, /INVALID_STATUS_TRANSITION/);
  } finally {
    cleanup(env);
  }
});

test('3. Amendments and Version Escalation', async () => {
  const env = await setup('t3');
  try {
    const user = { id: 'usr-lawyer-1' };

    const contract = contractService.createContract(env.db, {
      company_id: 'company-alpha',
      title_ar: 'عقد توريد أجهزة',
      title_en: 'IT Equipment Supply Contract',
      type_id: 'ct-proc-01',
      party_id: 'party-c1',
      contract_value: 20000000,
      owner_user_id: 'usr-lawyer-1'
    }, user);

    contractService.transitionContractStatus(env.db, { contract_id: contract.id, company_id: 'company-alpha', target_status: 'internal_review' }, user);
    contractService.transitionContractStatus(env.db, { contract_id: contract.id, company_id: 'company-alpha', target_status: 'approved' }, user);
    contractService.transitionContractStatus(env.db, { contract_id: contract.id, company_id: 'company-alpha', target_status: 'active' }, user);

    // Add Amendment
    const amended = contractService.amendContract(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      title_ar: 'المحق 1: زيادة كمية الخوادم',
      title_en: 'Amendment 1: Increased Server Volume',
      description: 'Addition of 5 high performance rack servers',
      effective_date: '2026-09-01',
      new_value: 35000000
    }, user);

    assert.equal(amended.version, 2, 'Version bumped to 2');
    assert.equal(amended.contract_value, 35000000, 'Contract value updated');

    const amendments = env.db.prepare('SELECT * FROM contract_amendments WHERE contract_id = ?').all(contract.id);
    assert.equal(amendments.length, 1);
    assert.equal(amendments[0].amendment_number, 1);
  } finally {
    cleanup(env);
  }
});

test('4. Obligations & Guarantees Lifecycle', async () => {
  const env = await setup('t4');
  try {
    const user = { id: 'usr-mgr-1' };

    const contract = contractService.createContract(env.db, {
      company_id: 'company-alpha',
      title_ar: 'عقد إنشاءات',
      title_en: 'Construction Master Contract',
      type_id: 'ct-comm-01',
      contract_value: 100000000,
      owner_user_id: 'usr-mgr-1'
    }, user);

    // Add Obligation
    const obg = contractService.addContractObligation(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      title_ar: 'تسليم الخرائط الهندسبة المعتمدة',
      title_en: 'Submit Approved Engineering Blueprints',
      responsible_party: 'counterparty',
      due_date: '2026-08-15',
      penalty_amount: 5000000
    });
    assert.equal(obg.status, 'pending');

    // Fulfill Obligation
    const fulfilled = contractService.fulfillContractObligation(env.db, {
      obligation_id: obg.id,
      company_id: 'company-alpha',
      evidence: 'Blueprint Document Scan #99482'
    }, user);
    assert.equal(fulfilled.status, 'fulfilled');
    assert.ok(fulfilled.fulfilled_at);

    // Add Performance Bond Guarantee
    const guarantee = contractService.addContractGuarantee(env.db, {
      contract_id: contract.id,
      company_id: 'company-alpha',
      guarantee_type: 'performance_bond',
      bank_name: 'Trade Bank of Iraq',
      reference_number: 'BG-2026-9091',
      amount: 10000000,
      issue_date: '2026-08-01',
      expiry_date: '2027-08-01'
    });
    assert.equal(guarantee.status, 'active');
    assert.equal(guarantee.amount, 10000000);
  } finally {
    cleanup(env);
  }
});

test('5. Cross-Company Isolation', async () => {
  const env = await setup('t5');
  try {
    const user = { id: 'usr-1' };

    const c1 = contractService.createContract(env.db, {
      company_id: 'company-alpha',
      title_ar: 'عقد شركة ألفا',
      title_en: 'Alpha Company Contract',
      type_id: 'ct-comm-01',
      owner_user_id: 'usr-1'
    }, user);

    // Attempt to fetch under company-beta
    const fetchedBeta = contractService.getContract(env.db, c1.id, 'company-beta');
    assert.equal(fetchedBeta, null, 'Contract from company-alpha must not be visible to company-beta');

    // Attempt to transition status under company-beta (should throw)
    assert.throws(() => {
      contractService.transitionContractStatus(env.db, {
        contract_id: c1.id,
        company_id: 'company-beta',
        target_status: 'internal_review'
      }, user);
    }, /CONTRACT_NOT_FOUND/);
  } finally {
    cleanup(env);
  }
});
