// Typed settings authority with scope inheritance — Phase 02 packet 02.13.
//
// Source composition:
// - Phase 01 platform/kernel/settings/index.mjs (EXTEND): its platform_settings
//   DEFINITION table and register()/get() contract are consumed unchanged; this
//   module adds values, inheritance, history, preview, and rollback. There is
//   no second settings authority — `createSettingsRegistry` still owns
//   definitions and is re-exported from here.
// - VNext R1 organization/fiscal settings work (project-owned, MERGE-CANONICAL).
// - NocoBase settings plugins (clean-room): definition/value separation.
// - Frappe System Settings (SPEC-IMPLEMENT — FRAPPE_ROOT absent).
// - RuoYi system config + dictionary (MIT reference, behavior only).
//
// Invariants (§ 10):
//   - every setting has a typed definition; an unregistered key cannot be set
//   - a lower scope overrides only where `overridable_scopes` declares it
//   - a secret setting NEVER stores its value here — only a secret:// reference
//   - every change is versioned, audited, and revertible

'use strict';

import crypto from 'node:crypto';
import { createSettingsRegistry, SettingsRegistry, SettingsRegistryError } from '../kernel/settings/index.mjs';

export { createSettingsRegistry, SettingsRegistry, SettingsRegistryError };

export class SettingsError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
    this.details = details;
  }
}

/** Narrow -> wide. A value at a narrower scope wins if the definition allows it. */
export const SCOPE_ORDER = Object.freeze(['user', 'warehouse', 'branch', 'company', 'tenant', 'system']);

function coerce(type, raw) {
  if (raw === null || raw === undefined) return null;
  switch (type) {
    case 'boolean': return raw === true || raw === 'true' || raw === 1 || raw === '1';
    case 'integer': return Number.parseInt(raw, 10);
    case 'decimal': return Number.parseFloat(raw);
    case 'json': return typeof raw === 'string' ? JSON.parse(raw) : raw;
    default: return String(raw);
  }
}

function validate(definition, value) {
  const errors = [];
  const type = definition.type;
  if (type === 'secret') {
    errors.push('a secret setting must be written through the secret vault, not settings');
    return errors;
  }
  if (value === null) {
    if ((definition.validationRules || []).some((r) => r.type === 'required')) errors.push('value is required');
    return errors;
  }
  if (type === 'boolean' && typeof value !== 'boolean') errors.push('value must be a boolean');
  if (type === 'integer' && !Number.isInteger(value)) errors.push('value must be an integer');
  if (type === 'decimal' && !Number.isFinite(value)) errors.push('value must be a number');
  for (const rule of definition.validationRules || []) {
    if (rule.type === 'min' && Number(value) < Number(rule.value)) errors.push(`value must be >= ${rule.value}`);
    if (rule.type === 'max' && Number(value) > Number(rule.value)) errors.push(`value must be <= ${rule.value}`);
    if (rule.type === 'enum' && !(rule.values || []).includes(value)) errors.push(`value must be one of ${(rule.values || []).join(', ')}`);
    if (rule.type === 'pattern' && !new RegExp(rule.value).test(String(value))) errors.push('value does not match the required pattern');
  }
  return errors;
}

