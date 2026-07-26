// Manufacturing order lifecycle.
//
//   draft → planned → approved → released → in_progress
//         → partially_completed → completed → closed
//   (cancelled from any pre-completion state)
//
// Release is the only state change with side effects, and they are all
// delegated: BOM explosion writes requirements, the Phase 04 reservation engine
// writes reservations, and the Phase 04 Work Item authority writes the execution
// tasks. This module writes no stock balance and no GL line.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round6, scopedRow, assertState, nextReference,
} from './shared.mjs';
import { explodeBom, resolveEffectiveBom, getRouting } from './engineering.mjs';
import { reserveStock, releaseReservation } from '../inventory/reservations.mjs';
import { createWorkItem, updateWorkItem } from '../work_items/work_items.mjs';

const OPEN_STATES = ['draft', 'planned', 'approved', 'released', 'in_progress', 'partially_completed'];

/**
 * Every company gets exactly one WIP location per warehouse, created on demand.
 * Its `usage` is `production`, which is what makes the Phase 04 valuation engine
 * record an issue when material enters it and a receipt when output leaves it.
 */
export function ensureProductionLocation(db, companyId, warehouseId) {
  const warehouse = scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const existing = db.prepare(`
    SELECT * FROM stock_locations
    WHERE company_id = ? AND warehouse_id = ? AND usage = 'production'
    ORDER BY created_at LIMIT 1
  `).get(companyId, warehouseId);
  if (existing) return existing;

  const id = makeId('loc_wip');
  const now = nowIso();
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, ?, ?, 'Production', ?, 'production', 0, ?)
  `).run(id, companyId, warehouseId, warehouse.view_location_id, `${warehouse.code}/Production`, now);
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

export function ensureScrapLocation(db, companyId, warehouseId) {
  const warehouse = scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');
  const existing = db.prepare(`
    SELECT * FROM stock_locations
    WHERE company_id = ? AND warehouse_id = ? AND is_scrap = 1
    ORDER BY created_at LIMIT 1
  `).get(companyId, warehouseId);
  if (existing) return existing;

  const id = makeId('loc_scrap');
  const now = nowIso();
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, ?, ?, 'Scrap', ?, 'inventory_loss', 1, ?)
  `).run(id, companyId, warehouseId, warehouse.view_location_id, `${warehouse.code}/Scrap`, now);
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

export function createProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const plannedQuantity = positive(payload.planned_quantity, 'planned_quantity');

  const product = db.prepare('SELECT id, company_id FROM product_variants WHERE id = ?').get(payload.product_id);
  if (!product) throw new ManufacturingError(`product not found: ${payload.product_id}`, 'RECORD_NOT_FOUND', 404);
  if (product.company_id !== companyId) {
    throw new ManufacturingError('product is outside the active company', 'COMPANY_SCOPE_VIOLATION', 403);
  }

  let warehouseId = payload.warehouse_id || null;
  if (!warehouseId) {
    warehouseId = db.prepare(
      'SELECT id FROM warehouses WHERE company_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1',
    ).get(companyId)?.id || null;
  }
  if (!warehouseId) throw new ManufacturingError('a warehouse is required', 'INPUT_MISSING_FIELD');
  const warehouse = scopedRow(db, 'warehouses', warehouseId, companyId, 'warehouse');

  if (payload.sale_order_id) scopedRow(db, 'sale_orders', payload.sale_order_id, companyId, 'sale order');
  if (payload.bom_id) scopedRow(db, 'bom_headers', payload.bom_id, companyId, 'BOM');

  const production = ensureProductionLocation(db, companyId, warehouseId);
  const id = payload.id || makeId('mo');
  const reference = payload.reference || nextReference(db, 'production_orders', companyId, 'MO');
  const now = nowIso();

  db.prepare(`
    INSERT INTO production_orders (
      id, company_id, branch_id, reference, product_id, uom_id, bom_id, bom_version,
      routing_id, routing_version, planned_quantity, completed_quantity, rejected_quantity,
      warehouse_id, source_location_id, production_location_id, finished_location_id,
      state, priority, scheduled_start, scheduled_end, actual_start, actual_end,
      demand_source_type, demand_source_id, project_id, sale_order_id, planning_proposal_id,
      approved_by, approved_at, released_by, released_at, cancelled_reason,
      created_at, created_by, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, 0, 0, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL,
      ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, 1)
  `).run(
    id, companyId, payload.branch_id || null, reference, payload.product_id, payload.uom_id || null,
    payload.bom_id || null, payload.routing_id || null, plannedQuantity, warehouseId,
    payload.source_location_id || warehouse.lot_stock_id, production.id,
    payload.finished_location_id || warehouse.lot_stock_id,
    Number(payload.priority || 10), payload.scheduled_start || null, payload.scheduled_end || null,
    payload.demand_source_type || 'manual', payload.demand_source_id || null,
    payload.project_id || null, payload.sale_order_id || null, payload.planning_proposal_id || null,
    now, actor, now,
  );
  return getProductionOrder(db, id, companyId);
}

