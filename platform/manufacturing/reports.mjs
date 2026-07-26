// Manufacturing and quality reporting.
//
// Every figure below is derived at read time from canonical facts
// (`production_*`, `stock_*`, `finance_*`, `quality_*`). Nothing is cached and
// nothing is stored, so a report can never disagree with the ledger it is
// reporting on.

import { round2, round6 } from './shared.mjs';

export function productionPlan(db, { company_id, limit = 200 }) {
  return db.prepare(`
    SELECT o.id, o.reference, o.product_id, o.state, o.planned_quantity, o.completed_quantity,
           o.scheduled_start, o.scheduled_end, o.priority, o.project_id,
           (SELECT COUNT(*) FROM production_work_orders w WHERE w.order_id = o.id) AS work_order_count,
           (SELECT COALESCE(SUM(m.shortage_quantity), 0) FROM production_order_materials m WHERE m.order_id = o.id) AS shortage_quantity
    FROM production_orders o
    WHERE o.company_id = ? AND o.state NOT IN ('closed', 'cancelled')
    ORDER BY o.priority DESC, o.scheduled_start IS NULL, o.scheduled_start, o.created_at
    LIMIT ${Math.min(Number(limit) || 200, 1000)}
  `).all(company_id);
}

export function materialShortages(db, { company_id }) {
  return db.prepare(`
    SELECT m.product_id, o.id AS order_id, o.reference, m.required_quantity,
           m.issued_quantity, m.shortage_quantity, m.bom_path
    FROM production_order_materials m
    JOIN production_orders o ON o.id = m.order_id
    WHERE m.company_id = ? AND m.shortage_quantity > 0
      AND o.state IN ('released', 'in_progress', 'partially_completed')
    ORDER BY m.shortage_quantity DESC
  `).all(company_id);
}

export function orderStatusSummary(db, { company_id }) {
  const rows = db.prepare(`
    SELECT state, COUNT(*) AS orders, COALESCE(SUM(planned_quantity), 0) AS planned,
           COALESCE(SUM(completed_quantity), 0) AS completed
    FROM production_orders WHERE company_id = ? GROUP BY state
  `).all(company_id);
  return rows.map((row) => ({
    state: row.state,
    orders: Number(row.orders),
    planned_quantity: round6(row.planned),
    completed_quantity: round6(row.completed),
  }));
}

/**
 * Work-centre loading: planned minutes still to run versus minutes already
 * recorded, per work centre.
 */
export function workCenterLoading(db, { company_id }) {
  return db.prepare(`
    SELECT wc.id AS work_center_id, wc.code, wc.name,
           COALESCE(SUM(CASE WHEN wo.state NOT IN ('completed','cancelled')
                THEN op.planned_setup_minutes + op.planned_run_minutes ELSE 0 END), 0) AS open_planned_minutes,
           COALESCE((SELECT SUM(t.duration_minutes) FROM production_time_entries t
                     WHERE t.work_center_id = wc.id AND t.company_id = wc.company_id), 0) AS recorded_minutes,
           COALESCE((SELECT SUM(t.duration_minutes) FROM production_time_entries t
                     WHERE t.work_center_id = wc.id AND t.company_id = wc.company_id
                       AND t.entry_type = 'downtime'), 0) AS downtime_minutes,
           COALESCE((SELECT SUM(cal.end_minute - cal.start_minute) FROM work_center_calendars cal
                     WHERE cal.work_center_id = wc.id), 0) AS weekly_capacity_minutes
    FROM work_centers wc
    LEFT JOIN production_work_orders wo ON wo.work_center_id = wc.id
    LEFT JOIN production_order_operations op ON op.id = wo.order_operation_id
    WHERE wc.company_id = ? AND wc.is_active = 1
    GROUP BY wc.id
    ORDER BY wc.code
  `).all(company_id).map((row) => ({
    ...row,
    utilisation_percent: Number(row.weekly_capacity_minutes) > 0
      ? round2((Number(row.open_planned_minutes) / Number(row.weekly_capacity_minutes)) * 100)
      : null,
  }));
}

/**
 * Work in progress, per order and in total, from `production_cost_facts`.
 * `finance_wip_balance` reads the GL for the same period so the two can be
 * compared directly — that comparison is the reconciliation evidence.
 */
