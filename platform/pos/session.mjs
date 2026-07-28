import crypto from 'node:crypto';
import {
  computeTax,
  postSourceFact,
  createCashbox,
  openCashShift,
  recordCashCount,
  closeCashShift,
} from '../finance/engine.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function financeContext(payload) {
  return {
    companyId: payload.company_id,
    branchId: payload.branch_id || null,
    userId: payload.actor,
    now: new Date().toISOString(),
  };
}

function recordSessionEvent(db, {
  company_id,
  session_id,
  event_type,
  reference_type = null,
  reference_id = null,
  amount = 0,
  details = {},
  actor = null,
}) {
  db.prepare(`
    INSERT INTO pos_session_events (
      id, company_id, session_id, event_type, reference_type, reference_id,
      amount, details, actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId('posevt'), company_id, session_id, event_type, reference_type,
    reference_id, Number(amount || 0), JSON.stringify(details), actor,
    new Date().toISOString(),
  );
}

export function configurePosTerminal(db, payload) {
  const {
    company_id,
    branch_id = null,
    actor,
    name,
    warehouse_id,
    cash_account_id,
    currency_id = 'IQD',
  } = payload;
  const warehouse = db.prepare('SELECT id FROM warehouses WHERE id = ? AND company_id = ?').get(warehouse_id, company_id);
  if (!warehouse) throw new Error('POS terminal warehouse is outside the active company');
  if (branch_id && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouse_id, company_id, branch_id)) {
    throw new Error('POS terminal warehouse is outside the active branch scope');
  }
  const cashbox = createCashbox(db, financeContext(payload), {
    name: `${String(name).trim()} Cashbox`,
    gl_account_id: cash_account_id,
    branch_id,
    custodian_user_id: actor,
    currency: currency_id,
  });
  const id = makeId('posterm');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pos_terminals (
      id, company_id, branch_id, name, warehouse_id, cashbox_id,
      currency_id, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, branch_id, String(name).trim(), warehouse_id, cashbox.id, currency_id, now, now);
  return db.prepare('SELECT * FROM pos_terminals WHERE id = ?').get(id);
}

export function configurePaymentMethod(db, payload) {
  const method = String(payload.payment_method_id || '').trim().toLowerCase();
  if (!method || method === 'cash') throw new Error('Configure a non-cash POS payment method');
  const account = db.prepare(`
    SELECT id FROM finance_accounts WHERE id = ? AND company_id = ? AND is_active = 1
  `).get(payload.gl_account_id, payload.company_id);
  if (!account) throw new Error('POS payment account is outside the active company');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pos_payment_method_configs (
      company_id, payment_method_id, gl_account_id, active, updated_at
    ) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(company_id, payment_method_id) DO UPDATE SET
      gl_account_id=excluded.gl_account_id, active=1, updated_at=excluded.updated_at
  `).run(payload.company_id, method, account.id, now);
  return db.prepare(`
    SELECT * FROM pos_payment_method_configs
    WHERE company_id = ? AND payment_method_id = ?
  `).get(payload.company_id, method);
}

