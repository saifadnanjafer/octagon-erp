// Maintenance reporting: due work, cost, downtime, MTBF/MTTR and spare usage.
// Every figure is derived from maintenance orders, plans and meter readings.

import { round2 } from '../kernel/domain/kit.mjs';

export function maintenanceDue(db, { company_id, within_days = 30 }) {
  const horizon = new Date(Date.now() + Number(within_days) * 86_400_000).toISOString().slice(0, 10);
  const plans = db.prepare(`
    SELECT p.*, a.asset_tag, a.name AS asset_name
    FROM maintenance_plans p LEFT JOIN assets a ON a.id = p.asset_id
    WHERE p.company_id = ? AND p.is_active = 1
      AND ((p.next_due_date IS NOT NULL AND p.next_due_date <= ?) OR p.trigger_type IN ('meter','both'))
    ORDER BY p.next_due_date IS NULL, p.next_due_date
  `).all(company_id, horizon);
  const openOrders = db.prepare(`
    SELECT id, reference, title, state, scheduled_start, asset_id, vehicle_id, priority
    FROM maintenance_orders
    WHERE company_id = ? AND state NOT IN ('closed', 'cancelled')
    ORDER BY scheduled_start IS NULL, scheduled_start
  `).all(company_id);
  return { due_plans: plans, open_orders: openOrders };
}

export function maintenanceCost(db, { company_id, from_date = null, to_date = null }) {
  let sql = `
    SELECT o.id, o.reference, o.asset_id, o.vehicle_id, o.maintenance_type,
           o.parts_cost, o.labor_cost, o.external_cost, o.created_at, o.actual_end
    FROM maintenance_orders o WHERE o.company_id = ?
  `;
  const params = [company_id];
  if (from_date) { sql += ' AND o.created_at >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND o.created_at <= ?'; params.push(to_date); }
  const rows = db.prepare(sql).all(...params).map((row) => ({
    ...row,
    total_cost: round2(Number(row.parts_cost) + Number(row.labor_cost) + Number(row.external_cost)),
  }));
  return {
    orders: rows,
    parts_cost: round2(rows.reduce((sum, row) => sum + Number(row.parts_cost), 0)),
    labor_cost: round2(rows.reduce((sum, row) => sum + Number(row.labor_cost), 0)),
    external_cost: round2(rows.reduce((sum, row) => sum + Number(row.external_cost), 0)),
    total_cost: round2(rows.reduce((sum, row) => sum + row.total_cost, 0)),
  };
}

export function downtimeReport(db, { company_id }) {
  return db.prepare(`
    SELECT COALESCE(o.asset_id, o.vehicle_id, 'unassigned') AS subject_id,
           a.asset_tag, COUNT(*) AS orders,
           COALESCE(SUM(o.downtime_minutes), 0) AS downtime_minutes
    FROM maintenance_orders o
    LEFT JOIN assets a ON a.id = o.asset_id
    WHERE o.company_id = ? AND o.state IN ('completed', 'closed')
    GROUP BY subject_id ORDER BY downtime_minutes DESC
  `).all(company_id);
}

/**
 * MTBF / MTTR foundation.
 *
 * MTTR is measured directly from actual_start → actual_end on corrective orders.
 * MTBF needs at least two failures to have an interval between them; assets with
 * fewer are reported with `mtbf_hours: null` rather than a fabricated figure.
 */
export function reliabilityReport(db, { company_id }) {
  const assets = db.prepare(`
    SELECT DISTINCT a.id, a.asset_tag, a.name FROM assets a
    JOIN maintenance_orders o ON o.asset_id = a.id
    WHERE a.company_id = ?
  `).all(company_id);

  return assets.map((asset) => {
    const corrective = db.prepare(`
      SELECT actual_start, actual_end, downtime_minutes FROM maintenance_orders
      WHERE company_id = ? AND asset_id = ? AND maintenance_type IN ('corrective', 'emergency')
        AND state IN ('completed', 'closed') AND actual_start IS NOT NULL
      ORDER BY actual_start
    `).all(company_id, asset.id);

    const repairs = corrective
      .map((row) => {
        const start = Date.parse(row.actual_start);
        const end = row.actual_end ? Date.parse(row.actual_end) : null;
        return end && Number.isFinite(start) ? (end - start) / 3_600_000 : null;
      })
      .filter((value) => value !== null);

    let mtbfHours = null;
    if (corrective.length >= 2) {
      const first = Date.parse(corrective[0].actual_start);
      const last = Date.parse(corrective[corrective.length - 1].actual_start);
      const intervals = corrective.length - 1;
      if (Number.isFinite(first) && Number.isFinite(last) && intervals > 0) {
        mtbfHours = round2(((last - first) / 3_600_000) / intervals);
      }
    }

    return {
      asset_id: asset.id,
      asset_tag: asset.asset_tag,
      failures: corrective.length,
      mttr_hours: repairs.length ? round2(repairs.reduce((sum, value) => sum + value, 0) / repairs.length) : null,
      mtbf_hours: mtbfHours,
      mtbf_basis: corrective.length >= 2 ? 'measured' : 'insufficient failure history',
      total_downtime_minutes: round2(corrective.reduce((sum, row) => sum + Number(row.downtime_minutes || 0), 0)),
    };
  });
}

export function sparePartsUsage(db, { company_id }) {
  return db.prepare(`
    SELECT p.product_id, COUNT(*) AS issues, SUM(p.quantity) AS quantity, SUM(p.value) AS value
    FROM maintenance_parts p WHERE p.company_id = ?
    GROUP BY p.product_id ORDER BY value DESC
  `).all(company_id).map((row) => ({ ...row, value: round2(row.value) }));
}
