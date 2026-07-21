// Business calendars and the SLA clock — Phase 02 packet 02.23.
//
// Source composition:
// - VNext migration 620 business clocks (project-owned, MERGE-CANONICAL).
// - Odoo working-calendar / resource.calendar semantics (clean-room): a calendar
//   is a set of weekday intervals plus holidays; business duration is measured
//   only inside those intervals.
// - ERPNext SLA examples (clean-room, supporting specification): pause/resume
//   reasons and breach detection.
//
// Invariant (§ 48): a clock SNAPSHOTS its calendar at start. Editing a calendar
// afterwards must not retroactively move a due date that a person already
// committed to.
//
// All arithmetic is done in the calendar's fixed weekly grid. The timezone is
// recorded and applied as a fixed offset so results are deterministic and do not
// depend on the host machine's locale.

'use strict';

import crypto from 'node:crypto';

const MINUTES_PER_DAY = 1440;

export class SlaError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SlaError';
    this.code = code;
    this.details = details;
  }
}

/** Fixed offsets for the timezones Octagon deploys into. No DST in Iraq. */
const TZ_OFFSET_MINUTES = { 'Asia/Baghdad': 180, UTC: 0, 'Asia/Riyadh': 180, 'Asia/Dubai': 240 };

export class BusinessCalendarService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.now = deps.now || (() => new Date());
  }

  #now() { return this.now().toISOString(); }

  create({ id, name, labelAr = null, timezone = 'Asia/Baghdad', tenantId = null, companyId = null, branchId = null, shifts = [], holidays = [] }) {
    if (!(timezone in TZ_OFFSET_MINUTES)) throw new SlaError(`unsupported timezone ${timezone}`, 'CALENDAR_TZ_UNSUPPORTED', { timezone });
    const calendarId = id || `cal_${crypto.randomUUID()}`;
    this.dialect.exec('BEGIN IMMEDIATE;');
    try {
      this.dialect.prepare(`
        INSERT INTO business_calendars (id, name, label_ar, timezone, tenant_id, company_id, branch_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, label_ar=excluded.label_ar, timezone=excluded.timezone
      `).run(calendarId, name, labelAr, timezone, tenantId, companyId, branchId, this.#now());
      this.dialect.prepare('DELETE FROM business_calendar_shifts WHERE calendar_id = ?').run(calendarId);
      const s = this.dialect.prepare('INSERT INTO business_calendar_shifts (id, calendar_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)');
      for (const shift of shifts) {
        if (shift.startMinute >= shift.endMinute) throw new SlaError('a shift must end after it starts', 'CALENDAR_SHIFT_INVALID', { shift });
        s.run(`shift_${crypto.randomUUID()}`, calendarId, shift.weekday, shift.startMinute, shift.endMinute);
      }
      const h = this.dialect.prepare('INSERT INTO business_calendar_holidays (id, calendar_id, date, label_ar) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
      for (const holiday of holidays) h.run(`hol_${crypto.randomUUID()}`, calendarId, holiday.date, holiday.labelAr || null);
      this.dialect.exec('COMMIT;');
    } catch (e) {
      this.dialect.exec('ROLLBACK;');
      throw e;
    }
    return this.get(calendarId);
  }

  get(calendarId) {
    const c = this.dialect.prepare('SELECT * FROM business_calendars WHERE id = ?').get(calendarId);
    if (!c) return null;
    return {
      id: c.id, name: c.name, labelAr: c.label_ar, timezone: c.timezone,
      tenantId: c.tenant_id, companyId: c.company_id, branchId: c.branch_id, status: c.status,
      shifts: this.dialect.prepare('SELECT weekday, start_minute, end_minute FROM business_calendar_shifts WHERE calendar_id = ? ORDER BY weekday, start_minute').all(calendarId)
        .map((s) => ({ weekday: s.weekday, startMinute: s.start_minute, endMinute: s.end_minute })),
      holidays: this.dialect.prepare('SELECT date, label_ar FROM business_calendar_holidays WHERE calendar_id = ? ORDER BY date').all(calendarId)
        .map((h) => ({ date: h.date, labelAr: h.label_ar })),
    };
  }

  addHoliday(calendarId, date, labelAr = null) {
    this.dialect.prepare('INSERT INTO business_calendar_holidays (id, calendar_id, date, label_ar) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .run(`hol_${crypto.randomUUID()}`, calendarId, date, labelAr);
    return this.get(calendarId);
  }

  /** Calendar applicable to a scope: branch beats company beats tenant beats global. */
  resolveFor({ tenantId = null, companyId = null, branchId = null } = {}) {
    const row = this.dialect.prepare(`
      SELECT id FROM business_calendars
      WHERE status = 'active'
        AND (branch_id IS NULL OR branch_id = ?)
        AND (company_id IS NULL OR company_id = ?)
        AND (tenant_id IS NULL OR tenant_id = ?)
      ORDER BY (branch_id IS NOT NULL) DESC, (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC
      LIMIT 1
    `).get(branchId, companyId, tenantId);
    return row ? this.get(row.id) : this.get('cal_default');
  }

  // --- business-time arithmetic ---------------------------------------------

  #local(date, calendar) {
    return new Date(date.getTime() + TZ_OFFSET_MINUTES[calendar.timezone] * 60000);
  }

  #fromLocal(localDate, calendar) {
    return new Date(localDate.getTime() - TZ_OFFSET_MINUTES[calendar.timezone] * 60000);
  }

  #isHoliday(calendar, localDate) {
    const iso = localDate.toISOString().slice(0, 10);
    return calendar.holidays.some((h) => h.date === iso);
  }

  #shiftsFor(calendar, localDate) {
    if (this.#isHoliday(calendar, localDate)) return [];
    return calendar.shifts.filter((s) => s.weekday === localDate.getUTCDay()).sort((a, b) => a.startMinute - b.startMinute);
  }

  isWorkingTime(calendar, date) {
    const local = this.#local(date, calendar);
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    return this.#shiftsFor(calendar, local).some((s) => minute >= s.startMinute && minute < s.endMinute);
  }

  /**
   * Add `minutes` of BUSINESS time to `from`. Non-working stretches are skipped.
   * Bounded to 400 calendar-day lookahead so a calendar with no shifts fails
   * loudly instead of spinning.
   */
  addBusinessMinutes(calendar, from, minutes) {
    if (!calendar.shifts.length) throw new SlaError('calendar has no working shifts', 'CALENDAR_NO_SHIFTS', { calendarId: calendar.id });
    let remaining = Math.max(0, Math.round(minutes));
    let local = this.#local(from, calendar);
    let guard = 0;
    while (remaining > 0) {
      if (guard++ > 400 * 24) throw new SlaError('cannot satisfy the duration inside this calendar', 'CALENDAR_UNREACHABLE', { calendarId: calendar.id });
      const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
      const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
      const shifts = this.#shiftsFor(calendar, local);
      let consumedToday = false;
      for (const shift of shifts) {
        if (minuteOfDay >= shift.endMinute) continue;
        const enterAt = Math.max(minuteOfDay, shift.startMinute);
        const available = shift.endMinute - enterAt;
        if (available <= 0) continue;
        if (remaining <= available) {
          local = new Date(dayStart.getTime() + (enterAt + remaining) * 60000);
          remaining = 0;
          consumedToday = true;
          break;
        }
        remaining -= available;
        local = new Date(dayStart.getTime() + shift.endMinute * 60000);
        consumedToday = true;
      }
      if (remaining > 0) {
        // move to the start of the next day and retry
        local = new Date(dayStart.getTime() + MINUTES_PER_DAY * 60000);
        if (!consumedToday) continue;
      }
    }
    return this.#fromLocal(local, calendar);
  }

  /** Business minutes strictly between two instants. */
  businessMinutesBetween(calendar, from, to) {
    if (to <= from) return 0;
    let total = 0;
    let cursorLocal = this.#local(from, calendar);
    const endLocal = this.#local(to, calendar);
    let guard = 0;
    while (cursorLocal < endLocal) {
      if (guard++ > 400 * 24) break;
      const dayStart = new Date(Date.UTC(cursorLocal.getUTCFullYear(), cursorLocal.getUTCMonth(), cursorLocal.getUTCDate()));
      const minuteOfDay = cursorLocal.getUTCHours() * 60 + cursorLocal.getUTCMinutes();
      for (const shift of this.#shiftsFor(calendar, cursorLocal)) {
        const segStart = Math.max(minuteOfDay, shift.startMinute);
        const segEndAbs = new Date(dayStart.getTime() + shift.endMinute * 60000);
        const segEnd = segEndAbs > endLocal
          ? (endLocal.getTime() - dayStart.getTime()) / 60000
          : shift.endMinute;
        if (segEnd > segStart) total += segEnd - segStart;
      }
      cursorLocal = new Date(dayStart.getTime() + MINUTES_PER_DAY * 60000);
    }
    return Math.max(0, Math.round(total));
  }

  dueDate(calendar, from, targetMinutes) {
    return this.addBusinessMinutes(calendar, from, targetMinutes);
  }
}

