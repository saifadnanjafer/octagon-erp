// Sales lifecycle expansion (Checkpoint C) — CRM opportunities, quotation
// lifecycle, order cancel/reserve, customer returns, and commission foundation.
//
// Clean-room adaptation of the project-owned VNext sales engine lifecycle
// (octagon-erp-commercial-vnext/vnext/server/modules/sales/sales-engine.js),
// re-expressed on this repository's canonical authorities: parties, finance
// (credit exposure, approval authority, source facts), inventory reservations,
// and WMS pickings. All handlers run inside the ActionExecutor transaction.

import crypto from 'node:crypto';
import { createPicking } from '../wms/operations.mjs';
import { reserveStock, releaseReservation } from '../inventory/reservations.mjs';
import { executeStockOperation } from '../inventory/operations.mjs';
import { getProductValuation } from '../inventory/valuation.mjs';
import {
  getCreditExposure,
  checkApprovalAuthority,
  postSourceFact,
} from '../finance/engine.mjs';
import { createQuotation, getSaleOrder } from './orders.mjs';

class SalesError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SalesError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new SalesError(message, code);
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

function resolveWarehouse(db, warehouse_id, company_id, branch_id) {
  const wh = db.prepare('SELECT * FROM warehouses WHERE id = ? AND company_id = ?').get(warehouse_id, company_id);
  if (!wh) fail(`Warehouse not found: ${warehouse_id}`, 'WAREHOUSE_NOT_FOUND');
  if (branch_id && !db.prepare(`
    SELECT 1 FROM warehouse_branch_scopes
    WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
  `).get(warehouse_id, company_id, branch_id)) {
    fail('Sales warehouse is outside the active branch scope', 'BRANCH_SCOPE_DENIED');
  }
  return wh;
}

function resolveCustomerLocation(db, company_id) {
  let custLoc = db.prepare(`SELECT id FROM stock_locations WHERE usage = 'customer' AND (company_id = ? OR company_id = '*')`).get(company_id);
  if (!custLoc) {
    const newLocId = `loc_cust_${crypto.randomBytes(4).toString('hex')}`;
    db.prepare(`
      INSERT INTO stock_locations (id, company_id, name, complete_name, usage, created_at)
      VALUES (?, ?, 'Customers', 'Customers', 'customer', ?)
    `).run(newLocId, company_id, new Date().toISOString());
    custLoc = { id: newLocId };
  }
  return custLoc;
}