export function openPosSession(db, {
  company_id,
  branch_id = null,
  actor,
  name = 'Main POS Terminal',
  user_id,
  cash_shift_id,
  terminal_id = null,
  warehouse_id = null,
  opening_cash = 0,
}) {
  if (!user_id) throw new Error('Authenticated user is required to open a POS session');
  let terminal = null;
  if (terminal_id) {
    terminal = db.prepare(`
      SELECT * FROM pos_terminals
      WHERE id = ? AND company_id = ? AND is_active = 1
    `).get(terminal_id, company_id);
    if (!terminal) throw new Error('POS terminal is outside the active company or inactive');
    if (branch_id && terminal.branch_id && terminal.branch_id !== branch_id) {
      throw new Error('POS terminal is outside the active branch scope');
    }
    if (!cash_shift_id) {
      const opened = openCashShift(db, {
        companyId: company_id,
        branchId: branch_id,
        userId: user_id,
        now: new Date().toISOString(),
      }, {
        cashbox_id: terminal.cashbox_id,
        opening_balance: Number(opening_cash || 0),
      });
      cash_shift_id = opened.id;
    }
    name = terminal.name;
    warehouse_id = terminal.warehouse_id;
  }
  const shift = db.prepare(`
    SELECT shift.*, cashbox.id AS cashbox_id, cashbox.is_active
    FROM finance_cash_shifts shift
    JOIN finance_cashboxes cashbox ON cashbox.id = shift.cashbox_id
    WHERE shift.id = ? AND shift.company_id = ?
  `).get(cash_shift_id, company_id);
  if (!shift || shift.status !== 'open' || !shift.is_active) {
    throw new Error('POS session requires an active canonical cash shift');
  }
  if (shift.opened_by !== user_id) throw new Error('POS cashier must own the active cash shift');
  const existing = db.prepare(`
    SELECT id FROM pos_sessions
    WHERE company_id = ? AND user_id = ? AND state = 'opened'
  `).get(company_id, user_id);
  if (existing) throw new Error('POS cashier already has an open session');

  const id = makeId('sess');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pos_sessions (
      id, company_id, name, user_id, state, start_at, created_at,
      terminal_id, branch_id, warehouse_id, cash_shift_id, opening_cash
    ) VALUES (?, ?, ?, ?, 'opened', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, company_id, name, user_id, now, now, terminal?.id || null,
    branch_id, warehouse_id || terminal?.warehouse_id || null, shift.id,
    Number(opening_cash || shift.opening_balance || 0),
  );
  db.prepare(`
    INSERT INTO pos_session_finance_links (
      session_id, company_id, cashbox_id, cash_shift_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(id, company_id, shift.cashbox_id, shift.id, now);
  recordSessionEvent(db, {
    company_id,
    session_id: id,
    event_type: 'opened',
    reference_type: 'finance_cash_shift',
    reference_id: shift.id,
    amount: Number(opening_cash || shift.opening_balance || 0),
    details: { terminal_id: terminal?.id || null, warehouse_id: warehouse_id || terminal?.warehouse_id || null },
    actor: actor || user_id,
  });
  return getPosSession(db, id);
}

export function processPosOrder(db, payload) {
  const {
    company_id,
    branch_id = null,
    actor,
    session_id,
    partner_id,
    warehouse_id,
    lines = [],
    payments = [],
    idempotency_key,
  } = payload;
  const session = db.prepare(`
    SELECT session.*, link.cashbox_id, link.cash_shift_id,
           cashbox.gl_account_id AS cash_account_id,
           shift.status AS shift_status
    FROM pos_sessions session
    JOIN pos_session_finance_links link ON link.session_id = session.id
    JOIN finance_cashboxes cashbox ON cashbox.id = link.cashbox_id
    JOIN finance_cash_shifts shift ON shift.id = link.cash_shift_id
    WHERE session.id = ? AND session.company_id = ?
  `).get(session_id, company_id);
  if (!session) throw new Error(`POS session not found: ${session_id}`);
  if (session.state !== 'opened' || session.shift_status !== 'open') throw new Error('POS and cash sessions must both be open');
  if (session.user_id !== actor) throw new Error('Only the session cashier can process a POS order');
  if (!partner_id) throw new Error('A canonical customer party is required for fiscal POS posting');
  const partner = db.prepare(`
    SELECT p.id FROM parties p
    JOIN party_roles role ON role.party_id = p.id
    WHERE p.id = ? AND p.company_id = ? AND role.company_id = ? AND role.role = 'customer'
  `).get(partner_id, company_id, company_id);
  if (!partner) throw new Error('POS customer is outside the active company');
  const warehouse = db.prepare(`
    SELECT * FROM warehouses WHERE id = ? AND company_id = ?
  `).get(warehouse_id, company_id);
  if (!warehouse) throw new Error('POS warehouse is outside the active company');
  if (branch_id && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouse_id, company_id, branch_id)) {
    throw new Error('POS warehouse is outside the active branch scope');
  }
  if (!lines.length || !payments.length) throw new Error('POS order requires lines and payments');

  const orderId = makeId('poso');
  const receiptSequence = db.prepare(`
    SELECT COUNT(*) AS n FROM pos_orders WHERE company_id = ?
  `).get(company_id).n + 1;
  const orderName = `POS/${String(receiptSequence).padStart(6, '0')}`;
  const receiptNumber = `${new Date().getUTCFullYear()}-${String(receiptSequence).padStart(6, '0')}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO pos_orders (
      id, company_id, session_id, name, partner_id, amount_total, state, created_at,
      order_kind, warehouse_id, cashier_id, currency_id, receipt_number
    ) VALUES (?, ?, ?, ?, ?, 0, 'draft', ?, 'sale', ?, ?, 'IQD', ?)
  `).run(orderId, company_id, session_id, orderName, partner_id, now, warehouse_id, actor, receiptNumber);

  const preparedLines = [];
  let amountTotal = 0;
  let amountUntaxed = 0;
  let amountTax = 0;
  let amountDiscount = 0;
  for (const inputLine of lines) {
    const product = db.prepare(`
      SELECT variant.id, variant.name, template.uom_id, template.list_price,
             variant.list_price_extra, category.income_account_id,
             variant.standard_price
      FROM product_variants variant
      JOIN product_templates template ON template.id = variant.template_id
      JOIN product_categories category ON category.id = template.category_id
      WHERE variant.id = ? AND variant.company_id = ? AND variant.is_active = 1
    `).get(inputLine.product_id, company_id);
    if (!product) throw new Error(`POS product not found in active company: ${inputLine.product_id}`);
    if (!product.income_account_id) throw new Error(`Income account mapping is required for POS product ${product.id}`);
    const qty = Number(inputLine.qty);
    if (!(qty > 0)) throw new Error('POS line quantity must be positive');
    const unitPrice = Number(product.list_price || 0) + Number(product.list_price_extra || 0);
    const discount = Number(inputLine.discount || 0);
    if (discount < 0 || discount > 100) throw new Error('POS discount must be between 0 and 100');
    const discountedPrice = unitPrice * (1 - discount / 100);
    amountDiscount += (unitPrice - discountedPrice) * qty;
    const taxId = db.prepare(`
      SELECT tax_id FROM pos_product_tax_configs
      WHERE company_id = ? AND product_id = ?
    `).get(company_id, product.id)?.tax_id || null;
    const taxQuote = computeTax(db, financeContext(payload), {
      lines: [{
        account_id: product.income_account_id,
        price_unit: discountedPrice,
        quantity: qty,
        tax_id: taxId,
        description: product.name,
      }],
    });
    const lineId = makeId('posol');
    db.prepare(`
      INSERT INTO pos_order_lines (
        id, pos_order_id, product_id, qty, price_unit,
        discount, price_subtotal, created_at, tax_amount, price_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lineId, orderId, product.id, qty, unitPrice, discount, taxQuote.total_base, now, taxQuote.total_tax, taxQuote.total_amount);
    db.prepare(`
      INSERT INTO pos_order_line_tax_traces (
        pos_order_line_id, company_id, tax_id, pricing_source,
        tax_quote, created_at
      ) VALUES (?, ?, ?, 'canonical_product_list_price', ?, ?)
    `).run(lineId, company_id, taxId, JSON.stringify(taxQuote), now);
    amountTotal += taxQuote.total_amount;
    amountUntaxed += taxQuote.total_base;
    amountTax += taxQuote.total_tax;
    preparedLines.push({ inputLine, product, qty, lineId, taxQuote });
  }

  const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (Math.abs(paymentTotal - amountTotal) > 0.0001) {
    throw new Error(`POS payment total ${paymentTotal} does not equal fiscal total ${amountTotal}`);
  }

  const debitLines = [];
  const insertPayment = db.prepare(`
    INSERT INTO pos_payments (
      id, pos_order_id, payment_method_id, amount, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const payment of payments) {
    const method = payment.payment_method_id || 'cash';
    let accountId;
    if (method === 'cash') {
      accountId = session.cash_account_id;
    } else {
      accountId = db.prepare(`
        SELECT gl_account_id FROM pos_payment_method_configs
        WHERE company_id = ? AND payment_method_id = ? AND active = 1
      `).get(company_id, method)?.gl_account_id;
    }
    if (!accountId) throw new Error(`POS payment method is not configured: ${method}`);
    const amount = Number(payment.amount);
    if (!(amount > 0) || !Number.isFinite(amount)) throw new Error('POS payment amount must be positive');
    insertPayment.run(makeId('posp'), orderId, method, amount, now);
    debitLines.push({ account_id: accountId, debit: amount, credit: 0, partner_id, description: `${orderName}:${method}` });
  }

  const customerLocation = db.prepare(`
    SELECT id FROM stock_locations WHERE company_id = ? AND usage = 'customer'
    ORDER BY created_at LIMIT 1
  `).get(company_id) || (() => {
    const id = makeId('loc_cust');
    db.prepare(`
      INSERT INTO stock_locations (
        id, company_id, name, complete_name, usage, created_at
      ) VALUES (?, ?, 'Customers', 'Customers', 'customer', ?)
    `).run(id, company_id, now);
    return { id };
  })();

  for (let index = 0; index < preparedLines.length; index += 1) {
    const line = preparedLines[index];
    executeStockOperation(db, {
      company_id,
      branch_id,
      actor,
      reference: orderName,
      product_id: line.product.id,
      uom_id: line.product.uom_id,
      product_qty: line.qty,
      location_id: warehouse.lot_stock_id,
      location_dest_id: customerLocation.id,
      unit_cost: line.product.standard_price || 0,
      source_document_type: 'pos_order',
      source_document_id: orderId,
      source_line_id: line.lineId,
      idempotency_key: `${idempotency_key}:stock:${index}`,
    });
  }

  const creditLines = preparedLines.flatMap((line) => line.taxQuote.lines.map((quoted) => ({
    account_id: quoted.account_id,
    debit: 0,
    credit: Number(quoted.base_amount || 0) + Number(quoted.tax_amount || 0),
    source_line_id: line.lineId,
    product_id: line.product.id,
    quantity: line.qty,
    description: `${orderName}:${line.product.name}`,
    tax_id: quoted.tax_id || null,
  })));
  const posted = postSourceFact(db, financeContext(payload), {
    fact_type: 'sales_invoice_posting',
    move_type: 'source_post',
    source_document_type: 'pos_order',
    source_id: orderId,
    doc_date: now.slice(0, 10),
    partner_id,
    currency: 'IQD',
    lines: [...debitLines, ...creditLines],
  });
  const requestId = makeId('pos_fiscal');
  db.prepare(`
    INSERT INTO commercial_fiscal_requests (
      id, company_id, request_type, source_document_type, source_document_id,
      idempotency_key, finance_document_id, status, request_payload,
      created_at, updated_at
    ) VALUES (?, ?, 'pos_fiscal', 'pos_order', ?, ?, ?, 'posted', ?, ?, ?)
  `).run(
    requestId,
    company_id,
    orderId,
    `${idempotency_key}:fiscal`,
    posted.document_id,
    JSON.stringify({ order_id: orderId, amount_total: amountTotal }),
    now,
    now,
  );
  db.prepare(`
    INSERT INTO pos_order_finance_links (
      pos_order_id, company_id, finance_document_id, cash_shift_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(orderId, company_id, posted.document_id, session.cash_shift_id, now);
  db.prepare(`
    UPDATE pos_orders SET amount_total = ?, amount_untaxed = ?, amount_tax = ?,
      amount_discount = ?, state = 'paid', completed_at = ?
    WHERE id = ?
  `).run(amountTotal, amountUntaxed, amountTax, amountDiscount, now, orderId);
  recordSessionEvent(db, {
    company_id,
    session_id,
    event_type: 'sale',
    reference_type: 'pos_order',
    reference_id: orderId,
    amount: amountTotal,
    details: { receipt_number: receiptNumber, payment_methods: payments.map((payment) => payment.payment_method_id || 'cash') },
    actor,
  });
  return getPosOrder(db, orderId);
}

export function closePosSession(db, payload) {
  const session = db.prepare(`
    SELECT session.*, link.cash_shift_id
    FROM pos_sessions session
    JOIN pos_session_finance_links link ON link.session_id = session.id
    WHERE session.id = ? AND session.company_id = ?
  `).get(payload.session_id, payload.company_id);
  if (!session) throw new Error(`POS session not found: ${payload.session_id}`);
  if (session.state !== 'opened') throw new Error('POS session is already closed');
  if (session.user_id !== payload.actor) throw new Error('Only the session cashier can close the POS session');
  const count = recordCashCount(db, financeContext(payload), {
    shift_id: session.cash_shift_id,
    counted_amount: Number(payload.counted_amount),
    note: payload.note || `POS session ${session.id} close`,
  });
  const closed = closeCashShift(db, financeContext(payload), {
    shift_id: session.cash_shift_id,
    actual_closing_balance: count.counted_amount,
  });
  const now = new Date().toISOString();
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN order_kind = 'sale' AND state = 'paid' THEN amount_total ELSE 0 END), 0) AS sales,
      COALESCE(SUM(CASE WHEN order_kind = 'refund' AND state = 'refunded' THEN amount_total ELSE 0 END), 0) AS refunds
    FROM pos_orders WHERE session_id = ?
  `).get(session.id);
  db.prepare(`
    UPDATE pos_sessions SET state = 'closed', stop_at = ?, expected_cash = ?,
      counted_cash = ?, variance = ?, closed_by = ?
    WHERE id = ?
  `).run(now, count.expected_amount, count.counted_amount, count.variance, payload.actor, session.id);
  const reconciliationId = makeId('posrec');
  db.prepare(`
    INSERT INTO pos_reconciliations (
      id, company_id, session_id, cash_shift_id, opening_amount, sales_amount,
      refunds_amount, expected_amount, counted_amount, variance, status, actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reconciliationId, payload.company_id, session.id, session.cash_shift_id,
    Number(session.opening_cash || 0), Number(totals.sales || 0), Number(totals.refunds || 0),
    count.expected_amount, count.counted_amount, count.variance,
    Math.abs(count.variance) <= 0.0001 ? 'balanced' : 'variance', payload.actor, now,
  );
  recordSessionEvent(db, {
    company_id: payload.company_id,
    session_id: session.id,
    event_type: 'cash_count',
    reference_type: 'pos_reconciliation',
    reference_id: reconciliationId,
    amount: count.counted_amount,
    details: count,
    actor: payload.actor,
  });
  recordSessionEvent(db, {
    company_id: payload.company_id,
    session_id: session.id,
    event_type: 'closed',
    reference_type: 'finance_cash_shift',
    reference_id: session.cash_shift_id,
    amount: count.counted_amount,
    details: closed,
    actor: payload.actor,
  });
  return { session: getPosSession(db, session.id), cash_shift: closed, cash_count: count, reconciliation: db.prepare('SELECT * FROM pos_reconciliations WHERE id = ?').get(reconciliationId) };
}

