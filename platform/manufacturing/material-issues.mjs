// platform/manufacturing/material-issues.mjs — Material Issues, WIP & Inventory Integration.

'use strict';

import crypto from 'node:crypto';
import { ManufacturingError } from './manufacturing-orders.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function issueMaterial(db, input) {
  const { production_order_id, order_id, requirement_id, product_id, issued_qty, quantity, unit_cost, lot_number, serial_number } = input;
  const moId = production_order_id || order_id;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(moId);
  if (!order) throw new ManufacturingError(`production order ${moId} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  const qty = Number(issued_qty || quantity || 0);
  if (qty <= 0) throw new ManufacturingError('quantity must be positive', 'INPUT_INVALID');

  let req = requirement_id ? dialect.prepare('SELECT * FROM mfg_material_requirements WHERE id = ?').get(requirement_id) : null;
  if (!req && product_id) {
    req = dialect.prepare('SELECT * FROM mfg_material_requirements WHERE production_order_id = ? AND component_id = ?').get(moId, product_id);
  }

  const compId = req ? req.component_id : (product_id || 'prod_unknown');
  const uomId = req ? req.uom_id : 'uom_unit';
  const reqId = req ? req.id : null;

  const now = nowISO();
  const actor = input.actor || input.created_by || 'usr_system';

  // Record material issue (Dr WIP / Cr Inventory)
  const id = `miss_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO mfg_material_issues (
      id, company_id, production_order_id, requirement_id, component_id, uom_id, quantity,
      issue_type, warehouse_id, location_id, wip_location_id, lot_number, serial_number, issued_by, issued_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'issue', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, order.company_id, moId, reqId, compId, uomId,
    qty, order.warehouse_id, (req && req.location_id) || order.warehouse_id, order.wip_location_id,
    lot_number || null, serial_number || null, actor, now, now
  );

  // Update requirement issued quantity if requirement exists
  if (req) {
    const newIssued = req.issued_quantity + qty;
    const reqState = newIssued >= req.required_quantity ? 'completed' : 'issued';
    dialect.prepare('UPDATE mfg_material_requirements SET issued_quantity = ?, state = ?, updated_at = ? WHERE id = ?').run(newIssued, reqState, now, req.id);
  }

  // Calculate standard unit cost from product_variants, input or default
  const uCost = unit_cost !== undefined ? Number(unit_cost) : 10.0;
  const matCost = qty * uCost;

  // Update cost summary
  dialect.prepare(`
    UPDATE mfg_production_cost_summaries
    SET direct_material_cost = direct_material_cost + ?, total_wip_cost = total_wip_cost + ?, updated_at = ?
    WHERE production_order_id = ?
  `).run(matCost, matCost, now, moId);

  return { id, issued_qty: qty, quantity_issued: qty, total_material_cost: matCost };
}

export function returnMaterial(db, input) {
  const { production_order_id, order_id, requirement_id, quantity } = input;
  const moId = production_order_id || order_id;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(moId);
  if (!order) throw new ManufacturingError(`production order ${moId} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  const req = dialect.prepare('SELECT * FROM mfg_material_requirements WHERE id = ?').get(requirement_id);
  if (!req) throw new ManufacturingError(`requirement ${requirement_id} not found`, 'REQUIREMENT_NOT_FOUND');

  const qty = Number(quantity);
  const now = nowISO();
  const actor = input.actor || input.created_by || 'usr_system';

  const id = `miss_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO mfg_material_issues (
      id, company_id, production_order_id, requirement_id, component_id, uom_id, quantity,
      issue_type, warehouse_id, location_id, wip_location_id, issued_by, issued_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'return', ?, ?, ?, ?, ?, ?)
  `).run(
    id, order.company_id, moId, requirement_id, req.component_id, req.uom_id,
    qty, order.warehouse_id, req.location_id || order.warehouse_id, order.wip_location_id, actor, now, now
  );

  dialect.prepare('UPDATE mfg_material_requirements SET returned_quantity = returned_quantity + ?, updated_at = ? WHERE id = ?').run(qty, now, requirement_id);

  return { id, quantity_returned: qty };
}

export function completeProductionOrder(db, input) {
  const { order_id, completed_qty, completed_quantity, rejected_quantity } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  const compQty = (completed_qty !== undefined || completed_quantity !== undefined) ? Number(completed_qty || completed_quantity) : order.planned_quantity;
  const rejQty = rejected_quantity !== undefined ? Number(rejected_quantity) : 0.0;
  const now = nowISO();

  // Dr Finished Goods / Cr WIP
  const costSum = dialect.prepare('SELECT * FROM mfg_production_cost_summaries WHERE production_order_id = ?').get(order_id);
  const totalWip = costSum?.total_wip_cost || 0.0;

  dialect.prepare(`
    UPDATE mfg_production_orders
    SET state = 'completed', completed_quantity = ?, rejected_quantity = ?, actual_end_date = ?, updated_at = ?
    WHERE id = ?
  `).run(compQty, rejQty, now, order_id);

  dialect.prepare(`
    UPDATE mfg_production_cost_summaries
    SET finished_goods_cost = ?, status = 'closed', updated_at = ?
    WHERE production_order_id = ?
  `).run(totalWip, now, order_id);

  return { id: order_id, state: 'completed', completed_qty: compQty, completed_quantity: compQty, finished_goods_cost: totalWip };
}

export function closeProductionOrder(db, input) {
  const { order_id } = input;
  const dialect = db;
  const order = dialect.prepare('SELECT * FROM mfg_production_orders WHERE id = ?').get(order_id);
  if (!order) throw new ManufacturingError(`production order ${order_id} not found`, 'MANUFACTURING_ORDER_NOT_FOUND');

  dialect.prepare("UPDATE mfg_production_orders SET state = 'closed', updated_at = ? WHERE id = ?").run(nowISO(), order_id);
  return { id: order_id, state: 'closed' };
}
