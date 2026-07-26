// Canonical Asset register.
//
//   draft → acquired → pending_capitalization → active
//         → under_maintenance / suspended → disposed / written_off
//
// Division of labour with Phase 03, which is the whole point of this module:
//   Phase 05 owns the register, the useful life, the method and the schedule.
//   Phase 03 owns the postings — `capitalizeAsset`, `postAssetDepreciation`,
//   `disposeAsset`. This file computes and schedules; it never writes a journal
//   line, and it never keeps its own accumulated-depreciation ledger beyond the
//   mirror that each Phase 03 posting updates.

import {
  createDomainError, domainGuards, makeId, nowIso, today, round2, round6,
} from '../kernel/domain/kit.mjs';
import { capitalizeAsset, postAssetDepreciation, disposeAsset } from '../finance/engine.mjs';

export const AssetError = createDomainError('AssetError', 'ASSET_ERROR');
const g = domainGuards(AssetError);

const DEPRECIABLE_STATES = ['active', 'under_maintenance', 'suspended'];

export function createCategory(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const code = g.requireText(payload.code, 'asset category code');
  const name = g.requireText(payload.name, 'asset category name');
  if (payload.finance_category_id) {
    const financeCategory = db.prepare(
      'SELECT id FROM finance_asset_categories WHERE id = ? AND company_id = ?',
    ).get(payload.finance_category_id, companyId);
    if (!financeCategory) {
      throw new AssetError(
        'finance_category_id must reference a Phase 03 asset category in this company',
        'ASSET_CATEGORY_NOT_MAPPED',
      );
    }
  }
  const id = payload.id || makeId('assetcat');
  db.prepare(`
    INSERT INTO asset_categories (
      id, company_id, code, name, finance_category_id, default_useful_life_months,
      default_method, default_residual_percent, asset_class, is_active, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(company_id, code) DO UPDATE SET
      name = excluded.name,
      finance_category_id = excluded.finance_category_id,
      default_useful_life_months = excluded.default_useful_life_months,
      default_method = excluded.default_method,
      default_residual_percent = excluded.default_residual_percent,
      asset_class = excluded.asset_class
  `).run(
    id, companyId, code, name, payload.finance_category_id || null,
    Number(payload.default_useful_life_months || 60), payload.default_method || 'straight_line',
    g.nonNegative(payload.default_residual_percent, 'default_residual_percent'),
    payload.asset_class || 'equipment', nowIso(), actor,
  );
  return db.prepare('SELECT * FROM asset_categories WHERE company_id = ? AND code = ?').get(companyId, code);
}

export function createAsset(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const name = g.requireText(payload.name, 'asset name');

  let categoryId = payload.category_id;
  if (!categoryId) {
    categoryId = db.prepare(
      'SELECT id FROM asset_categories WHERE company_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1',
    ).get(companyId)?.id;
  }
  if (!categoryId) throw new AssetError('an asset category is required', 'INPUT_MISSING_FIELD');
  const category = g.scopedRow(db, 'asset_categories', categoryId, companyId, 'asset category');

  const assetTag = String(payload.asset_tag || '').trim()
    || g.nextReference(db, 'assets', companyId, 'AST', 'asset_tag');
  const duplicate = db.prepare('SELECT id FROM assets WHERE company_id = ? AND asset_tag = ?').get(companyId, assetTag);
  if (duplicate) throw new AssetError(`asset tag already exists: ${assetTag}`, 'ASSET_DUPLICATE', 409);

  for (const [field, table, label] of [
    ['source_project_id', 'projects', 'source project'],
    ['source_production_order_id', 'production_orders', 'source manufacturing order'],
    ['supplier_party_id', 'parties', 'supplier'],
  ]) {
    if (payload[field]) g.scopedRow(db, table, payload[field], companyId, label);
  }

  const acquisitionValue = g.nonNegative(payload.acquisition_value, 'acquisition_value');
  const residual = payload.residual_value !== undefined
    ? g.nonNegative(payload.residual_value, 'residual_value')
    : round2(acquisitionValue * (Number(category.default_residual_percent) / 100));
  if (residual > acquisitionValue) {
    throw new AssetError('residual value cannot exceed the acquisition value', 'INPUT_INVALID');
  }

  const id = payload.id || makeId('asset');
  const now = nowIso();
  db.prepare(`
    INSERT INTO assets (
      id, company_id, branch_id, category_id, asset_tag, name, description, serial_number,
      product_id, supplier_party_id, source_purchase_order_id, source_project_id,
      source_production_order_id, state, acquisition_date, acquisition_value,
      capitalization_date, capitalized_value, capitalization_document_id,
      useful_life_months, depreciation_method, declining_rate_percent, total_expected_units,
      residual_value, accumulated_depreciation, impairment_value, revaluation_value,
      location_id, custodian_ref, department_ref, currency, disposal_date,
      disposal_document_id, disposal_proceeds, created_at, created_by, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, 0, NULL,
      ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, 1)
  `).run(
    id, companyId, payload.branch_id || null, category.id, assetTag, name,
    payload.description || null, payload.serial_number || null, payload.product_id || null,
    payload.supplier_party_id || null, payload.source_purchase_order_id || null,
    payload.source_project_id || null, payload.source_production_order_id || null,
    payload.acquisition_date || null, acquisitionValue,
    Number(payload.useful_life_months || category.default_useful_life_months),
    payload.depreciation_method || category.default_method,
    g.nonNegative(payload.declining_rate_percent, 'declining_rate_percent'),
    g.nonNegative(payload.total_expected_units, 'total_expected_units'),
    residual, payload.location_id || null, payload.custodian_ref || null,
    payload.department_ref || null, payload.currency || 'IQD', now, actor, now,
  );
  return getAsset(db, id, companyId);
}

