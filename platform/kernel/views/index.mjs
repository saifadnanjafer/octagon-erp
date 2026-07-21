// View registry — Phase 01 foundation.
//
// Source composition:
// - VNext vnext/client/r3-ui.js and views-fields.js (project-owned) used as
//   the behavioral reference for view descriptors, menu entries, and route binding.
// - NocoBase SchemaComponent (clean-room reference) for separation between data
//   schema and view schema.
// - Frappe form/list/grid (MIT reference) for view-type semantics.
// - AureusERP Filament Resources (MIT reference) for declarative resource binding.
//
// Responsibilities:
//   - register and version pages, menus, routes, and view descriptors
//   - enforce module ownership and route uniqueness
//   - support deterministic menu order
//   - support extension patches and conflict detection
//   - support rollback to a previous descriptor version
//   - do not mutate business invariants through view metadata

'use strict';

import crypto from 'node:crypto';

export const VIEW_TYPES = ['page', 'list', 'form', 'detail', 'workspace', 'dialog', 'custom'];

export class ViewRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ViewRegistryError';
    this.code = code;
    this.details = details;
  }
}

export function validateViewDescriptor(input) {
  if (!input || typeof input !== 'object') throw new ViewRegistryError('view must be an object', 'VIEW_INVALID');
  if (!input.id || typeof input.id !== 'string') throw new ViewRegistryError('view id is required', 'VIEW_INVALID_ID');
  if (!input.module_id || typeof input.module_id !== 'string') throw new ViewRegistryError('module_id is required', 'VIEW_MISSING_MODULE');
  if (!input.view_type || !VIEW_TYPES.includes(input.view_type)) throw new ViewRegistryError(`view_type must be one of ${VIEW_TYPES.join(', ')}`, 'VIEW_INVALID_TYPE');
  if (!input.layout_schema || typeof input.layout_schema !== 'object') throw new ViewRegistryError('layout_schema is required', 'VIEW_MISSING_SCHEMA');
  return {
    id: input.id,
    module_id: input.module_id,
    entity_id: input.entity_id || null,
    view_type: input.view_type,
    route: input.route || null,
    menu_location: input.menu_location || null,
    layout_schema: input.layout_schema,
    layout_version: input.layout_version || '1',
    actions: input.actions || [],
    required_permissions: input.required_permissions || [],
    required_feature_states: input.required_feature_states || [],
    localization_keys: input.localization_keys || {},
    extension_patches: input.extension_patches || [],
    api_exposed: input.api_exposed !== false,
  };
}