function ensurePickingType(db, company_id, warehouse_id, code, name) {
  let pickingType = db.prepare('SELECT id FROM stock_picking_types WHERE warehouse_id = ? AND code = ?').get(warehouse_id, code);
  if (!pickingType) {
    const id = `pt_${code === 'incoming' ? 'in' : 'out'}_${warehouse_id}`;
    db.prepare(`
      INSERT INTO stock_picking_types (id, company_id, warehouse_id, name, code, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, company_id, warehouse_id, name, code, new Date().toISOString());
    pickingType = { id };
  }
  return pickingType;
}

function remainingReservationQuantity(db, reservationId) {
  const row = db.prepare(`
    SELECT
      r.quantity,
      COALESCE(SUM(CASE WHEN e.event_type = 'consumed' THEN e.quantity ELSE 0 END), 0) AS consumed,
      COALESCE(SUM(CASE WHEN e.event_type IN ('released','expired') THEN e.quantity ELSE 0 END), 0) AS released,
      COALESCE(SUM(CASE WHEN e.event_type = 'reversed' THEN e.quantity ELSE 0 END), 0) AS reversed
    FROM stock_reservations r
    LEFT JOIN stock_reservation_events e ON e.reservation_id = r.id
    WHERE r.id = ?
    GROUP BY r.id
  `).get(reservationId);
  if (!row) return 0;
  return Math.max(0, Number(row.quantity) - Number(row.consumed) - Number(row.released) + Number(row.reversed));
}

export function getOpportunity(db, id) {
  const opportunity = db.prepare('SELECT * FROM crm_opportunities WHERE id = ?').get(id);
  if (!opportunity) return null;
  const activities = db.prepare('SELECT * FROM crm_opportunity_activities WHERE opportunity_id = ? ORDER BY created_at').all(id);
  return { ...opportunity, activities };
}

// crm_opportunity_activities was retired as a writable table by migration 066
// (066_crm_activity_subject_unification): it survives only as a read-only
// compatibility view over crm_activities. Every write here goes to the unified
// table instead, tagged subject_type='opportunity' like every other opportunity
// Activity. company_id and any source-lead lineage are resolved from the
// opportunity itself since this legacy call site never carried company_id.
function logOpportunityActivity(db, opportunityId, activityType, summary) {
  const opp = db.prepare('SELECT company_id, lead_id FROM crm_opportunities WHERE id = ?').get(opportunityId);
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO crm_activities (
      id, company_id, subject_type, lead_id, opportunity_id, activity_type, summary,
      done, state, due_date, created_at, created_by, updated_at
    ) VALUES (?, ?, 'opportunity', ?, ?, ?, ?, 1, 'completed', NULL, ?, 'system', ?)
  `).run(makeId('act'), opp?.company_id ?? '*', opp?.lead_id ?? null, opportunityId, activityType, summary, ts, ts);
}

// ---------------------------------------------------------------------------
// CRM: lead -> opportunity
// ---------------------------------------------------------------------------

export function convertLead(db, input) {
  const {
    id,
    partner_id,
    name,
    expected_value,
    probability,
    owner_user_id,
    expected_close_date,
    company_id,
    branch_id = null,
  } = input;

  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id);
  if (!lead || lead.company_id !== company_id) fail(`Lead not found: ${id}`, 'LEAD_NOT_FOUND');
  if (lead.stage === 'won' || lead.stage === 'lost') {
    fail(`Lead is already closed (${lead.stage})`, 'LEAD_ALREADY_CLOSED');
  }
  const party = db.prepare('SELECT id FROM parties WHERE id = ? AND (company_id = ? OR company_id = ?)').get(partner_id, company_id, '*');
  if (!party) fail('Opportunity party is outside the active company', 'PARTY_NOT_FOUND');

  const existing = db.prepare('SELECT * FROM crm_opportunities WHERE lead_id = ? AND company_id = ?').get(id, company_id);
  if (existing) {
    return { opportunity: getOpportunity(db, existing.id), lead, replay: true };
  }

  const opportunityId = makeId('opp');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO crm_opportunities (
      id, company_id, branch_id, lead_id, party_id, name, stage, expected_value,
      probability, owner_user_id, expected_close_date, status, lost_reason,
      version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 'open', '', 1, ?, ?)
  `).run(
    opportunityId,
    company_id,
    branch_id,
    id,
    partner_id,
    name || lead.name,
    Number(expected_value !== undefined ? expected_value : lead.expected_revenue),
    Number(probability !== undefined ? probability : lead.probability),
    owner_user_id || lead.salesperson_id || null,
    expected_close_date || null,
    now,
    now,
  );

  db.prepare(`UPDATE crm_leads SET stage = 'won', updated_at = ? WHERE id = ?`).run(now, id);
  db.prepare(`
    INSERT INTO crm_activities (id, lead_id, activity_type, summary, done, due_date, created_at)
    VALUES (?, ?, 'converted', ?, 1, NULL, ?)
  `).run(makeId('act'), id, `Lead converted to opportunity ${opportunityId}`, now);
  logOpportunityActivity(db, opportunityId, 'converted', `Opportunity created from lead ${id}`);

  return {
    opportunity: getOpportunity(db, opportunityId),
    lead: db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(id),
  };
}

export function updateOpportunityStage(db, input) {
  const { id, stage, company_id } = input;
  const validStages = ['new', 'qualified', 'proposition', 'negotiation'];
  if (!validStages.includes(stage)) fail(`Invalid opportunity stage: ${stage}`, 'OPPORTUNITY_STAGE_INVALID');

  const opportunity = db.prepare('SELECT * FROM crm_opportunities WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!opportunity) fail(`Opportunity not found: ${id}`, 'OPPORTUNITY_NOT_FOUND');
  if (opportunity.status !== 'open') fail('Only open opportunities can change stage', 'OPPORTUNITY_CLOSED');

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE crm_opportunities SET stage = ?, version = version + 1, updated_at = ? WHERE id = ?
  `).run(stage, now, id);
  logOpportunityActivity(db, id, 'stage', `Stage changed from ${opportunity.stage} to ${stage}`);
  return getOpportunity(db, id);
}