export function acquireAsset(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  g.assertState(asset.state, ['draft'], 'asset', 'ASSET_STATE_INVALID');
  const acquisitionValue = payload.acquisition_value === undefined
    ? Number(asset.acquisition_value)
    : g.positive(payload.acquisition_value, 'acquisition_value');
  const now = nowIso();
  db.prepare(`
    UPDATE assets SET state = 'pending_capitalization', acquisition_date = COALESCE(?, acquisition_date, ?),
      acquisition_value = ?, updated_at = ?, version = version + 1 WHERE id = ?
  `).run(payload.acquisition_date || null, today(), acquisitionValue, now, asset.id);
  return getAsset(db, asset.id, companyId);
}

/**
 * Capitalize through the Phase 03 contract.
 *
 * `source_account_id` is where the value comes FROM — the asset-under-
 * construction, purchase-clearing, or inventory account that already holds it.
 * There is no default: guessing that account is exactly how an asset register
 * silently stops tying to the GL.
 */
export function capitalize(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  // The duplicate check comes first so a second capitalization attempt says
  // exactly that, rather than reporting a generic state-machine refusal.
  if (asset.capitalization_document_id) {
    throw new AssetError('this asset is already capitalized', 'ASSET_ALREADY_CAPITALIZED', 409);
  }
  g.assertState(asset.state, ['draft', 'acquired', 'pending_capitalization'], 'asset', 'ASSET_STATE_INVALID');
  const category = g.scopedRow(db, 'asset_categories', asset.category_id, companyId, 'asset category');
  if (!category.finance_category_id) {
    throw new AssetError(
      `asset category ${category.code} has no Phase 03 finance category; capitalization cannot post`,
      'ASSET_CATEGORY_NOT_MAPPED',
    );
  }
  if (!payload.source_account_id) {
    throw new AssetError('source_account_id is required to capitalize an asset', 'INPUT_MISSING_FIELD');
  }
  const amount = payload.amount === undefined
    ? Number(asset.acquisition_value)
    : g.positive(payload.amount, 'capitalization amount');
  if (!(amount > 0)) throw new AssetError('capitalization amount must be positive', 'INPUT_INVALID');

  const posted = capitalizeAsset(db, g.financeContext(payload), {
    category_id: category.finance_category_id,
    source_account_id: payload.source_account_id,
    amount,
    asset_reference: asset.asset_tag,
    doc_date: payload.doc_date || today(),
  });

  const now = nowIso();
  db.prepare(`
    UPDATE assets SET state = 'active', capitalization_date = ?, capitalized_value = ?,
      capitalization_document_id = ?, acquisition_value = MAX(acquisition_value, ?),
      updated_at = ?, version = version + 1 WHERE id = ?
  `).run(payload.doc_date || today(), amount, posted.document_id, amount, now, asset.id);

  return {
    ...getAsset(db, asset.id, companyId),
    capitalization: { document_id: posted.document_id, amount, posted_by: actor },
  };
}

// --------------------------------------------------------------------------
// Depreciation
// --------------------------------------------------------------------------

