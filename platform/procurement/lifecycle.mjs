// Checkpoint C2 procurement lifecycle.
//
// These handlers extend the existing canonical purchase, Inventory, Finance,
// audit, and outbox authorities. They execute inside ActionExecutor's single
// transaction and never create a parallel supplier, stock, or AP authority.

import crypto from 'node:crypto';
import { createPicking } from '../wms/operations.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { getProductValuation } from '../inventory/valuation.mjs';
import { postSourceFact } from '../finance/engine.mjs';
import { createRequisition, getRequisition } from './governance.mjs';
import { getPurchaseOrder } from './orders.mjs';

class ProcurementError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ProcurementError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProcurementError(message, code);
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function financeContext(input) {
  return {
    companyId: input.company_id,
    branchId: input.branch_id || null,
    userId: input.actor || 'system',
    now: new Date().toISOString(),
  };
}

function resolveWarehouse(db, warehouseId, companyId, branchId) {
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ? AND company_id = ?').get(warehouseId, companyId);
  if (!warehouse) fail(`Warehouse not found: ${warehouseId}`, 'WAREHOUSE_NOT_FOUND');
  if (branchId && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouseId, companyId, branchId)) {
    fail('Procurement warehouse is outside the active branch scope', 'BRANCH_SCOPE_DENIED');
  }
  return warehouse;
}

function resolveSupplierLocation(db, companyId) {
  let location = db.prepare(`
    SELECT id FROM stock_locations
    WHERE usage = 'supplier' AND (company_id = ? OR company_id = '*')
    ORDER BY CASE WHEN company_id = ? THEN 0 ELSE 1 END LIMIT 1
  `).get(companyId, companyId);
  if (!location) {
    const id = makeId('loc_supp');
    db.prepare(`
      INSERT INTO stock_locations (id, company_id, name, complete_name, usage, created_at)
      VALUES (?, ?, 'Suppliers', 'Suppliers', 'supplier', ?)
    `).run(id, companyId, new Date().toISOString());
    location = { id };
  }
  return location;
}

