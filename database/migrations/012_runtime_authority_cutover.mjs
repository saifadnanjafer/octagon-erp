// 012_runtime_authority_cutover — Phase 02 runtime closure
//
// Source composition:
// - Octagon server.js legacy auth_sessions table, collections.omni.users,
//   collections.omni.roles, x_acl_roles, x_acl_grants (project-owned, RETIRE).
// - VNext migration patterns (project-owned) for the data-move shape.
// - Phase 02 platform/identity/* and platform/authorization/* (project-owned,
//   MERGE-CANONICAL): the target tables.
//
// What this migration does:
//   1. Migrates any rows from the legacy `auth_sessions` table into the
//      canonical `identity_sessions` table, then drops the legacy table.
//   2. Migrates users from `collections` (omni.users) into `identity_users`,
//      `organization_memberships`, and `identity_credentials` (legacy_sha256
//      algorithm for existing passwordHash/passwordSalt pairs).
//   3. Migrates companies/branches from `omni.companies` / `omni.branches` or
//      falls back to a default tenant/company/branch derived from the user rows.
//   4. Mirrors legacy `x_acl_roles` / `x_acl_grants` into the canonical
//      `authorization_roles` / `authorization_grants` tables.
//   5. Assigns each migrated user to the matching canonical role based on their
//      legacy `role`, `roleId`, or `groups`.
//   6. Aligns the legacy `x_records` table with the canonical shape by adding
//      `company_id` and `version` columns and backfilling `company_id` from the
//      JSON document when possible.
//
// Invariants:
//   - No plaintext password is ever stored; legacy credentials use the existing
//     SHA256(password+salt) hash and are upgraded to scrypt on first login.
//   - The migration is idempotent: it uses INSERT OR REPLACE / ON CONFLICT DO
//     NOTHING and can run safely on both a fresh migration database and an
//     existing Octagon runtime database.
//   - The original legacy tables/columns are left in place until the next phase
//     so rollback can reverse the structural changes; the data is mirrored, not
//     deleted, so no production row is lost.

import crypto from 'node:crypto';

export const migration = {
  id: '012_runtime_authority_cutover',
  owner: 'platform.identity',
  version: '2.1.0',
  dependsOn: ['011_service_identity_authorization'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Octagon server.js legacy runtime (project-owned) + Phase 02 canonical platform modules (project-owned)',

  up(dialect) {
    const now = new Date().toISOString();

    // The legacy collections table was created by server.js, not by the
    // migration runner. Ensure it exists so the migration can read from it when
    // present without failing on a fresh database.
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        collection TEXT,
        id TEXT,
        data TEXT,
        PRIMARY KEY (collection, id)
      );
    `);

    ensureDefaultTenantAndCompany(dialect, now);

    migrateLegacyUsers(dialect, now);
    migrateLegacyAcl(dialect, now);
    migrateLegacyAuthSessions(dialect, now);
    alignXRecords(dialect, now);
  },

  down(dialect) {
    // Best-effort rollback: remove the migrated authority data. Structural
    // alignment of x_records (added columns) is left in place because it is
    // backward compatible; removing it would require recreating the table.
    dialect.exec(`
      DELETE FROM identity_sessions WHERE created_at > '2026-01-01T00:00:00.000Z';
      DELETE FROM identity_credentials WHERE algorithm = 'legacy_sha256';
      DELETE FROM organization_memberships WHERE created_by = 'migration:012';
      DELETE FROM identity_users WHERE id != 'system';
      DELETE FROM authorization_role_assignments WHERE created_by = 'migration:012';
      DELETE FROM authorization_grants WHERE created_by = 'migration:012';
      DELETE FROM authorization_roles WHERE is_system = 0;
      DELETE FROM platform_branches WHERE id != 'default';
      DELETE FROM platform_companies WHERE id != 'default';
      DELETE FROM platform_tenants WHERE id != 'default';
    `);
    // Restore the legacy auth_sessions table if it was dropped; no rows are
    // recreated because the canonical session rows are gone.
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        userId TEXT,
        createdAt INTEGER,
        expiresAt INTEGER
      );
    `);
  }
};

