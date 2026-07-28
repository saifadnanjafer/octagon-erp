// platform/manufacturing/manufacturing-orders.mjs — Manufacturing Orders Domain Engine.

'use strict';

import crypto from 'node:crypto';

export class ManufacturingError extends Error {
  constructor(message, code = 'MANUFACTURING_ERROR', statusCode = 422) {
    super(message);
    this.name = 'ManufacturingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function createProductionOrder(db, input) {
  const { product_id, planned_quantity, bom_version_id, routing_version_id, warehouse_id, wip_location_id, finished_location_id, project_id, work_item_id, priority, notes } = input;
  const plannedQty = Number(planned_quantity || input.planned_qty || 0);
  if (!product_id || plannedQty <= 0) {
    throw new ManufacturingError('product_id and positive planned_quantity are required', 'INPUT_MISSING_FIELD');
  }

  const companyId = input.company_id || 'default';
  const dialect = db;

  // Validate product
  const product = dialect.prepare('SELECT id FROM product_variants WHERE id = ?').get(product_id);
  if (!product) throw new ManufacturingError(`product_variant ${product_id} not found`, 'PRODUCT_NOT_FOUND');

  // Verify BOM version if supplied, else find active approved BOM
  let bomVerId = bom_version_id;
  if (!bomVerId) {
    const bomRow = dialect.prepare(`
      SELECT bv.id FROM bom_versions bv
      JOIN boms b ON b.id = bv.bom_id
      WHERE b.product_id = ? AND bv.state = 'approved'
      ORDER BY bv.revision DESC LIMIT 1
    `).get(product_id);
    if (!bomRow) throw new ManufacturingError(`No approved BOM version found for product ${product_id}`, 'PRECONDITION_FAILED');
    bomVerId = bomRow.id;
  } else {
    const bomVer = dialect.prepare("SELECT state FROM bom_versions WHERE id = ?").get(bomVerId);
    if (!bomVer || bomVer.state !== 'approved') throw new ManufacturingError('BOM version must be approved', 'PRECONDITION_FAILED');
  }

  // Mark BOM consumed_at so it becomes immutable
  dialect.prepare('UPDATE bom_versions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(nowISO(), bomVerId);

  // Verify routing version if supplied
  let routVerId = routing_version_id || null;
  if (!routVerId) {
    const rRow = dialect.prepare(`
      SELECT rv.id FROM routing_versions rv
      JOIN routings r ON r.id = rv.routing_id
      WHERE r.product_id = ? AND rv.state = 'approved'
      ORDER BY rv.revision DESC LIMIT 1
    `).get(product_id);
    if (rRow) routVerId = rRow.id;
  }

  const id = `mo_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM mfg_production_orders WHERE company_id = ?').get(companyId);
  const orderNumber = `MO-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();

  const whId = warehouse_id || 'WH-MAIN';
  const wipLoc = wip_location_id || 'LOC-WIP';
  const finLoc = finished_location_id || 'LOC-FG';

  dialect.prepare(`
    INSERT INTO mfg_production_orders (
      id, company_id, branch_id, order_number, product_id, bom_version_id, routing_version_id,
      planned_quantity, completed_quantity, rejected_quantity, warehouse_id, wip_location_id, finished_location_id,
      project_id, work_item_id, state, priority, notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)
  `).run(
    id, companyId, input.branch_id || null, orderNumber, product_id, bomVerId, routVerId,
    plannedQty, whId, wipLoc, finLoc, project_id || null, work_item_id || null,
    priority || 'medium', notes || '', input.actor || input.created_by || 'usr_system', now, now
  );

  // Generate material requirements from BOM lines
  const bomLines = dialect.prepare('SELECT * FROM bom_lines WHERE bom_version_id = ?').all(bomVerId);
  const insertReq = dialect.prepare(`
    INSERT INTO mfg_material_requirements (
      id, company_id, production_order_id, bom_line_id, component_id, uom_id, required_quantity,
      reserved_quantity, issued_quantity, returned_quantity, scrap_quantity, is_by_product, is_co_product,
      cost_share_percent, warehouse_id, location_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 0.0, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `);

  for (const line of bomLines) {
    const reqQty = (line.quantity * planned_quantity) * (1.0 + (line.scrap_factor_percent || 0) / 100.0);
    insertReq.run(
      `mreq_${crypto.randomUUID()}`, companyId, id, line.id, line.component_id, line.uom_id,
      reqQty, line.line_type === 'by_product' ? 1 : 0, line.line_type === 'co_product' ? 1 : 0,
      line.cost_share_percent || 0.0, whId, wipLoc, now, now
    );
  }

  // Generate work orders if routing exists
  if (routVerId) {
    const ops = dialect.prepare('SELECT * FROM routing_operations WHERE routing_version_id = ? ORDER BY sequence').all(routVerId);
    const insertWo = dialect.prepare(`
      INSERT INTO mfg_work_orders (
        id, company_id, production_order_id, operation_sequence, operation_id, work_center_id, resource_id,
        name, planned_setup_minutes, planned_run_minutes, quantity_to_produce, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `);
    for (const op of ops) {
      const setupMin = op.setup_minutes || 0;
      const runMin = (op.cycle_minutes_per_unit || 0) * planned_quantity;
      insertWo.run(
        `wo_${crypto.randomUUID()}`, companyId, id, op.sequence, op.id, op.work_center_id, op.resource_id,
        op.name, setupMin, runMin, planned_quantity, now, now
      );
    }
  }

  // Initialize production cost summary
  dialect.prepare(`
    INSERT INTO mfg_production_cost_summaries (
      id, company_id, production_order_id, direct_material_cost, direct_labor_cost, machine_overhead_cost,
      subcontract_cost, scrap_cost, total_wip_cost, finished_goods_cost, variance_cost, status, created_at, updated_at
    ) VALUES (?, ?, ?, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'open', ?, ?)
  `).run(`pcs_${crypto.randomUUID()}`, companyId, id, now, now);

  return { id, order_number: orderNumber, state: 'draft' };
}

export function planProductionOrder(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');
  if (order.state !== 'draft') throw new ManufacturingError(`order cannot be planned from state ${order.state}`, 'INVALID_STATE_TRANSITION');

  dialect.prepare("UPDATE mfg_production_orders SET state = 'planned', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  return { id: order_id, state: 'planned' };
}

export function releaseProductionOrder(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');
  if (!['draft','planned'].includes(order.state)) throw new ManufacturingError(`order cannot be released from state ${order.state}`, 'INVALID_STATE_TRANSITION');

  dialect.prepare("UPDATE mfg_production_orders SET state = 'released', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  dialect.prepare("UPDATE mfg_work_orders SET state = 'ready', updated_at = ? WHERE production_order_id = ? AND state = 'draft'").run(nowISO(), order_id);

  return { id: order_id, state: 'released' };
}

export function reserveMaterials(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  const reqs = dialect.prepare('SELECT * FROM mfg_material_requirements WHERE production_order_id = ? AND is_by_product = 0').all(order_id);
  for (const r of reqs) {
    dialect.prepare("UPDATE mfg_material_requirements SET reserved_quantity = required_quantity, state = 'reserved', updated_at = ? WHERE id = ?").run(nowISO(), r.id);
  }

  dialect.prepare("UPDATE mfg_production_orders SET state = 'materials_reserved', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  return { id: order_id, state: 'materials_reserved' };
}

export function holdProductionOrder(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  dialect.prepare("UPDATE mfg_production_orders SET state = 'on_hold', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  return { id: order_id, state: 'on_hold' };
}

export function cancelProductionOrder(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');
  if (['completed','closed'].includes(order.state)) throw new ManufacturingError('completed order cannot be cancelled', 'INVALID_STATE_TRANSITION');

  dialect.prepare("UPDATE mfg_production_orders SET state = 'cancelled', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  dialect.prepare("UPDATE mfg_work_orders SET state = 'rejected', updated_at = ? WHERE production_order_id = ?").run(nowISO(), order_id);

  return { id: order_id, state: 'cancelled' };
}
