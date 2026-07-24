import { postStockAccounting } from '../finance/ports/stock-accounting.mjs';
import { postStockMove } from './ledger.mjs';
import { consumeReservation } from './reservations.mjs';

function validateSourceLifecycle(db, payload) {
  if (!payload.source_document_type || !payload.source_document_id) return;
  const contracts = {
    sale_order: { table: 'sale_orders', states: ['sale'] },
    purchase_order: { table: 'purchase_orders', states: ['purchase'] },
    stock_picking: { table: 'stock_pickings', states: ['assigned', 'confirmed', 'draft'] },
    pos_order: { table: 'pos_orders', states: ['draft'] },
  };
  const contract = contracts[payload.source_document_type];
  if (!contract) return;
  const source = db.prepare(`
    SELECT company_id, state FROM ${contract.table} WHERE id = ?
  `).get(payload.source_document_id);
  if (!source || source.company_id !== payload.company_id) {
    throw new Error('Stock source document is outside the active company');
  }
  if (!contract.states.includes(source.state)) {
    throw new Error(`Stock source lifecycle does not allow execution from state ${source.state}`);
  }
}

export function executeStockOperation(db, payload) {
  validateSourceLifecycle(db, payload);
  let reservation = null;
  if (payload.reservation_id) {
    reservation = consumeReservation(db, {
      ...payload,
      quantity: payload.product_qty,
      reservation_id: payload.reservation_id,
    });
  }
  const move = postStockMove(db, payload);
  const valuationFact = db.prepare(`
    SELECT * FROM stock_valuation_facts WHERE stock_move_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(move.id);
  const accounting = postStockAccounting(db, {
    companyId: payload.company_id,
    branchId: payload.branch_id || null,
    userId: payload.actor,
    tenantId: payload.tenant_id || null,
    now: new Date().toISOString(),
  }, { move, valuationFact });
  return { ...move, valuation_fact_id: valuationFact?.id || null, reservation, accounting };
}
