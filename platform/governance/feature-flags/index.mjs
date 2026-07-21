// Feature flag registry — Phase 01 governance.
//
// Source composition:
// - VNext R8/R9 pack/entitlement checks (project-owned).
// - Frappe system settings (MIT reference) for defaults.

'use strict';

import crypto from 'node:crypto';

export class FeatureFlagRegistryError extends Error {
  constructor(message, code) { super(message); this.name = 'FeatureFlagRegistryError'; this.code = code; }
}

export class FeatureFlagRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new FeatureFlagRegistryError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  register(flag, actor = 'system') {
    if (!flag.key || !flag.module_id) throw new FeatureFlagRegistryError('key and module_id are required', 'FLAG_INVALID');
    this.dialect.prepare(`
      INSERT INTO platform_feature_flags (key, module_id, scope, enabled, audit_policy, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        module_id = excluded.module_id,
        scope = excluded.scope,
        enabled = excluded.enabled,
        audit_policy = excluded.audit_policy,
        updated_at = excluded.updated_at
    `).run(flag.key, flag.module_id, flag.scope || 'company', flag.enabled ? 1 : 0, flag.audit_policy || 'required', this.#now(), this.#now());
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), actor, 'user', 'feature_flag.set', 'platform_feature_flags', flag.key, this.#now(), 'registry', 'success');
    return flag.key;
  }

  isEnabled(key, scopeCtx = {}) {
    const row = this.dialect.prepare('SELECT enabled, scope FROM platform_feature_flags WHERE key = ?').get(key);
    if (!row) return false;
    if (row.scope === 'global') return row.enabled === 1;
    if (scopeCtx.companyId && row.scope === 'company') {
      const company = this.dialect.prepare('SELECT id FROM platform_companies WHERE id = ?').get(scopeCtx.companyId);
      return row.enabled === 1 && !!company;
    }
    return row.enabled === 1;
  }

  list() {
    return this.dialect.prepare('SELECT key, module_id, scope, enabled FROM platform_feature_flags ORDER BY key').all().map((r) => ({ key: r.key, module_id: r.module_id, scope: r.scope, enabled: r.enabled === 1 }));
  }
}

export function createFeatureFlagRegistry(dialect) { return new FeatureFlagRegistry(dialect); }
