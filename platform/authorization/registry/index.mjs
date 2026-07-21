// Permission registry — Phase 02 packet 02.06.
//
// Source composition:
// - VNext acl-engine.js permMatches() (project-owned, MERGE-CANONICAL): the
//   colon-segmented wildcard matcher is reused verbatim in behavior because it
//   already matches the Octagon `module:resource:action` token shape used by
//   acl.json and services/permissionService.js.
// - RuoYi yudao-module-system menu/button permission tokens (MIT reference):
//   stable string ids owned by a module, with deprecation metadata.
// - NocoBase acl.ts (clean-room): resource/action decomposition.
//
// Invariant (§ 9.1): an UNKNOWN permission that is marked sensitive — or any
// unknown permission on a sensitive kind — FAILS CLOSED. Registration is the
// only way a permission becomes grantable.

'use strict';

import crypto from 'node:crypto';

export class PermissionRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'PermissionRegistryError';
    this.code = code;
    this.details = details;
  }
}

export const PERMISSION_KINDS = Object.freeze([
  'module', 'page', 'resource', 'action', 'field', 'document_state', 'report',
  'import', 'export', 'print', 'share', 'configuration', 'settings', 'file',
  'integration', 'api', 'ai_tool', 'scope',
]);

/** Kinds whose unknown tokens can never be implicitly allowed. */
export const SENSITIVE_KINDS = Object.freeze(['action', 'document_state', 'settings', 'configuration', 'integration', 'api', 'ai_tool', 'file', 'export', 'share']);

const TOKEN_RE = /^[a-z][a-z0-9_]*(:[a-z0-9_*]+)+$/;

/**
 * Wildcard permission matching. Preserved from VNext acl-engine.permMatches:
 * a trailing `*` segment matches the remaining tail; an intermediate `*`
 * matches exactly one segment; otherwise segment counts must be equal.
 */
export function permissionMatches(grantPerm, perm) {
  const g = String(grantPerm || '').split(':');
  const p = String(perm || '').split(':');
  for (let i = 0; i < g.length; i++) {
    if (g[i] === '*') {
      if (i === g.length - 1) return true;
      if (i >= p.length) return false;
      continue;
    }
    if (g[i] !== p[i]) return false;
  }
  return g.length === p.length;
}