export class SlaClockService {
  constructor(dialect, deps = {}) {
    this.dialect = dialect;
    this.calendars = deps.calendars || new BusinessCalendarService(dialect, deps);
    this.now = deps.now || (() => new Date());
  }

  /**
   * Start a clock. The calendar is snapshotted so a later calendar edit cannot
   * move this clock's due date.
   */
  start({ subjectKind, subjectId, calendarId, targetMinutes }) {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) throw new SlaError('calendar not found', 'CALENDAR_NOT_FOUND', { calendarId });
    const startedAt = this.now();
    const dueAt = this.calendars.dueDate(calendar, startedAt, targetMinutes);
    const id = `sla_${crypto.randomUUID()}`;
    this.dialect.prepare(`
      INSERT INTO sla_clocks (id, subject_kind, subject_id, calendar_id, calendar_snapshot, target_minutes, started_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, subjectKind, subjectId, calendarId, JSON.stringify(calendar), targetMinutes, startedAt.toISOString(), dueAt.toISOString());
    return this.get(id);
  }

  get(id) {
    const r = this.dialect.prepare('SELECT * FROM sla_clocks WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r.id, subjectKind: r.subject_kind, subjectId: r.subject_id, calendarId: r.calendar_id,
      calendarSnapshot: JSON.parse(r.calendar_snapshot), targetMinutes: r.target_minutes,
      startedAt: r.started_at, dueAt: r.due_at, pausedAt: r.paused_at, pausedReason: r.paused_reason,
      pausedTotalMinutes: r.paused_total_minutes, stoppedAt: r.stopped_at, breached: r.breached === 1,
    };
  }

  pause(id, reason) {
    if (!reason) throw new SlaError('pausing an SLA requires a reason', 'SLA_PAUSE_REASON_REQUIRED');
    const clock = this.get(id);
    if (!clock) throw new SlaError('clock not found', 'SLA_NOT_FOUND', { id });
    if (clock.pausedAt) return clock;
    this.dialect.prepare('UPDATE sla_clocks SET paused_at = ?, paused_reason = ? WHERE id = ?').run(this.now().toISOString(), reason, id);
    return this.get(id);
  }

  /** Resuming pushes the due date out by the BUSINESS minutes spent paused. */
  resume(id) {
    const clock = this.get(id);
    if (!clock) throw new SlaError('clock not found', 'SLA_NOT_FOUND', { id });
    if (!clock.pausedAt) return clock;
    const pausedMinutes = this.calendars.businessMinutesBetween(clock.calendarSnapshot, new Date(clock.pausedAt), this.now());
    const newDue = this.calendars.addBusinessMinutes(clock.calendarSnapshot, new Date(clock.dueAt), pausedMinutes);
    this.dialect.prepare('UPDATE sla_clocks SET paused_at = NULL, paused_reason = NULL, paused_total_minutes = paused_total_minutes + ?, due_at = ? WHERE id = ?')
      .run(pausedMinutes, newDue.toISOString(), id);
    return this.get(id);
  }

  stop(id) {
    const clock = this.get(id);
    if (!clock) throw new SlaError('clock not found', 'SLA_NOT_FOUND', { id });
    const stoppedAt = this.now();
    const breached = stoppedAt > new Date(clock.dueAt) ? 1 : 0;
    this.dialect.prepare('UPDATE sla_clocks SET stopped_at = ?, breached = ? WHERE id = ?').run(stoppedAt.toISOString(), breached, id);
    return this.get(id);
  }

  /** Remaining business minutes; negative means overdue. Paused clocks do not tick. */
  remaining(id) {
    const clock = this.get(id);
    if (!clock) throw new SlaError('clock not found', 'SLA_NOT_FOUND', { id });
    const at = clock.pausedAt ? new Date(clock.pausedAt) : (clock.stoppedAt ? new Date(clock.stoppedAt) : this.now());
    const due = new Date(clock.dueAt);
    if (at >= due) return -this.calendars.businessMinutesBetween(clock.calendarSnapshot, due, at);
    return this.calendars.businessMinutesBetween(clock.calendarSnapshot, at, due);
  }

  /** Clocks past their due date and still running — the escalation feed. */
  overdue({ subjectKind = null } = {}) {
    const nowIso = this.now().toISOString();
    const rows = subjectKind
      ? this.dialect.prepare('SELECT id FROM sla_clocks WHERE stopped_at IS NULL AND paused_at IS NULL AND due_at <= ? AND subject_kind = ?').all(nowIso, subjectKind)
      : this.dialect.prepare('SELECT id FROM sla_clocks WHERE stopped_at IS NULL AND paused_at IS NULL AND due_at <= ?').all(nowIso);
    return rows.map((r) => this.get(r.id));
  }
}

export function createBusinessCalendarService(dialect, deps) { return new BusinessCalendarService(dialect, deps); }
export function createSlaClockService(dialect, deps) { return new SlaClockService(dialect, deps); }
export { TZ_OFFSET_MINUTES };
