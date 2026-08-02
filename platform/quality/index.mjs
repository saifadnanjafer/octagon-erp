// platform/quality/index.mjs — Quality Management Action Registration and Query Handler.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as inspection from './inspection.mjs';
import * as ncrCapa from './ncr-capa.mjs';
import * as operations from './operations.mjs';

export { inspection, ncrCapa, operations };
export { QualityError } from './inspection.mjs';

export function registerQualityActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  registerDomainHandler(actionExecutor, 'quality:plan:create', inspection.createQualityPlan);
  registerDomainHandler(actionExecutor, 'quality:inspection:create', inspection.createQualityInspection);
  registerDomainHandler(actionExecutor, 'quality:inspection:record_results', inspection.recordInspectionResults);
  registerDomainHandler(actionExecutor, 'quality:inspection:pass', inspection.passInspection);
  registerDomainHandler(actionExecutor, 'quality:inspection:fail', inspection.failInspection);
  registerDomainHandler(actionExecutor, 'quality:inspection:release', inspection.releaseInspection);
  registerDomainHandler(actionExecutor, 'quality:ncr:create', ncrCapa.createNCR);
  registerDomainHandler(actionExecutor, 'quality:capa:create', ncrCapa.createCAPA);
  registerDomainHandler(actionExecutor, 'quality:capa:close', ncrCapa.closeCAPA);

  registerDomainHandler(actionExecutor, 'quality:checkpoint_open', operations.openOperationalCheckpoint);
  registerDomainHandler(actionExecutor, 'quality:checkpoint_sync', operations.syncOperationalCheckpoint);
  registerDomainHandler(actionExecutor, 'quality:checkpoint_conditional_accept', operations.conditionallyAcceptCheckpoint);
  registerDomainHandler(actionExecutor, 'quality:disposition_request', operations.requestDisposition);
  registerDomainHandler(actionExecutor, 'quality:disposition_approve', operations.approveDisposition);
  registerDomainHandler(actionExecutor, 'quality:scrap_request_canonical', operations.requestCanonicalScrap);
  registerDomainHandler(actionExecutor, 'quality:scrap_acknowledge', operations.acknowledgeCanonicalScrap);
  registerDomainHandler(actionExecutor, 'quality:rework_start', operations.startRework);
  registerDomainHandler(actionExecutor, 'quality:rework_complete', operations.completeRework);
  registerDomainHandler(actionExecutor, 'quality:disposition_close', operations.closeDisposition);
  return actionExecutor;
}

export function handleQualityQuery({ dialect, ctx, resource, recordId, query }) {
  if (resource === 'plans' || resource === 'quality_plans') {
    const rows = dialect.prepare('SELECT * FROM quality_plans ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'inspections' || resource === 'quality_inspections') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'quality inspection not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM quality_inspections ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'ncrs' || resource === 'quality_ncrs') {
    const rows = dialect.prepare('SELECT * FROM quality_ncrs ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'capas' || resource === 'quality_capas') {
    const rows = dialect.prepare('SELECT * FROM quality_capas ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown quality resource ${resource}`, status: 404 };
}
