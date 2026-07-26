// Material issue, return and scrap for manufacturing orders.
//
// Every quantity movement in this file is a Phase 04 `stock_moves` row created
// by `executeStockOperation`. Manufacturing keeps only lineage
// (`production_material_consumptions`) and a cost fact
// (`production_cost_facts`). There is no manufacturing stock ledger.
//
// GL follows the same rule. An issue and a return are posted by the Phase 04
// stock-accounting port (extended in Phase 05 to know the production usage). A
// WIP scrap crosses no internal boundary, so it is posted explicitly through
// the `manufacturing_wip_posting` source-fact contract that Phase 03 migration
// 034 registered for exactly this purpose.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round2, round6, scopedRow, assertState, financeContext,
} from './shared.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { consumeReservation } from '../inventory/reservations.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { requireAccountMapping } from './config.mjs';
import { ensureScrapLocation } from './orders.mjs';

const ISSUABLE_STATES = ['released', 'in_progress', 'partially_completed'];

function recordCostFact(db, {
  companyId, orderId, workOrderId = null, costType, direction, amount,
  quantity = 0, financeDocumentId = null, sourceReference = null, projectId = null, currency = 'IQD',
}) {
  const id = makeId('mcf');
  const now = nowIso();
  db.prepare(`
    INSERT INTO production_cost_facts (
      id, company_id, order_id, work_order_id, cost_type, direction, amount, currency,
      quantity, finance_document_id, source_reference, project_id, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, orderId, workOrderId, costType, direction, round2(Math.abs(amount)),
    currency, Number(quantity) || 0, financeDocumentId, sourceReference, projectId, now, now,
  );
  return id;
}

export { recordCostFact };

/**
 * Weighted average cost of what this order has actually pulled into WIP for one
 * product. Returns 0 when nothing has been issued yet — the caller must decide
 * whether that is legal.
 */
export function issuedUnitCost(db, companyId, orderId, productId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN movement_type = 'issue' THEN quantity ELSE 0 END), 0) AS issued_qty,
      COALESCE(SUM(CASE WHEN movement_type = 'issue' THEN value ELSE 0 END), 0) AS issued_value
    FROM production_material_consumptions
    WHERE company_id = ? AND order_id = ? AND product_id = ?
  `).get(companyId, orderId, productId);
  const qty = Number(row.issued_qty || 0);
  if (!(qty > 0)) return 0;
  return round6(Number(row.issued_value || 0) / qty);
}

/**
 * How much of a reservation is still held, derived from its immutable event
 * log — the same expression the Phase 04 reservation engine uses internally.
 */
function reservationRemaining(db, reservationId) {
  const reservation = db.prepare('SELECT quantity FROM stock_reservations WHERE id = ?').get(reservationId);
  if (!reservation) return 0;
  const events = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'consumed' THEN quantity ELSE 0 END), 0) AS consumed,
      COALESCE(SUM(CASE WHEN event_type IN ('released','expired') THEN quantity ELSE 0 END), 0) AS released,
      COALESCE(SUM(CASE WHEN event_type = 'reversed' THEN quantity ELSE 0 END), 0) AS reversed
    FROM stock_reservation_events WHERE reservation_id = ?
  `).get(reservationId);
  return Math.max(0, round6(
    Number(reservation.quantity) - Number(events.consumed) - Number(events.released) + Number(events.reversed),
  ));
}

function orderMaterialRow(db, orderId, productId, bomPath = null) {
  if (bomPath) {
    return db.prepare(
      'SELECT * FROM production_order_materials WHERE order_id = ? AND product_id = ? AND bom_path = ?',
    ).get(orderId, productId, bomPath) || null;
  }
  return db.prepare(
    'SELECT * FROM production_order_materials WHERE order_id = ? AND product_id = ? ORDER BY created_at LIMIT 1',
  ).get(orderId, productId) || null;
}

function linkConsumption(db, {
  companyId, orderId, orderMaterialId, workOrderId, move, movementType, productId, quantity, value, financeDocumentId,
}) {
  db.prepare(`
    INSERT INTO production_material_consumptions (
      id, company_id, order_id, order_material_id, work_order_id, stock_move_id,
      movement_type, product_id, quantity, value, finance_document_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('mmc'), companyId, orderId, orderMaterialId, workOrderId, move.id,
    movementType, productId, quantity, round2(value), financeDocumentId, nowIso(),
  );
}

function markOrderInProgress(db, order) {
  if (order.state !== 'released') return;
  const now = nowIso();
  db.prepare(`
    UPDATE production_orders SET state = 'in_progress', actual_start = COALESCE(actual_start, ?),
      updated_at = ?, version = version + 1 WHERE id = ?
  `).run(now, now, order.id);
}

