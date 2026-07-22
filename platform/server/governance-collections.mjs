// Governance collection cutover — Phase 02 final closure.
//
// This module is the SINGLE adapter layer between the legacy Octagon state
// blob (employees/finance/omni/config JSON persisted through saveData()) and
// the canonical Phase 02 platform tables. It is used by exactly two callers:
//
//   1. database/migrations/013_governance_collection_cutover.mjs — one-way
//      import of existing blob rows into the canonical tables, then removal
//      of the governed rows from the legacy `collections`/`metadata` tables.
//   2. platform/server/governance-strangler.mjs — the runtime write/read
//      path wired into server.js saveDbToSqlite()/loadDbFromSqlite().
//
// After the cutover the legacy blob tables are NO LONGER an authority for any
// governed path: writes are synced into the canonical tables and stripped
// from the blob payload inside the same SQLite transaction, and reads are
// projected back from the canonical tables so legacy client readers keep
// working as documented compatibility readers.
//
// Transaction discipline: every helper in this module is transaction-less.
// Callers own the transaction (the migration runner for 013, saveDbToSqlite
// for runtime writes) so a governance sync and the remaining blob write
// commit or roll back together.
//
// Credential invariant: plaintext passwords are never accepted here. Legacy
// passwordHash/passwordSalt pairs are imported once as legacy_sha256
// credentials (ON CONFLICT DO NOTHING — a canonical credential is never
// overwritten from the blob) and are NEVER projected back to any client.

'use strict';

import crypto from 'node:crypto';
import { mapLegacyRoles } from '../identity/users/index.mjs';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Path helpers (dot-separated, same convention as server.js get/setNestedPath)
// ---------------------------------------------------------------------------

export function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

export function deletePath(obj, path) {
  const keys = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur == null || typeof cur !== 'object') return;
    cur = cur[keys[i]];
  }
  if (cur && typeof cur === 'object') delete cur[keys[keys.length - 1]];
}

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 64);
}