export function addOpportunityActivity(db, input) {
  const { id, summary, activity_type = 'follow_up', due_date = null, done = false, company_id } = input;
  const opportunity = db.prepare('SELECT id, lead_id FROM crm_opportunities WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!opportunity) fail(`Opportunity not found: ${id}`, 'OPPORTUNITY_NOT_FOUND');
  const text = String(summary || '').trim();
  if (!text) fail('Activity summary is required', 'ACTIVITY_SUMMARY_REQUIRED');
  const activityId = makeId('act');
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO crm_activities (
      id, company_id, subject_type, lead_id, opportunity_id, activity_type, summary,
      done, state, due_date, created_at, created_by, updated_at
    ) VALUES (?, ?, 'opportunity', ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?)
  `).run(
    activityId,
    company_id,
    opportunity.lead_id ?? null,
    id,
    String(activity_type || 'follow_up'),
    text,
    done ? 1 : 0,
    done ? 'completed' : 'planned',
    due_date || null,
    ts,
    ts,
  );
  return getOpportunity(db, id);
}

export function closeOpportunity(db, input) {
  const {
    id,
    outcome,
    lost_reason,
    spawn_quotation = false,
    lines = [],
    pricelist_id = null,
    currency_id = 'IQD',
    validity_date = null,
    notes,
    attachments,
    company_id,
  } = input;

  const opportunity = db.prepare('SELECT * FROM crm_opportunities WHERE id = ? AND company_id = ?').get(id, company_id);
  if (!opportunity) fail(`Opportunity not found: ${id}`, 'OPPORTUNITY_NOT_FOUND');
  if (opportunity.status !== 'open') fail('Opportunity is already closed', 'OPPORTUNITY_CLOSED');
  if (!['won', 'lost'].includes(outcome)) fail(`Invalid opportunity outcome: ${outcome}`, 'OPPORTUNITY_OUTCOME_INVALID');
  if (outcome === 'lost' && !String(lost_reason || '').trim()) {
    fail('A lost reason is required when closing an opportunity as lost', 'LOST_REASON_REQUIRED');
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE crm_opportunities
    SET status = ?, lost_reason = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(outcome, outcome === 'lost' ? String(lost_reason).trim() : '', now, id);

  let quotation = null;
  if (outcome === 'won' && spawn_quotation) {
    quotation = createQuotation(db, {
      company_id,
      partner_id: opportunity.party_id,
      pricelist_id,
      currency_id,
      validity_date,
      notes,
      attachments,
      lines,
    });
    db.prepare('UPDATE sale_orders SET source_opportunity_id = ? WHERE id = ?').run(id, quotation.id);
    quotation = getSaleOrder(db, quotation.id);
  }

  logOpportunityActivity(db, id, 'close', outcome === 'won'
    ? `Opportunity won${quotation ? `; draft quotation ${quotation.id} created` : ''}`
    : `Opportunity lost: ${String(lost_reason).trim()}`);

  return { opportunity: getOpportunity(db, id), quotation };
}

// ---------------------------------------------------------------------------
// Quotation lifecycle
// ---------------------------------------------------------------------------

function getScopedOrder(db, order_id, company_id) {
  const order = getSaleOrder(db, order_id);
  if (!order || order.company_id !== company_id) fail(`Sale order not found: ${order_id}`, 'SALES_ORDER_NOT_FOUND');
  return order;
}

export function submitQuotation(db, input) {
  const { order_id, company_id } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'draft') fail(`Quotation cannot be submitted from order state ${order.state}`, 'QUOTATION_STATE_INVALID');
  if (order.quotation_state !== 'draft') fail(`Quotation cannot be submitted from state ${order.quotation_state}`, 'QUOTATION_STATE_INVALID');

  db.prepare(`UPDATE sale_orders SET quotation_state = 'sent' WHERE id = ?`).run(order_id);
  return getSaleOrder(db, order_id);
}

export function approveQuotation(db, input) {
  const { order_id, company_id } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'draft' || order.quotation_state !== 'sent') {
    fail(`Quotation cannot be approved from state ${order.quotation_state}`, 'QUOTATION_STATE_INVALID');
  }

  const finCtx = financeContext(input);
  const exposure = getCreditExposure(db, finCtx, { partner_id: order.partner_id });
  if (exposure.is_held) fail('Customer is on credit hold', 'CREDIT_HOLD_ACTIVE');
  if (Number(exposure.credit_limit) > 0 && Number(exposure.exposure) + Number(order.amount_total) > Number(exposure.credit_limit) + 0.0001) {
    fail(
      `Credit limit exceeded: exposure ${exposure.exposure} + quotation ${order.amount_total} > limit ${exposure.credit_limit}`,
      'CREDIT_LIMIT_EXCEEDED',
    );
  }
  // Same approval-authority gate finance applies to governed postings: the
  // acting user must hold a post authority limit covering the quotation total
  // whenever a limit is configured (fail-closed when the company opted in).
  checkApprovalAuthority(db, finCtx, {
    role_or_user: input.actor,
    limit_type: 'post',
    amount: Number(order.amount_total),
  });

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sale_orders SET quotation_state = 'approved', approved_by = ?, approved_at = ? WHERE id = ?
  `).run(input.actor, now, order_id);
  return getSaleOrder(db, order_id);
}

export function acceptQuotation(db, input) {
  const { order_id, company_id } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'draft' || order.quotation_state !== 'approved') {
    fail(`Quotation cannot be accepted from state ${order.quotation_state}`, 'QUOTATION_STATE_INVALID');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (order.validity_date && order.validity_date < today) {
    fail(`Quotation validity expired on ${order.validity_date}`, 'QUOTATION_EXPIRED');
  }

  const now = new Date().toISOString();
  db.prepare(`UPDATE sale_orders SET quotation_state = 'accepted', accepted_at = ? WHERE id = ?`).run(now, order_id);
  return getSaleOrder(db, order_id);
}

