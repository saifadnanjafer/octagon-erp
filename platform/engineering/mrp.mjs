// MRP — demand, multi-level requirement explosion, and governed proposals.
// Checkpoint D2.
//
// Authority boundary that defines this module:
//   MRP PRODUCES PROPOSALS ONLY.
//
// A run reads canonical facts (stock quants, reservations, approved BOMs) and
// writes `mrp_requirements` + `mrp_proposals`. It creates no purchase order,
// no stock move, no reservation, and no financial commitment. Turning a
// proposal into a real document is a separate governed approval that hands off
// to the canonical Procurement / Inventory / Manufacturing authority.

'use strict';

import { fail, requireFields, makeId, effectiveBomVersion, effectiveBomForProduct } from './bom.mjs';
import { effectiveRoutingForProduct } from './routing.mjs';

const MAX_EXPLOSION_DEPTH = 12;

function now() {
  return new Date().toISOString();
}

function round(value) {
  return Number(Number(value || 0).toFixed(6));
}

// ---------------------------------------------------------------------------
// Item policies and demand
// ---------------------------------------------------------------------------

export function setItemPolicy(db, input = {}) {
  requireFields(input, ['product_id']);
  const companyId = input.company_id;
  const product = db.prepare("SELECT id FROM product_variants WHERE id = ? AND company_id IN (?, '*')")
    .get(input.product_id, companyId);
  if (!product) fail(`product variant not found: ${input.product_id}`, 'PRODUCT_NOT_FOUND', 404);

  const sourcing = String(input.sourcing || 'buy');
  if (!['make', 'buy', 'transfer', 'subcontract'].includes(sourcing)) {
    fail(`unsupported sourcing policy: ${sourcing}`, 'MRP_SOURCING_INVALID', 400);
  }
  const lotSizing = String(input.lot_sizing || 'lot_for_lot');
  if (!['lot_for_lot', 'fixed', 'min_max', 'economic'].includes(lotSizing)) {
    fail(`unsupported lot sizing: ${lotSizing}`, 'MRP_LOT_SIZING_INVALID', 400);
  }
  if (lotSizing === 'fixed' && !(Number(input.fixed_lot_size) > 0)) {
    fail('fixed lot sizing requires a positive fixed_lot_size', 'MRP_FIXED_LOT_SIZE_REQUIRED', 400);
  }
  if (sourcing === 'make') {
    // Making an item without an approved bill would produce an unbuildable plan.
    if (!effectiveBomForProduct(db, companyId, input.product_id)) {
      fail(
        'a make policy requires an approved BOM for this product',
        'MRP_MAKE_REQUIRES_APPROVED_BOM',
        409,
      );
    }
  }

  const stamp = now();
  const id = makeId('mrppol');
  db.prepare(`
    INSERT INTO mrp_item_policies (id, company_id, product_id, sourcing, safety_stock, reorder_point,
      lead_time_days, lot_sizing, fixed_lot_size, minimum_order_quantity, multiple_of,
      preferred_supplier_id, source_warehouse_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(company_id, product_id) DO UPDATE SET
      sourcing = excluded.sourcing,
      safety_stock = excluded.safety_stock,
      reorder_point = excluded.reorder_point,
      lead_time_days = excluded.lead_time_days,
      lot_sizing = excluded.lot_sizing,
      fixed_lot_size = excluded.fixed_lot_size,
      minimum_order_quantity = excluded.minimum_order_quantity,
      multiple_of = excluded.multiple_of,
      preferred_supplier_id = excluded.preferred_supplier_id,
      source_warehouse_id = excluded.source_warehouse_id,
      is_active = 1,
      updated_at = excluded.updated_at
  `).run(
    id, companyId, input.product_id, sourcing,
    Number(input.safety_stock || 0), Number(input.reorder_point || 0),
    Number(input.lead_time_days || 0), lotSizing, Number(input.fixed_lot_size || 0),
    Number(input.minimum_order_quantity || 0), Number(input.multiple_of || 0),
    input.preferred_supplier_id || null, input.source_warehouse_id || null, stamp, stamp,
  );
  return db.prepare('SELECT * FROM mrp_item_policies WHERE company_id = ? AND product_id = ?')
    .get(companyId, input.product_id);
}

