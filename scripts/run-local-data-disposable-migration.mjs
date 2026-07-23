// Real local-data disposable migration validation (Phase 03 closure audit).
//
// Unlike scripts/run-disposable-legacy-migration.mjs (synthetic fixture), this
// script migrates the REAL finance facts from the live PentagonDB store
// (database.db) into a FRESH canonical SQLite DB built by the migration
// runner, then proves reconciliation, idempotency, and rollback.
//
// Safety contract:
//   - database.db is opened read-only ONLY (node:sqlite readOnly:true) and
//     consolidated via VACUUM INTO a disposable copy. The source is never
//     written. SHA-256 of database.db and database.db-wal is recorded before
//     and after the whole run and must be identical.
//   - All artifacts live under temp/local-data-migration/ (temp/ is gitignored).
//   - database/migrations/ is never touched; the canonical DB is built by
//     executing the frozen migrations into a new file.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openMigrationDatabase, freshInstall } from '../database/migration-runner/index.mjs';
import { seedOrg } from '../tests/phase02/harness.mjs';
import {
  mapLegacyAccountType,
  migrateLegacyAccounts,
  migrateLegacyMoves,
  reconcileMigrationTrialBalance,
  getMigrationQuarantine,
  getMigrationRunStatus,
  rollbackMigrationRun,
  getTrialBalance,
} from '../platform/finance/engine.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DB = path.join(ROOT, 'database.db');
const SRC_WAL = path.join(ROOT, 'database.db-wal');
const OUT_DIR = path.join(ROOT, 'temp', 'local-data-migration');
const COPY_DB = path.join(OUT_DIR, 'live-store-consolidated-copy.db');
const CANON_DB = path.join(OUT_DIR, 'canonical-fresh.db');
const REPORT_JSON = path.join(OUT_DIR, 'migration-result.json');

// Extension hook: if the engine's LEGACY_ACCOUNT_TYPE_MAP ever rejects a real
// type found in finance.accounts, add the mapping HERE (never in migrations).
// Keys are lowercase trimmed legacy types, values are canonical types.
// Current live data: asset, liability, equity, income, expense — all covered
// by the engine map, so this table is empty.
const SCRIPT_LEGACY_TYPE_EXTENSIONS = {};

