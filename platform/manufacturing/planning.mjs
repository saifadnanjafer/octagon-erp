// Material Requirements Planning.
//
// MRP here is a *proposal engine*, never a committing engine. A planning run
// reads demand and supply, computes net requirements, and writes rows to
// `planning_proposals`. Nothing is reserved, ordered, or posted until a human
// executes `manufacturing:planning:accept`, which is a separate governed action
// with its own permission and its own audit entry.
//
// Every proposal carries its demand lineage (`demand_source_type` /
// `demand_source_id`), so a purchase requisition created three steps later can
// still be traced back to the sales order or shortage that caused it.

import {
  ManufacturingError, makeId, nowIso, positive, requireActor, requireCompany,
  round6, scopedRow,
} from './shared.mjs';
import { createProductionOrder } from './orders.mjs';
import { createRequisition } from '../procurement/governance.mjs';

const REORDER_POLICIES = ['make', 'buy', 'subcontract', 'transfer'];

export function setPlanningPolicy(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const product = db.prepare('SELECT id, company_id FROM product_variants WHERE id = ?').get(payload.product_id);
  if (!product || product.company_id !== companyId) {
    throw new ManufacturingError('planning policy product is outside the active company', 'COMPANY_SCOPE_VIOLATION', 403);
  }
  const policy = payload.reorder_policy || 'buy';
  if (!REORDER_POLICIES.includes(policy)) {
    throw new ManufacturingError(`unsupported reorder_policy: ${policy}`, 'INPUT_INVALID');
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO product_planning_policies (
      product_id, company_id, reorder_policy, safety_stock, lead_time_days,
      minimum_order_quantity, order_multiple, lot_sizing, preferred_supplier_id,
      preferred_warehouse_id, is_active, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(product_id, company_id) DO UPDATE SET
      reorder_policy = excluded.reorder_policy,
      safety_stock = excluded.safety_stock,
      lead_time_days = excluded.lead_time_days,
      minimum_order_quantity = excluded.minimum_order_quantity,
      order_multiple = excluded.order_multiple,
      lot_sizing = excluded.lot_sizing,
      preferred_supplier_id = excluded.preferred_supplier_id,
      preferred_warehouse_id = excluded.preferred_warehouse_id,
      is_active = 1,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    payload.product_id, companyId, policy,
    Number(payload.safety_stock || 0), Number(payload.lead_time_days || 0),
    Number(payload.minimum_order_quantity || 0), Number(payload.order_multiple || 0),
    payload.lot_sizing || 'lot_for_lot', payload.preferred_supplier_id || null,
    payload.preferred_warehouse_id || null, now, actor,
  );
  return db.prepare(
    'SELECT * FROM product_planning_policies WHERE product_id = ? AND company_id = ?',
  ).get(payload.product_id, companyId);
}

function policyFor(db, companyId, productId) {
  return db.prepare(
    'SELECT * FROM product_planning_policies WHERE product_id = ? AND company_id = ? AND is_active = 1',
  ).get(productId, companyId) || {
    reorder_policy: 'buy',
    safety_stock: 0,
    lead_time_days: 0,
    minimum_order_quantity: 0,
    order_multiple: 0,
    lot_sizing: 'lot_for_lot',
    preferred_supplier_id: null,
    preferred_warehouse_id: null,
  };
}

/**
 * Available = on hand − reserved, summed over internal locations only. Stock
 * sitting in a production or subcontractor location is deliberately excluded:
 * it is already committed to an order.
 */
function availableStock(db, companyId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(q.quantity - q.reserved_quantity), 0) AS available
    FROM stock_quants q
    JOIN stock_locations l ON l.id = q.location_id
    WHERE q.company_id = ? AND q.product_id = ? AND l.usage IN ('internal', 'transit')
  `).get(companyId, productId);
  return Number(row?.available || 0);
}

function openPurchaseSupply(db, companyId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(pol.product_qty - pol.qty_received), 0) AS pending
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.order_id
    WHERE po.company_id = ? AND pol.product_id = ?
      AND po.state NOT IN ('cancel', 'done')
      AND pol.product_qty > pol.qty_received
  `).get(companyId, productId);
  return Number(row?.pending || 0);
}