export function recordDemand(db, input = {}) {
  requireFields(input, ['product_id', 'quantity']);
  const companyId = input.company_id;
  const product = db.prepare("SELECT id FROM product_variants WHERE id = ? AND company_id IN (?, '*')")
    .get(input.product_id, companyId);
  if (!product) fail(`product variant not found: ${input.product_id}`, 'PRODUCT_NOT_FOUND', 404);

  const quantity = Number(input.quantity);
  if (!(quantity > 0)) fail('demand quantity must be positive', 'MRP_DEMAND_QUANTITY_INVALID', 400);

  const demandType = String(input.demand_type || 'manual');
  if (!['sales_order', 'project', 'forecast', 'manual', 'master_schedule'].includes(demandType)) {
    fail(`unsupported demand type: ${demandType}`, 'MRP_DEMAND_TYPE_INVALID', 400);
  }
  if (input.project_id) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND company_id = ?').get(input.project_id, companyId);
    if (!project) fail('project not found', 'PROJECT_NOT_FOUND', 404);
  }

  const id = makeId('mrpd');
  const stamp = now();
  db.prepare(`
    INSERT INTO mrp_demands (id, company_id, product_id, demand_type, source_id, project_id,
      warehouse_id, quantity, required_date, state, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    id, companyId, input.product_id, demandType, input.source_id || null,
    input.project_id || null, input.warehouse_id || null, quantity,
    input.required_date || null, input.actor || null, stamp, stamp,
  );
  return db.prepare('SELECT * FROM mrp_demands WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// Explosion
// ---------------------------------------------------------------------------

function policyFor(db, companyId, productId) {
  return db.prepare('SELECT * FROM mrp_item_policies WHERE company_id = ? AND product_id = ? AND is_active = 1')
    .get(companyId, productId) || {
    sourcing: 'buy', safety_stock: 0, reorder_point: 0, lead_time_days: 0,
    lot_sizing: 'lot_for_lot', fixed_lot_size: 0, minimum_order_quantity: 0,
    multiple_of: 0, preferred_supplier_id: null, source_warehouse_id: null,
  };
}

/** Apply lot-sizing rules to a net requirement. */
export function applyLotSizing(netRequirement, policy) {
  let qty = Number(netRequirement);
  if (qty <= 0) return 0;

  if (policy.lot_sizing === 'fixed' && Number(policy.fixed_lot_size) > 0) {
    const lots = Math.ceil(qty / Number(policy.fixed_lot_size));
    qty = lots * Number(policy.fixed_lot_size);
  }
  if (Number(policy.minimum_order_quantity) > 0) {
    qty = Math.max(qty, Number(policy.minimum_order_quantity));
  }
  if (Number(policy.multiple_of) > 0) {
    qty = Math.ceil(qty / Number(policy.multiple_of)) * Number(policy.multiple_of);
  }
  return round(qty);
}

/**
 * On-hand and reserved for planning purposes, counted over INTERNAL locations
 * only.
 *
 * The canonical ledger is double-entry across locations: receiving 10 units
 * from a supplier leaves +10 in internal stock and -10 in the supplier
 * location, so summing every location for a product nets to zero. Planning
 * must look at what is actually in our own warehouses, which is the internal
 * subset. (`getQuantBalance` deliberately sums all locations — that is correct
 * for ledger integrity checks, but wrong as an availability figure.)
 */
function internalBalance(db, companyId, productId, warehouseId = null) {
  const params = [companyId, productId];
  let sql = `
    SELECT COALESCE(SUM(q.quantity), 0) AS on_hand,
           COALESCE(SUM(q.reserved_quantity), 0) AS reserved
    FROM stock_quants q
    JOIN stock_locations l ON l.id = q.location_id
    WHERE q.company_id = ? AND q.product_id = ? AND l.usage = 'internal'
  `;
  if (warehouseId) {
    sql += ' AND l.warehouse_id = ?';
    params.push(warehouseId);
  }
  const row = db.prepare(sql).get(...params);
  const onHand = Number(row ? row.on_hand : 0);
  const reserved = Number(row ? row.reserved : 0);
  return { onHand, reserved, available: onHand - reserved };
}

/**
 * Scheduled receipts = quantity already inbound on validated-but-not-done
 * stock moves. Read from the canonical stock ledger, never tracked separately.
 */
function scheduledReceipts(db, companyId, productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(product_qty), 0) AS qty
    FROM stock_moves
    WHERE company_id = ? AND product_id = ? AND state IN ('assigned','confirmed','waiting')
  `).get(companyId, productId);
  return Number(row ? row.qty : 0);
}

