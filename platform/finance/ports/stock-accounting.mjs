import { postSourceFact } from '../engine.mjs';

function accountingContext(db, move) {
  const row = db.prepare(`
    SELECT
      src.usage AS source_usage,
      dst.usage AS destination_usage,
      category.stock_account_id,
      category.stock_input_account_id,
      category.stock_output_account_id,
      category.expense_account_id
    FROM stock_moves move
    JOIN stock_locations src ON src.id = move.location_id
    JOIN stock_locations dst ON dst.id = move.location_dest_id
    JOIN product_variants variant ON variant.id = move.product_id
    JOIN product_templates template ON template.id = variant.template_id
    JOIN product_categories category ON category.id = template.category_id
    WHERE move.id = ? AND move.company_id = ?
  `).get(move.id, move.company_id);
  if (!row) throw new Error('Stock accounting context is incomplete');
  return row;
}

function isInternal(usage) {
  return usage === 'internal' || usage === 'transit';
}

function requireAccount(db, companyId, accountId, label) {
  if (!accountId) throw new Error(`${label} account mapping is required`);
  const account = db.prepare(`
    SELECT id FROM finance_accounts
    WHERE id = ? AND company_id = ? AND is_active = 1
  `).get(accountId, companyId);
  if (!account) throw new Error(`${label} account mapping is invalid for the active company`);
  return account.id;
}

export function postStockAccounting(db, ctx, { move, valuationFact }) {
  if (!valuationFact) return { accounting_event: 'internal_transfer', finance_document_id: null };
  const amount = Math.abs(Number(valuationFact.value || 0));
  if (!(amount > 0)) throw new Error('A valued stock operation requires a positive accounting amount');
  const mapping = accountingContext(db, move);
  const entering = !isInternal(mapping.source_usage) && isInternal(mapping.destination_usage);
  const leaving = isInternal(mapping.source_usage) && !isInternal(mapping.destination_usage);
  if (!entering && !leaving) return { accounting_event: 'internal_transfer', finance_document_id: null };

  const stockAccount = requireAccount(db, move.company_id, mapping.stock_account_id, 'stock valuation');
  let debitAccount;
  let creditAccount;
  let accountingEvent;
  let factType;
  if (entering) {
    debitAccount = stockAccount;
    if (mapping.source_usage === 'supplier') {
      creditAccount = requireAccount(db, move.company_id, mapping.stock_input_account_id, 'stock input');
      accountingEvent = 'stock_receipt';
    } else if (mapping.source_usage === 'customer') {
      creditAccount = requireAccount(db, move.company_id, mapping.stock_output_account_id, 'stock output');
      accountingEvent = 'customer_return';
    } else {
      creditAccount = requireAccount(db, move.company_id, mapping.expense_account_id, 'inventory adjustment');
      accountingEvent = 'inventory_gain';
    }
    factType = 'stock_receipt_posting';
  } else {
    creditAccount = stockAccount;
    if (mapping.destination_usage === 'supplier') {
      debitAccount = requireAccount(db, move.company_id, mapping.stock_input_account_id, 'stock input');
      accountingEvent = 'supplier_return';
    } else {
      debitAccount = requireAccount(db, move.company_id, mapping.expense_account_id, 'cost of goods sold');
      accountingEvent = mapping.destination_usage === 'customer' ? 'stock_delivery' : 'inventory_loss';
    }
    factType = 'stock_issue_posting';
  }

  const posted = postSourceFact(db, ctx, {
    fact_type: factType,
    source_id: move.id,
    doc_date: String(move.move_date || new Date().toISOString()).slice(0, 10),
    currency: valuationFact.currency || 'IQD',
    lines: [
      { account_id: debitAccount, debit: amount, credit: 0, description: `${accountingEvent}:${move.reference}` },
      { account_id: creditAccount, debit: 0, credit: amount, description: `${accountingEvent}:${move.reference}` },
    ],
  });
  db.prepare(`
    INSERT INTO stock_accounting_links (
      stock_move_id, company_id, valuation_fact_id,
      finance_document_id, accounting_event, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    move.id,
    move.company_id,
    valuationFact.id,
    posted.document_id,
    accountingEvent,
    new Date().toISOString(),
  );
  return { accounting_event: accountingEvent, finance_document_id: posted.document_id };
}
