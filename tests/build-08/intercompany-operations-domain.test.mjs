import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

test('Company A reciprocal Company B operation detects mismatch, reconciles and proposes settlement', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'octagon-b08-intercompany-'));
  const file = path.join(dir, 'intercompany.db');
  await freshInstall({ dbPath: file, backupDir: path.join(dir, 'backups'), actor: 'build-08-intercompany' });
  const db = openMigrationDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const authority = createPlatformAuthority(db);
  const companyA = { userId: 'controller-a', actorId: 'controller-a', companyId: 'company-a' };
  const companyB = { userId: 'controller-b', actorId: 'controller-b', companyId: 'company-b' };

  const relationship = authority.intercompanyOperationsService.createRelationship({
    companyBId: 'company-b', relationshipType: 'subsidiary',
    allowedTypes: ['sale_purchase', 'service_charge', 'allocation'],
    dueToAccountA: 'A-DUE-TO', dueFromAccountA: 'A-DUE-FROM',
    dueToAccountB: 'B-DUE-TO', dueFromAccountB: 'B-DUE-FROM',
  }, companyA);
  assert.deepEqual(relationship.allowedTypes, ['sale_purchase', 'service_charge', 'allocation']);

  const operation = authority.intercompanyOperationsService.createOperation({
    relationshipId: relationship.id, sourceCompanyId: 'company-a', targetCompanyId: 'company-b',
    transactionType: 'sale_purchase', sourceDocumentType: 'sales_order', sourceDocumentId: 'SO-A-100',
    reciprocalDocumentType: 'purchase_order', reciprocalDocumentId: 'PO-B-100', reference: 'IC-2027-100',
    amount: 1000, reciprocalAmount: 970, currency: 'IQD',
    serviceAllocation: { basis: 'headcount', costCenter: 'shared-services' }, idempotencyKey: 'ic-a-b-100',
  }, companyA);
  assert.equal(operation.dueFromAmount, 1000);
  assert.equal(operation.dueToAmount, 970);
  assert.equal(operation.mismatches[0].mismatchType, 'amount');
  assert.equal(operation.mismatches[0].differenceAmount, 30);
  assert.equal(authority.intercompanyOperationsService.listOperations({}, companyB).length, 1, 'target company sees reciprocal record');

  const sourceApproved = authority.intercompanyOperationsService.approveOperation(operation.id, companyA);
  assert.equal(sourceApproved.sourceStatus, 'approved');
  const reciprocalApproved = authority.intercompanyOperationsService.approveOperation(operation.id, companyB);
  assert.equal(reciprocalApproved.reciprocalStatus, 'approved');
  assert.equal(reciprocalApproved.status, 'mismatched');

  const reconciliation = authority.intercompanyOperationsService.reconcile({
    operationId: operation.id, mismatchId: reciprocalApproved.mismatches[0].id,
    resolutionType: 'reciprocal_correction', correctedReciprocalAmount: 1000,
    notes: 'Company B corrected the reciprocal purchase document to the approved source value',
  }, companyB);
  assert.equal(reconciliation.status, 'approved');
  assert.equal(reconciliation.operationalLedgerWritten, false);
  assert.equal(authority.intercompanyOperationsService.getOperation(operation.id, companyA).status, 'reconciled');

  const settlement = authority.intercompanyOperationsService.proposeSettlement(operation.id, { requestedDate: '2027-02-01' }, companyA);
  assert.equal(settlement.payerCompanyId, 'company-b');
  assert.equal(settlement.payeeCompanyId, 'company-a');
  assert.equal(settlement.amount, 1000);
  assert.equal(settlement.paymentExecuted, false);
  assert.throws(() => authority.intercompanyOperationsService.getOperation(operation.id, { ...companyA, companyId: 'company-c' }), { code: 'COMPANY_SCOPE_DENIED' });
});
