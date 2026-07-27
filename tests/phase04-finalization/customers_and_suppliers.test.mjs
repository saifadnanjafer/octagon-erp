import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { seedTestIdentities } from '../../scripts/test-auth-fixture.mjs';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { getParties } from '../../platform/commercial/parties.mjs';

let tempDir;
let dbPath;
let db;
let authority;
let ikCount = 0;
function ik(prefix = 'ik') {
  ikCount += 1;
  return `${prefix}_${Date.now()}_${ikCount}`;
}

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-cust-supp-test-'));
  dbPath = path.join(tempDir, 'cust-supp.db');
  await freshInstall({ dbPath, backupDir: path.join(tempDir, 'backups'), actor: 'cust-supp-test' });
  db = openMigrationDatabase(dbPath);
  process.env.OCTAGON_TEST_FIXTURE = '1';
  seedTestIdentities(db, { dbPath });
  authority = createPlatformAuthority(db);
});

after(() => {
  delete process.env.OCTAGON_TEST_FIXTURE;
  try { db?.close(); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
});

test('Customer & Supplier Lifecycle: create customer, create supplier, test duplicate tax_id validation', async () => {
  const executor = authority.actionExecutor;
  const sysadminCtx = { userId: 'usr_test_sysadmin', companyId: 'c_octagon_test', tenantId: 't_octagon_test' };

  // 1. Create Customer
  const cust = executor.execute('party:create', {
    name: 'شركة الفرات للمقاولات',
    legal_name: 'شركة الفرات للمقاولات العامة المحدودة',
    is_company: 1,
    tax_id: 'TAX-100200',
    registration_number: 'CR-998877',
    roles: ['customer'],
    phone: '+964 770 111 2222',
    email: 'info@furat.iq',
    idempotency_key: ik('party_c1')
  }, sysadminCtx);
  assert.ok(cust.id);
  assert.equal(cust.roles.includes('customer'), true);

  // 2. Duplicate Tax ID check triggers error
  assert.throws(
    () => executor.execute('party:create', {
      name: 'شركة أخرى',
      tax_id: 'TAX-100200',
      roles: ['customer'],
      idempotency_key: ik('party_dup')
    }, sysadminCtx),
    (err) => String(err.message).includes('DUPLICATE_IDENTIFIER')
  );

  // 3. Create Dual-Role party (Customer + Supplier)
  const dual = executor.execute('party:create', {
    name: 'شركة دجلة للحديد والمشتقات',
    roles: ['customer', 'supplier'],
    tax_id: 'TAX-300400',
    idempotency_key: ik('party_dual')
  }, sysadminCtx);
  assert.equal(dual.roles.includes('customer'), true);
  assert.equal(dual.roles.includes('supplier'), true);

  // 4. Query with dual-role filter
  const dualParties = getParties(db, { company_id: 'c_octagon_test', role: 'dual' });
  assert.equal(dualParties.length, 1);
  assert.equal(dualParties[0].name, 'شركة دجلة للحديد والمشتقات');

  // 5. Contact Person CRUD
  const contact = executor.execute('party_contact:create', {
    party_id: cust.id,
    name: 'أحمد علي',
    phone: '+964 770 999 8888',
    job_title: 'مدير المشتريات',
    idempotency_key: ik('cnt_c')
  }, sysadminCtx);
  assert.ok(contact.id);
  assert.equal(contact.name, 'أحمد علي');

  // 6. Address CRUD
  const addr = executor.execute('party_address:create', {
    party_id: cust.id,
    type: 'billing',
    street: 'شارع فلسطين',
    city: 'بغداد',
    country: 'العراق',
    idempotency_key: ik('addr_c')
  }, sysadminCtx);
  assert.ok(addr.id);

  // 7. Archive & Restore Party
  const archived = executor.execute('party:archive', { id: cust.id, idempotency_key: ik('party_arch') }, sysadminCtx);
  assert.equal(archived.status, 'archived');

  const restored = executor.execute('party:restore', { id: cust.id, idempotency_key: ik('party_rest') }, sysadminCtx);
  assert.equal(restored.status, 'active');
});
