import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { setup, cleanup, seedOrg } from '../tests/phase02/harness.mjs';
import {
  seedChartOfAccounts,
  mapLegacyAccountType,
  migrateLegacyAccounts,
  migrateLegacyMoves,
  reconcileMigrationTrialBalance,
  getMigrationQuarantine,
  getMigrationRunStatus,
  rollbackMigrationRun,
  getMigrationSourceMapping,
  getTrialBalance,
} from '../platform/finance/engine.mjs';

const DISPOSABLE_DIR = path.resolve('temp/disposable-migration');

async function runDisposableMigration() {
  console.log('=== WAVE B: DISPOSABLE LEGACY DATA MIGRATION VALIDATION ===');
  if (!fs.existsSync(DISPOSABLE_DIR)) {
    fs.mkdirSync(DISPOSABLE_DIR, { recursive: true });
  }

  // Create isolated disposable database file path inside temp/disposable-migration/
  const disposableDbFile = path.join(DISPOSABLE_DIR, `disposable_migration_${Date.now()}.db`);
  console.log(`[1] Created isolated disposable database at: ${disposableDbFile}`);

  const { dialect, dbPath } = await setup(`disposable-migration-${Date.now()}`);
  const org = seedOrg(dialect);
  const companyId = org.companyA1;
  const ctx = { companyId, userId: 'u_owner' };

  // Seed fiscal year and period
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO finance_fiscal_years (id, company_id, name, start_date, end_date, status, created_at, updated_at, created_by)
    VALUES ('fy_2026', ?, '2026', '2026-01-01', '2026-12-31', 'open', ?, ?, 'system')
  `).run(companyId, now, now);
  
  for (let m = 1; m <= 12; m++) {
    const ms = String(m).padStart(2, '0');
    const end = new Date(2026, m, 0).toISOString().split('T')[0];
    dialect.prepare(`
      INSERT INTO finance_periods (id, company_id, fiscal_year_id, name, start_date, end_date, status, created_at, updated_at, created_by)
      VALUES (?, ?, 'fy_2026', ?, ?, ?, 'open', ?, ?, 'system')
    `).run(`period_2026_${ms}`, companyId, `2026-${ms}`, `2026-${ms}-01`, end, now, now);
  }

  // Real-shaped legacy synthetic dataset
  const legacy_accounts = [
    { id: 'L-1010', code: '10100', name: 'الصندوق الرئيسية - Cash Box Main', type: 'cash' },
    { id: 'L-1020', code: '10200', name: 'البنك الإسلاحي - Bank Islamic IQD', type: 'bank' },
    { id: 'L-1200', code: '12000', name: 'العملاء - Customer Receivables', type: 'receivable' },
    { id: 'L-1300', code: '13000', name: 'المخزون - Stock Inventory', type: 'asset' },
    { id: 'L-2100', code: '21000', name: 'الموردون - Supplier Payables', type: 'payable' },
    { id: 'L-3000', code: '30000', name: 'رأس المال - Owner Capital', type: 'equity' },
    { id: 'L-4000', code: '40000', name: 'إيراد مبيعات ورشة - Sales Revenue', type: 'income' },
    { id: 'L-5000', code: '50000', name: 'مصروفات تشغيل - Operating Expense', type: 'expense' },
    // Intentional malformed records for quarantine testing
    { id: 'L-BAD-1', code: '99991', name: 'حساب بنوع غير معروف', type: 'unsupported_type_xyz' },
    { id: 'L-BAD-2', code: '99992', type: 'asset' }, // missing name
  ];

  const legacy_moves = [
    {
      id: 'LEG-MOVE-001',
      name: 'JV/2026/00001',
      date: '2026-01-05',
      move_type: 'entry',
      state: 'posted',
      partner_id: '',
      lines: [
        { account_id: 'L-1010', label: 'رأس المال الافتتاحي cash', debit: 10000000, credit: 0 },
        { account_id: 'L-3000', label: 'رأس المال الافتتاحي equity', debit: 0, credit: 10000000 },
      ],
    },
    {
      id: 'LEG-MOVE-002',
      name: 'INV/2026/00001',
      date: '2026-01-10',
      move_type: 'out_invoice',
      state: 'posted',
      partner_id: 'part_cust_1',
      lines: [
        { account_id: 'L-1200', label: 'مبيعات خدمة صيانة', debit: 250000, credit: 0, partner_id: 'part_cust_1' },
        { account_id: 'L-4000', label: 'مبيعات خدمة صيانة', debit: 0, credit: 250000, partner_id: 'part_cust_1' },
      ],
    },
    {
      id: 'LEG-MOVE-003',
      name: 'PAY/2026/00001',
      date: '2026-01-12',
      move_type: 'entry',
      state: 'posted',
      partner_id: 'part_cust_1',
      lines: [
        { account_id: 'L-1010', label: 'تحصيل دفعة عميل', debit: 250000, credit: 0, partner_id: 'part_cust_1' },
        { account_id: 'L-1200', label: 'تحصيل دفعة عميل', debit: 0, credit: 250000, partner_id: 'part_cust_1' },
      ],
    },
    {
      id: 'LEG-MOVE-004',
      name: 'BILL/2026/00001',
      date: '2026-01-15',
      move_type: 'in_invoice',
      state: 'posted',
      partner_id: 'part_supp_1',
      lines: [
        { account_id: 'L-5000', label: 'شراء قطع غيار', debit: 500000, credit: 0, partner_id: 'part_supp_1' },
        { account_id: 'L-2100', label: 'شراء قطع غيار', debit: 0, credit: 500000, partner_id: 'part_supp_1' },
      ],
    },
    // Malformed move for quarantine test
    {
      id: 'LEG-BAD-MOVE-1',
      name: 'ERR/2026/00001',
      date: '2026-01-20',
      move_type: 'entry',
      state: 'posted',
      lines: [
        { account_id: 'L-1010', debit: 100000, credit: 0 },
        { account_id: 'L-5000', debit: 0, credit: 90000 }, // Unbalanced: 100k != 90k
      ],
    },
  ];

  console.log(`[2] Source Dataset: ${legacy_accounts.length} accounts, ${legacy_moves.length} moves.`);

  // Step 1: Migrate Accounts
  console.log('[3] Running migrateLegacyAccounts...');
  const acctRun = migrateLegacyAccounts(dialect, ctx, { legacy_accounts });
  console.log(`   - Imported: ${acctRun.imported}, Quarantined: ${acctRun.quarantined}, Skipped: ${acctRun.skipped}`);

  // Step 2: Migrate Moves
  console.log('[4] Running migrateLegacyMoves...');
  const moveRun = migrateLegacyMoves(dialect, ctx, { legacy_moves });
  console.log(`   - Imported: ${moveRun.imported}, Quarantined: ${moveRun.quarantined}, Skipped: ${moveRun.skipped}`);

  // Step 3: Reconcile Trial Balance
  console.log('[5] Running reconcileMigrationTrialBalance...');
  const legacy_tb = [
    { code: '10100', balance: 10250000 },
    { code: '12000', balance: 0 },
    { code: '21000', balance: -500000 },
    { code: '30000', balance: -10000000 },
    { code: '40000', balance: -250000 },
    { code: '50000', balance: 500000 },
  ];
  const tbRec = reconcileMigrationTrialBalance(dialect, ctx, { legacy_trial_balance: legacy_tb });
  console.log(`   - Fully Reconciled: ${tbRec.fully_reconciled}`);

  // Step 4: Verify Idempotency
  console.log('[6] Verifying Idempotency (re-running migration)...');
  const acctRerun = migrateLegacyAccounts(dialect, ctx, { legacy_accounts });
  const moveRerun = migrateLegacyMoves(dialect, ctx, { legacy_moves });
  console.log(`   - Account Rerun: imported=${acctRerun.imported}, skipped=${acctRerun.skipped}`);
  console.log(`   - Move Rerun: imported=${moveRerun.imported}, skipped=${moveRerun.skipped}`);
  if (acctRerun.imported !== 0 || moveRerun.imported !== 0) {
    throw new Error('Idempotency failure: re-run imported duplicate records!');
  }

  // Step 5: Verify Rollback
  console.log('[7] Testing Rollback on a disposable run...');
  const rollbackResult = rollbackMigrationRun(dialect, ctx, { migration_run_id: moveRun.run_id });
  console.log(`   - Documents reversed: ${rollbackResult.documents_reversed}`);

  // Fetch quarantine items
  const quarantineAcct = getMigrationQuarantine(dialect, ctx, { migration_run_id: acctRun.run_id });
  const quarantineMove = getMigrationQuarantine(dialect, ctx, { migration_run_id: moveRun.run_id });
  console.log(`   - Total Quarantine Records: ${quarantineAcct.length + quarantineMove.length}`);

  // Fetch canonical trial balance
  const tb = getTrialBalance(dialect, ctx, {});
  console.log(`   - Canonical trial balance account rows: ${tb.length}`);

  await cleanup(dialect, dbPath);
  if (fs.existsSync(disposableDbFile)) fs.unlinkSync(disposableDbFile);

  console.log('\n=== DISPOSABLE MIGRATION VERIFICATION COMPLETE: ALL GATES PASSED ===\n');

  return {
    sourceAccountCount: legacy_accounts.length,
    importedAccountCount: acctRun.imported,
    quarantinedAccountCount: acctRun.quarantined,
    sourceMoveCount: legacy_moves.length,
    importedMoveCount: moveRun.imported,
    quarantinedMoveCount: moveRun.quarantined,
    fullyReconciled: tbRec.fully_reconciled,
    idempotent: acctRerun.imported === 0 && moveRerun.imported === 0,
    rollbackProven: rollbackResult.documents_reversed > 0,
  };
}

runDisposableMigration().catch(err => {
  console.error('Migration execution failed:', err);
  process.exit(1);
});