export function reviseQuotation(db, input) {
  const { order_id, company_id } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'draft' || !['sent', 'approved'].includes(order.quotation_state)) {
    fail(`Quotation cannot be revised from state ${order.quotation_state}`, 'QUOTATION_STATE_INVALID');
  }

  const revisionId = makeId('so');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sale_orders (
      id, company_id, name, partner_id, pricelist_id, currency_id, state,
      amount_untaxed, amount_tax, amount_total, order_date, created_at,
      revision_no, quotation_state, validity_date, source_opportunity_id,
      discount_total, tax_total, notes, attachments, project_ref
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revisionId,
    order.company_id,
    order.name,
    order.partner_id,
    order.pricelist_id,
    order.currency_id,
    order.amount_untaxed,
    order.amount_tax,
    order.amount_total,
    new Date().toISOString().split('T')[0],
    now,
    Number(order.revision_no || 0) + 1,
    order.validity_date,
    order.source_opportunity_id,
    Number(order.discount_total || 0),
    Number(order.tax_total || 0),
    order.notes || '',
    JSON.stringify(order.attachments || []),
    order.project_ref || null,
  );

  const insertLine = db.prepare(`
    INSERT INTO sale_order_lines (
      id, order_id, product_id, name, product_uom_qty, qty_delivered, qty_invoiced,
      product_uom, price_unit, discount, price_subtotal, price_total, tax_id, tax_amount, created_at
    ) VALUES (?, ?, ?, ?, ?, 0.0, 0.0, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of order.lines) {
    insertLine.run(
      makeId('sol'),
      revisionId,
      line.product_id,
      line.name,
      line.product_uom_qty,
      line.product_uom,
      line.price_unit,
      line.discount,
      line.price_subtotal,
      line.price_total,
      line.tax_id || '',
      Number(line.tax_amount || 0),
      now,
    );
  }

  db.prepare(`
    UPDATE sale_orders SET quotation_state = 'superseded', superseded_by = ? WHERE id = ?
  `).run(revisionId, order_id);
  return { quotation: getSaleOrder(db, revisionId), superseded_order_id: order_id };
}

// ---------------------------------------------------------------------------
// Order cancel / reserve
// ---------------------------------------------------------------------------

export function cancelSalesOrder(db, input) {
  const { order_id, reason = '', company_id, actor, idempotency_key } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state === 'cancel') fail('Sale order is already cancelled', 'SALES_ORDER_ALREADY_CANCELLED');

  if (order.state === 'sale') {
    const delivered = db.prepare(`
      SELECT COALESCE(SUM(delivered_quantity), 0) AS qty FROM sale_order_line_fulfilment WHERE order_id = ?
    `).get(order_id);
    if (Number(delivered.qty) > 0) {
      fail('Confirmed order has posted deliveries; use sales:return:create instead', 'SALES_ORDER_HAS_DELIVERIES');
    }

    const activeReservations = db.prepare(`
      SELECT id FROM stock_reservations
      WHERE company_id = ? AND source_document_type = 'sale_order' AND source_document_id = ?
        AND status IN ('reserved', 'partially_reserved')
    `).all(company_id, order_id);
    for (const { id: reservationId } of activeReservations) {
      if (remainingReservationQuantity(db, reservationId) > 0) {
        releaseReservation(db, {
          company_id,
          reservation_id: reservationId,
          idempotency_key: `${idempotency_key}:release:${reservationId}`,
          actor,
        });
      }
    }

    const demands = db.prepare('SELECT * FROM sale_fulfilment_demands WHERE sale_order_id = ?').all(order_id);
    for (const demand of demands) {
      if (demand.picking_id) {
        const picking = db.prepare('SELECT id, state FROM stock_pickings WHERE id = ?').get(demand.picking_id);
        if (picking && picking.state !== 'done' && picking.state !== 'cancelled') {
          db.prepare(`UPDATE stock_pickings SET state = 'cancelled' WHERE id = ?`).run(picking.id);
        }
      }
      db.prepare(`UPDATE sale_fulfilment_demands SET status = 'cancelled' WHERE id = ?`).run(demand.id);
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sale_orders SET state = 'cancel', cancelled_at = ?, cancel_reason = ? WHERE id = ?
  `).run(now, String(reason || ''), order_id);
  return getSaleOrder(db, order_id);
}

