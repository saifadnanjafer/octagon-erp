import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { products, uom } from '../../platform/commercial/index.mjs';
import { createWarehouse } from '../../platform/inventory/warehouses.mjs';
import { postStockMove } from '../../platform/inventory/ledger.mjs';
import * as topology from '../../platform/wms/topology.mjs';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';
import { PILOT_ACTORS, actorContext } from './pilot-actors.mjs';

export async function openPilot(t, name = 'pilot') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `octagon-internal-pilot-${name}-`));
  const dbPath = path.join(directory, 'pilot.db');
  await freshInstall({ dbPath, backupDir: path.join(directory, 'backups'), actor: 'internal-workshop-pilot' });
  const db = openMigrationDatabase(dbPath);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const executor = createPlatformAuthority(db).actionExecutor;
  let sequence = 0;
  const contexts = {};
  for (const [key, actor] of Object.entries(PILOT_ACTORS)) contexts[key] = actorContext(actor);

  function key(label) { sequence += 1; return `pilot-${name}-${label}-${sequence}`; }
  function executeAs(actorKey, action, input = {}) {
    const ctx = contexts[actorKey];
    if (!ctx) throw new Error(`Unknown pilot actor ${actorKey}`);
    return executor.execute(action, { ...input, idempotency_key: input.idempotency_key || key(action.replaceAll(':', '-')) }, ctx);
  }
  return { directory, dbPath, db, executor, contexts, executeAs, key };
}

export function seedPilotWorkshop(pilot) {
  const { db, executeAs } = pilot;
  const stamp = '2026-08-05T06:00:00.000Z';
  const companyId = 'default';

  const warehouse = createWarehouse(db, { company_id: companyId, name: 'Internal Pilot Warehouse', code: 'PILOT-WH' });
  db.prepare('INSERT OR IGNORE INTO warehouse_branch_scopes(warehouse_id,company_id,branch_id,created_at) VALUES(?,?,?,?)')
    .run(warehouse.id, companyId, 'branch-pilot', stamp);
  for (const key of Object.keys(pilot.contexts)) pilot.contexts[key] = Object.freeze({ ...pilot.contexts[key], warehouseId: warehouse.id });

  const supplier = executeAs('warehouseOperator', 'stock:location:create', { name: 'Pilot Supplier', usage: 'supplier', warehouse_id: warehouse.id });
  const customerLocation = executeAs('deliveryClerk', 'stock:location:create', { name: 'Pilot Customers', usage: 'customer', warehouse_id: warehouse.id });
  const customer = executeAs('supervisor', 'party:create', { name: 'Internal Pilot Customer', roles: ['customer'] });
  const uomCategory = uom.createUomCategory(db, { name: 'Pilot Units' });
  const unit = uom.createUom(db, { category_id: uomCategory.id, name: 'Pilot Piece' });
  const category = products.createProductCategory(db, {
    company_id: companyId, name: 'Pilot Finished Goods', costing_method: 'avco',
    income_account_id: 'acc_401000', expense_account_id: 'acc_501000', stock_account_id: 'acc_104000',
    stock_input_account_id: 'acc_201000', stock_output_account_id: 'acc_500000',
  });
  const product = executeAs('planner', 'product:template:create', {
    name: 'Pilot Assembly', code: 'PILOT-ASSEMBLY', category_id: category.id, uom_id: unit.id,
    list_price: 250, standard_price: 80, sku: 'PILOT-SKU', barcode: 'PILOT-BC',
  });
  const productId = product.default_variant_id;

  postStockMove(db, {
    company_id: companyId, reference: 'PILOT-OPENING-COMPONENTS', product_id: productId, uom_id: unit.id,
    product_qty: 40, location_id: supplier.id, location_dest_id: warehouse.lot_stock_id, unit_cost: 80,
    source_document_type: 'pilot_opening', source_document_id: 'PILOT-OPENING',
    idempotency_key: 'pilot-opening-components', actor: PILOT_ACTORS.warehouseOperator.id,
  });

  const storageZone = topology.createZone(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id, code: 'P-STO', name: 'Pilot Storage', zone_type: 'storage' });
  const qualityZone = topology.createZone(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.qualityInspector.id, code: 'P-QUA', name: 'Pilot Quality', zone_type: 'quarantine' });
  const component = topology.createLocation(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Pilot Components', location_code: 'P-COMP', barcode: 'P-COMP', location_type: 'bin', capacity_units: 200 });
  const wip = topology.createLocation(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.productionOperator.id, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Pilot WIP', location_code: 'P-WIP', barcode: 'P-WIP', location_type: 'staging', capacity_units: 100 });
  const finished = topology.createLocation(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id, zone_id: storageZone.id, parent_id: warehouse.lot_stock_id, name: 'Pilot Finished', location_code: 'P-FIN', barcode: 'P-FIN', location_type: 'bin', capacity_units: 100, fixed_product_id: productId });
  const quarantine = topology.createLocation(db, { company_id: companyId, warehouse_id: warehouse.id, actor: PILOT_ACTORS.qualityInspector.id, zone_id: qualityZone.id, parent_id: warehouse.input_location_id, name: 'Pilot Quality Hold', location_code: 'P-HOLD', barcode: 'P-HOLD', location_type: 'quarantine', capacity_units: 100 });

  // Move component stock from the warehouse authority root to the execution bin.
  postStockMove(db, {
    company_id: companyId, reference: 'PILOT-BIN-LOAD', product_id: productId, uom_id: unit.id,
    product_qty: 20, location_id: warehouse.lot_stock_id, location_dest_id: component.locationId, unit_cost: 80,
    source_document_type: 'pilot_bin_load', source_document_id: 'PILOT-BIN-LOAD',
    idempotency_key: 'pilot-bin-load', actor: PILOT_ACTORS.warehouseOperator.id,
  });

  db.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('pilot-bom', companyId, 'PILOT-BOM', productId, 'Pilot Assembly BOM', PILOT_ACTORS.planner.id, stamp, stamp);
  db.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('pilot-bom-v1', companyId, 'pilot-bom', 1, 'approved', PILOT_ACTORS.supervisor.id, stamp, stamp, stamp);
  db.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('pilot-wc', companyId, 'PILOT-WC', 'تجميع تجريبي', 'Pilot Assembly', warehouse.id, wip.locationId, 10, 95, 8, 1, stamp, stamp);

  const order = createProductionOrder(db, {
    company_id: companyId, product_id: productId, planned_quantity: 5, bom_version_id: 'pilot-bom-v1',
    warehouse_id: warehouse.id, wip_location_id: wip.locationId, finished_location_id: finished.locationId,
    actor: PILOT_ACTORS.planner.id,
  });
  db.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('pilot-work-order', companyId, order.id, 10, 'pilot-wc', 'Pilot assembly operation', 5, 40, 5, 'ready', stamp, stamp);
  db.prepare(`INSERT INTO mfg_material_requirements(id,company_id,production_order_id,component_id,required_quantity,warehouse_id,location_id,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run('pilot-requirement', companyId, order.id, productId, 5, warehouse.id, component.locationId, 'pending', stamp, stamp);
  db.prepare("UPDATE mfg_production_orders SET state='released',planned_start_date=?,planned_end_date=?,updated_at=? WHERE id=?")
    .run('2026-08-05T07:00:00.000Z', '2026-08-05T12:00:00.000Z', stamp, order.id);

  return {
    companyId, warehouse, supplier, customerLocation, customer, unit, category, product, productId,
    storageZone, qualityZone, component, wip, finished, quarantine,
    productionOrderId: order.id, workOrderId: 'pilot-work-order', requirementId: 'pilot-requirement',
  };
}

