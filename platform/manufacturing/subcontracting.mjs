// platform/manufacturing/subcontracting.mjs — Subcontract Manufacturing Domain Engine.

'use strict';

import crypto from 'node:crypto';
import { ManufacturingError } from './manufacturing-orders.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function createSubcontractOrder(db, input) {
  const { production_order_id, work_order_id, supplier_id, service_product_id, product_id, ordered_qty, quantity, service_cost, unit_cost } = input;
  const supplierId = supplier_id || 'sup_default';
  const serviceProd = service_product_id || product_id || 'prod_service';
  const qty = Number(ordered_qty || quantity || 1);
  const uCost = Number(unit_cost || (service_cost ? service_cost / qty : 0.0));
  const dialect = db;

  const companyId = input.company_id || 'default';
  const id = `subc_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM mfg_subcontract_orders WHERE company_id = ?').get(companyId);
  const subNumber = `SUB-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const totalCost = qty * uCost;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO mfg_subcontract_orders (
      id, company_id, subcontract_number, production_order_id, work_order_id, supplier_id,
      service_product_id, quantity, unit_cost, total_cost, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, companyId, subNumber, production_order_id || null, work_order_id || null, supplierId,
    serviceProd, qty, uCost, totalCost, now, now
  );

  return { id, subcontract_number: subNumber, state: 'draft', total_cost: totalCost };
}

export function dispatchSubcontractComponents(db, input) {
  const { subcontract_order_id, product_id, dispatched_qty } = input;
  const dialect = db;
  const sub = dialect.prepare('SELECT * FROM mfg_subcontract_orders WHERE id = ?').get(subcontract_order_id);
  if (!sub) throw new ManufacturingError(`subcontract order ${subcontract_order_id} not found`, 'SUBCONTRACT_NOT_FOUND');

  const now = nowISO();
  const qty = Number(dispatched_qty || 1);
  const compId = product_id || 'prod_component';
  const comp = dialect.prepare(`
    SELECT pt.uom_id 
    FROM product_variants pv 
    LEFT JOIN product_templates pt ON pv.template_id = pt.id 
    WHERE pv.id = ?
  `).get(compId);
  const uomId = input.uom_id || (comp && comp.uom_id) || null;

  dialect.prepare(`
    INSERT INTO mfg_supplier_held_stock (
      id, company_id, supplier_id, component_id, uom_id, dispatched_quantity, remaining_quantity, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, supplier_id, component_id) DO UPDATE SET
      dispatched_quantity = dispatched_quantity + excluded.dispatched_quantity,
      remaining_quantity = remaining_quantity + excluded.dispatched_quantity,
      updated_at = excluded.updated_at
  `).run(
    `shs_${crypto.randomUUID()}`, sub.company_id, sub.supplier_id, compId, uomId,
    qty, qty, now, now
  );

  dialect.prepare("UPDATE mfg_subcontract_orders SET state = 'dispatched', updated_at = ? WHERE id = ?").run(now, subcontract_order_id);
  return { id: subcontract_order_id, state: 'dispatched', dispatched_qty: qty };
}

export function receiveSubcontractGoods(db, input) {
  const { subcontract_order_id, order_id, quantity, received_qty } = input;
  const subId = subcontract_order_id || order_id;
  const dialect = db;
  const sub = dialect.prepare('SELECT * FROM mfg_subcontract_orders WHERE id = ?').get(subId);
  if (!sub) throw new ManufacturingError(`subcontract order ${subId} not found`, 'SUBCONTRACT_NOT_FOUND');

  const rQty = Number(received_qty || quantity || sub.quantity);
  const now = nowISO();
  dialect.prepare("UPDATE mfg_subcontract_orders SET state = 'received', updated_at = ? WHERE id = ?").run(now, subId);

  // Update subcontract cost on production cost summary if production_order_id present
  if (sub.production_order_id) {
    dialect.prepare(`
      UPDATE mfg_production_cost_summaries
      SET subcontract_cost = subcontract_cost + ?, total_wip_cost = total_wip_cost + ?, updated_at = ?
      WHERE production_order_id = ?
    `).run(sub.total_cost, sub.total_cost, now, sub.production_order_id);
  }

  return { id: subId, state: 'received', received_qty: rQty, received_quantity: rQty };
}

export function reconcileSubcontract(db, input) {
  const { subcontract_order_id } = input;
  const dialect = db;
  const sub = dialect.prepare('SELECT * FROM mfg_subcontract_orders WHERE id = ?').get(subcontract_order_id);
  if (!sub) throw new ManufacturingError(`subcontract order ${subcontract_order_id} not found`, 'SUBCONTRACT_NOT_FOUND');

  dialect.prepare("UPDATE mfg_subcontract_orders SET state = 'closed', updated_at = ? WHERE id = ?").run(nowISO(), subcontract_order_id);
  return { id: subcontract_order_id, state: 'closed' };
}
