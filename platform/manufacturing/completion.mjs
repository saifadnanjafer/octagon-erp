// Production output: turning accumulated WIP into valued finished goods.
//
// Costing rule
// ------------
// The unit cost of a completion is not a standard and not an estimate; it is
// the share of the order's own accumulated WIP that this completion absorbs:
//
//   final completion  → absorb the entire remaining WIP balance
//   partial completion → absorb balance × (this quantity ÷ quantity still open)
//
// That makes the last completion self-clearing: an order that has produced its
// whole planned quantity ends with a WIP balance of exactly zero, which is what
// `stock-to-gl-reconciliation` checks.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round2, round6, scopedRow, assertState, financeContext,
} from './shared.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { requireAccountMapping } from './config.mjs';
import { recordCostFact } from './materials.mjs';
import { backflushMaterials } from './materials.mjs';
import { getWipBalance, getProductionOrder } from './orders.mjs';

function assertQualityClear(db, companyId, orderId) {
  const blocking = db.prepare(`
    SELECT reference FROM quality_inspections
    WHERE company_id = ? AND subject_type = 'production_order' AND subject_id = ?
      AND blocks_downstream = 1
      AND (state IN ('pending', 'in_progress')
           OR (state = 'failed' AND deviation_approved_by IS NULL))
    LIMIT 1
  `).get(companyId, orderId);
  if (blocking) {
    throw new ManufacturingError(
      `quality inspection ${blocking.reference} must pass (or carry an approved deviation) before completion`,
      'QUALITY_HOLD_ACTIVE',
    );
  }
}

/**
 * Post a completion: optional backflush, then the finished-goods receipt.
 *
 * The stock move production → finished-goods location is the only quantity
 * write, and the Phase 04 stock-accounting port turns it into
 * Dr Finished Goods / Cr WIP.
 */
