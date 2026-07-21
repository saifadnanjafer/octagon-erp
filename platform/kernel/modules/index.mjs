// Octagon module registry — Phase 01 foundation.
//
// Source composition:
// - VNext module-framework.js (project-owned): ModuleRegistry class, load-order
//   resolution via DFS, manifest id validation, disk discovery.
// - VNext module-lifecycle.js (project-owned): install/enable/disable/uninstall
//   lifecycle, dependency checks, conflict detection, patch tracking.
// - VNext pack-sdk-engine.js (project-owned): pack manifest validation, hash,
//   edition gate, conformance checks.
// - Merged into one canonical registry over the platform_modules table.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MODULE_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;
export const MODULE_KINDS = ['core', 'standard', 'optional', 'pack'];
export const MODULE_STATES = ['available', 'installed', 'licensed', 'enabled', 'visible', 'authorized'];

export class ModuleRegistryError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ModuleRegistryError';
    this.code = code;
    this.details = details;
  }
}

export function validateModuleManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new ModuleRegistryError('manifest must be a non-null object', 'MANIFEST_INVALID');
  }
  if (!manifest.id || typeof manifest.id !== 'string' || !MODULE_ID_RE.test(manifest.id)) {
    throw new ModuleRegistryError(`module id must match ${MODULE_ID_RE}`, 'MANIFEST_INVALID_ID', { id: manifest.id });
  }
  if (!manifest.name || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new ModuleRegistryError('module name is required', 'MANIFEST_MISSING_NAME');
  }
  if (!manifest.version || typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new ModuleRegistryError('module version is required', 'MANIFEST_MISSING_VERSION');
  }
  if (manifest.kind && !MODULE_KINDS.includes(manifest.kind)) {
    throw new ModuleRegistryError(`module kind must be one of ${MODULE_KINDS.join(', ')}`, 'MANIFEST_INVALID_KIND', { kind: manifest.kind });
  }
  if (!manifest.owner || typeof manifest.owner !== 'string') {
    throw new ModuleRegistryError('module owner is required', 'MANIFEST_MISSING_OWNER');
  }
  if (manifest.dependencies) {
    if (typeof manifest.dependencies !== 'object') {
      throw new ModuleRegistryError('dependencies must be an object', 'MANIFEST_INVALID_DEPENDENCIES');
    }
    if (manifest.dependencies.required && !Array.isArray(manifest.dependencies.required)) {
      throw new ModuleRegistryError('dependencies.required must be an array', 'MANIFEST_INVALID_DEPENDENCIES');
    }
    if (manifest.dependencies.optional && !Array.isArray(manifest.dependencies.optional)) {
      throw new ModuleRegistryError('dependencies.optional must be an array', 'MANIFEST_INVALID_DEPENDENCIES');
    }
  }
  return true;
}

