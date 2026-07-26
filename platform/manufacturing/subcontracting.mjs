// Subcontract manufacturing.
//
// The one rule that makes this correct: **supplied components never leave this
// company's balance sheet.** Sending them to a subcontractor is a
// reclassification (Dr Goods at Subcontractor / Cr Inventory), not a sale and
// not an expense. They come back, are consumed into WIP, or are scrapped — and
// until one of those happens they are still an asset here.
//
// Quantity authority stays with the Phase 04 stock engine: the subcontractor's
// site is a `subcontractor`-usage stock location, so on-hand at the
// subcontractor is a real, queryable balance rather than a note in a field.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round2, round6, scopedRow, assertState, financeContext,
} from './shared.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { requireAccountMapping } from './config.mjs';
import { recordCostFact } from './materials.mjs';

const ACTIVE_ORDER_STATES = ['released', 'in_progress', 'partially_completed'];

/**
 * One stock location per subcontractor per company, created on demand. Its
 * `usage` is `subcontractor`, which is what routes the accounting to the
 * "goods held by third party" account instead of an expense.
 */
export function ensureSubcontractorLocation(db, companyId, partyId) {
  const party = db.prepare('SELECT id, name, company_id FROM parties WHERE id = ?').get(partyId);
  if (!party) throw new ManufacturingError(`subcontractor not found: ${partyId}`, 'RECORD_NOT_FOUND', 404);
  if (party.company_id && party.company_id !== companyId) {
    throw new ManufacturingError('subcontractor is outside the active company', 'COMPANY_SCOPE_VIOLATION', 403);
  }
  const completeName = `SUBCON/${partyId}`;
  const existing = db.prepare(
    "SELECT * FROM stock_locations WHERE company_id = ? AND usage = 'subcontractor' AND complete_name = ?",
  ).get(companyId, completeName);
  if (existing) return existing;

  const id = makeId('loc_sub');
  db.prepare(`
    INSERT INTO stock_locations (
      id, company_id, warehouse_id, parent_id, name, complete_name, usage, is_scrap, created_at
    ) VALUES (?, ?, NULL, NULL, ?, ?, 'subcontractor', 0, ?)
  `).run(id, companyId, `Subcontractor ${party.name || partyId}`, completeName, nowIso());
  return db.prepare('SELECT * FROM stock_locations WHERE id = ?').get(id);
}

function loadSubcontractOperation(db, companyId, orderOperationId) {
  const operation = scopedRow(db, 'production_order_operations', orderOperationId, companyId, 'order operation');
  if (!Number(operation.is_subcontracted)) {
    throw new ManufacturingError('this operation is not marked as subcontracted', 'SUBCONTRACT_OPERATION_INVALID');
  }
  if (!operation.subcontractor_party_id) {
    throw new ManufacturingError('the subcontracted operation has no supplier', 'SUBCONTRACT_SUPPLIER_MISSING');
  }
  return operation;
}

