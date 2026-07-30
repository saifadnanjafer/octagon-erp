// Platform cutover domain index — Checkpoint I5A - I6.
//
// Exports the governed cutover engine API and registers cutover:* domain actions.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';
import { createCanonicalCutoverController } from './canonical-cutover-controller.mjs';
import { createCutoverBatch, getCutoverBatch, updateBatchState } from './batch-engine.mjs';
import { runSourceInventory, getSourceInventorySummary } from './source-inventory.mjs';
import { seedDefaultMappings, setMappingRule, getMappingRule, listMappingRules } from './mapping-registry.mjs';
import { recordLineage, getLineageBySource, getLineageByDestination, listBatchLineage } from './lineage.mjs';
import { quarantineRecord, getQuarantineRegister } from './quarantine.mjs';
import { migrateMasterData } from './master-data-migrator.mjs';
import { migrateOpeningInventory } from './opening-inventory-migrator.mjs';
import { validateFinanceEquivalence } from './finance-equivalence.mjs';
import { migrateFinance } from './finance-migrator.mjs';
import { migrateOperations } from './operations-migrator.mjs';
import { reconcileDomain, reconcileAll, getDomainReconciliationReport } from './reconciliation.mjs';
import { assessStagedActivationReadiness, activateStagedCutover } from './staged-activation.mjs';
import { generateCutoverSummaryReport } from './reports.mjs';

export * from './canonical-cutover-controller.mjs';
export * from './batch-engine.mjs';
export * from './source-inventory.mjs';
export * from './mapping-registry.mjs';
export * from './lineage.mjs';
export * from './quarantine.mjs';
export * from './master-data-migrator.mjs';
export * from './opening-inventory-migrator.mjs';
export * from './finance-equivalence.mjs';
export * from './finance-migrator.mjs';
export * from './operations-migrator.mjs';
export * from './reconciliation.mjs';
export * from './staged-activation.mjs';
export * from './reports.mjs';

export function registerCutoverActions(actionExecutor) {
  if (!actionExecutor) return;

  registerDomainHandler(actionExecutor, 'cutover:create_batch', (dialect, input) => {
    return createCutoverBatch(dialect, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:source_inventory', (dialect, input) => {
    return runSourceInventory(dialect, input.batchId || input.batch_id);
  });

  registerDomainHandler(actionExecutor, 'cutover:migrate_master_data', (dialect, input) => {
    return migrateMasterData(dialect, input.batchId || input.batch_id, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:migrate_opening_inventory', (dialect, input) => {
    return migrateOpeningInventory(dialect, input.batchId || input.batch_id, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:validate_finance_equivalence', (dialect, input) => {
    return validateFinanceEquivalence(dialect, input.batchId || input.batch_id);
  });

  registerDomainHandler(actionExecutor, 'cutover:migrate_finance', (dialect, input) => {
    return migrateFinance(dialect, input.batchId || input.batch_id, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:migrate_operations', (dialect, input) => {
    return migrateOperations(dialect, input.batchId || input.batch_id, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:reconcile_domain', (dialect, input) => {
    return reconcileDomain(dialect, input.batchId || input.batch_id, input.domain);
  });

  registerDomainHandler(actionExecutor, 'cutover:reconcile_all', (dialect, input) => {
    return reconcileAll(dialect, input.batchId || input.batch_id);
  });

  registerDomainHandler(actionExecutor, 'cutover:quarantine_record', (dialect, input) => {
    return quarantineRecord(dialect, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:quarantine_report', (dialect, input) => {
    return getQuarantineRegister(dialect, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:status', (dialect, input) => {
    const controller = createCanonicalCutoverController({ dialect });
    return controller.status();
  });

  registerDomainHandler(actionExecutor, 'cutover:dry_run', (dialect, input) => {
    const controller = createCanonicalCutoverController({ dialect });
    return controller.dryRun();
  });

  registerDomainHandler(actionExecutor, 'cutover:activate_disposable', (dialect, input) => {
    return activateStagedCutover(dialect, input.batchId || input.batch_id, input);
  });

  registerDomainHandler(actionExecutor, 'cutover:rollback_attempt', (dialect, input) => {
    const controller = createCanonicalCutoverController({ dialect });
    return controller.rollbackAttempt(input.domain, input);
  });
}