export class PermissionRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new PermissionRegistryError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  register(permission, actor = 'system') {
    const id = String(permission.id || '').trim();
    if (!id) throw new PermissionRegistryError('permission id is required', 'PERMISSION_ID_REQUIRED');
    if (id !== '*' && !TOKEN_RE.test(id)) {
      throw new PermissionRegistryError(`permission id must be module:resource:action, got "${id}"`, 'PERMISSION_ID_INVALID', { id });
    }
    if (!permission.module_id) throw new PermissionRegistryError('module_id is required', 'PERMISSION_MODULE_REQUIRED');
    if (!PERMISSION_KINDS.includes(permission.kind)) {
      throw new PermissionRegistryError(`kind must be one of ${PERMISSION_KINDS.join(', ')}`, 'PERMISSION_KIND_INVALID', { kind: permission.kind });
    }
    const existing = this.get(id);
    if (existing && existing.moduleId !== permission.module_id) {
      throw new PermissionRegistryError(`permission ${id} is already owned by module ${existing.moduleId}`, 'PERMISSION_DUPLICATE_OWNER', { id, owner: existing.moduleId });
    }
    for (const dep of permission.depends_on || []) {
      if (!this.get(dep)) throw new PermissionRegistryError(`permission ${id} depends on unregistered ${dep}`, 'PERMISSION_DEPENDENCY_MISSING', { id, dep });
    }
    const now = this.#now();
    this.dialect.prepare(`
      INSERT INTO authorization_permissions (id, module_id, kind, resource, action, label_ar, label_en, sensitive, depends_on, deprecated, replaced_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET module_id=excluded.module_id, kind=excluded.kind, resource=excluded.resource,
        action=excluded.action, label_ar=excluded.label_ar, label_en=excluded.label_en, sensitive=excluded.sensitive,
        depends_on=excluded.depends_on, deprecated=excluded.deprecated, replaced_by=excluded.replaced_by, updated_at=excluded.updated_at
    `).run(
      id, permission.module_id, permission.kind,
      permission.resource || id.split(':')[1] || id,
      permission.action || id.split(':').slice(2).join(':') || id.split(':')[1] || '',
      permission.label_ar || null, permission.label_en || null,
      permission.sensitive || SENSITIVE_KINDS.includes(permission.kind) ? 1 : 0,
      JSON.stringify(permission.depends_on || []),
      permission.deprecated ? 1 : 0, permission.replaced_by || null, now, now
    );
    return this.get(id);
  }

  registerMany(permissions, actor = 'system') {
    return permissions.map((p) => this.register(p, actor));
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM authorization_permissions WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, moduleId: r.module_id, kind: r.kind, resource: r.resource, action: r.action,
      labelAr: r.label_ar, labelEn: r.label_en, sensitive: r.sensitive === 1,
      dependsOn: JSON.parse(r.depends_on || '[]'), deprecated: r.deprecated === 1, replacedBy: r.replaced_by,
    };
  }

  list({ moduleId = null, kind = null } = {}) {
    const clauses = [];
    const params = [];
    if (moduleId) { clauses.push('module_id = ?'); params.push(moduleId); }
    if (kind) { clauses.push('kind = ?'); params.push(kind); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.dialect.prepare(`SELECT id FROM authorization_permissions ${where} ORDER BY id`).all(...params).map((r) => this.get(r.id));
  }

  deprecate(id, replacedBy = null) {
    this.dialect.prepare('UPDATE authorization_permissions SET deprecated = 1, replaced_by = ?, updated_at = ? WHERE id = ?')
      .run(replacedBy, this.#now(), id);
    return this.get(id);
  }

  /**
   * Validate a token that may be a WILDCARD PATTERN, as used when granting
   * (`crm:*`) rather than when checking (`crm:crm_lead:read`). A pattern is
   * accepted only if it actually matches at least one registered permission —
   * so a typo'd `crn:*` is still refused, and a grant can never silently cover
   * nothing (or, worse, be assumed to cover something).
   */
  assertGrantable(permission) {
    if (permission === '*') return { id: '*', wildcard: true, matches: this.list().length };
    if (!String(permission).includes('*')) return this.assertKnown(permission);
    const matches = this.list().filter((p) => permissionMatches(permission, p.id));
    if (!matches.length) {
      throw new PermissionRegistryError(`grant pattern ${permission} matches no registered permission`, 'PERMISSION_PATTERN_EMPTY', { permission });
    }
    return { id: permission, wildcard: true, matches: matches.length, matched: matches.map((p) => p.id) };
  }

  /**
   * Is this exact token safe to evaluate? An unregistered token is never
   * tolerated on the canonical evaluation path — it is a hard closed door.
   */
  assertKnown(permission) {
    const def = this.get(permission);
    if (def) {
      if (def.deprecated && !def.replacedBy) {
        throw new PermissionRegistryError(`permission ${permission} is retired`, 'PERMISSION_RETIRED', { permission });
      }
      return def;
    }
    throw new PermissionRegistryError(`permission ${permission} is not registered`, 'PERMISSION_UNKNOWN', { permission });
  }

  /** Registry consistency report used by the closure gate. */
  consistencyReport() {
    const all = this.list();
    const byModule = {};
    const problems = [];
    const knownModules = new Set(this.dialect.prepare('SELECT id FROM platform_modules').all().map((r) => r.id));
    for (const p of all) {
      byModule[p.moduleId] = (byModule[p.moduleId] || 0) + 1;
      if (!knownModules.has(p.moduleId)) problems.push({ id: p.id, problem: 'OWNER_MODULE_NOT_INSTALLED', moduleId: p.moduleId });
      if (!p.labelAr) problems.push({ id: p.id, problem: 'MISSING_ARABIC_LABEL' });
      if (p.deprecated && !p.replacedBy) problems.push({ id: p.id, problem: 'DEPRECATED_WITHOUT_REPLACEMENT' });
      for (const dep of p.dependsOn) {
        if (!this.get(dep)) problems.push({ id: p.id, problem: 'DEPENDENCY_MISSING', dep });
      }
    }
    // Every grant must point at a registered permission (or the '*' owner token).
    const orphanGrants = this.dialect.prepare(`
      SELECT g.role_id, g.permission FROM authorization_grants g
      WHERE g.permission <> '*'
        AND NOT EXISTS (SELECT 1 FROM authorization_permissions p WHERE p.id = g.permission)
    `).all();
    for (const g of orphanGrants) problems.push({ id: g.permission, problem: 'GRANT_TO_UNREGISTERED_PERMISSION', roleId: g.role_id });
    return { total: all.length, byModule, problems, consistent: problems.length === 0 };
  }

  /** Stable snapshot for regression diffing (closure evidence). */
  snapshot() {
    return this.list().map((p) => `${p.id}|${p.moduleId}|${p.kind}|${p.sensitive ? 'S' : '-'}|${p.deprecated ? 'D' : '-'}`);
  }
}

export function createPermissionRegistry(dialect) { return new PermissionRegistry(dialect); }
export const _internal = { TOKEN_RE, uuid: () => crypto.randomUUID() };
