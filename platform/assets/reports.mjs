// Asset reporting. All figures derive from the register plus the posted
// depreciation schedule; nothing is cached.

import { round2 } from '../kernel/domain/kit.mjs';

export function assetRegister(db, { company_id, state = null }) {
  let sql = `
    SELECT a.*, c.code AS category_code, c.name AS category_name,
      COALESCE((SELECT SUM(d.depreciation_amount) FROM depreciation_schedules d
                WHERE d.asset_id = a.id AND d.status = 'posted'), 0) AS posted_depreciation
    FROM assets a JOIN asset_categories c ON c.id = a.category_id
    WHERE a.company_id = ?
  `;
  const params = [company_id];
  if (state) { sql += ' AND a.state = ?'; params.push(state); }
  sql += ' ORDER BY a.asset_tag';
  return db.prepare(sql).all(...params).map((row) => {
    const capital = round2(Number(row.capitalized_value || row.acquisition_value));
    const accumulated = round2(row.posted_depreciation);
    return {
      ...row,
      capitalized_value: capital,
      accumulated_depreciation: accumulated,
      net_book_value: round2(capital - accumulated - Number(row.impairment_value) + Number(row.revaluation_value)),
    };
  });
}

export function depreciationReport(db, { company_id, from_date = null, to_date = null }) {
  let sql = `
    SELECT d.*, a.asset_tag, a.name AS asset_name, c.code AS category_code
    FROM depreciation_schedules d
    JOIN assets a ON a.id = d.asset_id
    JOIN asset_categories c ON c.id = a.category_id
    WHERE d.company_id = ?
  `;
  const params = [company_id];
  if (from_date) { sql += ' AND d.period_date >= ?'; params.push(from_date); }
  if (to_date) { sql += ' AND d.period_date <= ?'; params.push(to_date); }
  sql += ' ORDER BY d.period_date, a.asset_tag';
  const rows = db.prepare(sql).all(...params);
  const posted = rows.filter((row) => row.status === 'posted');
  const scheduled = rows.filter((row) => row.status === 'scheduled');
  return {
    rows,
    posted_total: round2(posted.reduce((sum, row) => sum + Number(row.depreciation_amount), 0)),
    scheduled_total: round2(scheduled.reduce((sum, row) => sum + Number(row.depreciation_amount), 0)),
    posted_periods: posted.length,
    scheduled_periods: scheduled.length,
  };
}

/**
 * The reconciliation that matters: what the register says has been depreciated
 * versus what the GL actually carries in the accumulated-depreciation account
 * of each Phase 03 asset category.
 */
