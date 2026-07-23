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
import { getSaleOrder } from '../sales/orders.mjs';
import { getPurchaseOrder } from '../procurement/orders.mjs';
import { getWorkItem, listWorkItems } from '../work_items/work_items.mjs';

/**
 * Dispatch a GET /api/v1/:namespace/:resource[/:id] query.
 * Returns { data, meta } on success or { error, status } for missing/unknown resources.
 */
export function handleCommercialQuery({ dialect, ctx, namespace, resource, recordId = null, query = {} }) {
  const company_id = ctx?.companyId || query.company_id || '*';

  // 1. Commercial Parties
  if ((namespace === 'commercial' && resource === 'parties') || namespace === 'parties') {
    const role = query.role || null;
    const search = query.search || null;
    const rows = getParties(dialect, { company_id, role, search });
    return { data: rows, meta: { total: rows.length } };
  }

  // 2. Commercial Products
  if ((namespace === 'commercial' && resource === 'products') || namespace === 'products') {
    const category_id = query.category_id || null;
    const search = query.search || null;
    const rows = getProducts(dialect, { company_id, category_id, search });
    return { data: rows, meta: { total: rows.length } };
  }

  // 3. Commercial UOMs
  if ((namespace === 'commercial' && resource === 'uoms') || namespace === 'uoms') {
    const category_id = query.category_id || null;
    const rows = getUoms(dialect, { category_id });
    return { data: rows, meta: { total: rows.length } };
  }

  // 4. Inventory Warehouses
  if ((namespace === 'inventory' && resource === 'warehouses') || namespace === 'warehouses') {
    const rows = getWarehouses(dialect, { company_id });
    return { data: rows, meta: { total: rows.length } };
  }

  // 5. Inventory Locations
  if ((namespace === 'inventory' && resource === 'locations') || namespace === 'locations') {
    const warehouse_id = query.warehouse_id || recordId || null;
    const rows = getLocations(dialect, { warehouse_id });
    return { data: rows, meta: { total: rows.length } };
  }

  // 6. Inventory Quant Balances
  if ((namespace === 'inventory' && (resource === 'quants' || resource === 'balances')) || namespace === 'quants') {
    const product_id = query.product_id;
    const location_id = query.location_id || null;
    const rows = getQuantBalance(dialect, { company_id, product_id, location_id });
    return { data: rows, meta: { total: rows.length } };
  }

  // 7. Sales Orders
  if ((namespace === 'sales' && resource === 'orders') || namespace === 'sales-orders') {
    if (recordId) {
      const doc = getSaleOrder(dialect, recordId);
      if (!doc) return { error: 'Sales order not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = dialect.prepare("SELECT * FROM sale_orders WHERE company_id = ? OR company_id = '*' ORDER BY created_at DESC LIMIT 100").all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 8. Purchase Orders
  if ((namespace === 'procurement' && resource === 'orders') || namespace === 'purchase-orders') {
    if (recordId) {
      const doc = getPurchaseOrder(dialect, recordId);
      if (!doc) return { error: 'Purchase order not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = dialect.prepare("SELECT * FROM purchase_orders WHERE company_id = ? OR company_id = '*' ORDER BY created_at DESC LIMIT 100").all(company_id);
    return { data: rows, meta: { total: rows.length } };
  }

  // 9. Work Items / Tasks
  if (namespace === 'work-items' || namespace === 'work_items' || resource === 'work-items') {
    if (recordId) {
      const doc = getWorkItem(dialect, recordId);
      if (!doc) return { error: 'Work Item not found', status: 404 };
      return { data: doc, meta: null };
    }
    const rows = listWorkItems(dialect, ctx, query);
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: 'unknown commercial resource', status: 404 };
}