export function wipReport(db, { company_id }) {
  const orders = db.prepare(`
    SELECT o.id AS order_id, o.reference, o.state,
      COALESCE(SUM(CASE WHEN f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS debits,
      COALESCE(SUM(CASE WHEN f.direction = 'credit_wip' THEN f.amount ELSE 0 END), 0) AS credits
    FROM production_orders o
    LEFT JOIN production_cost_facts f ON f.order_id = o.id
    WHERE o.company_id = ?
    GROUP BY o.id
    HAVING debits > 0 OR credits > 0
    ORDER BY o.created_at
  `).all(company_id).map((row) => ({
    order_id: row.order_id,
    reference: row.reference,
    state: row.state,
    debits: round2(row.debits),
    credits: round2(row.credits),
    wip_balance: round2(Number(row.debits) - Number(row.credits)),
  }));

  const total = orders.reduce((sum, row) => round2(sum + row.wip_balance), 0);
  return { orders, total_wip_balance: total };
}

/**
 * GL side of the same number: the balance of the configured WIP account taken
 * from posted finance journal lines.
 */
export function financeWipBalance(db, { company_id }) {
  const mapping = db.prepare('SELECT wip_account_id FROM manufacturing_account_mappings WHERE company_id = ?').get(company_id);
  if (!mapping?.wip_account_id) return { account_id: null, balance: 0, posted: false };
  const row = db.prepare(`
    SELECT COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
    FROM finance_journal_lines l
    WHERE l.company_id = ? AND l.account_id = ?
  `).get(company_id, mapping.wip_account_id);
  return {
    account_id: mapping.wip_account_id,
    debit: round2(row.debit),
    credit: round2(row.credit),
    balance: round2(Number(row.debit) - Number(row.credit)),
    posted: true,
  };
}

export function costVarianceReport(db, { company_id }) {
  return db.prepare(`
    SELECT o.id AS order_id, o.reference, o.planned_quantity, o.completed_quantity,
      COALESCE(SUM(CASE WHEN f.cost_type = 'material' AND f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS material_cost,
      COALESCE(SUM(CASE WHEN f.cost_type IN ('labor','setup') AND f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS labor_cost,
      COALESCE(SUM(CASE WHEN f.cost_type = 'machine' AND f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS machine_cost,
      COALESCE(SUM(CASE WHEN f.cost_type = 'overhead' AND f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS overhead_cost,
      COALESCE(SUM(CASE WHEN f.cost_type = 'subcontract' AND f.direction = 'debit_wip' THEN f.amount ELSE 0 END), 0) AS subcontract_cost,
      COALESCE(SUM(CASE WHEN f.cost_type = 'scrap' THEN f.amount ELSE 0 END), 0) AS scrap_cost,
      COALESCE(SUM(CASE WHEN f.cost_type = 'finished_goods' THEN f.amount ELSE 0 END), 0) AS capitalised_value,
      COALESCE(SUM(CASE WHEN f.cost_type = 'variance' THEN f.amount ELSE 0 END), 0) AS variance_amount
    FROM production_orders o
    LEFT JOIN production_cost_facts f ON f.order_id = o.id
    WHERE o.company_id = ?
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `).all(company_id).map((row) => ({
    ...row,
    actual_unit_cost: Number(row.completed_quantity) > 0
      ? round6(Number(row.capitalised_value) / Number(row.completed_quantity))
      : null,
  }));
}

export function scrapAndReworkReport(db, { company_id }) {
  const scrap = db.prepare(`
    SELECT c.product_id, SUM(c.quantity) AS quantity, SUM(c.value) AS value
    FROM production_material_consumptions c
    WHERE c.company_id = ? AND c.movement_type = 'scrap'
    GROUP BY c.product_id ORDER BY value DESC
  `).all(company_id);
  const rework = db.prepare(`
    SELECT SUM(rework_quantity) AS rework_quantity, SUM(scrap_quantity) AS work_order_scrap_quantity
    FROM production_work_orders WHERE company_id = ?
  `).get(company_id);
  return {
    scrap_by_product: scrap.map((row) => ({ ...row, value: round2(row.value) })),
    rework_quantity: Number(rework?.rework_quantity || 0),
    work_order_scrap_quantity: Number(rework?.work_order_scrap_quantity || 0),
  };
}

/**
 * Throughput and cycle time from actual start/end timestamps. Orders that never
 * started are excluded rather than counted as instantaneous.
 */
