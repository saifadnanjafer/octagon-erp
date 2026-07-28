// Commercial & Supply Chain Query Surface — Phase 04.5 Remediation
//
// Read surface over raw Node HTTP for Commercial, Inventory, Sales, Procurement, POS, and Work Items.
// All mutations dispatch via POST /api/v1/action/:actionId.

'use strict';

import { getParties } from '../commercial/parties.mjs';
import { getProducts } from '../commercial/products.mjs';
import { getUoms } from '../commercial/uom.mjs';
import { getWarehouses, getLocations } from '../inventory/warehouses.mjs';
import { getQuantBalance } from '../inventory/ledger.mjs';
import { getProductValuation } from '../inventory/valuation.mjs';
import { listReservations } from '../inventory/reservations.mjs';
import { getSaleOrder } from '../sales/orders.mjs';
import { getOpportunity } from '../sales/lifecycle.mjs';
import { getCustomerOpenItems } from '../finance/engine.mjs';
import { getPurchaseOrder } from '../procurement/orders.mjs';
import { getPosOrder } from '../pos/session.mjs';
import { getWorkItem, listWorkItems } from '../work_items/work_items.mjs';

/**
 * Dispatch a GET /api/v1/:namespace/:resource[/:id] query.
 * Returns { data, meta } on success or { error, status } for missing/unknown resources.
 */