export function completeProduction(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ['released', 'in_progress', 'partially_completed'], 'manufacturing order');
  const mapping = requireAccountMapping(db, companyId);
  const quantity = positive(payload.quantity, 'completion quantity');
  assertQualityClear(db, companyId, order.id);

  const alreadyDone = Number(order.completed_quantity);
  const planned = Number(order.planned_quantity);
  const rejected = Number(payload.rejected_quantity || 0);
  const tolerance = Number(payload.overproduction_tolerance_percent ?? 0);
  const ceiling = round6(planned * (1 + tolerance / 100));
  if (round6(alreadyDone + quantity) - ceiling > 0.0000001) {
    throw new ManufacturingError(
      `completing ${quantity} would exceed the planned quantity ${planned} beyond the allowed tolerance`,
      'MANUFACTURING_OVERPRODUCTION',
    );
  }

  const backflushed = backflushMaterials(db, {
    ...payload,
    order_id: order.id,
    produced_quantity: alreadyDone + quantity,
  });

  const openQuantity = Math.max(quantity, round6(planned - alreadyDone));
  const wipBefore = getWipBalance(db, companyId, order.id);
  if (wipBefore.balance <= 0) {
    throw new ManufacturingError(
      'this order has no work-in-progress value to capitalise; issue material or record time first',
      'MANUFACTURING_WIP_EMPTY',
    );
  }

  const isFinalCompletion = round6(alreadyDone + quantity) >= round6(planned) - 0.0000001;
  const byProductCredit = postByProducts(db, payload, order, mapping, companyId, actor);
  const wipAfterByProducts = getWipBalance(db, companyId, order.id);

  const absorbed = isFinalCompletion
    ? round2(wipAfterByProducts.balance)
    : round2(wipAfterByProducts.balance * (quantity / openQuantity));
  if (!(absorbed > 0)) {
    throw new ManufacturingError('the computed finished-goods value is not positive', 'MANUFACTURING_COST_INVALID');
  }
  const unitCost = round6(absorbed / quantity);

  const uomId = order.uom_id
    || db.prepare('SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(order.product_id)?.uom_id;
  if (!uomId) throw new ManufacturingError('a unit of measure is required to receive finished goods', 'INPUT_MISSING_FIELD');

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/FG`,
    product_id: order.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: order.production_location_id,
    location_dest_id: payload.location_dest_id || order.finished_location_id,
    unit_cost: unitCost,
    source_document_type: 'production_order',
    source_document_id: order.id,
    source_line_id: `${order.id}:fg`,
    idempotency_key: payload.stock_idempotency_key || `mo-complete:${order.id}:${alreadyDone}:${quantity}`,
  });

  const postedValue = Math.abs(Number(move.total_value || 0));
  db.prepare(`
    INSERT INTO production_outputs (
      id, company_id, order_id, stock_move_id, output_type, product_id, quantity,
      unit_cost, value, finance_document_id, quality_inspection_id, created_at
    ) VALUES (?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('mout'), companyId, order.id, move.id, order.product_id, quantity,
    unitCost, round2(postedValue), move.accounting?.finance_document_id || null,
    payload.quality_inspection_id || null, nowIso(),
  );
  recordCostFact(db, {
    companyId, orderId: order.id, costType: 'finished_goods', direction: 'credit_wip',
    amount: postedValue, quantity, financeDocumentId: move.accounting?.finance_document_id || null,
    sourceReference: move.id, projectId: order.project_id || null,
  });

  const now = nowIso();
  const completedTotal = round6(alreadyDone + quantity);
  const nextState = completedTotal >= round6(planned) - 0.0000001 ? 'completed' : 'partially_completed';
  db.prepare(`
    UPDATE production_orders SET completed_quantity = ?, rejected_quantity = rejected_quantity + ?,
      state = ?, actual_end = CASE WHEN ? = 'completed' THEN ? ELSE actual_end END,
      updated_at = ?, version = version + 1
    WHERE id = ?
  `).run(completedTotal, rejected, nextState, nextState, now, now, order.id);

  const wipAfter = getWipBalance(db, companyId, order.id);
  return {
    order_id: order.id,
    state: nextState,
    quantity,
    unit_cost: unitCost,
    value: round2(postedValue),
    stock_move_id: move.id,
    finance_document_id: move.accounting?.finance_document_id || null,
    backflushed_materials: backflushed.length,
    by_product_credit: byProductCredit,
    wip_balance_before: wipBefore.balance,
    wip_balance_after: wipAfter.balance,
  };
}

/**
 * By-products leave WIP at a configured value before the finished-goods share is
 * computed, so the main product does not absorb their cost.
 */