export function reserveSalesOrder(db, input) {
  const { order_id, warehouse_id, company_id, branch_id = null, actor, idempotency_key } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'sale') fail('Only confirmed sales orders can be reserved', 'SALES_ORDER_NOT_CONFIRMED');
  const wh = resolveWarehouse(db, warehouse_id, company_id, branch_id);

  const outcomes = [];
  for (const line of order.lines) {
    const demand = db.prepare(`
      SELECT * FROM sale_fulfilment_demands WHERE sale_order_id = ? AND sale_order_line_id = ?
    `).get(order.id, line.id);
    if (!demand) {
      outcomes.push({ sale_order_line_id: line.id, status: 'no_demand', demanded: Number(line.product_uom_qty), reserved: 0, shortage: 0 });
      continue;
    }

    const fulfilment = db.prepare(`
      SELECT delivered_quantity FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?
    `).get(line.id);
    const delivered = Number(fulfilment?.delivered_quantity || 0);

    // Every still-active reservation for this line counts toward coverage,
    // not just the one currently linked on the fulfilment demand.
    const activeReservations = db.prepare(`
      SELECT id FROM stock_reservations
      WHERE company_id = ? AND source_document_type = 'sale_order' AND source_line_id = ?
        AND status IN ('reserved', 'partially_reserved')
    `).all(company_id, line.id);
    const activeReserved = activeReservations.reduce(
      (sum, { id: reservationId }) => sum + remainingReservationQuantity(db, reservationId),
      0,
    );

    const needed = Number(demand.demanded_quantity) - delivered - activeReserved;
    if (needed <= 0.0000001) {
      const status = delivered >= Number(demand.demanded_quantity) ? 'delivered' : 'reserved';
      outcomes.push({ sale_order_line_id: line.id, status, demanded: Number(demand.demanded_quantity), reserved: Number(demand.demanded_quantity) - delivered, shortage: 0 });
      continue;
    }

    let reservation = null;
    try {
      reservation = reserveStock(db, {
        company_id,
        branch_id,
        warehouse_id,
        location_id: wh.lot_stock_id,
        product_id: line.product_id,
        source_document_type: 'sale_order',
        source_document_id: order.id,
        source_line_id: line.id,
        quantity: needed,
        priority: 10,
        allow_partial: true,
        idempotency_key: `${idempotency_key}:reservation:${line.id}`,
        actor,
      });
    } catch (err) {
      if (!String(err && err.message ? err.message : err).startsWith('Available stock insufficient')) throw err;
    }

    const newReserved = Number(reservation ? reservation.quantity : 0);
    const totalReserved = activeReserved + newReserved;
    const shortage = Math.max(0, needed - newReserved);
    const status = shortage <= 0.0000001 ? 'reserved' : totalReserved > 0 ? 'partially_reserved' : 'shortage';
    if (reservation) {
      db.prepare('UPDATE sale_fulfilment_demands SET reservation_id = ?, status = ? WHERE id = ?').run(reservation.id, status, demand.id);
    } else {
      db.prepare('UPDATE sale_fulfilment_demands SET status = ? WHERE id = ?').run(status, demand.id);
    }
    outcomes.push({
      sale_order_line_id: line.id,
      status,
      demanded: Number(demand.demanded_quantity),
      reserved: totalReserved,
      shortage,
      reservation_id: reservation ? reservation.id : demand.reservation_id,
    });
  }
  return { order_id: order.id, lines: outcomes };
}

// ---------------------------------------------------------------------------
// Partial delivery + backorder
// ---------------------------------------------------------------------------

