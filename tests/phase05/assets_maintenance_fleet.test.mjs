import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import {
  buildFixture, teardown, seedAccounts, seedUnit, seedProduct, receiveStock,
  seedFinanceAssetCategory, accountBalance, unbalancedEntries, CTX, approverCtx,
} from './helpers.mjs';
import { assets, reports as assetReports } from '../../platform/assets/index.mjs';
import { maintenance, reports as maintenanceReports } from '../../platform/maintenance/index.mjs';
import { fleet, reports as fleetReports } from '../../platform/fleet/index.mjs';

let fx;
let accounts;
let unit;
let warehouse;
let supplier;
let sparePart;
let fuelProduct;
let financeCategory;
let category;

before(async () => {
  fx = await buildFixture('amf');
  accounts = seedAccounts(fx.db);
  unit = seedUnit(fx.db);
  warehouse = fx.execute('warehouse:create', { name: 'Main', code: 'MAIN' }, 'wh');
  supplier = fx.execute('stock:location:create', { name: 'Supplier', usage: 'supplier' }, 'sup');
  fx.execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.laborAbsorption,
    overhead_absorption_account_id: accounts.overheadAbsorption,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'mapping');

  sparePart = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Bearing Kit', sku: 'SP-BEAR', unitId: unit.id, categoryName: 'Spare parts',
  });
  fuelProduct = seedProduct(fx.db, fx.execute, accounts, {
    name: 'Diesel', sku: 'FUEL-D', unitId: unit.id, categoryName: 'Fuel',
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: sparePart.variantId,
    unitId: unit.id, quantity: 100, unitCost: 45, key: 'spares',
  });
  receiveStock(fx.execute, {
    warehouse, supplierLocation: supplier, productId: fuelProduct.variantId,
    unitId: unit.id, quantity: 5000, unitCost: 1, key: 'fuel',
  });

  financeCategory = seedFinanceAssetCategory(fx.db, accounts);
  category = fx.execute('asset:category:create', {
    code: 'MACH', name: 'Machinery',
    finance_category_id: financeCategory.id,
    default_useful_life_months: 12,
    default_method: 'straight_line',
  }, 'cat');
});

after(() => teardown(fx));

// --------------------------------------------------------------------------
// Assets
// --------------------------------------------------------------------------