export function planProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ['draft'], 'manufacturing order');
  db.prepare("UPDATE production_orders SET state = 'planned', updated_at = ?, version = version + 1 WHERE id = ?")
    .run(nowIso(), order.id);
  return getProductionOrder(db, order.id, companyId);
}

export function approveProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ['draft', 'planned'], 'manufacturing order');
  const now = nowIso();
  db.prepare(`
    UPDATE production_orders SET state = 'approved', approved_by = ?, approved_at = ?,
      updated_at = ?, version = version + 1 WHERE id = ?
  `).run(actor, now, now, order.id);
  return getProductionOrder(db, order.id, companyId);
}

/**
 * Release: validate engineering data, snapshot the exact versions used, explode
 * the BOM into requirements, reserve what is available, record shortages for
 * what is not, and create the work orders plus their canonical Work Items.
 *
 * A shortage does not block release — it produces a planning exception the
 * planner can act on, which is what a real shop floor needs. `require_full_
 * material` makes release fail closed instead, for companies that want that.
 */
export function releaseProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ['approved'], 'manufacturing order');

  const bom = resolveEffectiveBom(db, {
    company_id: companyId,
    product_id: order.product_id,
    bom_id: order.bom_id || payload.bom_id || null,
  });
  if (!bom) {
    throw new ManufacturingError(
      `no approved BOM is effective for product ${order.product_id}`,
      'BOM_NOT_EFFECTIVE',
    );
  }
  if (bom.status !== 'approved') {
    throw new ManufacturingError(`BOM ${bom.code} v${bom.version} is not approved`, 'BOM_NOT_APPROVED');
  }
  if (bom.product_id !== order.product_id) {
    throw new ManufacturingError('the BOM does not produce this order\'s product', 'BOM_PRODUCT_MISMATCH');
  }

  const routingId = order.routing_id || bom.routing_id || null;
  let routing = null;
  if (routingId) {
    routing = getRouting(db, routingId, companyId);
    if (routing.status !== 'approved') {
      throw new ManufacturingError(`routing ${routing.code} v${routing.version} is not approved`, 'ROUTING_NOT_APPROVED');
    }
  }

  const { requirements, byProducts } = explodeBom(db, {
    company_id: companyId,
    bom,
    quantity: order.planned_quantity,
  });
  if (!requirements.length) {
    throw new ManufacturingError('BOM explosion produced no material requirement', 'BOM_EMPTY');
  }

  const now = nowIso();
  const insertMaterial = db.prepare(`
    INSERT INTO production_order_materials (
      id, order_id, company_id, bom_line_id, product_id, uom_id, required_quantity,
      issued_quantity, returned_quantity, scrapped_quantity, reservation_id,
      shortage_quantity, backflush, operation_ref, bom_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?)
  `);

  const shortages = [];
  for (const requirement of requirements) {
    let reservationId = null;
    let shortage = 0;
    try {
      const reservation = reserveStock(db, {
        company_id: companyId,
        branch_id: order.branch_id || null,
        warehouse_id: order.warehouse_id,
        location_id: order.source_location_id,
        product_id: requirement.product_id,
        source_document_type: 'production_order',
        source_document_id: order.id,
        source_line_id: requirement.bom_path,
        quantity: requirement.quantity,
        allow_partial: true,
        idempotency_key: `mo-release:${order.id}:${requirement.bom_path}`,
        actor,
      });
      reservationId = reservation.id;
      shortage = round6(Math.max(0, requirement.quantity - Number(reservation.quantity)));
    } catch (error) {
      // No stock at all for this component: a full shortage, not a failure.
      if (!/insufficient/i.test(String(error.message))) throw error;
      shortage = requirement.quantity;
    }
    if (shortage > 0) {
      shortages.push({ product_id: requirement.product_id, bom_path: requirement.bom_path, shortage_quantity: shortage });
    }
    insertMaterial.run(
      makeId('mom'), order.id, companyId, requirement.bom_line_id, requirement.product_id,
      requirement.uom_id, requirement.quantity, reservationId, shortage,
      payload.backflush ? 1 : 0, requirement.operation_ref || null, requirement.bom_path, now, now,
    );
  }

  if (shortages.length && payload.require_full_material) {
    throw new ManufacturingError(
      `material shortage on ${shortages.length} component(s); release blocked by policy`,
      'MATERIAL_SHORTAGE',
    );
  }

  const operations = routing?.operations?.length
    ? routing.operations
    : [{ id: null, sequence: 10, name: 'Production', work_center_id: null, setup_minutes: 0, run_minutes_per_unit: 0, is_subcontracted: 0, subcontractor_party_id: null, quality_plan_id: null }];

  const insertOperation = db.prepare(`
    INSERT INTO production_order_operations (
      id, order_id, company_id, routing_operation_id, sequence, name, work_center_id,
      planned_setup_minutes, planned_run_minutes, is_subcontracted, subcontractor_party_id,
      quality_plan_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWorkOrder = db.prepare(`
    INSERT INTO production_work_orders (
      id, order_id, order_operation_id, company_id, work_item_id, work_center_id,
      operator_user_id, sequence, state, planned_start, planned_end, actual_start, actual_end,
      output_quantity, scrap_quantity, rework_quantity, blocking_reason, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, ?, ?, ?, 1)
  `);

  const hasShortage = shortages.length > 0;
  const workOrders = [];
  for (const operation of operations) {
    const operationId = makeId('moop');
    insertOperation.run(
      operationId, order.id, companyId, operation.id || null, Number(operation.sequence),
      String(operation.name), operation.work_center_id || null,
      Number(operation.setup_minutes || 0),
      Number(operation.run_minutes_per_unit || 0) * Number(order.planned_quantity),
      operation.is_subcontracted ? 1 : 0, operation.subcontractor_party_id || null,
      operation.quality_plan_id || null, now,
    );

    // Canonical Work Item — Phase 05 creates no task table of its own.
    const workItem = createWorkItem(db, {
      company_id: companyId,
      branch_id: order.branch_id || '*',
      title: `${order.reference} · ${operation.name}`,
      description: `Manufacturing operation ${operation.sequence} for ${order.reference}`,
      source_type: 'manufacturing_work_order',
      source_id: order.id,
      source_line_id: operationId,
      status: hasShortage ? 'blocked' : 'todo',
      stage: 'shop_floor',
      priority: Number(order.priority) >= 20 ? 'high' : 'medium',
      estimated_hours: (Number(operation.setup_minutes || 0)
        + Number(operation.run_minutes_per_unit || 0) * Number(order.planned_quantity)) / 60,
      work_order_ref: order.id,
      project_ref: order.project_id || null,
      actor,
      created_by: actor,
    });

    const workOrderId = makeId('mowo');
    insertWorkOrder.run(
      workOrderId, order.id, operationId, companyId, workItem.id, operation.work_center_id || null,
      Number(operation.sequence), hasShortage ? 'waiting_material' : 'ready',
      order.scheduled_start || null, order.scheduled_end || null,
      hasShortage ? 'material shortage at release' : null, now, now,
    );
    workOrders.push(workOrderId);
  }

  db.prepare(`
    UPDATE production_orders SET state = 'released', bom_id = ?, bom_version = ?,
      routing_id = ?, routing_version = ?, released_by = ?, released_at = ?,
      updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(
    bom.id, bom.version, routing?.id || null, routing?.version || null,
    actor, now, now, order.id,
  );

  return {
    ...getProductionOrder(db, order.id, companyId),
    shortages,
    by_products: byProducts,
    work_order_ids: workOrders,
  };
}

