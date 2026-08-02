import { mobileFixture } from './mobile-fixture.mjs';
import { createProductionOrder } from '../../platform/manufacturing/manufacturing-orders.mjs';

export async function productionFixture(t, name = 'production') {
  const fixture = await mobileFixture(t, name);
  const { db, companyId, warehouse, productId, source } = fixture;
  const stamp = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO warehouse_branch_scopes(warehouse_id,company_id,branch_id,created_at)
    VALUES(?,?,?,?)`).run(warehouse.id, companyId, 'branch-a', stamp);
  db.prepare(`INSERT INTO boms(id,company_id,code,product_id,name_en,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('bom-build09', companyId, 'BOM-B09', productId, 'BUILD-09 Product BOM', 'planner-a', stamp, stamp);
  db.prepare(`INSERT INTO bom_versions(id,company_id,bom_id,revision,state,approved_by,approved_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('bomv-build09', companyId, 'bom-build09', 1, 'approved', 'approver-b', stamp, stamp, stamp);
  const order = createProductionOrder(db, {
    company_id: companyId, product_id: productId, planned_quantity: 10, bom_version_id: 'bomv-build09',
    warehouse_id: warehouse.id, wip_location_id: fixture.destination.locationId,
    finished_location_id: fixture.staging.locationId, actor: 'planner-a',
  });
  db.prepare(`INSERT INTO work_centers(id,company_id,code,name_ar,name_en,warehouse_id,wip_location_id,capacity_per_hour,efficiency_percent,working_hours_per_day,is_active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('wc-build09', companyId, 'WC-B09', 'تجميع', 'Assembly', warehouse.id, fixture.destination.locationId, 12, 95, 8, 1, stamp, stamp);
  db.prepare(`INSERT INTO mfg_work_orders(id,company_id,production_order_id,operation_sequence,work_center_id,name,planned_setup_minutes,planned_run_minutes,quantity_to_produce,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run('wo-build09', companyId, order.id, 10, 'wc-build09', 'Assembly operation', 5, 60, 10, 'ready', stamp, stamp);
  db.prepare(`INSERT INTO mfg_material_requirements(id,company_id,production_order_id,component_id,required_quantity,warehouse_id,location_id,state,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run('mreq-build09', companyId, order.id, productId, 10, warehouse.id, source.locationId, 'pending', stamp, stamp);
  db.prepare(`UPDATE mfg_production_orders SET state='released',planned_start_date=?,planned_end_date=?,updated_at=? WHERE id=?`).run('2026-08-03T08:00:00.000Z', '2026-08-03T09:00:00.000Z', stamp, order.id);
  return { ...fixture, orderId: order.id, workOrderId: 'wo-build09', workCenterId: 'wc-build09', requirementId: 'mreq-build09' };
}