/**
 * Explode one requirement level. Phantom lines do NOT become requirements of
 * their own — they are transparent and expand straight into their children,
 * which is what makes a phantom a phantom.
 */
function explode(db, ctx, run, node, level, insertRequirement, insertProposal, counters, warehouseId) {
  const companyId = ctx.companyId;
  if (level > MAX_EXPLOSION_DEPTH) {
    fail(
      `BOM explosion exceeded the maximum depth of ${MAX_EXPLOSION_DEPTH} — check for a circular bill`,
      'MRP_EXPLOSION_TOO_DEEP',
      409,
    );
  }

  const policy = policyFor(db, companyId, node.product_id);
  const balance = internalBalance(db, companyId, node.product_id, warehouseId);
  const receipts = scheduledReceipts(db, companyId, node.product_id);
  const safety = Number(policy.safety_stock || 0);

  const available = round(Number(balance.available) + receipts - safety);
  const net = round(Math.max(0, Number(node.gross) - available));
  const isShortage = net > 0 ? 1 : 0;

  const requirementId = makeId('mrpreq');
  insertRequirement.run(
    requirementId, companyId, run.id, node.parentRequirementId || null, level,
    node.product_id, node.demand_id || null, node.bom_version_id || null,
    round(node.gross), round(balance.onHand), round(balance.reserved), round(receipts),
    safety, available, net, node.required_date || null, isShortage, now(),
  );
  counters.requirements += 1;
  if (isShortage) counters.shortages += 1;

  if (net <= 0) return;

  // A net shortage becomes either a manufacture proposal (which explodes
  // further) or a buy/transfer/subcontract proposal (which terminates).
  const orderQty = applyLotSizing(net, policy);
  const bomVersion = policy.sourcing === 'make'
    ? effectiveBomForProduct(db, companyId, node.product_id)
    : null;

  if (policy.sourcing === 'make' && bomVersion) {
    const routingVersion = effectiveRoutingForProduct(db, companyId, node.product_id);
    insertProposal.run(
      makeId('mrpp'), companyId, run.id, requirementId, 'manufacture', node.product_id,
      orderQty, node.required_date || null, null, null, warehouseId || null,
      bomVersion.id, routingVersion ? routingVersion.id : null, '', now(), now(),
    );
    counters.proposals += 1;

    // Explode the children of what we intend to manufacture.
    const perUnit = Number(bomVersion.quantity) > 0 ? Number(bomVersion.quantity) : 1;
    const yieldFactor = Number(bomVersion.yield_percent || 100) / 100;
    const lines = db.prepare(
      "SELECT * FROM bom_lines WHERE bom_version_id = ? AND line_type = 'component' ORDER BY sequence",
    ).all(bomVersion.id);

    for (const line of lines) {
      const scrapFactor = 1 + (Number(line.scrap_factor_percent || 0) / 100);
      const childGross = round((orderQty / perUnit) * Number(line.quantity) * scrapFactor / yieldFactor);

      if (line.is_phantom && line.child_bom_id) {
        // Phantom: transparent. Expand its children directly at this level's
        // depth+1 without creating a requirement for the phantom itself.
        const childVersion = effectiveBomVersion(db, companyId, line.child_bom_id);
        if (childVersion) {
          const childPerUnit = Number(childVersion.quantity) > 0 ? Number(childVersion.quantity) : 1;
          const childLines = db.prepare(
            "SELECT * FROM bom_lines WHERE bom_version_id = ? AND line_type = 'component' ORDER BY sequence",
          ).all(childVersion.id);
          for (const childLine of childLines) {
            const childScrap = 1 + (Number(childLine.scrap_factor_percent || 0) / 100);
            explode(db, ctx, run, {
              product_id: childLine.component_id,
              gross: round((childGross / childPerUnit) * Number(childLine.quantity) * childScrap),
              parentRequirementId: requirementId,
              demand_id: node.demand_id,
              required_date: node.required_date,
              bom_version_id: childVersion.id,
            }, level + 1, insertRequirement, insertProposal, counters, warehouseId);
          }
          continue;
        }
      }

      explode(db, ctx, run, {
        product_id: line.component_id,
        gross: childGross,
        parentRequirementId: requirementId,
        demand_id: node.demand_id,
        required_date: node.required_date,
        bom_version_id: bomVersion.id,
      }, level + 1, insertRequirement, insertProposal, counters, warehouseId);
    }
    return;
  }

  // Buy / transfer / subcontract terminate the explosion.
  const proposalType = policy.sourcing === 'transfer' ? 'transfer'
    : policy.sourcing === 'subcontract' ? 'subcontract' : 'purchase';
  insertProposal.run(
    makeId('mrpp'), companyId, run.id, requirementId, proposalType, node.product_id,
    orderQty, node.required_date || null, policy.preferred_supplier_id || null,
    policy.source_warehouse_id || null, warehouseId || null,
    null, null, '', now(), now(),
  );
  counters.proposals += 1;
}

