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

// Phase 05 manufacturing usages. Goods in these locations are still owned and
// still valued; they are simply held outside a normal warehouse location. They
// are deliberately NOT "internal" so that the Phase 04 valuation engine records
// an issue/receipt fact on every crossing, which is what makes WIP measurable.
const PRODUCTION_USAGE = 'production';
const SUBCONTRACTOR_USAGE = 'subcontractor';

function isManufacturingUsage(usage) {
  return usage === PRODUCTION_USAGE || usage === SUBCONTRACTOR_USAGE;
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

/**
 * Company-scoped manufacturing account mapping (Control Plane row created by
 * migration 045). No manufacturing account is ever hard-coded in domain code;
 * a missing mapping fails closed so a production posting can never silently
 * land in the wrong account.
 */
export function manufacturingMapping(db, companyId) {
  const hasTable = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'manufacturing_account_mappings'
  `).get();
  if (!hasTable) return null;
  return db.prepare('SELECT * FROM manufacturing_account_mappings WHERE company_id = ?').get(companyId) || null;
}

function manufacturingLeg(db, move, mapping) {
  const companyId = move.company_id;
  const required = (accountId, label) => requireAccount(db, companyId, accountId, label);
  if (!mapping) throw new Error('manufacturing account mapping is required for this company');
  return {
    wip: () => required(mapping.wip_account_id, 'work in progress'),
    subcontractStock: () => required(mapping.subcontract_stock_account_id, 'subcontractor goods'),
  };
}

/**
 * Resolve the manufacturing accounting legs for a move that touches a
 * production or subcontractor location. Returns null when the move is an
 * ordinary Phase 04 commercial movement, so the original logic keeps running
 * untouched.
 *
 * Scrap out of WIP is deliberately NOT handled here: a production → scrap move
 * crosses no internal boundary, so the Phase 04 valuation engine produces no
 * valuation fact for it and this function is never reached. That write-off is
 * posted explicitly by `manufacturing/materials.mjs` through the registered
 * `manufacturing_wip_posting` source-fact contract.
 */
function resolveManufacturingPosting(db, move, mapping, ctx) {
  const sourceUsage = ctx.source_usage;
  const destinationUsage = ctx.destination_usage;

  if (!isManufacturingUsage(sourceUsage) && !isManufacturingUsage(destinationUsage)) return null;

  const legs = manufacturingLeg(db, move, mapping);
  const stockAccount = requireAccount(db, move.company_id, ctx.stock_account_id, 'stock valuation');

  // Component issue into production: Dr WIP / Cr Inventory.
  if (destinationUsage === PRODUCTION_USAGE && isInternal(sourceUsage)) {
    return {
      debitAccount: legs.wip(),
      creditAccount: stockAccount,
      accountingEvent: 'production_material_issue',
      factType: 'manufacturing_wip_posting',
    };
  }

  // Output or component return out of production: Dr Inventory / Cr WIP.
  if (sourceUsage === PRODUCTION_USAGE && isInternal(destinationUsage)) {
    return {
      debitAccount: stockAccount,
      creditAccount: legs.wip(),
      accountingEvent: 'production_output_receipt',
      factType: 'manufacturing_wip_posting',
    };
  }

  // Supplied components sent to a subcontractor stay an asset of this company.
  // They are reclassified, never expensed and never treated as a sale.
  if (destinationUsage === SUBCONTRACTOR_USAGE && isInternal(sourceUsage)) {
    return {
      debitAccount: legs.subcontractStock(),
      creditAccount: stockAccount,
      accountingEvent: 'subcontract_component_transfer',
      factType: 'manufacturing_wip_posting',
    };
  }

  if (sourceUsage === SUBCONTRACTOR_USAGE && isInternal(destinationUsage)) {
    return {
      debitAccount: stockAccount,
      creditAccount: legs.subcontractStock(),
      accountingEvent: 'subcontract_component_return',
      factType: 'manufacturing_wip_posting',
    };
  }

  // Consumption of supplied components at the subcontractor's site.
  if (sourceUsage === SUBCONTRACTOR_USAGE && destinationUsage === PRODUCTION_USAGE) {
    return {
      debitAccount: legs.wip(),
      creditAccount: legs.subcontractStock(),
      accountingEvent: 'subcontract_component_consumption',
      factType: 'manufacturing_wip_posting',
    };
  }

  if (sourceUsage === PRODUCTION_USAGE && destinationUsage === SUBCONTRACTOR_USAGE) {
    return {
      debitAccount: legs.subcontractStock(),
      creditAccount: legs.wip(),
      accountingEvent: 'subcontract_wip_transfer',
      factType: 'manufacturing_wip_posting',
    };
  }

  throw new Error(`unsupported manufacturing stock movement: ${sourceUsage} -> ${destinationUsage}`);
}

export function postStockAccounting(db, ctx, { move, valuationFact }) {
  if (!valuationFact) return { accounting_event: 'internal_transfer', finance_document_id: null };
  const amount = Math.abs(Number(valuationFact.value || 0));
  if (!(amount > 0)) throw new Error('A valued stock operation requires a positive accounting amount');
  const mapping = accountingContext(db, move);

  const manufacturing = resolveManufacturingPosting(
    db,
    move,
    manufacturingMapping(db, move.company_id),
    mapping,
  );

  let debitAccount;
  let creditAccount;
  let accountingEvent;
  let factType;

  if (manufacturing) {
    ({ debitAccount, creditAccount, accountingEvent, factType } = manufacturing);
  } else {
    const entering = !isInternal(mapping.source_usage) && isInternal(mapping.destination_usage);
    const leaving = isInternal(mapping.source_usage) && !isInternal(mapping.destination_usage);
    if (!entering && !leaving) return { accounting_event: 'internal_transfer', finance_document_id: null };

    const stockAccount = requireAccount(db, move.company_id, mapping.stock_account_id, 'stock valuation');
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
