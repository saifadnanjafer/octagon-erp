// Phase 02 test harness.
//
// Every suite uses a DISPOSABLE database under os.tmpdir(). No test opens
// database.db, database.json, or any production path. See
// docs/evidence/phase-02/source-lock.md § 2.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createUserDirectory } from '../../platform/identity/users/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';

export function tmpDb(suite = 'suite') {
  return path.join(os.tmpdir(), `octagon-p02-${suite}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

export async function setup(suite = 'suite') {
  const dbPath = tmpDb(suite);
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  return { dialect, dbPath };
}

export async function cleanup(dialect, dbPath) {
  try { dialect.close(); } catch { /* already closed */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* not present */ }
  }
}

export const STRONG_PASSWORD = 'Alpha#Beta9!x';

/**
 * Seed the two-tenant isolation fixture described in source-lock.md § 2.
 * Returns stable ids for every actor and scope used across Phase 02 suites.
 */
export function seedOrg(dialect) {
  const now = new Date().toISOString();
  const t = dialect.prepare('INSERT INTO platform_tenants (id, name, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const c = dialect.prepare('INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(id) DO NOTHING');
  const b = dialect.prepare('INSERT INTO platform_branches (id, company_id, name, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');

  t.run('t_alpha', 'Alpha Tenant', 'active', now);
  t.run('t_beta', 'Beta Tenant', 'active', now);
  c.run('c_alpha_1', 't_alpha', 'Alpha Co 1', 'active', now);
  c.run('c_alpha_2', 't_alpha', 'Alpha Co 2', 'active', now);
  c.run('c_beta_1', 't_beta', 'Beta Co 1', 'active', now);
  b.run('b_alpha_1a', 'c_alpha_1', 'Alpha 1 Branch A', 'active', now);
  b.run('b_alpha_1b', 'c_alpha_1', 'Alpha 1 Branch B', 'active', now);
  b.run('b_beta_1a', 'c_beta_1', 'Beta 1 Branch A', 'active', now);

  dialect.prepare(`INSERT INTO organization_departments (id, company_id, name, status, created_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`)
    .run('dep_ops', 'c_alpha_1', 'Operations', now);
  dialect.prepare(`INSERT INTO organization_operating_scopes (id, company_id, kind, name, status, created_at) VALUES (?, ?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`)
    .run('wh_main', 'c_alpha_1', 'warehouse', 'Main Warehouse', now);

  const users = createUserDirectory(dialect);
  const memberships = createMembershipDirectory(dialect);

  const owner = users.create({ id: 'u_owner', tenantId: 't_alpha', login: 'owner', name: 'Owner', email: 'owner@example.com', password: STRONG_PASSWORD, isOwner: true });
  const manager = users.create({ id: 'u_manager', tenantId: 't_alpha', login: 'manager', name: 'Manager', email: 'manager@example.com', password: STRONG_PASSWORD });
  const clerk = users.create({ id: 'u_clerk', tenantId: 't_alpha', login: 'clerk', name: 'Clerk', email: 'clerk@example.com', password: STRONG_PASSWORD });
  const outsider = users.create({ id: 'u_outsider', tenantId: 't_alpha', login: 'outsider', name: 'Outsider', email: 'outsider@example.com', password: STRONG_PASSWORD });
  const beta = users.create({ id: 'u_beta', tenantId: 't_beta', login: 'beta', name: 'Beta User', email: 'beta@example.com', password: STRONG_PASSWORD });

  memberships.grant({ userId: owner.id, companyId: 'c_alpha_1', isDefault: true });
  memberships.grant({ userId: owner.id, companyId: 'c_alpha_2' });
  memberships.grant({ userId: manager.id, companyId: 'c_alpha_1', branchId: 'b_alpha_1a', departmentId: 'dep_ops', isDefault: true });
  const clerkMem = memberships.grant({ userId: clerk.id, companyId: 'c_alpha_1', branchId: 'b_alpha_1a', departmentId: 'dep_ops', isDefault: true });
  memberships.grant({ userId: beta.id, companyId: 'c_beta_1', isDefault: true });
  // u_outsider deliberately has a membership in c_alpha_2 only.
  memberships.grant({ userId: outsider.id, companyId: 'c_alpha_2', isDefault: true });

  const clerkMembershipId = clerkMem.find((m) => m.companyId === 'c_alpha_1').id;
  memberships.assignScope(clerkMembershipId, 'wh_main');

  return {
    tenantA: 't_alpha', tenantB: 't_beta',
    companyA1: 'c_alpha_1', companyA2: 'c_alpha_2', companyB1: 'c_beta_1',
    branchA1a: 'b_alpha_1a', branchA1b: 'b_alpha_1b', branchB1a: 'b_beta_1a',
    departmentOps: 'dep_ops', warehouseMain: 'wh_main',
    userOwner: owner.id, userManager: manager.id, userClerk: clerk.id,
    userOutsider: outsider.id, userBeta: beta.id,
    clerkMembershipId,
  };
}

/** Minimal ordered runner with per-test isolation and a non-zero exit on failure. */
export async function run(suiteName, tests) {
  let passed = 0;
  const failures = [];
  console.log(`\n=== ${suiteName} ===`);
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed++;
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL: ${name}\n      ${error?.stack || error}`);
    }
  }
  console.log(`\n${suiteName}: ${passed}/${tests.length} passed`);
  if (failures.length) {
    process.exitCode = 1;
    throw new Error(`${failures.length} test(s) failed in ${suiteName}`);
  }
}
