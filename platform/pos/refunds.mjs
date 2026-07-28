import crypto from 'node:crypto';
import { postSourceFact } from '../finance/engine.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { getPosOrder } from './session.mjs';

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function recordEvent(db, payload) {
  db.prepare(`
    INSERT INTO pos_session_events (
      id, company_id, session_id, event_type, reference_type, reference_id,
      amount, details, actor, created_at
    ) VALUES (?, ?, ?, 'refund', 'pos_order', ?, ?, ?, ?, ?)
  `).run(
    makeId('posevt'), payload.company_id, payload.session_id,
    payload.refund_order_id, payload.amount, JSON.stringify(payload.details || {}),
    payload.actor, payload.created_at,
  );
}

export function refundPosOrder(db, payload) {
  const {
    company_id,
    branch_id = null,
    actor,
    session_id,
    original_order_id,
    reason,
    lines = [],
    payments = [],
    idempotency_key,
  } = payload;
  const session = db.prepare(`
    SELECT session.*, link.cash_shift_id, cashbox.gl_account_id AS cash_account_id,
      shift.status AS shift_status
    FROM pos_sessions session
    JOIN pos_session_finance_links link ON link.session_id = session.id
    JOIN finance_cash_shifts shift ON shift.id = link.cash_shift_id
    JOIN finance_cashboxes cashbox ON cashbox.id = link.cashbox_id
    WHERE session.id = ? AND session.company_id = ?
  `).get(session_id, company_id);
  if (!session || session.state !== 'opened' || session.shift_status !== 'open') {
    throw new Error('POS refund requires an open POS and cash session');
  }
  if (session.user_id !== actor) throw new Error('Only the session cashier can process a POS refund');
  const original = db.prepare(`
    SELECT * FROM pos_orders
    WHERE id = ? AND company_id = ? AND order_kind = 'sale' AND state = 'paid'
  `).get(original_order_id, company_id);
  if (!original) throw new Error('Paid original POS sale not found in active company');
  if (!String(reason || '').trim()) throw new Error('POS refund reason is required');
  if (!lines.length || !payments.length) throw new Error('POS refund requires lines and refund payments');

  const warehouseId = original.warehouse_id || session.warehouse_id;
  const warehouse = db.prepare('SELECT * FROM warehouses WHERE id = ? AND company_id = ?').get(warehouseId, company_id);
  if (!warehouse) throw new Error('Original POS warehouse is outside the active company');
  const customerLocation = db.prepare(`
    SELECT id FROM stock_locations
    WHERE company_id = ? AND usage = 'customer'
    ORDER BY created_at, id LIMIT 1
  `).get(company_id);
  if (!customerLocation) throw new Error('Canonical customer stock location is missing');

  const now = new Date().toISOString();
  const sequence = db.prepare('SELECT COUNT(*) AS n FROM pos_orders WHERE company_id = ?').get(company_id).n + 1;
  const refundOrderId = makeId('poso');
  const orderName = `POS-RET/${String(sequence).padStart(6, '0')}`;
  const receiptNumber = `RET-${new Date().getUTCFullYear()}-${String(sequence).padStart(6, '0')}`;
  db.prepare(`
    INSERT INTO pos_orders (
      id, company_id, session_id, name, partner_id, amount_total, state, created_at,
      order_kind, original_order_id, warehouse_id, cashier_id, currency_id, receipt_number
    ) VALUES (?, ?, ?, ?, ?, 0, 'draft', ?, 'refund', ?, ?, ?, ?, ?)
  `).run(
    refundOrderId, company_id, session_id, orderName, original.partner_id, now,
    original.id, warehouseId, actor, original.currency_id || 'IQD', receiptNumber,
  );

  const prepared = [];
  let amountUntaxed = 0;
  let amountTax = 0;
  for (const [index, inputLine] of lines.entries()) {
    const originalLine = db.prepare(`
      SELECT line.*, variant.name, template.uom_id, variant.standard_price
      FROM pos_order_lines line
      JOIN product_variants variant ON variant.id = line.product_id
      JOIN product_templates template ON template.id = variant.template_id
      WHERE line.id = ? AND line.pos_order_id = ?
    `).get(inputLine.original_order_line_id, original.id);
    if (!originalLine) throw new Error('POS refund line is outside the original order');
    const quantity = Number(inputLine.qty);
    if (!(quantity > 0)) throw new Error('POS refund quantity must be positive');
    const alreadyReturned = db.prepare(`
      SELECT COALESCE(SUM(line.quantity), 0) AS quantity
      FROM pos_refund_lines line
      JOIN pos_refunds refund ON refund.id = line.refund_id
      WHERE refund.original_order_id = ? AND line.original_order_line_id = ?
    `).get(original.id, originalLine.id).quantity;
    if (Number(alreadyReturned) + quantity > Number(originalLine.qty) + 0.0001) {
      throw new Error('POS refund quantity exceeds the remaining sold quantity');
    }
    const ratio = quantity / Number(originalLine.qty);
    const untaxed = round(Number(originalLine.price_subtotal || 0) * ratio);
    const tax = round(Number(originalLine.tax_amount || 0) * ratio);
    const total = round(untaxed + tax);
    const refundLineId = makeId('posol');
    db.prepare(`
      INSERT INTO pos_order_lines (
        id, pos_order_id, product_id, qty, price_unit, discount,
        price_subtotal, created_at, tax_amount, price_total, original_order_line_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      refundLineId, refundOrderId, originalLine.product_id, quantity,
      originalLine.price_unit, originalLine.discount, untaxed, now, tax, total,
      originalLine.id,
    );
    const trace = db.prepare(`
      SELECT * FROM pos_order_line_tax_traces WHERE pos_order_line_id = ?
    `).get(originalLine.id);
    db.prepare(`
      INSERT INTO pos_order_line_tax_traces (
        pos_order_line_id, company_id, tax_id, pricing_source, tax_quote, created_at
      ) VALUES (?, ?, ?, 'canonical_refund_from_original_receipt', ?, ?)
    `).run(
      refundLineId, company_id, trace?.tax_id || null,
      JSON.stringify({ original_order_line_id: originalLine.id, ratio, total_base: untaxed, total_tax: tax, total_amount: total }),
      now,
    );
    amountUntaxed = round(amountUntaxed + untaxed);
    amountTax = round(amountTax + tax);
    prepared.push({ index, inputLine, originalLine, refundLineId, quantity, ratio, untaxed, tax, total, trace });
  }
  const amountTotal = round(amountUntaxed + amountTax);
  const paymentTotal = round(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  if (Math.abs(paymentTotal - amountTotal) > 0.0001) {
    throw new Error(`POS refund payment total ${paymentTotal} does not equal refund total ${amountTotal}`);
  }

  const paymentCredits = [];
  for (const payment of payments) {
    const method = String(payment.payment_method_id || 'cash').toLowerCase();
    const accountId = method === 'cash'
      ? session.cash_account_id
      : db.prepare(`
          SELECT gl_account_id FROM pos_payment_method_configs
          WHERE company_id = ? AND payment_method_id = ? AND active = 1
        `).get(company_id, method)?.gl_account_id;
    if (!accountId) throw new Error(`POS refund payment method is not configured: ${method}`);
    const amount = Number(payment.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) throw new Error('POS refund payment amount must be positive');
    db.prepare(`
      INSERT INTO pos_payments (
        id, pos_order_id, payment_method_id, amount, created_at,
        payment_reference, state
      ) VALUES (?, ?, ?, ?, ?, ?, 'refunded')
    `).run(makeId('posp'), refundOrderId, method, amount, now, payment.reference || null);
    paymentCredits.push({
      account_id: accountId,
      debit: 0,
      credit: amount,
      partner_id: original.partner_id,
      description: `${orderName}:${method}`,
    });
  }

  const stockMoves = [];
  for (const line of prepared) {
    const move = executeStockOperation(db, {
      company_id,
      branch_id,
      actor,
      reference: orderName,
      product_id: line.originalLine.product_id,
      uom_id: line.originalLine.uom_id,
      product_qty: line.quantity,
      location_id: customerLocation.id,
      location_dest_id: warehouse.lot_stock_id,
      unit_cost: Number(line.originalLine.standard_price || 0),
      source_document_type: 'pos_order',
      source_document_id: refundOrderId,
      source_line_id: line.refundLineId,
      idempotency_key: `${idempotency_key}:stock:${line.index}`,
    });
    stockMoves.push(move);
  }

  const debitLines = prepared.flatMap((line) => {
    let quoted = null;
    try { quoted = JSON.parse(line.trace?.tax_quote || 'null'); } catch (_) {}
    if (Array.isArray(quoted?.lines) && quoted.lines.length) {
      return quoted.lines.map((item) => ({
        account_id: item.account_id,
        debit: round((Number(item.base_amount || 0) + Number(item.tax_amount || 0)) * line.ratio),
        credit: 0,
        source_line_id: line.refundLineId,
        product_id: line.originalLine.product_id,
        quantity: line.quantity,
        description: `${orderName}:${line.originalLine.name}`,
        tax_id: item.tax_id || null,
      }));
    }
    const incomeAccount = db.prepare(`
      SELECT category.income_account_id
      FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      JOIN product_categories category ON category.id = template.category_id
      WHERE variant.id = ? AND variant.company_id = ?
    `).get(line.originalLine.product_id, company_id)?.income_account_id;
    if (!incomeAccount) throw new Error(`Income account mapping is required for POS product ${line.originalLine.product_id}`);
    return [{
      account_id: incomeAccount,
      debit: line.total,
      credit: 0,
      source_line_id: line.refundLineId,
      product_id: line.originalLine.product_id,
      quantity: line.quantity,
      description: `${orderName}:${line.originalLine.name}`,
    }];
  });
  const originalFinance = db.prepare(`
    SELECT finance_document_id FROM pos_order_finance_links WHERE pos_order_id = ?
  `).get(original.id);
  if (!originalFinance) throw new Error('Original POS fiscal posting is missing');
  const posted = postSourceFact(db, {
    companyId: company_id,
    branchId: branch_id,
    userId: actor,
    now,
  }, {
    fact_type: 'customer_credit_note_posting',
    move_type: 'customer_credit_note',
    source_document_type: 'pos_refund',
    source_id: refundOrderId,
    original_document_id: originalFinance.finance_document_id,
    doc_date: now.slice(0, 10),
    partner_id: original.partner_id,
    currency: original.currency_id || 'IQD',
    lines: [...debitLines, ...paymentCredits],
  });

  const fiscalRequestId = makeId('pos_fiscal');
  db.prepare(`
    INSERT INTO commercial_fiscal_requests (
      id, company_id, request_type, source_document_type, source_document_id,
      idempotency_key, finance_document_id, status, request_payload,
      created_at, updated_at
    ) VALUES (?, ?, 'customer_credit_note', 'pos_refund', ?, ?, ?, 'posted', ?, ?, ?)
  `).run(
    fiscalRequestId, company_id, refundOrderId, `${idempotency_key}:fiscal`,
    posted.document_id,
    JSON.stringify({ original_order_id: original.id, refund_order_id: refundOrderId, amount_total: amountTotal }),
    now, now,
  );
  db.prepare(`
    INSERT INTO pos_order_finance_links (
      pos_order_id, company_id, finance_document_id, cash_shift_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(refundOrderId, company_id, posted.document_id, session.cash_shift_id, now);
  db.prepare(`
    UPDATE pos_orders SET amount_total = ?, amount_untaxed = ?, amount_tax = ?,
      state = 'refunded', completed_at = ?
    WHERE id = ?
  `).run(amountTotal, amountUntaxed, amountTax, now, refundOrderId);

  const refundId = makeId('posret');
  db.prepare(`
    INSERT INTO pos_refunds (
      id, company_id, original_order_id, refund_order_id, reason,
      stock_picking_id, finance_document_id, actor, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(refundId, company_id, original.id, refundOrderId, String(reason).trim(), posted.document_id, actor, now);
  for (const [index, line] of prepared.entries()) {
    db.prepare(`
      INSERT INTO pos_refund_lines (
        id, refund_id, original_order_line_id, refund_order_line_id,
        product_id, quantity, stock_move_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId('posretl'), refundId, line.originalLine.id, line.refundLineId,
      line.originalLine.product_id, line.quantity, stockMoves[index].id, now,
    );
  }
  recordEvent(db, {
    company_id,
    session_id,
    refund_order_id: refundOrderId,
    amount: amountTotal,
    actor,
    created_at: now,
    details: { original_order_id: original.id, reason: String(reason).trim(), receipt_number: receiptNumber },
  });
  return { refund: db.prepare('SELECT * FROM pos_refunds WHERE id = ?').get(refundId), order: getPosOrder(db, refundOrderId) };
}