function ensurePickingType(db, companyId, warehouseId, code, name) {
  let type = db.prepare('SELECT id FROM stock_picking_types WHERE warehouse_id = ? AND code = ?').get(warehouseId, code);
  if (!type) {
    const id = `pt_${code === 'incoming' ? 'in' : 'out'}_${warehouseId}`;
    db.prepare(`
      INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, companyId, warehouseId, name, code, new Date().toISOString());
    type = { id };
  }
  return type;
}

export function getPurchaseRequest(db, id) {
  const request = db.prepare('SELECT * FROM purchase_requests WHERE id = ?').get(id);
  if (!request) return null;
  let attachments = [];
  try { attachments = JSON.parse(request.attachments || '[]'); } catch (_) {}
  return {
    ...request,
    attachments,
    lines: db.prepare('SELECT * FROM purchase_request_lines WHERE request_id = ? ORDER BY created_at, id').all(id),
  };
}

export function createPurchaseRequest(db, input) {
  const {
    name,
    lines = [],
    needed_by = null,
    justification = '',
    comments = '',
    attachments = [],
    company_id,
    branch_id = null,
    actor,
  } = input;
  if (!String(name || '').trim()) fail('Purchase request name is required', 'PURCHASE_REQUEST_NAME_REQUIRED');
  if (!Array.isArray(lines) || !lines.length) fail('Purchase request lines are required', 'PURCHASE_REQUEST_LINES_REQUIRED');
  const id = makeId('preq');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO purchase_requests (
      id, company_id, branch_id, name, requested_by, state, needed_by,
      justification, comments, attachments, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, branch_id, String(name).trim(), actor, needed_by, justification, comments, JSON.stringify(attachments || []), now, now);
  const insertLine = db.prepare(`
    INSERT INTO purchase_request_lines (
      id, request_id, product_id, quantity, uom_id, estimated_unit_cost,
      quality_required, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of lines) {
    const product = db.prepare(`
      SELECT variant.id, template.uom_id
      FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      WHERE variant.id = ? AND variant.company_id = ?
    `).get(line.product_id, company_id);
    if (!product) fail(`Purchase request product not found: ${line.product_id}`, 'PRODUCT_NOT_FOUND');
    const quantity = Number(line.quantity || line.qty);
    if (!(quantity > 0)) fail('Purchase request quantity must be positive', 'PURCHASE_REQUEST_QTY_INVALID');
    insertLine.run(
      makeId('preql'),
      id,
      product.id,
      quantity,
      line.uom_id || product.uom_id,
      Number(line.estimated_unit_cost || 0),
      line.quality_required ? 1 : 0,
      String(line.notes || ''),
      now,
    );
  }
  return getPurchaseRequest(db, id);
}

export function submitPurchaseRequest(db, { request_id, company_id }) {
  const request = getPurchaseRequest(db, request_id);
  if (!request || request.company_id !== company_id) fail(`Purchase request not found: ${request_id}`, 'PURCHASE_REQUEST_NOT_FOUND');
  if (request.state !== 'draft') fail('Only draft purchase requests can be submitted', 'PURCHASE_REQUEST_STATE_INVALID');
  db.prepare("UPDATE purchase_requests SET state = 'submitted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), request_id);
  return getPurchaseRequest(db, request_id);
}

export function approvePurchaseRequest(db, input) {
  const { request_id, company_id, actor } = input;
  const request = getPurchaseRequest(db, request_id);
  if (!request || request.company_id !== company_id) fail(`Purchase request not found: ${request_id}`, 'PURCHASE_REQUEST_NOT_FOUND');
  if (request.state !== 'submitted') fail('Only submitted purchase requests can be approved', 'PURCHASE_REQUEST_STATE_INVALID');
  const requisition = createRequisition(db, {
    company_id,
    name: `REQ/${request.name}`,
    requested_by: request.requested_by || actor,
    source_request_id: request.id,
    needed_by: request.needed_by,
    notes: request.comments || request.justification,
    attachments: request.attachments,
    lines: request.lines.map((line) => ({
      product_id: line.product_id,
      qty: line.quantity,
      uom_id: line.uom_id,
      estimated_unit_cost: line.estimated_unit_cost,
      quality_required: line.quality_required,
    })),
  });
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE purchase_requests
    SET state = 'converted', approved_by = ?, approved_at = ?,
        requisition_id = ?, updated_at = ?
    WHERE id = ?
  `).run(actor, now, requisition.id, now, request.id);
  return { request: getPurchaseRequest(db, request.id), requisition: getRequisition(db, requisition.id) };
}

export function postPurchaseReceipt(db, input) {
  const {
    purchase_order_id,
    picking_id = null,
    lines = [],
    company_id,
    branch_id = null,
    actor,
    idempotency_key,
  } = input;
  const order = getPurchaseOrder(db, purchase_order_id);
  if (!order || order.company_id !== company_id) fail(`Purchase order not found: ${purchase_order_id}`, 'PURCHASE_ORDER_NOT_FOUND');
  if (order.state !== 'purchase') fail('Only confirmed purchase orders can be received', 'PURCHASE_ORDER_NOT_CONFIRMED');
  if (!Array.isArray(lines) || !lines.length) fail('Receipt lines are required', 'PURCHASE_RECEIPT_LINES_REQUIRED');
  const picking = db.prepare(`
    SELECT DISTINCT p.*
    FROM stock_pickings p
    JOIN purchase_fulfilment_demands d ON d.picking_id = p.id
    WHERE d.purchase_order_id = ? AND p.company_id = ?
      AND p.state NOT IN ('done','cancelled')
      AND (? IS NULL OR p.id = ?)
    ORDER BY p.created_at, p.id LIMIT 1
  `).get(order.id, company_id, picking_id, picking_id);
  if (!picking) fail('No open receipt exists for this purchase order', 'PURCHASE_RECEIPT_NOT_FOUND');

  const received = {};
  const moves = [];
  const qualityFacts = [];
  const seen = new Set();
  for (const [index, requested] of lines.entries()) {
    const orderLine = order.lines.find((line) => line.id === requested.purchase_order_line_id);
    if (!orderLine) fail(`Receipt line is outside the purchase order: ${requested.purchase_order_line_id}`, 'PURCHASE_RECEIPT_LINE_NOT_FOUND');
    if (seen.has(orderLine.id)) fail(`Duplicate receipt line: ${orderLine.id}`, 'PURCHASE_RECEIPT_LINE_DUPLICATE');
    seen.add(orderLine.id);
    const inspected = Number(requested.quantity);
    const accepted = Number(requested.accepted_quantity ?? inspected);
    const rejected = Number(requested.rejected_quantity || 0);
    const remaining = Number(orderLine.product_qty) - Number(orderLine.received_quantity || 0);
    if (!(inspected > 0) || accepted < 0 || rejected < 0 || Math.abs(accepted + rejected - inspected) > 0.0000001 || accepted > remaining + 0.0000001) {
      fail(`Receipt quantities are invalid for line ${orderLine.id}`, 'PURCHASE_RECEIPT_QTY_INVALID');
    }
    if (accepted > 0) {
      const move = executeStockOperation(db, {
        company_id,
        branch_id,
        actor,
        reference: picking.reference,
        product_id: orderLine.product_id,
        uom_id: orderLine.product_uom,
        product_qty: accepted,
        location_id: picking.location_id,
        location_dest_id: picking.location_dest_id,
        unit_cost: Number(orderLine.price_unit),
        source_document_type: 'purchase_order',
        source_document_id: order.id,
        source_line_id: orderLine.id,
        idempotency_key: `${idempotency_key}:move:${index}`,
      });
      moves.push(move);
    }
    received[orderLine.id] = accepted;
    qualityFacts.push({
      orderLine,
      inspected,
      accepted,
      rejected,
      status: rejected > 0 ? 'failed' : 'passed',
      notes: String(requested.quality_notes || ''),
    });
  }

  const remainingLines = order.lines.map((line) => {
    const current = db.prepare(`
      SELECT received_quantity FROM purchase_order_line_fulfilment
      WHERE purchase_order_line_id = ?
    `).get(line.id);
    return {
      purchase_order_line_id: line.id,
      remaining_quantity: Math.max(0, Number(line.product_qty) - Number(current?.received_quantity || 0)),
    };
  }).filter((line) => line.remaining_quantity > 0.0000001);

  db.prepare("UPDATE stock_pickings SET state = 'done' WHERE id = ?").run(picking.id);
  let backorder = null;
  if (remainingLines.length) {
    backorder = createPicking(db, {
      company_id,
      picking_type_id: picking.picking_type_id,
      reference: `${picking.reference}/BO-${Date.now().toString().slice(-6)}`,
      origin: picking.origin,
      location_id: picking.location_id,
      location_dest_id: picking.location_dest_id,
      partner_id: picking.partner_id,
      scheduled_date: picking.scheduled_date,
    });
    for (const line of remainingLines) {
      db.prepare(`
        UPDATE purchase_fulfilment_demands
        SET picking_id = ?, status = 'backorder'
        WHERE purchase_order_id = ? AND purchase_order_line_id = ?
      `).run(backorder.id, order.id, line.purchase_order_line_id);
    }
  } else {
    db.prepare("UPDATE purchase_fulfilment_demands SET status = 'received' WHERE purchase_order_id = ?").run(order.id);
  }

  const eventId = makeId('prec');
  const now = new Date().toISOString();
  const qualityHold = qualityFacts.some((line) => line.status === 'failed');
  db.prepare(`
    INSERT INTO purchase_receipt_events (
      id, company_id, purchase_order_id, picking_id, backorder_picking_id,
      state, received_quantities, actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    company_id,
    order.id,
    picking.id,
    backorder?.id || null,
    qualityHold ? 'quality_hold' : backorder ? 'partial' : 'received',
    JSON.stringify(received),
    actor,
    now,
  );
  const insertQuality = db.prepare(`
    INSERT INTO purchase_quality_checks (
      id, company_id, receipt_event_id, purchase_order_line_id,
      inspected_quantity, accepted_quantity, rejected_quantity,
      status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const fact of qualityFacts) {
    if (order.quality_required || fact.rejected > 0) {
      insertQuality.run(
        makeId('pqc'),
        company_id,
        eventId,
        fact.orderLine.id,
        fact.inspected,
        fact.accepted,
        fact.rejected,
        fact.status,
        fact.notes,
        now,
      );
    }
  }
  return {
    receipt_event: db.prepare('SELECT * FROM purchase_receipt_events WHERE id = ?').get(eventId),
    picking: db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(picking.id),
    backorder,
    remaining_lines: remainingLines,
    quality_checks: db.prepare('SELECT * FROM purchase_quality_checks WHERE receipt_event_id = ?').all(eventId),
    moves,
  };
}

export function createPurchaseReturn(db, input) {
  const {
    purchase_order_id,
    warehouse_id,
    lines = [],
    reason = '',
    company_id,
    branch_id = null,
    actor,
    idempotency_key,
  } = input;
  const order = getPurchaseOrder(db, purchase_order_id);
  if (!order || order.company_id !== company_id) fail(`Purchase order not found: ${purchase_order_id}`, 'PURCHASE_ORDER_NOT_FOUND');
  if (order.state !== 'purchase') fail('Purchase returns require a confirmed purchase order', 'PURCHASE_ORDER_NOT_CONFIRMED');
  if (!Array.isArray(lines) || !lines.length) fail('Purchase return lines are required', 'PURCHASE_RETURN_LINES_REQUIRED');
  const warehouse = resolveWarehouse(db, warehouse_id, company_id, branch_id);
  const supplierLocation = resolveSupplierLocation(db, company_id);
  const pickingType = ensurePickingType(db, company_id, warehouse.id, 'outgoing', 'Outgoing Deliveries');
  const returnLines = lines.map((line) => {
    const orderLine = order.lines.find((candidate) => candidate.id === line.purchase_order_line_id);
    if (!orderLine) fail(`Purchase return line is outside the purchase order: ${line.purchase_order_line_id}`, 'PURCHASE_RETURN_LINE_NOT_FOUND');
    const quantity = Number(line.quantity);
    const returned = db.prepare(`
      SELECT COALESCE(SUM(prl.quantity), 0) AS quantity
      FROM purchase_return_lines prl
      JOIN purchase_returns pr ON pr.id = prl.purchase_return_id
      WHERE prl.purchase_order_line_id = ? AND pr.state = 'done'
    `).get(orderLine.id);
    const returnable = Number(orderLine.received_quantity || 0) - Number(returned.quantity || 0);
    if (!(quantity > 0) || quantity > returnable + 0.0000001) {
      fail(`Purchase return quantity exceeds received quantity for line ${orderLine.id}`, 'PURCHASE_RETURN_QTY_INVALID');
    }
    return { orderLine, quantity };
  });
  const picking = createPicking(db, {
    company_id,
    picking_type_id: pickingType.id,
    reference: `PRET/${order.name}`,
    origin: order.name,
    location_id: warehouse.lot_stock_id,
    location_dest_id: supplierLocation.id,
    partner_id: order.supplier_id,
  });
  const returnId = makeId('pret');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO purchase_returns (
      id, company_id, purchase_order_id, picking_id, debit_note_request_id,
      reason, state, actor, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'done', ?, ?)
  `).run(returnId, company_id, order.id, picking.id, reason || 'supplier return', actor, now);
  const inserted = [];
  for (const [index, item] of returnLines.entries()) {
    const valuation = getProductValuation(db, { company_id, product_id: item.orderLine.product_id });
    const unitCost = valuation && Number(valuation.on_hand_qty) > 0
      ? Number(valuation.total_valuation) / Number(valuation.on_hand_qty)
      : Number(item.orderLine.price_unit);
    const move = executeStockOperation(db, {
      company_id,
      branch_id,
      actor,
      reference: picking.reference,
      product_id: item.orderLine.product_id,
      uom_id: item.orderLine.product_uom,
      product_qty: item.quantity,
      location_id: warehouse.lot_stock_id,
      location_dest_id: supplierLocation.id,
      unit_cost: unitCost,
      source_document_type: 'purchase_return',
      source_document_id: returnId,
      source_line_id: item.orderLine.id,
      idempotency_key: `${idempotency_key}:move:${index}`,
    });
    const id = makeId('pretl');
    db.prepare(`
      INSERT INTO purchase_return_lines (
        id, purchase_return_id, company_id, purchase_order_line_id,
        product_id, quantity, stock_move_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, returnId, company_id, item.orderLine.id, item.orderLine.product_id, item.quantity, move.id, now);
    inserted.push({ id, purchase_order_line_id: item.orderLine.id, product_id: item.orderLine.product_id, quantity: item.quantity, stock_move_id: move.id });
  }
  db.prepare("UPDATE stock_pickings SET state = 'done' WHERE id = ?").run(picking.id);

  let debitNote = null;
  const bill = db.prepare(`
    SELECT * FROM commercial_fiscal_requests
    WHERE company_id = ? AND request_type = 'supplier_bill'
      AND source_document_id = ? AND status = 'posted'
  `).get(company_id, order.id);
  if (bill?.finance_document_id) {
    const payable = db.prepare(`
      SELECT id FROM finance_accounts
      WHERE company_id = ? AND code = '201000' AND is_active = 1
    `).get(company_id);
    if (!payable) fail('Canonical payable account is missing', 'PAYABLE_ACCOUNT_MISSING');
    const creditLines = returnLines.map((item) => {
      const mapping = db.prepare(`
        SELECT category.stock_input_account_id, category.expense_account_id, template.type
        FROM product_variants variant
        JOIN product_templates template ON template.id = variant.template_id
        JOIN product_categories category ON category.id = template.category_id
        WHERE variant.id = ? AND variant.company_id = ?
      `).get(item.orderLine.product_id, company_id);
      const accountId = mapping?.type === 'service' ? mapping.expense_account_id : mapping?.stock_input_account_id;
      if (!accountId) fail(`Procurement account mapping is required for ${item.orderLine.product_id}`, 'PROCUREMENT_ACCOUNT_MISSING');
      return {
        account_id: accountId,
        debit: 0,
        credit: item.quantity * Number(item.orderLine.price_unit),
        source_line_id: item.orderLine.id,
        product_id: item.orderLine.product_id,
        quantity: item.quantity,
        description: `${order.name}:supplier-return`,
      };
    });
    const total = creditLines.reduce((sum, line) => sum + line.credit, 0);
    const posted = postSourceFact(db, financeContext(input), {
      fact_type: 'supplier_credit_posting',
      move_type: 'supplier_credit_note',
      source_document_type: 'purchase_return',
      source_id: returnId,
      original_document_id: bill.finance_document_id,
      doc_date: now.slice(0, 10),
      partner_id: order.supplier_id,
      currency: order.currency_id,
      lines: [
        { account_id: payable.id, debit: total, credit: 0, partner_id: order.supplier_id, description: `${order.name}:supplier-return` },
        ...creditLines,
      ],
    });
    const requestId = makeId('dbn_req');
    db.prepare(`
      INSERT INTO commercial_fiscal_requests (
        id, company_id, request_type, source_document_type, source_document_id,
        idempotency_key, finance_document_id, status, request_payload,
        created_at, updated_at
      ) VALUES (?, ?, 'supplier_debit_note', 'purchase_return', ?, ?, ?, 'posted', ?, ?, ?)
    `).run(requestId, company_id, returnId, `${idempotency_key}:debit_note`, posted.document_id, JSON.stringify({ purchase_return_id: returnId, purchase_order_id: order.id, amount_total: total, lines: creditLines }), now, now);
    db.prepare('UPDATE purchase_returns SET debit_note_request_id = ? WHERE id = ?').run(requestId, returnId);
    debitNote = { debit_note_request_id: requestId, finance_document_id: posted.document_id, amount_total: total };
  }
  return {
    purchase_return: db.prepare('SELECT * FROM purchase_returns WHERE id = ?').get(returnId),
    lines: inserted,
    picking_id: picking.id,
    debit_note: debitNote,
  };
}

export function recordSupplierScore(db, input) {
  const { supplier_id, purchase_order_id = null, notes = '', company_id } = input;
  const supplier = db.prepare(`
    SELECT p.id FROM parties p JOIN party_roles r ON r.party_id = p.id
    WHERE p.id = ? AND p.company_id = ? AND r.company_id = ? AND r.role = 'supplier'
  `).get(supplier_id, company_id, company_id);
  if (!supplier) fail(`Supplier not found: ${supplier_id}`, 'SUPPLIER_NOT_FOUND');
  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT po.id) AS orders,
      COUNT(DISTINCT CASE WHEN m.match_status = 'matched' THEN m.id END) AS clean_matches,
      COUNT(DISTINCT m.id) AS matches,
      COALESCE(SUM(q.accepted_quantity), 0) AS accepted,
      COALESCE(SUM(q.rejected_quantity), 0) AS rejected
    FROM purchase_orders po
    LEFT JOIN three_way_matches m ON m.purchase_order_id = po.id
    LEFT JOIN purchase_receipt_events e ON e.purchase_order_id = po.id
    LEFT JOIN purchase_quality_checks q ON q.receipt_event_id = e.id
    WHERE po.company_id = ? AND po.supplier_id = ?
  `).get(company_id, supplier_id);
  const qualityBase = Number(stats.accepted || 0) + Number(stats.rejected || 0);
  const quality = qualityBase ? 100 * Number(stats.accepted) / qualityBase : 100;
  const price = Number(stats.matches) ? 100 * Number(stats.clean_matches) / Number(stats.matches) : 100;
  const onTime = Number(input.on_time_score ?? 100);
  if (!Number.isFinite(onTime) || onTime < 0 || onTime > 100) {
    fail('On-time supplier score must be between 0 and 100', 'SUPPLIER_SCORE_INVALID');
  }
  const overall = (onTime + quality + price) / 3;
  const id = makeId('sscore');
  db.prepare(`
    INSERT INTO supplier_scorecards (
      id, company_id, supplier_id, purchase_order_id, on_time_score,
      quality_score, price_score, overall_score, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, company_id, supplier_id, purchase_order_id, onTime, quality, price, overall, notes, new Date().toISOString());
  return db.prepare('SELECT * FROM supplier_scorecards WHERE id = ?').get(id);
}
