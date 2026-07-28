// platform/assets/asset-register.mjs — Asset Register & Custody Domain Engine.

'use strict';

import crypto from 'node:crypto';

export class AssetError extends Error {
  constructor(message, code = 'ASSET_ERROR', statusCode = 422) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function createAssetCategory(db, input) {
  const { code, name_en, name, name_ar, depreciation_method, useful_life_months } = input;
  const cCode = code || `CAT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const cNameEn = name_en || name;
  if (!cNameEn) throw new AssetError('name_en or name is required', 'INPUT_MISSING_FIELD');

  const companyId = input.company_id || 'default';
  const dialect = db;
  const id = `acat_${crypto.randomUUID()}`;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO asset_categories (
      id, company_id, code, name_ar, name_en, depreciation_method, useful_life_months, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, cCode, name_ar || '', cNameEn,
    depreciation_method || 'straight_line', useful_life_months || 60, now, now
  );

  return { id, code: cCode, name_en: cNameEn, name: cNameEn };
}

export function createAsset(db, input) {
  const { name, name_en, name_ar, category_id, acquisition_cost, purchase_value, salvage_value, residual_value, useful_life_months, serial_number, supplier_id, location_id, project_id } = input;
  const aNameEn = name_en || name;
  const acqCost = Number(acquisition_cost !== undefined ? acquisition_cost : (purchase_value !== undefined ? purchase_value : 0));
  if (!aNameEn || !category_id) {
    throw new AssetError('name_en and category_id are required', 'INPUT_MISSING_FIELD');
  }

  const dialect = db;
  const cat = dialect.prepare('SELECT * FROM asset_categories WHERE id = ?').get(category_id);
  if (!cat) throw new AssetError(`category ${category_id} not found`, 'CATEGORY_NOT_FOUND');

  const companyId = input.company_id || 'default';
  const id = `ast_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM assets WHERE company_id = ?').get(companyId);
  const assetNumber = `AST-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const resVal = Number(residual_value !== undefined ? residual_value : (salvage_value !== undefined ? salvage_value : 0.0));
  const lifeM = useful_life_months || cat.useful_life_months || 60;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO assets (
      id, company_id, branch_id, asset_number, name_ar, name_en, category_id, equipment_class,
      serial_number, acquisition_date, acquisition_cost, residual_value, accumulated_depreciation, book_value, useful_life_months,
      depreciation_method, supplier_id, location_id, project_id, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'general', ?, ?, ?, ?, 0.0, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, companyId, input.branch_id || null, assetNumber, name_ar || '', aNameEn, category_id,
    serial_number || '', now, acqCost, resVal, acqCost, lifeM, cat.depreciation_method || 'straight_line',
    supplier_id || null, location_id || null, project_id || null, now, now
  );

  return { id, asset_number: assetNumber, purchase_value: acqCost, acquisition_cost: acqCost, state: 'draft' };
}

export function capitalizeAsset(db, input) {
  const { asset_id } = input;
  const dialect = db;
  const asset = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(asset_id);
  if (!asset) throw new AssetError(`asset ${asset_id} not found`, 'ASSET_NOT_FOUND');
  if (asset.state !== 'draft') throw new AssetError('asset is already capitalized or disposed', 'INVALID_STATE_TRANSITION');

  const now = nowISO();
  dialect.prepare("UPDATE assets SET state = 'capitalized', capitalization_date = ?, updated_at = ? WHERE id = ?").run(now, now, asset_id);

  // Generate depreciation schedule
  const netDepreciable = asset.acquisition_cost - asset.residual_value;
  const monthlyDep = netDepreciable / asset.useful_life_months;
  let accumDep = 0.0;

  const insertSched = dialect.prepare(`
    INSERT INTO asset_depreciation_schedules (
      id, company_id, asset_id, period_number, period_date, depreciation_amount,
      accumulated_depreciation, book_value, state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `);

  const startDate = new Date();
  for (let p = 1; p <= asset.useful_life_months; p++) {
    const periodDate = new Date(startDate.getFullYear(), startDate.getMonth() + p, 1).toISOString();
    accumDep += monthlyDep;
    const bookVal = asset.acquisition_cost - accumDep;
    insertSched.run(
      `dsched_${crypto.randomUUID()}`, asset.company_id, asset_id, p, periodDate,
      monthlyDep, accumDep, Math.max(asset.residual_value, bookVal), now
    );
  }

  dialect.prepare("UPDATE assets SET state = 'active', updated_at = ? WHERE id = ?").run(now, asset_id);

  return { id: asset_id, state: 'active', depreciation_periods: asset.useful_life_months };
}

export function assignAsset(db, input) {
  const { asset_id, custodian_user_id } = input;
  const dialect = db;
  const asset = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(asset_id);
  if (!asset) throw new AssetError(`asset ${asset_id} not found`, 'ASSET_NOT_FOUND');

  dialect.prepare('UPDATE assets SET custodian_user_id = ?, updated_at = ? WHERE id = ?').run(custodian_user_id, nowISO(), asset_id);
  return { id: asset_id, custodian_user_id };
}

export function transferAsset(db, input) {
  const { asset_id, to_location_id, to_custodian_id, reason, notes } = input;
  const dialect = db;
  const asset = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(asset_id);
  if (!asset) throw new AssetError(`asset ${asset_id} not found`, 'ASSET_NOT_FOUND');

  const now = nowISO();
  dialect.prepare(`
    INSERT INTO asset_transfers (id, company_id, asset_id, from_location_id, to_location_id, from_custodian_id, to_custodian_id, transfer_date, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `atrn_${crypto.randomUUID()}`, asset.company_id, asset_id, asset.location_id, to_location_id || asset.location_id,
    asset.custodian_user_id, to_custodian_id || asset.custodian_user_id, now, reason || notes || '', now
  );

  dialect.prepare('UPDATE assets SET location_id = COALESCE(?, location_id), custodian_user_id = COALESCE(?, custodian_user_id), updated_at = ? WHERE id = ?').run(to_location_id || null, to_custodian_id || null, now, asset_id);

  return { id: asset_id, to_location_id, location_id: to_location_id, custodian_id: to_custodian_id };
}

export function disposeAsset(db, input) {
  const { asset_id } = input;
  const dialect = db;
  const asset = dialect.prepare('SELECT * FROM assets WHERE id = ?').get(asset_id);
  if (!asset) throw new AssetError(`asset ${asset_id} not found`, 'ASSET_NOT_FOUND');

  dialect.prepare("UPDATE assets SET state = 'disposed', updated_at = ? WHERE id = ?").run(nowISO(), asset_id);
  return { id: asset_id, state: 'disposed' };
}
