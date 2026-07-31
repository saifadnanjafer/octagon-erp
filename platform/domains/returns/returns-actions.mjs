// platform/domains/returns/returns-actions.mjs — Returns / RMA action wiring.
//
// Permission tokens and platform_actions rows are registered by
// database/migrations/084_returns_rma_consolidation.mjs (the same pattern
// used by every other domain in this codebase, e.g. 057_assets_and_depreciation_schedules.mjs).
// This file only binds the domain functions to the ActionExecutor through the
// canonical server-derived-scope wrapper (registerDomainHandler), the same
// wrapper every other action file in this codebase uses. The previous draft
// called a nonexistent `executor.registerDomainHandler` method directly,
// which meant no action was ever actually registered.

'use strict';

import { registerDomainHandler } from '../../kernel/actions/domain-handler.mjs';
import {
  createRMA,
  submitRMA,
  approveRMA,
  rejectRMA,
  recordReceipt,
  recordInspection,
  recordDisposition,
  closeRMA,
} from './rma.mjs';

export function registerReturnsActions(executor) {
  if (!executor || typeof executor.registerHandler !== 'function') return;

  registerDomainHandler(executor, 'returns:rma_create', (dialect, input) => createRMA(dialect, input, {
    companyId: input.company_id, branchId: input.branch_id, userId: input.actor_id,
  }));

  registerDomainHandler(executor, 'returns:rma_submit', (dialect, input) => submitRMA(dialect, {
    id: input.id, actor: input.actor_id,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:rma_approve', (dialect, input) => approveRMA(dialect, {
    id: input.id, actor: input.actor_id, notes: input.notes,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:rma_reject', (dialect, input) => rejectRMA(dialect, {
    id: input.id, actor: input.actor_id, reason: input.reason,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:record_receipt', (dialect, input) => recordReceipt(dialect, {
    id: input.id, location_id: input.location_id, location_dest_id: input.location_dest_id,
    items: input.items, actor: input.actor_id,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:record_inspection', (dialect, input) => recordInspection(dialect, {
    id: input.id, condition: input.condition, passes: input.passes, notes: input.notes,
    ncr_title: input.ncr_title, actor: input.actor_id,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:record_disposition', (dialect, input) => recordDisposition(dialect, {
    id: input.id, disposition: input.disposition, notes: input.notes, actor: input.actor_id,
  }, { companyId: input.company_id, userId: input.actor_id }));

  registerDomainHandler(executor, 'returns:rma_close', (dialect, input) => closeRMA(dialect, {
    id: input.id, actor: input.actor_id,
  }, { companyId: input.company_id, userId: input.actor_id }));
}