export function assetAccountingReconciliation(db, { company_id }) {
  const categories = db.prepare(`
    SELECT c.id, c.code, c.name, c.finance_category_id, fc.asset_account_id,
           fc.accumulated_depreciation_account_id
    FROM asset_categories c
    LEFT JOIN finance_asset_categories fc ON fc.id = c.finance_category_id
    WHERE c.company_id = ?
  `).all(company_id);

  const accountBalance = (accountId) => {
    if (!accountId) return null;
    const row = db.prepare(`
      SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
      FROM finance_journal_lines WHERE company_id = ? AND account_id = ?
    `).get(company_id, accountId);
    return round2(Number(row.debit) - Number(row.credit));
  };

  return categories.map((category) => {
    // Live register figures — what the business currently owns.
    const liveCapital = round2(db.prepare(`
      SELECT COALESCE(SUM(capitalized_value), 0) AS amount FROM assets
      WHERE company_id = ? AND category_id = ? AND state NOT IN ('disposed', 'written_off')
    `).get(company_id, category.id).amount);
    const liveAccumulated = round2(db.prepare(`
      SELECT COALESCE(SUM(d.depreciation_amount), 0) AS amount
      FROM depreciation_schedules d JOIN assets a ON a.id = d.asset_id
      WHERE d.company_id = ? AND a.category_id = ? AND d.status = 'posted'
        AND a.state NOT IN ('disposed', 'written_off')
    `).get(company_id, category.id).amount);

    // Ledger-basis figures — what the GL should show, given how Phase 03 posts
    // a disposal.
    //
    // Phase 03 `disposeAsset` credits the ASSET account by the net book value
    // and does not touch accumulated depreciation. The consequence is that a
    // disposed asset leaves its accumulated depreciation behind in the GL while
    // its gross cost is only partly removed. Comparing the live register
    // against those accounts would therefore always show a false variance once
    // anything is disposed. The ledger basis below reproduces exactly what
    // Phase 03 posts, so a non-zero variance means real drift rather than a
    // known modelling difference. The modelling difference itself is reported
    // as `disposal_treatment` rather than hidden.
    const disposedCapital = round2(db.prepare(`
      SELECT COALESCE(SUM(capitalized_value), 0) AS amount FROM assets
      WHERE company_id = ? AND category_id = ? AND state IN ('disposed', 'written_off')
    `).get(company_id, category.id).amount);
    const disposedAccumulated = round2(db.prepare(`
      SELECT COALESCE(SUM(d.depreciation_amount), 0) AS amount
      FROM depreciation_schedules d JOIN assets a ON a.id = d.asset_id
      WHERE d.company_id = ? AND a.category_id = ? AND d.status = 'posted'
        AND a.state IN ('disposed', 'written_off')
    `).get(company_id, category.id).amount);
    // Disposal credited the asset account by net book value only.
    const disposedNetBookValue = round2(disposedCapital - disposedAccumulated);

    const expectedAssetBalance = round2(liveCapital + disposedCapital - disposedNetBookValue);
    const expectedAccumulated = round2(liveAccumulated + disposedAccumulated);

    const glAsset = accountBalance(category.asset_account_id);
    const glAccumulated = accountBalance(category.accumulated_depreciation_account_id);
    return {
      category_id: category.id,
      category_code: category.code,
      finance_category_id: category.finance_category_id,
      mapped: Boolean(category.finance_category_id),

      register_capitalized_value: liveCapital,
      register_accumulated_depreciation: liveAccumulated,
      disposed_capitalized_value: disposedCapital,
      disposed_accumulated_depreciation: disposedAccumulated,

      expected_asset_account_balance: expectedAssetBalance,
      gl_asset_account_balance: glAsset,
      asset_variance: glAsset === null ? null : round2(glAsset - expectedAssetBalance),

      expected_accumulated_depreciation: expectedAccumulated,
      gl_accumulated_depreciation_balance: glAccumulated === null ? null : round2(-glAccumulated),
      depreciation_variance: glAccumulated === null ? null : round2((-glAccumulated) - expectedAccumulated),

      disposal_treatment:
        'Phase 03 disposeAsset credits the asset account by net book value and leaves accumulated '
        + 'depreciation in place. Disposed assets are therefore carried on the ledger basis above. '
        + 'Fully de-recognising a disposed asset is a Phase 03 change and is not made here.',
    };
  });
}

export function warrantyExpiryAlerts(db, { company_id, within_days = 60 }) {
  const horizon = new Date(Date.now() + Number(within_days) * 86_400_000).toISOString().slice(0, 10);
  return db.prepare(`
    SELECT w.*, a.asset_tag, a.name AS asset_name
    FROM asset_warranties w JOIN assets a ON a.id = w.asset_id
    WHERE w.company_id = ? AND w.expires_on <= ?
    ORDER BY w.expires_on
  `).all(company_id, horizon);
}

export function assetsByCustodian(db, { company_id }) {
  return db.prepare(`
    SELECT COALESCE(custodian_ref, 'unassigned') AS custodian_ref, COUNT(*) AS assets,
           COALESCE(SUM(capitalized_value), 0) AS capitalized_value
    FROM assets WHERE company_id = ? AND state NOT IN ('disposed', 'written_off')
    GROUP BY custodian_ref ORDER BY assets DESC
  `).all(company_id).map((row) => ({ ...row, capitalized_value: round2(row.capitalized_value) }));
}
