// CRM ↔ canonical Sales integration.
//
// CRM does not price, tax, discount, reserve stock, deliver, invoice or post.
// It asks Sales for a quotation and then stores a link. Everything commercial
// stays in the Sales authority, which already carries
// `sale_orders.source_opportunity_id` for exactly this purpose — so the link is
// recorded on both sides without a bridge table.
//
// The replay guarantee matters most here: a retried "request quotation" must
// return the quotation that already exists rather than creating a second one.
// Duplicate quotations for one opportunity are visible to the customer.

import { CRM_ERRORS, fail } from './errors.mjs';
import { newId, now, scopeOf, writeAudit, emitEvent } from './shared.mjs';
import { getOpportunity } from './opportunity-service.mjs';

/**
 * Build the canonical Sales payload from CRM facts.
 *
 * Returned rather than posted, so the caller hands it to the canonical Sales
 * action. CRM never inserts priced lines itself.
 */
export function buildQuotationRequest(db, opportunity, { branchId = null } = {}) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(opportunity.party_id);
  if (!party) fail(CRM_ERRORS.PARTY_NOT_FOUND, `opportunity party ${opportunity.party_id} is missing`, { partyId: opportunity.party_id });

  return {
    company_id: opportunity.company_id,
    branch_id: opportunity.branch_id ?? branchId,
    partner_id: opportunity.party_id,
    currency_id: opportunity.currency || 'IQD',
    salesperson_id: opportunity.owner_user_id,
    source_opportunity_id: opportunity.id,
    // Attribution travels with the request so Sales reporting can answer
    // "which campaign produced this order" without asking CRM.
    campaign_id: opportunity.campaign_id,
    source_id: opportunity.source_id,
    // Product interest is a CRM signal, not a priced line. Sales decides price,
    // tax and availability.
    product_interest: JSON.parse(opportunity.product_interest || '[]'),
    expected_value: Number(opportunity.expected_value || 0),
  };
}

/**
 * Record that a canonical quotation now exists for this opportunity.
 *
 * `saleOrderId` must already have been created by the canonical Sales
 * authority. Replay is a no-op that returns the existing link.
 */
export function linkQuotation(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  if (opp.company_id !== companyId) fail(CRM_ERRORS.OPPORTUNITY_NOT_FOUND, 'opportunity belongs to another company', { opportunityId: opp.id });

  const order = db.prepare('SELECT id, partner_id, company_id, state FROM sale_orders WHERE id = ?').get(input.sale_order_id);
  if (!order) fail(CRM_ERRORS.SALE_ORDER_NOT_FOUND, `unknown sale order ${input.sale_order_id}`, { saleOrderId: input.sale_order_id });
  if (order.partner_id !== opp.party_id) {
    fail(CRM_ERRORS.QUOTATION_PARTY_MISMATCH, 'quotation belongs to a different party', {
      orderParty: order.partner_id, opportunityParty: opp.party_id,
    });
  }

  // Replay: already linked to this same order → no-op, no duplicate.
  if (opp.quotation_order_id === order.id) return { opportunity: opp, linked: false, replayed: true };
  if (opp.quotation_order_id && opp.quotation_order_id !== order.id) {
    fail(CRM_ERRORS.QUOTATION_ALREADY_LINKED, 'opportunity already has a different quotation linked', {
      opportunityId: opp.id, existing: opp.quotation_order_id, attempted: order.id,
    });
  }

  const ts = now();
  db.prepare('UPDATE crm_opportunities SET quotation_order_id = ?, quotation_requested_at = COALESCE(quotation_requested_at, ?) WHERE id = ?')
    .run(order.id, ts, opp.id);
  // The canonical Sales row records the back-link on its own column.
  db.prepare('UPDATE sale_orders SET source_opportunity_id = ? WHERE id = ?').run(opp.id, order.id);
  db.prepare('UPDATE crm_opportunities SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?').run(ts, actor, opp.id);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.link_quotation', resource: 'crm_opportunity', resourceId: opp.id, before: { quotation_order_id: opp.quotation_order_id }, after: { quotation_order_id: order.id } });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.quotation_linked', aggregateId: opp.id, payload: { saleOrderId: order.id } });
  return { opportunity: after, linked: true, replayed: false };
}

/**
 * Link a confirmed Sales Order.
 *
 * Separate from the quotation link because an order is stronger evidence: it is
 * what lets `mark_won` succeed without a privileged override.
 */
export function linkSalesOrder(db, input) {
  const { companyId, branchId, actor } = scopeOf(input);
  const opp = getOpportunity(db, input.opportunity_id);
  if (opp.company_id !== companyId) fail(CRM_ERRORS.OPPORTUNITY_NOT_FOUND, 'opportunity belongs to another company', { opportunityId: opp.id });

  const order = db.prepare('SELECT id, partner_id, state FROM sale_orders WHERE id = ?').get(input.sale_order_id);
  if (!order) fail(CRM_ERRORS.SALE_ORDER_NOT_FOUND, `unknown sale order ${input.sale_order_id}`, { saleOrderId: input.sale_order_id });
  if (order.partner_id !== opp.party_id) {
    fail(CRM_ERRORS.QUOTATION_PARTY_MISMATCH, 'sales order belongs to a different party', {
      orderParty: order.partner_id, opportunityParty: opp.party_id,
    });
  }
  if (opp.sale_order_id === order.id) return { opportunity: opp, linked: false, replayed: true };

  const ts = now();
  db.prepare('UPDATE crm_opportunities SET sale_order_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
    .run(order.id, ts, actor, opp.id);
  db.prepare('UPDATE sale_orders SET source_opportunity_id = ? WHERE id = ?').run(opp.id, order.id);

  const after = getOpportunity(db, opp.id);
  writeAudit(db, { companyId, branchId, actor, action: 'crm.opportunity.link_sales_order', resource: 'crm_opportunity', resourceId: opp.id, before: { sale_order_id: opp.sale_order_id }, after: { sale_order_id: order.id } });
  emitEvent(db, { companyId, actor, eventType: 'crm.opportunity.sales_order_linked', aggregateId: opp.id, payload: { saleOrderId: order.id } });
  return { opportunity: after, linked: true, replayed: false };
}

/** Sales facts for an opportunity — read from the canonical authority. */
export function getLinkedSales(db, opportunityId) {
  const opp = getOpportunity(db, opportunityId);
  const ids = [opp.quotation_order_id, opp.sale_order_id].filter(Boolean);
  if (!ids.length) return { quotation: null, salesOrder: null };
  const rows = db.prepare(`SELECT id, name, state, amount_total, order_date FROM sale_orders WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return {
    quotation: rows.find((r) => r.id === opp.quotation_order_id) ?? null,
    salesOrder: rows.find((r) => r.id === opp.sale_order_id) ?? null,
  };
}
