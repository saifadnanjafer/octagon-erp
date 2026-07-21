// Health registry — Phase 01 foundation.
//
// Source composition:
// - VNext R8 supportability engine (project-owned) for status checks.
// - RuoYi monitoring (MIT reference) for health contributor vocabulary.

'use strict';

export class HealthRegistryError extends Error {
  constructor(message, code) { super(message); this.name = 'HealthRegistryError'; this.code = code; }
}

export class HealthRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new HealthRegistryError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
    this.contributors = new Map();
  }

  #now() { return new Date().toISOString(); }

  register(id, name, checkType, checkFn) {
    if (typeof checkFn !== 'function') throw new HealthRegistryError('checkFn must be a function', 'INVALID_CHECK');
    this.dialect.prepare(`
      INSERT INTO platform_health_contributors (id, name, check_type, enabled, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, check_type = excluded.check_type
    `).run(id, name, checkType, 1, this.#now());
    this.contributors.set(id, checkFn);
    return id;
  }

  check(id) {
    const row = this.dialect.prepare('SELECT id, name, enabled FROM platform_health_contributors WHERE id = ?').get(id);
    if (!row || row.enabled !== 1) return { status: 'disabled' };
    const fn = this.contributors.get(id);
    if (!fn) return { status: 'unknown' };
    try {
      return { status: 'ok', detail: fn() };
    } catch (error) {
      return { status: 'degraded', error: error.message || String(error) };
    }
  }

  checkAll() {
    const rows = this.dialect.prepare('SELECT id FROM platform_health_contributors WHERE enabled = 1 ORDER BY id').all();
    const result = { ok: true, checks: {} };
    for (const row of rows) {
      const c = this.check(row.id);
      result.checks[row.id] = c;
      if (c.status !== 'ok') result.ok = false;
    }
    return result;
  }

  status() {
    return this.checkAll();
  }
}

export function createHealthRegistry(dialect) { return new HealthRegistry(dialect); }
