// Job and scheduler registry — Phase 01 foundation.
//
// Source composition:
// - VNext r3-infra.js (project-owned) for lease/idempotency/retry patterns.
// - Odoo ir_cron.py (clean-room reference) for cron-like job registration.
// - Frappe scheduler (MIT reference) for background job contracts.

'use strict';

export class JobRegistryError extends Error {
  constructor(message, code) { super(message); this.name = 'JobRegistryError'; this.code = code; }
}

export class JobRegistry {
  constructor(dialect) {
    if (!dialect || typeof dialect.prepare !== 'function') throw new JobRegistryError('dialect required', 'DIALECT_REQUIRED');
    this.dialect = dialect;
  }

  #now() { return new Date().toISOString(); }

  register(job, actor = 'system') {
    if (!job.id || !job.module_id || !job.handler) throw new JobRegistryError('id, module_id, and handler are required', 'JOB_INVALID');
    this.dialect.prepare(`
      INSERT INTO platform_jobs (id, module_id, name, schedule, handler, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        name = excluded.name,
        schedule = excluded.schedule,
        handler = excluded.handler,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(job.id, job.module_id, job.name || job.id, job.schedule || null, job.handler, job.enabled !== false ? 1 : 0, this.#now(), this.#now());
    return job.id;
  }

  list() {
    return this.dialect.prepare('SELECT id, module_id, name, schedule, handler, enabled FROM platform_jobs ORDER BY id').all().map((r) => ({ ...r, enabled: r.enabled === 1 }));
  }

  listEnabled() {
    return this.list().filter((j) => j.enabled);
  }

  disable(jobId, actor = 'system') {
    this.dialect.prepare('UPDATE platform_jobs SET enabled = 0, updated_at = ? WHERE id = ?').run(this.#now(), jobId);
  }
}

export function createJobRegistry(dialect) { return new JobRegistry(dialect); }