export function handleCommercialQuery({ dialect, ctx, namespace, resource, recordId = null, query = {} }) {
  const company_id = ctx?.companyId || null;
  if (!company_id) {
    return { error: 'an active company scope is required', status: 403 };
  }

  // 1. Commercial Parties
  if ((namespace === 'commercial' && resource === 'parties') || namespace === 'parties') {
    const role = query.role || null;
    const search = query.search || null;
    const include_archived = query.include_archived === 'true' || query.include_archived === '1';
    const rows = getParties(dialect, { company_id, role, search, include_archived });
    return { data: rows, meta: { total: rows.length } };
  }

  // 2. Commercial Products
  if ((namespace === 'commercial' && resource === 'products') || namespace === 'products') {
    const category_id = query.category_id || null;
    const type = query.type || null;
    const uom_id = query.uom_id || null;
    const search = query.search || null;
    const include_archived = query.include_archived === 'true' || query.include_archived === '1';
    const rows = getProducts(dialect, { company_id, category_id, type, uom_id, search, include_archived });
    return { data: rows, meta: { total: rows.length } };
  }

  // 3. Product Categories
  if ((namespace === 'commercial' && (resource === 'product_categories' || resource === 'product-categories')) || namespace === 'product_categories' || namespace === 'product-categories') {
    const rows = dialect.prepare(`SELECT * FROM product_categories WHERE company_id = ? OR company_id = '*' ORDER BY name ASC`).all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 4. Commercial UOMs & UOM Categories
  if ((namespace === 'commercial' && resource === 'uoms') || namespace === 'uoms') {
    const category_id = query.category_id || null;
    const include_archived = query.include_archived === 'true' || query.include_archived === '1';
    const rows = getUoms(dialect, { category_id, include_archived });
    return { data: rows, meta: { total: rows.length } };
  }
  if ((namespace === 'commercial' && (resource === 'uom_categories' || resource === 'uom-categories')) || namespace === 'uom_categories' || namespace === 'uom-categories') {
    const rows = dialect.prepare(`SELECT * FROM uom_categories ORDER BY name ASC`).all();
    return { data: rows, meta: { total: rows.length } };
  }
  if (namespace === 'commercial' && (resource === 'price-lists' || resource === 'price_lists')) {
    const rows = dialect.prepare(`
      SELECT * FROM price_lists
      WHERE company_id = ? AND is_active = 1
      ORDER BY name, id
    `).all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 5. Inventory Warehouses
  if ((namespace === 'inventory' && resource === 'warehouses') || namespace === 'warehouses') {
    const rows = getWarehouses(dialect, { company_id, branch_id: ctx?.branchId || null });
    return { data: rows, meta: { total: rows.length } };
  }

  // 6. Inventory Locations
  if ((namespace === 'inventory' && resource === 'locations') || namespace === 'locations') {
    const warehouse_id = query.warehouse_id || recordId || null;
    const rows = getLocations(dialect, { company_id, warehouse_id });
    return { data: rows, meta: { total: rows.length } };
  }

  // 7. Inventory Quant Balances
  if ((namespace === 'inventory' && (resource === 'quants' || resource === 'balances')) || namespace === 'quants') {
    const product_id = query.product_id;
    const location_id = query.location_id || null;
    const balance = getQuantBalance(dialect, { company_id, product_id, location_id });
    return { data: balance, meta: { total: 1 } };
  }

  // 8. Inventory operations, reservations, valuation, and traceability
  if (namespace === 'inventory' && resource === 'operations') {
    const rows = dialect.prepare(`
      SELECT * FROM stock_moves
      WHERE company_id = ? ORDER BY move_date DESC, created_at DESC LIMIT 200
    `).all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }
  if (namespace === 'inventory' && resource === 'reservations') {
    const rows = listReservations(dialect, {
      company_id,
      source_document_id: query.source_document_id || null,
      status: query.status || null,
    });
    return { data: rows, meta: { total: rows.length } };
  }
  if (namespace === 'inventory' && resource === 'valuation') {
    if (!query.product_id) return { error: 'product_id is required', status: 400 };
    return {
      data: getProductValuation(dialect, { company_id, product_id: query.product_id }),
      meta: { total: 1 },
    };
  }
  if (namespace === 'inventory' && ['lots', 'serials', 'packages'].includes(resource)) {
    const table = { lots: 'stock_lots', serials: 'stock_serials', packages: 'stock_packages' }[resource];
    const rows = dialect.prepare(`
      SELECT * FROM ${table} WHERE company_id = ? ORDER BY created_at DESC LIMIT 200
    `).all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9. Sales Orders
  if ((namespace === 'sales' && resource === 'orders') || namespace === 'sales-orders') {
    if (recordId) {
      const doc = getSaleOrder(dialect, recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Sales order not found', status: 404 };
      return { data: doc, meta: null };
    }
    const filters = [];
    const params = [company_id];
    if (query.state) { filters.push('state = ?'); params.push(query.state); }
    if (query.quotation_state) { filters.push('quotation_state = ?'); params.push(query.quotation_state); }
    if (query.partner_id) { filters.push('partner_id = ?'); params.push(query.partner_id); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`SELECT * FROM sale_orders WHERE company_id = ?${where} ORDER BY created_at DESC LIMIT 100`).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9b. CRM Leads
  if (namespace === 'sales' && resource === 'leads') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM crm_leads WHERE id = ?').get(recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Lead not found', status: 404 };
      const activities = dialect.prepare('SELECT * FROM crm_activities WHERE lead_id = ?').all(recordId);
      return { data: { ...doc, activities }, meta: null };
    }
    const filters = [];
    const params = [company_id];
    if (query.stage) { filters.push('stage = ?'); params.push(query.stage); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`SELECT * FROM crm_leads WHERE company_id = ?${where} ORDER BY created_at DESC LIMIT 200`).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9c. CRM Opportunities (+ activities)
  if (namespace === 'sales' && resource === 'opportunities') {
    if (recordId) {
      const doc = getOpportunity(dialect, recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Opportunity not found', status: 404 };
      return { data: doc, meta: null };
    }
    const filters = [];
    const params = [company_id];
    if (query.status) { filters.push('status = ?'); params.push(query.status); }
    if (query.stage) { filters.push('stage = ?'); params.push(query.stage); }
    if (query.party_id) { filters.push('party_id = ?'); params.push(query.party_id); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`SELECT * FROM crm_opportunities WHERE company_id = ?${where} ORDER BY created_at DESC LIMIT 200`).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9d. Sales Returns
  if (namespace === 'sales' && resource === 'returns') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM sale_returns WHERE id = ?').get(recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Sales return not found', status: 404 };
      const lines = dialect.prepare('SELECT * FROM sale_return_lines WHERE sale_return_id = ?').all(recordId);
      return { data: { ...doc, lines }, meta: null };
    }
    const filters = [];
    const params = [company_id];
    if (query.sale_order_id) { filters.push('sale_order_id = ?'); params.push(query.sale_order_id); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`SELECT * FROM sale_returns WHERE company_id = ?${where} ORDER BY created_at DESC LIMIT 100`).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9e. Sales invoice / credit-note requests (commercial_fiscal_requests, sales types only)
  if (namespace === 'sales' && (resource === 'invoice-requests' || resource === 'invoice_requests')) {
    const filters = [`request_type IN ('customer_invoice', 'customer_credit_note')`];
    const params = [company_id];
    if (query.status) { filters.push('status = ?'); params.push(query.status); }
    if (query.sale_order_id) { filters.push('source_document_id = ?'); params.push(query.sale_order_id); }
    const rows = dialect.prepare(`
      SELECT * FROM commercial_fiscal_requests WHERE company_id = ? AND ${filters.join(' AND ')}
      ORDER BY created_at DESC LIMIT 100
    `).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9f. Customer balances (finance AR open items by party)
  if (namespace === 'sales' && (resource === 'customer-balances' || resource === 'customer_balances')) {
    const rows = getCustomerOpenItems(dialect, ctx, { partner_id: query.partner_id || null });
    return { data: rows, meta: { total: rows.length } };
  }

  // 9g. Reservations by sales order
  if (namespace === 'sales' && resource === 'reservations') {
    const rows = listReservations(dialect, {
      company_id,
      source_document_id: query.sale_order_id || query.source_document_id || null,
      status: query.status || null,
    });
    return { data: rows, meta: { total: rows.length } };
  }

  // 9h. Deliveries / pickings by sales order
  if (namespace === 'sales' && resource === 'deliveries') {
    const filters = [];
    const params = [company_id];
    if (query.sale_order_id) { filters.push('linked.sale_order_id = ?'); params.push(query.sale_order_id); }
    if (query.state) { filters.push('p.state = ?'); params.push(query.state); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`
      WITH linked AS (
        SELECT sale_order_id, picking_id FROM sale_fulfilment_demands
        UNION
        SELECT sale_order_id, picking_id FROM sale_delivery_events
      )
      SELECT DISTINCT p.*, linked.sale_order_id
      FROM stock_pickings p
      JOIN linked ON linked.picking_id = p.id
      WHERE p.company_id = ?${where}
      ORDER BY p.created_at DESC LIMIT 100
    `).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9i. Commission events
  if (namespace === 'sales' && (resource === 'commissions' || resource === 'commission-events' || resource === 'commission_events')) {
    const filters = [];
    const params = [company_id];
    if (query.status) { filters.push('status = ?'); params.push(query.status); }
    if (query.salesperson_id) { filters.push('salesperson_id = ?'); params.push(query.salesperson_id); }
    if (query.sale_order_id) { filters.push('sale_order_id = ?'); params.push(query.sale_order_id); }
    const where = filters.length ? ` AND ${filters.join(' AND ')}` : '';
    const rows = dialect.prepare(`SELECT * FROM sales_commission_events WHERE company_id = ?${where} ORDER BY created_at DESC LIMIT 200`).all(...params);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9j. Sales report aggregates
  if (namespace === 'sales' && resource === 'reports') {
    const report = query.report || 'pipeline';
    if (report === 'customer-balances') {
      const openItems = getCustomerOpenItems(dialect, ctx, { partner_id: query.partner_id || null });
      const grouped = new Map();
      for (const row of openItems) {
        const key = row.partner_id || 'unknown';
        const current = grouped.get(key) || { partner_id: key, open_items: 0, balance: 0, overdue: 0 };
        const residual = Number(row.residual_amount || row.open_amount || 0);
        current.open_items += 1;
        current.balance += residual;
        if (row.due_date && String(row.due_date) < new Date().toISOString().slice(0, 10)) current.overdue += residual;
        grouped.set(key, current);
      }
      const rows = [...grouped.values()].sort((a, b) => b.balance - a.balance);
      return { data: rows, meta: { total: rows.length, report } };
    }
    if (report === 'by-customer') {
      const rows = dialect.prepare(`
        SELECT partner_id, COUNT(*) AS order_count, SUM(amount_untaxed) AS untaxed, SUM(amount_tax) AS tax, SUM(amount_total) AS total
        FROM sale_orders WHERE company_id = ? AND state != 'cancel'
        GROUP BY partner_id ORDER BY total DESC LIMIT 100
      `).all(company_id);
      return { data: rows, meta: { total: rows.length, report } };
    }
    if (report === 'by-product') {
      const rows = dialect.prepare(`
        SELECT sol.product_id, sol.name, SUM(sol.product_uom_qty) AS quantity, SUM(sol.price_subtotal) AS untaxed, SUM(sol.price_total) AS total
        FROM sale_order_lines sol
        JOIN sale_orders so ON so.id = sol.order_id
        WHERE so.company_id = ? AND so.state != 'cancel'
        GROUP BY sol.product_id, sol.name ORDER BY total DESC LIMIT 100
      `).all(company_id);
      return { data: rows, meta: { total: rows.length, report } };
    }
    if (report === 'conversion') {
      const rows = dialect.prepare(`
        SELECT
          (SELECT COUNT(*) FROM crm_leads WHERE company_id = ?) AS leads,
          (SELECT COUNT(*) FROM crm_leads WHERE company_id = ? AND stage = 'won') AS leads_won,
          (SELECT COUNT(*) FROM crm_opportunities WHERE company_id = ?) AS opportunities,
          (SELECT COUNT(*) FROM crm_opportunities WHERE company_id = ? AND status = 'won') AS opportunities_won,
          (SELECT COUNT(*) FROM sale_orders WHERE company_id = ? AND quotation_state = 'accepted') AS quotations_accepted,
          (SELECT COUNT(*) FROM sale_orders WHERE company_id = ? AND state = 'sale') AS orders_confirmed
      `).get(company_id, company_id, company_id, company_id, company_id, company_id);
      return { data: rows, meta: { total: 1, report } };
    }
    if (report === 'margin') {
      const rows = dialect.prepare(`
        SELECT so.partner_id,
               SUM(sol.price_subtotal) AS revenue,
               SUM(sol.product_uom_qty * COALESCE(v.standard_price, 0)) AS cost,
               SUM(sol.price_subtotal) - SUM(sol.product_uom_qty * COALESCE(v.standard_price, 0)) AS margin
        FROM sale_order_lines sol
        JOIN sale_orders so ON so.id = sol.order_id
        LEFT JOIN product_variants v ON v.id = sol.product_id
        WHERE so.company_id = ? AND so.state != 'cancel'
        GROUP BY so.partner_id ORDER BY margin DESC LIMIT 100
      `).all(company_id);
      return { data: rows, meta: { total: rows.length, report } };
    }
    if (report === 'returns') {
      const rows = dialect.prepare(`
        SELECT srl.product_id, SUM(srl.quantity) AS returned_quantity, COUNT(DISTINCT sr.id) AS return_count
        FROM sale_return_lines srl
        JOIN sale_returns sr ON sr.id = srl.sale_return_id
        WHERE sr.company_id = ? AND sr.state = 'done'
        GROUP BY srl.product_id ORDER BY returned_quantity DESC LIMIT 100
      `).all(company_id);
      return { data: rows, meta: { total: rows.length, report } };
    }
    if (report === 'overdue-deliveries') {
      const today = new Date().toISOString().slice(0, 10);
      const rows = dialect.prepare(`
        SELECT so.id, so.name, so.partner_id, so.order_date,
               SUM(d.demanded_quantity) AS demanded,
               COALESCE((SELECT SUM(f.delivered_quantity) FROM sale_order_line_fulfilment f WHERE f.order_id = so.id), 0) AS delivered
        FROM sale_orders so
        JOIN sale_fulfilment_demands d ON d.sale_order_id = so.id
        WHERE so.company_id = ? AND so.state = 'sale' AND so.order_date < ?
        GROUP BY so.id
        HAVING delivered < demanded
        ORDER BY so.order_date ASC LIMIT 100
      `).all(company_id, today);
      return { data: rows, meta: { total: rows.length, report } };
    }
    // default: order pipeline by state
    const rows = dialect.prepare(`
      SELECT state, quotation_state, COUNT(*) AS order_count, SUM(amount_total) AS total
      FROM sale_orders WHERE company_id = ?
      GROUP BY state, quotation_state ORDER BY state, quotation_state
    `).all(company_id);
    return { data: rows, meta: { total: rows.length, report: 'pipeline' } };
  }

  // 10. Purchase Orders
  if ((namespace === 'procurement' && resource === 'orders') || namespace === 'purchase-orders') {
    if (recordId) {
      const doc = getPurchaseOrder(dialect, recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Purchase order not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = dialect.prepare('SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 100').all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 11. POS orders
  if (namespace === 'pos' && resource === 'orders') {
    if (recordId) {
      const doc = getPosOrder(dialect, recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'POS order not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = dialect.prepare('SELECT * FROM pos_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 100').all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 12. Work Items / Tasks
  if (namespace === 'work-items' || namespace === 'work_items' || resource === 'work-items') {
    if (recordId) {
      const doc = getWorkItem(dialect, recordId);
      if (!doc || doc.company_id !== company_id) return { error: 'Work Item not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = listWorkItems(dialect, ctx, query);
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: 'unknown commercial resource', status: 404 };
}