export function postSalesDelivery(db, input) {
  const {
    order_id,
    picking_id = null,
    lines = [],
    company_id,
    branch_id = null,
    actor,
    idempotency_key,
  } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'sale') fail('Only confirmed orders can be delivered', 'SALES_ORDER_NOT_CONFIRMED');
  if (!Array.isArray(lines) || !lines.length) fail('Delivery lines are required', 'DELIVERY_LINES_REQUIRED');

  const picking = db.prepare(`
    SELECT DISTINCT p.*
    FROM stock_pickings p
    JOIN sale_fulfilment_demands d ON d.picking_id = p.id
    WHERE d.sale_order_id = ? AND p.company_id = ?
      AND p.state NOT IN ('done','cancelled')
      AND (? IS NULL OR p.id = ?)
    ORDER BY p.created_at, p.id
    LIMIT 1
  `).get(order.id, company_id, picking_id, picking_id);
  if (!picking) fail('No open delivery exists for this sales order', 'DELIVERY_NOT_FOUND');

  const seen = new Set();
  const delivered = {};
  const postedMoves = [];
  for (const [index, requested] of lines.entries()) {
    const orderLine = order.lines.find((row) => row.id === requested.sale_order_line_id);
    if (!orderLine) fail(`Delivery line is outside the sales order: ${requested.sale_order_line_id}`, 'DELIVERY_LINE_NOT_FOUND');
    if (seen.has(orderLine.id)) fail(`Duplicate delivery line: ${orderLine.id}`, 'DELIVERY_LINE_DUPLICATE');
    seen.add(orderLine.id);

    const quantity = Number(requested.quantity);
    const fulfilment = db.prepare(`
      SELECT delivered_quantity FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?
    `).get(orderLine.id);
    const remaining = Number(orderLine.product_uom_qty) - Number(fulfilment?.delivered_quantity || 0);
    if (!(quantity > 0) || quantity > remaining + 0.0000001) {
      fail(`Delivery quantity ${quantity} exceeds remaining quantity ${remaining} for line ${orderLine.id}`, 'DELIVERY_QTY_INVALID');
    }

    const demand = db.prepare(`
      SELECT * FROM sale_fulfilment_demands
      WHERE sale_order_id = ? AND sale_order_line_id = ? AND picking_id = ?
    `).get(order.id, orderLine.id, picking.id);
    if (!demand || !demand.reservation_id) fail(`Delivery line is not reserved: ${orderLine.id}`, 'DELIVERY_RESERVATION_REQUIRED');
    if (remainingReservationQuantity(db, demand.reservation_id) + 0.0000001 < quantity) {
      fail(`Reserved quantity is insufficient for line ${orderLine.id}`, 'DELIVERY_RESERVATION_INSUFFICIENT');
    }

    const valuation = getProductValuation(db, { company_id, product_id: orderLine.product_id });
    const unitCost = valuation && Number(valuation.on_hand_qty) > 0
      ? Number(valuation.total_valuation) / Number(valuation.on_hand_qty)
      : 0;
    const move = executeStockOperation(db, {
      company_id,
      branch_id,
      actor,
      reference: picking.reference,
      product_id: orderLine.product_id,
      uom_id: orderLine.product_uom,
      product_qty: quantity,
      location_id: picking.location_id,
      location_dest_id: picking.location_dest_id,
      unit_cost: unitCost,
      source_document_type: 'sale_order',
      source_document_id: order.id,
      source_line_id: orderLine.id,
      reservation_id: demand.reservation_id,
      idempotency_key: `${idempotency_key}:move:${index}`,
    });
    delivered[orderLine.id] = quantity;
    postedMoves.push(move);
  }

  const remainingLines = order.lines.map((line) => {
    const row = db.prepare(`
      SELECT delivered_quantity FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?
    `).get(line.id);
    return {
      sale_order_line_id: line.id,
      remaining_quantity: Math.max(0, Number(line.product_uom_qty) - Number(row?.delivered_quantity || 0)),
    };
  }).filter((row) => row.remaining_quantity > 0.0000001);

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
    for (const remaining of remainingLines) {
      db.prepare(`
        UPDATE sale_fulfilment_demands
        SET picking_id = ?, status = 'backorder'
        WHERE sale_order_id = ? AND sale_order_line_id = ?
      `).run(backorder.id, order.id, remaining.sale_order_line_id);
    }
  } else {
    db.prepare("UPDATE sale_fulfilment_demands SET status = 'delivered' WHERE sale_order_id = ?").run(order.id);
  }

  const eventId = makeId('sdel');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sale_delivery_events (
      id, company_id, sale_order_id, picking_id, backorder_picking_id,
      state, delivered_quantities, actor, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId,
    company_id,
    order.id,
    picking.id,
    backorder?.id || null,
    backorder ? 'partial' : 'done',
    JSON.stringify(delivered),
    actor,
    now,
  );
  return {
    delivery_event: db.prepare('SELECT * FROM sale_delivery_events WHERE id = ?').get(eventId),
    picking: db.prepare('SELECT * FROM stock_pickings WHERE id = ?').get(picking.id),
    backorder,
    remaining_lines: remainingLines,
    moves: postedMoves,
  };
}

// ---------------------------------------------------------------------------
// Customer returns
// ---------------------------------------------------------------------------