export function getPosOrder(db, id) {
  const order = db.prepare('SELECT * FROM pos_orders WHERE id = ?').get(id);
  if (!order) return null;
  const lines = db.prepare('SELECT * FROM pos_order_lines WHERE pos_order_id = ?').all(id);
  const payments = db.prepare('SELECT * FROM pos_payments WHERE pos_order_id = ?').all(id);
  const finance = db.prepare('SELECT * FROM pos_order_finance_links WHERE pos_order_id = ?').get(id) || null;
  const refund = db.prepare(`
    SELECT * FROM pos_refunds WHERE original_order_id = ? OR refund_order_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(id, id) || null;
  return { ...order, lines, payments, finance, refund };
}

export function getPosSession(db, id) {
  const session = db.prepare(`
    SELECT session.*, link.cashbox_id, link.cash_shift_id,
      shift.status AS cash_shift_status, shift.expected_closing_balance,
      shift.actual_closing_balance
    FROM pos_sessions session
    LEFT JOIN pos_session_finance_links link ON link.session_id = session.id
    LEFT JOIN finance_cash_shifts shift ON shift.id = link.cash_shift_id
    WHERE session.id = ?
  `).get(id);
  if (!session) return null;
  const events = db.prepare('SELECT * FROM pos_session_events WHERE session_id = ? ORDER BY created_at, id').all(id);
  const reconciliation = db.prepare('SELECT * FROM pos_reconciliations WHERE session_id = ?').get(id) || null;
  return { ...session, events, reconciliation };
}
