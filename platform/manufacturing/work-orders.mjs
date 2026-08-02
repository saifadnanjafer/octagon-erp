// platform/manufacturing/work-orders.mjs — Work Orders & Shop Floor Domain Engine.

'use strict';

import crypto from 'node:crypto';
import { ManufacturingError } from './manufacturing-orders.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function startWorkOrder(db, input) {
  const { work_order_id } = input;
  const dialect = db;
  const wo = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(work_order_id);
  if (!wo) throw new ManufacturingError(`work order ${work_order_id} not found`, 'WORK_ORDER_NOT_FOUND');

  const now = nowISO();
  const operator = input.actor || input.created_by || 'usr_operator';
  dialect.prepare(`
    UPDATE mfg_work_orders
    SET state = 'in_progress', actual_start_date = COALESCE(actual_start_date, ?), operator_id = ?, updated_at = ?
    WHERE id = ?
  `).run(now, operator, now, work_order_id);

  // Update parent production order to in_progress if not already
  dialect.prepare("UPDATE mfg_production_orders SET state = 'in_progress', actual_start_date = COALESCE(actual_start_date, ?), updated_at = ? WHERE id = ? AND state IN ('released','materials_reserved')").run(now, now, wo.production_order_id);

  return { id: work_order_id, state: 'in_progress' };
}

export function pauseWorkOrder(db, input) {
  const { work_order_id } = input;
  const dialect = db;
  const wo = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(work_order_id);
  if (!wo) throw new ManufacturingError(`work order ${work_order_id} not found`, 'WORK_ORDER_NOT_FOUND');

  dialect.prepare("UPDATE mfg_work_orders SET state = 'paused', updated_at = ? WHERE id = ?").run(nowISO(), work_order_id);
  return { id: work_order_id, state: 'paused' };
}

export function resumeWorkOrder(db, input) {
  const { work_order_id } = input;
  const dialect = db;
  const wo = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(work_order_id);
  if (!wo) throw new ManufacturingError(`work order ${work_order_id} not found`, 'WORK_ORDER_NOT_FOUND');

  dialect.prepare("UPDATE mfg_work_orders SET state = 'in_progress', updated_at = ? WHERE id = ?").run(nowISO(), work_order_id);
  return { id: work_order_id, state: 'in_progress' };
}

export function completeWorkOrder(db, input) {
  const { work_order_id, completed_quantity, rejected_quantity } = input;
  const dialect = db;
  const wo = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(work_order_id);
  if (!wo) throw new ManufacturingError(`work order ${work_order_id} not found`, 'WORK_ORDER_NOT_FOUND');

  const compQty = completed_quantity !== undefined ? Number(completed_quantity) : wo.quantity_to_produce;
  const rejQty = rejected_quantity !== undefined ? Number(rejected_quantity) : 0.0;
  const now = nowISO();

  dialect.prepare(`
    UPDATE mfg_work_orders
    SET state = 'completed', quantity_completed = ?, quantity_rejected = ?, actual_end_date = ?, updated_at = ?
    WHERE id = ?
  `).run(compQty, rejQty, now, now, work_order_id);

  return { id: work_order_id, state: 'completed', quantity_completed: compQty, quantity_rejected: rejQty };
}

export function recordLabor(db, input) {
  const { work_order_id, setup_minutes, run_minutes, operator_id } = input;
  const dialect = db;
  const wo = dialect.prepare('SELECT * FROM mfg_work_orders WHERE id = ?').get(work_order_id);
  if (!wo) throw new ManufacturingError(`work order ${work_order_id} not found`, 'WORK_ORDER_NOT_FOUND');

  const wc = dialect.prepare('SELECT * FROM work_centers WHERE id = ?').get(wo.work_center_id);
  const laborRate = wc?.labor_cost_per_hour || 0.0;
  const machineRate = wc?.machine_cost_per_hour || 0.0;
  const overheadRate = wc?.overhead_cost_per_hour || 0.0;

  const sMin = setup_minutes ? Number(setup_minutes) : 0.0;
  const rMin = run_minutes ? Number(run_minutes) : 0.0;
  const totalHours = (sMin + rMin) / 60.0;
  const totalCost = totalHours * (laborRate + machineRate + overheadRate);
  const now = nowISO();

  const id = `lbr_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO mfg_labor_entries (
      id, company_id, work_order_id, production_order_id, work_center_id, resource_id, operator_id,
      setup_minutes, run_minutes, labor_rate, machine_rate, overhead_rate, total_cost, entry_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, wo.company_id, work_order_id, wo.production_order_id, wo.work_center_id, wo.resource_id,
    operator_id || wo.operator_id || null, sMin, rMin, laborRate, machineRate, overheadRate, totalCost, now, now
  );

  // Update cost summary
  dialect.prepare(`
    UPDATE mfg_production_cost_summaries
    SET direct_labor_cost = direct_labor_cost + ?,
        machine_overhead_cost = machine_overhead_cost + ?,
        total_wip_cost = total_wip_cost + ?,
        updated_at = ?
    WHERE production_order_id = ?
  `).run(totalHours * laborRate, totalHours * (machineRate + overheadRate), totalCost, now, wo.production_order_id);

  // Accumulate setup & run minutes on work order
  dialect.prepare(`
    UPDATE mfg_work_orders
    SET actual_setup_minutes = actual_setup_minutes + ?, actual_run_minutes = actual_run_minutes + ?, updated_at = ?
    WHERE id = ?
  `).run(sMin, rMin, now, work_order_id);

  return { id, total_cost: totalCost };
}
