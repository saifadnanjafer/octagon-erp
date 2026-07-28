// Disposable authenticated test fixture.
//
// PURPOSE
// Real Chromium acceptance needs a logged-in session. Production credentials
// must never be used or requested, so this seeds deterministic throwaway
// identities into an ISOLATED DISPOSABLE database only.
//
// SAFETY — three independent guards, all must pass:
//   1. OCTAGON_TEST_FIXTURE must be exactly '1'.
//   2. NODE_ENV must not be 'production'.
//   3. The target database path must NOT be the operational database.
//
// Any single guard failing aborts with a FixtureRefused error. There is no
// force flag and no override. The passwords below are throwaway values that
// exist only in this test file and only ever reach a temp-directory database;
// they grant nothing anywhere else.
//
// This file never writes to the operational database, never alters production
// authentication, and never relaxes the password policy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import { createUserDirectory } from '../platform/identity/users/index.mjs';
import { createMembershipDirectory } from '../platform/organizations/memberships/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/** Paths that must never be seeded, whatever the caller passes. */
const OPERATIONAL_PATHS = [
  path.join(repoRoot, 'database.db'),
  path.join(repoRoot, 'database.json'),
];

export class FixtureRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FixtureRefused';
    this.code = code;
  }
}

// Throwaway password. Satisfies the real policy so the fixture never needs to
// weaken it. Test-only: it is written to a temp database that is deleted.
export const TEST_PASSWORD = 'OctagonTest!2026#Disposable';

export const TEST_TENANT = 't_octagon_test';
export const TEST_COMPANY = 'c_octagon_test';
export const TEST_BRANCH = 'b_octagon_test';

/**
 * The eight disposable roles required for browser acceptance.
 * `permissions` are real permission tokens the canonical API checks.
 * `viewer` deliberately gets read only, so denial can be proven, not assumed.
 */
export const TEST_ROLES = Object.freeze([
  { key: 'sysadmin',   login: 'test.sysadmin',   name: 'Test System Administrator', roleId: 'system.admin',       permissions: ['platform:db:read', 'platform:db:write'], isOwner: true },
  { key: 'workshop',   login: 'test.workshop',   name: 'Test Workshop Manager',     roleId: 'workshop.manager',   permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'finance',    login: 'test.finance',    name: 'Test Finance Manager',      roleId: 'finance.manager',    permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'inventory',  login: 'test.inventory',  name: 'Test Inventory Operator',   roleId: 'inventory.operator', permissions: ['platform:db:read', 'platform:db:write'] },
  {
    key: 'sales',
    login: 'test.sales',
    name: 'Test Sales User',
    roleId: 'sales.user',
    permissions: [
      'platform:db:read', 'platform:db:write', 'crm:lead:write',
      'sales:order:write', 'sales:invoice:write', 'sales:commission:write',
    ],
  },
  {
    key: 'procurement',
    login: 'test.procurement',
    name: 'Test Procurement User',
    roleId: 'procurement.user',
    permissions: [
      'platform:db:read', 'platform:db:write',
      'purchase:requisition:write', 'purchase:requisition:approve',
      'purchase:rfq:write', 'purchase:order:write', 'purchase:order:approve',
      'purchase:match:write', 'purchase:bill:write',
    ],
  },
  { key: 'pos',        login: 'test.pos',        name: 'Test POS Operator',         roleId: 'pos.operator',       permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'viewer',     login: 'test.viewer',     name: 'Test Restricted Viewer',    roleId: 'role_test_viewer',   permissions: ['platform:db:read'] },
]);

/**
 * Enforce every safety guard. Throws FixtureRefused on any violation.
 * Exported so tests can prove each guard independently.
 */
export function assertFixtureAllowed({ dbPath, env = process.env } = {}) {
  if (env.OCTAGON_TEST_FIXTURE !== '1') {
    throw new FixtureRefused(
      'test auth fixture requires OCTAGON_TEST_FIXTURE=1',
      'FIXTURE_FLAG_REQUIRED',
    );
  }
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new FixtureRefused(
      'test auth fixture must never run with NODE_ENV=production',
      'FIXTURE_PRODUCTION_DENIED',
    );
  }
  if (!dbPath) {
    throw new FixtureRefused('test auth fixture requires an explicit dbPath', 'FIXTURE_DBPATH_REQUIRED');
  }
  const resolved = path.resolve(dbPath);
  for (const operational of OPERATIONAL_PATHS) {
    if (resolved === operational) {
      throw new FixtureRefused(
        `refusing to seed the operational database: ${resolved}`,
        'FIXTURE_OPERATIONAL_DENIED',
      );
    }
  }
  // Belt and braces: also refuse anything sitting directly in the repo root,
  // so a future rename of database.db cannot silently become seedable.
  if (path.dirname(resolved) === repoRoot) {
    throw new FixtureRefused(
      `refusing to seed a database inside the product repository root: ${resolved}`,
      'FIXTURE_REPO_ROOT_DENIED',
    );
  }
  return true;
}