export function createSalesReturn(db, input) {
  const {
    order_id,
    warehouse_id,
    lines = [],
    reason = '',
    company_id,
    branch_id = null,
    actor,
    idempotency_key,
  } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'sale') fail('Returns require a confirmed sales order', 'SALES_ORDER_NOT_CONFIRMED');
  if (!Array.isArray(lines) || !lines.length) fail('Return lines are required', 'RETURN_LINES_REQUIRED');
  const wh = resolveWarehouse(db, warehouse_id, company_id, branch_id);
  const custLoc = resolveCustomerLocation(db, order.company_id);

  const returnLines = lines.map((line) => {
    const orderLine = order.lines.find((candidate) => candidate.id === line.sale_order_line_id);
    if (!orderLine) fail(`Return line is outside the sales order: ${line.sale_order_line_id}`, 'RETURN_LINE_NOT_FOUND');
    const quantity = Number(line.quantity);
    const fulfilment = db.prepare(`
      SELECT delivered_quantity FROM sale_order_line_fulfilment WHERE sale_order_line_id = ?
    `).get(orderLine.id);
    const delivered = Number(fulfilment?.delivered_quantity || 0);
    const alreadyReturned = db.prepare(`
      SELECT COALESCE(SUM(srl.quantity), 0) AS qty
      FROM sale_return_lines srl
      JOIN sale_returns sr ON sr.id = srl.sale_return_id
      WHERE srl.sale_order_line_id = ? AND sr.state = 'done'
    `).get(orderLine.id);
    const returnable = delivered - Number(alreadyReturned.qty || 0);
    if (!(quantity > 0) || quantity > returnable + 0.0000001) {
      fail(`Return quantity ${quantity} exceeds returnable quantity ${returnable} for line ${orderLine.id}`, 'RETURN_QTY_EXCEEDS_DELIVERED');
    }
    return { orderLine, quantity, reason: line.reason || reason || 'customer return' };
  });

  const pickingType = ensurePickingType(db, order.company_id, wh.id, 'incoming', 'Incoming Receipts');
  const picking = createPicking(db, {
    company_id: order.company_id,
    picking_type_id: pickingType.id,
    reference: `RET/${order.name}`,
    origin: order.name,
    location_id: custLoc.id,
    location_dest_id: wh.lot_stock_id,
    partner_id: order.partner_id,
  });

  const returnId = makeId('sret');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sale_returns (id, company_id, sale_order_id, picking_id, credit_note_request_id, reason, state, actor, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, 'done', ?, ?)
  `).run(returnId, company_id, order.id, picking.id, String(reason || 'customer return'), actor, now);

  const insertedLines = [];
  for (const [index, { orderLine, quantity, reason: lineReason }] of returnLines.entries()) {
    const valuation = getProductValuation(db, { company_id, product_id: orderLine.product_id });
    const unitCost = valuation && Number(valuation.on_hand_qty) > 0
      ? Number(valuation.total_valuation) / Number(valuation.on_hand_qty)
      : 0;
    const move = executeStockOperation(db, {
      company_id,
      branch_id,
      actor,
      reference: picking.reference,
      product_id: orderLine.product_id,
      uom_id: orderLine.product_uom,
      product_qty: quantity,
      location_id: custLoc.id,
      location_dest_id: wh.lot_stock_id,
      unit_cost: unitCost,
      source_document_type: 'sale_return',
      source_document_id: returnId,
      source_line_id: orderLine.id,
      idempotency_key: `${idempotency_key}:move:${index}`,
    });
    const returnLineId = makeId('sretl');
    db.prepare(`
      INSERT INTO sale_return_lines (
        id, sale_return_id, company_id, sale_order_line_id, product_id, quantity, stock_move_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(returnLineId, returnId, company_id, orderLine.id, orderLine.product_id, quantity, move.id, now);
    insertedLines.push({ id: returnLineId, sale_order_line_id: orderLine.id, product_id: orderLine.product_id, quantity, reason: lineReason, stock_move_id: move.id });
  }
  db.prepare(`UPDATE stock_pickings SET state = 'done' WHERE id = ?`).run(picking.id);

  // Credit note against the original posted invoice, when one exists.
  let creditNote = null;
  const invoiceRequest = db.prepare(`
    SELECT * FROM commercial_fiscal_requests
    WHERE company_id = ? AND request_type = 'customer_invoice' AND source_document_id = ? AND status = 'posted'
  `).get(company_id, order.id);
  if (invoiceRequest && invoiceRequest.finance_document_id) {
    const creditLines = returnLines.map(({ orderLine, quantity }) => {
      const income = db.prepare(`
        SELECT category.income_account_id
        FROM product_variants variant
        JOIN product_templates template ON template.id = variant.template_id
        JOIN product_categories category ON category.id = template.category_id
        WHERE variant.id = ? AND variant.company_id = ?
      `).get(orderLine.product_id, company_id);
      if (!income?.income_account_id) fail(`Income account mapping is required for product ${orderLine.product_id}`, 'INCOME_ACCOUNT_MISSING');
      const amount = quantity * Number(orderLine.price_unit) * (1 - Number(orderLine.discount || 0) / 100);
      return {
        account_id: income.income_account_id,
        debit: amount,
        credit: 0,
        source_line_id: orderLine.id,
        product_id: orderLine.product_id,
        quantity,
        description: `${order.name}:return:${orderLine.name}`,
      };
    });
    const totalCredit = creditLines.reduce((sum, line) => sum + line.debit, 0);
    const receivable = db.prepare(`
      SELECT id FROM finance_accounts
      WHERE company_id = ? AND code = '103000' AND is_active = 1
    `).get(company_id);
    if (!receivable) fail('Canonical receivable account is missing', 'RECEIVABLE_ACCOUNT_MISSING');

    const posted = postSourceFact(db, financeContext(input), {
      fact_type: 'customer_credit_note_posting',
      move_type: 'customer_credit_note',
      source_document_type: 'sale_return',
      source_id: returnId,
      original_document_id: invoiceRequest.finance_document_id,
      doc_date: now.slice(0, 10),
      partner_id: order.partner_id,
      currency: order.currency_id,
      lines: [
        { account_id: receivable.id, debit: 0, credit: totalCredit, partner_id: order.partner_id, description: `${order.name}:return` },
        ...creditLines,
      ],
    });

    const creditRequestId = `cn_req_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO commercial_fiscal_requests (
        id, company_id, request_type, source_document_type, source_document_id,
        idempotency_key, finance_document_id, status, request_payload,
        created_at, updated_at
      ) VALUES (?, ?, 'customer_credit_note', 'sale_return', ?, ?, ?, 'posted', ?, ?, ?)
    `).run(
      creditRequestId,
      company_id,
      returnId,
      `${idempotency_key}:credit_note`,
      posted.document_id,
      JSON.stringify({ sale_return_id: returnId, sale_order_id: order.id, amount_total: totalCredit, lines: creditLines }),
      now,
      now,
    );
    db.prepare('UPDATE sale_returns SET credit_note_request_id = ? WHERE id = ?').run(creditRequestId, returnId);
    creditNote = { invoice_request_id: creditRequestId, finance_document_id: posted.document_id, amount_total: totalCredit };
  }

  return {
    sale_return: db.prepare('SELECT * FROM sale_returns WHERE id = ?').get(returnId),
    lines: insertedLines,
    picking_id: picking.id,
    credit_note: creditNote,
  };
}