function postByProducts(db, payload, order, mapping, companyId, actor) {
  const byProducts = Array.isArray(payload.by_products) ? payload.by_products : [];
  let total = 0;
  for (const byProduct of byProducts) {
    const quantity = positive(byProduct.quantity, 'by-product quantity');
    const unitCost = Number(byProduct.unit_cost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new ManufacturingError('a by-product requires a non-negative unit_cost', 'INPUT_INVALID');
    }
    const uomId = byProduct.uom_id
      || db.prepare('SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(byProduct.product_id)?.uom_id;
    const move = executeStockOperation(db, {
      company_id: companyId,
      branch_id: order.branch_id || null,
      actor,
      tenant_id: payload.tenant_id || null,
      reference: `${order.reference}/BYPROD`,
      product_id: byProduct.product_id,
      uom_id: uomId,
      product_qty: quantity,
      location_id: order.production_location_id,
      location_dest_id: byProduct.location_dest_id || order.finished_location_id,
      unit_cost: unitCost,
      source_document_type: 'production_order',
      source_document_id: order.id,
      source_line_id: `${order.id}:byproduct:${byProduct.product_id}`,
      idempotency_key: `mo-byproduct:${order.id}:${byProduct.product_id}:${quantity}`,
    });
    const value = Math.abs(Number(move.total_value || 0));
    db.prepare(`
      INSERT INTO production_outputs (
        id, company_id, order_id, stock_move_id, output_type, product_id, quantity,
        unit_cost, value, finance_document_id, quality_inspection_id, created_at
      ) VALUES (?, ?, ?, ?, 'by_product', ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      makeId('mout'), companyId, order.id, move.id, byProduct.product_id, quantity,
      unitCost, round2(value), move.accounting?.finance_document_id || null, nowIso(),
    );
    recordCostFact(db, {
      companyId, orderId: order.id, costType: 'by_product_credit', direction: 'credit_wip',
      amount: value, quantity, financeDocumentId: move.accounting?.finance_document_id || null,
      sourceReference: move.id, projectId: order.project_id || null,
    });
    total = round2(total + value);
  }
  return total;
}

/**
 * Clear a residual WIP balance on an order that will produce nothing further.
 * The residual is a real manufacturing variance and is posted as one, to the
 * configured variance account — never quietly left on the balance sheet.
 */
export function postProductionVariance(db, payload = {}) {
  const companyId = requireCompany(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  const mapping = requireAccountMapping(db, companyId);
  if (!mapping.variance_account_id) {
    throw new ManufacturingError('variance_account_id is not configured for this company', 'MANUFACTURING_ACCOUNT_MAPPING_MISSING');
  }
  const wip = getWipBalance(db, companyId, order.id);
  const amount = round2(Math.abs(wip.balance));
  if (!(amount > 0.005)) {
    return { order_id: order.id, posted: false, wip_balance: wip.balance };
  }
  const favourable = wip.balance < 0;
  const lines = favourable
    ? [
      { account_id: mapping.wip_account_id, debit: amount, credit: 0, description: `production_variance:${order.reference}` },
      { account_id: mapping.variance_account_id, debit: 0, credit: amount, description: `production_variance:${order.reference}` },
    ]
    : [
      { account_id: mapping.variance_account_id, debit: amount, credit: 0, description: `production_variance:${order.reference}` },
      { account_id: mapping.wip_account_id, debit: 0, credit: amount, description: `production_variance:${order.reference}` },
    ];
  const posted = postSourceFact(db, financeContext(payload), {
    fact_type: 'manufacturing_wip_posting',
    source_id: `${order.id}:variance:${nowIso()}`,
    doc_date: nowIso().slice(0, 10),
    currency: payload.currency || 'IQD',
    lines,
  });
  recordCostFact(db, {
    companyId, orderId: order.id, costType: 'variance',
    direction: favourable ? 'debit_wip' : 'credit_wip', amount,
    financeDocumentId: posted.document_id, sourceReference: order.id,
    projectId: order.project_id || null,
  });
  return {
    order_id: order.id,
    posted: true,
    amount,
    favourable,
    finance_document_id: posted.document_id,
    wip_balance: getWipBalance(db, companyId, order.id).balance,
  };
}

export function getProductionCostSummary(db, companyId, orderId) {
  const order = getProductionOrder(db, orderId, companyId);
  const rows = db.prepare(`
    SELECT cost_type, direction, SUM(amount) AS amount
    FROM production_cost_facts WHERE company_id = ? AND order_id = ?
    GROUP BY cost_type, direction
  `).all(companyId, orderId);
  const byType = {};
  for (const row of rows) {
    const signed = row.direction === 'debit_wip' ? Number(row.amount) : -Number(row.amount);
    byType[row.cost_type] = round2((byType[row.cost_type] || 0) + signed);
  }
  const produced = Number(order.completed_quantity);
  return {
    order_id: orderId,
    reference: order.reference,
    state: order.state,
    planned_quantity: Number(order.planned_quantity),
    completed_quantity: produced,
    cost_by_type: byType,
    wip: order.wip,
    unit_cost: produced > 0 ? round6(Math.abs(byType.finished_goods || 0) / produced) : 0,
  };
}
