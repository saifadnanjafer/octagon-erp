// Roles, role templates, and assignment administration — Phase 02 packet 02.11.
//
// Source composition:
// - VNext acl-engine.js `_acl` PUT handler (project-owned, MERGE-REFACTOR):
//   replace-all-grants-for-a-role inside BEGIN IMMEDIATE. Preserved, plus impact
//   preview and default-deny templates the original lacked.
// - RuoYi yudao-module-system role/menu/dept administration (MIT reference):
//   role templates, per-company assignment, bulk operations.
// - NocoBase roles plugin (clean-room): role as a named grant bundle.
// - Frappe role profiles (SPEC-IMPLEMENT — FRAPPE_ROOT is absent, see source-lock).
//
// Invariants (§ 9.9, § 36):
//   - templates are least-privilege by default (empty grant set)
//   - a change is previewable BEFORE it applies
//   - the last active owner can never lose owner authority

'use strict';

import crypto from 'node:crypto';

export class RoleError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'RoleError';
    this.code = code;
    this.details = details;
  }
}

export class RoleAdministration {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.registry = deps.permissionRegistry || null;
    this.evaluator = deps.evaluator || null;
  }

  #now() { return new Date().toISOString(); }

  #audit(action, resourceId, detail, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', ?, 'authorization_roles', ?, ?, 'authorization', 'success', ?)
    `).run(crypto.randomUUID(), actor || 'system', action, resourceId, this.#now(), detail ? JSON.stringify(detail) : null);
  }

  // --- templates ------------------------------------------------------------

  /** Templates start with NO permissions unless explicitly listed — default deny. */
  createTemplate({ id, name, labelAr = null, permissions = [], fieldRules = [], recordScopes = [] }, actor = 'system') {
    if (!name) throw new RoleError('template name is required', 'TEMPLATE_NAME_REQUIRED');
    if (this.registry) {
      for (const p of permissions) {
        this.registry.assertGrantable(p.permission);
      }
    }
    const existing = this.dialect.prepare('SELECT MAX(version) AS v FROM authorization_role_templates WHERE name = ?').get(name);
    const version = Number(existing?.v || 0) + 1;
    const templateId = id || `tpl_${name}_v${version}`;
    const now = this.#now();
    this.dialect.prepare(`
      INSERT INTO authorization_role_templates (id, name, label_ar, version, permissions, field_rules, record_scopes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(templateId, name, labelAr, version, JSON.stringify(permissions), JSON.stringify(fieldRules), JSON.stringify(recordScopes), now, now);
    this.#audit('role_template.create', templateId, { name, version, permissionCount: permissions.length }, actor);
    return this.getTemplate(templateId);
  }

  getTemplate(id) {
    const r = this.dialect.prepare('SELECT * FROM authorization_role_templates WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, name: r.name, labelAr: r.label_ar, version: r.version, status: r.status,
      permissions: JSON.parse(r.permissions || '[]'),
      fieldRules: JSON.parse(r.field_rules || '[]'),
      recordScopes: JSON.parse(r.record_scopes || '[]'),
    };
  }

  latestTemplate(name) {
    const r = this.dialect.prepare("SELECT id FROM authorization_role_templates WHERE name = ? AND status = 'active' ORDER BY version DESC LIMIT 1").get(name);
    return r ? this.getTemplate(r.id) : null;
  }

  // --- roles ----------------------------------------------------------------

  createRole({ id, tenantId, name, labelAr = null, templateId = null, isSystem = false }, actor = 'system') {
    const tenant = this.dialect.prepare('SELECT 1 FROM platform_tenants WHERE id = ? AND status = ?').get(tenantId, 'active');
    if (!tenant) throw new RoleError('tenant not found or inactive', 'TENANT_INVALID');
    const roleId = id || `role_${tenantId}_${name}`;
    const now = this.#now();
    const template = templateId ? this.getTemplate(templateId) : null;
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO authorization_roles (id, tenant_id, name, label_ar, template_id, template_version, is_system, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET label_ar=excluded.label_ar, template_id=excluded.template_id,
          template_version=excluded.template_version, updated_at=excluded.updated_at
      `).run(roleId, tenantId, name, labelAr, templateId, template?.version || null, isSystem ? 1 : 0, now, now);
      if (template) this.#applyTemplate(roleId, template, actor);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.#audit('role.create', roleId, { name, templateId }, actor);
    return this.getRole(roleId);
  }

  #applyTemplate(roleId, template, actor) {
    const now = this.#now();
    this.dialect.prepare('DELETE FROM authorization_grants WHERE role_id = ?').run(roleId);
    this.dialect.prepare('DELETE FROM authorization_field_rules WHERE role_id = ?').run(roleId);
    this.dialect.prepare('DELETE FROM authorization_record_scopes WHERE role_id = ?').run(roleId);
    const g = this.dialect.prepare(`
      INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
    `);
    for (const p of template.permissions) {
      g.run(`grant_${crypto.randomUUID()}`, roleId, p.permission, p.effect || 'allow', p.scope || 'company',
        JSON.stringify(p.documentStates || []), p.requiresApproval ? 1 : 0, now, actor);
    }
    const f = this.dialect.prepare(`
      INSERT INTO authorization_field_rules (id, role_id, entity, field, access, classification, condition, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
    `);
    for (const r of template.fieldRules) {
      f.run(`fr_${crypto.randomUUID()}`, roleId, r.entity, r.field, r.access, r.classification || 'normal', r.condition || null, now);
    }
    const s = this.dialect.prepare(`
      INSERT INTO authorization_record_scopes (id, role_id, entity, scope_kind, predicate, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
    `);
    for (const r of template.recordScopes) {
      s.run(`rs_${crypto.randomUUID()}`, roleId, r.entity, r.scopeKind, r.predicate ? JSON.stringify(r.predicate) : null, now);
    }
  }

  getRole(id) {
    const r = this.dialect.prepare('SELECT * FROM authorization_roles WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, tenantId: r.tenant_id, name: r.name, labelAr: r.label_ar,
      templateId: r.template_id, templateVersion: r.template_version,
      isSystem: r.is_system === 1, status: r.status,
      grants: this.dialect.prepare('SELECT id, permission, effect, scope, document_states, requires_approval FROM authorization_grants WHERE role_id = ? ORDER BY permission').all(id)
        .map((g) => ({ ...g, document_states: JSON.parse(g.document_states || '[]'), requires_approval: g.requires_approval === 1 })),
    };
  }

  /** Replace the full grant set for a role, atomically. Preserved VNext semantics. */
  setGrants(roleId, grants, actor = 'system') {
    if (!Array.isArray(grants)) throw new RoleError('grants array is required', 'GRANTS_REQUIRED');
    if (this.registry) {
      for (const g of grants) this.registry.assertGrantable(g.permission);
    }
    const now = this.#now();
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('DELETE FROM authorization_grants WHERE role_id = ?').run(roleId);
      const ins = this.dialect.prepare(`
        INSERT INTO authorization_grants (id, role_id, permission, effect, scope, document_states, requires_approval, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const g of grants) {
        ins.run(`grant_${crypto.randomUUID()}`, roleId, g.permission, g.effect || 'allow', g.scope || 'company',
          JSON.stringify(g.documentStates || []), g.requiresApproval ? 1 : 0, now, actor);
      }
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.evaluator?.invalidate();
    this.#audit('role.grants.replace', roleId, { count: grants.length }, actor);
    return this.getRole(roleId);
  }

  setFieldRules(roleId, rules, actor = 'system') {
    const now = this.#now();
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('DELETE FROM authorization_field_rules WHERE role_id = ?').run(roleId);
      const ins = this.dialect.prepare(`
        INSERT INTO authorization_field_rules (id, role_id, entity, field, access, classification, condition, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const r of rules) ins.run(`fr_${crypto.randomUUID()}`, roleId, r.entity, r.field, r.access, r.classification || 'normal', r.condition || null, now);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.evaluator?.invalidate();
    return rules.length;
  }

  setRecordScopes(roleId, scopes, actor = 'system') {
    const now = this.#now();
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare('DELETE FROM authorization_record_scopes WHERE role_id = ?').run(roleId);
      const ins = this.dialect.prepare(`
        INSERT INTO authorization_record_scopes (id, role_id, entity, scope_kind, predicate, created_at) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const s of scopes) ins.run(`rs_${crypto.randomUUID()}`, roleId, s.entity, s.scopeKind, s.predicate ? JSON.stringify(s.predicate) : null, now);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.evaluator?.invalidate();
    return scopes.length;
  }

  retireRole(roleId, actor = 'system') {
    this.dialect.prepare("UPDATE authorization_roles SET status = 'retired', updated_at = ? WHERE id = ?").run(this.#now(), roleId);
    this.dialect.prepare("UPDATE authorization_role_assignments SET status = 'revoked' WHERE role_id = ?").run(roleId);
    this.evaluator?.invalidate();
    this.#audit('role.retire', roleId, null, actor);
  }

  // --- assignments ----------------------------------------------------------

  /**
   * Assign a role to a USER or to a SERVICE identity (migration 011). A service
   * grantee has no membership graph, so the company-membership check applies to
   * interactive users only; a service account is bound by its own company field.
   */
  assign({ userId, roleId, companyId = null, branchId = null, validFrom = null, validTo = null, actorType = 'user' }, actor = 'system') {
    const role = this.getRole(roleId);
    if (!role) throw new RoleError('role not found', 'ROLE_NOT_FOUND');
    if (role.status !== 'active') throw new RoleError('role is retired', 'ROLE_RETIRED');
    const grantee = actorType === 'service'
      ? this.dialect.prepare('SELECT tenant_id FROM identity_service_accounts WHERE id = ?').get(userId)
      : this.dialect.prepare('SELECT tenant_id FROM identity_users WHERE id = ?').get(userId);
    if (!grantee) throw new RoleError(`${actorType} not found`, 'USER_NOT_FOUND');
    if (grantee.tenant_id !== role.tenantId) throw new RoleError('cannot assign a role across tenants', 'CROSS_TENANT_ROLE');
    if (companyId && actorType === 'user') {
      const member = this.dialect.prepare("SELECT 1 FROM organization_memberships WHERE user_id = ? AND company_id = ? AND status = 'active'").get(userId, companyId);
      if (!member) throw new RoleError('user has no membership in that company', 'COMPANY_NOT_A_MEMBERSHIP');
    }
    this.dialect.prepare(`
      INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, branch_id, status, valid_from, valid_to, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET status='active', valid_from=excluded.valid_from, valid_to=excluded.valid_to
    `).run(`asg_${crypto.randomUUID()}`, userId, actorType, roleId, companyId, branchId, validFrom, validTo, this.#now(), actor);
    this.evaluator?.invalidate();
    this.#audit('role.assign', roleId, { userId, companyId }, actor);
    return this.assignmentsFor(userId);
  }

  unassign(userId, roleId, actor = 'system') {
    // Owner-lockout guard: never remove the last owner-authority assignment.
    const role = this.getRole(roleId);
    if (role && this.#isOwnerRole(role) && this.#ownerAssignmentCount(role.tenantId) <= 1) {
      throw new RoleError('cannot remove the last owner role assignment in a tenant', 'OWNER_LOCKOUT_PREVENTED', { tenantId: role.tenantId });
    }
    this.dialect.prepare("UPDATE authorization_role_assignments SET status = 'revoked' WHERE user_id = ? AND role_id = ?").run(userId, roleId);
    this.evaluator?.invalidate();
    this.#audit('role.unassign', roleId, { userId }, actor);
    return this.assignmentsFor(userId);
  }

  #isOwnerRole(role) {
    return role.grants.some((g) => g.permission === '*' && g.effect === 'allow');
  }

  #ownerAssignmentCount(tenantId) {
    const row = this.dialect.prepare(`
      SELECT COUNT(*) AS n FROM authorization_role_assignments a
      JOIN authorization_roles r ON r.id = a.role_id AND r.tenant_id = ? AND r.status='active'
      JOIN authorization_grants g ON g.role_id = r.id AND g.permission = '*' AND g.effect = 'allow'
      JOIN identity_users u ON u.id = a.user_id AND u.status = 'active'
      WHERE a.status = 'active'
    `).get(tenantId);
    return Number(row?.n || 0);
  }

  assignmentsFor(userId) {
    return this.dialect.prepare(`
      SELECT a.role_id, r.name, a.company_id, a.branch_id, a.status, a.valid_from, a.valid_to
      FROM authorization_role_assignments a JOIN authorization_roles r ON r.id = a.role_id
      WHERE a.user_id = ? ORDER BY r.name
    `).all(userId);
  }

  /**
   * Impact preview (§ 36 "impact preview before changes"). Computes which users
   * gain and lose which permissions if `grants` replaced the role's current set —
   * WITHOUT mutating anything.
   */
  previewGrantChange(roleId, nextGrants) {
    const role = this.getRole(roleId);
    if (!role) throw new RoleError('role not found', 'ROLE_NOT_FOUND');
    const before = new Set(role.grants.filter((g) => g.effect === 'allow').map((g) => `${g.permission}@${g.scope}`));
    const after = new Set(nextGrants.filter((g) => (g.effect || 'allow') === 'allow').map((g) => `${g.permission}@${g.scope || 'company'}`));
    const added = [...after].filter((x) => !before.has(x));
    const removed = [...before].filter((x) => !after.has(x));
    const affected = this.dialect.prepare(`
      SELECT DISTINCT a.user_id, u.login FROM authorization_role_assignments a
      JOIN identity_users u ON u.id = a.user_id
      WHERE a.role_id = ? AND a.status = 'active' AND u.status = 'active'
    `).all(roleId);
    return {
      roleId, roleName: role.name,
      affectedUsers: affected.map((r) => ({ userId: r.user_id, login: r.login })),
      affectedUserCount: affected.length,
      permissionsGained: added,
      permissionsLost: removed,
      escalation: added.some((x) => x.startsWith('*@')),
    };
  }

  /** Effective-access preview for one user, without performing any action. */
  effectiveAccess(userId, companyId = null) {
    const roles = this.dialect.prepare(`
      SELECT DISTINCT a.role_id FROM authorization_role_assignments a
      JOIN authorization_roles r ON r.id = a.role_id AND r.status='active'
      WHERE a.user_id = ? AND a.status='active' AND (a.company_id IS NULL OR a.company_id = ?)
    `).all(userId, companyId || '').map((r) => r.role_id);
    if (!roles.length) return { userId, companyId, roles: [], allows: [], denies: [], fieldRules: [], recordScopes: [] };
    const ph = roles.map(() => '?').join(',');
    const grants = this.dialect.prepare(`SELECT permission, effect, scope FROM authorization_grants WHERE role_id IN (${ph}) ORDER BY permission`).all(...roles);
    return {
      userId, companyId, roles,
      allows: grants.filter((g) => g.effect === 'allow'),
      denies: grants.filter((g) => g.effect === 'deny'),
      fieldRules: this.dialect.prepare(`SELECT entity, field, access FROM authorization_field_rules WHERE role_id IN (${ph})`).all(...roles),
      recordScopes: this.dialect.prepare(`SELECT entity, scope_kind FROM authorization_record_scopes WHERE role_id IN (${ph})`).all(...roles),
    };
  }

  /** Bulk assignment: all-or-nothing, so a partial failure cannot half-grant. */
  bulkAssign(assignments, actor = 'system') {
    const applied = [];
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      for (const a of assignments) {
        const role = this.getRole(a.roleId);
        if (!role || role.status !== 'active') throw new RoleError(`role ${a.roleId} is not assignable`, 'ROLE_NOT_ASSIGNABLE', { roleId: a.roleId });
        const user = this.dialect.prepare('SELECT tenant_id FROM identity_users WHERE id = ?').get(a.userId);
        if (!user) throw new RoleError(`user ${a.userId} not found`, 'USER_NOT_FOUND', { userId: a.userId });
        if (user.tenant_id !== role.tenantId) throw new RoleError('cannot assign a role across tenants', 'CROSS_TENANT_ROLE', { userId: a.userId });
        this.dialect.prepare(`
          INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, branch_id, status, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT DO UPDATE SET status='active'
        `).run(`asg_${crypto.randomUUID()}`, a.userId, a.actorType || 'user', a.roleId, a.companyId || null, a.branchId || null, this.#now(), actor);
        applied.push(a);
      }
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.evaluator?.invalidate();
    this.#audit('role.bulk_assign', 'bulk', { count: applied.length }, actor);
    return applied;
  }
}

export function createRoleAdministration(dialect, deps) { return new RoleAdministration(dialect, deps); }