test('capitalization posts through the Phase 03 contract, never a private ledger', () => {
  const asset = fx.execute('asset:create', {
    name: 'CNC Lathe', category_id: category.id, acquisition_value: 120_000,
    serial_number: 'CNC-9981',
  }, 'asset-1');
  assert.equal(asset.state, 'draft');

  const assetGrossBefore = accountBalance(fx.db, accounts.assetGross);
  const clearingBefore = accountBalance(fx.db, accounts.assetClearing);

  const capitalized = fx.execute('asset:capitalize', {
    asset_id: asset.id, source_account_id: accounts.assetClearing, amount: 120_000,
  }, 'asset-1-cap');

  assert.equal(capitalized.state, 'active');
  assert.ok(capitalized.capitalization.document_id);
  assert.equal(accountBalance(fx.db, accounts.assetGross), assetGrossBefore + 120_000);
  assert.equal(accountBalance(fx.db, accounts.assetClearing), clearingBefore - 120_000);

  // No asset-side journal table exists.
  const ledgers = fx.db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND name IN ('asset_journal_entries', 'asset_ledger', 'asset_gl_entries')
  `).all();
  assert.deepEqual(ledgers, [], 'assets must not carry an independent ledger');

  assert.throws(
    () => fx.execute('asset:capitalize', {
      asset_id: asset.id, source_account_id: accounts.assetClearing, amount: 120_000,
    }, 'asset-1-cap-again'),
    /already capitalized/,
  );
});

test('an unmapped asset category cannot capitalize', () => {
  const unmapped = fx.execute('asset:category:create', {
    code: 'UNMAPPED', name: 'Unmapped category', default_useful_life_months: 24,
  }, 'cat-unmapped');
  const asset = fx.execute('asset:create', {
    name: 'Orphan press', category_id: unmapped.id, acquisition_value: 5_000,
  }, 'asset-unmapped');
  assert.throws(
    () => fx.execute('asset:capitalize', {
      asset_id: asset.id, source_account_id: accounts.assetClearing,
    }, 'asset-unmapped-cap'),
    /no Phase 03 finance category/,
  );
});

test('the straight-line schedule sums exactly to the depreciable base', () => {
  const asset = fx.execute('asset:create', {
    name: 'Press Brake', category_id: category.id, acquisition_value: 100_000,
    residual_value: 10_000, useful_life_months: 12,
  }, 'asset-2');
  fx.execute('asset:capitalize', {
    asset_id: asset.id, source_account_id: accounts.assetClearing,
  }, 'asset-2-cap');

  const schedule = fx.execute('asset:schedule:generate', {
    asset_id: asset.id, start_date: '2026-01-31',
  }, 'asset-2-sched');
  assert.equal(schedule.generated, 12);
  assert.equal(schedule.depreciable_base, 90_000);
  assert.equal(schedule.total_scheduled, 90_000, 'rounding must land in the final period, not vanish');

  const rows = fx.db.prepare(
    'SELECT period_index, period_date, depreciation_amount FROM depreciation_schedules WHERE asset_id = ? ORDER BY period_index',
  ).all(asset.id);
  assert.equal(rows[0].period_date, '2026-01-31');
  assert.equal(rows[11].period_date, '2026-12-31');
  assert.equal(rows[0].depreciation_amount, 7_500);
});

test('depreciation posts period by period and is never posted twice', () => {
  const asset = fx.execute('asset:create', {
    name: 'Grinder', category_id: category.id, acquisition_value: 12_000, useful_life_months: 12,
  }, 'asset-3');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'asset-3-cap');
  fx.execute('asset:schedule:generate', { asset_id: asset.id, start_date: '2026-01-31' }, 'asset-3-sched');

  const expenseBefore = accountBalance(fx.db, accounts.depreciationExpense);
  const accumulatedBefore = accountBalance(fx.db, accounts.accumulatedDepreciation);

  const posted = fx.execute('asset:depreciation:post', {
    asset_id: asset.id, up_to_date: '2026-03-31',
  }, 'asset-3-post');
  assert.equal(posted.posted_periods, 3);
  assert.equal(posted.total_amount, 3_000);
  assert.equal(posted.documents.length, 3, 'each period is its own recoverable posting');

  assert.equal(accountBalance(fx.db, accounts.depreciationExpense), expenseBefore + 3_000);
  assert.equal(accountBalance(fx.db, accounts.accumulatedDepreciation), accumulatedBefore - 3_000);

  const rerun = fx.execute('asset:depreciation:post', {
    asset_id: asset.id, up_to_date: '2026-03-31',
  }, 'asset-3-post-again');
  assert.equal(rerun.posted_periods, 0, 'a re-run must post nothing');

  const value = assets.netBookValue(fx.db, asset.id);
  assert.equal(value.accumulated_depreciation, 3_000);
  assert.equal(value.net_book_value, 9_000);

  assert.throws(
    () => fx.execute('asset:schedule:generate', { asset_id: asset.id }, 'asset-3-resched'),
    /already has posted depreciation/,
  );
});

test('a declining-balance schedule front-loads and still totals the base', () => {
  const asset = fx.execute('asset:create', {
    name: 'Forklift', category_id: category.id, acquisition_value: 60_000,
    useful_life_months: 12, depreciation_method: 'declining_balance', declining_rate_percent: 40,
  }, 'asset-4');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'asset-4-cap');
  const schedule = fx.execute('asset:schedule:generate', { asset_id: asset.id, start_date: '2026-01-31' }, 'asset-4-sched');
  assert.equal(schedule.total_scheduled, 60_000);

  const rows = fx.db.prepare(
    'SELECT depreciation_amount FROM depreciation_schedules WHERE asset_id = ? ORDER BY period_index',
  ).all(asset.id);
  assert.ok(rows[0].depreciation_amount > rows[1].depreciation_amount, 'declining balance must front-load');
});

test('units-of-production is rejected for scheduling rather than silently treated as straight line', () => {
  const asset = fx.execute('asset:create', {
    name: 'Die Set', category_id: category.id, acquisition_value: 9_000,
    depreciation_method: 'units_of_production', total_expected_units: 100_000,
  }, 'asset-5');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'asset-5-cap');
  assert.throws(
    () => fx.execute('asset:schedule:generate', { asset_id: asset.id }, 'asset-5-sched'),
    /not scheduled in advance/,
  );
});

test('disposal posts gain or loss from the register net book value', () => {
  const asset = fx.execute('asset:create', {
    name: 'Old Compressor', category_id: category.id, acquisition_value: 10_000, useful_life_months: 12,
  }, 'asset-6');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'asset-6-cap');
  fx.execute('asset:schedule:generate', { asset_id: asset.id, start_date: '2026-01-31' }, 'asset-6-sched');
  fx.execute('asset:depreciation:post', { asset_id: asset.id, up_to_date: '2026-06-30' }, 'asset-6-post');

  // 10,000 over 12 months is 833.33 a month; the rounding remainder is carried
  // by the final period, so six posted periods total 4,999.98 rather than a
  // tidy 5,000. The register reports what was actually posted.
  const value = assets.netBookValue(fx.db, asset.id);
  assert.equal(value.accumulated_depreciation, 4_999.98);
  assert.equal(value.net_book_value, 5_000.02);

  const gainBefore = accountBalance(fx.db, accounts.disposalGain);
  const disposed = fx.execute('asset:dispose', {
    asset_id: asset.id, proceeds_account_id: accounts.cash, proceeds: 6_500,
  }, 'asset-6-dispose');

  assert.equal(disposed.state, 'disposed');
  assert.equal(disposed.disposal.net_book_value, 5_000.02);
  assert.equal(disposed.disposal.gain, 1_499.98);
  assert.equal(disposed.disposal.loss, 0);
  assert.equal(accountBalance(fx.db, accounts.disposalGain), gainBefore - 1_499.98, 'gain is a credit balance');

  const remaining = fx.db.prepare(
    "SELECT COUNT(*) AS n FROM depreciation_schedules WHERE asset_id = ? AND status = 'scheduled'",
  ).get(asset.id).n;
  assert.equal(Number(remaining), 0, 'disposal must cancel the remaining schedule');
});

test('a write-off is a disposal with zero proceeds and posts the whole loss', () => {
  const asset = fx.execute('asset:create', {
    name: 'Damaged Jig', category_id: category.id, acquisition_value: 4_000, useful_life_months: 12,
  }, 'asset-7');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'asset-7-cap');
  const lossBefore = accountBalance(fx.db, accounts.disposalLoss);
  const written = fx.execute('asset:write_off', {
    asset_id: asset.id, proceeds_account_id: accounts.cash,
  }, 'asset-7-writeoff');
  assert.equal(written.state, 'written_off');
  assert.equal(written.disposal.loss, 4_000);
  assert.equal(accountBalance(fx.db, accounts.disposalLoss), lossBefore + 4_000);
});

test('the asset register ties to the general ledger', () => {
  const reconciliation = assetReports.assetAccountingReconciliation(fx.db, { company_id: CTX.companyId });
  const mapped = reconciliation.find((row) => row.category_code === 'MACH');
  assert.ok(mapped.mapped);
  assert.equal(
    mapped.depreciation_variance, 0,
    'posted depreciation in the register must equal the accumulated-depreciation account',
  );
  assert.equal(
    mapped.asset_variance, 0,
    'capitalized value in the register must equal the asset account',
  );
  assert.match(mapped.disposal_treatment, /credits the asset account by net book value/);
});

// --------------------------------------------------------------------------
// Maintenance
// --------------------------------------------------------------------------

test('preventive generation is idempotent: running it twice creates one order', () => {
  const asset = fx.execute('asset:create', {
    name: 'Air Compressor', category_id: category.id, acquisition_value: 8_000,
  }, 'pm-asset');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'pm-asset-cap');

  const plan = fx.execute('maintenance:plan:create', {
    name: 'Quarterly service', code: 'PM-Q', asset_id: asset.id,
    trigger_type: 'calendar', interval_days: 90, next_due_date: '2026-01-01',
    estimated_hours: 4, checklist: ['Change filter', 'Check belts'],
  }, 'pm-plan');
  assert.equal(plan.trigger_type, 'calendar');

  const first = fx.execute('maintenance:plan:generate', { plan_id: plan.id, as_of: '2026-02-01' }, 'pm-gen-1');
  assert.equal(first.generated, 1);
  const generationKey = first.created[0].generation_key;

  const second = fx.execute('maintenance:plan:generate', { plan_id: plan.id, as_of: '2026-02-01' }, 'pm-gen-2');
  assert.equal(second.generated, 0, 'a second run for the same due point must generate nothing');

  const orders = fx.db.prepare(
    'SELECT COUNT(*) AS n FROM maintenance_orders WHERE plan_id = ? AND generation_key = ?',
  ).get(plan.id, generationKey).n;
  assert.equal(Number(orders), 1);
});

test('a meter trigger fires from asset meter readings, not a second meter store', () => {
  const asset = fx.execute('asset:create', {
    name: 'Excavator', category_id: category.id, acquisition_value: 200_000,
  }, 'meter-asset');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'meter-asset-cap');
  fx.execute('asset:meter:record', { asset_id: asset.id, meter_type: 'hours', reading: 100 }, 'meter-1');

  const plan = fx.execute('maintenance:plan:create', {
    name: '500-hour service', code: 'PM-500H', asset_id: asset.id,
    trigger_type: 'meter', meter_type: 'hours', meter_interval: 500,
  }, 'meter-plan');
  assert.equal(plan.next_due_meter, 600, '100 current + 500 interval');

  assert.equal(fx.execute('maintenance:plan:generate', { plan_id: plan.id }, 'meter-gen-early').generated, 0);

  assert.throws(
    () => fx.execute('asset:meter:record', { asset_id: asset.id, meter_type: 'hours', reading: 50 }, 'meter-back'),
    /lower than the previous reading/,
  );

  fx.execute('asset:meter:record', { asset_id: asset.id, meter_type: 'hours', reading: 640 }, 'meter-2');
  const generated = fx.execute('maintenance:plan:generate', { plan_id: plan.id }, 'meter-gen');
  assert.equal(generated.generated, 1);
  assert.match(generated.created[0].generation_key, /meter:600/);
});

test('maintenance takes the asset out of service and quality gates its return', () => {
  const asset = fx.execute('asset:create', {
    name: 'Bandsaw', category_id: category.id, acquisition_value: 15_000,
  }, 'mnt-asset');
  fx.execute('asset:capitalize', { asset_id: asset.id, source_account_id: accounts.assetClearing }, 'mnt-asset-cap');

  const qualityPlan = fx.execute('quality:plan:create', {
    name: 'Post-service safety check', code: 'QP-SVC', trigger_event: 'maintenance', is_mandatory: true,
    points: [{ characteristic: 'Guard fitted', measurement_type: 'boolean' }],
  }, 'mnt-qp');

  const request = fx.execute('maintenance:request:create', {
    title: 'Blade slipping', asset_id: asset.id, maintenance_type: 'corrective',
    symptom: 'blade slips under load',
  }, 'mnt-req');
  assert.equal(request.state, 'new');

  const order = fx.execute('maintenance:order:create', {
    title: 'Replace blade drive', request_id: request.id, asset_id: asset.id,
    maintenance_type: 'corrective', quality_plan_id: qualityPlan.id, planned_hours: 3,
  }, 'mnt-order');
  assert.ok(order.work_item_id, 'maintenance work must be a canonical Work Item');
  const workItem = fx.db.prepare('SELECT * FROM work_items WHERE id = ?').get(order.work_item_id);
  assert.equal(workItem.source_type, 'maintenance_order');
  assert.equal(workItem.maintenance_ref, order.id);
  assert.equal(
    fx.db.prepare('SELECT state FROM maintenance_requests WHERE id = ?').get(request.id).state,
    'converted',
  );

  fx.execute('maintenance:order:approve', { order_id: order.id }, 'mnt-approve');
  fx.execute('maintenance:order:start', { order_id: order.id }, 'mnt-start');
  assert.equal(
    fx.db.prepare('SELECT state FROM assets WHERE id = ?').get(asset.id).state,
    'under_maintenance',
    'starting maintenance must take the asset out of service',
  );

  const inventoryBefore = accountBalance(fx.db, accounts.inventory);
  const part = fx.execute('maintenance:part:issue', {
    order_id: order.id, product_id: sparePart.variantId, quantity: 2, warehouse_id: warehouse.id,
  }, 'mnt-part');
  assert.equal(part.value, 90, '2 kits at 45.00');
  assert.ok(part.stock_move_id, 'spare parts move through the canonical stock engine');
  assert.equal(accountBalance(fx.db, accounts.inventory), inventoryBefore - 90);

  const labour = fx.execute('maintenance:labor:record', {
    order_id: order.id, hours: 3, rate_per_hour: 25, technician_ref: 'tech-7',
    expense_account_id: accounts.expense, credit_account_id: accounts.payrollClearing,
  }, 'mnt-labour');
  assert.equal(labour.amount, 75);
  assert.ok(labour.finance_document_id);

  assert.throws(
    () => fx.execute('maintenance:order:complete', { order_id: order.id }, 'mnt-complete-noroot'),
    /needs a root cause/,
  );
  const completed = fx.execute('maintenance:order:complete', {
    order_id: order.id, root_cause: 'worn drive belt', corrective_action: 'belt replaced',
  }, 'mnt-complete');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.total_cost, 165, '90 parts + 75 labour');

  // The mandatory inspection blocks return to service.
  assert.throws(
    () => fx.execute('maintenance:order:return_to_service', { order_id: order.id }, 'mnt-rts-blocked'),
    /blocks return to service/,
  );
  // The refusal is transactional: it writes nothing. The order stays completed
  // until someone explicitly parks it on hold.
  assert.equal(maintenance.getOrder(fx.db, order.id, CTX.companyId).state, 'completed');
  fx.execute('maintenance:order:hold', { order_id: order.id }, 'mnt-hold');
  assert.equal(maintenance.getOrder(fx.db, order.id, CTX.companyId).state, 'quality_hold');

  const inspection = fx.db.prepare(
    "SELECT * FROM quality_inspections WHERE subject_type = 'maintenance_order' AND subject_id = ?",
  ).get(order.id);
  const point = fx.db.prepare('SELECT id FROM quality_plan_points WHERE plan_id = ?').get(qualityPlan.id);
  fx.execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [{ plan_point_id: point.id, numeric_value: 1 }],
  }, 'mnt-qi-record');
  fx.execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'pass' }, 'mnt-qi-decide');

  const returned = fx.execute('maintenance:order:return_to_service', { order_id: order.id }, 'mnt-rts');
  assert.equal(returned.state, 'closed');
  assert.equal(
    fx.db.prepare('SELECT state FROM assets WHERE id = ?').get(asset.id).state,
    'active',
    'return to service must put the asset back in service',
  );
});

test('reliability reporting reports insufficient history instead of inventing MTBF', () => {
  const report = maintenanceReports.reliabilityReport(fx.db, { company_id: CTX.companyId });
  assert.ok(report.length >= 1);
  for (const row of report) {
    if (row.failures < 2) {
      assert.equal(row.mtbf_hours, null);
      assert.equal(row.mtbf_basis, 'insufficient failure history');
    }
  }
});

// --------------------------------------------------------------------------
// Fleet
// --------------------------------------------------------------------------

test('a vehicle is an asset, and a vehicle without one says so explicitly', () => {
  const vehicleAsset = fx.execute('asset:create', {
    name: 'Truck 01', category_id: category.id, acquisition_value: 90_000,
  }, 'veh-asset');
  fx.execute('asset:capitalize', { asset_id: vehicleAsset.id, source_account_id: accounts.assetClearing }, 'veh-asset-cap');

  const vehicle = fx.execute('fleet:vehicle:create', {
    name: 'Truck 01', plate_number: 'BAS-1001', asset_id: vehicleAsset.id,
    expected_consumption_per_100: 30, tank_capacity: 300, odometer: 10_000,
  }, 'veh-1');
  assert.equal(vehicle.depreciates, true);
  assert.equal(vehicle.asset.id, vehicleAsset.id);

  const unlinked = fx.execute('fleet:vehicle:create', {
    name: 'Hired Van', plate_number: 'BAS-2002', ownership: 'rented',
  }, 'veh-2');
  assert.equal(unlinked.depreciates, false);
  assert.match(unlinked.depreciation_note, /does not depreciate/);

  assert.throws(
    () => fx.execute('fleet:vehicle:create', { name: 'Clone', plate_number: 'BAS-1001' }, 'veh-dup'),
    /plate number already registered/,
  );
});

test('trip distance updates the odometer and refuses to run backwards', () => {
  const vehicle = fx.db.prepare("SELECT * FROM fleet_vehicles WHERE plate_number = 'BAS-1001'").get();
  const driver = fx.execute('fleet:driver:register', {
    driver_ref: 'drv-1', name: 'Ali', licence_number: 'L-88', licence_expiry: '2026-09-01',
  }, 'drv-1');
  fx.execute('fleet:assignment:create', { vehicle_id: vehicle.id, driver_id: driver.id }, 'asg-1');

  const trip = fx.execute('fleet:trip:start', {
    vehicle_id: vehicle.id, driver_id: driver.id, origin: 'Basra', destination: 'Nasiriyah',
  }, 'trip-1');
  assert.equal(trip.start_odometer, 10_000);

  assert.throws(
    () => fx.execute('fleet:trip:start', { vehicle_id: vehicle.id }, 'trip-1-dup'),
    /already has a trip in progress/,
  );
  assert.throws(
    () => fx.execute('fleet:trip:complete', { trip_id: trip.id, end_odometer: 9_000 }, 'trip-1-back'),
    /lower than the start odometer/,
  );

  const completed = fx.execute('fleet:trip:complete', { trip_id: trip.id, end_odometer: 10_400 }, 'trip-1-end');
  assert.equal(completed.distance_km, 400);
  assert.equal(
    fx.db.prepare('SELECT odometer FROM fleet_vehicles WHERE id = ?').get(vehicle.id).odometer,
    10_400,
  );
});

test('fuel variance is measured against expected consumption and raises an alert', () => {
  const vehicle = fx.db.prepare("SELECT * FROM fleet_vehicles WHERE plate_number = 'BAS-1001'").get();
  const tank = fx.db.prepare(`
    INSERT INTO fleet_fuel_tanks (id, company_id, code, name, location_id, product_id, capacity, current_level, sensor_provider, created_at)
    VALUES ('ftank_1', ?, 'TANK-A', 'Yard tank', ?, ?, 20000, 5000, NULL, ?) RETURNING *
  `).get(CTX.companyId, warehouse.lot_stock_id, fuelProduct.variantId, new Date().toISOString());

  // Baseline fill establishes the odometer reference point.
  fx.execute('fleet:fuel:record', {
    vehicle_id: vehicle.id, quantity: 100, unit_price: 1, odometer: 10_400,
    tank_id: tank.id, external_reference: 'FUEL-0001',
  }, 'fuel-1');

  // 400 km at 30 L/100 km expects 120 L; 180 L is a 50% overrun.
  const second = fx.execute('fleet:fuel:record', {
    vehicle_id: vehicle.id, quantity: 180, unit_price: 1, odometer: 10_800,
    tank_id: tank.id, external_reference: 'FUEL-0002',
  }, 'fuel-2');

  assert.equal(second.expected_quantity, 120);
  assert.equal(second.variance_quantity, 60);
  assert.equal(second.variance_percent, 50);
  assert.equal(second.tolerance_percent, 10, 'the tolerance comes from the Control Plane policy');
  assert.ok(second.alert_id, 'a variance beyond tolerance must raise an alert');
  assert.ok(second.stock_move_id, 'tank fuel moves through the canonical stock engine');

  const alert = fx.db.prepare('SELECT * FROM fleet_alerts WHERE id = ?').get(second.alert_id);
  assert.equal(alert.alert_type, 'fuel_variance');
  assert.equal(alert.status, 'open');

  assert.throws(
    () => fx.execute('fleet:fuel:record', {
      vehicle_id: vehicle.id, quantity: 50, unit_price: 1, external_reference: 'FUEL-0002',
    }, 'fuel-dup'),
    /already been recorded/,
  );
});

test('a fleet incident opens real maintenance work rather than a fleet-only repair record', () => {
  const vehicle = fx.db.prepare("SELECT * FROM fleet_vehicles WHERE plate_number = 'BAS-1001'").get();
  const incident = fx.execute('fleet:incident:record', {
    vehicle_id: vehicle.id, incident_type: 'breakdown', description: 'Gearbox failure', cost: 0,
  }, 'inc-1');

  assert.ok(incident.maintenance_order_id, 'a breakdown must create a canonical maintenance order');
  const order = maintenance.getOrder(fx.db, incident.maintenance_order_id, CTX.companyId);
  assert.equal(order.vehicle_id, vehicle.id);
  assert.equal(order.maintenance_type, 'corrective');
  assert.ok(order.work_item_id);

  const fleetRepairTables = fx.db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
      AND name IN ('fleet_maintenance_orders', 'fleet_repairs', 'fleet_service_records')
  `).all();
  assert.deepEqual(fleetRepairTables, [], 'fleet must not have its own maintenance engine');
});