function mapTypeWithExtensions(legacyType) {
  const engine = mapLegacyAccountType(legacyType);
  if (engine) return { canonical: engine, via: 'engine' };
  const key = String(legacyType || '').trim().toLowerCase();
  const ext = SCRIPT_LEGACY_TYPE_EXTENSIONS[key];
  return ext ? { canonical: ext, via: 'script_extension' } : { canonical: null, via: 'unmappable' };
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fileStat(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const s = fs.statSync(filePath);
  return { size_bytes: s.size, mtime: s.mtime.toISOString() };
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function readCollection(db, collection) {
  return db.prepare('SELECT id, data FROM collections WHERE collection = ?').all(collection)
    .map((row) => JSON.parse(row.data));
}

async function main() {
  const gates = [];
  const gate = (name, pass, detail = '') => {
    gates.push({ name, pass: !!pass, detail });
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    for (const base of [COPY_DB, CANON_DB]) {
      try { fs.unlinkSync(base + suffix); } catch { /* not present */ }
    }
  }
  try { fs.unlinkSync(REPORT_JSON); } catch { /* not present */ }

  console.log('=== LOCAL-DATA DISPOSABLE MIGRATION VALIDATION ===\n');

  // -----------------------------------------------------------------------
  // Step 0: source integrity fingerprints (before)
  // -----------------------------------------------------------------------
  console.log('[0] Fingerprinting live source (before)...');
  const srcBefore = {
    db_sha256: sha256File(SRC_DB),
    wal_sha256: sha256File(SRC_WAL),
    db_stat: fileStat(SRC_DB),
    wal_stat: fileStat(SRC_WAL),
  };
  console.log(`    database.db  sha256=${srcBefore.db_sha256} size=${srcBefore.db_stat?.size_bytes}`);
  console.log(`    database.db-wal sha256=${srcBefore.wal_sha256} size=${srcBefore.wal_stat?.size_bytes}`);

  // -----------------------------------------------------------------------
  // Step 1: disposable consolidated copy via read-only VACUUM INTO
  // -----------------------------------------------------------------------
  console.log('[1] Creating consolidated disposable copy (read-only VACUUM INTO)...');
  const src = new DatabaseSync(SRC_DB, { readOnly: true });
  src.exec(`VACUUM INTO '${COPY_DB.replaceAll('\\', '/')}'`);
  src.close();
  const copyInfo = { path: COPY_DB, sha256: sha256File(COPY_DB), stat: fileStat(COPY_DB) };
  console.log(`    copy sha256=${copyInfo.sha256} size=${copyInfo.stat?.size_bytes}`);

  // -----------------------------------------------------------------------
  // Step 2: extract legacy finance facts from the COPY
  // -----------------------------------------------------------------------
  console.log('[2] Extracting legacy finance facts from the copy...');
  const copy = new DatabaseSync(COPY_DB, { readOnly: true });
  const rawAccounts = readCollection(copy, 'finance.accounts');
  const rawMoves = readCollection(copy, 'account_moves');
  const journals = readCollection(copy, 'journals');
  const transactions = readCollection(copy, 'finance.transactions');
  const departments = readCollection(copy, 'finance.departments');
  copy.close();

  const movesByState = {};
  for (const m of rawMoves) movesByState[m.state ?? '(none)'] = (movesByState[m.state ?? '(none)'] || 0) + 1;
  const postedMoves = rawMoves.filter((m) => m.state === 'posted');
  const nonPostedMoves = rawMoves.filter((m) => m.state !== 'posted');
  const postedLines = postedMoves.flatMap((m) => Array.isArray(m.line_ids) ? m.line_ids : []);
  const allLines = rawMoves.flatMap((m) => Array.isArray(m.line_ids) ? m.line_ids : []);
  const moveDates = postedMoves.map((m) => m.date).filter(Boolean).sort();
  const currencies = [...new Set(rawMoves.map((m) => m.currency).filter(Boolean))];
  const companyIds = [...new Set(rawMoves.map((m) => m.companyId).filter(Boolean))];
  const moveTypes = {};
  for (const m of rawMoves) moveTypes[m.move_type ?? '(none)'] = (moveTypes[m.move_type ?? '(none)'] || 0) + 1;
  const openingMoves = postedMoves.filter((m) => /open/i.test(`${m.name || ''} ${m.origin || ''}`));

  const extraction = {
    accounts: rawAccounts.length,
    journals: journals.length,
    transactions: transactions.length,
    departments: departments.length,
    moves_total: rawMoves.length,
    moves_by_state: movesByState,
    moves_posted: postedMoves.length,
    moves_excluded_non_posted: nonPostedMoves.length,
    lines_total_all_moves: allLines.length,
    lines_posted_moves: postedLines.length,
    date_range_posted: moveDates.length ? { min: moveDates[0], max: moveDates[moveDates.length - 1] } : null,
    currencies_found: currencies,
    move_types: moveTypes,
    company_ids_on_moves: companyIds,
    opening_balance_moves_detected: openingMoves.map((m) => m.name || m.id),
  };
  console.log(`    accounts=${extraction.accounts} moves=${extraction.moves_total} (${extraction.moves_posted} posted, ${extraction.moves_excluded_non_posted} non-posted) postedLines=${extraction.lines_posted_moves}`);
  console.log(`    journals=${extraction.journals} transactions=${extraction.transactions} departments=${extraction.departments} dates=${extraction.date_range_posted?.min}..${extraction.date_range_posted?.max}`);

  // Map legacy account types; note any that need the script-level extension.
  const typeMapping = { engine: 0, script_extension: 0, unmappable: [] };
  const legacyAccounts = rawAccounts.map((a) => {
    const t = mapTypeWithExtensions(a.type);
    if (t.via === 'engine') typeMapping.engine++;
    else if (t.via === 'script_extension') typeMapping.script_extension++;
    else typeMapping.unmappable.push({ id: a.id, code: a.code, type: a.type });
    return {
      id: String(a.id ?? a.code ?? ''),
      code: a.code != null ? String(a.code) : null,
      name: a.name ?? null,
      name_ar: a.nameAr ?? a.name_ar ?? null,
      // Pass the ORIGINAL type when the engine map covers it, otherwise pass a
      // pre-mapped canonical type (engine map is idempotent on canonical
      // values for asset/liability/equity/income/expense).
      type: t.via === 'script_extension' ? t.canonical : a.type,
      parent_id: a.parent_id ?? null,
      is_reconcilable: !!a.is_reconcilable,
    };
  });
  console.log(`    type mapping: engine=${typeMapping.engine} script_extension=${typeMapping.script_extension} unmappable=${typeMapping.unmappable.length}`);

  // Only POSTED moves are GL facts. Non-posted (cancel/draft) moves are
  // excluded from migration and reported separately — they are not invalid.
  const legacyMoves = postedMoves.map((m) => ({
    id: String(m.id ?? ''),
    name: m.name ?? null,
    date: m.date ? String(m.date).slice(0, 10) : null,
    journal_id: m.journal_id ?? null,
    move_type: m.move_type ?? null,
    partner_id: m.partner_id || null,
    currency: m.currency || null,
    lines: (Array.isArray(m.line_ids) ? m.line_ids : []).map((l) => ({
      account_id: l.account_id != null ? String(l.account_id) : null,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      partner_id: l.partner_id || null,
      description: l.label || null,
    })),
  }));

  // Legacy computed facts (posted moves only = the live GL).
  let legacyTotalDebit = 0;
  let legacyTotalCredit = 0;
  const legacyBalanceByCode = new Map(); // code -> debit-credit
  const codeById = new Map(rawAccounts.map((a) => [String(a.id), String(a.code)]));
  for (const m of legacyMoves) {
    for (const l of m.lines) {
      legacyTotalDebit += l.debit;
      legacyTotalCredit += l.credit;
      const code = codeById.get(l.account_id) ?? l.account_id;
      legacyBalanceByCode.set(code, round2((legacyBalanceByCode.get(code) || 0) + l.debit - l.credit));
    }
  }
  legacyTotalDebit = round2(legacyTotalDebit);
  legacyTotalCredit = round2(legacyTotalCredit);
  const legacyTrialBalance = rawAccounts.map((a) => ({
    code: String(a.code),
    balance: legacyBalanceByCode.get(String(a.code)) || 0,
  }));

  // -----------------------------------------------------------------------
  // Step 3: fresh canonical DB + seed minimal org/fiscal calendar
  // -----------------------------------------------------------------------
  console.log('[3] Building fresh canonical DB from frozen migrations...');
  await freshInstall({ dbPath: CANON_DB });
  const dialect = openMigrationDatabase(CANON_DB);
  const org = seedOrg(dialect);
  const ctx = { companyId: org.companyA1, userId: 'u_owner' };

  // Seed open fiscal years/periods covering every posted move year AND the
  // current year (reversal documents post at today's date on rollback).
  const years = new Set(legacyMoves.map((m) => m.date?.slice(0, 4)).filter(Boolean));
  years.add(String(new Date().getUTCFullYear()));
  const nowIso = new Date().toISOString();
  for (const year of [...years].sort()) {
    const y = Number(year);
    const yearId = `fy_${ctx.companyId}_${year}`;
    dialect.prepare(`
      INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, 'system')
    `).run(yearId, ctx.companyId, year, `${year}-01-01`, `${year}-12-31`, nowIso, nowIso);
    for (let m = 1; m <= 12; m++) {
      const ms = String(m).padStart(2, '0');
      const end = new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
      dialect.prepare(`
        INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, 'system')
      `).run(`period_${ctx.companyId}_${year}_${ms}`, ctx.companyId, yearId, `${year}-${ms}`, `${year}-${ms}-01`, end, nowIso, nowIso);
    }
  }
  console.log(`    fiscal years seeded: ${[...years].sort().join(', ')} (12 open periods each)`);

  // -----------------------------------------------------------------------
  // Step 4: run the migration
  // -----------------------------------------------------------------------
  console.log('[4] Migrating legacy accounts...');
  const acctRun = migrateLegacyAccounts(dialect, ctx, { legacy_accounts: legacyAccounts });
  console.log(`    source=${acctRun.source_count} imported=${acctRun.imported} skipped=${acctRun.skipped} quarantined=${acctRun.quarantined} run=${acctRun.run_id}`);

  console.log('[5] Migrating legacy posted moves...');
  const moveRun = migrateLegacyMoves(dialect, ctx, { legacy_moves: legacyMoves });
  console.log(`    source=${moveRun.source_count} imported=${moveRun.imported} skipped=${moveRun.skipped} quarantined=${moveRun.quarantined} run=${moveRun.run_id}`);

  const quarantineAcct = getMigrationQuarantine(dialect, ctx, { migration_run_id: acctRun.run_id });
  const quarantineMove = getMigrationQuarantine(dialect, ctx, { migration_run_id: moveRun.run_id });
  const quarantineAll = [...quarantineAcct, ...quarantineMove];
  const quarantineByReason = {};
  for (const q of quarantineAll) {
    const key = q.reason.split(':')[0];
    quarantineByReason[key] = (quarantineByReason[key] || 0) + 1;
  }
  const mappingCounts = dialect.prepare(
    'SELECT source_system, COUNT(*) AS n FROM finance_migration_source_map WHERE company_id = ? GROUP BY source_system',
  ).all(ctx.companyId).reduce((acc, r) => ({ ...acc, [r.source_system]: r.n }), {});
  const canonicalDocCount = dialect.prepare(
    "SELECT COUNT(*) AS n FROM finance_documents WHERE company_id = ? AND source_type = 'legacy_migration'",
  ).get(ctx.companyId).n;
  const canonicalLineCount = dialect.prepare(
    `SELECT COUNT(*) AS n FROM finance_document_lines l JOIN finance_documents d ON d.id = l.document_id
     WHERE d.company_id = ? AND d.source_type = 'legacy_migration'`,
  ).get(ctx.companyId).n;

  // -----------------------------------------------------------------------
  // Step 5: reconcile
  // -----------------------------------------------------------------------
  console.log('[6] Reconciling legacy vs canonical...');
  const canonicalTb = getTrialBalance(dialect, ctx, {});
  const canonTotalDebit = round2(canonicalTb.reduce((s, r) => s + Number(r.total_debit), 0));
  const canonTotalCredit = round2(canonicalTb.reduce((s, r) => s + Number(r.total_credit), 0));
  const canonTbSum = round2(canonicalTb.reduce((s, r) => s + r.balance, 0));
  const tbRec = reconcileMigrationTrialBalance(dialect, ctx, { legacy_trial_balance: legacyTrialBalance });
  const mismatches = tbRec.rows.filter((r) => !r.reconciled);

  const canonByCode = new Map(canonicalTb.map((r) => [r.code, r]));
  const perAccount = legacyTrialBalance.map((l) => {
    const c = canonByCode.get(l.code);
    return {
      code: l.code,
      legacy_balance: l.balance,
      canonical_balance: c ? round2(c.balance) : 0,
      diff: round2((c ? c.balance : 0) - l.balance),
      type: rawAccounts.find((a) => String(a.code) === l.code)?.type ?? null,
    };
  });

  // AR/AP: the legacy chart has no receivable/payable-typed accounts
  // (types found are asset/liability/equity/income/expense), so AR/AP is
  // not directly derivable by type. Report per-type totals instead.
  const totalsByType = {};
  for (const row of perAccount) {
    const t = row.type ?? '(unknown)';
    totalsByType[t] = round2((totalsByType[t] || 0) + row.legacy_balance);
  }
  const hasArApTypes = rawAccounts.some((a) => ['receivable', 'payable'].includes(String(a.type).toLowerCase()));
  const arAp = hasArApTypes
    ? {
      derivable: true,
      ar_total: round2(perAccount.filter((r) => r.type === 'receivable').reduce((s, r) => s + r.legacy_balance, 0)),
      ap_total: round2(perAccount.filter((r) => r.type === 'payable').reduce((s, r) => s + r.legacy_balance, 0)),
    }
    : { derivable: false, reason: 'legacy chart has no receivable/payable-typed accounts; see totals_by_type', totals_by_type: totalsByType };

  console.log(`    legacy  totals: debit=${legacyTotalDebit} credit=${legacyTotalCredit}`);
  console.log(`    canonical totals: debit=${canonTotalDebit} credit=${canonTotalCredit} tb_sum=${canonTbSum}`);
  console.log(`    trial balance fully reconciled: ${tbRec.fully_reconciled} (mismatches=${mismatches.length})`);
  if (mismatches.length) {
    for (const mm of mismatches.slice(0, 10)) console.log(`      mismatch ${mm.code}: legacy=${mm.legacy_balance} canonical=${mm.canonical_balance} diff=${mm.diff}`);
  }

  // -----------------------------------------------------------------------
  // Step 6: idempotency — re-run the same import, expect zero new imports
  // -----------------------------------------------------------------------
  console.log('[7] Proving idempotency (second import run)...');
  const acctRerun = migrateLegacyAccounts(dialect, ctx, { legacy_accounts: legacyAccounts });
  const moveRerun = migrateLegacyMoves(dialect, ctx, { legacy_moves: legacyMoves });
  const docCountAfterRerun = dialect.prepare(
    "SELECT COUNT(*) AS n FROM finance_documents WHERE company_id = ? AND source_type = 'legacy_migration'",
  ).get(ctx.companyId).n;
  console.log(`    accounts rerun: imported=${acctRerun.imported} skipped=${acctRerun.skipped} quarantined=${acctRerun.quarantined}`);
  console.log(`    moves rerun:    imported=${moveRerun.imported} skipped=${moveRerun.skipped} quarantined=${moveRerun.quarantined}`);
  console.log(`    canonical legacy-migration docs before/after rerun: ${canonicalDocCount}/${docCountAfterRerun}`);
  const idempotencyPass = acctRerun.imported === 0 && moveRerun.imported === 0
    && acctRerun.skipped === acctRun.imported && moveRerun.skipped === moveRun.imported
    && docCountAfterRerun === canonicalDocCount;

  // -----------------------------------------------------------------------
  // Step 7: rollback — reverse every imported document, expect zero GL
  // -----------------------------------------------------------------------
  console.log('[8] Proving rollback (reverse imported documents)...');
  const rollback = rollbackMigrationRun(dialect, ctx, { migration_run_id: moveRun.run_id });
  const runStatusAfter = getMigrationRunStatus(dialect, ctx, { migration_run_id: moveRun.run_id });
  const tbAfterRollback = getTrialBalance(dialect, ctx, {});
  const residualAfterRollback = round2(tbAfterRollback.reduce((s, r) => s + Math.abs(r.balance), 0));
  const residualDebit = round2(tbAfterRollback.reduce((s, r) => s + r.balance, 0));
  let secondRollbackRejected = false;
  try {
    rollbackMigrationRun(dialect, ctx, { migration_run_id: moveRun.run_id });
  } catch (e) {
    secondRollbackRejected = /only a completed run can be rolled back/.test(e.message);
  }
  console.log(`    documents_reversed=${rollback.documents_reversed} (expected ${moveRun.imported}) run_status=${runStatusAfter.status}`);
  console.log(`    residual |balance| sum after rollback=${residualAfterRollback} net=${residualDebit} second_rollback_rejected=${secondRollbackRejected}`);
  const rollbackPass = rollback.documents_reversed === moveRun.imported
    && runStatusAfter.status === 'rolled_back'
    && Math.abs(residualAfterRollback) < 0.01
    && secondRollbackRejected;

  dialect.close();

  // -----------------------------------------------------------------------
  // Step 8: source integrity fingerprints (after)
  // -----------------------------------------------------------------------
  console.log('[9] Fingerprinting live source (after)...');
  const srcAfter = {
    db_sha256: sha256File(SRC_DB),
    wal_sha256: sha256File(SRC_WAL),
    db_stat: fileStat(SRC_DB),
    wal_stat: fileStat(SRC_WAL),
  };
  const sourceUnchanged = srcBefore.db_sha256 === srcAfter.db_sha256
    && srcBefore.wal_sha256 === srcAfter.wal_sha256;
  console.log(`    database.db unchanged: ${srcBefore.db_sha256 === srcAfter.db_sha256}`);
  console.log(`    database.db-wal unchanged: ${srcBefore.wal_sha256 === srcAfter.wal_sha256}`);

  // -----------------------------------------------------------------------
  // Gates
  // -----------------------------------------------------------------------
  console.log('\n=== GATES ===');
  gate('source database.db byte-unchanged', srcBefore.db_sha256 === srcAfter.db_sha256, srcAfter.db_sha256);
  gate('source database.db-wal byte-unchanged', srcBefore.wal_sha256 === srcAfter.wal_sha256, srcAfter.wal_sha256 ?? '(no wal)');
  gate('accounts: source = imported + skipped + quarantined', acctRun.source_count === acctRun.imported + acctRun.skipped + acctRun.quarantined,
    `${acctRun.source_count} = ${acctRun.imported}+${acctRun.skipped}+${acctRun.quarantined}`);
  gate('posted moves: source = imported + skipped + quarantined', moveRun.source_count === moveRun.imported + moveRun.skipped + moveRun.quarantined,
    `${moveRun.source_count} = ${moveRun.imported}+${moveRun.skipped}+${moveRun.quarantined}`);
  gate('zero quarantined accounts', acctRun.quarantined === 0, `${acctRun.quarantined}`);
  gate('zero quarantined moves', moveRun.quarantined === 0, `${moveRun.quarantined}`);
  gate('canonical line count = legacy posted line count', canonicalLineCount === postedLines.length, `${canonicalLineCount} vs ${postedLines.length}`);
  gate('canonical totals = legacy totals', canonTotalDebit === legacyTotalDebit && canonTotalCredit === legacyTotalCredit,
    `canonical ${canonTotalDebit}/${canonTotalCredit} vs legacy ${legacyTotalDebit}/${legacyTotalCredit}`);
  gate('legacy trial balance sums to zero', Math.abs(round2(legacyTotalDebit - legacyTotalCredit)) < 0.01);
  gate('canonical trial balance sums to zero', Math.abs(canonTbSum) < 0.01, `sum=${canonTbSum}`);
  gate('per-account trial balance fully reconciled', tbRec.fully_reconciled, `${mismatches.length} mismatches`);
  gate('idempotency: second run imports nothing', idempotencyPass,
    `accounts rerun imported=${acctRerun.imported} skipped=${acctRerun.skipped}; moves rerun imported=${moveRerun.imported} skipped=${moveRerun.skipped}`);
  gate('rollback: all documents reversed, GL returns to zero', rollbackPass,
    `reversed=${rollback.documents_reversed}/${moveRun.imported} residual=${residualAfterRollback}`);

  const verdict = gates.every((g) => g.pass) ? 'PASS' : 'FAIL';

  const report = {
    generated_at: new Date().toISOString(),
    verdict,
    source: {
      path: SRC_DB,
      before: srcBefore,
      after: srcAfter,
      byte_unchanged: sourceUnchanged,
    },
    copy: copyInfo,
    canonical_db: path.join(OUT_DIR, 'canonical-fresh.db'),
    extraction,
    type_mapping: { ...typeMapping, script_extension_table: SCRIPT_LEGACY_TYPE_EXTENSIONS },
    migration: {
      accounts: { run_id: acctRun.run_id, source: acctRun.source_count, imported: acctRun.imported, skipped: acctRun.skipped, quarantined: acctRun.quarantined },
      moves: { run_id: moveRun.run_id, source: moveRun.source_count, imported: moveRun.imported, skipped: moveRun.skipped, quarantined: moveRun.quarantined },
      excluded_non_posted_moves: nonPostedMoves.map((m) => ({ id: m.id, name: m.name, state: m.state, reversed_of: m.reversed_of ?? null })),
    },
    reconciliation: {
      legacy_totals: { debit: legacyTotalDebit, credit: legacyTotalCredit },
      canonical_totals: { debit: canonTotalDebit, credit: canonTotalCredit, trial_balance_sum: canonTbSum },
      fully_reconciled: tbRec.fully_reconciled,
      mismatches,
      per_account: perAccount,
      canonical_documents: canonicalDocCount,
      canonical_lines: canonicalLineCount,
    },
    ar_ap: arAp,
    currencies_found: currencies,
    opening_balance_moves_detected: extraction.opening_balance_moves_detected,
    source_mapping_counts: mappingCounts,
    quarantine: {
      total: quarantineAll.length,
      by_reason: quarantineByReason,
      records: quarantineAll.map((q) => ({ source_system: q.source_system, source_id: q.source_id, reason: q.reason })),
    },
    idempotency: {
      pass: idempotencyPass,
      accounts_rerun: { imported: acctRerun.imported, skipped: acctRerun.skipped, quarantined: acctRerun.quarantined },
      moves_rerun: { imported: moveRerun.imported, skipped: moveRerun.skipped, quarantined: moveRerun.quarantined },
      canonical_docs_before_rerun: canonicalDocCount,
      canonical_docs_after_rerun: docCountAfterRerun,
    },
    rollback: {
      pass: rollbackPass,
      documents_reversed: rollback.documents_reversed,
      expected_reversals: moveRun.imported,
      run_status_after: runStatusAfter.status,
      residual_abs_balance_sum_after_rollback: residualAfterRollback,
      second_rollback_rejected: secondRollbackRejected,
    },
    data_quality_findings: {
      non_posted_moves_excluded: nonPostedMoves.length,
      non_posted_note: 'all non-posted moves are state=cancel and carry reversal linkage (reversed_of/reversal_id); they are excluded from the GL migration by design',
      unmappable_account_types: typeMapping.unmappable,
      currencies_found: currencies.length ? currencies : 'none on moves (canonical posting defaulted to IQD)',
      opening_balance_entries: extraction.opening_balance_moves_detected.length,
      moves_without_companyId: rawMoves.filter((m) => !m.companyId).length,
    },
    gates,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${REPORT_JSON}`);
  console.log(`\n=== VERDICT: ${verdict} (${gates.filter((g) => g.pass).length}/${gates.length} gates passed) ===`);
  if (verdict !== 'PASS') process.exitCode = 1;
}

main().catch((err) => {
  console.error('LOCAL-DATA MIGRATION RUN CRASHED:', err?.stack || err);
  process.exitCode = 1;
});
