// Review Freeze 2 — disposable review identities.
//
// Review credentials are fail-closed to the disposable local review runtime:
//   1. OCTAGON_REVIEW_FIXTURE and OCTAGON_REVIEW_MODE must be exactly '1'.
//   2. NODE_ENV must not be 'production'.
//   3. The target database must be inside this checkout's .review-data path.
//   4. The review host must be loopback-only.
//
// The fixed default is explicitly disposable and is never used by production
// authentication. Plaintext is written only to the ignored local manifest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createUserDirectory } from '../../platform/identity/users/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { REVIEW_ROLES, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH, ISOLATION_TENANT, ISOLATION_COMPANY, ISOLATION_BRANCH } from './roles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const REVIEW_DATA_DIR = path.join(repoRoot, '.review-data');
const OPERATIONAL_PATHS = [
  path.join(repoRoot, 'database.db'),
  path.join(repoRoot, 'database.json'),
];

export class ReviewFixtureRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReviewFixtureRefused';
    this.code = code;
  }
}

export const REVIEW_TAG = 'octagon-review-build12-freeze-v2';
export const REVIEW_URL = 'http://localhost:8090';
export const REVIEW_BIND_HOST = '127.0.0.1';
// Explicitly labelled disposable local review default. It is hashed through
// the canonical identity password service before it reaches SQLite.
export const REVIEW_PASSWORD = 'Octagon123!';

export function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host || '').trim().toLowerCase());
}

export function assertReviewFixtureAllowed({ dbPath, env = process.env } = {}) {
  if (env.OCTAGON_REVIEW_FIXTURE !== '1') {
    throw new ReviewFixtureRefused(
      'review fixture requires OCTAGON_REVIEW_FIXTURE=1',
      'REVIEW_FLAG_REQUIRED',
    );
  }
  if (env.OCTAGON_REVIEW_MODE !== '1') {
    throw new ReviewFixtureRefused(
      'fixed review credentials require OCTAGON_REVIEW_MODE=1',
      'REVIEW_MODE_REQUIRED',
    );
  }
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new ReviewFixtureRefused(
      'review fixture must never run with NODE_ENV=production',
      'REVIEW_PRODUCTION_DENIED',
    );
  }
  if (!dbPath) {
    throw new ReviewFixtureRefused('review fixture requires an explicit dbPath', 'REVIEW_DBPATH_REQUIRED');
  }
  const resolved = path.resolve(dbPath);
  const relativeToReviewData = path.relative(REVIEW_DATA_DIR, resolved);
  if (!relativeToReviewData || relativeToReviewData.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToReviewData)) {
    throw new ReviewFixtureRefused(
      `fixed review credentials require a database inside .review-data: ${resolved}`,
      'REVIEW_DB_SCOPE_DENIED',
    );
  }
  for (const operational of OPERATIONAL_PATHS) {
    if (resolved === operational) {
      throw new ReviewFixtureRefused(
        `refusing to seed the operational database: ${resolved}`,
        'REVIEW_OPERATIONAL_DENIED',
      );
    }
  }
  const host = env.OCTAGON_REVIEW_HOST || REVIEW_BIND_HOST;
  if (!isLoopbackHost(host)) {
    throw new ReviewFixtureRefused(
      `fixed review credentials require a loopback host, received: ${host}`,
      'REVIEW_BINDING_DENIED',
    );
  }
  return true;
}

function nowIso() { return new Date().toISOString(); }

function ensureTenant(dialect, { id, name, now }) {
  dialect.prepare(`INSERT INTO platform_tenants (id, name, status, created_at)
    VALUES (?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`).run(id, name, now);
}

function ensureCompany(dialect, { id, tenantId, name, now }) {
  dialect.prepare(`INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at)
    VALUES (?, ?, ?, 'active', 1, ?) ON CONFLICT(id) DO NOTHING`).run(id, tenantId, name, now);
}

function ensureBranch(dialect, { id, companyId, name, now }) {
  dialect.prepare(`INSERT INTO platform_branches (id, company_id, name, status, created_at)
    VALUES (?, ?, ?, 'active', ?) ON CONFLICT(id) DO NOTHING`).run(id, companyId, name, now);
}

/**
 * Seed both review tenants/companies/branches, all 19 review identities,
 * their roles and grants. Idempotent — safe to call twice on the same
 * disposable database (review:reset always starts from a fresh DB anyway).
 */