export function transferComponentsToSubcontractor(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ACTIVE_ORDER_STATES, 'manufacturing order');
  const mapping = requireAccountMapping(db, companyId);
  if (!mapping.subcontract_stock_account_id) {
    throw new ManufacturingError(
      'subcontract_stock_account_id is not configured for this company',
      'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
    );
  }
  const operation = loadSubcontractOperation(db, companyId, payload.order_operation_id);
  const quantity = positive(payload.quantity, 'transfer quantity');

  const material = db.prepare(
    'SELECT * FROM production_order_materials WHERE order_id = ? AND product_id = ? ORDER BY created_at LIMIT 1',
  ).get(order.id, payload.product_id);
  if (!material) {
    throw new ManufacturingError(
      `product ${payload.product_id} is not a requirement of ${order.reference}`,
      'MATERIAL_NOT_REQUIRED',
    );
  }

  const location = ensureSubcontractorLocation(db, companyId, operation.subcontractor_party_id);
  const uomId = material.uom_id
    || db.prepare('SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?').get(payload.product_id)?.uom_id;

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/SUBCON-OUT`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: payload.location_id || order.source_location_id,
    location_dest_id: location.id,
    source_document_type: 'production_order',
    source_document_id: order.id,
    source_line_id: material.bom_path,
    idempotency_key: payload.stock_idempotency_key || `subcon-out:${order.id}:${material.id}:${quantity}`,
  });

  const value = Math.abs(Number(move.total_value || 0));
  db.prepare(`
    INSERT INTO production_material_consumptions (
      id, company_id, order_id, order_material_id, work_order_id, stock_move_id,
      movement_type, product_id, quantity, value, finance_document_id, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'subcontract_transfer', ?, ?, ?, ?, ?)
  `).run(
    makeId('mmc'), companyId, order.id, material.id, move.id,
    payload.product_id, quantity, round2(value),
    move.accounting?.finance_document_id || null, nowIso(),
  );

  db.prepare(`
    INSERT INTO subcontract_holdings (
      id, company_id, order_id, order_operation_id, subcontractor_party_id, product_id,
      location_id, transferred_quantity, consumed_quantity, returned_quantity,
      scrapped_quantity, value, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
    ON CONFLICT(company_id, order_id, order_operation_id, product_id) DO UPDATE SET
      transferred_quantity = transferred_quantity + excluded.transferred_quantity,
      value = value + excluded.value,
      updated_at = excluded.updated_at
  `).run(
    makeId('subh'), companyId, order.id, operation.id, operation.subcontractor_party_id,
    payload.product_id, location.id, quantity, round2(value), nowIso(), nowIso(),
  );

  return {
    order_id: order.id,
    order_operation_id: operation.id,
    subcontractor_party_id: operation.subcontractor_party_id,
    location_id: location.id,
    stock_move_id: move.id,
    quantity,
    value: round2(value),
    finance_document_id: move.accounting?.finance_document_id || null,
    ownership: 'retained_by_this_company',
  };
}

export function returnComponentsFromSubcontractor(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ACTIVE_ORDER_STATES, 'manufacturing order');
  requireAccountMapping(db, companyId);
  const quantity = positive(payload.quantity, 'return quantity');

  const holding = db.prepare(`
    SELECT * FROM subcontract_holdings
    WHERE company_id = ? AND order_id = ? AND order_operation_id = ? AND product_id = ?
  `).get(companyId, order.id, payload.order_operation_id, payload.product_id);
  if (!holding) throw new ManufacturingError('no components are held by this subcontractor', 'SUBCONTRACT_HOLDING_MISSING');

  const outstanding = round6(
    Number(holding.transferred_quantity) - Number(holding.consumed_quantity)
    - Number(holding.returned_quantity) - Number(holding.scrapped_quantity),
  );
  if (quantity - outstanding > 0.0000001) {
    throw new ManufacturingError(
      `cannot return ${quantity}; the subcontractor holds only ${outstanding}`,
      'SUBCONTRACT_QUANTITY_EXCEEDED',
    );
  }

  const unitCost = round6(Number(holding.value) / Math.max(Number(holding.transferred_quantity), 1));
  const uomId = db.prepare(
    'SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?',
  ).get(payload.product_id)?.uom_id;

  const move = executeStockOperation(db, {
    company_id: companyId,
    branch_id: order.branch_id || null,
    actor,
    tenant_id: payload.tenant_id || null,
    reference: `${order.reference}/SUBCON-RET`,
    product_id: payload.product_id,
    uom_id: uomId,
    product_qty: quantity,
    location_id: holding.location_id,
    location_dest_id: payload.location_dest_id || order.source_location_id,
    unit_cost: unitCost,
    source_document_type: 'production_order',
    source_document_id: order.id,
    idempotency_key: payload.stock_idempotency_key || `subcon-ret:${order.id}:${holding.id}:${quantity}`,
  });

  db.prepare(`
    UPDATE subcontract_holdings SET returned_quantity = returned_quantity + ?, updated_at = ? WHERE id = ?
  `).run(quantity, nowIso(), holding.id);

  return {
    order_id: order.id,
    stock_move_id: move.id,
    quantity,
    value: round2(Math.abs(Number(move.total_value || 0))),
    finance_document_id: move.accounting?.finance_document_id || null,
    outstanding_at_subcontractor: round6(outstanding - quantity),
  };
}

/**
 * Receive the subcontracted result.
 *
 * Three things happen atomically:
 *   1. supplied components held at the subcontractor are consumed into WIP
 *      (Dr WIP / Cr Goods at Subcontractor);
 *   2. the subcontract service charge is added to WIP
 *      (Dr WIP / Cr subcontract expense — the supplier bill clears that
 *      account through the ordinary Phase 04 three-way-match path);
 *   3. the processed item is received back into WIP as quantity.
 */
export function receiveSubcontractOutput(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const order = scopedRow(db, 'production_orders', payload.order_id, companyId, 'manufacturing order');
  assertState(order.state, ACTIVE_ORDER_STATES, 'manufacturing order');
  const mapping = requireAccountMapping(db, companyId);
  const operation = loadSubcontractOperation(db, companyId, payload.order_operation_id);
  const quantity = positive(payload.quantity, 'received quantity');
  const serviceCharge = Number(payload.service_charge || 0);
  if (!Number.isFinite(serviceCharge) || serviceCharge < 0) {
    throw new ManufacturingError('service_charge must not be negative', 'INPUT_INVALID');
  }

  const holdings = db.prepare(`
    SELECT * FROM subcontract_holdings
    WHERE company_id = ? AND order_id = ? AND order_operation_id = ?
  `).all(companyId, order.id, operation.id);

  const consumptions = Array.isArray(payload.consumed_components) ? payload.consumed_components : [];
  let consumedValue = 0;
  for (const consumption of consumptions) {
    const holding = holdings.find((row) => row.product_id === consumption.product_id);
    if (!holding) {
      throw new ManufacturingError(
        `component ${consumption.product_id} was never transferred to this subcontractor`,
        'SUBCONTRACT_HOLDING_MISSING',
      );
    }
    const consumedQuantity = positive(consumption.quantity, 'consumed component quantity');
    const outstanding = round6(
      Number(holding.transferred_quantity) - Number(holding.consumed_quantity)
      - Number(holding.returned_quantity) - Number(holding.scrapped_quantity),
    );
    if (consumedQuantity - outstanding > 0.0000001) {
      throw new ManufacturingError(
        `cannot consume ${consumedQuantity} of ${consumption.product_id}; only ${outstanding} is held`,
        'SUBCONTRACT_QUANTITY_EXCEEDED',
      );
    }
    const unitCost = round6(Number(holding.value) / Math.max(Number(holding.transferred_quantity), 1));
    const uomId = db.prepare(
      'SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?',
    ).get(consumption.product_id)?.uom_id;

    const move = executeStockOperation(db, {
      company_id: companyId,
      branch_id: order.branch_id || null,
      actor,
      tenant_id: payload.tenant_id || null,
      reference: `${order.reference}/SUBCON-USE`,
      product_id: consumption.product_id,
      uom_id: uomId,
      product_qty: consumedQuantity,
      location_id: holding.location_id,
      location_dest_id: order.production_location_id,
      unit_cost: unitCost,
      source_document_type: 'production_order',
      source_document_id: order.id,
      idempotency_key: `subcon-use:${order.id}:${holding.id}:${consumedQuantity}`,
    });

    // subcontractor → production crosses no internal boundary, so the stock
    // port produces no entry. The reclassification is posted explicitly here.
    const value = round2(unitCost * consumedQuantity);
    let financeDocumentId = null;
    if (value > 0) {
      const posted = postSourceFact(db, financeContext(payload), {
        fact_type: 'manufacturing_wip_posting',
        source_id: move.id,
        doc_date: nowIso().slice(0, 10),
        currency: payload.currency || 'IQD',
        lines: [
          { account_id: mapping.wip_account_id, debit: value, credit: 0, description: `subcontract_component_consumption:${order.reference}` },
          { account_id: mapping.subcontract_stock_account_id, debit: 0, credit: value, description: `subcontract_component_consumption:${order.reference}` },
        ],
      });
      financeDocumentId = posted.document_id;
      recordCostFact(db, {
        companyId, orderId: order.id, costType: 'material', direction: 'debit_wip',
        amount: value, quantity: consumedQuantity, financeDocumentId,
        sourceReference: move.id, projectId: order.project_id || null,
      });
    }
    db.prepare(`
      UPDATE subcontract_holdings SET consumed_quantity = consumed_quantity + ?, updated_at = ? WHERE id = ?
    `).run(consumedQuantity, nowIso(), holding.id);
    db.prepare(`
      INSERT INTO production_material_consumptions (
        id, company_id, order_id, order_material_id, work_order_id, stock_move_id,
        movement_type, product_id, quantity, value, finance_document_id, created_at
      ) VALUES (?, ?, ?, NULL, NULL, ?, 'issue', ?, ?, ?, ?, ?)
    `).run(
      makeId('mmc'), companyId, order.id, move.id, consumption.product_id,
      consumedQuantity, value, financeDocumentId, nowIso(),
    );
    consumedValue = round2(consumedValue + value);
  }

  let serviceDocumentId = null;
  if (serviceCharge > 0) {
    if (!mapping.subcontract_expense_account_id) {
      throw new ManufacturingError(
        'subcontract_expense_account_id is not configured for this company',
        'MANUFACTURING_ACCOUNT_MAPPING_MISSING',
      );
    }
    const posted = postSourceFact(db, financeContext(payload), {
      fact_type: 'manufacturing_wip_posting',
      source_id: `${order.id}:subcontract-service:${operation.id}:${quantity}`,
      doc_date: nowIso().slice(0, 10),
      currency: payload.currency || 'IQD',
      lines: [
        { account_id: mapping.wip_account_id, debit: round2(serviceCharge), credit: 0, description: `subcontract_service:${order.reference}` },
        { account_id: mapping.subcontract_expense_account_id, debit: 0, credit: round2(serviceCharge), description: `subcontract_service:${order.reference}` },
      ],
    });
    serviceDocumentId = posted.document_id;
    recordCostFact(db, {
      companyId, orderId: order.id, costType: 'subcontract', direction: 'debit_wip',
      amount: round2(serviceCharge), quantity, financeDocumentId: serviceDocumentId,
      sourceReference: operation.id, projectId: order.project_id || null,
    });
  }

  const receiptId = makeId('subr');
  db.prepare(`
    INSERT INTO subcontract_receipts (
      id, company_id, order_id, order_operation_id, subcontractor_party_id, quantity,
      service_charge, currency, consumed_value, service_document_id, quality_inspection_id,
      received_by, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receiptId, companyId, order.id, operation.id, operation.subcontractor_party_id,
    quantity, round2(serviceCharge), payload.currency || 'IQD', consumedValue,
    serviceDocumentId, payload.quality_inspection_id || null, actor, nowIso(),
  );

  return {
    receipt_id: receiptId,
    order_id: order.id,
    order_operation_id: operation.id,
    quantity,
    consumed_component_value: consumedValue,
    service_charge: round2(serviceCharge),
    service_document_id: serviceDocumentId,
  };
}