export function hashManifest(manifest) {
  const canonical = JSON.stringify(manifest, Object.keys(manifest).sort());
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function discoverModules(modulesDir) {
  const registry = new Map();
  const discovered = [];
  const errors = [];
  if (!modulesDir || !fs.existsSync(modulesDir)) {
    return { registry, discovered, errors };
  }
  const entries = fs.readdirSync(modulesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of entries) {
    const dir = path.join(modulesDir, entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const id = String(manifest.id || entry.name || '').trim();
      if (!MODULE_ID_RE.test(id)) {
        errors.push({ dir, error: `invalid module id "${id}"` });
        continue;
      }
      if (id !== entry.name) {
        errors.push({ dir, error: `manifest id "${id}" must match folder name "${entry.name}"` });
        continue;
      }
      validateModuleManifest(manifest);
      registry.set(id, manifest);
      discovered.push({ id, dir, manifest });
    } catch (error) {
      errors.push({ dir, error: error.message || String(error) });
    }
  }
  return { registry, discovered, errors };
}

export function resolveLoadOrder(registry) {
  const visited = new Set();
  const temp = new Set();
  const order = [];

  function visit(id) {
    if (temp.has(id)) throw new ModuleRegistryError(`Circular dependency detected involving module: ${id}`, 'DEPENDENCY_CYCLE');
    if (!visited.has(id)) {
      temp.add(id);
      const manifest = registry.get(id);
      if (manifest) {
        const deps = manifest.dependencies?.required || [];
        for (const dep of deps) {
          if (!registry.has(dep)) {
            throw new ModuleRegistryError(`Missing dependency: ${dep} required by module ${id}`, 'MISSING_DEPENDENCY', { moduleId: id, missingDependency: dep });
          }
          visit(dep);
        }
      }
      temp.delete(id);
      visited.add(id);
      order.push(id);
    }
  }

  for (const id of registry.keys()) visit(id);
  return order;
}

export class ModuleRegistry {
  constructor(dialect) {
    this.dialect = dialect;
  }

  #now() {
    return new Date().toISOString();
  }

  #rowToModule(row) {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      status: row.status,
      kind: row.kind,
      owner: row.owner,
      dependencies: JSON.parse(row.dependencies || '[]'),
      optionalDependencies: JSON.parse(row.optional_dependencies || '[]'),
      capabilities: JSON.parse(row.capabilities || '[]'),
      migrations: JSON.parse(row.migrations || '[]'),
      settings: JSON.parse(row.settings || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  install(manifest, actor = 'system') {
    validateModuleManifest(manifest);
    const deps = manifest.dependencies?.required || [];
    for (const dep of deps) {
      const row = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(dep);
      if (!row || row.status !== 'enabled') {
        throw new ModuleRegistryError(`Dependency ${dep} is not enabled`, 'DEPENDENCY_NOT_ENABLED', { moduleId: manifest.id, dependency: dep });
      }
    }

    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO platform_modules (id, name, version, status, kind, owner, dependencies, optional_dependencies, capabilities, migrations, settings, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          status = excluded.status,
          kind = excluded.kind,
          owner = excluded.owner,
          dependencies = excluded.dependencies,
          optional_dependencies = excluded.optional_dependencies,
          capabilities = excluded.capabilities,
          migrations = excluded.migrations,
          settings = excluded.settings,
          updated_at = excluded.updated_at
      `).run(
        manifest.id,
        manifest.name,
        manifest.version,
        'installed',
        manifest.kind || 'standard',
        manifest.owner,
        JSON.stringify(manifest.dependencies?.required || []),
        JSON.stringify(manifest.dependencies?.optional || []),
        JSON.stringify(manifest.capabilities || []),
        JSON.stringify(manifest.migrations || []),
        JSON.stringify(manifest.settings || []),
        this.#now(),
        this.#now()
      );
      this.dialect.prepare(`
        INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        actor,
        'user',
        'module.install',
        'platform_modules',
        manifest.id,
        this.#now(),
        'registry',
        'success'
      );
      this.dialect.exec('COMMIT;');
      return this.get(manifest.id);
    } catch (error) {
      this.dialect.exec('ROLLBACK;');
      throw error;
    }
  }

  setStatus(moduleId, status, actor = 'system') {
    if (!MODULE_STATES.includes(status)) {
      throw new ModuleRegistryError(`Invalid module status: ${status}`, 'INVALID_STATUS', { status });
    }
    const existing = this.dialect.prepare('SELECT id, status FROM platform_modules WHERE id = ?').get(moduleId);
    if (!existing) {
      throw new ModuleRegistryError(`Module ${moduleId} not installed`, 'MODULE_NOT_FOUND');
    }
    if (status === 'enabled') {
      const manifest = this.get(moduleId);
      for (const dep of manifest.dependencies || []) {
        const depRow = this.dialect.prepare('SELECT status FROM platform_modules WHERE id = ?').get(dep);
        if (!depRow || depRow.status !== 'enabled') {
          throw new ModuleRegistryError(`Cannot enable ${moduleId}: dependency ${dep} is not enabled`, 'DEPENDENCY_NOT_ENABLED', { moduleId, dependency: dep });
        }
      }
    }
    this.dialect.prepare('UPDATE platform_modules SET status = ?, updated_at = ? WHERE id = ?').run(status, this.#now(), moduleId);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      actor,
      'user',
      `module.status.${status}`,
      'platform_modules',
      moduleId,
      this.#now(),
      'registry',
      'success'
    );
    return this.get(moduleId);
  }

  disable(moduleId, actor = 'system') {
    return this.setStatus(moduleId, 'installed', actor);
  }

  enable(moduleId, actor = 'system') {
    return this.setStatus(moduleId, 'enabled', actor);
  }

  uninstall(moduleId, actor = 'system') {
    const existing = this.dialect.prepare('SELECT id FROM platform_modules WHERE id = ?').get(moduleId);
    if (!existing) {
      throw new ModuleRegistryError(`Module ${moduleId} not installed`, 'MODULE_NOT_FOUND');
    }
    const dependentModule = this.dialect.prepare('SELECT id FROM platform_modules WHERE dependencies LIKE ?').get(`%"${moduleId}"%`);
    if (dependentModule) {
      throw new ModuleRegistryError(`Cannot uninstall ${moduleId}: dependent modules exist`, 'DEPENDENT_MODULES_EXIST', { moduleId });
    }
    const dependentEntity = this.dialect.prepare('SELECT 1 FROM platform_entities WHERE module_id = ?').get(moduleId);
    const dependentAction = this.dialect.prepare('SELECT 1 FROM platform_actions WHERE module_id = ?').get(moduleId);
    const dependentView = this.dialect.prepare('SELECT 1 FROM platform_views WHERE module_id = ?').get(moduleId);
    const dependentSetting = this.dialect.prepare('SELECT 1 FROM platform_settings WHERE module_id = ?').get(moduleId);
    const dependentEvent = this.dialect.prepare('SELECT 1 FROM platform_events WHERE module_id = ?').get(moduleId);
    const dependentSequence = this.dialect.prepare('SELECT 1 FROM platform_sequences WHERE module_id = ?').get(moduleId);
    if (dependentEntity || dependentAction || dependentView || dependentSetting || dependentEvent || dependentSequence) {
      throw new ModuleRegistryError(`Cannot uninstall ${moduleId}: platform artifacts reference this module`, 'DEPENDENT_ARTIFACTS_EXIST', { moduleId });
    }
    this.dialect.prepare('DELETE FROM platform_modules WHERE id = ?').run(moduleId);
    this.dialect.prepare(`
      INSERT INTO platform_audit_log (id, actor_id, actor_type, action, resource, resource_id, occurred_at, source_channel, result)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      actor,
      'user',
      'module.uninstall',
      'platform_modules',
      moduleId,
      this.#now(),
      'registry',
      'success'
    );
    return { id: moduleId, uninstalled: true };
  }

  get(moduleId) {
    const row = this.dialect.prepare('SELECT * FROM platform_modules WHERE id = ?').get(moduleId);
    return row ? this.#rowToModule(row) : null;
  }

  list() {
    return this.dialect.prepare('SELECT * FROM platform_modules ORDER BY id').all().map((row) => this.#rowToModule(row));
  }

  resolveLoadOrder() {
    const registry = new Map();
    for (const mod of this.list()) registry.set(mod.id, mod);
    return resolveLoadOrder(registry);
  }
}