export function throughputReport(db, { company_id }) {
  const rows = db.prepare(`
    SELECT id, reference, completed_quantity, actual_start, actual_end
    FROM production_orders
    WHERE company_id = ? AND state IN ('completed', 'closed')
      AND actual_start IS NOT NULL AND actual_end IS NOT NULL
  `).all(company_id);
  const cycles = rows.map((row) => {
    const start = Date.parse(row.actual_start);
    const end = Date.parse(row.actual_end);
    return {
      order_id: row.id,
      reference: row.reference,
      completed_quantity: Number(row.completed_quantity),
      cycle_time_hours: Number.isFinite(start) && Number.isFinite(end)
        ? round2((end - start) / 3_600_000)
        : null,
    };
  });
  const measured = cycles.filter((row) => row.cycle_time_hours !== null);
  return {
    completed_orders: rows.length,
    total_completed_quantity: round6(rows.reduce((sum, row) => sum + Number(row.completed_quantity), 0)),
    average_cycle_time_hours: measured.length
      ? round2(measured.reduce((sum, row) => sum + row.cycle_time_hours, 0) / measured.length)
      : null,
    cycles,
  };
}

export function downtimeReport(db, { company_id }) {
  return db.prepare(`
    SELECT t.work_center_id, wc.code, wc.name, SUM(t.duration_minutes) AS downtime_minutes,
           COUNT(*) AS events
    FROM production_time_entries t
    LEFT JOIN work_centers wc ON wc.id = t.work_center_id
    WHERE t.company_id = ? AND t.entry_type = 'downtime'
    GROUP BY t.work_center_id
    ORDER BY downtime_minutes DESC
  `).all(company_id);
}

// --------------------------------------------------------------------------
// Quality reporting
// --------------------------------------------------------------------------

export function inspectionPassRate(db, { company_id }) {
  const rows = db.prepare(`
    SELECT state, COUNT(*) AS n FROM quality_inspections WHERE company_id = ? GROUP BY state
  `).all(company_id);
  const counts = Object.fromEntries(rows.map((row) => [row.state, Number(row.n)]));
  const decided = (counts.passed || 0) + (counts.failed || 0) + (counts.conditionally_passed || 0);
  return {
    counts,
    decided,
    pass_rate_percent: decided > 0
      ? round2((((counts.passed || 0) + (counts.conditionally_passed || 0)) / decided) * 100)
      : null,
  };
}

export function defectTrends(db, { company_id }) {
  return db.prepare(`
    SELECT COALESCE(defect_code, 'unclassified') AS defect_code, severity,
           COUNT(*) AS occurrences, SUBSTR(opened_at, 1, 7) AS period
    FROM quality_nonconformances WHERE company_id = ?
    GROUP BY defect_code, severity, period
    ORDER BY period DESC, occurrences DESC
  `).all(company_id);
}

export function supplierDefects(db, { company_id }) {
  return db.prepare(`
    SELECT n.supplier_party_id, p.name AS supplier_name, COUNT(*) AS nonconformances,
           SUM(CASE WHEN n.severity IN ('high','critical') THEN 1 ELSE 0 END) AS severe
    FROM quality_nonconformances n
    LEFT JOIN parties p ON p.id = n.supplier_party_id
    WHERE n.company_id = ? AND n.supplier_party_id IS NOT NULL
    GROUP BY n.supplier_party_id ORDER BY nonconformances DESC
  `).all(company_id);
}

export function nonconformanceAging(db, { company_id, as_of = null }) {
  const asOf = as_of ? Date.parse(as_of) : Date.now();
  return db.prepare(`
    SELECT id, reference, title, severity, state, opened_at, resolved_at
    FROM quality_nonconformances WHERE company_id = ? AND state NOT IN ('closed')
    ORDER BY opened_at
  `).all(company_id).map((row) => {
    const opened = Date.parse(row.opened_at);
    const ageDays = Number.isFinite(opened) ? Math.floor((asOf - opened) / 86_400_000) : null;
    return {
      ...row,
      age_days: ageDays,
      bucket: ageDays === null ? 'unknown'
        : ageDays <= 7 ? '0-7'
          : ageDays <= 30 ? '8-30'
            : ageDays <= 90 ? '31-90' : '90+',
    };
  });
}

export function capaStatus(db, { company_id }) {
  return db.prepare(`
    SELECT state, COUNT(*) AS n,
           SUM(CASE WHEN corrective_action IS NOT NULL THEN 1 ELSE 0 END) AS with_corrective_action,
           SUM(CASE WHEN preventive_action IS NOT NULL THEN 1 ELSE 0 END) AS with_preventive_action
    FROM quality_nonconformances WHERE company_id = ? GROUP BY state
  `).all(company_id);
}
