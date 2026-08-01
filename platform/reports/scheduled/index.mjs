// Governed scheduled-report definitions. A schedule is data, while the durable
// job queue performs delivery; no scheduler tick mutates business documents.
'use strict';

import crypto from 'node:crypto';

export class ScheduledReportError extends Error {
  constructor(message, code) { super(message); this.name = 'ScheduledReportError'; this.code = code; }
}

const cronLike = (value) => String(value || '').trim().split(/\s+/).length === 5;

export class ScheduledReportService {
  constructor(dialect, { jobs, notifications, now = () => new Date() } = {}) {
    this.dialect = dialect; this.jobs = jobs; this.notifications = notifications; this.now = now;
  }
  #now() { return this.now().toISOString(); }
  #row(row) { return row && ({ id: row.id, companyId: row.company_id, ownerId: row.owner_id, name: row.name, reportKey: row.report_key, schedule: row.schedule, audience: JSON.parse(row.audience || '[]'), format: row.format, active: row.active === 1, lastDeliveredAt: row.last_delivered_at, createdAt: row.created_at, updatedAt: row.updated_at }); }
  list({ companyId, userId }) {
    return this.dialect.prepare('SELECT * FROM report_schedules WHERE company_id = ? AND (owner_id = ? OR owner_id IS NULL) ORDER BY created_at DESC').all(companyId, userId).map((row) => this.#row(row));
  }
  create(input, ctx) {
    const name = String(input.name || '').trim(); const reportKey = String(input.report_key || '').trim(); const schedule = String(input.schedule || '').trim();
    if (!name || !reportKey || !cronLike(schedule)) throw new ScheduledReportError('name, report_key, and a five-part schedule are required', 'SCHEDULE_INVALID');
    const id = `rptsch_${crypto.randomUUID()}`; const now = this.#now(); const audience = Array.isArray(input.audience) && input.audience.length ? input.audience.map(String).slice(0, 50) : [ctx.userId];
    this.dialect.prepare('INSERT INTO report_schedules (id, company_id, owner_id, name, report_key, schedule, audience, format, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run(id, ctx.companyId, ctx.userId, name, reportKey, schedule, JSON.stringify(audience), input.format === 'xlsx' ? 'xlsx' : 'pdf', now, now);
    this.dialect.prepare("INSERT INTO platform_jobs (id,module_id,name,schedule,handler,enabled,created_at,updated_at) VALUES (?, 'platform_kernel', ?, ?, 'scheduled_report:deliver', 1, ?, ?)").run(`scheduled_report_${id}`, name, schedule, now, now);
    return this.get(id);
  }
  get(id) { return this.#row(this.dialect.prepare('SELECT * FROM report_schedules WHERE id = ?').get(id)); }
  pause(id, ctx) {
    const result = this.dialect.prepare('UPDATE report_schedules SET active = 0, updated_at = ? WHERE id = ? AND company_id = ? AND owner_id = ?').run(this.#now(), id, ctx.companyId, ctx.userId);
    if (!result.changes) throw new ScheduledReportError('schedule not found', 'SCHEDULE_NOT_FOUND');
    this.dialect.prepare('UPDATE platform_jobs SET enabled = 0, updated_at = ? WHERE id = ?').run(this.#now(), `scheduled_report_${id}`);
    return this.get(id);
  }
  deliver(job) {
    const scheduleId = String(job.jobId || '').replace(/^scheduled_report_/, ''); const schedule = this.get(scheduleId);
    if (!schedule || !schedule.active) return { skipped: true, reason: 'SCHEDULE_INACTIVE' };
    const key = `scheduled-report:${schedule.id}:${String(job.createdAt).slice(0, 16)}`;
    const recipients = schedule.audience.length ? schedule.audience : [schedule.ownerId];
    const deliveries = recipients.map((recipientId) => this.notifications.notify({ recipientId, companyId: schedule.companyId, eventKey: 'report.scheduled.ready', subject: schedule.name, body: `Scheduled ${schedule.format.toUpperCase()} report is ready: ${schedule.reportKey}`, payload: { reportKey: schedule.reportKey }, dedupeKey: `${key}:${recipientId}` }));
    this.dialect.prepare('UPDATE report_schedules SET last_delivered_at = ?, updated_at = ? WHERE id = ?').run(this.#now(), this.#now(), schedule.id);
    return { scheduleId: schedule.id, staged: true, deliveries };
  }
}

export function createScheduledReportService(dialect, deps) { return new ScheduledReportService(dialect, deps); }
