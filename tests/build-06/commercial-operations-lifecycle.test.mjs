import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-b06-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-06 Commercial Operations Full Lifecycle (RMA, Credit & Collections, Commissions, Document Templates)', async () => {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);

  const ctx = {
    userId: 'build-06-test',
    actorId: 'build-06-test',
    companyId: 'default',
    branchId: 'default',
    now: new Date().toISOString(),
  };

  // Seed prerequisite partner, sale order & rma case for foreign key constraints
  dialect.prepare(`
    INSERT INTO parties (id, company_id, name, created_at, updated_at)
    VALUES ('prt_cust_rma', 'default', 'عميل RMA', datetime('now'), datetime('now'))
  `).run();

  dialect.prepare(`
    INSERT INTO sale_orders (id, company_id, name, partner_id, order_date, amount_total, currency_id, state, created_at)
    VALUES ('so_9901', 'default', 'SO-9901', 'prt_cust_rma', '2026-08-01', 1000.0, 'IQD', 'sale', datetime('now'))
  `).run();

  dialect.prepare(`
    INSERT INTO commercial_rma_cases (id, company_id, sale_order_id, state, reason, actor, idempotency_key, created_at, updated_at)
    VALUES ('rma_case_1001', 'default', 'so_9901', 'submitted', 'Defective unit', 'build-06-test', 'idem_rma_1001', datetime('now'), datetime('now'))
  `).run();

  // 1. Returns / RMA / Warranty Inspection Lifecycle
  const rmaInspection = authority.rmaService.createInspection({
    rmaId: 'rma_case_1001',
    inspectorId: ctx.userId,
    result: 'pass',
    disposition: 'pending',
    notes: 'Initial intake inspection for warranty claim',
  }, ctx);
  assert.ok(rmaInspection.id);
  assert.equal(rmaInspection.disposition, 'pending');

  const updatedRma = authority.rmaService.updateInspectionStatus(rmaInspection.id, {
    result: 'pass',
    disposition: 'replacement',
    notes: 'Defect confirmed. Unit queued for direct replacement.',
  }, ctx);
  assert.equal(updatedRma.result, 'pass');
  assert.equal(updatedRma.disposition, 'replacement');

  const rmaList = authority.rmaService.listInspections({ rmaId: 'rma_case_1001' });
  assert.ok(rmaList.length >= 1);

  // 2. Credit & Collections Lifecycle
  const creditProfile = authority.creditCollectionsService.createOrUpdateCreditProfile({
    customerId: 'prt_cust_rma',
    companyId: ctx.companyId,
    creditLimit: 100000.0,
  }, ctx);
  assert.ok(creditProfile.id);
  assert.equal(creditProfile.creditLimit, 100000.0);

  const profileOnHold = authority.creditCollectionsService.setCreditHold('prt_cust_rma', ctx.companyId, true, 'Overdue invoices', ctx);
  assert.equal(profileOnHold.creditHold, true);

  const profileOffHold = authority.creditCollectionsService.setCreditHold('prt_cust_rma', ctx.companyId, false, 'Payment received', ctx);
  assert.equal(profileOffHold.creditHold, false);

  const promise = authority.creditCollectionsService.createCollectionPromise({
    customerId: 'prt_cust_rma',
    companyId: ctx.companyId,
    collectorId: ctx.userId,
    amount: 25000.0,
    promiseDate: '2026-08-15',
    notes: 'Customer agreed to wire payment by mid-month',
  }, ctx);
  assert.ok(promise.id);
  assert.equal(promise.status, 'pending');

  const fulfilledPromise = authority.creditCollectionsService.fulfillCollectionPromise(promise.id, ctx);
  assert.equal(fulfilledPromise.status, 'fulfilled');

  // 3. Sales Commissions Lifecycle
  const plan = authority.commissionService.createPlan({
    name: 'خطة عمولات المبيعات الإقليمية',
    companyId: ctx.companyId,
    defaultRatePct: 7.5,
    basis: 'invoice',
  }, ctx);
  assert.ok(plan.id);
  assert.equal(plan.defaultRatePct, 7.5);

  const accrual = authority.commissionService.accrueCommission({
    planId: plan.id,
    salespersonId: 'usr_sales_rep_01',
    saleOrderId: 'so_9901',
    companyId: ctx.companyId,
    basisAmount: 40000.0,
  }, ctx);
  assert.ok(accrual.id);
  assert.equal(accrual.commissionAmount, 3000.0); // 40000 * 7.5% = 3000
  assert.equal(accrual.status, 'accrued');

  const settled = authority.commissionService.settleAccrual(accrual.id, ctx);
  assert.equal(settled.status, 'settled');

  // 4. Governed Document Templates & Printing Lifecycle
  const docTemplate = authority.documentTemplateService.createTemplate({
    name: 'قالب إيصال استلام المرتجعات',
    companyId: ctx.companyId,
    docType: 'pdf',
    bodyHtml: 'إيصال استلام رائع لطلب RMA رقم {{rmaNumber}} للعميل {{customerName}} بمعدات: {{items}}',
  }, ctx);
  assert.ok(docTemplate.id);

  const renderedDoc = authority.documentTemplateService.renderDocument(docTemplate.id, {
    rmaNumber: 'RMA-2026-001',
    customerName: 'شركة النور التجارية',
    items: 'ماسح ضوئي عالي الدقة',
  });
  assert.ok(renderedDoc.content.includes('RMA-2026-001'));
  assert.ok(renderedDoc.content.includes('شركة النور التجارية'));

  dialect.close();
  fs.unlinkSync(dbPath);
});