function openManufacturingSupply(db, companyId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(planned_quantity - completed_quantity), 0) AS pending
    FROM production_orders
    WHERE company_id = ? AND product_id = ?
      AND state IN ('planned', 'approved', 'released', 'in_progress', 'partially_completed')
  `).get(companyId, productId);
  return Number(row?.pending || 0);
}

/**
 * Dependent demand: every component shortage recorded on an open manufacturing
 * order. This is the link that makes MRP multi-level without a second explosion
 * pass — release already exploded the BOM.
 */
function dependentDemand(db, companyId) {
  return db.prepare(`
    SELECT m.product_id,
           SUM(m.shortage_quantity) AS quantity,
           MIN(o.scheduled_start) AS need_date,
           MIN(o.id) AS demand_source_id
    FROM production_order_materials m
    JOIN production_orders o ON o.id = m.order_id
    WHERE m.company_id = ? AND m.shortage_quantity > 0
      AND o.state IN ('released', 'in_progress', 'partially_completed')
    GROUP BY m.product_id
  `).all(companyId).map((row) => ({
    product_id: row.product_id,
    quantity: Number(row.quantity),
    need_date: row.need_date,
    demand_source_type: 'production_order',
    demand_source_id: row.demand_source_id,
  }));
}

/**
 * Independent demand: unfulfilled confirmed sales order lines.
 */
function independentDemand(db, companyId) {
  const hasView = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'view' AND name = 'sale_order_line_fulfilment'",
  ).get();
  if (!hasView) return [];
  return db.prepare(`
    SELECT sol.product_id,
           SUM(sol.product_uom_qty - COALESCE(f.delivered_quantity, 0)) AS quantity,
           MIN(so.id) AS demand_source_id
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
    LEFT JOIN sale_order_line_fulfilment f ON f.sale_order_line_id = sol.id
    WHERE so.company_id = ? AND so.state = 'sale'
      AND sol.product_uom_qty > COALESCE(f.delivered_quantity, 0)
    GROUP BY sol.product_id
  `).all(companyId).map((row) => ({
    product_id: row.product_id,
    quantity: Number(row.quantity),
    need_date: null,
    demand_source_type: 'sale_order',
    demand_source_id: row.demand_source_id,
  }));
}

function applyLotSizing(quantity, policy) {
  let qty = quantity;
  const minimum = Number(policy.minimum_order_quantity || 0);
  if (minimum > 0 && qty < minimum) qty = minimum;
  const multiple = Number(policy.order_multiple || 0);
  if (multiple > 0) qty = Math.ceil(qty / multiple) * multiple;
  return round6(qty);
}

function addDays(isoDate, days) {
  const base = isoDate ? new Date(isoDate) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() - Number(days || 0));
  return base.toISOString();
}

/**
 * Run a planning cycle and write proposals.
 *
 * `payload.demands` lets a caller inject a forecast or a master production
 * schedule line — the foundation the spec asks for — without MRP having to own
 * a forecast table it cannot yet populate honestly.
 */
export function runMaterialPlanning(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const now = nowIso();
  const runId = makeId('mrp');

  const demands = [
    ...dependentDemand(db, companyId),
    ...independentDemand(db, companyId),
    ...(Array.isArray(payload.demands) ? payload.demands.map((demand) => ({
      product_id: demand.product_id,
      quantity: Number(demand.quantity),
      need_date: demand.need_date || null,
      demand_source_type: demand.demand_source_type || 'forecast',
      demand_source_id: demand.demand_source_id || runId,
    })) : []),
  ].filter((demand) => demand.product_id && Number(demand.quantity) > 0);

  db.prepare(`
    INSERT INTO planning_runs (
      id, company_id, run_type, demand_count, proposal_count, exception_count,
      status, started_at, started_by, completed_at
    ) VALUES (?, ?, ?, ?, 0, 0, 'running', ?, ?, NULL)
  `).run(runId, companyId, payload.run_type || 'mrp', demands.length, now, actor);

  const aggregated = new Map();
  for (const demand of demands) {
    const existing = aggregated.get(demand.product_id);
    if (existing) {
      existing.quantity = round6(existing.quantity + demand.quantity);
      existing.sources.push({ type: demand.demand_source_type, id: demand.demand_source_id });
      if (demand.need_date && (!existing.need_date || demand.need_date < existing.need_date)) {
        existing.need_date = demand.need_date;
      }
    } else {
      aggregated.set(demand.product_id, {
        product_id: demand.product_id,
        quantity: round6(demand.quantity),
        need_date: demand.need_date,
        sources: [{ type: demand.demand_source_type, id: demand.demand_source_id }],
      });
    }
  }

  const insertProposal = db.prepare(`
    INSERT INTO planning_proposals (
      id, run_id, company_id, product_id, proposal_type, quantity, gross_demand,
      available_stock, open_supply, safety_stock, net_requirement, need_date,
      order_date, demand_source_type, demand_source_id, demand_lineage,
      preferred_supplier_id, warehouse_id, status, exception_code, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
  `);
  const insertException = db.prepare(`
    INSERT INTO planning_exceptions (
      id, run_id, company_id, product_id, exception_code, message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let proposalCount = 0;
  let exceptionCount = 0;
  const proposals = [];

  for (const demand of [...aggregated.values()].sort((a, b) => String(a.product_id).localeCompare(String(b.product_id)))) {
    const policy = policyFor(db, companyId, demand.product_id);
    const available = availableStock(db, companyId, demand.product_id);
    const openSupply = openPurchaseSupply(db, companyId, demand.product_id)
      + openManufacturingSupply(db, companyId, demand.product_id);
    const safety = Number(policy.safety_stock || 0);
    const net = round6(demand.quantity + safety - available - openSupply);

    if (net <= 0) continue;

    const quantity = applyLotSizing(net, policy);
    const orderDate = addDays(demand.need_date, policy.lead_time_days);
    const exceptionCode = demand.need_date && orderDate && orderDate < now
      ? 'ORDER_DATE_IN_THE_PAST'
      : null;
    if (exceptionCode) {
      insertException.run(
        makeId('mrpx'), runId, companyId, demand.product_id, exceptionCode,
        `Lead time ${policy.lead_time_days} day(s) means this should already have been ordered`,
        now,
      );
      exceptionCount += 1;
    }

    const id = makeId('mrpp');
    insertProposal.run(
      id, runId, companyId, demand.product_id, policy.reorder_policy, quantity,
      demand.quantity, available, openSupply, safety, net, demand.need_date || null,
      orderDate, demand.sources[0]?.type || 'forecast', String(demand.sources[0]?.id || runId),
      JSON.stringify(demand.sources), policy.preferred_supplier_id || null,
      policy.preferred_warehouse_id || null, exceptionCode, now,
    );
    proposalCount += 1;
    proposals.push({
      id,
      product_id: demand.product_id,
      proposal_type: policy.reorder_policy,
      quantity,
      gross_demand: demand.quantity,
      available_stock: available,
      open_supply: openSupply,
      safety_stock: safety,
      net_requirement: net,
      need_date: demand.need_date || null,
      order_date: orderDate,
      exception_code: exceptionCode,
    });
  }

  db.prepare(`
    UPDATE planning_runs SET proposal_count = ?, exception_count = ?, status = 'completed',
      completed_at = ? WHERE id = ?
  `).run(proposalCount, exceptionCount, nowIso(), runId);

  return {
    run_id: runId,
    demand_count: demands.length,
    proposal_count: proposalCount,
    exception_count: exceptionCount,
    proposals,
  };
}

/**
 * Turn one proposal into a real document. This is the only place a planning
 * figure becomes a commitment, and it is a distinct governed action so the
 * approval is recorded against a person.
 */
export function acceptPlanningProposal(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const proposal = scopedRow(db, 'planning_proposals', payload.proposal_id, companyId, 'planning proposal');
  if (proposal.status !== 'proposed') {
    throw new ManufacturingError(`proposal is already ${proposal.status}`, 'PLANNING_PROPOSAL_DECIDED');
  }
  const quantity = positive(payload.quantity || proposal.quantity, 'accepted quantity');
  const now = nowIso();
  let resultType = null;
  let resultId = null;

  if (proposal.proposal_type === 'make') {
    const order = createProductionOrder(db, {
      company_id: companyId,
      branch_id: payload.branch_id || null,
      actor,
      actor_id: actor,
      product_id: proposal.product_id,
      planned_quantity: quantity,
      warehouse_id: proposal.warehouse_id || payload.warehouse_id || null,
      demand_source_type: proposal.demand_source_type,
      demand_source_id: proposal.demand_source_id,
      planning_proposal_id: proposal.id,
      scheduled_start: proposal.order_date,
      scheduled_end: proposal.need_date,
      project_id: payload.project_id || null,
    });
    resultType = 'production_order';
    resultId = order.id;
  } else if (proposal.proposal_type === 'buy' || proposal.proposal_type === 'subcontract') {
    const uomId = db.prepare(
      'SELECT t.uom_id FROM product_templates t JOIN product_variants v ON v.template_id = t.id WHERE v.id = ?',
    ).get(proposal.product_id)?.uom_id;
    const requisition = createRequisition(db, {
      company_id: companyId,
      name: `MRP ${proposal.id}`,
      requested_by: actor,
      lines: [{ product_id: proposal.product_id, qty: quantity, uom_id: uomId, estimated_unit_cost: 0 }],
    });
    resultType = 'purchase_requisition';
    resultId = requisition.id;
  } else if (proposal.proposal_type === 'transfer') {
    // A transfer proposal is a planner instruction, not a document: the WMS
    // picking is created by the warehouse module from this lineage.
    resultType = 'stock_transfer_request';
    resultId = proposal.id;
  } else {
    throw new ManufacturingError(`unsupported proposal_type: ${proposal.proposal_type}`, 'INPUT_INVALID');
  }

  db.prepare(`
    UPDATE planning_proposals SET status = 'accepted', accepted_quantity = ?,
      result_type = ?, result_id = ?, decided_by = ?, decided_at = ? WHERE id = ?
  `).run(quantity, resultType, resultId, actor, now, proposal.id);

  return {
    proposal_id: proposal.id,
    proposal_type: proposal.proposal_type,
    quantity,
    result_type: resultType,
    result_id: resultId,
    demand_source_type: proposal.demand_source_type,
    demand_source_id: proposal.demand_source_id,
  };
}

export function rejectPlanningProposal(db, payload = {}) {
  const companyId = requireCompany(payload);
  const actor = requireActor(payload);
  const proposal = scopedRow(db, 'planning_proposals', payload.proposal_id, companyId, 'planning proposal');
  if (proposal.status !== 'proposed') {
    throw new ManufacturingError(`proposal is already ${proposal.status}`, 'PLANNING_PROPOSAL_DECIDED');
  }
  db.prepare(`
    UPDATE planning_proposals SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?
  `).run(actor, nowIso(), proposal.id);
  return { proposal_id: proposal.id, status: 'rejected' };
}

export function getPlannerWorklist(db, { company_id, run_id = null, status = 'proposed' }) {
  let sql = 'SELECT * FROM planning_proposals WHERE company_id = ?';
  const params = [company_id];
  if (run_id) { sql += ' AND run_id = ?'; params.push(run_id); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY need_date IS NULL, need_date, created_at';
  const proposals = db.prepare(sql).all(...params);
  const exceptions = run_id
    ? db.prepare('SELECT * FROM planning_exceptions WHERE company_id = ? AND run_id = ?').all(company_id, run_id)
    : db.prepare('SELECT * FROM planning_exceptions WHERE company_id = ? ORDER BY created_at DESC LIMIT 100').all(company_id);
  return { proposals, exceptions };
}