export function issueMaterial(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ISSUABLE_STATES, 'manufacturing order');
  requireAccountMapping(db, companyId);
  const quantity = positive(payload.quantity, 'issue quantity');

  const material = orderMaterialRow(db, order.id, payload.product_id, payload.bom_path || null);
  if (!material) {
    throw new ManufacturingError(
      `product ${payload.product_id} is not a requirement of ${order.reference}`,
      'MATERIAL_NOT_REQUIRED',
    );
  }
  const outstanding = round6(
    Number(material.required_quantity) - Number(material.issued_quantity) + Number(material.returned_quantity),
  );
  const overIssue = round6(quantity - outstanding);
  if (overIssue > 0.0000001 && !payload.allow_over_issue) {
    throw new ManufacturingError(
      `issuing ${quantity} exceeds the outstanding requirement of ${outstanding}`,
      'MATERIAL_OVER_ISSUE',
    );
  }

  const uomId = material.uom_id
    || db.prepare('SELECT uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;
  if (!uomId) throw new ManufacturingError('a unit of measure is required to issue material', 'INPUT_MISSING_FIELD');

  // Reservation handling. Normally the issue consumes the order's reservation.
  // An authorised over-issue can exceed what the reservation holds; in that
  // case the reservation is consumed for exactly what it has and the excess is
  // taken from free stock, so the reserved projection never goes negative and
  // the surplus is never quietly left locked.
  let reservationToConsume = null;
  if (material.reservation_id && !payload.ignore_reservation) {
    const remaining = reservationRemaining(db, material.reservation_id);
    if (quantity <= remaining + 0.0000001) {
      reservationToConsume = material.reservation_id;
    } else if (remaining > 0) {
      consumeReservation(db, {
        company_id: companyId,
        reservation_id: material.reservation_id,
        quantity: remaining,
        actor,
        idempotency_key: `mo-issue-drain:${order.id}:${material.id}:${remaining}`,
      });
    }
  }

  const useReservation = Boolean(reservationToConsume);
  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/ISSUE`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: payload.location_id || order.source_location_id,
    location_dest_id: order.production_location_id,
    source_document_type: 'production_order',
    source_document_id: order.id,
    source_line_id: material.bom_path,
    reservation_id: useReservation ? reservationToConsume : null,
    idempotency_key: payload.stock_idempotency_key || `mo-issue:${order.id}:${material.id}:${makeId('n')}`,
  });

  const value = Math.abs(Number(move.total_value || 0));
  linkConsumption(db, {
    companyId, orderId: order.id, orderMaterialId: material.id,
    workOrderId: payload.work_order_id || null, move, movementType: 'issue',
    productId: payload.product_id, quantity, value,
    financeDocumentId: move.accounting?.finance_document_id || null,
  });
  recordCostFact(db, {
    companyId, orderId: order.id, workOrderId: payload.work_order_id || null,
    costType: 'material', direction: 'debit_wip', amount: value, quantity,
    financeDocumentId: move.accounting?.finance_document_id || null,
    sourceReference: move.id, projectId: order.project_id || null,
  });

  db.prepare(`
    UPDATE production_order_materials SET issued_quantity = issued_quantity + ?, updated_at = ? WHERE id = ?
  `).run(quantity, nowIso(), material.id);
  markOrderInProgress(db, order);

  return {
    order_id: order.id,
    material_id: material.id,
    stock_move_id: move.id,
    quantity,
    value: round2(value),
    finance_document_id: move.accounting?.finance_document_id || null,
  };
}

export function returnMaterial(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ISSUABLE_STATES, 'manufacturing order');
  requireAccountMapping(db, companyId);
  const quantity = positive(payload.quantity, 'return quantity');

  const material = orderMaterialRow(db, order.id, payload.product_id, payload.bom_path || null);
  if (!material) {
    throw new ManufacturingError(
      `product ${payload.product_id} is not a requirement of ${order.reference}`,
      'MATERIAL_NOT_REQUIRED',
    );
  }
  const inWip = round6(
    Number(material.issued_quantity) - Number(material.returned_quantity) - Number(material.scrapped_quantity),
  );
  if (quantity - inWip > 0.0000001) {
    throw new ManufacturingError(
      `cannot return ${quantity}; only ${inWip} of this component is in work in progress`,
      'MATERIAL_RETURN_EXCEEDS_WIP',
    );
  }

  const unitCost = issuedUnitCost(db, companyId, order.id, payload.product_id);
  const uomId = material.uom_id
    || db.prepare('SELECT uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/RETURN`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: order.production_location_id,
    location_dest_id: payload.location_dest_id || order.source_location_id,
    unit_cost: unitCost,
    source_document_type: 'production_order',
    source_document_id: order.id,
    source_line_id: material.bom_path,
    idempotency_key: payload.stock_idempotency_key || `mo-return:${order.id}:${material.id}:${makeId('n')}`,
  });

  const value = Math.abs(Number(move.total_value || 0));
  linkConsumption(db, {
    companyId, orderId: order.id, orderMaterialId: material.id,
    workOrderId: payload.work_order_id || null, move, movementType: 'return',
    productId: payload.product_id, quantity, value,
    financeDocumentId: move.accounting?.finance_document_id || null,
  });
  recordCostFact(db, {
    companyId, orderId: order.id, workOrderId: payload.work_order_id || null,
    costType: 'material', direction: 'credit_wip', amount: value, quantity,
    financeDocumentId: move.accounting?.finance_document_id || null,
    sourceReference: move.id, projectId: order.project_id || null,
  });
  db.prepare(`
    UPDATE production_order_materials SET returned_quantity = returned_quantity + ?, updated_at = ? WHERE id = ?
  `).run(quantity, nowIso(), material.id);

  return {
    order_id: order.id,
    material_id: material.id,
    stock_move_id: move.id,
    quantity,
    value: round2(value),
    finance_document_id: move.accounting?.finance_document_id || null,
  };
}