function addMonths(dateIso, months) {
  const base = new Date(`${String(dateIso).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  const day = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

/**
 * Build the full schedule. Straight-line and declining-balance are computed
 * here; units-of-production cannot be scheduled in advance because the units
 * are not known, so it is rejected with a clear reason rather than silently
 * falling back to straight-line.
 *
 * The last period absorbs the rounding remainder, so
 * SUM(depreciation_amount) === depreciable base, exactly.
 */
export function generateSchedule(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  if (!asset.capitalization_document_id && !payload.allow_uncapitalized) {
    throw new AssetError(
      'a schedule can only be generated for a capitalized asset',
      'ASSET_NOT_CAPITALIZED',
    );
  }
  if (asset.depreciation_method === 'units_of_production') {
    throw new AssetError(
      'units-of-production depreciation is recorded per meter reading, not scheduled in advance',
      'DEPRECIATION_METHOD_NOT_SCHEDULABLE',
    );
  }

  const posted = db.prepare(
    "SELECT COUNT(*) AS n FROM depreciation_schedules WHERE asset_id = ? AND status = 'posted'",
  ).get(asset.id).n;
  if (Number(posted) > 0 && !payload.regenerate_unposted) {
    throw new AssetError(
      'this asset already has posted depreciation; regenerate the unposted tail explicitly',
      'DEPRECIATION_ALREADY_POSTED', 409,
    );
  }
  db.prepare("DELETE FROM depreciation_schedules WHERE asset_id = ? AND status = 'scheduled'").run(asset.id);

  const base = round2(Number(asset.capitalized_value || asset.acquisition_value) - Number(asset.residual_value));
  if (!(base > 0)) {
    throw new AssetError('there is no depreciable value on this asset', 'DEPRECIATION_BASE_INVALID');
  }
  const periods = Number(asset.useful_life_months);
  const startDate = payload.start_date || asset.capitalization_date || today();

  const alreadyPosted = round2(db.prepare(
    "SELECT COALESCE(SUM(depreciation_amount), 0) AS amount FROM depreciation_schedules WHERE asset_id = ? AND status = 'posted'",
  ).get(asset.id).amount);
  const startIndex = Number(db.prepare(
    "SELECT COALESCE(MAX(period_index), 0) AS i FROM depreciation_schedules WHERE asset_id = ? AND status = 'posted'",
  ).get(asset.id).i);

  const remainingBase = round2(base - alreadyPosted);
  const remainingPeriods = periods - startIndex;
  if (remainingPeriods <= 0) {
    return { asset_id: asset.id, generated: 0, reason: 'useful life already fully scheduled' };
  }

  const rows = [];
  let accumulated = alreadyPosted;
  if (asset.depreciation_method === 'declining_balance') {
    const ratePercent = Number(asset.declining_rate_percent) > 0
      ? Number(asset.declining_rate_percent)
      : round6((200 / periods) * 12); // double-declining default, expressed annually
    const monthlyRate = ratePercent / 100 / 12;
    let netBook = round2(Number(asset.capitalized_value || asset.acquisition_value) - alreadyPosted);
    for (let index = startIndex + 1; index <= periods; index += 1) {
      let amount = round2((netBook - Number(asset.residual_value)) * monthlyRate);
      if (index === periods) amount = round2(base - accumulated);
      if (amount < 0) amount = 0;
      if (round2(accumulated + amount) > base) amount = round2(base - accumulated);
      accumulated = round2(accumulated + amount);
      netBook = round2(netBook - amount);
      rows.push({ index, amount, accumulated });
      if (accumulated >= base) break;
    }
  } else {
    const perPeriod = round2(remainingBase / remainingPeriods);
    for (let index = startIndex + 1; index <= periods; index += 1) {
      const amount = index === periods ? round2(base - accumulated) : perPeriod;
      accumulated = round2(accumulated + amount);
      rows.push({ index, amount, accumulated });
    }
  }

  const insert = db.prepare(`
    INSERT INTO depreciation_schedules (
      id, asset_id, company_id, period_index, period_date, depreciation_amount,
      accumulated_after, net_book_value_after, currency, status, finance_document_id,
      posted_at, posted_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, NULL, ?)
  `);
  const now = nowIso();
  const capital = Number(asset.capitalized_value || asset.acquisition_value);
  for (const row of rows) {
    insert.run(
      makeId('depsch'), asset.id, companyId, row.index,
      addMonths(startDate, row.index - 1), row.amount, row.accumulated,
      round2(capital - row.accumulated), asset.currency, now,
    );
  }
  return {
    asset_id: asset.id,
    generated: rows.length,
    depreciable_base: base,
    total_scheduled: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
    method: asset.depreciation_method,
  };
}

/**
 * Post depreciation for every scheduled period whose date has arrived.
 *
 * Each period is posted individually through Phase 03, so a failure part-way
 * leaves the already-posted periods correct and the rest still scheduled —
 * which is recoverable, unlike an all-or-nothing batch that has to be unwound.
 * A period already marked `posted` is skipped rather than posted twice.
 */
export function postDepreciation(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  g.assertState(asset.state, DEPRECIABLE_STATES, 'asset', 'ASSET_STATE_INVALID');
  const category = g.scopedRow(db, 'asset_categories', asset.category_id, companyId, 'asset category');
  if (!category.finance_category_id) {
    throw new AssetError(
      `asset category ${category.code} has no Phase 03 finance category`,
      'ASSET_CATEGORY_NOT_MAPPED',
    );
  }

  const upTo = payload.up_to_date || today();
  const due = payload.period_index
    ? db.prepare("SELECT * FROM depreciation_schedules WHERE asset_id = ? AND period_index = ? AND status = 'scheduled'").all(asset.id, payload.period_index)
    : db.prepare("SELECT * FROM depreciation_schedules WHERE asset_id = ? AND status = 'scheduled' AND period_date <= ? ORDER BY period_index").all(asset.id, upTo);

  if (!due.length) {
    return { asset_id: asset.id, posted_periods: 0, total_amount: 0, documents: [] };
  }

  const documents = [];
  let total = 0;
  for (const period of due) {
    if (!(Number(period.depreciation_amount) > 0)) {
      db.prepare("UPDATE depreciation_schedules SET status = 'skipped' WHERE id = ?").run(period.id);
      continue;
    }
    const posted = postAssetDepreciation(db, g.financeContext(payload), {
      category_id: category.finance_category_id,
      amount: Number(period.depreciation_amount),
      asset_reference: `${asset.asset_tag}#${period.period_index}`,
      doc_date: period.period_date,
    });
    db.prepare(`
      UPDATE depreciation_schedules SET status = 'posted', finance_document_id = ?, posted_at = ?, posted_by = ?
      WHERE id = ?
    `).run(posted.document_id, nowIso(), actor, period.id);
    documents.push({ period_index: period.period_index, document_id: posted.document_id, amount: Number(period.depreciation_amount) });
    total = round2(total + Number(period.depreciation_amount));
  }

  db.prepare(`
    UPDATE assets SET accumulated_depreciation = (
      SELECT COALESCE(SUM(depreciation_amount), 0) FROM depreciation_schedules
      WHERE asset_id = ? AND status = 'posted'
    ), updated_at = ?, version = version + 1 WHERE id = ?
  `).run(asset.id, nowIso(), asset.id);

  return {
    asset_id: asset.id,
    posted_periods: documents.length,
    total_amount: total,
    documents,
    accumulated_depreciation: netBookValue(db, asset.id).accumulated_depreciation,
  };
}