export class ViewRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') {
      throw new ViewRegistryError('dialect with prepare() is required', 'DIALECT_REQUIRED');
    }
    this.dialect = dialect;
  }

  #now() {
    return new Date().toISOString();
  }

  #assertModuleEnabled(moduleId) {
    const row = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(moduleId);
    if (!row) throw new ViewRegistryError(`module ${moduleId} not installed`, 'MODULE_NOT_FOUND');
    if (row.status !== 'enabled') throw new ViewRegistryError(`module ${moduleId} is not enabled`, 'MODULE_NOT_ENABLED');
  }

  #checkRouteConflict(view) {
    if (!view.route) return;
    const existing = this.dialect.prepare('SELECT id, module_id FROM platform_views WHERE route = ?').get(view.route);
    if (existing && existing.id !== view.id) {
      throw new ViewRegistryError(`route "${view.route}" is already owned by view "${existing.id}"`, 'ROUTE_CONFLICT');
    }
  }

  #toRow(view) {
    return {
      id: view.id,
      module_id: view.module_id,
      entity_id: view.entity_id,
      view_type: view.view_type,
      route: view.route,
      menu_location: view.menu_location,
      layout_schema: JSON.stringify(view.layout_schema),
      layout_version: view.layout_version,
      actions: JSON.stringify(view.actions),
      required_permissions: JSON.stringify(view.required_permissions),
      required_feature_states: JSON.stringify(view.required_feature_states),
      localization_keys: JSON.stringify(view.localization_keys),
      extension_patches: JSON.stringify(view.extension_patches),
    };
  }

  #fromRow(row) {
    return {
      id: row.id,
      module_id: row.module_id,
      entity_id: row.entity_id,
      view_type: row.view_type,
      route: row.route,
      menu_location: row.menu_location,
      layout_schema: JSON.parse(row.layout_schema || '{}'),
      layout_version: row.layout_version,
      actions: JSON.parse(row.actions || '[]'),
      required_permissions: JSON.parse(row.required_permissions || '[]'),
      required_feature_states: JSON.parse(row.required_feature_states || '[]'),
      localization_keys: JSON.parse(row.localization_keys || '{}'),
      extension_patches: JSON.parse(row.extension_patches || '[]'),
      api_exposed: row.api_exposed === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  #recordVersion(view, actor) {
    this.dialect.prepare(`
      INSERT INTO platform_view_versions (id, view_id, module_id, entity_id, view_type, route, menu_location, layout_schema, layout_version, actions, required_permissions, required_feature_states, localization_keys, extension_patches, recorded_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), view.id, view.module_id, view.entity_id, view.view_type, view.route, view.menu_location,
      JSON.stringify(view.layout_schema), view.layout_version, JSON.stringify(view.actions), JSON.stringify(view.required_permissions),
      JSON.stringify(view.required_feature_states), JSON.stringify(view.localization_keys), JSON.stringify(view.extension_patches),
      actor, this.#now()
    );
  }

  register(input, actor = 'system') {
    const view = validateViewDescriptor(input);
    this.#assertModuleEnabled(view.module_id);
    this.#checkRouteConflict(view);

    const existing = this.dialect.prepare('SELECT id FROM platform_views WHERE id = ?').get(view.id);
    const nextVersion = existing ? String(Number(this.dialect.prepare('SELECT layout_version FROM platform_views WHERE id = ?').get(view.id).layout_version || 1) + 1) : view.layout_version;
    view.layout_version = nextVersion;

    const row = this.#toRow(view);
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO platform_views (
          id, module_id, entity_id, view_type, route, menu_location, layout_schema, layout_version,
          actions, required_permissions, required_feature_states, localization_keys, extension_patches,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          module_id = excluded.module_id,
          entity_id = excluded.entity_id,
          view_type = excluded.view_type,
          route = excluded.route,
          menu_location = excluded.menu_location,
          layout_schema = excluded.layout_schema,
          layout_version = excluded.layout_version,
          actions = excluded.actions,
          required_permissions = excluded.required_permissions,
          required_feature_states = excluded.required_feature_states,
          localization_keys = excluded.localization_keys,
          extension_patches = excluded.extension_patches,
          updated_at = excluded.updated_at
      `).run(
        view.id, row.module_id, row.entity_id, row.view_type, row.route, row.menu_location, row.layout_schema,
        row.layout_version, row.actions, row.required_permissions, row.required_feature_states, row.localization_keys,
        row.extension_patches, this.#now(), this.#now()
      );
      this.#recordVersion(view, actor);
      this.dialect.prepare(`
        INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), actor, 'user', 'view.register', 'platform_views', view.id, this.#now(), 'registry', 'success');
      this.dialect.exec('COMMIT;');
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
    return view;
  }

  get(id) {
    const row = this.dialect.prepare('SELECT * FROM platform_views WHERE id = ?').get(id);
    return row ? this.#fromRow(row) : null;
  }

  getByRoute(route) {
    const row = this.dialect.prepare('SELECT * FROM platform_views WHERE route = ?').get(route);
    return row ? this.#fromRow(row) : null;
  }

  list() {
    return this.dialect.prepare('SELECT * FROM platform_views ORDER BY menu_location, id').all().map((row) => this.#fromRow(row));
  }

  listMenu() {
    return this.dialect.prepare('SELECT id, module_id, menu_location, route, localization_keys, required_permissions FROM platform_views WHERE menu_location IS NOT NULL ORDER BY menu_location, id').all();
  }

  getVersions(id) {
    return this.dialect.prepare('SELECT id, layout_version, recorded_at, recorded_by FROM platform_view_versions WHERE view_id = ? ORDER BY recorded_at DESC').all(id);
  }

  rollback(id, targetVersion, actor = 'system') {
    const target = this.dialect.prepare('SELECT * FROM platform_view_versions WHERE view_id = ? AND layout_version = ?').get(id, targetVersion);
    if (!target) throw new ViewRegistryError(`version ${targetVersion} not found for view ${id}`, 'VERSION_NOT_FOUND');
    const view = this.#fromRow(target);
    view.id = id;
    return this.register(view, actor);
  }

  applyPatch(id, patch, actor = 'system') {
    const current = this.get(id);
    if (!current) throw new ViewRegistryError(`view ${id} not found`, 'VIEW_NOT_FOUND');
    if (patch.extension_patches) {
      for (const p of patch.extension_patches) {
        if (current.extension_patches.some((ep) => ep.target === p.target && ep.op === p.op)) {
          throw new ViewRegistryError(`patch conflict on ${p.target}/${p.op}`, 'PATCH_CONFLICT');
        }
      }
      current.extension_patches.push(...patch.extension_patches);
    }
    if (patch.layout_schema) {
      current.layout_schema = { ...current.layout_schema, ...patch.layout_schema };
    }
    return this.register(current, actor);
  }

  unregister(id, actor = 'system') {
    this.dialect.prepare('DELETE FROM platform_views WHERE id = ?').run(id);
    this.dialect.prepare('DELETE FROM platform_view_versions WHERE view_id = ?').run(id);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), actor, 'user', 'view.unregister', 'platform_views', id, this.#now(), 'registry', 'success');
    return { id, unregistered: true };
  }
}

export function createViewRegistry(dialect) {
  return new ViewRegistry(dialect);
}