export function cancelProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, OPEN_STATES, 'manufacturing order');

  const issued = db.prepare(`
    SELECT COALESCE(SUM(issued_quantity - returned_quantity), 0) AS n
    FROM production_order_materials WHERE order_id = ?
  `).get(order.id).n;
  if (Number(issued) > 0.0000001 && !payload.force) {
    throw new ManufacturingError(
      'material is still issued to this order; return it before cancelling',
      'MANUFACTURING_WIP_NOT_EMPTY',
    );
  }

  const reservations = db.prepare(
    'SELECT reservation_id FROM production_order_materials WHERE order_id = ? AND reservation_id IS NOT NULL',
  ).all(order.id);
  for (const row of reservations) {
    const reservation = db.prepare('SELECT status FROM stock_reservations WHERE id = ?').get(row.reservation_id);
    if (!reservation || ['released', 'consumed', 'expired'].includes(reservation.status)) continue;
    try {
      releaseReservation(db, { company_id: companyId, reservation_id: row.reservation_id, actor, idempotency_key: `mo-cancel:${order.id}:${row.reservation_id}` });
    } catch (error) {
      if (!/no releasable quantity/i.test(String(error.message))) throw error;
    }
  }

  const now = nowIso();
  const workOrders = db.prepare('SELECT id, work_item_id FROM production_work_orders WHERE order_id = ?').all(order.id);
  for (const workOrder of workOrders) {
    db.prepare("UPDATE production_work_orders SET state = 'cancelled', updated_at = ?, version = version + 1 WHERE id = ?")
      .run(now, workOrder.id);
    if (workOrder.work_item_id) {
      updateWorkItem(db, workOrder.work_item_id, { company_id: companyId, status: 'cancelled' });
    }
  }
  db.prepare(`
    UPDATE production_orders SET state = 'cancelled', cancelled_reason = ?, updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(payload.reason || 'cancelled by user', now, order.id);
  return getProductionOrder(db, order.id, companyId);
}

/**
 * Closing an order is the accounting statement "nothing more will happen here".
 * It fails closed if WIP is not empty, because a closed order with residual WIP
 * is exactly how a manufacturing ledger silently stops reconciling.
 */
export function closeProductionOrder(db, payload = {}) {
  const companyId = requireCompany(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ['completed', 'partially_completed'], 'manufacturing order');

  const wip = getWipBalance(db, companyId, order.id);
  if (Math.abs(wip.balance) > 0.005 && !payload.variance_acknowledged) {
    throw new ManufacturingError(
      `order still carries WIP balance ${wip.balance}; post the variance or acknowledge it before closing`,
      'MANUFACTURING_WIP_NOT_EMPTY',
    );
  }
  const openInspections = db.prepare(`
    SELECT COUNT(*) AS n FROM quality_inspections
    WHERE company_id = ? AND subject_type = 'production_order' AND subject_id = ?
      AND state IN ('pending', 'in_progress')
  `).get(companyId, order.id).n;
  if (Number(openInspections) > 0) {
    throw new ManufacturingError('open quality inspections block closing this order', 'QUALITY_HOLD_ACTIVE');
  }

  db.prepare("UPDATE production_orders SET state = 'closed', updated_at = ?, version = version + 1 WHERE id = ?")
    .run(nowIso(), order.id);
  return getProductionOrder(db, order.id, companyId);
}

/**
 * WIP balance for one order, derived entirely from `production_cost_facts`.
 * Nothing stores this number; it is always recomputed, which is why it cannot
 * drift away from the GL.
 */
export function getWipBalance(db, companyId, orderId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'debit_wip' THEN amount ELSE 0 END), 0) AS debits,
      COALESCE(SUM(CASE WHEN direction = 'credit_wip' THEN amount ELSE 0 END), 0) AS credits
    FROM production_cost_facts WHERE company_id = ? AND order_id = ?
  `).get(companyId, orderId);
  const debits = Number(row.debits || 0);
  const credits = Number(row.credits || 0);
  return { debits, credits, balance: round6(debits - credits) };
}

export function getProductionOrder(db, id, companyId) {
  const order = scopedRow(db, 'production_orders', id, companyId, 'manufacturing order');
  const materials = db.prepare(
    'SELECT * FROM production_order_materials WHERE order_id = ? ORDER BY created_at, id',
  ).all(id);
  const operations = db.prepare(
    'SELECT * FROM production_order_operations WHERE order_id = ? ORDER BY sequence',
  ).all(id);
  const workOrders = db.prepare(
    'SELECT * FROM production_work_orders WHERE order_id = ? ORDER BY sequence',
  ).all(id);
  return { ...order, materials, operations, work_orders: workOrders, wip: getWipBalance(db, companyId, id) };
}

export function listProductionOrders(db, { company_id, state = null, project_id = null, limit = 100 }) {
  let sql = 'SELECT * FROM production_orders WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (project_id) { sql += ' AND project_id = ?'; params.push(project_id); }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`;
  return db.prepare(sql).all(...params);
}