function nowIso() { return new Date().toISOString(); }

/**
 * Seed tenant/company/branch, the eight disposable users, their roles and
 * grants. Idempotent: safe to call twice on the same disposable database.
 *
 * @returns {{users: Array, password: string, tenantId: string, companyId: string}}
 */
export function seedTestIdentities(dialect, { dbPath, env = process.env } = {}) {
  assertFixtureAllowed({ dbPath, env });
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new FixtureRefused('a database dialect is required', 'FIXTURE_DIALECT_REQUIRED');
  }

  const now = nowIso();

  dialect.prepare(`INSERT INTO platform_tenants (id, name, status, created_at)
    VALUES (?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`).run(TEST_TENANT, 'Octagon Test Tenant', now);
  dialect.prepare(`INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at)
    VALUES (?, ?, ?, 'active', 1, ?) ON CONFLICT(id) DO NOTHING`).run(TEST_COMPANY, TEST_TENANT, 'Octagon Test Co', now);
  dialect.prepare(`INSERT INTO platform_branches (id, company_id, name, status, created_at)
    VALUES (?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`).run(TEST_BRANCH, TEST_COMPANY, 'Octagon Test Branch', now);

  const users = createUserDirectory(dialect);
  const memberships = createMembershipDirectory(dialect);

  const insertRole = dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'active', ?, ?) ON CONFLICT(id) DO NOTHING`);
  // scope must be one of the CHECK values in migration 007
  // ('all','company','branch','department','warehouse','project','team','own','assignee').
  // 'all' is the widest and is what a test identity needs.
  const insertGrant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, ?, ?, 'allow', 'all', '[]', 0, ?, 'test-auth-fixture') ON CONFLICT DO NOTHING`);
  const insertAssignment = dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, role_id, status, created_at, created_by)
    VALUES (?, ?, ?, 'active', ?, 'test-auth-fixture') ON CONFLICT(id) DO NOTHING`);

  const created = [];

  for (const role of TEST_ROLES) {
    const userId = `usr_test_${role.key}`;

    insertRole.run(role.roleId, TEST_TENANT, role.roleId, role.name, now, now);
    for (const permission of role.permissions) {
      const grantId = `grant_${role.roleId}_${permission.replace(/[^a-z0-9]+/gi, '_')}`;
      insertGrant.run(grantId, role.roleId, permission, now);
    }

    let user = users.get(userId);
    if (!user) {
      user = users.create({
        id: userId,
        tenantId: TEST_TENANT,
        login: role.login,
        name: role.name,
        email: `${role.login}@test.invalid`,
        password: TEST_PASSWORD,
        isOwner: !!role.isOwner,
      }, 'test-auth-fixture');
      memberships.grant({ userId, companyId: TEST_COMPANY, branchId: TEST_BRANCH, isDefault: true });
    }

    insertAssignment.run(`asg_test_${role.key}`, userId, role.roleId, now);

    created.push({
      key: role.key,
      userId,
      login: role.login,
      name: role.name,
      permissions: role.permissions,
      isOwner: !!role.isOwner,
    });
  }

  // Seed disposable test master data for tests (test UOM category, test base UOM, test product category)
  dialect.prepare(`
    INSERT INTO uom_categories (id, name, is_active, created_at)
    VALUES ('uomcat_test_unit', 'Test Unit Category', 1, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);

  dialect.prepare(`
    INSERT INTO uoms (id, category_id, name, symbol, uom_type, factor, rounding, is_active, created_at)
    VALUES ('uom_test_unit', 'uomcat_test_unit', 'Test Unit', 'Pcs', 'reference', 1.0, 0.001, 1, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);

  // Seed stock finance accounts for TEST_COMPANY
  const insertAccount = dialect.prepare(`
    INSERT INTO finance_accounts (id, company_id, code, name, type, normal_balance, is_reconcilable, is_active, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 'test-auth-fixture')
    ON CONFLICT(id) DO NOTHING
  `);

  insertAccount.run('acc_test_stock_val', TEST_COMPANY, '140000', 'Stock Valuation Account', 'asset', 'debit', now, now);
  insertAccount.run('acc_test_stock_in', TEST_COMPANY, '140100', 'Stock Input Account', 'liability', 'credit', now, now);
  insertAccount.run('acc_test_stock_out', TEST_COMPANY, '140200', 'Stock Output Account', 'asset', 'debit', now, now);
  insertAccount.run('acc_test_stock_exp', TEST_COMPANY, '501000', 'COGS Expense Account', 'expense', 'debit', now, now);

  dialect.prepare(`
    INSERT INTO product_categories (id, company_id, name, code, stock_account_id, stock_input_account_id, stock_output_account_id, expense_account_id, is_active, created_at)
    VALUES ('pcat_test_general', ?, 'Test General Category', 'CAT-TEST', 'acc_test_stock_val', 'acc_test_stock_in', 'acc_test_stock_out', 'acc_test_stock_exp', 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      stock_account_id = excluded.stock_account_id,
      stock_input_account_id = excluded.stock_input_account_id,
      stock_output_account_id = excluded.stock_output_account_id,
      expense_account_id = excluded.expense_account_id
  `).run(TEST_COMPANY, now);

  // Seed fiscal year & period for TEST_COMPANY
  const currentYear = new Date().getFullYear();
  const fyId = `fy_${TEST_COMPANY}_${currentYear}`;
  dialect.prepare(`
    INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 'test-auth-fixture')
    ON CONFLICT DO NOTHING
  `).run(fyId, TEST_COMPANY, `Fiscal Year ${currentYear}`, `${currentYear}-01-01`, `${currentYear}-12-31`, now, now);

  const fpId = `fp_${TEST_COMPANY}_${currentYear}`;
  dialect.prepare(`
    INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES (?, ?, ?, 'Full Year Period', ?, ?, 'open', ?, ?, 'test-auth-fixture')
    ON CONFLICT DO NOTHING
  `).run(fpId, TEST_COMPANY, fyId, `${currentYear}-01-01`, `${currentYear}-12-31`, now, now);

  const insertJournal = dialect.prepare(`
    INSERT INTO finance_journals (id, company_id, code, name, type, default_debit_account_id, default_credit_account_id, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'test-auth-fixture')
    ON CONFLICT DO NOTHING
  `);
  insertJournal.run(`jnl_general_${TEST_COMPANY}`, TEST_COMPANY, 'GEN', 'General Journal', 'general', 'acc_test_stock_val', 'acc_test_stock_val', now, now);
  insertJournal.run(`jnl_stock_${TEST_COMPANY}`, TEST_COMPANY, 'STK', 'Stock Journal', 'general', 'acc_test_stock_val', 'acc_test_stock_in', now, now);

  const insertLimit = dialect.prepare(`
    INSERT INTO finance_approval_authority_limits (id, company_id, role_or_user, limit_type, max_amount, created_at, created_by)
    VALUES (?, ?, ?, 'post', 999999999999.0, ?, 'test-auth-fixture')
    ON CONFLICT DO NOTHING
  `);
  insertLimit.run(`limit_sysadmin_${TEST_COMPANY}`, TEST_COMPANY, 'usr_test_sysadmin', now);
  return {
    users: created,
    password: TEST_PASSWORD,
    tenantId: TEST_TENANT,
    companyId: TEST_COMPANY,
    branchId: TEST_BRANCH,
    testUomCategoryId: 'uomcat_test_unit',
    testUomId: 'uom_test_unit',
    testProductCategoryId: 'pcat_test_general',
  };
}

/**
 * Write the seeded logins to a runtime file so a browser runner can read them
 * without them being committed. The caller is responsible for choosing an
 * ignored path (the preview launcher uses the temp staging directory).
 */
export function writeFixtureManifest(targetPath, seeded) {
  const payload = {
    generatedAt: nowIso(),
    warning: 'DISPOSABLE TEST CREDENTIALS. Valid only inside a throwaway database.',
    password: seeded.password,
    tenantId: seeded.tenantId,
    companyId: seeded.companyId,
    users: seeded.users.map((u) => ({ key: u.key, login: u.login, permissions: u.permissions })),
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}
