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
    const rows = dialect.prepare('SELECT * FROM sale_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 100').all(company_id);
    return { data: rows, meta: { total: rows.length } };
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