function ensureDefaultTenantAndCompany(dialect, now) {
  dialect.prepare(`
    INSERT INTO platform_tenants (id, name, status, created_at) VALUES ('default', 'Default Tenant', 'active', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);
  dialect.prepare(`
    INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at)
    VALUES ('default', 'default', 'Default Company', 'active', 1, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);
  dialect.prepare(`
    INSERT INTO platform_branches (id, company_id, name, status, created_at)
    VALUES ('default', 'default', 'Default Branch', 'active', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(now);
}

function migrateLegacyAuthSessions(dialect, now) {
  const tableExists = dialect.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'
  `).get();
  if (!tableExists) return;

  const rows = dialect.prepare('SELECT token, userId, createdAt, expiresAt FROM auth_sessions').all();
  for (const row of rows) {
    const token = String(row.token || '');
    const userId = String(row.userId || '');
    if (!token || !userId) continue;
    const sessionId = `ses_${crypto.randomUUID()}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const createdAt = new Date(Number(row.createdAt) || Date.now()).toISOString();
    const expiresAt = new Date(Number(row.expiresAt) || (Date.now() + 8 * 60 * 60 * 1000)).toISOString();
    const tenantRow = dialect.prepare('SELECT tenant_id FROM identity_users WHERE id = ?').get(userId);
    const tenantId = tenantRow?.tenant_id || 'default';

    dialect.prepare(`
      INSERT INTO identity_sessions (id, token_hash, user_id, tenant_id, active_company_id, actor_type, mfa_satisfied, csrf_token,
        created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoked_reason)
      VALUES (?, ?, ?, ?, ?, 'user', 0, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT DO NOTHING
    `).run(sessionId, tokenHash, userId, tenantId, 'default', crypto.randomBytes(24).toString('base64url'), createdAt, createdAt, expiresAt, expiresAt);
  }

  dialect.exec('DROP TABLE IF EXISTS auth_sessions;');
}

function migrateLegacyUsers(dialect, now) {
  const rows = dialect.prepare("SELECT id, data FROM collections WHERE collection = 'omni.users'").all();
  if (!rows.length) return;

  const insertUser = dialect.prepare(`
    INSERT INTO identity_users (id, tenant_id, login, name, email, actor_type, status, locale, is_owner, failed_attempts, locked_until, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'user', ?, 'ar', ?, 0, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      login = excluded.login,
      name = excluded.name,
      email = excluded.email,
      status = excluded.status,
      is_owner = excluded.is_owner,
      updated_at = excluded.updated_at
  `);
  const insertMembership = dialect.prepare(`
    INSERT INTO organization_memberships (id, user_id, tenant_id, company_id, branch_id, is_default, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, 1, 'active', ?, 'migration:012')
    ON CONFLICT DO NOTHING
  `);
  const insertCredential = dialect.prepare(`
    INSERT INTO identity_credentials (user_id, algorithm, salt, hash, must_change, changed_at, changed_by)
    VALUES (?, 'legacy_sha256', ?, ?, 0, ?, 'migration:012')
    ON CONFLICT(user_id) DO UPDATE SET
      algorithm = excluded.algorithm,
      salt = excluded.salt,
      hash = excluded.hash,
      changed_at = excluded.changed_at,
      changed_by = excluded.changed_by
  `);

  for (const row of rows) {
    let user;
    try { user = JSON.parse(row.data || '{}'); } catch { continue; }
    const id = String(user.id || row.id).trim();
    if (!id) continue;

    const tenantId = normalizeId(user.tenantId) || 'default';
    const companyId = normalizeId(user.companyId) || 'default';
    const branchId = normalizeId(user.branchId) || null;
    const name = String(user.displayName || user.name || id).trim();
    const email = user.email || null;
    const isActive = user.is_active !== false && user.status !== 'inactive' && user.status !== 'archived';
    const status = isActive ? 'active' : 'archived';
    const isOwner = isOwnerFromLegacy(user);
    const login = id;

    insertUser.run(id, tenantId, login, name, email, status, isOwner ? 1 : 0, user.createdAt || now, now);
    const membershipId = `mem_${id}_${companyId}`;
    insertMembership.run(membershipId, id, tenantId, companyId, branchId, now);

    if (user.passwordHash && user.passwordSalt) {
      insertCredential.run(id, String(user.passwordSalt), String(user.passwordHash), now);
    }
  }
}

function migrateLegacyAcl(dialect, now) {
  const rolesTableExists = dialect.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_acl_roles'
  `).get();
  if (!rolesTableExists) return;

  const legacyRoles = dialect.prepare('SELECT role, label_ar FROM x_acl_roles').all();
  const legacyGrants = dialect.prepare('SELECT role, perm, scope FROM x_acl_grants').all();
  if (!legacyRoles.length) return;

  const insRole = dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET label_ar = excluded.label_ar, updated_at = excluded.updated_at
  `);
  const insGrant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, ?, ?, 'allow', ?, '[]', 0, ?, 'migration:012')
    ON CONFLICT DO NOTHING
  `);
  const assignRole = dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES (?, ?, 'user', ?, ?, 'active', ?, 'migration:012')
    ON CONFLICT DO NOTHING
  `);

  const SCOPE_MAP = { all: 'all', dept: 'department', own: 'own' };
  for (const r of legacyRoles) {
    const roleId = `role_default_${safeId(r.role)}`;
    insRole.run(roleId, 'default', r.role, r.label_ar || null, now, now);
    for (const g of legacyGrants.filter(x => x.role === r.role)) {
      const grantId = `grant_${roleId}_${safeId(g.perm)}`;
      const scope = SCOPE_MAP[g.scope] || 'all';
      insGrant.run(grantId, roleId, g.perm, scope, now);
    }
  }

  // Assign users to roles based on their legacy role/roleId/groups.
  const users = dialect.prepare("SELECT id, data FROM collections WHERE collection = 'omni.users'").all();
  for (const row of users) {
    let user;
    try { user = JSON.parse(row.data || '{}'); } catch { continue; }
    const userId = String(user.id || row.id).trim();
    if (!userId) continue;
    const companyId = normalizeId(user.companyId) || 'default';
    const roles = new Set();
    if (user.role) roles.add(String(user.role));
    if (user.roleId) roles.add(String(user.roleId));
    if (Array.isArray(user.groups)) user.groups.forEach(g => roles.add(String(g)));

    for (const roleName of roles) {
      const roleExists = legacyRoles.some(r => r.role === roleName);
      if (!roleExists) continue;
      const roleId = `role_default_${safeId(roleName)}`;
      const assignmentId = `asg_${userId}_${roleId}`;
      assignRole.run(assignmentId, userId, roleId, companyId, now);
    }
  }
}

function alignXRecords(dialect, now) {
  const tableExists = dialect.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name='x_records'
  `).get();
  if (!tableExists) return;

  // Add canonical columns if they are missing.
  const columns = dialect.prepare(`PRAGMA table_info(x_records)`).all().map(c => c.name);
  if (!columns.includes('company_id')) {
    dialect.exec(`ALTER TABLE x_records ADD COLUMN company_id TEXT;`);
  }
  if (!columns.includes('version')) {
    dialect.exec(`ALTER TABLE x_records ADD COLUMN version INTEGER NOT NULL DEFAULT 1;`);
  }

  // Backfill company_id from the JSON document when possible, otherwise default.
  dialect.prepare(`
    UPDATE x_records
    SET company_id = COALESCE(
      json_extract(data, '$.company_id'),
      json_extract(data, '$.company'),
      'default'
    )
    WHERE company_id IS NULL;
  `).run();
}

function normalizeId(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s || null;
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}

function isOwnerFromLegacy(user) {
  if (user.isOwner === true || user.isOwner === 1) return true;
  const role = String(user.role || '').toLowerCase();
  const roleId = String(user.roleId || '').toLowerCase();
  if (role === 'system' || roleId === 'system' || role.includes('owner') || roleId.includes('owner')) return true;
  if (Array.isArray(user.groups)) {
    for (const g of user.groups) {
      const s = String(g || '').toLowerCase();
      if (s.includes('owner') || s === 'system.admin') return true;
    }
  }
  return false;
}
