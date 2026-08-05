import assert from 'node:assert/strict';
import test from 'node:test';
import { openPilot, seedPilotWorkshop } from './pilot-fixture.mjs';
import { PILOT_ACTORS, PILOT_ROLE_SEQUENCE } from './pilot-actors.mjs';
import * as material from '../../platform/manufacturing/material-flow.mjs';
import * as shopfloor from '../../platform/manufacturing/shopfloor.mjs';
import * as workOrders from '../../platform/manufacturing/work-orders.mjs';
import * as inspection from '../../platform/quality/inspection.mjs';
import * as quality from '../../platform/quality/operations.mjs';
import { postStockMove, getQuantBalance } from '../../platform/inventory/ledger.mjs';
import { createPayment, postPayment, allocatePayment, setApprovalAuthorityLimit } from '../../platform/finance/engine.mjs';
import { buildWorkshopCommandCenter } from '../../platform/workshop/command-center.mjs';
import { buildMyWork } from '../../platform/workshop/my-work.mjs';
import { buildWorkshopReadiness } from '../../platform/workshop/readiness.mjs';

function insertActorWork(db, actor, title, sourceType, status = 'todo', dueDate = '2026-08-05T12:00:00.000Z') {
  const id = `pilot-work-${actor.id}-${sourceType}`;
  const stamp = '2026-08-05T06:00:00.000Z';
  db.prepare(`INSERT INTO work_items(id,company_id,branch_id,title,source_type,status,stage,priority,assigned_user_id,due_date,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'default', 'branch-pilot', title, sourceType, status, 'operations', 'high', actor.id, dueDate, stamp, stamp);
  return id;
}

async function executeMaterial(pilot, seed, requestType, quantity, sourceLocationId, destinationLocationId, key) {
  const request = material.createMaterialFlowRequest(pilot.db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, branch_id: 'branch-pilot',
    actor: PILOT_ACTORS.productionOperator.id, production_order_id: seed.productionOrderId,
    work_order_id: seed.workOrderId, requirement_id: requestType === 'issue' ? seed.requirementId : null,
    request_type: requestType, product_id: seed.productId, requested_quantity: quantity,
    source_location_id: sourceLocationId, destination_location_id: destinationLocationId,
    idempotency_key: `pilot-material-${key}`,
  });
  const checked = material.checkMaterialAvailability(pilot.db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id, request_id: request.id,
  });
  assert.notEqual(checked.status, 'shortage', `${requestType} should have stock in the happy path`);
  const approved = material.approveMaterialFlow(pilot.db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.supervisor.id,
    request_id: request.id, assigned_to: PILOT_ACTORS.warehouseOperator.id,
  });
  assert.ok(['approved','task_created'].includes(approved.status));
  const pending = material.requestCanonicalMaterialEffect(pilot.db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id, request_id: request.id,
  });
  assert.equal(pending.executionBoundary, 'REQUEST_ONLY');
  assert.equal(pending.inventoryWritten, false);
  const move = postStockMove(pilot.db, { ...pending.canonicalRequest, actor: PILOT_ACTORS.warehouseOperator.id });
  const completed = material.acknowledgeCanonicalMaterialEffect(pilot.db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.warehouseOperator.id,
    request_id: request.id, canonical_result_id: move.id,
  });
  assert.equal(completed.status, 'completed');
  return { request, checked, approved, pending, move, completed };
}

test('disposable seven-role pilot completes customer order through payment and closure', async (t) => {
  const pilot = await openPilot(t, 'full-lifecycle');
  const seed = seedPilotWorkshop(pilot);
  const { db, executeAs } = pilot;
  setApprovalAuthorityLimit(db, pilot.contexts.supervisor, { role_or_user: PILOT_ACTORS.supervisor.id, limit_type: 'post', max_amount: 1000000 });
  setApprovalAuthorityLimit(db, pilot.contexts.financeUser, { role_or_user: PILOT_ACTORS.financeUser.id, limit_type: 'post', max_amount: 1000000 });
  setApprovalAuthorityLimit(db, pilot.contexts.deliveryClerk, { role_or_user: PILOT_ACTORS.deliveryClerk.id, limit_type: 'post', max_amount: 1000000 });

  // Every named role receives one explicit work assignment; My Work must never infer it.
  for (const roleKey of PILOT_ROLE_SEQUENCE) {
    const actor = PILOT_ACTORS[roleKey];
    insertActorWork(db, actor, `${actor.label} pilot responsibility`, `pilot_${roleKey}`);
  }

  // Supervisor creates the customer demand; planner progresses it to an accepted order.
  const quotation = executeAs('supervisor', 'sales:quotation:create', {
    partner_id: seed.customer.id,
    lines: [{ product_id: seed.productId, product_uom_qty: 5, price_unit: 250 }],
    notes: 'Internal workshop completion pilot',
  });
  assert.equal(quotation.state, 'draft');
  assert.equal(quotation.amount_total, 1250);
  const submitted = executeAs('planner', 'sales:quotation:submit', { order_id: quotation.id });
  assert.equal(submitted.quotation_state, 'sent');
  const approved = executeAs('supervisor', 'sales:quotation:approve', { order_id: quotation.id });
  assert.equal(approved.quotation_state, 'approved');
  const accepted = executeAs('supervisor', 'sales:quotation:accept', { order_id: quotation.id });
  assert.equal(accepted.quotation_state, 'accepted');
  const confirmation = executeAs('planner', 'sales:order:confirm', { order_id: quotation.id, warehouse_id: seed.warehouse.id });
  assert.equal(confirmation.order.state, 'sale');
  assert.ok(confirmation.delivery_picking_id);

  // Production operator starts the governed shop-floor session.
  const session = shopfloor.openShopfloorSession(db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, branch_id: 'branch-pilot',
    actor: PILOT_ACTORS.planner.id, work_order_id: seed.workOrderId,
    operator_id: PILOT_ACTORS.productionOperator.id, idempotency_key: 'pilot-shopfloor-session',
  });
  assert.equal(session.status, 'assigned');
  const startProposal = shopfloor.requestOperationStart(db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.productionOperator.id,
    session_id: session.id, operator_id: PILOT_ACTORS.productionOperator.id,
  });
  assert.equal(startProposal.executionBoundary, 'REQUEST_ONLY');
  workOrders.startWorkOrder(db, { work_order_id: seed.workOrderId, actor: PILOT_ACTORS.productionOperator.id });
  const running = shopfloor.acknowledgeOperationTransition(db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.productionOperator.id, session_id: session.id,
  });
  assert.equal(running.status, 'running');

  // Warehouse issues components only after the supervisor approves the request.
  const issued = await executeMaterial(pilot, seed, 'issue', 5, seed.component.locationId, seed.wip.locationId, 'issue');
  assert.equal(issued.pending.canonicalRequest.source_document_type, 'mfg_issue');
  const componentAfterIssue = getQuantBalance(db, { company_id: seed.companyId, product_id: seed.productId, location_id: seed.component.locationId });
  assert.equal(componentAfterIssue.quantity, 15);

  // Quality inspector opens and passes the required in-process checkpoint.
  const plan = inspection.createQualityPlan(db, {
    company_id: seed.companyId, name: 'Pilot in-process quality plan', code: 'PILOT-QP',
    product_id: seed.productId, points: [{ title: 'Visual and torque', test_type: 'pass_fail' }],
  });
  const canonicalInspection = inspection.createQualityInspection(db, {
    company_id: seed.companyId, plan_id: plan.id, inspection_type: 'in_process', source_type: 'work_order',
    source_id: seed.workOrderId, product_id: seed.productId, sample_size: 5, actor: PILOT_ACTORS.qualityInspector.id,
  });
  const checkpoint = quality.openOperationalCheckpoint(db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.qualityInspector.id,
    checkpoint_type: 'in_process', source_type: 'shopfloor_session', source_id: session.id,
    inspection_id: canonicalInspection.id, sampling_plan_reference: 'PILOT-QP',
    evidence: [{ fileId: 'pilot-quality-photo' }], idempotency_key: 'pilot-quality-pass',
  });
  inspection.passInspection(db, { inspection_id: canonicalInspection.id, inspected_quantity: 5, actor: PILOT_ACTORS.qualityInspector.id });
  const qualityPassed = quality.syncOperationalCheckpoint(db, {
    company_id: seed.companyId, warehouse_id: seed.warehouse.id, actor: PILOT_ACTORS.qualityInspector.id, checkpoint_id: checkpoint.id,
  });
  assert.equal(qualityPassed.status, 'pass');

  // Finished receipt remains request-only until canonical Inventory posts it.
  const receipt = await executeMaterial(pilot, seed, 'production_receipt', 5, seed.wip.locationId, seed.finished.locationId, 'receipt');
  assert.match(receipt.pending.canonicalRequest.source_document_type, /receipt/);
  assert.equal(getQuantBalance(db, { company_id: seed.companyId, product_id: seed.productId, location_id: seed.finished.locationId }).quantity, 5);
  workOrders.completeWorkOrder(db, { work_order_id: seed.workOrderId, completed_quantity: 5, rejected_quantity: 0, actor: PILOT_ACTORS.productionOperator.id });
  db.prepare("UPDATE mfg_shopfloor_sessions SET status='completed',produced_quantity=5,updated_at=? WHERE id=?").run(new Date().toISOString(), session.id);
  db.prepare("UPDATE mfg_production_orders SET state='completed',completed_quantity=5,actual_end_date=?,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), seed.productionOrderId);

  // Move released finished goods into the canonical warehouse stock used by Sales fulfilment.
  postStockMove(db, {
    company_id: seed.companyId, reference: 'PILOT-FINISHED-PUTAWAY', product_id: seed.productId, uom_id: seed.unit.id,
    product_qty: 5, location_id: seed.finished.locationId, location_dest_id: seed.warehouse.lot_stock_id, unit_cost: 80,
    source_document_type: 'production_putaway', source_document_id: seed.productionOrderId,
    idempotency_key: 'pilot-finished-putaway', actor: PILOT_ACTORS.warehouseOperator.id,
  });

  // Delivery clerk completes the outbound delivery against the confirmed order.
  const delivery = executeAs('deliveryClerk', 'sales:delivery:post', {
    order_id: quotation.id, picking_id: confirmation.delivery_picking_id,
    lines: [{ sale_order_line_id: quotation.lines[0].id, quantity: 5 }],
  });
  assert.equal(delivery.delivery_event.state, 'done');
  assert.equal(delivery.remaining_lines.length, 0);
  assert.equal(delivery.backorder, null);

  // Finance user posts the invoice, receives payment, allocates it, and clears the open amount.
  const invoice = executeAs('financeUser', 'sales:invoice_request:create', { order_id: quotation.id });
  assert.equal(invoice.status, 'posted');
  assert.equal(invoice.amount_total, 1250);
  const financeCtx = pilot.contexts.financeUser;
  setApprovalAuthorityLimit(db, financeCtx, { role_or_user: PILOT_ACTORS.financeUser.id, limit_type: 'payment', max_amount: 1000000 });
  const cash = db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='101000'").get().id;
  const receivable = db.prepare("SELECT id FROM finance_accounts WHERE company_id='default' AND code='103000'").get().id;
  const payment = createPayment(db, financeCtx, {
    payment_type: 'receive', method: 'cash', amount: 1250, cash_or_bank_account_id: cash,
    counter_account_id: receivable, partner_id: seed.customer.id, reference: 'PILOT-PAID', idempotency_key: 'pilot-payment',
  });
  assert.equal(payment.status, 'draft');
  assert.equal(postPayment(db, financeCtx, { payment_id: payment.id }).status, 'posted');
  const allocation = allocatePayment(db, financeCtx, { payment_id: payment.id, document_id: invoice.finance_document_id, amount: 1250 });
  assert.equal(allocation.amount, 1250);
  assert.equal(db.prepare('SELECT unallocated_amount FROM finance_payments WHERE id=?').get(payment.id).unallocated_amount, 0);

  // Closing assertions across all canonical authorities.
  assert.equal(db.prepare('SELECT state FROM sale_orders WHERE id=?').get(quotation.id).state, 'sale');
  assert.equal(db.prepare('SELECT state FROM mfg_production_orders WHERE id=?').get(seed.productionOrderId).state, 'completed');
  assert.equal(db.prepare('SELECT state FROM mfg_work_orders WHERE id=?').get(seed.workOrderId).state, 'completed');
  assert.equal(db.prepare('SELECT status FROM mfg_shopfloor_sessions WHERE id=?').get(session.id).status, 'completed');
  assert.equal(db.prepare('SELECT COUNT(*) value FROM finance_payment_allocations WHERE payment_id=?').get(payment.id).value, 1);

  // New operating surfaces consume the pilot facts with scope and actor isolation.
  const command = buildWorkshopCommandCenter({ db, dialect: db, ctx: pilot.contexts.supervisor, can: () => true });
  assert.equal(command.data.sections.length, 5);
  const plannerWork = buildMyWork({ dialect: db, ctx: pilot.contexts.planner, can: () => true });
  assert.ok(plannerWork.data.items.some((item) => item.assigneeId === PILOT_ACTORS.planner.id));
  assert.ok(plannerWork.data.items.every((item) => item.assigneeId === PILOT_ACTORS.planner.id));
  const readiness = buildWorkshopReadiness({ dialect: db, ctx: pilot.contexts.supervisor, can: () => true });
  assert.equal(readiness.data.categories.length, 10);
  assert.equal(readiness.data.mutationPolicy, 'READ_ONLY_ZERO_MUTATION');
});