export function seedReviewIdentities(dialect, { dbPath, env = process.env } = {}) {
  assertReviewFixtureAllowed({ dbPath, env });
  if (!dialect || typeof dialect.prepare !== 'function') {
    throw new ReviewFixtureRefused('a database dialect is required', 'REVIEW_DIALECT_REQUIRED');
  }

  const now = nowIso();

  ensureTenant(dialect, { id: REVIEW_TENANT, name: 'Octagon Review Tenant', now });
  ensureCompany(dialect, { id: REVIEW_COMPANY, tenantId: REVIEW_TENANT, name: 'Al-Warsha Demo Operations', now });
  ensureBranch(dialect, { id: REVIEW_BRANCH, companyId: REVIEW_COMPANY, name: 'Al-Warsha Demo Main Branch', now });

  ensureTenant(dialect, { id: ISOLATION_TENANT, name: 'Isolation Review Tenant', now });
  ensureCompany(dialect, { id: ISOLATION_COMPANY, tenantId: ISOLATION_TENANT, name: 'Second Demo Company', now });
  ensureBranch(dialect, { id: ISOLATION_BRANCH, companyId: ISOLATION_COMPANY, name: 'Second Demo Main Branch', now });

  const users = createUserDirectory(dialect);
  const memberships = createMembershipDirectory(dialect);

  const insertRole = dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'active', ?, ?) ON CONFLICT(id) DO NOTHING`);
  const insertGrant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, ?, ?, 'allow', ?, '[]', 0, ?, 'review-fixture') ON CONFLICT DO NOTHING`);
  const insertAssignment = dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, role_id, status, created_at, created_by)
    VALUES (?, ?, ?, 'active', ?, 'review-fixture') ON CONFLICT(id) DO NOTHING`);

  const created = [];

  for (const role of REVIEW_ROLES) {
    const tenantId = role.tenant || REVIEW_TENANT;
    const companyId = role.company || REVIEW_COMPANY;
    const branchId = role.branch || REVIEW_BRANCH;
    const scope = role.scope || 'all';
    const userId = `usr_review_${role.key}`;

    insertRole.run(role.roleId, tenantId, role.roleId, role.name, now, now);
    for (const permission of role.permissions) {
      const grantId = `grant_${role.roleId}_${permission.replace(/[^a-z0-9]+/gi, '_')}`;
      insertGrant.run(grantId, role.roleId, permission, scope, now);
    }

    let user = users.get(userId);
    if (!user) {
      user = users.create({
        id: userId,
        tenantId,
        login: role.login,
        name: role.name,
        email: `${role.login}@review.invalid`,
        password: REVIEW_PASSWORD,
        isOwner: !!role.isOwner,
      }, 'review-fixture');
      memberships.grant({ userId, companyId, branchId, isDefault: true });
    }

    insertAssignment.run(`asg_review_${role.key}`, userId, role.roleId, now);

    created.push({
      key: role.key,
      userId,
      login: role.login,
      name: role.name,
      role: role.name.replace(/^Review /, ''),
      permissions: role.permissions,
      tenantId,
      companyId,
      isOwner: !!role.isOwner,
    });
  }

  return {
    users: created,
    password: REVIEW_PASSWORD,
    reviewTenantId: REVIEW_TENANT,
    reviewCompanyId: REVIEW_COMPANY,
    reviewBranchId: REVIEW_BRANCH,
    isolationTenantId: ISOLATION_TENANT,
    isolationCompanyId: ISOLATION_COMPANY,
    isolationBranchId: ISOLATION_BRANCH,
  };
}

/**
 * Write the fixed shared password and seeded logins to a local, git-ignored
 * manifest. This is the only plaintext credential output.
 */
export function writeReviewManifest(targetPath, seeded) {
  const payload = {
    environment: 'DISPOSABLE LOCAL REVIEW ONLY',
    reviewTag: REVIEW_TAG,
    url: REVIEW_URL,
    sharedPassword: seeded.password,
    warning: 'Fixed password for the pre-adoption review phase only. Never use in production or remote deployments.',
    reviewTenantId: seeded.reviewTenantId,
    reviewCompanyId: seeded.reviewCompanyId,
    isolationTenantId: seeded.isolationTenantId,
    isolationCompanyId: seeded.isolationCompanyId,
    accounts: seeded.users.map((u) => ({ username: u.login, role: u.role, tenantId: u.tenantId })),
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return targetPath;
}