export function netBookValue(db, assetId) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw new AssetError(`asset not found: ${assetId}`, 'RECORD_NOT_FOUND', 404);
  const accumulated = round2(db.prepare(
    "SELECT COALESCE(SUM(depreciation_amount), 0) AS amount FROM depreciation_schedules WHERE asset_id = ? AND status = 'posted'",
  ).get(assetId).amount);
  const capital = round2(Number(asset.capitalized_value || asset.acquisition_value));
  return {
    asset_id: assetId,
    capitalized_value: capital,
    accumulated_depreciation: accumulated,
    impairment_value: round2(asset.impairment_value),
    net_book_value: round2(capital - accumulated - Number(asset.impairment_value) + Number(asset.revaluation_value)),
  };
}

// --------------------------------------------------------------------------
// Custody, warranty, state
// --------------------------------------------------------------------------

export function assignAsset(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  const assignmentType = payload.assignment_type || 'custodian';
  if (!['custodian', 'department', 'location', 'project', 'cost_center'].includes(assignmentType)) {
    throw new AssetError(`unsupported assignment_type: ${assignmentType}`, 'INPUT_INVALID');
  }
  const now = nowIso();
  db.prepare(`
    UPDATE asset_assignments SET released_at = ?
    WHERE asset_id = ? AND assignment_type = ? AND released_at IS NULL
  `).run(now, asset.id, assignmentType);

  const id = payload.id || makeId('assetasg');
  db.prepare(`
    INSERT INTO asset_assignments (
      id, asset_id, company_id, assignment_type, employee_ref, department_ref,
      location_id, project_id, assigned_at, released_at, assigned_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    id, asset.id, companyId, assignmentType,
    payload.employee_ref || null, payload.department_ref || null,
    payload.location_id || null, payload.project_id || null, now, actor, payload.notes || null,
  );

  const assignments = [];
  const params = [];
  if (assignmentType === 'custodian') { assignments.push('custodian_ref = ?'); params.push(payload.employee_ref || null); }
  if (assignmentType === 'department') { assignments.push('department_ref = ?'); params.push(payload.department_ref || null); }
  if (assignmentType === 'location') { assignments.push('location_id = ?'); params.push(payload.location_id || null); }
  if (assignments.length) {
    assignments.push('updated_at = ?', 'version = version + 1');
    params.push(now, asset.id);
    db.prepare(`UPDATE assets SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }
  return getAsset(db, asset.id, companyId);
}