function stableRecordId(record, prefix) {
  if (record && record.id !== undefined && record.id !== null && String(record.id) !== '') {
    return String(record.id);
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(record || {})).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function auditBatch(dialect, actor, action, resourceId, detail) {
  dialect.prepare(`
    INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
    VALUES (?, ?, 'user', ?, 'governance_cutover', ?, ?, 'strangler', 'success', ?)
  `).run(crypto.randomUUID(), actor || 'system', action, resourceId, now(), JSON.stringify(detail || {}));
}

// ---------------------------------------------------------------------------
// Governed domains. Each domain owns a set of legacy blob paths and knows how
// to sync them into canonical tables and project them back. The `owner`,
// `canonicalWriter` and `removalCriterion` fields feed the cutover evidence.
// ---------------------------------------------------------------------------

export const GOVERNED_DOMAINS = [
  {
    id: 'authorization_roles',
    paths: ['omni.roles', 'omni.permissions', 'omni.userRoles'],
    owner: 'platform.authorization',
    canonicalWriter: 'authorization_roles / authorization_grants / authorization_permissions / authorization_role_assignments',
    removalCriterion: 'client permissionService resolves from the server bootstrap only; blob projection retired',
  },
  {
    // Identity runs AFTER roles so the mirrored role rows exist when user
    // role assignments are written.
    id: 'identity_users',
    paths: ['users', 'omni.users'],
    owner: 'platform.identity',
    canonicalWriter: 'identity_users / organization_memberships / identity_credentials / authorization_role_assignments',
    removalCriterion: 'client admin user UI reads and writes only through /api/v1 identity endpoints; blob projection retired',
  },
  {
    id: 'settings',
    paths: ['omni.adminSettings'],
    owner: 'platform.settings',
    canonicalWriter: 'settings_values / settings_history (key octagon.legacy.admin_settings)',
    removalCriterion: 'admin settings UI uses scoped settings API; json mirror key retired',
  },
  {
    id: 'notifications',
    paths: ['omni.notifications'],
    owner: 'platform.notifications',
    canonicalWriter: 'notifications (dedupe_key omni:<id>)',
    removalCriterion: 'inbox UI reads the notification service only; blob projection retired',
  },
  {
    id: 'approvals',
    paths: ['omni.requests', 'omni.approvalHub'],
    owner: 'platform.approvals',
    canonicalWriter: 'approval_requests / approval_decisions / worklist_items (id prefix omni_)',
    removalCriterion: 'requests and approval-hub UIs call the approval engine endpoints; blob projection retired',
  },
  {
    id: 'workflows',
    paths: ['omni.workflow', 'omni.workflows', 'omni.workflowHistory'],
    owner: 'platform.workflow',
    canonicalWriter: 'x_records entities legacy_workflow / legacy_workflows / legacy_workflow_history (verbatim graph documents)',
    removalCriterion: 'workflow builder adopts workflow_definitions semantics; verbatim documents migrated',
  },
  {
    id: 'audit_logs',
    paths: ['omni.systemLog', 'omni.historyLedger', 'audit_log'],
    owner: 'platform.collaboration',
    canonicalWriter: 'x_records entities legacy_system_log / legacy_history_ledger / legacy_audit_log',
    removalCriterion: 'log viewers read record_history / platform_audit_log; verbatim stores retired',
  },
  {
    id: 'documents',
    paths: ['omni.documents'],
    owner: 'platform.files',
    canonicalWriter: 'x_records entity legacy_documents (metadata; binaries stay behind the permission-gated /api/upload route)',
    removalCriterion: 'document library registers file_objects/file_attachments; verbatim store retired',
  },
  {
    id: 'automation',
    paths: ['omni.automationRules', 'omni.automationFireLog'],
    owner: 'platform.jobs',
    canonicalWriter: 'x_records entities legacy_automation_rules / legacy_automation_fire_log',
    removalCriterion: 'automation UI adopts automation_rules/job_runs semantics; verbatim stores retired',
  },
];

export const GOVERNED_PATHS = GOVERNED_DOMAINS.flatMap((d) => d.paths);

export function isGovernedPath(path) {
  return GOVERNED_PATHS.includes(path);
}

// ---------------------------------------------------------------------------
// Definition registration (idempotent). Used by migration 013 and by the
// runtime bridge before the first strangler sync.
// ---------------------------------------------------------------------------

const ADMIN_SETTINGS_KEY = 'octagon.legacy.admin_settings';

const X_RECORD_ENTITIES = [
  { id: 'legacy_workflow', label: 'Legacy workflow working copy' },
  { id: 'legacy_workflows', label: 'Legacy workflow definitions' },
  { id: 'legacy_workflow_history', label: 'Legacy workflow version history' },
  { id: 'legacy_system_log', label: 'Legacy system log' },
  { id: 'legacy_history_ledger', label: 'Legacy history ledger' },
  { id: 'legacy_audit_log', label: 'Legacy audit log' },
  { id: 'legacy_documents', label: 'Legacy document library' },
  { id: 'legacy_automation_rules', label: 'Legacy automation rules' },
  { id: 'legacy_automation_fire_log', label: 'Legacy automation fire log' },
];

export function ensureGovernanceDefinitions(dialect, actor = 'platform_bridge') {
  const ts = now();
  dialect.prepare(`
    INSERT INTO platform_settings (key, module_id, type, default_value, scopes, overridable_scopes,
      required_permission, audit_policy, secret, restart_required, validation_rules, created_at, updated_at)
    VALUES (?, 'platform_kernel', 'json', NULL, '["system"]', '{}', 'platform:db:write', 'required', 0, 0, '[]', ?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run(ADMIN_SETTINGS_KEY, ts, ts);

  const ins = dialect.prepare(`
    INSERT INTO platform_entities (id, module_id, storage_owner, primary_key, label_ar, label_en, section,
      sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
      lifecycle_policy, query_policy, action_policy, customization_policy,
      history_policy, api_exposed, migration_owner, created_at, updated_at)
    VALUES (?, 'platform_kernel', 'platform.data', 'id', ?, ?, 'governance',
      NULL, NULL, 0, NULL, NULL, '{}', '{}', 'company',
      'generic', 'scoped', 'registered', 'metadata',
      'audit', 0, 'migration:013', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const entity of X_RECORD_ENTITIES) {
    ins.run(entity.id, entity.label, entity.label, ts, ts);
  }
  auditBatch(dialect, actor, 'governance.definitions', 'definitions', { entities: X_RECORD_ENTITIES.length });
}

// ---------------------------------------------------------------------------
// Domain: identity users
// ---------------------------------------------------------------------------

function mergeIncomingUsers(db) {
  const merged = new Map();
  for (const u of asArray(getPath(db, 'users'))) {
    if (u && u.id !== undefined) merged.set(String(u.id), u);
  }
  for (const u of asArray(getPath(db, 'omni.users'))) {
    if (u && u.id !== undefined) merged.set(String(u.id), u);
  }
  return [...merged.values()];
}

/**
 * Legacy users may reference company/branch ids that never existed in the
 * platform control plane (client-generated profile ids). Create the rows on
 * demand so membership foreign keys hold (same rule as migration 012).
 */
function ensureOrgRows(dialect, companyId, branchId, ts) {
  if (companyId && companyId !== 'default') {
    dialect.prepare(`
      INSERT INTO platform_companies (id, tenant_id, name, status, fiscal_year_start, created_at)
      VALUES (?, 'default', ?, 'active', 1, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(companyId, `Legacy company ${companyId}`, ts);
  }
  if (branchId && branchId !== 'default') {
    dialect.prepare(`
      INSERT INTO platform_branches (id, company_id, name, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
      ON CONFLICT(id) DO NOTHING
    `).run(branchId, companyId || 'default', `Legacy branch ${branchId}`, ts);
  }
}

function legacyUserStatus(user) {  if (user.is_active === false || user.status === 'inactive' || user.status === 'archived' || user.status === 'suspended') return 'archived';
  return 'active';
}

function isOwnerLegacy(user) {
  if (user.isOwner === true || user.isOwner === 1) return true;
  const role = String(user.role || '').toLowerCase();
  const roleId = String(user.roleId || '').toLowerCase();
  if (role === 'system' || roleId === 'system' || role.includes('owner') || roleId.includes('owner')) return true;
  return asArray(user.groups).some((g) => String(g).toLowerCase().includes('owner') || String(g) === 'system.admin');
}

function syncIdentityUsers(dialect, db, ctx) {
  const actor = ctx?.actorId || 'system';
  const incoming = mergeIncomingUsers(db);
  const incomingIds = new Set(incoming.map((u) => String(u.id)));
  const ts = now();

  const upsertUser = dialect.prepare(`
    INSERT INTO identity_users (id, tenant_id, login, name, email, actor_type, status, locale, is_owner, failed_attempts, locked_until, created_at, updated_at)
    VALUES (?, 'default', ?, ?, ?, 'user', ?, 'ar', ?, 0, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      status = excluded.status,
      is_owner = excluded.is_owner,
      updated_at = excluded.updated_at
  `);
  const upsertMembership = dialect.prepare(`
    INSERT INTO organization_memberships (id, user_id, tenant_id, company_id, branch_id, is_default, status, created_at, created_by)
    VALUES (?, ?, 'default', ?, ?, 1, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET company_id = excluded.company_id, branch_id = excluded.branch_id
  `);
  const insertCredential = dialect.prepare(`
    INSERT INTO identity_credentials (user_id, algorithm, salt, hash, must_change, changed_at, changed_by)
    VALUES (?, 'legacy_sha256', ?, ?, 0, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `);
  const assignRole = dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES (?, ?, 'user', ?, ?, 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const roleExists = dialect.prepare("SELECT 1 FROM authorization_roles WHERE id = ? AND status = 'active'");

  let upserted = 0;
  for (const user of incoming) {
    const id = String(user.id).trim();
    if (!id || id === 'system') continue;
    const name = String(user.displayName || user.name || id).trim();
    const email = user.email || null;
    const status = legacyUserStatus(user);
    const owner = isOwnerLegacy(user);
    const companyId = String(user.companyId || '').trim() || 'default';
    const branchId = String(user.branchId || '').trim() || null;
    ensureOrgRows(dialect, companyId, branchId, ts);

    // Never let a blob sync archive the last active owner (lockout guard).
    const existing = dialect.prepare('SELECT is_owner, status FROM identity_users WHERE id = ?').get(id);
    let nextStatus = status;
    if (existing && existing.is_owner === 1 && status !== 'active') {
      const owners = dialect.prepare("SELECT COUNT(*) AS n FROM identity_users WHERE is_owner = 1 AND status = 'active'").get();
      if (Number(owners?.n || 0) <= 1) nextStatus = 'active';
    }

    upsertUser.run(id, id, name, email, nextStatus, owner ? 1 : 0, user.createdAt || ts, ts);
    upsertMembership.run(`mem_${safeId(id)}_${safeId(companyId)}`, id, companyId, branchId, ts, actor);
    upserted += 1;

    // One-way credential import only: never overwrite a canonical credential.
    if (user.passwordHash && user.passwordSalt) {
      insertCredential.run(id, String(user.passwordSalt), String(user.passwordHash), ts, actor);
    }

    // Role assignments: canonical mapped roles (where the role exists) plus the
    // legacy-mirrored role row used for blob projection.
    const legacyRoleIds = new Set();
    if (user.roleId) legacyRoleIds.add(String(user.roleId));
    if (user.role) legacyRoleIds.add(String(user.role));
    for (const roleId of legacyRoleIds) {
      const mirrored = `role_omni_${safeId(roleId)}`;
      if (roleExists.get(mirrored)) {
        assignRole.run(`asg_omni_${safeId(id)}_${safeId(roleId)}`, id, mirrored, companyId, ts, actor);
      }
    }
    for (const token of mapLegacyRoles(user)) {
      const canonical = `role_default_${safeId(token)}`;
      if (roleExists.get(canonical)) {
        assignRole.run(`asg_map_${safeId(id)}_${safeId(token)}`, id, canonical, companyId, ts, actor);
      }
    }
    if (owner && roleExists.get('role_default_owner')) {
      assignRole.run(`asg_${safeId(id)}_owner`, id, 'role_default_owner', null, ts, actor);
    }

    // Retire stale legacy-mirror assignments for this user.
    const keep = new Set([...legacyRoleIds].map((r) => `asg_omni_${safeId(id)}_${safeId(r)}`));
    const stale = dialect.prepare("SELECT id FROM authorization_role_assignments WHERE user_id = ? AND id LIKE 'asg_omni_%'").all(id);
    for (const row of stale) {
      if (!keep.has(row.id)) dialect.prepare('DELETE FROM authorization_role_assignments WHERE id = ?').run(row.id);
    }
  }

  // Archive non-owner users that disappeared from the blob (soft delete;
  // sessions are revoked by the identity authority invariant).
  const managed = dialect.prepare("SELECT id, is_owner FROM identity_users WHERE id != 'system'").all();
  let archived = 0;
  for (const row of managed) {
    if (incomingIds.has(row.id) || row.is_owner === 1) continue;
    dialect.prepare("UPDATE identity_users SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'active'").run(ts, row.id);
    dialect.prepare("UPDATE identity_sessions SET revoked_at = ?, revoked_reason = 'user_archived_by_sync' WHERE user_id = ? AND revoked_at IS NULL").run(ts, row.id);
    archived += 1;
  }

  auditBatch(dialect, actor, 'governance.sync.identity_users', 'identity', { upserted, archived });
}

function projectIdentityUsers(dialect, db) {
  const rows = dialect.prepare(`
    SELECT u.id, u.tenant_id, u.login, u.name, u.email, u.status, u.is_owner, u.created_at,
      (SELECT company_id FROM organization_memberships m WHERE m.user_id = u.id AND m.is_default = 1 LIMIT 1) AS company_id,
      (SELECT branch_id FROM organization_memberships m WHERE m.user_id = u.id AND m.is_default = 1 LIMIT 1) AS branch_id
    FROM identity_users u
    WHERE u.actor_type = 'user' AND u.status != 'archived' AND u.id != 'system'
    ORDER BY u.login
  `).all();
  const assignmentRows = dialect.prepare("SELECT user_id, role_id FROM authorization_role_assignments WHERE id LIKE 'asg_omni_%' AND status = 'active'").all();
  const rolesByUser = new Map();
  for (const row of assignmentRows) {
    const legacyRole = String(row.role_id).replace(/^role_omni_/, '');
    if (!rolesByUser.has(row.user_id)) rolesByUser.set(row.user_id, []);
    rolesByUser.get(row.user_id).push(legacyRole);
  }

  const users = rows.map((row) => {
    const legacyRoles = rolesByUser.get(row.id) || [];
    const roleId = legacyRoles[0] || (row.is_owner ? 'system_admin' : 'employee');
    const groups = row.is_owner ? ['system.admin'] : [];
    return {
      id: row.id,
      login: row.login,
      displayName: row.name,
      name: row.name,
      email: row.email || '',
      role: roleId,
      roleId,
      groups,
      status: row.status === 'active' ? 'active' : 'inactive',
      is_active: row.status === 'active',
      isOwner: row.is_owner === 1,
      companyId: row.company_id || 'default',
      branchId: row.branch_id || '',
      tenantId: row.tenant_id || 'default',
      createdAt: row.created_at,
      source: 'canonical_projection',
    };
  });

  setPath(db, 'users', users);
  setPath(db, 'omni.users', users.map((u) => ({ ...u })));
}

// ---------------------------------------------------------------------------
// Domain: roles / permissions / user-role links
// ---------------------------------------------------------------------------

const PERMISSION_TOKEN_RE = /^[A-Za-z0-9_.:*-]{1,120}$/;

function syncRoles(dialect, db, ctx) {
  const actor = ctx?.actorId || 'system';
  const roles = asArray(getPath(db, 'omni.roles'));
  const permissionsMap = getPath(db, 'omni.permissions') || {};
  const userRoles = asArray(getPath(db, 'omni.userRoles'));
  const ts = now();

  const insPermission = dialect.prepare(`
    INSERT INTO authorization_permissions (id, module_id, kind, resource, action, label_ar, label_en, created_at, updated_at)
    VALUES (?, 'platform_kernel', 'action', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const upsertRole = dialect.prepare(`
    INSERT INTO authorization_roles (id, tenant_id, name, label_ar, is_system, status, created_at, updated_at)
    VALUES (?, 'default', ?, ?, 0, 'active', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, label_ar = excluded.label_ar, status = 'active', updated_at = excluded.updated_at
  `);
  const deleteGrants = dialect.prepare("DELETE FROM authorization_grants WHERE role_id = ? AND id LIKE 'grant_omni_%'");
  const insGrant = dialect.prepare(`
    INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
    VALUES (?, ?, ?, 'allow', 'all', '[]', 0, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  const keepRoleIds = new Set();
  for (const role of roles) {
    if (!role || role.id === undefined) continue;
    const legacyId = String(role.id);
    const roleId = `role_omni_${safeId(legacyId)}`;
    keepRoleIds.add(roleId);
    // The name is namespaced (`omni:<legacyId>`) because authorization_roles
    // enforces UNIQUE(tenant_id, name) and migration 012 already mirrors
    // legacy x_acl roles under the plain legacy name.
    upsertRole.run(roleId, `omni:${legacyId}`, String(role.name || legacyId), ts, ts);

    const tokens = new Set([
      ...asArray(role.permissions),
      ...asArray(permissionsMap[legacyId]),
    ].map((t) => String(t)).filter((t) => PERMISSION_TOKEN_RE.test(t)));

    deleteGrants.run(roleId);
    let i = 0;
    for (const token of tokens) {
      const [resource, action] = token.includes(':') ? token.split(':', 2) : ['legacy', token];
      insPermission.run(token, resource || 'legacy', action || token, token, token, ts, ts);
      insGrant.run(`grant_omni_${safeId(legacyId)}_${i}`, roleId, token, ts, actor);
      i += 1;
    }
  }

  // Retire mirrored roles that disappeared from the blob.
  const mirrored = dialect.prepare("SELECT id FROM authorization_roles WHERE id LIKE 'role_omni_%' AND status = 'active'").all();
  for (const row of mirrored) {
    if (!keepRoleIds.has(row.id)) {
      dialect.prepare("UPDATE authorization_roles SET status = 'retired', updated_at = ? WHERE id = ?").run(ts, row.id);
    }
  }

  // Legacy user-role links not already covered by the identity sync.
  const assignRole = dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES (?, ?, 'user', ?, 'default', 'active', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const roleExists = dialect.prepare("SELECT 1 FROM authorization_roles WHERE id = ? AND status = 'active'");
  const userExists = dialect.prepare('SELECT 1 FROM identity_users WHERE id = ?');
  for (const link of userRoles) {
    if (!link || !link.userId || !link.roleId) continue;
    const mirrored = `role_omni_${safeId(link.roleId)}`;
    if (!roleExists.get(mirrored) || !userExists.get(String(link.userId))) continue;
    assignRole.run(`asg_omni_${safeId(link.userId)}_${safeId(link.roleId)}`, String(link.userId), mirrored, ts, actor);
  }

  auditBatch(dialect, actor, 'governance.sync.roles', 'authorization', { roles: keepRoleIds.size, links: userRoles.length });
}

function projectRoles(dialect, db) {
  const roles = dialect.prepare("SELECT id, name, label_ar FROM authorization_roles WHERE id LIKE 'role_omni_%' AND status = 'active' ORDER BY name").all();
  const grants = dialect.prepare("SELECT role_id, permission FROM authorization_grants WHERE id LIKE 'grant_omni_%'").all();
  const grantsByRole = new Map();
  for (const g of grants) {
    if (!grantsByRole.has(g.role_id)) grantsByRole.set(g.role_id, []);
    grantsByRole.get(g.role_id).push(g.permission);
  }

  const legacyRoles = roles.map((row) => {
    const legacyId = String(row.name || '').replace(/^omni:/, '') || String(row.id).replace(/^role_omni_/, '');
    return {
      id: legacyId,
      name: row.label_ar || legacyId,
      permissions: grantsByRole.get(row.id) || [],
      groups: [],
      source: 'canonical_projection',
    };
  });

  const permissions = {};
  for (const role of legacyRoles) permissions[role.id] = role.permissions.slice();

  const assignments = dialect.prepare("SELECT user_id, role_id, created_at FROM authorization_role_assignments WHERE id LIKE 'asg_omni_%' AND status = 'active'").all();
  const userRoles = assignments.map((row) => ({
    userId: row.user_id,
    roleId: String(row.role_id).replace(/^role_omni_/, ''),
    source: 'canonical_projection',
    createdAt: row.created_at,
  }));

  setPath(db, 'omni.roles', legacyRoles);
  setPath(db, 'omni.permissions', permissions);
  setPath(db, 'omni.userRoles', userRoles);
}

// ---------------------------------------------------------------------------
// Domain: admin settings (single versioned JSON value in the settings tables)
// ---------------------------------------------------------------------------

function syncAdminSettings(dialect, db, ctx) {
  const actor = ctx?.actorId || 'system';
  const value = getPath(db, 'omni.adminSettings');
  if (value === undefined) return;
  const ts = now();
  const serialized = JSON.stringify(value ?? {});
  const existing = dialect.prepare('SELECT id, value, version FROM settings_values WHERE key = ? AND scope = ? AND scope_id = ?').get(ADMIN_SETTINGS_KEY, 'system', '');
  const nextVersion = existing ? Number(existing.version) + 1 : 1;
  if (existing && existing.value === serialized) return; // no-op sync
  dialect.prepare(`
    INSERT INTO settings_values (id, key, scope, scope_id, value, version, updated_at, updated_by)
    VALUES (?, ?, 'system', '', ?, ?, ?, ?)
    ON CONFLICT(key, scope, scope_id) DO UPDATE SET value = excluded.value, version = excluded.version,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(existing?.id || `sv_${crypto.randomUUID()}`, ADMIN_SETTINGS_KEY, serialized, nextVersion, ts, actor);
  dialect.prepare(`
    INSERT INTO settings_history (id, key, scope, scope_id, old_value, new_value, version, changed_at, changed_by, reason)
    VALUES (?, ?, 'system', '', ?, ?, ?, ?, ?, ?)
  `).run(`sh_${crypto.randomUUID()}`, ADMIN_SETTINGS_KEY, existing?.value ?? null, serialized, nextVersion, ts, actor, 'governance_strangler_sync');
}

function projectAdminSettings(dialect, db) {
  const row = dialect.prepare('SELECT value FROM settings_values WHERE key = ? AND scope = ? AND scope_id = ?').get(ADMIN_SETTINGS_KEY, 'system', '');
  if (!row) return;
  try {
    setPath(db, 'omni.adminSettings', JSON.parse(row.value));
  } catch { /* keep blob value if the canonical value is unreadable */ }
}

// ---------------------------------------------------------------------------
// Domain: notifications
// ---------------------------------------------------------------------------

function syncNotifications(dialect, db, ctx) {
  const actor = ctx?.actorId || 'system';
  const items = asArray(getPath(db, 'omni.notifications'));
  const ts = now();
  const companyId = ctx?.activeCompanyId || ctx?.companyId || 'default';

  const upsert = dialect.prepare(`
    INSERT INTO notifications (id, recipient_id, tenant_id, company_id, event_key, dedupe_key, category, subject, body, link, payload, read_at, archived_at, correlation_id, created_at)
    VALUES (?, ?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      recipient_id = excluded.recipient_id,
      subject = excluded.subject,
      body = excluded.body,
      payload = excluded.payload,
      read_at = excluded.read_at
  `);

  const keep = new Set();
  for (const item of items) {
    if (!item) continue;
    const legacyId = stableRecordId(item, 'ntf');
    const id = `omni_ntf_${safeId(legacyId)}`;
    keep.add(id);
    const readAt = item.readAt || (item.status === 'read' ? (item.createdAt || ts) : null);
    upsert.run(
      id,
      String(item.targetUserId || item.targetRole || 'all'),
      companyId,
      `legacy.${item.type || 'system'}`,
      `omni:${legacyId}`,
      item.severity === 'critical' ? 'critical' : 'informational',
      String(item.title || 'إشعار'),
      String(item.message ?? ''),
      item.actionPage ? `#${item.actionPage}` : null,
      JSON.stringify(item),
      readAt || null,
      item.createdAt || ts,
    );
  }

  const stale = dialect.prepare("SELECT id FROM notifications WHERE id LIKE 'omni_ntf_%'").all();
  for (const row of stale) {
    if (!keep.has(row.id)) dialect.prepare('DELETE FROM notifications WHERE id = ?').run(row.id);
  }
  auditBatch(dialect, actor, 'governance.sync.notifications', 'notifications', { synced: keep.size });
}

function projectNotifications(dialect, db) {
  const rows = dialect.prepare("SELECT payload FROM notifications WHERE id LIKE 'omni_ntf_%' ORDER BY created_at").all();
  const items = [];
  for (const row of rows) {
    try { items.push(JSON.parse(row.payload)); } catch { /* skip unreadable row */ }
  }
  setPath(db, 'omni.notifications', items);
}

// ---------------------------------------------------------------------------
// Domain: approvals (omni.requests + omni.approvalHub.requests)
// ---------------------------------------------------------------------------

const APPROVAL_STATUS_MAP = {
  pending: 'pending', approved: 'approved', rejected: 'rejected',
  returned: 'returned', withdrawn: 'withdrawn', expired: 'expired',
};

function collectApprovalRecords(db) {
  const merged = new Map();
  for (const r of asArray(getPath(db, 'omni.requests'))) {
    if (r && r.id !== undefined) merged.set(String(r.id), { origin: 'omni.requests', record: r });
  }
  const hub = getPath(db, 'omni.approvalHub');
  for (const r of asArray(hub && hub.requests)) {
    if (r && r.id !== undefined) merged.set(String(r.id), { origin: 'omni.approvalHub', record: r });
  }
  return [...merged.values()];
}

function syncApprovals(dialect, db, ctx) {
  const actor = ctx?.actorId || 'system';
  const entries = collectApprovalRecords(db);
  const ts = now();
  const companyId = ctx?.activeCompanyId || ctx?.companyId || 'default';

  const upsert = dialect.prepare(`
    INSERT INTO approval_requests (id, policy_id, entity, record_id, action, payload, payload_hash, amount,
      requester_id, tenant_id, company_id, current_step, current_roles, status, cc, version, step_entered_at,
      escalated, escalated_at, escalated_from_role, expires_at, workflow_instance_id, correlation_id, created_at, decided_at)
    VALUES (?, NULL, 'omni.requests', ?, ?, ?, ?, ?, ?, 'default', ?, 0, ?, ?, '[]', 1, ?, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      payload_hash = excluded.payload_hash,
      status = excluded.status,
      current_roles = excluded.current_roles,
      decided_at = excluded.decided_at
  `);
  const insDecision = dialect.prepare(`
    INSERT INTO approval_decisions (id, request_id, step, decider_id, on_behalf_of, delegation_id, decision, comment, attachments, decided_at, request_version)
    VALUES (?, ?, 0, ?, NULL, NULL, ?, ?, '[]', ?, 1)
    ON CONFLICT(id) DO NOTHING
  `);
  const insWorklist = dialect.prepare(`
    INSERT INTO worklist_items (id, request_id, instance_id, kind, assignee_id, candidate_role, company_id, title_ar, due_at, sla_calendar_id, status, created_at)
    VALUES (?, ?, NULL, 'approval', ?, ?, ?, ?, NULL, NULL, 'open', ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const closeWorklist = dialect.prepare("UPDATE worklist_items SET status = 'done' WHERE id = ? AND status = 'open'");

  const keep = new Set();
  for (const { origin, record } of entries) {
    const legacyId = String(record.id);
    const id = `omni_req_${safeId(legacyId)}`;
    keep.add(id);
    const status = APPROVAL_STATUS_MAP[String(record.status || 'pending').toLowerCase()] || 'pending';
    const wrapped = JSON.stringify({ $origin: origin, record });
    const hash = crypto.createHash('sha256').update(wrapped).digest('hex');
    const requester = String(record.requesterId || record.userId || record.createdBy || record.requester || 'system');
    const approverRole = record.approverRole || record.targetRole || null;
    const createdAt = record.createdAt || ts;
    const decidedAt = record.decidedAt || record.decided_at || null;
    const amount = Number.isFinite(Number(record.amount)) ? Number(record.amount) : null;

    upsert.run(id, legacyId, String(record.type || record.kind || 'request'), wrapped, hash, amount,
      requester, companyId, JSON.stringify(approverRole ? [approverRole] : []), status, createdAt, createdAt, decidedAt);

    if (status === 'approved' || status === 'rejected') {
      const decider = String(record.decidedBy || record.decidedById || record.approverId || 'system');
      insDecision.run(`omni_dec_${safeId(legacyId)}`, id, decider,
        status === 'approved' ? 'approve' : 'reject',
        record.decisionNote || record.note || record.comment || null,
        decidedAt || ts);
      closeWorklist.run(`omni_wl_${safeId(legacyId)}`);
    } else if (status === 'pending') {
      insWorklist.run(`omni_wl_${safeId(legacyId)}`, id, record.approverId || null, approverRole, companyId,
        String(record.title || record.type || 'طلب'), createdAt);
    }
  }

  const stale = dialect.prepare("SELECT id FROM approval_requests WHERE id LIKE 'omni_req_%'").all();
  for (const row of stale) {
    if (!keep.has(row.id)) dialect.prepare('DELETE FROM approval_requests WHERE id = ?').run(row.id);
  }
  auditBatch(dialect, actor, 'governance.sync.approvals', 'approvals', { synced: keep.size });
}

function projectApprovals(dialect, db) {
  const rows = dialect.prepare("SELECT payload FROM approval_requests WHERE id LIKE 'omni_req_%' ORDER BY created_at").all();
  const requests = [];
  const hubRequests = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload);
      if (parsed.$origin === 'omni.approvalHub') hubRequests.push(parsed.record);
      else requests.push(parsed.record);
    } catch { /* skip unreadable row */ }
  }
  setPath(db, 'omni.requests', requests);
  const hub = getPath(db, 'omni.approvalHub');
  setPath(db, 'omni.approvalHub', { ...(hub && typeof hub === 'object' ? hub : {}), requests: hubRequests });
}

// ---------------------------------------------------------------------------
// Verbatim x_records stores (workflows, logs, documents, automation)
// ---------------------------------------------------------------------------

function syncXRecords(dialect, entity, records, ctx, domainAction) {
  const actor = ctx?.actorId || 'system';
  const ts = now();
  const companyId = ctx?.activeCompanyId || ctx?.companyId || 'default';

  const existingRows = dialect.prepare('SELECT id, data, version FROM x_records WHERE entity = ? AND removed = 0').all(entity);
  const existing = new Map(existingRows.map((r) => [r.id, r]));
  const upsert = dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
    ON CONFLICT(entity, id) DO UPDATE SET
      data = excluded.data, updated_at = excluded.updated_at, removed = 0, version = x_records.version + 1
  `);

  const keep = new Set();
  let changed = 0;
  for (const record of records) {
    const id = stableRecordId(record, entity.slice(0, 8));
    keep.add(id);
    const data = JSON.stringify(record ?? {});
    const prior = existing.get(id);
    if (prior && prior.data === data) continue;
    // ON CONFLICT DO UPDATE leaves created_at/created_by untouched (they are
    // not in the update set), so the original creation audit is preserved.
    upsert.run(entity, id, companyId, data, ts, ts, actor);
    changed += 1;
  }

  let removed = 0;
  for (const row of existingRows) {
    if (!keep.has(row.id)) {
      dialect.prepare('UPDATE x_records SET removed = 1, updated_at = ? WHERE entity = ? AND id = ?').run(ts, entity, row.id);
      removed += 1;
    }
  }
  auditBatch(dialect, actor, domainAction, entity, { synced: keep.size, changed, removed });
}

function projectXRecords(dialect, entity) {
  const rows = dialect.prepare('SELECT data FROM x_records WHERE entity = ? AND removed = 0 ORDER BY created_at, id').all(entity);
  const out = [];
  for (const row of rows) {
    try { out.push(JSON.parse(row.data)); } catch { /* skip unreadable row */ }
  }
  return out;
}

function syncWorkflows(dialect, db, ctx) {
  const current = getPath(db, 'omni.workflow');
  if (current && typeof current === 'object') {
    syncXRecords(dialect, 'legacy_workflow', [{ id: 'current', ...current }], ctx, 'governance.sync.workflow');
  }
  if (getPath(db, 'omni.workflows') !== undefined) {
    syncXRecords(dialect, 'legacy_workflows', asArray(getPath(db, 'omni.workflows')), ctx, 'governance.sync.workflows');
  }
  if (getPath(db, 'omni.workflowHistory') !== undefined) {
    syncXRecords(dialect, 'legacy_workflow_history', asArray(getPath(db, 'omni.workflowHistory')), ctx, 'governance.sync.workflow_history');
  }
}

function projectWorkflows(dialect, db) {
  const current = projectXRecords(dialect, 'legacy_workflow');
  if (current.length) {
    const { id, ...rest } = current[current.length - 1];
    setPath(db, 'omni.workflow', rest);
  }
  setPath(db, 'omni.workflows', projectXRecords(dialect, 'legacy_workflows'));
  setPath(db, 'omni.workflowHistory', projectXRecords(dialect, 'legacy_workflow_history'));
}

function syncAuditLogs(dialect, db, ctx) {
  if (getPath(db, 'omni.systemLog') !== undefined) {
    syncXRecords(dialect, 'legacy_system_log', asArray(getPath(db, 'omni.systemLog')), ctx, 'governance.sync.system_log');
  }
  if (getPath(db, 'omni.historyLedger') !== undefined) {
    syncXRecords(dialect, 'legacy_history_ledger', asArray(getPath(db, 'omni.historyLedger')), ctx, 'governance.sync.history_ledger');
  }
  if (getPath(db, 'audit_log') !== undefined) {
    syncXRecords(dialect, 'legacy_audit_log', asArray(getPath(db, 'audit_log')), ctx, 'governance.sync.audit_log');
  }
}

function projectAuditLogs(dialect, db) {
  setPath(db, 'omni.systemLog', projectXRecords(dialect, 'legacy_system_log'));
  setPath(db, 'omni.historyLedger', projectXRecords(dialect, 'legacy_history_ledger'));
  setPath(db, 'audit_log', projectXRecords(dialect, 'legacy_audit_log'));
}

function syncDocuments(dialect, db, ctx) {
  const docs = getPath(db, 'omni.documents');
  if (docs === undefined) return;
  const list = asArray(docs && docs.docs);
  syncXRecords(dialect, 'legacy_documents', list, ctx, 'governance.sync.documents');
}

function projectDocuments(dialect, db) {
  setPath(db, 'omni.documents', { docs: projectXRecords(dialect, 'legacy_documents') });
}

function syncAutomation(dialect, db, ctx) {
  if (getPath(db, 'omni.automationRules') !== undefined) {
    syncXRecords(dialect, 'legacy_automation_rules', asArray(getPath(db, 'omni.automationRules')), ctx, 'governance.sync.automation_rules');
  }
  if (getPath(db, 'omni.automationFireLog') !== undefined) {
    syncXRecords(dialect, 'legacy_automation_fire_log', asArray(getPath(db, 'omni.automationFireLog')), ctx, 'governance.sync.automation_fire_log');
  }
}

function projectAutomation(dialect, db) {
  setPath(db, 'omni.automationRules', projectXRecords(dialect, 'legacy_automation_rules'));
  setPath(db, 'omni.automationFireLog', projectXRecords(dialect, 'legacy_automation_fire_log'));
}

// ---------------------------------------------------------------------------
// Domain dispatch
// ---------------------------------------------------------------------------

const DOMAIN_HANDLERS = {
  identity_users: { sync: syncIdentityUsers, project: projectIdentityUsers },
  authorization_roles: { sync: syncRoles, project: projectRoles },
  settings: { sync: syncAdminSettings, project: projectAdminSettings },
  notifications: { sync: syncNotifications, project: projectNotifications },
  approvals: { sync: syncApprovals, project: projectApprovals },
  workflows: { sync: syncWorkflows, project: projectWorkflows },
  audit_logs: { sync: syncAuditLogs, project: projectAuditLogs },
  documents: { sync: syncDocuments, project: projectDocuments },
  automation: { sync: syncAutomation, project: projectAutomation },
};

/**
 * Runtime/migration write path: for every governed domain whose paths are
 * present in the blob object, sync the incoming values into the canonical
 * tables, then REMOVE those paths from the object so the legacy blob write
 * no longer carries them. Mutates `db`. Transaction-less: the caller owns
// the surrounding transaction.
 */
export function syncGovernanceBlob(dialect, db, ctx = {}) {
  const synced = [];
  for (const domain of GOVERNED_DOMAINS) {
    const present = domain.paths.some((p) => getPath(db, p) !== undefined);
    if (!present) continue;
    DOMAIN_HANDLERS[domain.id].sync(dialect, db, ctx);
    for (const p of domain.paths) deletePath(db, p);
    synced.push(domain.id);
  }
  return synced;
}

/**
 * Runtime read path: overlay the canonical state onto the assembled blob so
 * legacy readers always see the platform as the single source of truth.
 */
export function projectGovernanceReads(dialect, db) {
  for (const domain of GOVERNED_DOMAINS) {
    DOMAIN_HANDLERS[domain.id].project(dialect, db);
  }
  return db;
}

/**
 * Strip governed paths without syncing. Fail-closed fallback for the degraded
 * non-SQLite mode where no canonical authority exists: governed facts must
// never silently re-enter a legacy store.
 */
export function stripGovernancePaths(db) {
  const stripped = [];
  for (const path of GOVERNED_PATHS) {
    if (getPath(db, path) !== undefined) {
      deletePath(db, path);
      stripped.push(path);
    }
  }
  return stripped;
}

/**
 * Reconciliation snapshot: canonical row counts per domain, for evidence and
// the runtime reconciliation test.
 */
export function reconcileGovernance(dialect) {
  const count = (sql, ...args) => Number(dialect.prepare(sql).get(...args)?.n || 0);
  return {
    identity_users: count("SELECT COUNT(*) AS n FROM identity_users WHERE actor_type = 'user' AND status != 'archived'"),
    authorization_roles: count("SELECT COUNT(*) AS n FROM authorization_roles WHERE id LIKE 'role_omni_%' AND status = 'active'"),
    settings: count('SELECT COUNT(*) AS n FROM settings_values WHERE key = ?', ADMIN_SETTINGS_KEY),
    notifications: count("SELECT COUNT(*) AS n FROM notifications WHERE id LIKE 'omni_ntf_%'"),
    approvals: count("SELECT COUNT(*) AS n FROM approval_requests WHERE id LIKE 'omni_req_%'"),
    workflows: count("SELECT COUNT(*) AS n FROM x_records WHERE entity LIKE 'legacy_workflow%' AND removed = 0"),
    audit_logs: count("SELECT COUNT(*) AS n FROM x_records WHERE entity IN ('legacy_system_log','legacy_history_ledger','legacy_audit_log') AND removed = 0"),
    documents: count("SELECT COUNT(*) AS n FROM x_records WHERE entity = 'legacy_documents' AND removed = 0"),
    automation: count("SELECT COUNT(*) AS n FROM x_records WHERE entity LIKE 'legacy_automation%' AND removed = 0"),
    legacy_blob_governed_rows: count(`SELECT COUNT(*) AS n FROM collections WHERE collection IN (${GOVERNED_PATHS.map(() => '?').join(',')})`, ...GOVERNED_PATHS)
      + count(`SELECT COUNT(*) AS n FROM metadata WHERE key IN (${GOVERNED_PATHS.map(() => '?').join(',')})`, ...GOVERNED_PATHS),
  };
}

/**
 * Migration 013 down(): export the canonical state back into legacy blob-table
// row form so the legacy reader can resume if the cutover is rolled back.
 */
export function exportGovernanceToBlobRows(dialect) {
  const db = {};
  projectGovernanceReads(dialect, db);
  const collections = {};
  const metadata = {};
  const walk = (obj, path = '') => {
    if (obj == null) return;
    if (GOVERNED_PATHS.includes(path)) {
      if (Array.isArray(obj)) collections[path] = obj;
      else metadata[path] = obj;
      return;
    }
    if (typeof obj === 'object' && (path === '' || path === 'omni')) {
      for (const k of Object.keys(obj)) walk(obj[k], path ? `${path}.${k}` : k);
    }
  };
  walk(db);
  return { collections, metadata };
}