// ---------------------------------------------------------------------------
// Commission foundation
// ---------------------------------------------------------------------------

export function accrueCommission(db, input) {
  const { order_id, salesperson_id, company_id } = input;
  const order = getScopedOrder(db, order_id, company_id);
  if (order.state !== 'sale') fail('Commission accrual requires a confirmed sales order', 'SALES_ORDER_NOT_CONFIRMED');
  if (!salesperson_id) fail('salesperson_id is required for commission accrual', 'SALESPERSON_REQUIRED');

  const existing = db.prepare(`
    SELECT * FROM sales_commission_events WHERE company_id = ? AND sale_order_id = ? AND salesperson_id = ?
  `).get(company_id, order.id, salesperson_id);
  if (existing) return { commission: existing, replay: true };

  const rule = db.prepare(`
    SELECT * FROM sales_commission_rules
    WHERE company_id = ? AND salesperson_id = ? AND is_active = 1
  `).get(company_id, salesperson_id) || db.prepare(`
    SELECT * FROM sales_commission_rules
    WHERE company_id = ? AND salesperson_id = '*' AND is_active = 1
  `).get(company_id);
  if (!rule || !(Number(rule.rate) > 0)) {
    fail(`No active commission rule for salesperson ${salesperson_id}`, 'COMMISSION_RULE_MISSING');
  }

  const basis = Number(order.amount_untaxed);
  const amount = Math.round((basis * Number(rule.rate) / 100 + Number.EPSILON) * 100) / 100;
  const id = makeId('comm');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sales_commission_events (
      id, company_id, salesperson_id, sale_order_id, amount, status, created_at,
      basis_amount, rate
    ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(id, company_id, salesperson_id, order.id, amount, now, basis, Number(rule.rate));
  return { commission: db.prepare('SELECT * FROM sales_commission_events WHERE id = ?').get(id) };
}

export function approveCommission(db, input) {
  const { commission_id, company_id, actor } = input;
  const commission = db.prepare('SELECT * FROM sales_commission_events WHERE id = ? AND company_id = ?').get(commission_id, company_id);
  if (!commission) fail(`Commission event not found: ${commission_id}`, 'COMMISSION_NOT_FOUND');
  if (commission.status !== 'pending') fail(`Commission cannot be approved from status ${commission.status}`, 'COMMISSION_STATE_INVALID');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sales_commission_events SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?
  `).run(actor, now, commission_id);
  return { commission: db.prepare('SELECT * FROM sales_commission_events WHERE id = ?').get(commission_id) };
}

export function markCommissionPaid(db, input) {
  const { commission_id, company_id, actor } = input;
  const commission = db.prepare('SELECT * FROM sales_commission_events WHERE id = ? AND company_id = ?').get(commission_id, company_id);
  if (!commission) fail(`Commission event not found: ${commission_id}`, 'COMMISSION_NOT_FOUND');
  if (commission.status !== 'approved') fail(`Commission cannot be marked paid from status ${commission.status}`, 'COMMISSION_STATE_INVALID');
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sales_commission_events SET status = 'paid', paid_by = ?, paid_at = ? WHERE id = ?
  `).run(actor, now, commission_id);
  return { commission: db.prepare('SELECT * FROM sales_commission_events WHERE id = ?').get(commission_id) };
}
