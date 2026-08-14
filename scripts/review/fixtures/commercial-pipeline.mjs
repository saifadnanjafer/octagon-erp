// Product Recovery 1 — disposable CRM/Sales/Procurement fixtures.
//
// Found via docs/product/PAGE_REALITY_LEDGER.md and OWNER_PRODUCT_DECISIONS.md
// §4: the canonical commercial schema (database/migrations/039 CRM/sales,
// 040 suppliers/procurement) and its API layer (platform/sales/*,
// platform/procurement/*) and UI (modules/canonical-sales.js) all already
// exist -- `parties`, `crm_leads`, `sale_orders`, `purchase_requisitions`,
// `purchase_orders` etc. all measured 0 rows in the review database before
// this fixture. This was a FIXTURE_ONLY gap, not a missing feature: seeding
// it here rather than building a second commercial engine, which the
// project's safety rules explicitly forbid.
//
// State literals are taken directly from what the live handlers check, not
// guessed: platform/sales/lifecycle.mjs (quotation_state: draft -> sent ->
// approved -> accepted, or state='cancelled'), platform/procurement/rfq.mjs
// (requisition must be 'approved' before an RFQ; a supplier_quotation must
// be 'awarded' before a purchase order can reference it), and
// platform/procurement/orders.mjs (purchase_orders: draft -> approved ->
// 'purchase' on confirmation). There is no reject/decline transition in
// platform/sales/lifecycle.mjs, so no "rejected quotation" row is seeded --
// the capability does not currently exist to demonstrate.
//
// Never real data, never written outside a disposable review database. All
// invented ids are prefixed `rev_` and every insert is idempotent via
// ON CONFLICT(id) DO NOTHING.

'use strict';

const SALESPERSON = 'usr_review_workshop_manager';
const REQUESTED_BY = 'usr_review_ops_coordinator';

const STEEL_TUBE = 'rev_prod_var_steel_tube_01';
const GATE_HINGE = 'rev_prod_var_gate_hinge_01';

const DAY_MS = 86400000;

/**
 * @returns {Promise<{summary: object}>}
 */