export function runMrp(db, input = {}) {
  const companyId = input.company_id;
  const ctx = { companyId };
  const stamp = now();

  const demands = db.prepare(`
    SELECT * FROM mrp_demands
    WHERE company_id = ? AND state = 'open'
    ${input.warehouse_id ? 'AND (warehouse_id IS NULL OR warehouse_id = ?)' : ''}
    ORDER BY required_date IS NULL, required_date, created_at
  `).all(...(input.warehouse_id ? [companyId, input.warehouse_id] : [companyId]));

  if (!demands.length) {
    fail('there is no open demand to plan', 'MRP_NO_OPEN_DEMAND', 409);
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM mrp_runs WHERE company_id = ?').get(companyId).c;
  const runId = makeId('mrprun');
  const run = { id: runId };

  db.prepare(`
    INSERT INTO mrp_runs (id, company_id, run_number, warehouse_id, horizon_days, state,
      demand_count, requirement_count, proposal_count, shortage_count, executed_by, executed_at, notes, created_at)
    VALUES (?, ?, ?, ?, ?, 'running', ?, 0, 0, 0, ?, ?, ?, ?)
  `).run(
    runId, companyId, `MRP-${String(count + 1).padStart(5, '0')}`,
    input.warehouse_id || null, Number(input.horizon_days || 90),
    demands.length, input.actor || null, stamp, String(input.notes || ''), stamp,
  );

  const insertRequirement = db.prepare(`
    INSERT INTO mrp_requirements (id, company_id, mrp_run_id, parent_requirement_id, level, product_id,
      demand_id, bom_version_id, gross_requirement, on_hand, reserved, scheduled_receipts, safety_stock,
      available, net_requirement, required_date, is_shortage, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertProposal = db.prepare(`
    INSERT INTO mrp_proposals (id, company_id, mrp_run_id, requirement_id, proposal_type, product_id,
      quantity, suggested_date, supplier_id, source_warehouse_id, target_warehouse_id,
      bom_version_id, routing_version_id, reschedule_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const counters = { requirements: 0, proposals: 0, shortages: 0 };

  // Aggregate demand per product so one product does not produce N competing
  // proposals for the same shortage.
  const byProduct = new Map();
  for (const demand of demands) {
    const key = String(demand.product_id);
    const entry = byProduct.get(key) || { product_id: demand.product_id, gross: 0, demand_id: demand.id, required_date: demand.required_date };
    entry.gross += Number(demand.quantity);
    if (demand.required_date && (!entry.required_date || demand.required_date < entry.required_date)) {
      entry.required_date = demand.required_date;
    }
    byProduct.set(key, entry);
  }

  for (const node of byProduct.values()) {
    explode(db, ctx, run, { ...node, parentRequirementId: null }, 0, insertRequirement, insertProposal, counters, input.warehouse_id);
  }

  db.prepare(`
    UPDATE mrp_runs SET state = 'completed', requirement_count = ?, proposal_count = ?, shortage_count = ?
    WHERE id = ?
  `).run(counters.requirements, counters.proposals, counters.shortages, runId);

  // Demand that produced a plan is marked planned so the next run does not
  // double-count it.
  const markPlanned = db.prepare("UPDATE mrp_demands SET state = 'planned', updated_at = ? WHERE id = ?");
  for (const demand of demands) markPlanned.run(stamp, demand.id);

  return {
    ...db.prepare('SELECT * FROM mrp_runs WHERE id = ?').get(runId),
    requirements: db.prepare('SELECT * FROM mrp_requirements WHERE mrp_run_id = ? ORDER BY level, created_at').all(runId),
    proposals: db.prepare('SELECT * FROM mrp_proposals WHERE mrp_run_id = ? ORDER BY created_at').all(runId),
    // Explicit: this run created no commitment and moved no stock.
    created_financial_commitment: false,
    created_stock_movement: false,
  };
}

// ---------------------------------------------------------------------------
// Proposal governance
// ---------------------------------------------------------------------------

export function approveProposal(db, input = {}) {
  requireFields(input, ['proposal_id']);
  const companyId = input.company_id;
  const proposal = db.prepare('SELECT * FROM mrp_proposals WHERE id = ? AND company_id = ?')
    .get(input.proposal_id, companyId);
  if (!proposal) fail('MRP proposal not found', 'MRP_PROPOSAL_NOT_FOUND', 404);
  if (proposal.state !== 'proposed') {
    fail(`MRP proposal is already ${proposal.state}`, 'MRP_PROPOSAL_CLOSED', 409);
  }

  const stamp = now();
  db.prepare(`
    UPDATE mrp_proposals SET state = 'approved', decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, String(input.reason || ''), stamp, proposal.id);

  return {
    ...db.prepare('SELECT * FROM mrp_proposals WHERE id = ?').get(proposal.id),
    // Approval authorises the hand-off; it does not itself create the
    // downstream document. The receiving authority is named so evidence can
    // trace where execution must happen.
    hand_off_authority: proposal.proposal_type === 'manufacture' ? 'platform.manufacturing'
      : proposal.proposal_type === 'transfer' ? 'platform.inventory'
        : 'platform.procurement',
    created_financial_commitment: false,
  };
}

export function rejectProposal(db, input = {}) {
  requireFields(input, ['proposal_id']);
  const companyId = input.company_id;
  const proposal = db.prepare('SELECT * FROM mrp_proposals WHERE id = ? AND company_id = ?')
    .get(input.proposal_id, companyId);
  if (!proposal) fail('MRP proposal not found', 'MRP_PROPOSAL_NOT_FOUND', 404);
  if (proposal.state !== 'proposed') {
    fail(`MRP proposal is already ${proposal.state}`, 'MRP_PROPOSAL_CLOSED', 409);
  }
  const stamp = now();
  db.prepare(`
    UPDATE mrp_proposals SET state = 'rejected', decided_by = ?, decided_at = ?, decision_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(input.actor || null, stamp, String(input.reason || ''), stamp, proposal.id);
  return db.prepare('SELECT * FROM mrp_proposals WHERE id = ?').get(proposal.id);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function mrpReport(db, ctx = {}, report = 'shortages', query = {}) {
  const companyId = ctx.companyId;
  switch (report) {
    case 'shortages':
      return db.prepare(`
        SELECT r.*, p.sku, p.name AS product_name
        FROM mrp_requirements r
        JOIN product_variants p ON p.id = r.product_id
        WHERE r.company_id = ? AND r.is_shortage = 1
        ORDER BY r.required_date IS NULL, r.required_date, r.level LIMIT 300
      `).all(companyId);
    case 'proposals':
      return db.prepare(`
        SELECT pr.*, p.sku, p.name AS product_name
        FROM mrp_proposals pr
        JOIN product_variants p ON p.id = pr.product_id
        WHERE pr.company_id = ? ORDER BY pr.created_at DESC LIMIT 300
      `).all(companyId);
    case 'planner_worklist':
      return db.prepare(`
        SELECT pr.*, p.sku, p.name AS product_name
        FROM mrp_proposals pr
        JOIN product_variants p ON p.id = pr.product_id
        WHERE pr.company_id = ? AND pr.state = 'proposed'
        ORDER BY pr.suggested_date IS NULL, pr.suggested_date LIMIT 300
      `).all(companyId);
    case 'runs':
      return db.prepare('SELECT * FROM mrp_runs WHERE company_id = ? ORDER BY executed_at DESC LIMIT 100').all(companyId);
    case 'demand':
      return db.prepare(`
        SELECT d.*, p.sku, p.name AS product_name
        FROM mrp_demands d JOIN product_variants p ON p.id = d.product_id
        WHERE d.company_id = ? ORDER BY d.created_at DESC LIMIT 300
      `).all(companyId);
    default:
      fail(`unknown MRP report: ${report}`, 'MRP_REPORT_UNKNOWN', 400);
      return [];
  }
}
