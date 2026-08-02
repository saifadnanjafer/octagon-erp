import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import * as topology from '../../platform/wms/topology.mjs';

export async function mobileFixture(t, name = 'mobile') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-b09-${name}-`));
  const dbPath = path.join(dir, 'test.db');
  await freshInstall({ dbPath, backupDir: path.join(dir, 'backups') });
  const db = openMigrationDatabase(dbPath);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const companyId = 'company-a';
  const warehouse = createWarehouse(db, { company_id: companyId, name: 'Mobile DC', code: `M${Math.random().toString(36).slice(2, 5)}` });
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO stock_picking_types(id,company_id,warehouse_id,name,code,created_at) VALUES(?,?,?,?,?,?)`).run('incoming-mobile', companyId, warehouse.id, 'Mobile Receipts', 'incoming', new Date().toISOString());

  db.prepare(`INSERT INTO product_templates(id,company_id,name,code,type,category_id,uom_id,purchase_uom_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run('tmpl-mobile-a', companyId, 'Mobile Product', 'MOB-A', 'storable', 'cat-mobile', 'unit', 'unit', stamp);
  db.prepare(`INSERT INTO product_variants(id,template_id,company_id,sku,name,barcode,created_at) VALUES(?,?,?,?,?,?,?)`).run('product-mobile-a', 'tmpl-mobile-a', companyId, 'MOB-SKU-A', 'Mobile Product', 'MOB-BC-A', stamp);
  const ctx = { company_id: companyId, warehouse_id: warehouse.id, branch_id: 'branch-a', actor: 'operator-a' };
  const storageZone = topology.createZone(db, { ...ctx, code: 'STO', name: 'Storage', zone_type: 'storage' });
  const quarantineZone = topology.createZone(db, { ...ctx, code: 'QUA', name: 'Quarantine', zone_type: 'quarantine' });
  const source = topology.createLocation(db, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Pick Bin', location_code: 'PICK-A', barcode: 'PICK-A', location_type: 'bin', capacity_units: 100 });
  const staging = topology.createLocation(db, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.output_location_id, name: 'Stage A', location_code: 'STAGE-A', barcode: 'STAGE-A', location_type: 'staging', capacity_units: 100 });
  const destination = topology.createLocation(db, { ...ctx, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Receipt Bin', location_code: 'RECV-A', barcode: 'RECV-A', location_type: 'bin', capacity_units: 100 });
  const quarantine = topology.createLocation(db, { ...ctx, zone_id: quarantineZone.id, parent_id: warehouse.input_location_id, name: 'Quality Hold', location_code: 'QUAR-A', barcode: 'QUAR-A', location_type: 'quarantine', capacity_units: 100 });
  db.prepare(`INSERT INTO stock_quants(id,company_id,product_id,location_id,quantity,reserved_quantity,updated_at) VALUES(?,?,?,?,?,?,?)`).run('quant-mobile-source', companyId, 'product-mobile-a', source.locationId, 20, 0, stamp);
  return { db, companyId, warehouse, ctx, productId: 'product-mobile-a', source, staging, destination, quarantine, storageZone, quarantineZone };
}
