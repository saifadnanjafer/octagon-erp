// platform/assets/index.mjs — Assets Management Action Registration and Query Handler.

'use strict';

import { registerDomainHandler } from '../kernel/actions/domain-handler.mjs';

import * as register from './asset-register.mjs';
import * as depreciation from './depreciation.mjs';

export { register, depreciation };
export { AssetError } from './asset-register.mjs';

export function registerAssetActions(actionExecutor) {
  if (!actionExecutor || typeof actionExecutor.registerHandler !== 'function') {
    throw new TypeError('canonical ActionExecutor with registerHandler() is required');
  }

  registerDomainHandler(actionExecutor, 'assets:category:create', register.createAssetCategory);
  registerDomainHandler(actionExecutor, 'assets:asset:create', register.createAsset);
  registerDomainHandler(actionExecutor, 'assets:asset:capitalize', register.capitalizeAsset);
  registerDomainHandler(actionExecutor, 'assets:asset:assign', register.assignAsset);
  registerDomainHandler(actionExecutor, 'assets:asset:transfer', register.transferAsset);
  registerDomainHandler(actionExecutor, 'assets:asset:calculate_depreciation', depreciation.calculateDepreciation);
  registerDomainHandler(actionExecutor, 'assets:asset:post_depreciation_request', depreciation.postDepreciationRequest);
  registerDomainHandler(actionExecutor, 'assets:asset:dispose', register.disposeAsset);

  return actionExecutor;
}

export function handleAssetsQuery({ dialect, ctx, resource, recordId, query }) {
  if (resource === 'categories' || resource === 'asset_categories') {
    const rows = dialect.prepare('SELECT * FROM asset_categories ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'assets' || resource === 'asset_register') {
    if (recordId) {
      const doc = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(recordId);
      return doc ? { data: doc } : { error: 'asset not found', status: 404 };
    }
    const rows = dialect.prepare('SELECT * FROM assets ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'depreciation-schedules' || resource === 'depreciation_schedules') {
    const rows = dialect.prepare('SELECT * FROM asset_depreciation_schedules ORDER BY period_number').all();
    return { data: rows, meta: { total: rows.length } };
  }

  if (resource === 'transfers' || resource === 'asset_transfers') {
    const rows = dialect.prepare('SELECT * FROM asset_transfers ORDER BY created_at DESC').all();
    return { data: rows, meta: { total: rows.length } };
  }

  return { error: `unknown assets resource ${resource}`, status: 404 };
}