export class SettingsAuthority {
  constructor(dialect, deps = {}) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new SettingsError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
    this.definitions = createSettingsRegistry(dialect);
    this.evaluator = deps.evaluator || null;
    this.cache = new Map();
  }

  #now() { return new Date().toISOString(); }

  /** Definition registration passes straight through to the Phase 01 registry. */
  define(setting, actor = 'system') {
    if (!Array.isArray(setting.scopes) || !setting.scopes.length) {
      throw new SettingsError('a setting must declare at least one scope', 'SETTING_SCOPES_REQUIRED');
    }
    for (const s of setting.scopes) {
      if (!SCOPE_ORDER.includes(s)) throw new SettingsError(`unknown scope ${s}`, 'SETTING_SCOPE_INVALID', { scope: s });
    }
    return this.definitions.register(setting, actor);
  }

  getDefinition(key) {
    const def = this.definitions.get(key);
    if (!def) throw new SettingsError(`setting ${key} is not defined`, 'SETTING_UNKNOWN', { key });
    return def;
  }

  /**
   * The WIDEST scope a setting declares is its base scope: writing there is
   * setting the value, not overriding it, so `overridable_scopes` does not apply.
   * Every narrower scope is an override and must be explicitly permitted.
   */
  baseScope(def) {
    for (let i = SCOPE_ORDER.length - 1; i >= 0; i--) {
      if (def.scopes.includes(SCOPE_ORDER[i])) return SCOPE_ORDER[i];
    }
    return 'system';
  }

  #assertOverridable(def, scope) {
    if (!def.scopes.includes(scope)) {
      throw new SettingsError(`setting ${def.key} does not support scope ${scope}`, 'SETTING_SCOPE_NOT_SUPPORTED', { key: def.key, scope });
    }
    if (scope === this.baseScope(def)) return;
    const overridable = def.overridableScopes || {};
    if (overridable[scope] !== true) {
      throw new SettingsError(`setting ${def.key} may not be overridden at scope ${scope}`, 'SETTING_OVERRIDE_FORBIDDEN', { key: def.key, scope });
    }
  }

  #moduleEnabled(moduleId) {
    const row = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(moduleId);
    return !!row && row.status === 'enabled';
  }

  /**
   * Set a value at a scope. Optimistic concurrency: pass `expectedVersion` to
   * detect a competing write (§ 63 "settings update version conflict").
   */
  set(key, scope, scopeId, rawValue, { actor = 'system', reason = null, expectedVersion = null, ctx = null } = {}) {
    const def = this.getDefinition(key);
    if (def.secret) throw new SettingsError('a secret setting cannot be written through settings', 'SETTING_IS_SECRET', { key });
    if (!this.#moduleEnabled(def.module_id)) {
      throw new SettingsError(`module ${def.module_id} is not enabled`, 'SETTING_MODULE_DISABLED', { key, moduleId: def.module_id });
    }
    this.#assertOverridable(def, scope);
    if (def.requiredPermission && this.evaluator && ctx) {
      this.evaluator.require({ permission: def.requiredPermission, ctx });
    }

    const value = coerce(def.type, rawValue);
    const errors = validate(def, value);
    if (errors.length) throw new SettingsError(`invalid value for ${key}: ${errors.join('; ')}`, 'SETTING_VALUE_INVALID', { key, errors });

    const sid = scopeId || '';
    const existing = this.dialect.prepare('SELECT id, value, version FROM settings_values WHERE key = ? AND scope = ? AND scope_id = ?').get(key, scope, sid);
    if (expectedVersion !== null && existing && Number(existing.version) !== Number(expectedVersion)) {
      throw new SettingsError('setting was modified by another writer', 'SETTING_VERSION_CONFLICT', { key, expected: expectedVersion, actual: existing.version });
    }
    const nextVersion = existing ? Number(existing.version) + 1 : 1;
    const serialized = def.type === 'json' ? JSON.stringify(value) : (value === null ? null : String(value));

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO settings_values (id, key, scope, scope_id, value, version, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key, scope, scope_id) DO UPDATE SET value=excluded.value, version=excluded.version,
          updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `).run(existing?.id || `sv_${crypto.randomUUID()}`, key, scope, sid, serialized, nextVersion, this.#now(), actor);
      this.dialect.prepare(`
        INSERT INTO settings_history (id, key, scope, scope_id, old_value, new_value, version, changed_at, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`sh_${crypto.randomUUID()}`, key, scope, sid, existing?.value ?? null, serialized, nextVersion, this.#now(), actor, reason);
      if (def.auditPolicy !== 'none') {
        this.dialect.prepare(`
          INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, before_value, after_value)
          VALUES (?, ?, 'user', 'settings.set', 'settings_values', ?, ?, 'settings', 'success', ?, ?)
        `).run(crypto.randomUUID(), actor, `${key}@${scope}:${sid}`, this.#now(),
          existing?.value ? JSON.stringify({ value: existing.value }) : null, JSON.stringify({ value: serialized }));
      }
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.cache.clear();
    return { key, scope, scopeId: sid, value, version: nextVersion, restartRequired: def.restartRequired };
  }

  /**
   * Effective value with explicit inheritance: narrowest declared scope that has
   * a value wins; otherwise the definition default.
   */
  effective(key, ctx = {}) {
    const def = this.getDefinition(key);
    const cacheKey = `${key}|${ctx.userId || ''}|${ctx.warehouseId || ''}|${ctx.branchId || ctx.activeBranchId || ''}|${ctx.companyId || ctx.activeCompanyId || ''}|${ctx.tenantId || ''}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const scopeIds = {
      user: ctx.userId || ctx.actorId || '',
      warehouse: ctx.warehouseId || '',
      branch: ctx.branchId || ctx.activeBranchId || '',
      company: ctx.companyId || ctx.activeCompanyId || '',
      tenant: ctx.tenantId || '',
      system: '',
    };
    let resolved = { value: coerce(def.type, def.defaultValue), source: 'default', scope: null, version: 0 };
    const base = this.baseScope(def);
    for (const scope of SCOPE_ORDER) {
      if (!def.scopes.includes(scope)) continue;
      if (scope !== 'system' && !scopeIds[scope]) continue;
      // A narrower scope contributes only where the definition declares it
      // overridable; the base (widest) scope always applies.
      if (scope !== base && (def.overridableScopes || {})[scope] !== true) continue;
      const row = this.dialect.prepare('SELECT value, version FROM settings_values WHERE key = ? AND scope = ? AND scope_id = ?')
        .get(key, scope, scopeIds[scope]);
      if (row) {
        resolved = { value: coerce(def.type, row.value), source: 'override', scope, version: row.version };
        break;
      }
    }
    const result = Object.freeze({ key, ...resolved, type: def.type, restartRequired: def.restartRequired });
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Dry-run: what would `effective()` return after this change? Mutates nothing. */
  preview(key, scope, scopeId, rawValue, ctx = {}) {
    const def = this.getDefinition(key);
    const before = this.effective(key, ctx);
    const candidate = coerce(def.type, rawValue);
    const errors = validate(def, candidate);
    let overrideForbidden = null;
    try { this.#assertOverridable(def, scope); } catch (e) { overrideForbidden = e.code; }
    return {
      key, scope, scopeId,
      before: before.value,
      after: overrideForbidden || errors.length ? before.value : candidate,
      wouldApply: !overrideForbidden && errors.length === 0,
      errors,
      overrideForbidden,
      restartRequired: def.restartRequired,
      affectsScope: scope,
    };
  }

  history(key, limit = 50) {
    return this.dialect.prepare('SELECT * FROM settings_history WHERE key = ? ORDER BY changed_at DESC, version DESC LIMIT ?').all(key, limit);
  }

  /** Revert to a prior version by replaying its old_value through set(). */
  revert(key, scope, scopeId, toVersion, { actor = 'system' } = {}) {
    const sid = scopeId || '';
    const entry = this.dialect.prepare('SELECT * FROM settings_history WHERE key = ? AND scope = ? AND scope_id = ? AND version = ?').get(key, scope, sid, toVersion);
    if (!entry) throw new SettingsError('no such setting version', 'SETTING_VERSION_NOT_FOUND', { key, toVersion });
    const result = this.set(key, scope, sid, entry.old_value, { actor, reason: `revert to version ${toVersion}` });
    this.dialect.prepare('UPDATE settings_history SET reverted_from = ? WHERE key = ? AND scope = ? AND scope_id = ? AND version = ?')
      .run(String(toVersion), key, scope, sid, result.version);
    return result;
  }

  /**
   * Compatibility reader for legacy Octagon settings keys (§ 61). Declares its
   * own owner and expiry so it cannot become a permanent second authority.
   */
  legacyReader(legacyKey, canonicalKey, ctx = {}) {
    const value = this.effective(canonicalKey, ctx);
    return {
      legacyKey, canonicalKey, value: value.value, source: value.source,
      adapter: { owner: 'platform.settings', writeAuthority: 'settings_values', expiry: 'P02-D2: removed when app.js reads the canonical key' },
    };
  }

  /** All effective values for a context — used by the client bootstrap. */
  effectiveAll(ctx = {}, { moduleId = null } = {}) {
    const keys = this.dialect.prepare(
      moduleId ? 'SELECT key FROM platform_settings WHERE module_id = ? ORDER BY key' : 'SELECT key FROM platform_settings ORDER BY key'
    ).all(...(moduleId ? [moduleId] : []));
    const out = {};
    for (const { key } of keys) {
      const def = this.definitions.get(key);
      if (def.secret) { out[key] = { key, value: null, secret: true, source: 'secret' }; continue; }
      out[key] = this.effective(key, ctx);
    }
    return out;
  }
}

export function createSettingsAuthority(dialect, deps) { return new SettingsAuthority(dialect, deps); }