export async function seedCommercialPipelineFixtures(dialect, { companyId, now } = {}) {
  const ts = now || new Date().toISOString();
  const nowMs = Date.parse(ts);
  const iso = (offsetDays) => new Date(nowMs + offsetDays * DAY_MS).toISOString();

  // --- parties: customers and suppliers share one canonical entity -------
  const PARTIES = [
    { id: 'rev_party_customer_ahmed', isCompany: 0, name: '[DEMO] Ahmed Al-Rawi', status: 'active', phone: '+964 770 000 1001', email: 'ahmed.demo@example.test' },
    { id: 'rev_party_customer_alnoor', isCompany: 1, name: '[DEMO] Al-Noor Trading Co.', status: 'active', phone: '+964 770 000 1002', email: 'sales@alnoor-demo.test' },
    { id: 'rev_party_customer_dormant', isCompany: 1, name: '[DEMO] Dormant Construction LLC', status: 'inactive', phone: '+964 770 000 1003', email: 'info@dormant-demo.test' },
    { id: 'rev_party_supplier_steel', isCompany: 1, name: '[DEMO] Iraqi Steel Supply Co.', status: 'active', phone: '+964 770 000 2001', email: 'orders@steelsupply-demo.test' },
    { id: 'rev_party_supplier_hardware', isCompany: 1, name: '[DEMO] Gulf Hardware Wholesale', status: 'active', phone: '+964 770 000 2002', email: 'sales@gulfhardware-demo.test' },
  ];
  const insertParty = dialect.prepare(`
    INSERT INTO parties (id, company_id, is_company, name, status, phone, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `);
  for (const p of PARTIES) insertParty.run(p.id, companyId, p.isCompany, p.name, p.status, p.phone, p.email, ts, ts);

  // --- price list ---------------------------------------------------------
  dialect.prepare(`
    INSERT INTO price_lists (id, company_id, name, currency_id, is_active, created_at)
    VALUES ('rev_pricelist_standard', ?, '[DEMO] Al-Warsha Standard Price List', 'IQD', 1, ?) ON CONFLICT(id) DO NOTHING
  `).run(companyId, ts);

  // --- CRM: one lead per stage --------------------------------------------
  const LEADS = [
    { id: 'rev_lead_new_01', name: '[DEMO] Custom balcony railing inquiry', partnerId: null, contact: '[DEMO] Sara Hassan', stage: 'new', revenue: 850000, probability: 10 },
    { id: 'rev_lead_qualified_01', name: '[DEMO] Warehouse racking fabrication', partnerId: null, contact: '[DEMO] Karim Odeh', stage: 'qualified', revenue: 3200000, probability: 40 },
    { id: 'rev_lead_won_01', name: '[DEMO] Al-Noor gate order', partnerId: 'rev_party_customer_alnoor', contact: '[DEMO] Al-Noor Trading Co.', stage: 'won', revenue: 1450000, probability: 100 },
  ];
  const insertLead = dialect.prepare(`
    INSERT INTO crm_leads (id, company_id, name, partner_id, contact_name, stage, expected_revenue, probability, salesperson_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `);
  for (const l of LEADS) insertLead.run(l.id, companyId, l.name, l.partnerId, l.contact, l.stage, l.revenue, l.probability, SALESPERSON, ts, ts);

  dialect.prepare(`
    INSERT INTO crm_activities (id, lead_id, activity_type, summary, done, due_date, created_at)
    VALUES ('rev_activity_01', 'rev_lead_qualified_01', 'call', '[DEMO] Follow-up call to confirm racking dimensions', 0, ?, ?) ON CONFLICT(id) DO NOTHING
  `).run(iso(2), ts);

  // --- sale orders: draft quotation, sent quotation, confirmed, cancelled -
  const ORDERS = [
    { id: 'rev_so_quotation_draft_01', partnerId: 'rev_party_customer_ahmed', state: 'draft', quotationState: 'draft', amount: 850000 },
    { id: 'rev_so_quotation_sent_01', partnerId: 'rev_party_customer_alnoor', state: 'draft', quotationState: 'sent', amount: 3200000, validity: iso(14) },
    { id: 'rev_so_confirmed_01', partnerId: 'rev_party_customer_alnoor', state: 'sale', quotationState: 'accepted', amount: 1450000, accepted: ts },
    { id: 'rev_so_cancelled_01', partnerId: 'rev_party_customer_ahmed', state: 'cancelled', quotationState: 'sent', amount: 620000, cancelled: ts, reason: '[DEMO] Customer postponed the project' },
  ];
  const insertOrder = dialect.prepare(`
    INSERT INTO sale_orders (
      id, company_id, name, partner_id, pricelist_id, currency_id, state,
      amount_untaxed, amount_tax, amount_total, order_date, created_at,
      quotation_state, validity_date, accepted_at, cancelled_at, cancel_reason
    ) VALUES (?, ?, ?, ?, 'rev_pricelist_standard', 'IQD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const o of ORDERS) {
    const tax = Math.round(o.amount * 0.0);
    insertOrder.run(o.id, companyId, `[DEMO] ${o.id}`, o.partnerId, o.state, o.amount, tax, o.amount + tax, ts, ts, o.quotationState, o.validity || null, o.accepted || null, o.cancelled || null, o.reason || '');
  }
  const insertOrderLine = dialect.prepare(`
    INSERT INTO sale_order_lines (id, order_id, product_id, name, product_uom_qty, product_uom, price_unit, price_subtotal, price_total, created_at)
    VALUES (?, ?, ?, ?, ?, 'rev_uom_each', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `);
  insertOrderLine.run('rev_sol_01', 'rev_so_quotation_draft_01', GATE_HINGE, '[DEMO] Balcony railing hinge set', 4, 25000, 100000, 100000, ts);
  insertOrderLine.run('rev_sol_02', 'rev_so_quotation_sent_01', STEEL_TUBE, '[DEMO] 40mm steel tube, racking frame', 60, 18000, 1080000, 1080000, ts);
  insertOrderLine.run('rev_sol_03', 'rev_so_confirmed_01', GATE_HINGE, '[DEMO] Gate hinge set, Al-Noor order', 10, 25000, 250000, 250000, ts);
  insertOrderLine.run('rev_sol_04', 'rev_so_cancelled_01', STEEL_TUBE, '[DEMO] Steel tube, cancelled order', 20, 18000, 360000, 360000, ts);

  dialect.prepare(`
    INSERT INTO sale_contracts (id, company_id, name, partner_id, sale_order_id, state, start_date, recurring_amount, created_at, activated_at)
    VALUES ('rev_contract_01', ?, '[DEMO] Al-Noor recurring maintenance contract', 'rev_party_customer_alnoor', 'rev_so_confirmed_01', 'active', ?, 150000, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(companyId, iso(-30), ts, ts);

  // --- procurement: requisition -> RFQ -> two competing quotes -> PO ------
  dialect.prepare(`
    INSERT INTO supplier_qualifications (id, company_id, supplier_id, status, rating, created_at)
    VALUES ('rev_qual_steel', ?, 'rev_party_supplier_steel', 'approved', 4.5, ?) ON CONFLICT(id) DO NOTHING
  `).run(companyId, ts);
  dialect.prepare(`
    INSERT INTO supplier_qualifications (id, company_id, supplier_id, status, rating, created_at)
    VALUES ('rev_qual_hardware', ?, 'rev_party_supplier_hardware', 'approved', 4.0, ?) ON CONFLICT(id) DO NOTHING
  `).run(companyId, ts);

  dialect.prepare(`
    INSERT INTO purchase_requisitions (id, company_id, name, requested_by, state, requisition_date, created_at, approved_by, approved_at)
    VALUES ('rev_pr_01', ?, '[DEMO] Steel tube restock requisition', ?, 'approved', ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(companyId, REQUESTED_BY, iso(-5), ts, SALESPERSON, ts);
  dialect.prepare(`
    INSERT INTO purchase_requisition_lines (id, requisition_id, product_id, qty, uom_id, estimated_unit_cost, created_at)
    VALUES ('rev_prl_01', 'rev_pr_01', ?, 200, 'rev_uom_each', 16000, ?) ON CONFLICT(id) DO NOTHING
  `).run(STEEL_TUBE, ts);

  dialect.prepare(`
    INSERT INTO purchase_rfqs (id, company_id, name, requisition_id, state, deadline, created_at, issued_at)
    VALUES ('rev_rfq_01', ?, '[DEMO] Steel tube RFQ', 'rev_pr_01', 'awarded', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(companyId, iso(-2), iso(-4), ts);

  dialect.prepare(`
    INSERT INTO supplier_quotations (id, rfq_id, supplier_id, currency_id, total_amount, valid_until, is_awarded, state, lead_time_days, created_at)
    VALUES ('rev_sq_awarded_01', 'rev_rfq_01', 'rev_party_supplier_steel', 'IQD', 3200000, ?, 1, 'awarded', 7, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(iso(10), ts);
  dialect.prepare(`
    INSERT INTO supplier_quotations (id, rfq_id, supplier_id, currency_id, total_amount, valid_until, is_awarded, state, lead_time_days, created_at)
    VALUES ('rev_sq_received_01', 'rev_rfq_01', 'rev_party_supplier_hardware', 'IQD', 3450000, ?, 0, 'received', 12, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(iso(10), ts);

  dialect.prepare(`
    INSERT INTO purchase_orders (id, company_id, name, supplier_id, rfq_id, currency_id, state, amount_untaxed, amount_tax, amount_total, order_date, created_at, selected_quotation_id, expected_date, approved_by, approved_at)
    VALUES ('rev_po_01', ?, '[DEMO] Steel tube purchase order', 'rev_party_supplier_steel', 'rev_rfq_01', 'IQD', 'purchase', 3200000, 0, 3200000, ?, ?, 'rev_sq_awarded_01', ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(companyId, ts, ts, iso(7), SALESPERSON, ts);
  dialect.prepare(`
    INSERT INTO purchase_order_lines (id, order_id, product_id, name, product_qty, product_uom, price_unit, price_subtotal, price_total, created_at)
    VALUES ('rev_pol_01', 'rev_po_01', ?, '[DEMO] 40mm steel tube, restock', 200, 'rev_uom_each', 16000, 3200000, 3200000, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(STEEL_TUBE, ts);

  dialect.prepare(`
    INSERT INTO three_way_matches (id, company_id, purchase_order_id, match_status, notes, created_at)
    VALUES ('rev_3way_01', ?, 'rev_po_01', 'pending', '[DEMO] Awaiting receipt and supplier bill', ?)
    ON CONFLICT(id) DO NOTHING
  `).run(companyId, ts);

  return {
    summary: {
      partiesCreated: PARTIES.length,
      leadsCreated: LEADS.length,
      ordersCreated: ORDERS.length,
      procurementChain: 'requisition(approved) -> rfq(awarded) -> 2 supplier quotations -> purchase_order(purchase) -> three_way_match(pending)',
      tables: ['parties', 'crm_leads', 'crm_activities', 'sale_orders', 'sale_order_lines', 'sale_contracts', 'price_lists', 'supplier_qualifications', 'purchase_requisitions', 'purchase_requisition_lines', 'purchase_rfqs', 'supplier_quotations', 'purchase_orders', 'purchase_order_lines', 'three_way_matches'],
      companyId,
    },
  };
}
