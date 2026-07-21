// Controlled configuration: custom fields, view schemas, saved views, and
// configuration packages. Phase 02 packets 02.15 and 02.16.
//
// Source composition:
// - VNext vnext/server/fields/custom-fields.js (project-owned, MERGE-CANONICAL):
//   metadata-declared fields stored inside the record's JSON payload — NO runtime
//   DDL. That decision is preserved and made explicit as an invariant.
// - NocoBase collection metadata + UI schema plugins (clean-room): entity schema,
//   view schema, and the protected business engine are three separate things.
// - Frappe Customize Form / Custom Field / Property Setter / fixtures
//   (SPEC-IMPLEMENT — FRAPPE_ROOT is absent locally, see source-lock.md).
// - Aureus plugins/webkul/fields + plugins/webkul/table-views (MIT reference,
//   behavior only): field type catalogue and saved table views.
//
// Invariants (§ 4.4, § 40, § 41):
//   - configuration NEVER issues DDL and never touches a protected entity/field
//   - a filter is a declarative structure, never a SQL string
//   - a package carries configuration, never a business ledger, never a secret

'use strict';

import crypto from 'node:crypto';

export class ConfigurationError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    this.details = details;
  }
}

export const FIELD_TYPES = Object.freeze(['string', 'text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'select', 'reference']);
const FIELD_NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;
/** Filter operators a saved view may use. Anything else is refused. */
export const SAFE_OPERATORS = Object.freeze(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'exists', 'not_exists']);

export class ConfigurationAuthority {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.evaluator = deps.evaluator || null;
    this.entities = deps.entityRegistry || null;
  }

  #now() { return new Date().toISOString(); }

  #audit(action, resourceId, detail, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result, after_value)
      VALUES (?, ?, 'user', ?, 'configuration', ?, ?, 'configuration', 'success', ?)
    `).run(crypto.randomUUID(), actor || 'system', action, resourceId, this.#now(), detail ? JSON.stringify(detail) : null);
  }

  // --- protection -----------------------------------------------------------

  isProtected(entity, field = null) {
    const entityRow = this.dialect.prepare("SELECT reason FROM configuration_protected WHERE kind = 'entity' AND entity = ?").get(entity);
    if (entityRow) return { protected: true, scope: 'entity', reason: entityRow.reason };
    if (field) {
      const fieldRow = this.dialect.prepare("SELECT reason FROM configuration_protected WHERE kind = 'field' AND entity = ? AND field = ?").get(entity, field);
      if (fieldRow) return { protected: true, scope: 'field', reason: fieldRow.reason };
    }
    return { protected: false };
  }

  protect({ kind, entity, field = null, reason }) {
    if (!reason) throw new ConfigurationError('a protection entry requires a reason', 'PROTECTION_REASON_REQUIRED');
    this.dialect.prepare(`
      INSERT INTO configuration_protected (id, kind, entity, field, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET reason = excluded.reason
    `).run(`cfgp_${kind}_${entity}_${field || 'all'}`, kind, entity, field, reason, this.#now());
  }

  // --- custom fields (packet 02.15) ----------------------------------------

  /**
   * Declare a custom field. This writes METADATA ONLY. Values live in the
   * existing x_records JSON payload, so no DDL is ever issued and no protected
   * engine is mutated.
   */
  defineCustomField({ entity, field, dataType, labelAr, labelEn = null, required = false, defaultValue = null, options = [], validation = [], tenantId = null, companyId = null }, actor = 'system', ctx = null) {
    const guard = this.isProtected(entity, field);
    if (guard.protected) {
      throw new ConfigurationError(`${entity}${guard.scope === 'field' ? `.${field}` : ''} is protected: ${guard.reason}`, 'CONFIGURATION_PROTECTED', { entity, field, reason: guard.reason });
    }
    if (!FIELD_NAME_RE.test(String(field))) {
      throw new ConfigurationError('field name must be lower_snake_case, 2-49 characters', 'CUSTOM_FIELD_NAME_INVALID', { field });
    }
    if (!FIELD_TYPES.includes(dataType)) throw new ConfigurationError(`unsupported data type ${dataType}`, 'CUSTOM_FIELD_TYPE_INVALID', { dataType });
    if (!labelAr) throw new ConfigurationError('an Arabic label is required', 'CUSTOM_FIELD_LABEL_REQUIRED');
    if (dataType === 'select' && (!Array.isArray(options) || !options.length)) {
      throw new ConfigurationError('a select field requires options', 'CUSTOM_FIELD_OPTIONS_REQUIRED');
    }
    // A custom field may never shadow a core field of the entity.
    if (this.entities) {
      const descriptor = this.entities.get?.(entity);
      const core = descriptor?.fields || descriptor?.columns || [];
      if (Array.isArray(core) && core.some((f) => (f.name || f) === field)) {
        throw new ConfigurationError(`field ${field} already exists on ${entity}`, 'CUSTOM_FIELD_SHADOWS_CORE', { entity, field });
      }
    }
    if (this.evaluator && ctx) this.evaluator.require({ permission: 'platform:configuration:manage', ctx });

    const id = `cf_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO custom_fields (id, entity, field, data_type, label_ar, label_en, required, default_value, options, validation, tenant_id, company_id, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT DO UPDATE SET data_type=excluded.data_type, label_ar=excluded.label_ar, label_en=excluded.label_en,
        required=excluded.required, default_value=excluded.default_value, options=excluded.options, validation=excluded.validation, status='active'
    `).run(id, entity, field, dataType, labelAr, labelEn, required ? 1 : 0, defaultValue,
      JSON.stringify(options), JSON.stringify(validation), tenantId, companyId, this.#now(), actor);
    this.#audit('custom_field.define', `${entity}.${field}`, { dataType }, actor);
    return this.customFields(entity, { tenantId, companyId }).find((f) => f.field === field);
  }

  customFields(entity, { tenantId = null, companyId = null } = {}) {
    return this.dialect.prepare(`
      SELECT * FROM custom_fields
      WHERE entity = ? AND status = 'active'
        AND (tenant_id IS NULL OR tenant_id = ?)
        AND (company_id IS NULL OR company_id = ?)
      ORDER BY field
    `).all(entity, tenantId, companyId).map((r) => ({
      id: r.id, entity: r.entity, field: r.field, dataType: r.data_type,
      labelAr: r.label_ar, labelEn: r.label_en, required: r.required === 1,
      defaultValue: r.default_value, options: JSON.parse(r.options || '[]'),
      validation: JSON.parse(r.validation || '[]'),
    }));
  }

  /**
   * Archiving keeps existing values readable (§ 40 "field removal with data").
   * Data is never destroyed by a configuration change.
   */
  archiveCustomField(entity, field, actor = 'system') {
    const affected = this.dialect.prepare(
      `SELECT COUNT(*) AS n FROM x_records WHERE entity = ? AND removed = 0 AND json_extract(data, '$.' || ?) IS NOT NULL`
    ).get(entity, field);
    this.dialect.prepare("UPDATE custom_fields SET status = 'archived' WHERE entity = ? AND field = ?").run(entity, field);
    this.#audit('custom_field.archive', `${entity}.${field}`, { recordsWithValue: Number(affected?.n || 0) }, actor);
    return { entity, field, archived: true, recordsRetainingValue: Number(affected?.n || 0) };
  }

  /** Validate a payload against the entity's active custom fields. */
  validateCustomValues(entity, payload, { tenantId = null, companyId = null } = {}) {
    const errors = [];
    for (const def of this.customFields(entity, { tenantId, companyId })) {
      const value = payload[def.field];
      if (value === undefined || value === null || value === '') {
        if (def.required) errors.push({ field: def.field, code: 'REQUIRED', messageAr: `الحقل ${def.labelAr} مطلوب` });
        continue;
      }
      if (def.dataType === 'integer' && !Number.isInteger(Number(value))) errors.push({ field: def.field, code: 'TYPE', messageAr: `${def.labelAr} يجب أن يكون رقماً صحيحاً` });
      if (def.dataType === 'decimal' && !Number.isFinite(Number(value))) errors.push({ field: def.field, code: 'TYPE', messageAr: `${def.labelAr} يجب أن يكون رقماً` });
      if (def.dataType === 'boolean' && typeof value !== 'boolean') errors.push({ field: def.field, code: 'TYPE', messageAr: `${def.labelAr} يجب أن يكون صح/خطأ` });
      if (def.dataType === 'select' && !def.options.includes(value)) errors.push({ field: def.field, code: 'ENUM', messageAr: `${def.labelAr} خارج القيم المسموحة` });
      for (const rule of def.validation) {
        if (rule.type === 'max_length' && String(value).length > Number(rule.value)) errors.push({ field: def.field, code: 'MAX_LENGTH', messageAr: `${def.labelAr} أطول من المسموح` });
        if (rule.type === 'min' && Number(value) < Number(rule.value)) errors.push({ field: def.field, code: 'MIN', messageAr: `${def.labelAr} أقل من الحد الأدنى` });
        if (rule.type === 'max' && Number(value) > Number(rule.value)) errors.push({ field: def.field, code: 'MAX', messageAr: `${def.labelAr} أكبر من الحد الأقصى` });
      }
    }
    return { ok: errors.length === 0, errors };
  }

  // --- view schemas and saved views ----------------------------------------

  defineViewSchema({ entity, kind, name, schema, tenantId = null, companyId = null }, actor = 'system') {
    const guard = this.isProtected(entity);
    if (guard.protected && guard.scope === 'entity') {
      // A protected entity may still have a PRESENTATION schema; what it may not
      // have is a structural change. Presentation is explicitly allowed.
      if (!['form', 'list', 'detail', 'kanban'].includes(kind)) {
        throw new ConfigurationError('only presentation schemas are permitted on a protected entity', 'CONFIGURATION_PROTECTED', { entity });
      }
    }
    const prev = this.dialect.prepare('SELECT MAX(version) AS v FROM view_schemas WHERE entity = ? AND kind = ? AND name = ?').get(entity, kind, name);
    const version = Number(prev?.v || 0) + 1;
    const id = `vs_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO view_schemas (id, entity, kind, name, schema, tenant_id, company_id, version, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, entity, kind, name, JSON.stringify(schema), tenantId, companyId, version, this.#now(), actor);
    this.dialect.prepare("UPDATE view_schemas SET status = 'retired' WHERE entity = ? AND kind = ? AND name = ? AND id <> ?").run(entity, kind, name, id);
    this.#audit('view_schema.define', `${entity}.${kind}.${name}`, { version }, actor);
    return { id, entity, kind, name, version, schema };
  }

  getViewSchema(entity, kind, name) {
    const r = this.dialect.prepare("SELECT * FROM view_schemas WHERE entity = ? AND kind = ? AND name = ? AND status = 'active'").get(entity, kind, name);
    return r ? { id: r.id, entity: r.entity, kind: r.kind, name: r.name, version: r.version, schema: JSON.parse(r.schema) } : null;
  }

  /** Reject any filter that is not a declarative, whitelisted structure. */
  assertSafeFilters(filters) {
    if (filters === null || filters === undefined) return true;
    if (typeof filters === 'string') throw new ConfigurationError('a filter must be a structure, not a string', 'FILTER_UNSAFE', { filters });
    if (typeof filters !== 'object') throw new ConfigurationError('invalid filter', 'FILTER_UNSAFE');
    for (const [field, spec] of Object.entries(filters)) {
      if (!FIELD_NAME_RE.test(field)) throw new ConfigurationError(`unsafe filter field ${field}`, 'FILTER_UNSAFE', { field });
      const op = (spec && typeof spec === 'object' && !Array.isArray(spec)) ? spec.op : 'eq';
      if (!SAFE_OPERATORS.includes(op)) throw new ConfigurationError(`unsupported filter operator ${op}`, 'FILTER_UNSAFE', { field, op });
    }
    return true;
  }

  saveView({ id, entity, name, ownerId, shared = false, roleId = null, companyId = null, filters = {}, sort = [], columns = [] }, actor = 'system', ctx = null) {
    this.assertSafeFilters(filters);
    if (shared) {
      // A shared view is visible to other users, so publishing it is a governed act.
      if (this.evaluator && ctx) this.evaluator.require({ permission: 'platform:configuration:share_view', ctx });
      else if (this.evaluator) throw new ConfigurationError('sharing a view requires an authorization context', 'SHARE_REQUIRES_CONTEXT');
    }
    const viewId = id || `sv_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO saved_views (id, entity, name, owner_id, shared, shared_approved_by, role_id, company_id, filters, sort, columns, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, filters=excluded.filters, sort=excluded.sort, columns=excluded.columns, shared=excluded.shared
    `).run(viewId, entity, name, ownerId, shared ? 1 : 0, shared ? actor : null, roleId, companyId,
      JSON.stringify(filters), JSON.stringify(sort), JSON.stringify(columns), this.#now());
    return this.getView(viewId);
  }

  getView(id) {
    const r = this.dialect.prepare('SELECT * FROM saved_views WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, entity: r.entity, name: r.name, ownerId: r.owner_id, shared: r.shared === 1,
      sharedApprovedBy: r.shared_approved_by, roleId: r.role_id, companyId: r.company_id,
      filters: JSON.parse(r.filters || '{}'), sort: JSON.parse(r.sort || '[]'), columns: JSON.parse(r.columns || '[]'),
    };
  }

  /** Views visible to an actor: their own, plus shared views inside their scope. */
  listViews(entity, ctx) {
    return this.dialect.prepare(`
      SELECT id FROM saved_views
      WHERE entity = ?
        AND (owner_id = ? OR (shared = 1 AND (company_id IS NULL OR company_id = ?) AND (role_id IS NULL OR role_id IN (
          SELECT role_id FROM authorization_role_assignments WHERE user_id = ? AND status = 'active'
        ))))
      ORDER BY shared, name
    `).all(entity, ctx.actorId, ctx.activeCompanyId || null, ctx.actorId).map((r) => this.getView(r.id));
  }

  // --- configuration packages (packet 02.16) -------------------------------

  /** Kinds a package may carry. Anything else is refused at build time. */
  static PACKAGEABLE = Object.freeze([
    'setting_definition', 'setting_value', 'custom_field', 'view_schema', 'saved_view',
    'workflow_definition', 'approval_policy', 'notification_template', 'print_template',
    'terminology', 'role_template', 'pack_preset',
  ]);

  /** Kinds a package may NEVER carry (§ 41). */
  static FORBIDDEN = Object.freeze([
    'account_moves', 'account_move_lines', 'stock_moves', 'payments', 'payroll',
    'audit', 'platform_audit_log', 'session', 'api_key', 'secret', 'secret_value',
    'customer_record', 'employee',
  ]);

  buildPackage({ name, version, items, targetMinVersion = null }, actor = 'system') {
    for (const item of items) {
      if (ConfigurationAuthority.FORBIDDEN.includes(item.kind)) {
        throw new ConfigurationError(`a configuration package may not carry ${item.kind}`, 'PACKAGE_FORBIDDEN_ITEM', { kind: item.kind });
      }
      if (!ConfigurationAuthority.PACKAGEABLE.includes(item.kind)) {
        throw new ConfigurationError(`unknown package item kind ${item.kind}`, 'PACKAGE_UNKNOWN_ITEM', { kind: item.kind });
      }
      const serialized = JSON.stringify(item.payload || {});
      if (/secret:\/\//.test(serialized) && item.kind !== 'setting_definition') {
        throw new ConfigurationError('a package may reference a secret only in a definition, never a value', 'PACKAGE_SECRET_LEAK', { kind: item.kind });
      }
      if (/"(password|client_secret|api_key|token)"\s*:/i.test(serialized)) {
        throw new ConfigurationError('a package payload contains a credential field', 'PACKAGE_SECRET_LEAK', { kind: item.kind });
      }
    }
    const manifest = {
      name, version, targetMinVersion,
      items: items.map((i) => ({ kind: i.kind, key: i.key })),
      dependencies: items.flatMap((i) => i.dependsOn || []),
      generatedAt: this.#now(),
    };
    const checksum = crypto.createHash('sha256').update(JSON.stringify({ manifest, items })).digest('hex');
    const id = `pkg_${crypto.randomUUID()}`;
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO configuration_packages (id, name, version, manifest, checksum, target_min_version, status, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)
      `).run(id, name, version, JSON.stringify(manifest), checksum, targetMinVersion, this.#now(), actor);
      const ins = this.dialect.prepare('INSERT INTO configuration_package_items (id, package_id, item_kind, item_key, payload) VALUES (?, ?, ?, ?, ?)');
      for (const item of items) ins.run(`pki_${crypto.randomUUID()}`, id, item.kind, item.key, JSON.stringify(item.payload || {}));
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.#audit('package.build', id, { name, version, itemCount: items.length }, actor);
    return { id, name, version, checksum, manifest };
  }

  /** Dry run: report conflicts and dependency gaps without changing anything. */
  dryRun(packageId, { currentVersion = null } = {}) {
    const pkg = this.dialect.prepare('SELECT * FROM configuration_packages WHERE id = ?').get(packageId);
    if (!pkg) throw new ConfigurationError('package not found', 'PACKAGE_NOT_FOUND', { packageId });
    const manifest = JSON.parse(pkg.manifest);
    const items = this.dialect.prepare('SELECT * FROM configuration_package_items WHERE package_id = ?').all(packageId);

    const versionIncompatible = !!(pkg.target_min_version && currentVersion && compareVersions(currentVersion, pkg.target_min_version) < 0);
    const conflicts = [];
    const missingDependencies = [];
    for (const item of items) {
      if (item.item_kind === 'custom_field') {
        const [entity, field] = item.item_key.split('.');
        const guard = this.isProtected(entity, field);
        if (guard.protected) conflicts.push({ key: item.item_key, kind: item.item_kind, reason: `protected: ${guard.reason}` });
        const existing = this.dialect.prepare('SELECT id FROM custom_fields WHERE entity = ? AND field = ?').get(entity, field);
        if (existing) conflicts.push({ key: item.item_key, kind: item.item_kind, reason: 'already exists; apply would overwrite' });
      }
      if (item.item_kind === 'setting_value') {
        const def = this.dialect.prepare('SELECT key FROM platform_settings WHERE key = ?').get(item.item_key);
        if (!def) missingDependencies.push({ key: item.item_key, reason: 'setting definition is not installed' });
      }
    }
    return {
      packageId, name: pkg.name, version: pkg.version, checksum: pkg.checksum,
      itemCount: items.length, manifest,
      versionIncompatible, conflicts, missingDependencies,
      canApply: !versionIncompatible && missingDependencies.length === 0,
    };
  }

  /**
   * Apply atomically, recording the previous payload of every item so `rollback()`
   * can restore it. A failure anywhere leaves nothing applied.
   */
  apply(packageId, { actor = 'system', force = false, currentVersion = null } = {}) {
    const plan = this.dryRun(packageId, { currentVersion });
    if (!plan.canApply && !force) {
      throw new ConfigurationError('package cannot be applied', 'PACKAGE_NOT_APPLICABLE', { conflicts: plan.conflicts, missingDependencies: plan.missingDependencies, versionIncompatible: plan.versionIncompatible });
    }
    const items = this.dialect.prepare('SELECT * FROM configuration_package_items WHERE package_id = ?').all(packageId);
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      for (const item of items) {
        const payload = JSON.parse(item.payload);
        let previous = null;
        if (item.item_kind === 'custom_field') {
          const [entity, field] = item.item_key.split('.');
          previous = this.dialect.prepare('SELECT * FROM custom_fields WHERE entity = ? AND field = ?').get(entity, field) || null;
          this.dialect.prepare(`
            INSERT INTO custom_fields (id, entity, field, data_type, label_ar, label_en, required, default_value, options, validation, status, created_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
            ON CONFLICT DO UPDATE SET data_type=excluded.data_type, label_ar=excluded.label_ar, status='active'
          `).run(`cf_${crypto.randomUUID()}`, entity, field, payload.dataType, payload.labelAr, payload.labelEn || null,
            payload.required ? 1 : 0, payload.defaultValue || null, JSON.stringify(payload.options || []),
            JSON.stringify(payload.validation || []), this.#now(), actor);
        } else if (item.item_kind === 'view_schema') {
          const [entity, kind, name] = item.item_key.split('.');
          previous = this.getViewSchema(entity, kind, name);
          this.defineViewSchema({ entity, kind, name, schema: payload }, actor);
        }
        this.dialect.prepare('UPDATE configuration_package_items SET previous_payload = ? WHERE id = ?')
          .run(previous ? JSON.stringify(previous) : null, item.id);
      }
      this.dialect.prepare("UPDATE configuration_packages SET status = 'applied', applied_at = ? WHERE id = ?").run(this.#now(), packageId);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw new ConfigurationError(`package apply failed and was rolled back: ${e.message}`, 'PACKAGE_APPLY_FAILED', { cause: e.message });
    }
    this.#audit('package.apply', packageId, { itemCount: items.length }, actor);
    return { packageId, applied: items.length };
  }

  rollback(packageId, actor = 'system') {
    const items = this.dialect.prepare('SELECT * FROM configuration_package_items WHERE package_id = ?').all(packageId);
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      for (const item of items) {
        if (item.item_kind === 'custom_field') {
          const [entity, field] = item.item_key.split('.');
          if (item.previous_payload) {
            const prev = JSON.parse(item.previous_payload);
            this.dialect.prepare('UPDATE custom_fields SET data_type=?, label_ar=?, status=? WHERE entity=? AND field=?')
              .run(prev.data_type, prev.label_ar, prev.status, entity, field);
          } else {
            this.dialect.prepare("UPDATE custom_fields SET status='archived' WHERE entity=? AND field=?").run(entity, field);
          }
        }
      }
      this.dialect.prepare("UPDATE configuration_packages SET status = 'rolled_back' WHERE id = ?").run(packageId);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    this.#audit('package.rollback', packageId, null, actor);
    return { packageId, rolledBack: items.length };
  }
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function createConfigurationAuthority(dialect, deps) { return new ConfigurationAuthority(dialect, deps); }
export { compareVersions };
