// platform/maintenance/maintenance-orders.mjs — Maintenance Requests, Work Orders & Spare Parts Engine.

'use strict';

import crypto from 'node:crypto';

export class MaintenanceError extends Error {
  constructor(message, code = 'MAINTENANCE_ERROR', statusCode = 422) {
    super(message);
    this.name = 'MaintenanceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function createMaintenanceRequest(db, input) {
  const { asset_id, title, request_type, priority, description, failure_code, symptom } = input;
  if (!asset_id || !title) throw new MaintenanceError('asset_id and title are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const companyId = input.company_id || 'default';
  const id = `mreq_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM maintenance_requests WHERE company_id = ?').get(companyId);
  const reqNumber = `MR-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();
  const actor = input.actor || input.reported_by || 'usr_tech';

  dialect.prepare(`
    INSERT INTO maintenance_requests (
      id, company_id, request_number, asset_id, request_type, priority, title, description,
      failure_code, symptom, reported_by, reported_at, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)
  `).run(
    id, companyId, reqNumber, asset_id, request_type || 'corrective', priority || 'medium',
    title, description || '', failure_code || '', symptom || '', actor, now, now, now
  );

  return { id, request_number: reqNumber, state: 'submitted' };
}

export function approveMaintenanceRequest(db, input) {
  const { request_id } = input;
  const dialect = db;
  const req = dialect.prepare('SELECT * FROM maintenance_requests WHERE id = ?').get(request_id);
  if (!req) throw new MaintenanceError(`request ${request_id} not found`, 'REQUEST_NOT_FOUND');

  dialect.prepare("UPDATE maintenance_requests SET state = 'approved', updated_at = ? WHERE id = ?").run(nowISO(), request_id);
  return { id: request_id, state: 'approved' };
}

export function createMaintenanceOrder(db, input) {
  const { asset_id, title, request_id, preventive_plan_id, order_type, priority, scheduled_start, scheduled_end } = input;
  if (!asset_id || !title) throw new MaintenanceError('asset_id and title are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const companyId = input.company_id || 'default';
  const id = `mord_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM maintenance_orders WHERE company_id = ?').get(companyId);
  const ordNumber = `MO-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();
  const actor = input.actor || input.created_by || 'usr_tech';

  // Create canonical Work Item for tracking maintenance order execution
  const workItemId = `wi_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO work_items (
      id, company_id, source_type, title, status, priority, created_at, updated_at
    ) VALUES (?, ?, 'maintenance_order', ?, 'todo', ?, ?, ?)
  `).run(workItemId, companyId, `[Maint] ${title}`, priority || 'medium', now, now);

  dialect.prepare(`
    INSERT INTO maintenance_orders (
      id, company_id, order_number, request_id, preventive_plan_id, asset_id, work_item_id,
      order_type, priority, title, state, scheduled_start, scheduled_end, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run(
    id, companyId, ordNumber, request_id || null, preventive_plan_id || null, asset_id,
    workItemId, order_type || 'corrective', priority || 'medium', title, scheduled_start || null, scheduled_end || null, now, now
  );

  if (request_id) {
    dialect.prepare("UPDATE maintenance_requests SET state = 'work_order_created', updated_at = ? WHERE id = ?").run(now, request_id);
  }

  return { id, order_number: ordNumber, work_item_id: workItemId, state: 'draft' };
}

export function reserveSpareParts(db, input) {
  const { maintenance_order_id, order_id, product_id, quantity, issued_qty, unit_cost } = input;
  const moId = maintenance_order_id || order_id;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(moId);
  if (!order) throw new MaintenanceError(`maintenance order ${moId} not found`, 'MAINTENANCE_ORDER_NOT_FOUND');

  const qty = Number(issued_qty || quantity || 1.0);
  const cost = Number(unit_cost || 0.0);
  const totalCost = qty * cost;
  const now = nowISO();
  const id = `mpart_${crypto.randomUUID()}`;

  dialect.prepare(`
    INSERT INTO maintenance_spare_parts (
      id, company_id, maintenance_order_id, product_id, required_quantity, issued_quantity, unit_cost, total_cost, state, created_at
    ) VALUES (?, ?, ?, ?, ?, 0.0, ?, ?, 'reserved', ?)
  `).run(id, order.company_id, moId, product_id, qty, cost, totalCost, now);

  dialect.prepare(`
    UPDATE maintenance_orders
    SET state = 'parts_reserved', total_parts_cost = total_parts_cost + ?, total_cost = total_cost + ?, updated_at = ?
    WHERE id = ?
  `).run(totalCost, totalCost, now, moId);

  return { id, state: 'reserved', issued_qty: qty, total_cost: totalCost };
}

export function issueSpareParts(db, input) {
  const { maintenance_order_id, order_id, part_id, product_id, issued_qty, quantity, unit_cost, src_location_id } = input;
  const moId = maintenance_order_id || order_id;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(moId);
  if (!order) throw new MaintenanceError(`maintenance order ${moId} not found`, 'MAINTENANCE_ORDER_NOT_FOUND');

  const qty = Number(issued_qty || quantity || 1.0);
  const cost = Number(unit_cost || 0.0);
  const totalCost = qty * cost;
  const now = nowISO();

  const id = part_id || `mpart_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO maintenance_spare_parts (
      id, company_id, maintenance_order_id, product_id, required_quantity, issued_quantity, unit_cost, total_cost, state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)
    ON CONFLICT(id) DO UPDATE SET issued_quantity = excluded.issued_quantity, state = 'issued'
  `).run(id, order.company_id, moId, product_id || 'prod_part', qty, qty, cost, totalCost, now);

  dialect.prepare(`
    UPDATE maintenance_orders
    SET state = 'in_progress', total_parts_cost = total_parts_cost + ?, total_cost = total_cost + ?, actual_start = COALESCE(actual_start, ?), updated_at = ?
    WHERE id = ?
  `).run(totalCost, totalCost, now, now, moId);

  return { id, state: 'issued', issued_qty: qty, total_cost: totalCost };
}

export function completeMaintenanceOrder(db, input) {
  const { order_id, downtime_hours, labor_cost, root_cause, action_taken, completion_notes } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(order_id);
  if (!order) throw new MaintenanceError(`maintenance order ${order_id} not found`, 'MAINTENANCE_ORDER_NOT_FOUND');

  const dt = downtime_hours ? Number(downtime_hours) : 0.0;
  const lCost = labor_cost ? Number(labor_cost) : 0.0;
  const now = nowISO();

  dialect.prepare(`
    UPDATE maintenance_orders
    SET state = 'completed', downtime_hours = ?, total_labor_cost = ?, total_cost = total_parts_cost + ?, root_cause = COALESCE(?, root_cause), action_taken = COALESCE(?, action_taken), actual_end = ?, completed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(dt, lCost, lCost, root_cause || completion_notes || null, action_taken || completion_notes || null, now, now, now, order_id);

  if (order.work_item_id) {
    dialect.prepare("UPDATE work_items SET status = 'completed', updated_at = ? WHERE id = ?").run(now, order.work_item_id);
  }

  const updated = dialect.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(order_id);
  return { id: order_id, state: 'completed', downtime_hours: dt, parts_cost: updated.total_parts_cost, total_cost: updated.total_cost };
}