test('telemetry requires a registered provider and no vendor is hard-coded', () => {
  const vehicle = fx.db.prepare("SELECT * FROM fleet_vehicles WHERE plate_number = 'BAS-1001'").get();
  assert.throws(
    () => fx.execute('fleet:telemetry:ingest', {
      vehicle_id: vehicle.id, provider: 'acme-obd', event_type: 'position',
    }, 'tel-unknown'),
    /is not registered/,
  );

  fx.execute('fleet:telemetry:provider', {
    provider_code: 'acme-obd', provider_kind: 'obd', config: { endpoint: 'https://example.invalid' },
  }, 'tel-provider');

  const ingested = fx.execute('fleet:telemetry:ingest', {
    vehicle_id: vehicle.id, provider: 'acme-obd', event_type: 'position',
    odometer: 11_000, speed_kph: 92, payload: { vendorSpecific: { rpm: 2100 } },
    external_reference: 'TEL-1',
  }, 'tel-1');
  assert.ok(ingested.id);
  assert.equal(
    fx.db.prepare('SELECT odometer FROM fleet_vehicles WHERE id = ?').get(vehicle.id).odometer,
    11_000,
    'telemetry odometer promotes onto the vehicle',
  );

  const replay = fx.execute('fleet:telemetry:ingest', {
    vehicle_id: vehicle.id, provider: 'acme-obd', event_type: 'position', external_reference: 'TEL-1',
  }, 'tel-1-replay');
  assert.equal(replay.duplicate, true, 'a replayed telemetry event must not be stored twice');

  // A second, completely different provider works the same way.
  fx.execute('fleet:telemetry:provider', {
    provider_code: 'other-sensor', provider_kind: 'tank_sensor',
  }, 'tel-provider-2');
  const other = fx.execute('fleet:telemetry:ingest', {
    vehicle_id: vehicle.id, provider: 'other-sensor', event_type: 'fuel_level', fuel_level: 62,
  }, 'tel-2');
  assert.ok(other.id);
});

test('fleet reporting reports cost per kilometre only where distance was measured', () => {
  const report = fleetReports.costPerKilometre(fx.db, { company_id: CTX.companyId });
  const measured = report.find((row) => row.plate_number === 'BAS-1001');
  const unmeasured = report.find((row) => row.plate_number === 'BAS-2002');
  assert.ok(measured.cost_per_km > 0);
  assert.equal(measured.cost_per_km_basis, 'measured trips');
  assert.equal(unmeasured.cost_per_km, null);
  assert.match(unmeasured.cost_per_km_basis, /no completed trip distance/);
});

test('every posted journal entry in the asset, maintenance and fleet suite balances', () => {
  assert.deepEqual(unbalancedEntries(fx.db), []);
});