/**
 * Ownership proof: what this company still owns at each subcontractor, by
 * quantity and value, reconciled against the canonical stock balance in that
 * subcontractor's location. A mismatch means the two authorities disagree and
 * is reported rather than hidden.
 */
export function getSubcontractOwnershipReport(db, { company_id, order_id = null }) {
  let sql = 'SELECT * FROM subcontract_holdings WHERE company_id = ?';
  const params = [company_id];
  if (order_id) { sql += ' AND order_id = ?'; params.push(order_id); }
  const holdings = db.prepare(sql).all(...params);

  const outstandingOf = (holding) => round6(
    Number(holding.transferred_quantity) - Number(holding.consumed_quantity)
    - Number(holding.returned_quantity) - Number(holding.scrapped_quantity),
  );

  // A subcontractor location is shared by every order sent to that supplier, so
  // the canonical stock balance is compared against the sum of ALL holdings for
  // that (location, product) — not against one order's slice of it. Filtering by
  // order_id narrows what is listed, never what is reconciled.
  const allHoldings = db.prepare(
    'SELECT * FROM subcontract_holdings WHERE company_id = ?',
  ).all(company_id);
  const expectedByKey = new Map();
  for (const holding of allHoldings) {
    const key = `${holding.location_id}:${holding.product_id}`;
    expectedByKey.set(key, round6((expectedByKey.get(key) || 0) + outstandingOf(holding)));
  }

  return holdings.map((holding) => {
    const key = `${holding.location_id}:${holding.product_id}`;
    const quant = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) AS on_hand FROM stock_quants
      WHERE company_id = ? AND product_id = ? AND location_id = ?
    `).get(company_id, holding.product_id, holding.location_id);
    const stockOnHand = round6(Number(quant?.on_hand || 0));
    const expectedAtLocation = expectedByKey.get(key) || 0;
    return {
      ...holding,
      outstanding_quantity: outstandingOf(holding),
      expected_at_location: expectedAtLocation,
      stock_on_hand_at_subcontractor: stockOnHand,
      reconciled: Math.abs(stockOnHand - expectedAtLocation) < 0.000001,
      ownership: 'retained_by_this_company',
    };
  });
}
