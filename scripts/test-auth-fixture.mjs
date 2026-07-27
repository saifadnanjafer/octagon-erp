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
  { key: 'sysadmin',   login: 'test.sysadmin',   name: 'Test System Administrator', roleId: 'role_test_sysadmin',   permissions: ['platform:db:read', 'platform:db:write'], isOwner: true },
  { key: 'workshop',   login: 'test.workshop',   name: 'Test Workshop Manager',     roleId: 'role_test_workshop',   permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'finance',    login: 'test.finance',    name: 'Test Finance Manager',      roleId: 'role_test_finance',    permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'inventory',  login: 'test.inventory',  name: 'Test Inventory Operator',   roleId: 'role_test_inventory',  permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'sales',      login: 'test.sales',      name: 'Test Sales User',           roleId: 'role_test_sales',      permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'procurement',login: 'test.procurement',name: 'Test Procurement User',     roleId: 'role_test_procurement',permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'pos',        login: 'test.pos',        name: 'Test POS Operator',         roleId: 'role_test_pos',        permissions: ['platform:db:read', 'platform:db:write'] },
  { key: 'viewer',     login: 'test.viewer',     name: 'Test Restricted Viewer',    roleId: 'role_test_viewer',     permissions: ['platform:db:read'] },
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

  return {
    users: created,
    password: TEST_PASSWORD,
    tenantId: TEST_TENANT,
    companyId: TEST_COMPANY,
    branchId: TEST_BRANCH,
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
