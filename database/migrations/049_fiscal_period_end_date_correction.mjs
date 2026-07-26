// 049_fiscal_period_end_date_correction — corrective forward migration
//
// Defect found while building the Phase 05 depreciation schedule.
//
// `014_finance_canonical_schema_and_coa` and `seedChartOfAccounts` both built a
// period's end date with `new Date(2026, m, 0).toISOString().split('T')[0]`.
// That constructor produces LOCAL midnight; `.toISOString()` then converts to
// UTC, which moves the date back one day in every timezone east of UTC. On this
// deployment (UTC+3) every seeded period ended a day early:
//
//     2026-01 → 2026-01-30   (should be 2026-01-31)
//     2026-02 → 2026-02-27   (should be 2026-02-28)
//
// Consequence: `checkPeriodAndLock` rejects any document dated on the last day
// of a month with `no fiscal period exists for the document date`. Month-end
// invoices, month-end depreciation and month-end payroll journals could not post
// at all — a silent, calendar-shaped hole in the ledger.
//
// This migration does NOT edit migration 014 (which may already be applied to
// non-disposable databases). It corrects the data forward, and the code path was
// fixed in `platform/finance/engine.mjs` in the same change.
//
// Scope and safety:
//   - Only the `end_date` column is touched, and only where it is earlier than
//     the true last day of that period's month.
//   - `status` is never changed: a closed period stays closed, a locked period
//     stays locked. Only the boundary is corrected.
//   - Periods that already end on the correct day are left alone, so a rerun is
//     a no-op.
//   - `down()` is intentionally a no-op: restoring a wrong date is not a
//     meaningful rollback, and doing so would re-open the hole. This is recorded
//     as `rollbackPolicy: 'irreversible_data_correction'`.

const MODULE_ID = 'finance_canonical';

function lastDayOfMonth(startDate) {
  const match = /^(\d{4})-(\d{2})/.exec(String(startDate || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export const migration = {
  id: '049_fiscal_period_end_date_correction',
  owner: MODULE_ID,
  version: '1.24.4',
  parent: '048_assets_maintenance_and_fleet',
  dependsOn: ['048_assets_maintenance_and_fleet'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'irreversible_data_correction',
  sourceProvenance: 'Corrective forward migration for a local-time/UTC defect in migration 014 and seedChartOfAccounts; found by the Phase 05 depreciation schedule, which posts on month-end dates',

  up(db) {
    const periods = db.prepare(
      'SELECT id, company_id, name, start_date, end_date, status FROM finance_periods',
    ).all();

    const update = db.prepare('UPDATE finance_periods SET end_date = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    const corrected = [];

    for (const period of periods) {
      const correctEnd = lastDayOfMonth(period.start_date);
      if (!correctEnd) continue;
      // A period that legitimately covers a partial month (a stub period at the
      // start or end of a fiscal year) must not be stretched. Only the exact
      // one-day-short shape this defect produces is corrected.
      const expectedShort = new Date(Date.UTC(
        Number(correctEnd.slice(0, 4)),
        Number(correctEnd.slice(5, 7)) - 1,
        Number(correctEnd.slice(8, 10)) - 1,
      )).toISOString().slice(0, 10);
      if (period.end_date !== expectedShort) continue;

      update.run(correctEnd, now, period.id);
      corrected.push({ id: period.id, from: period.end_date, to: correctEnd });
    }

    // Leave a durable record of what was repaired, so the correction is
    // auditable rather than an invisible data edit.
    db.exec(`
      CREATE TABLE IF NOT EXISTS finance_period_corrections (
        id TEXT PRIMARY KEY,
        period_id TEXT NOT NULL,
        previous_end_date TEXT NOT NULL,
        corrected_end_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        corrected_at TEXT NOT NULL
      ) STRICT;
    `);
    const record = db.prepare(`
      INSERT INTO finance_period_corrections (
        id, period_id, previous_end_date, corrected_end_date, reason, corrected_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    for (const row of corrected) {
      record.run(
        `fpc_${row.id}`, row.id, row.from, row.to,
        'migration 049: local-time to UTC month-end off-by-one from migration 014',
        now,
      );
    }
  },

  down() {
    // Intentionally a no-op. See the header: reintroducing the wrong end date
    // would restore a defect that silently blocks month-end postings, and the
    // repair is recorded in `finance_period_corrections` for audit.
  },
};