export function transferAsset(db, payload = {}) {
  return assignAsset(db, { ...payload, assignment_type: payload.assignment_type || 'location' });
}

export function registerWarranty(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  const startsOn = g.requireText(payload.starts_on, 'starts_on');
  const expiresOn = g.requireText(payload.expires_on, 'expires_on');
  if (expiresOn <= startsOn) {
    throw new AssetError('a warranty must expire after it starts', 'INPUT_INVALID');
  }
  const id = payload.id || makeId('assetwar');
  db.prepare(`
    INSERT INTO asset_warranties (
      id, asset_id, company_id, provider_party_id, reference, coverage,
      starts_on, expires_on, alert_days_before, created_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, asset.id, companyId, payload.provider_party_id || null, payload.reference || null,
    payload.coverage || null, startsOn, expiresOn,
    Number(payload.alert_days_before || 30), nowIso(), actor,
  );
  return db.prepare('SELECT * FROM asset_warranties WHERE id = ?').get(id);
}

export function suspendAsset(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  g.assertState(asset.state, ['active', 'under_maintenance'], 'asset', 'ASSET_STATE_INVALID');
  db.prepare("UPDATE assets SET state = 'suspended', updated_at = ?, version = version + 1 WHERE id = ?")
    .run(nowIso(), asset.id);
  return getAsset(db, asset.id, companyId);
}

export function reactivateAsset(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  g.assertState(asset.state, ['suspended', 'under_maintenance'], 'asset', 'ASSET_STATE_INVALID');
  db.prepare("UPDATE assets SET state = 'active', updated_at = ?, version = version + 1 WHERE id = ?")
    .run(nowIso(), asset.id);
  return getAsset(db, asset.id, companyId);
}

export function setMaintenanceState(db, { company_id, asset_id, under_maintenance }) {
  const asset = g.scopedRow(db, 'assets', asset_id, company_id, 'asset');
  if (under_maintenance && asset.state === 'active') {
    db.prepare("UPDATE assets SET state = 'under_maintenance', updated_at = ?, version = version + 1 WHERE id = ?")
      .run(nowIso(), asset.id);
  } else if (!under_maintenance && asset.state === 'under_maintenance') {
    db.prepare("UPDATE assets SET state = 'active', updated_at = ?, version = version + 1 WHERE id = ?")
      .run(nowIso(), asset.id);
  }
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id);
}

/**
 * Dispose or write off. Gain/loss is computed by Phase 03 from the net book
 * value this register supplies; a write-off is simply a disposal with zero
 * proceeds, so both routes share one posting path and one reconciliation.
 */
export function dispose(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  g.assertState(asset.state, DEPRECIABLE_STATES, 'asset', 'ASSET_STATE_INVALID');
  const category = g.scopedRow(db, 'asset_categories', asset.category_id, companyId, 'asset category');
  if (!category.finance_category_id) {
    throw new AssetError(
      `asset category ${category.code} has no Phase 03 finance category`,
      'ASSET_CATEGORY_NOT_MAPPED',
    );
  }
  if (!payload.proceeds_account_id) {
    throw new AssetError('proceeds_account_id is required to dispose of an asset', 'INPUT_MISSING_FIELD');
  }
  const proceeds = payload.write_off ? 0 : g.nonNegative(payload.proceeds, 'proceeds');
  const value = netBookValue(db, asset.id);

  const posted = disposeAsset(db, g.financeContext(payload), {
    category_id: category.finance_category_id,
    proceeds_account_id: payload.proceeds_account_id,
    net_book_value: value.net_book_value,
    proceeds,
    asset_reference: asset.asset_tag,
    doc_date: payload.doc_date || today(),
  });

  const now = nowIso();
  db.prepare(`
    UPDATE assets SET state = ?, disposal_date = ?, disposal_document_id = ?, disposal_proceeds = ?,
      updated_at = ?, version = version + 1 WHERE id = ?
  `).run(
    payload.write_off ? 'written_off' : 'disposed',
    payload.doc_date || today(), posted.document_id, proceeds, now, asset.id,
  );
  db.prepare("UPDATE depreciation_schedules SET status = 'cancelled' WHERE asset_id = ? AND status = 'scheduled'")
    .run(asset.id);

  return {
    ...getAsset(db, asset.id, companyId),
    disposal: {
      document_id: posted.document_id,
      net_book_value: value.net_book_value,
      proceeds,
      gain: posted.gain,
      loss: posted.loss,
      disposed_by: actor,
    },
  };
}

export function writeOff(db, payload = {}) {
  return dispose(db, { ...payload, write_off: true, proceeds: 0 });
}

export function recordMeterReading(db, payload = {}) {
  const companyId = g.requireCompany(payload);
  const actor = g.requireActor(payload);
  const asset = g.scopedRow(db, 'assets', payload.asset_id, companyId, 'asset');
  const reading = g.nonNegative(payload.reading, 'reading');
  const meterType = payload.meter_type || 'hours';
  const last = db.prepare(`
    SELECT reading FROM asset_meter_readings
    WHERE asset_id = ? AND meter_type = ? ORDER BY reading_at DESC, created_at DESC LIMIT 1
  `).get(asset.id, meterType);
  if (last && reading < Number(last.reading) && !payload.allow_rollback) {
    throw new AssetError(
      `meter reading ${reading} is lower than the previous reading ${last.reading}`,
      'METER_READING_REGRESSION',
    );
  }
  const id = payload.id || makeId('assetmtr');
  db.prepare(`
    INSERT INTO asset_meter_readings (
      id, asset_id, company_id, meter_type, reading, reading_at, recorded_by, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, asset.id, companyId, meterType, reading,
    payload.reading_at || nowIso(), actor, payload.source || 'manual', nowIso(),
  );
  return { id, asset_id: asset.id, meter_type: meterType, reading };
}

export function latestMeter(db, assetId, meterType = 'hours') {
  const row = db.prepare(`
    SELECT reading, reading_at FROM asset_meter_readings
    WHERE asset_id = ? AND meter_type = ? ORDER BY reading_at DESC, created_at DESC LIMIT 1
  `).get(assetId, meterType);
  return row ? { reading: Number(row.reading), reading_at: row.reading_at } : null;
}

export function getAsset(db, id, companyId) {
  const asset = g.scopedRow(db, 'assets', id, companyId, 'asset');
  const schedule = db.prepare(
    'SELECT * FROM depreciation_schedules WHERE asset_id = ? ORDER BY period_index',
  ).all(id);
  const assignments = db.prepare(
    'SELECT * FROM asset_assignments WHERE asset_id = ? ORDER BY assigned_at DESC',
  ).all(id);
  const warranties = db.prepare('SELECT * FROM asset_warranties WHERE asset_id = ? ORDER BY expires_on').all(id);
  const components = db.prepare('SELECT * FROM asset_components WHERE asset_id = ? ORDER BY created_at').all(id);
  return {
    ...asset,
    valuation: netBookValue(db, id),
    depreciation_schedule: schedule,
    assignments,
    warranties,
    components,
  };
}

export function listAssets(db, { company_id, state = null, category_id = null, limit = 200 }) {
  let sql = 'SELECT * FROM assets WHERE company_id = ?';
  const params = [company_id];
  if (state) { sql += ' AND state = ?'; params.push(state); }
  if (category_id) { sql += ' AND category_id = ?'; params.push(category_id); }
  sql += ` ORDER BY asset_tag LIMIT ${Math.min(Number(limit) || 200, 1000)}`;
  return db.prepare(sql).all(...params);
}

export { round2, round6 };
