// BUILD-08 isolated financial-consolidation projection ledger.
'use strict';

import crypto from 'node:crypto';
import { IntercompanyError } from '../intercompany/operations.mjs';

const id = (p) => `${p}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (v) => Number(v || 0);
const round = (v) => Number(n(v).toFixed(4));
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export class ConsolidationService {
  constructor(dialect) { this.db = dialect; }

  createGroup(input, ctx = {}) {
    const parent = input.parentCompanyId || ctx.companyId;
    if (!parent || parent !== (ctx.companyId || ctx.activeCompanyId) || !input.name) throw new IntercompanyError('Parent company context and name are required', 'CONSOLIDATION_PARENT_REQUIRED', 403);
    const groupId = id('cg');
    this.db.prepare(`INSERT INTO consolidation_groups_v2(id,parent_company_id,name,reporting_currency,status,created_by,created_at) VALUES(?,?,?,?,'active',?,?)`).run(groupId, parent, input.name, input.reportingCurrency || 'IQD', ctx.userId || ctx.actorId || 'system', now());
    this.setTranslationPolicy(groupId, 'asset', 'closing', ctx);
    this.setTranslationPolicy(groupId, 'liability', 'closing', ctx);
    this.setTranslationPolicy(groupId, 'equity', 'historical', ctx);
    this.setTranslationPolicy(groupId, 'income', 'average', ctx);
    this.setTranslationPolicy(groupId, 'expense', 'average', ctx);
    return this.getGroup(groupId, ctx);
  }

  getGroup(groupId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM consolidation_groups_v2 WHERE id=?').get(groupId);
    if (!row) return null;
    this.#assertParent(row.parent_company_id, ctx);
    const members = this.db.prepare('SELECT * FROM consolidation_members_v2 WHERE group_id=? ORDER BY company_id').all(groupId).map((m) => ({ id: m.id, companyId: m.company_id, ownershipPercentage: n(m.ownership_percentage), consolidationMethod: m.consolidation_method, effectiveFrom: m.effective_from, effectiveTo: m.effective_to, status: m.status }));
    return { id: row.id, parentCompanyId: row.parent_company_id, name: row.name, reportingCurrency: row.reporting_currency, status: row.status, members };
  }

  addMember(groupId, input, ctx = {}) {
    const group = this.getGroup(groupId, ctx);
    if (!group || !input.companyId || n(input.ownershipPercentage) < 0 || n(input.ownershipPercentage) > 100) throw new IntercompanyError('Valid member and ownership are required', 'INVALID_CONSOLIDATION_MEMBER');
    this.db.prepare(`INSERT INTO consolidation_members_v2(id,group_id,company_id,ownership_percentage,consolidation_method,effective_from,effective_to,status) VALUES(?,?,?,?,?,?,?,'active')`).run(id('cgm'), groupId, input.companyId, n(input.ownershipPercentage), input.consolidationMethod || 'full', input.effectiveFrom || now().slice(0, 10), input.effectiveTo || null);
    return this.getGroup(groupId, ctx);
  }

  upsertMapping(groupId, input, ctx = {}) {
    this.getGroup(groupId, ctx);
    if (!input.companyId || !input.sourceAccountCode || !input.targetAccountCode || !input.targetAccountName || !['asset', 'liability', 'equity', 'income', 'expense'].includes(input.statementType)) throw new IntercompanyError('Complete account mapping is required', 'INVALID_ACCOUNT_MAPPING');
    const existing = this.db.prepare('SELECT id FROM consolidation_account_mappings_v2 WHERE group_id=? AND company_id=? AND source_account_code=?').get(groupId, input.companyId, input.sourceAccountCode);
    const mappingId = existing?.id || id('cam');
    this.db.prepare(`INSERT INTO consolidation_account_mappings_v2(id,group_id,company_id,source_account_code,target_account_code,target_account_name,statement_type,intercompany_flag,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id,company_id,source_account_code) DO UPDATE SET target_account_code=excluded.target_account_code,target_account_name=excluded.target_account_name,statement_type=excluded.statement_type,intercompany_flag=excluded.intercompany_flag`).run(mappingId, groupId, input.companyId, input.sourceAccountCode, input.targetAccountCode, input.targetAccountName, input.statementType, input.intercompanyFlag ? 1 : 0, now());
    return { id: mappingId, groupId, ...input };
  }

  setTranslationPolicy(groupId, statementType, rateType, ctx = {}) {
    this.getGroup(groupId, ctx);
    const existing = this.db.prepare('SELECT id FROM consolidation_translation_policies_v2 WHERE group_id=? AND statement_type=?').get(groupId, statementType);
    const policyId = existing?.id || id('ctp');
    this.db.prepare(`INSERT INTO consolidation_translation_policies_v2(id,group_id,statement_type,rate_type,created_at) VALUES(?,?,?,?,?) ON CONFLICT(group_id,statement_type) DO UPDATE SET rate_type=excluded.rate_type`).run(policyId, groupId, statementType, rateType, now());
    return { id: policyId, groupId, statementType, rateType };
  }

  createPeriod(groupId, input, ctx = {}) {
    this.getGroup(groupId, ctx);
    if (!input.periodName || !input.startDate || !input.endDate) throw new IntercompanyError('Period identity and dates are required', 'INVALID_CONSOLIDATION_PERIOD');
    const periodId = id('cp');
    this.db.prepare(`INSERT INTO consolidation_periods_v2(id,group_id,period_name,start_date,end_date,closing_rate_json,average_rate_json,historical_rate_json,status,created_at) VALUES(?,?,?,?,?,?,?,?, 'open',?)`).run(periodId, groupId, input.periodName, input.startDate, input.endDate, JSON.stringify(input.closingRates || {}), JSON.stringify(input.averageRates || {}), JSON.stringify(input.historicalRates || {}), now());
    return this.getPeriod(periodId, ctx);
  }

  getPeriod(periodId, ctx = {}) {
    const row = this.db.prepare(`SELECT p.*,g.parent_company_id FROM consolidation_periods_v2 p JOIN consolidation_groups_v2 g ON g.id=p.group_id WHERE p.id=?`).get(periodId);
    if (!row) return null;
    this.#assertParent(row.parent_company_id, ctx);
    return { id: row.id, groupId: row.group_id, periodName: row.period_name, startDate: row.start_date, endDate: row.end_date, closingRates: JSON.parse(row.closing_rate_json || '{}'), averageRates: JSON.parse(row.average_rate_json || '{}'), historicalRates: JSON.parse(row.historical_rate_json || '{}'), status: row.status };
  }

  captureTrialBalance(periodId, input, ctx = {}) {
    const period = this.getPeriod(periodId, ctx);
    if (!period || period.status !== 'open') throw new IntercompanyError('Open period required', 'CONSOLIDATION_PERIOD_LOCKED', 409);
    const member = this.db.prepare('SELECT 1 FROM consolidation_members_v2 WHERE group_id=? AND company_id=? AND status=\'active\'').get(period.groupId, input.companyId);
    if (!member || !Array.isArray(input.lines) || !input.lines.length) throw new IntercompanyError('Active member trial balance lines required', 'INVALID_TRIAL_BALANCE');
    const debit = round(input.lines.reduce((sum, line) => sum + n(line.debit), 0));
    const credit = round(input.lines.reduce((sum, line) => sum + n(line.credit), 0));
    if (Math.abs(debit - credit) > 0.01) throw new IntercompanyError('Trial balance is not balanced', 'UNBALANCED_TRIAL_BALANCE');
    const snapshotId = id('ctb');
    this.db.prepare(`INSERT INTO consolidation_tb_snapshots_v2(id,period_id,company_id,source_currency,source_digest,debit_total,credit_total,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,'validated',?,?)`).run(snapshotId, periodId, input.companyId, input.sourceCurrency || 'IQD', digest(input.lines), debit, credit, ctx.userId || ctx.actorId || 'system', now());
    const insert = this.db.prepare('INSERT INTO consolidation_tb_lines_v2(id,snapshot_id,source_account_code,debit,credit,counterparty_company_id,reference) VALUES(?,?,?,?,?,?,?)');
    input.lines.forEach((line) => insert.run(id('ctbl'), snapshotId, line.accountCode, n(line.debit), n(line.credit), line.counterpartyCompanyId || null, line.reference || null));
    return { id: snapshotId, periodId, companyId: input.companyId, debitTotal: debit, creditTotal: credit, status: 'validated' };
  }

  calculateRun(groupId, periodId, ctx = {}) {
    const group = this.getGroup(groupId, ctx); const period = this.getPeriod(periodId, ctx);
    if (!group || period.groupId !== groupId || period.status !== 'open') throw new IntercompanyError('Open owned consolidation period required', 'INVALID_CONSOLIDATION_RUN');
    const snapshots = this.db.prepare('SELECT * FROM consolidation_tb_snapshots_v2 WHERE period_id=? AND status=\'validated\' ORDER BY company_id').all(periodId);
    const missing = group.members.filter((member) => member.status === 'active' && !snapshots.some((snapshot) => snapshot.company_id === member.companyId));
    if (missing.length) throw new IntercompanyError(`Missing trial balances: ${missing.map((m) => m.companyId).join(',')}`, 'MISSING_TRIAL_BALANCE', 409);
    const versionRow = this.db.prepare('SELECT MAX(version) AS version FROM consolidation_runs_v2 WHERE group_id=? AND period_id=?').get(groupId, periodId);
    const runId = id('cr');
    this.db.prepare(`INSERT INTO consolidation_runs_v2(id,group_id,period_id,version,status,validation_json,created_by,created_at) VALUES(?,?,?,?,'review',?,?,?)`).run(runId, groupId, periodId, n(versionRow?.version) + 1, JSON.stringify({ snapshots: snapshots.length, balanced: true }), ctx.userId || ctx.actorId || 'system', now());
    const totals = new Map();
    for (const snapshot of snapshots) {
      const member = group.members.find((m) => m.companyId === snapshot.company_id);
      const lines = this.db.prepare('SELECT * FROM consolidation_tb_lines_v2 WHERE snapshot_id=?').all(snapshot.id);
      for (const line of lines) {
        const mapping = this.db.prepare('SELECT * FROM consolidation_account_mappings_v2 WHERE group_id=? AND company_id=? AND source_account_code=?').get(groupId, snapshot.company_id, line.source_account_code);
        if (!mapping) throw new IntercompanyError(`Missing account mapping ${snapshot.company_id}:${line.source_account_code}`, 'MISSING_ACCOUNT_MAPPING', 409);
        const policy = this.db.prepare('SELECT rate_type FROM consolidation_translation_policies_v2 WHERE group_id=? AND statement_type=?').get(groupId, mapping.statement_type);
        const rates = policy.rate_type === 'average' ? period.averageRates : policy.rate_type === 'historical' ? period.historicalRates : period.closingRates;
        const rate = n(rates[snapshot.source_currency] || (snapshot.source_currency === group.reportingCurrency ? 1 : 0));
        if (rate <= 0) throw new IntercompanyError(`Missing ${policy.rate_type} rate for ${snapshot.source_currency}`, 'MISSING_TRANSLATION_RATE', 409);
        const ownership = member.consolidationMethod === 'full' ? 1 : member.ownershipPercentage / 100;
        const debit = round(line.debit * rate * ownership); const credit = round(line.credit * rate * ownership);
        const current = totals.get(mapping.target_account_code) || { name: mapping.target_account_name, type: mapping.statement_type, debit: 0, credit: 0, contributions: [] };
        current.debit = round(current.debit + debit); current.credit = round(current.credit + credit);
        current.contributions.push({ snapshotId: snapshot.id, lineId: line.id, amount: round(debit - credit) });
        totals.set(mapping.target_account_code, current);
      }
    }
    this.#proposeIntercompanyEliminations(runId, snapshots, groupId);
    const insertBalance = this.db.prepare(`INSERT INTO consolidation_balances_v2(id,run_id,target_account_code,target_account_name,statement_type,translated_debit,translated_credit,consolidated_balance) VALUES(?,?,?,?,?,?,?,?)`);
    const lineage = this.db.prepare(`INSERT INTO consolidation_lineage_v2(id,run_id,balance_id,snapshot_id,source_line_id,contribution_amount,lineage_type,created_at) VALUES(?,?,?,?,?,?, 'translation',?)`);
    for (const [code, total] of totals) {
      const balanceId = id('cb'); insertBalance.run(balanceId, runId, code, total.name, total.type, total.debit, total.credit, round(total.debit - total.credit));
      total.contributions.forEach((item) => lineage.run(id('clin'), runId, balanceId, item.snapshotId, item.lineId, item.amount, now()));
    }
    this.db.prepare("UPDATE consolidation_periods_v2 SET status='review' WHERE id=?").run(periodId);
    return this.getRun(runId, ctx);
  }

  approveElimination(eliminationId, ctx = {}) {
    const row = this.db.prepare(`SELECT e.*,g.parent_company_id FROM consolidation_eliminations_v2 e JOIN consolidation_runs_v2 r ON r.id=e.run_id JOIN consolidation_groups_v2 g ON g.id=r.group_id WHERE e.id=?`).get(eliminationId);
    if (!row) throw new IntercompanyError('Elimination not found', 'ELIMINATION_NOT_FOUND', 404);
    this.#assertParent(row.parent_company_id, ctx);
    this.db.prepare("UPDATE consolidation_eliminations_v2 SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), eliminationId);
    return { id: row.id, runId: row.run_id, status: 'approved' };
  }

  addAdjustment(runId, input, ctx = {}) {
    this.getRun(runId, ctx);
    if (!input.targetAccountCode || Math.abs(n(input.debit) - n(input.credit)) < 0.0001 || !input.reason) throw new IntercompanyError('Adjustment account, one-sided amount and reason are required', 'INVALID_CONSOLIDATION_ADJUSTMENT');
    const adjustmentId = id('cadj');
    this.db.prepare(`INSERT INTO consolidation_adjustments_v2(id,run_id,target_account_code,debit,credit,reason,status,created_at) VALUES(?,?,?,?,?,?,'proposed',?)`).run(adjustmentId, runId, input.targetAccountCode, n(input.debit), n(input.credit), input.reason, now());
    return { id: adjustmentId, runId, status: 'proposed' };
  }

  approveAdjustment(adjustmentId, ctx = {}) {
    const row = this.db.prepare(`SELECT a.*,g.parent_company_id FROM consolidation_adjustments_v2 a JOIN consolidation_runs_v2 r ON r.id=a.run_id JOIN consolidation_groups_v2 g ON g.id=r.group_id WHERE a.id=?`).get(adjustmentId);
    if (!row) throw new IntercompanyError('Adjustment not found', 'ADJUSTMENT_NOT_FOUND', 404);
    this.#assertParent(row.parent_company_id, ctx);
    this.db.prepare("UPDATE consolidation_adjustments_v2 SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), adjustmentId);
    return { id: row.id, runId: row.run_id, status: 'approved' };
  }

  finalize(runId, ctx = {}) {
    const run = this.getRun(runId, ctx);
    if (!run || run.status !== 'review') throw new IntercompanyError('Review run required', 'CONSOLIDATION_NOT_REVIEWABLE', 409);
    const pendingEliminations = this.db.prepare("SELECT COUNT(*) AS count FROM consolidation_eliminations_v2 WHERE run_id=? AND status='proposed'").get(runId).count;
    const pendingAdjustments = this.db.prepare("SELECT COUNT(*) AS count FROM consolidation_adjustments_v2 WHERE run_id=? AND status='proposed'").get(runId).count;
    if (pendingEliminations || pendingAdjustments) throw new IntercompanyError('All eliminations and adjustments require approval', 'CONSOLIDATION_APPROVALS_PENDING', 409);
    const eliminations = this.db.prepare("SELECT * FROM consolidation_eliminations_v2 WHERE run_id=? AND status='approved'").all(runId);
    const adjustments = this.db.prepare("SELECT * FROM consolidation_adjustments_v2 WHERE run_id=? AND status='approved'").all(runId);
    for (const elimination of eliminations) this.#applyProjection(runId, elimination.target_account_code, elimination.debit, elimination.credit, 'elimination', elimination.id);
    for (const adjustment of adjustments) this.#applyProjection(runId, adjustment.target_account_code, adjustment.debit, adjustment.credit, 'adjustment', adjustment.id);
    this.db.prepare("UPDATE consolidation_runs_v2 SET status='locked',finalized_by=?,finalized_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), runId);
    this.db.prepare("UPDATE consolidation_periods_v2 SET status='locked' WHERE id=?").run(run.periodId);
    this.db.prepare("UPDATE consolidation_tb_snapshots_v2 SET status='locked' WHERE period_id=?").run(run.periodId);
    return this.getRun(runId, ctx);
  }

  getRun(runId, ctx = {}) {
    const row = this.db.prepare(`SELECT r.*,g.parent_company_id FROM consolidation_runs_v2 r JOIN consolidation_groups_v2 g ON g.id=r.group_id WHERE r.id=?`).get(runId);
    if (!row) return null;
    this.#assertParent(row.parent_company_id, ctx);
    const eliminations = this.db.prepare('SELECT * FROM consolidation_eliminations_v2 WHERE run_id=? ORDER BY created_at').all(runId).map((e) => ({ id: e.id, eliminationType: e.elimination_type, sourceCompanyId: e.source_company_id, targetCompanyId: e.target_company_id, targetAccountCode: e.target_account_code, debit: n(e.debit), credit: n(e.credit), reference: e.reference, status: e.status }));
    const balances = this.db.prepare('SELECT * FROM consolidation_balances_v2 WHERE run_id=? ORDER BY target_account_code').all(runId).map((b) => ({ id: b.id, targetAccountCode: b.target_account_code, targetAccountName: b.target_account_name, statementType: b.statement_type, translatedDebit: n(b.translated_debit), translatedCredit: n(b.translated_credit), eliminationDebit: n(b.elimination_debit), eliminationCredit: n(b.elimination_credit), adjustmentDebit: n(b.adjustment_debit), adjustmentCredit: n(b.adjustment_credit), consolidatedBalance: n(b.consolidated_balance) }));
    return { id: row.id, groupId: row.group_id, periodId: row.period_id, version: row.version, status: row.status, validation: JSON.parse(row.validation_json || '{}'), eliminations, balances };
  }

  reports(runId, ctx = {}) {
    const run = this.getRun(runId, ctx);
    if (!run) throw new IntercompanyError('Run not found', 'CONSOLIDATION_RUN_NOT_FOUND', 404);
    const byType = (types) => run.balances.filter((b) => types.includes(b.statementType));
    const sum = (lines) => round(lines.reduce((total, line) => total + line.consolidatedBalance, 0));
    const profitLoss = byType(['income', 'expense']); const balanceSheet = byType(['asset', 'liability', 'equity']);
    const eliminations = this.db.prepare('SELECT * FROM consolidation_eliminations_v2 WHERE run_id=? ORDER BY target_account_code').all(runId);
    const lineage = this.db.prepare('SELECT * FROM consolidation_lineage_v2 WHERE run_id=? ORDER BY balance_id,created_at').all(runId);
    return { runId, status: run.status, trialBalance: run.balances, profitAndLoss: { lines: profitLoss, net: sum(profitLoss) }, balanceSheet: { lines: balanceSheet, net: sum(balanceSheet) }, eliminationReport: eliminations, translationReport: run.balances.map((b) => ({ account: b.targetAccountCode, translatedDebit: b.translatedDebit, translatedCredit: b.translatedCredit })), lineage };
  }

  #proposeIntercompanyEliminations(runId, snapshots, groupId) {
    const candidates = [];
    for (const snapshot of snapshots) {
      const lines = this.db.prepare('SELECT * FROM consolidation_tb_lines_v2 WHERE snapshot_id=? AND counterparty_company_id IS NOT NULL').all(snapshot.id);
      for (const line of lines) {
        const mapping = this.db.prepare('SELECT * FROM consolidation_account_mappings_v2 WHERE group_id=? AND company_id=? AND source_account_code=? AND intercompany_flag=1').get(groupId, snapshot.company_id, line.source_account_code);
        if (mapping) candidates.push({ ...line, companyId: snapshot.company_id, mapping });
      }
    }
    const insert = this.db.prepare(`INSERT INTO consolidation_eliminations_v2(id,run_id,elimination_type,source_company_id,target_company_id,target_account_code,debit,credit,reference,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'proposed',?)`);
    const seen = new Set();
    for (const line of candidates) {
      const key = [line.companyId, line.counterparty_company_id, line.reference].sort().join('|');
      if (seen.has(key)) continue;
      const reciprocal = candidates.find((other) => other.companyId === line.counterparty_company_id && other.counterparty_company_id === line.companyId && other.reference === line.reference);
      if (!reciprocal) continue;
      seen.add(key);
      const amount = Math.min(Math.abs(n(line.debit) - n(line.credit)), Math.abs(n(reciprocal.debit) - n(reciprocal.credit)));
      insert.run(id('ce'), runId, 'intercompany_match', line.companyId, reciprocal.companyId, line.mapping.target_account_code, line.credit > line.debit ? amount : 0, line.debit > line.credit ? amount : 0, line.reference, now());
    }
  }

  #applyProjection(runId, code, debit, credit, type, sourceId) {
    const balance = this.db.prepare('SELECT * FROM consolidation_balances_v2 WHERE run_id=? AND target_account_code=?').get(runId, code);
    if (!balance) throw new IntercompanyError(`Projection account ${code} is missing`, 'CONSOLIDATION_ACCOUNT_MISSING', 409);
    const d = n(debit), c = n(credit);
    if (type === 'elimination') this.db.prepare('UPDATE consolidation_balances_v2 SET elimination_debit=elimination_debit+?,elimination_credit=elimination_credit+?,consolidated_balance=consolidated_balance+?-? WHERE id=?').run(d, c, d, c, balance.id);
    else this.db.prepare('UPDATE consolidation_balances_v2 SET adjustment_debit=adjustment_debit+?,adjustment_credit=adjustment_credit+?,consolidated_balance=consolidated_balance+?-? WHERE id=?').run(d, c, d, c, balance.id);
    this.db.prepare(`INSERT INTO consolidation_lineage_v2(id,run_id,balance_id,${type === 'elimination' ? 'elimination_id' : 'adjustment_id'},contribution_amount,lineage_type,created_at) VALUES(?,?,?,?,?,?,?)`).run(id('clin'), runId, balance.id, sourceId, round(d - c), type, now());
  }

  #assertParent(parentCompanyId, ctx) {
    const active = ctx.companyId || ctx.activeCompanyId;
    if (!active || active !== parentCompanyId) throw new IntercompanyError('Consolidation parent scope denied', 'COMPANY_SCOPE_DENIED', 403);
  }
}

export function createConsolidationService(dialect) { return new ConsolidationService(dialect); }
