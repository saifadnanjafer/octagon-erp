// Finance migrator — Checkpoint I5E.
//
// Governed merge and migration of Chart of Accounts, Journals, and 568 account_moves
// into canonical Finance tables (finance_documents, finance_journal_entries, finance_journal_lines).

'use strict';

import crypto from 'node:crypto';
import { recordLineage } from './lineage.mjs';
import { quarantineRecord } from './quarantine.mjs';
import { updateDomainProgress } from './batch-engine.mjs';
import { validateFinanceEquivalence } from './finance-equivalence.mjs';

export function migrateFinance(dialect, batchId, { actor = 'system', companyId = 'co_1781973993479_57h1z8' } = {}) {
  if (!batchId) throw new TypeError('migrateFinance requires batchId');

  // Run equivalence validation first
  const eq = validateFinanceEquivalence(dialect, batchId);
  if (eq.status !== 'exact' || eq.materialMismatches > 0) {
    throw new Error(`Finance migration refused: equivalence validation status is '${eq.status}' with ${eq.materialMismatches} material mismatches`);
  }

  const now = new Date().toISOString();
  let migratedMovesCount = 0;
  let mergedAccountsCount = 0;
  let mergedJournalsCount = 0;
  let quarantinedCount = 0;

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    // -----------------------------------------------------------------------
    // 1. Chart of Accounts Merge (34 legacy accounts)
    // -----------------------------------------------------------------------
    const legacyAccounts = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'finance.accounts\'').all();
    for (const la of legacyAccounts) {
      let data = {};
      try { data = JSON.parse(la.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(la.data).digest('hex');

      const code = data.code || la.id;
      const type = (data.type || 'asset').toLowerCase();
      const normalBalance = ['asset', 'expense'].includes(type) ? 'debit' : 'credit';

      dialect.prepare(`
        INSERT INTO finance_accounts (
          id, company_id, code, name, name_ar, type, normal_balance, is_reconcilable,
          is_active, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          name_ar = excluded.name_ar,
          type = excluded.type,
          updated_at = excluded.updated_at
      `).run(la.id, companyId, code, data.name || la.id, data.nameAr || data.name || la.id, type, normalBalance, data.is_reconcilable ? 1 : 0, now, now, actor);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'finance.accounts', sourceId: la.id, sourceHash: hash,
        destinationAuthority: 'FINANCE', destinationTable: 'finance_accounts', destinationId: la.id,
        actor
      });
      mergedAccountsCount++;
    }

    // -----------------------------------------------------------------------
    // 2. Journals Merge (5 legacy journals)
    // -----------------------------------------------------------------------
    const legacyJournals = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'journals\'').all();
    for (const lj of legacyJournals) {
      let data = {};
      try { data = JSON.parse(lj.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(lj.data).digest('hex');

      const code = data.code || lj.id;
      const type = data.type || 'general';

      dialect.prepare(`
        INSERT INTO finance_journals (
          id, company_id, code, name, type, is_active, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          updated_at = excluded.updated_at
      `).run(lj.id, companyId, code, data.name || lj.id, type, now, now, actor);

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'journals', sourceId: lj.id, sourceHash: hash,
        destinationAuthority: 'FINANCE', destinationTable: 'finance_journals', destinationId: lj.id,
        actor
      });
      mergedJournalsCount++;
    }

    // -----------------------------------------------------------------------
    // 3. Migrate 568 account_moves -> finance_documents, finance_document_lines, finance_journal_entries & lines
    // -----------------------------------------------------------------------
    const moves = dialect.prepare('SELECT collection, id, data FROM collections WHERE collection = \'account_moves\' ORDER BY id').all();
    for (const m of moves) {
      let data = {};
      try { data = JSON.parse(m.data); } catch (_) {}
      const hash = crypto.createHash('sha256').update(m.data).digest('hex');

      const lines = data.line_ids || data.lines || [];
      let totalDebit = 0;
      let totalCredit = 0;
      for (const l of lines) {
        totalDebit += (l.debit || 0);
        totalCredit += (l.credit || 0);
      }

      // Check balance invariant
      if (Math.abs(totalDebit - totalCredit) > 0.001) {
        quarantineRecord(dialect, {
          batchId, companyId, sourceCollection: 'account_moves', sourceId: m.id, sourceHash: hash,
          sourcePayload: m.data, domain: 'FINANCE', reasonCode: 'unbalanced_journal_entry',
          reasonDetail: `Account move ${m.id} is unbalanced: debit=${totalDebit}, credit=${totalCredit}`
        });
        quarantinedCount++;
        continue;
      }

      const journalId = data.journal_id || 'j_general';
      const docState = data.state === 'cancel' ? 'cancelled' : (data.state || 'posted');

      // 3a. Insert finance_documents header
      dialect.prepare(`
        INSERT INTO finance_documents (
          id, company_id, journal_id, doc_number, move_type, doc_date, post_date,
          currency, state, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IQD', ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(
        m.id, companyId, journalId, data.name || m.id, data.move_type || 'entry',
        data.date || now.substring(0, 10), data.posted_at || data.date || now.substring(0, 10),
        docState, data.created_at || now, now, data.created_by || actor
      );

      // 3b. Insert finance_journal_entries
      dialect.prepare(`
        INSERT INTO finance_journal_entries (
          id, document_id, company_id, journal_id, entry_number, posting_date,
          currency, total_debit, total_credit, hash, prev_hash, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'IQD', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(
        m.id, m.id, companyId, journalId, data.name || m.id, data.date || now.substring(0, 10),
        totalDebit, totalCredit, data.hash || hash, data.prev_hash || data.previous_hash || null,
        data.created_at || now, data.created_by || actor
      );

      // 3c. Insert document lines and journal lines
      for (let idx = 0; idx < lines.length; idx++) {
        const l = lines[idx];
        const lineId = l.id || `fjl_${m.id}_${idx}`;
        const docLineId = `fdl_${m.id}_${idx}`;

        // Ensure account exists or fallback
        const accountId = l.account_id || 'unassigned_account';
        const accountExists = dialect.prepare('SELECT 1 FROM finance_accounts WHERE id = ?').get(accountId);
        if (!accountExists) {
          dialect.prepare(`
            INSERT INTO finance_accounts (id, company_id, code, name, name_ar, type, normal_balance, is_active, created_at, updated_at, created_by)
            VALUES (?, ?, ?, ?, ?, 'asset', 'debit', 1, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
          `).run(accountId, companyId, accountId, accountId, accountId, now, now, actor);
        }

        // Insert finance_document_lines
        dialect.prepare(`
          INSERT INTO finance_document_lines (
            id, document_id, company_id, account_id, debit, credit, currency_code,
            partner_id, description, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 'IQD', ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(
          docLineId, m.id, companyId, accountId, l.debit || 0, l.credit || 0,
          l.partner_id || null, l.label || null, now, actor
        );

        // Insert finance_journal_lines
        dialect.prepare(`
          INSERT INTO finance_journal_lines (
            id, journal_entry_id, company_id, document_id, document_line_id,
            account_id, posting_date, debit, credit, currency_code, partner_id,
            description, created_at, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'IQD', ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(
          lineId, m.id, companyId, m.id, docLineId, accountId, data.date || now.substring(0, 10),
          l.debit || 0, l.credit || 0, l.partner_id || null, l.label || null, now, actor
        );
      }

      recordLineage(dialect, {
        batchId, companyId, sourceCollection: 'account_moves', sourceId: m.id, sourceHash: hash,
        destinationAuthority: 'FINANCE', destinationTable: 'finance_journal_entries', destinationId: m.id,
        actor
      });
      migratedMovesCount++;
    }

    // Update batch domain progress for FINANCE
    updateDomainProgress(dialect, batchId, 'FINANCE', {
      state: 'reconciled',
      migrated_count: migratedMovesCount,
      merged_count: mergedAccountsCount + mergedJournalsCount,
      quarantined_count: quarantinedCount,
      skipped_count: eq.validationCount, // journal_entries skipped as validation-only
    });

    dialect.exec('COMMIT;');

    return {
      domain: 'FINANCE',
      migratedMovesCount,
      mergedAccountsCount,
      mergedJournalsCount,
      quarantinedCount,
      skippedValidationEntries: eq.validationCount,
    };
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }
}
