import { getParties } from '../commercial/parties.mjs';
import { getProducts } from '../commercial/products.mjs';
import { getUoms } from '../commercial/uom.mjs';
import { getWarehouses, getLocations } from '../inventory/warehouses.mjs';
import { getQuantBalance } from '../inventory/ledger.mjs';
import { getSaleOrder } from '../sales/orders.mjs';
import { getPurchaseOrder } from '../procurement/orders.mjs';

export function registerCommercialHttpRoutes(app, actionExecutor) {
  if (!app) return;

  // Unified Query Routes
  app.get('/api/v1/query/commercial/parties', (req, res) => {
    try {
      const company_id = req.query.company_id || '*';
      const role = req.query.role || null;
      const search = req.query.search || null;
      const result = getParties(req.db, { company_id, role, search });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/v1/query/commercial/products', (req, res) => {
    try {
      const company_id = req.query.company_id || '*';
      const category_id = req.query.category_id || null;
      const search = req.query.search || null;
      const result = getProducts(req.db, { company_id, category_id, search });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/v1/query/inventory/warehouses', (req, res) => {
    try {
      const company_id = req.query.company_id || '*';
      const result = getWarehouses(req.db, { company_id });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/v1/query/inventory/quants', (req, res) => {
    try {
      const company_id = req.query.company_id || '*';
      const product_id = req.query.product_id;
      const location_id = req.query.location_id || null;
      if (!product_id) return res.status(400).json({ success: false, error: 'product_id parameter is required' });
      const result = getQuantBalance(req.db, { company_id, product_id, location_id });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/v1/query/sales/orders/:id', (req, res) => {
    try {
      const result = getSaleOrder(req.db, req.params.id);
      if (!result) return res.status(404).json({ success: false, error: 'Sales order not found' });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/v1/query/procurement/orders/:id', (req, res) => {
    try {
      const result = getPurchaseOrder(req.db, req.params.id);
      if (!result) return res.status(404).json({ success: false, error: 'Purchase order not found' });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}