/**
 * Scrap material that is already inside WIP.
 *
 * Quantity leaves the production location through the canonical stock engine.
 * Value leaves WIP through the registered `manufacturing_wip_posting` contract,
 * because the move crosses no internal boundary and therefore produces no
 * valuation fact for the stock port to act on.
 */
export function scrapMaterial(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ISSUABLE_STATES, 'manufacturing order');
  const mapping = requireAccountMapping(db, companyId);
  if (!mapping.scrap_account_id) {
    throw new ManufacturingError('scrap_account_id is not configured for this company', 'MANUFACTURING_ACCOUNT_MAPPING_MISSING');
  }
  const quantity = positive(payload.quantity, 'scrap quantity');

  const material = orderMaterialRow(db, order.id, payload.product_id, payload.bom_path || null);
  if (!material) {
    throw new ManufacturingError(
      `product ${payload.product_id} is not a requirement of ${order.reference}`,
      'MATERIAL_NOT_REQUIRED',
    );
  }
  const inWip = round6(
    Number(material.issued_quantity) - Number(material.returned_quantity) - Number(material.scrapped_quantity),
  );
  if (quantity - inWip > 0.0000001) {
    throw new ManufacturingError(
      `cannot scrap ${quantity}; only ${inWip} of this component is in work in progress`,
      'MATERIAL_SCRAP_EXCEEDS_WIP',
    );
  }

  const scrapLocation = ensureScrapLocation(db, companyId, order.warehouse_id);
  const unitCost = issuedUnitCost(db, companyId, order.id, payload.product_id);
  const value = round2(unitCost * quantity);
  const uomId = material.uom_id
    || db.prepare('SELECT uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/SCRAP`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: order.production_location_id,
    location_dest_id: scrapLocation.id,
    unit_cost: unitCost,
    source_document_type: 'production_order',
    source_document_id: order.id,
    source_line_id: material.bom_path,
    idempotency_key: payload.stock_idempotency_key || `mo-scrap:${order.id}:${material.id}:${makeId('n')}`,
  });

  let financeDocumentId = null;
  if (value > 0) {
    const posted = postSourceFact(db, financeContext(payload), {
      fact_type: 'manufacturing_wip_posting',
      source_id: move.id,
      doc_date: nowIso().slice(0, 10),
      currency: payload.currency || 'IQD',
      lines: [
        { account_id: mapping.scrap_account_id, debit: value, credit: 0, description: `production_scrap:${order.reference}` },
        { account_id: mapping.wip_account_id, debit: 0, credit: value, description: `production_scrap:${order.reference}` },
      ],
    });
    financeDocumentId = posted.document_id;
  }

  linkConsumption(db, {
    companyId, orderId: order.id, orderMaterialId: material.id,
    workOrderId: payload.work_order_id || null, move, movementType: 'scrap',
    productId: payload.product_id, quantity, value, financeDocumentId,
  });
  recordCostFact(db, {
    companyId, orderId: order.id, workOrderId: payload.work_order_id || null,
    costType: 'scrap', direction: 'credit_wip', amount: value, quantity,
    financeDocumentId, sourceReference: move.id, projectId: order.project_id || null,
  });
  db.prepare(`
    UPDATE production_order_materials SET scrapped_quantity = scrapped_quantity + ?, updated_at = ? WHERE id = ?
  `).run(quantity, nowIso(), material.id);

  return {
    order_id: order.id,
    material_id: material.id,
    stock_move_id: move.id,
    quantity,
    value,
    finance_document_id: financeDocumentId,
  };
}

/**
 * Backflush every requirement flagged for it, in one call, at completion time.
 * Issue quantities are proportional to the quantity actually produced.
 */
export function backflushMaterials(db, payload = {}) {
  const companyId = requireCompany(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  const producedQuantity = positive(payload.produced_quantity, 'produced_quantity');
  const ratio = producedQuantity / Number(order.planned_quantity);
  const rows = db.prepare(
    'SELECT * FROM production_order_materials WHERE order_id = ? AND backflush = 1',
  ).all(order.id);
  const results = [];
  for (const material of rows) {
    const target = round6(Number(material.required_quantity) * ratio);
    const alreadyIssued = Number(material.issued_quantity);
    const toIssue = round6(target - alreadyIssued);
    if (toIssue <= 0.0000001) continue;
    results.push(issueMaterial(db, {
      ...payload,
      product_id: material.product_id,
      bom_path: material.bom_path,
      quantity: toIssue,
      stock_idempotency_key: `mo-backflush:${order.id}:${material.id}:${producedQuantity}`,
    }));
  }
  return results;
}
