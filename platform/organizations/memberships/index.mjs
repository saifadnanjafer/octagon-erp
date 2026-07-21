// Tenant / company / branch membership authority — Phase 02 packet 02.01.
//
// Source composition:
// - Phase 01 platform/identity/context/index.mjs (EXTEND): resolveServerScope's
//   tenant/company/branch consistency checks are the base; membership makes them
//   per-user instead of per-row.
// - VNext R1 organization migrations (project-owned, MERGE-CANONICAL).
// - RuoYi tenant framework (MIT reference, behavior only): a membership carries
//   the data scope; the request cannot supply it.
//
// Invariant (§ 8.1, § 9.6): active company/branch is chosen ONLY from
// server-verified memberships. A request body may *request* a company; it can
// never *assert* one.

'use strict';

import crypto from 'node:crypto';

export class MembershipError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'MembershipError';
    this.code = code;
    this.details = details;
  }
}

export class MembershipDirectory {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new MembershipError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  grant({ userId, companyId, branchId = null, departmentId = null, isDefault = false, validFrom = null, validTo = null }, actor = 'system') {
    const user = this.dialect.prepare('SELECT tenant_id, status FROM identity_users WHERE id = ?').get(userId);
    if (!user) throw new MembershipError('user not found', 'USER_NOT_FOUND');
    const company = this.dialect.prepare('SELECT tenant_id, status FROM platform_companies WHERE id = ?').get(companyId);
    if (!company || company.status !== 'active') throw new MembershipError('company not found or inactive', 'COMPANY_INVALID');
    // Cross-tenant membership is structurally impossible.
    if (company.tenant_id !== user.tenant_id) {
      throw new MembershipError('cannot grant membership across tenants', 'CROSS_TENANT_MEMBERSHIP', { userTenant: user.tenant_id, companyTenant: company.tenant_id });
    }
    if (branchId) {
      const branch = this.dialect.prepare('SELECT company_id, status FROM platform_branches WHERE id = ?').get(branchId);
      if (!branch || branch.status !== 'active') throw new MembershipError('branch not found or inactive', 'BRANCH_INVALID');
      if (branch.company_id !== companyId) throw new MembershipError('branch does not belong to company', 'BRANCH_COMPANY_MISMATCH');
    }
    const id = `mem_${crypto.randomUUID()}`;
    if (isDefault) {
      this.dialect.prepare('UPDATE organization_memberships SET is_default = 0 WHERE user_id = ?').run(userId);
    }
    this.dialect.prepare(`
      INSERT INTO organization_memberships (id, user_id, tenant_id, company_id, branch_id, department_id, is_default, status, valid_from, valid_to, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET status='active', is_default=excluded.is_default, department_id=excluded.department_id,
        valid_from=excluded.valid_from, valid_to=excluded.valid_to
    `).run(id, userId, user.tenant_id, companyId, branchId, departmentId, isDefault ? 1 : 0, validFrom, validTo, this.#now(), actor);
    return this.list(userId);
  }

  /**
   * Revoke membership. Omitting `branchId` revokes EVERY membership the user
   * holds in that company, including branch-scoped ones — a company-level
   * revocation that silently left a branch membership alive would be a
   * privilege-retention bug, not a narrower scope.
   */
  revoke(userId, companyId, branchId = null, actor = 'system') {
    if (branchId === null) {
      this.dialect.prepare(`
        UPDATE organization_memberships SET status = 'revoked'
        WHERE user_id = ? AND company_id = ?
      `).run(userId, companyId);
    } else {
      this.dialect.prepare(`
        UPDATE organization_memberships SET status = 'revoked'
        WHERE user_id = ? AND company_id = ? AND branch_id = ?
      `).run(userId, companyId, branchId);
    }
    // A revoked membership must not leave a usable session behind.
    this.dialect.prepare(`
      UPDATE identity_sessions SET revoked_at = ?, revoked_reason = 'membership_revoked'
      WHERE user_id = ? AND active_company_id = ? AND revoked_at IS NULL
    `).run(this.#now(), userId, companyId);
    return this.list(userId);
  }

  /** Active, time-valid memberships for a user. */
  list(userId, now = new Date()) {
    const iso = now.toISOString();
    return this.dialect.prepare(`
      SELECT id, tenant_id, company_id, branch_id, department_id, is_default
      FROM organization_memberships
      WHERE user_id = ? AND status = 'active'
        AND (valid_from IS NULL OR valid_from <= ?)
        AND (valid_to IS NULL OR valid_to > ?)
      ORDER BY is_default DESC, company_id, COALESCE(branch_id,'')
    `).all(userId, iso, iso).map((r) => ({
      id: r.id, tenantId: r.tenant_id, companyId: r.company_id,
      branchId: r.branch_id, departmentId: r.department_id, isDefault: r.is_default === 1,
    }));
  }

  companies(userId, now = new Date()) {
    return [...new Set(this.list(userId, now).map((m) => m.companyId))];
  }

  branches(userId, companyId, now = new Date()) {
    return this.list(userId, now).filter((m) => m.companyId === companyId && m.branchId).map((m) => m.branchId);
  }

  /**
   * Resolve the active company/branch for a request. `requested*` come from the
   * caller and are ACCEPTED ONLY IF a matching membership exists. When nothing
   * is requested, the default membership wins. Throws rather than silently
   * downgrading, so a caller can never believe it is in a company it is not in.
   */
  resolveActiveScope(userId, { requestedCompanyId = null, requestedBranchId = null } = {}, now = new Date()) {
    const memberships = this.list(userId, now);
    if (!memberships.length) throw new MembershipError('user has no active membership', 'NO_MEMBERSHIP', { userId });

    let candidates = memberships;
    if (requestedCompanyId) {
      candidates = memberships.filter((m) => m.companyId === requestedCompanyId);
      if (!candidates.length) throw new MembershipError('requested company is not an active membership', 'COMPANY_NOT_A_MEMBERSHIP', { userId, requestedCompanyId });
    }
    if (requestedBranchId) {
      const branchMatch = candidates.filter((m) => m.branchId === requestedBranchId);
      if (!branchMatch.length) throw new MembershipError('requested branch is not an active membership', 'BRANCH_NOT_A_MEMBERSHIP', { userId, requestedBranchId });
      candidates = branchMatch;
    }
    const chosen = candidates.find((m) => m.isDefault) || candidates[0];
    return {
      membershipId: chosen.id,
      tenantId: chosen.tenantId,
      companyId: chosen.companyId,
      branchId: requestedBranchId || chosen.branchId || null,
      departmentId: chosen.departmentId || null,
      companyMemberships: [...new Set(memberships.map((m) => m.companyId))],
      branchMemberships: memberships.filter((m) => m.branchId).map((m) => m.branchId),
    };
  }

  assignScope(membershipId, scopeId) {
    this.dialect.prepare(`
      INSERT INTO organization_scope_assignments (id, membership_id, scope_id, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(`osa_${crypto.randomUUID()}`, membershipId, scopeId, this.#now());
  }

  operatingScopes(userId, now = new Date()) {
    const ids = this.list(userId, now).map((m) => m.id);
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.dialect.prepare(`
      SELECT s.id, s.kind, s.company_id, s.name
      FROM organization_scope_assignments a
      JOIN organization_operating_scopes s ON s.id = a.scope_id AND s.status = 'active'
      WHERE a.membership_id IN (${placeholders})
    `).all(...ids).map((r) => ({ id: r.id, kind: r.kind, companyId: r.company_id, name: r.name }));
  }
}

export function createMembershipDirectory(dialect) { return new MembershipDirectory(dialect); }
