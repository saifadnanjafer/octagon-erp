#!/usr/bin/env node
// Phase 05 browser-verification server.
//
// Serves the real Octagon shell (index.html, app.js, views/, modules/) and the
// real canonical `/api/v1` handler, against a DISPOSABLE database created in the
// OS temp directory. The operational `database.db` is never opened.
//
// This exists because verifying the Phase 05 UI must not require starting the
// production server. Running `server.js` would open the live store, and a second
// process on that file is exactly the WAL incident the project already learned
// from.
//
// Usage:
//   node scripts/phase05-verify-server.mjs [--port 8097] [--db <path>]

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { freshInstall, openMigrationDatabase } from '../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../platform-runtime-bridge.mjs';
import { createApiHandler } from '../platform/api/index.mjs';
import { products, uom } from '../platform/commercial/index.mjs';
import {
  setApprovalAuthorityLimit, createAccount, createAssetCategory,
} from '../platform/finance/engine.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PORT = Number(arg('port', process.env.PORT || 8097));
const DB_PATH = path.resolve(arg(
  'db',
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-phase05-verify-')), 'verify.db'),
));

const CTX = {
  tenantId: 'default',
  companyId: 'default',
  branchId: null,
  userId: 'phase05-verify',
  actorType: 'user',
  sourceChannel: 'verify-server',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Seed a small, complete demonstration chain so every Phase 05 workspace has
 * something real to render: raw material → BOM → manufacturing order → issue →
 * completion, a project with a budget, an asset with a schedule, a maintenance
 * order and a vehicle.
 */
function seed(db, executor) {
  const execute = (actionId, input, key, ctx = CTX) =>
    executor.execute(actionId, { ...input, idempotency_key: key }, ctx);

  setApprovalAuthorityLimit(db, CTX, {
    role_or_user: CTX.userId, limit_type: 'post', max_amount: 1_000_000_000, currency: 'IQD',
  });

  const account = (code, name, type) => {
    const existing = db.prepare('SELECT id FROM finance_accounts WHERE company_id = ? AND code = ?')
      .get(CTX.companyId, code);
    return existing ? existing.id : createAccount(db, CTX, { code, name, type }).id;
  };
  const accounts = {
    inventory: account('104100', 'Raw Material Inventory', 'asset'),
    finishedGoods: account('104200', 'Finished Goods Inventory', 'asset'),
    stockInput: account('201100', 'Goods Received Not Invoiced', 'liability'),
    stockOutput: account('500100', 'Cost of Goods Sold', 'expense'),
    adjustment: account('501100', 'Inventory Adjustment', 'expense'),
    wip: account('104300', 'Work In Progress', 'asset'),
    labour: account('502100', 'Labour Absorption', 'expense'),
    overhead: account('502200', 'Overhead Absorption', 'expense'),
    scrap: account('503100', 'Production Scrap', 'expense'),
    variance: account('503200', 'Production Variance', 'expense'),
    assetGross: account('120100', 'Machinery at Cost', 'asset'),
    accumulated: account('120900', 'Accumulated Depreciation', 'asset'),
    depreciation: account('505100', 'Depreciation Expense', 'expense'),
    gain: account('420100', 'Gain on Disposal', 'income'),
    loss: account('506100', 'Loss on Disposal', 'expense'),
    clearing: account('201200', 'Asset Clearing', 'liability'),
    receivable: account('103100', 'Trade Receivable', 'receivable'),
    revenue: account('400100', 'Project Revenue', 'income'),
  };

  execute('manufacturing:account_mapping:set', {
    wip_account_id: accounts.wip,
    labor_absorption_account_id: accounts.labour,
    overhead_absorption_account_id: accounts.overhead,
    scrap_account_id: accounts.scrap,
    variance_account_id: accounts.variance,
  }, 'seed-mapping');

  const unitCategory = uom.createUomCategory(db, { name: 'Verify units' });
  const unit = uom.createUom(db, { category_id: unitCategory.id, name: 'Piece', symbol: 'pc' });

  const makeProduct = (name, sku, stockAccountId, categoryName) => {
    const category = products.createProductCategory(db, {
      company_id: CTX.companyId, name: categoryName, costing_method: 'avco',
      stock_account_id: stockAccountId,
      stock_input_account_id: accounts.stockInput,
      stock_output_account_id: accounts.stockOutput,
      expense_account_id: accounts.adjustment,
    });
    const template = execute('product:template:create', {
      name, category_id: category.id, uom_id: unit.id, sku,
    }, `seed-product-${sku}`);
    return template.default_variant_id;
  };

  const componentId = makeProduct('صفيحة فولاذ', 'RM-PLATE', accounts.inventory, 'مواد خام');
  const finishedId = makeProduct('هيكل ملحوم', 'FG-FRAME', accounts.finishedGoods, 'منتجات تامة');

  const warehouse = execute('warehouse:create', { name: 'المخزن الرئيسي', code: 'MAIN' }, 'seed-wh');
  const supplierLocation = execute('stock:location:create', { name: 'المورد', usage: 'supplier' }, 'seed-sup');

  execute('stock:move:post', {
    reference: 'OPENING-PLATE', product_id: componentId, uom_id: unit.id, product_qty: 500,
    location_id: supplierLocation.id, location_dest_id: warehouse.lot_stock_id, unit_cost: 8,
    source_document_type: 'inventory_adjustment', source_document_id: 'OPENING-1',
    source_line_id: 'OPENING-1-1',
  }, 'seed-receipt');

  const workCenter = execute('manufacturing:work_center:create', {
    code: 'WC-WELD', name: 'قسم اللحام',
    labor_cost_per_hour: 25, machine_cost_per_hour: 15, overhead_cost_per_hour: 5,
    calendar: [{ weekday: 1, start_minute: 480, end_minute: 960 }],
  }, 'seed-wc');

  const routing = execute('manufacturing:routing:create', {
    name: 'مسار الهيكل', code: 'RT-FRAME',
    operations: [
      { name: 'القص', sequence: 10, work_center_id: workCenter.id, setup_minutes: 20, run_minutes_per_unit: 4 },
      { name: 'اللحام', sequence: 20, work_center_id: workCenter.id, run_minutes_per_unit: 8 },
    ],
  }, 'seed-routing');
  execute('manufacturing:routing:approve', { routing_id: routing.id }, 'seed-routing-approve');

  const bom = execute('manufacturing:bom:create', {
    product_id: finishedId, quantity: 1, code: 'BOM-FRAME', routing_id: routing.id,
    lines: [{ product_id: componentId, quantity: 4 }],
  }, 'seed-bom');
  execute('manufacturing:bom:approve', { bom_id: bom.id }, 'seed-bom-approve');

  const order = execute('manufacturing:order:create', {
    product_id: finishedId, planned_quantity: 20, warehouse_id: warehouse.id,
  }, 'seed-mo');
  execute('manufacturing:order:approve', { order_id: order.id }, 'seed-mo-approve');
  const released = execute('manufacturing:order:release', { order_id: order.id }, 'seed-mo-release');
  execute('manufacturing:material:issue', {
    order_id: order.id, product_id: componentId, quantity: 80,
  }, 'seed-mo-issue');
  execute('manufacturing:work_order:start', {
    work_order_id: released.work_orders[0].id,
  }, 'seed-wo-start');
  execute('manufacturing:work_order:time_entry', {
    work_order_id: released.work_orders[0].id, entry_type: 'labor', duration_minutes: 180,
  }, 'seed-wo-time');
  execute('manufacturing:order:complete', { order_id: order.id, quantity: 8 }, 'seed-mo-complete');

  // Quality
  const qualityPlan = execute('quality:plan:create', {
    name: 'فحص الأبعاد النهائي', code: 'QP-DIM', trigger_event: 'production_completion',
    points: [{ characteristic: 'الطول (مم)', measurement_type: 'numeric', min_value: 99.5, max_value: 100.5, is_critical: 1 }],
  }, 'seed-qp');
  const inspection = execute('quality:inspection:create', {
    plan_id: qualityPlan.id, subject_type: 'production_order', subject_id: order.id,
  }, 'seed-qi');
  execute('quality:inspection:record', {
    inspection_id: inspection.id,
    measurements: [{ plan_point_id: qualityPlan.points[0].id, numeric_value: 100.1 }],
  }, 'seed-qi-record');
  execute('quality:inspection:decide', { inspection_id: inspection.id, decision: 'pass' }, 'seed-qi-decide');

  // Projects
  const customer = execute('party:create', { name: 'شركة البصرة للحديد', party_type: 'customer' }, 'seed-customer');
  const project = execute('project:create', {
    name: 'خط إنتاج البصرة', code: 'PRJ-BASRA', customer_party_id: customer.id,
    contract_value: 250_000, billing_method: 'milestone',
  }, 'seed-project');
  execute('project:approve', { project_id: project.id }, 'seed-project-approve');
  execute('project:activate', { project_id: project.id }, 'seed-project-activate');
  const budget = execute('project:budget:create', {
    project_id: project.id,
    lines: [
      { cost_type: 'material', amount: 120_000, description: 'مواد' },
      { cost_type: 'labor', amount: 60_000, description: 'عمالة' },
    ],
  }, 'seed-project-budget');
  executor.execute('project:budget:approve', {
    budget_id: budget.id, idempotency_key: 'seed-project-budget-approve',
  }, { ...CTX, userId: 'phase05-verify-approver' });
  execute('project:work_item:create', {
    project_id: project.id, title: 'مسح الموقع', estimated_hours: 16, priority: 'high',
  }, 'seed-project-wi');
  execute('project:material:issue', {
    project_id: project.id, product_id: componentId, quantity: 25, warehouse_id: warehouse.id,
  }, 'seed-project-material');
  execute('project:billing_rule:set', {
    project_id: project.id, billing_method: 'milestone',
    revenue_account_id: accounts.revenue, receivable_account_id: accounts.receivable,
  }, 'seed-project-rule');
  execute('project:update', { project_id: project.id, percent_complete: 35 }, 'seed-project-progress');

  // A deliberately under-supplied order, so the shortage and planning views have
  // real content. It is released LAST, because releasing it reserves every free
  // unit of the component and would starve the seeding steps above.
  const shortOrder = execute('manufacturing:order:create', {
    product_id: finishedId, planned_quantity: 200, warehouse_id: warehouse.id,
  }, 'seed-mo-short');
  execute('manufacturing:order:approve', { order_id: shortOrder.id }, 'seed-mo-short-approve');
  execute('manufacturing:order:release', { order_id: shortOrder.id }, 'seed-mo-short-release');
  execute('manufacturing:planning:run', {}, 'seed-planning');

  // Assets, maintenance and fleet
  const financeCategory = createAssetCategory(db, CTX, {
    code: 'MACH', name: 'آلات',
    asset_account_id: accounts.assetGross,
    depreciation_expense_account_id: accounts.depreciation,
    accumulated_depreciation_account_id: accounts.accumulated,
    disposal_gain_account_id: accounts.gain,
    disposal_loss_account_id: accounts.loss,
  });
  const assetCategory = execute('asset:category:create', {
    code: 'MACH', name: 'آلات', finance_category_id: financeCategory.id,
    default_useful_life_months: 60,
  }, 'seed-asset-cat');
  const asset = execute('asset:create', {
    name: 'مخرطة CNC', category_id: assetCategory.id, acquisition_value: 180_000,
    serial_number: 'CNC-2201',
  }, 'seed-asset');
  execute('asset:capitalize', {
    asset_id: asset.id, source_account_id: accounts.clearing,
  }, 'seed-asset-cap');
  execute('asset:schedule:generate', { asset_id: asset.id, start_date: '2026-01-31' }, 'seed-asset-sched');
  execute('asset:depreciation:post', { asset_id: asset.id, up_to_date: '2026-06-30' }, 'seed-asset-post');

  const maintenancePlan = execute('maintenance:plan:create', {
    name: 'صيانة ربع سنوية', code: 'PM-Q', asset_id: asset.id,
    trigger_type: 'calendar', interval_days: 90, next_due_date: '2026-01-01', estimated_hours: 4,
  }, 'seed-pm-plan');
  execute('maintenance:plan:generate', { plan_id: maintenancePlan.id, as_of: '2026-02-01' }, 'seed-pm-gen');

  const vehicleAsset = execute('asset:create', {
    name: 'شاحنة النقل 1', category_id: assetCategory.id, acquisition_value: 95_000,
  }, 'seed-veh-asset');
  execute('asset:capitalize', {
    asset_id: vehicleAsset.id, source_account_id: accounts.clearing,
  }, 'seed-veh-cap');
  const vehicle = execute('fleet:vehicle:create', {
    name: 'شاحنة النقل 1', plate_number: 'BAS-4410', asset_id: vehicleAsset.id,
    expected_consumption_per_100: 28, tank_capacity: 300, odometer: 42_000,
  }, 'seed-vehicle');
  const driver = execute('fleet:driver:register', {
    driver_ref: 'drv-1', name: 'علي حسن', licence_number: 'L-2211', licence_expiry: '2026-11-30',
  }, 'seed-driver');
  execute('fleet:assignment:create', { vehicle_id: vehicle.id, driver_id: driver.id }, 'seed-assign');
  execute('fleet:document:register', {
    vehicle_id: vehicle.id, document_type: 'insurance', expires_on: '2026-09-15', cost: 1_200,
  }, 'seed-veh-doc');
  const trip = execute('fleet:trip:start', {
    vehicle_id: vehicle.id, driver_id: driver.id, origin: 'البصرة', destination: 'الناصرية',
  }, 'seed-trip');
  execute('fleet:trip:complete', { trip_id: trip.id, end_odometer: 42_400 }, 'seed-trip-end');
  execute('fleet:fuel:record', {
    vehicle_id: vehicle.id, quantity: 110, unit_price: 1, odometer: 42_400, external_reference: 'FUEL-1',
  }, 'seed-fuel-1');
  execute('fleet:fuel:record', {
    vehicle_id: vehicle.id, quantity: 190, unit_price: 1, odometer: 42_800, external_reference: 'FUEL-2',
  }, 'seed-fuel-2');

  return { warehouse, order, project, asset, vehicle };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  await freshInstall({
    dbPath: DB_PATH,
    backupDir: path.join(path.dirname(DB_PATH), 'backups'),
    actor: 'phase05-verify',
  });
  const db = openMigrationDatabase(DB_PATH);
  const authority = createPlatformAuthority(db);
  seed(db, authority.actionExecutor);

  const apiHandler = createApiHandler({
    dialect: db,
    prefix: '/api/v1',
    actionExecutor: authority.actionExecutor,
    // A verification server: the context is fixed, and it is the ONLY reason
    // this file is not the production server.
    resolveContext: (req, requestUrl) => ({
      ...CTX,
      correlationId: String(req.headers['x-correlation-id'] || `verify_${Math.random().toString(36).slice(2)}`),
      idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
    }),
    authorize: () => ({ allowed: true }),
  });

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (apiHandler(req, res, requestUrl)) return;

    // Minimal static serving of the real shell.
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const resolved = path.resolve(root, `.${pathname}`);
    if (!resolved.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(resolved).pipe(res);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Phase 05 verification server on http://127.0.0.1:${PORT}`);
    console.log(`Disposable database: ${DB_PATH}`);
    console.log('The operational database.db is NOT opened by this process.');
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
