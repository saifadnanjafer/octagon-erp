// Settings registry — Phase 01 kernel.
//
// Source composition:
// - VNext settings/store patterns (project-owned).
// - Frappe system settings (MIT reference) for defaults and scoping.

'use strict';

export class SettingsRegistryError extends Error {
  constructor(message, code) { super(message); this.name = 'SettingsRegistryError'; this.code = code; }
}

export class SettingsRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new SettingsRegistryError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  register(setting, actor = 'system') {
    if (!setting.key || !setting.module_id || !setting.type) throw new SettingsRegistryError('key, module_id, and type are required', 'SETTING_INVALID');
    this.dialect.prepare(`
      INSERT INTO platform_settings (key, module_id, type, default_value, scopes, overridable_scopes, required_permission, audit_policy, secret, restart_required, validation_rules, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        module_id = excluded.module_id,
        type = excluded.type,
        default_value = excluded.default_value,
        scopes = excluded.scopes,
        overridable_scopes = excluded.overridable_scopes,
        required_permission = excluded.required_permission,
        audit_policy = excluded.audit_policy,
        secret = excluded.secret,
        restart_required = excluded.restart_required,
        validation_rules = excluded.validation_rules,
        updated_at = excluded.updated_at
    `).run(
      setting.key, setting.module_id, setting.type, setting.default_value || null,
      JSON.stringify(setting.scopes || []), JSON.stringify(setting.overridable_scopes || {}),
      setting.required_permission || null, setting.audit_policy || 'required',
      setting.secret ? 1 : 0, setting.restart_required ? 1 : 0,
      JSON.stringify(setting.validation_rules || []), this.#now(), this.#now()
    );
    return setting.key;
  }

  get(key) {
    const row = this.dialect.prepare('SELECT * FROM platform_settings WHERE key = ?').get(key);
    if (!row) return null;
    return {
      key: row.key, module_id: row.module_id, type: row.type, defaultValue: row.default_value,
      scopes: JSON.parse(row.scopes || '[]'), overridableScopes: JSON.parse(row.overridable_scopes || '{}'),
      requiredPermission: row.required_permission, auditPolicy: row.audit_policy,
      secret: row.secret === 1, restartRequired: row.restart_required === 1,
      validationRules: JSON.parse(row.validation_rules || '[]'),
    };
  }
}

export function createSettingsRegistry(dialect) { return new SettingsRegistry(dialect); }
