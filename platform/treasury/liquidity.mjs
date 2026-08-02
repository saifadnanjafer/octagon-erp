// BUILD-08 treasury projection authority. It never contacts banks or executes payments.
'use strict';

import crypto from 'node:crypto';

export class TreasuryError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'TreasuryError'; this.code = code; this.statusCode = statusCode; }
}

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (value) => Number(value || 0);
const round = (value) => Number(n(value).toFixed(4));
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function scope(companyId, ctx) {
  const active = ctx?.companyId || ctx?.activeCompanyId;
  if (!active || active !== companyId) throw new TreasuryError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
}

function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class TreasuryLiquidityService {
  constructor(dialect) { this.db = dialect; }

  capturePosition(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    const accounts = Array.isArray(input.accounts) ? input.accounts : [];
    if (!companyId || !input.asOfDate || !accounts.length) throw new TreasuryError('Company, date and account balances are required', 'INVALID_CASH_POSITION');
    const key = input.idempotencyKey || ctx.idempotencyKey || null;
    if (key) {
      const existing = this.db.prepare('SELECT id FROM treasury_cash_positions WHERE idempotency_key=?').get(key);
      if (existing) return this.getPosition(existing.id, { ...ctx, companyId });
    }
    const normalized = accounts.map((account) => ({
      accountId: String(account.accountId || ''), accountType: account.accountType || 'bank',
      currency: account.currency || input.reportingCurrency || 'IQD', balance: round(account.balance),
      fxRate: round(account.fxRate || 1), counterpartyId: account.counterpartyId || null,
    }));
    if (normalized.some((account) => !account.accountId || !['bank', 'cash', 'restricted'].includes(account.accountType) || account.fxRate <= 0)) throw new TreasuryError('Invalid cash account fact', 'INVALID_CASH_ACCOUNT');
    const totalCash = round(normalized.reduce((sum, account) => sum + account.balance * account.fxRate, 0));
    const restrictedCash = round(normalized.filter((account) => account.accountType === 'restricted').reduce((sum, account) => sum + account.balance * account.fxRate, 0));
    const positionId = id('tcp');
    this.db.prepare(`INSERT INTO treasury_cash_positions(id,company_id,as_of_date,reporting_currency,total_cash,restricted_cash,available_cash,pending_receipts,pending_payments,overdue_ar,overdue_ap,source_digest,status,created_by,created_at,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'sealed',?,?,?)`).run(positionId, companyId, input.asOfDate, input.reportingCurrency || 'IQD', totalCash, restrictedCash, round(totalCash - restrictedCash), n(input.pendingReceipts), n(input.pendingPayments), n(input.overdueAr), n(input.overdueAp), hash({ accounts: normalized, facts: input.facts || {} }), ctx.userId || ctx.actorId || 'system', now(), key);
    const insert = this.db.prepare('INSERT INTO treasury_cash_position_lines(id,position_id,account_id,account_type,currency,balance,reporting_balance,fx_rate,counterparty_id) VALUES(?,?,?,?,?,?,?,?,?)');
    normalized.forEach((account) => insert.run(id('tcpl'), positionId, account.accountId, account.accountType, account.currency, account.balance, round(account.balance * account.fxRate), account.fxRate, account.counterpartyId));
    return this.getPosition(positionId, { ...ctx, companyId });
  }

  getPosition(positionId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM treasury_cash_positions WHERE id=?').get(positionId);
    if (!row) return null;
    scope(row.company_id, ctx);
    const accounts = this.db.prepare('SELECT * FROM treasury_cash_position_lines WHERE position_id=? ORDER BY account_id').all(positionId).map((line) => ({ id: line.id, accountId: line.account_id, accountType: line.account_type, currency: line.currency, balance: n(line.balance), reportingBalance: n(line.reporting_balance), fxRate: n(line.fx_rate), counterpartyId: line.counterparty_id }));
    return { id: row.id, companyId: row.company_id, asOfDate: row.as_of_date, reportingCurrency: row.reporting_currency, totalCash: n(row.total_cash), restrictedCash: n(row.restricted_cash), availableCash: n(row.available_cash), pendingReceipts: n(row.pending_receipts), pendingPayments: n(row.pending_payments), overdueAr: n(row.overdue_ar), overdueAp: n(row.overdue_ap), sourceDigest: row.source_digest, accounts };
  }

  generateForecast(input, ctx = {}) {
    const position = this.getPosition(input.positionId, ctx);
    if (!position) throw new TreasuryError('Cash position not found', 'CASH_POSITION_NOT_FOUND', 404);
    const grain = input.grain || 'daily';
    const step = grain === 'monthly' ? 30 : grain === 'weekly' ? 7 : 1;
    if (!['daily', 'weekly', 'monthly'].includes(grain)) throw new TreasuryError('Unsupported liquidity grain', 'INVALID_LIQUIDITY_GRAIN');
    const startDate = input.startDate || position.asOfDate;
    const endDate = input.endDate || addDays(startDate, grain === 'monthly' ? 180 : 30);
    const key = input.idempotencyKey || ctx.idempotencyKey || null;
    if (key) {
      const existing = this.db.prepare('SELECT id FROM liquidity_forecasts_v2 WHERE idempotency_key=?').get(key);
      if (existing) return this.getForecast(existing.id, ctx);
    }
    const forecastId = id('lf');
    this.db.prepare(`INSERT INTO liquidity_forecasts_v2(id,company_id,position_id,name,grain,start_date,end_date,currency,minimum_cash_threshold,status,assumptions_json,created_by,created_at,idempotency_key)
      VALUES(?,?,?,?,?,?,?,?,?,'calculated',?,?,?,?)`).run(forecastId, position.companyId, position.id, input.name || `${grain} liquidity`, grain, startDate, endDate, position.reportingCurrency, n(input.minimumCashThreshold), JSON.stringify(input.assumptions || []), ctx.userId || ctx.actorId || 'system', now(), key);
    const flows = Array.isArray(input.flows) ? input.flows : [];
    const insert = this.db.prepare(`INSERT INTO liquidity_forecast_buckets(id,forecast_id,bucket_start,opening_cash,expected_collections,expected_payments,financing_inflow,transfer_net,closing_cash,restricted_cash,available_cash,currency_exposure_json,counterparty_exposure_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let opening = position.totalCash;
    for (let bucket = startDate; bucket <= endDate; bucket = addDays(bucket, step)) {
      const bucketEnd = addDays(bucket, step - 1);
      const bucketFlows = flows.filter((flow) => flow.date >= bucket && flow.date <= bucketEnd);
      const collections = round(bucketFlows.filter((flow) => flow.direction === 'inflow' && flow.sourceType !== 'financing').reduce((sum, flow) => sum + n(flow.amount), 0));
      const payments = round(bucketFlows.filter((flow) => flow.direction === 'outflow').reduce((sum, flow) => sum + n(flow.amount), 0));
      const financing = round(bucketFlows.filter((flow) => flow.direction === 'inflow' && flow.sourceType === 'financing').reduce((sum, flow) => sum + n(flow.amount), 0));
      const transfers = round(bucketFlows.filter((flow) => flow.sourceType === 'transfer').reduce((sum, flow) => sum + n(flow.signedAmount ?? (flow.direction === 'inflow' ? flow.amount : -flow.amount)), 0));
      const closing = round(opening + collections - payments + financing + transfers);
      const exposures = this.#exposures(bucketFlows);
      const bucketId = id('lfb');
      insert.run(bucketId, forecastId, bucket, opening, collections, payments, financing, transfers, closing, position.restrictedCash, round(closing - position.restrictedCash), JSON.stringify(exposures.currency), JSON.stringify(exposures.counterparty));
      this.#createThresholdAlerts({ companyId: position.companyId, forecastId, bucketId, bucket, availableCash: closing - position.restrictedCash, threshold: n(input.minimumCashThreshold), currency: position.reportingCurrency, exposures });
      opening = closing;
    }
    return this.getForecast(forecastId, ctx);
  }

  getForecast(forecastId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM liquidity_forecasts_v2 WHERE id=?').get(forecastId);
    if (!row) return null;
    scope(row.company_id, ctx);
    const buckets = this.db.prepare('SELECT * FROM liquidity_forecast_buckets WHERE forecast_id=? ORDER BY bucket_start').all(forecastId).map((bucket) => ({ id: bucket.id, bucketStart: bucket.bucket_start, openingCash: n(bucket.opening_cash), expectedCollections: n(bucket.expected_collections), expectedPayments: n(bucket.expected_payments), financingInflow: n(bucket.financing_inflow), transferNet: n(bucket.transfer_net), closingCash: n(bucket.closing_cash), restrictedCash: n(bucket.restricted_cash), availableCash: n(bucket.available_cash), currencyExposure: JSON.parse(bucket.currency_exposure_json || '{}'), counterpartyExposure: JSON.parse(bucket.counterparty_exposure_json || '{}') }));
    return { id: row.id, companyId: row.company_id, positionId: row.position_id, name: row.name, grain: row.grain, startDate: row.start_date, endDate: row.end_date, currency: row.currency, minimumCashThreshold: n(row.minimum_cash_threshold), status: row.status, assumptions: JSON.parse(row.assumptions_json || '[]'), buckets };
  }

  listForecasts({ companyId } = {}, ctx = {}) {
    const active = companyId || ctx.companyId;
    return this.db.prepare('SELECT id FROM liquidity_forecasts_v2 WHERE company_id=? ORDER BY created_at DESC').all(active).map((row) => this.getForecast(row.id, { ...ctx, companyId: active }));
  }

  listAlerts({ companyId, status = 'open' } = {}, ctx = {}) {
    const active = companyId || ctx.companyId;
    return this.db.prepare('SELECT * FROM treasury_alerts WHERE company_id=? AND status=? ORDER BY created_at DESC').all(active, status).map((row) => ({ id: row.id, companyId: row.company_id, forecastId: row.forecast_id, bucketId: row.bucket_id, alertType: row.alert_type, severity: row.severity, thresholdAmount: row.threshold_amount === null ? null : n(row.threshold_amount), observedAmount: row.observed_amount === null ? null : n(row.observed_amount), currency: row.currency, message: row.message, status: row.status }));
  }

  acknowledgeAlert(alertId, ctx = {}) {
    const alert = this.db.prepare('SELECT * FROM treasury_alerts WHERE id=?').get(alertId);
    if (!alert) throw new TreasuryError('Treasury alert not found', 'TREASURY_ALERT_NOT_FOUND', 404);
    scope(alert.company_id, ctx);
    this.db.prepare("UPDATE treasury_alerts SET status='acknowledged',acknowledged_by=?,acknowledged_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), alertId);
    return this.listAlerts({ companyId: alert.company_id, status: 'acknowledged' }, ctx).find((item) => item.id === alertId);
  }

  createProposal(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    if (!companyId || !['payment', 'collection', 'transfer', 'funding'].includes(input.proposalType) || n(input.amount) <= 0 || !input.rationale) throw new TreasuryError('Valid proposal type, amount and rationale are required', 'INVALID_TREASURY_PROPOSAL');
    if (input.sourceAlertId) {
      const alert = this.db.prepare('SELECT company_id FROM treasury_alerts WHERE id=?').get(input.sourceAlertId);
      if (!alert || alert.company_id !== companyId) throw new TreasuryError('Alert is outside company scope', 'COMPANY_SCOPE_DENIED', 403);
    }
    const proposalId = id('tp');
    this.db.prepare(`INSERT INTO treasury_proposals(id,company_id,proposal_type,source_alert_id,counterparty_id,source_account_id,target_account_id,amount,currency,requested_date,rationale,status,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending_approval',?,?)`).run(proposalId, companyId, input.proposalType, input.sourceAlertId || null, input.counterpartyId || null, input.sourceAccountId || null, input.targetAccountId || null, n(input.amount), input.currency || 'IQD', input.requestedDate || now().slice(0, 10), input.rationale, ctx.userId || ctx.actorId || 'system', now());
    return this.getProposal(proposalId, { ...ctx, companyId });
  }

  approveProposal(proposalId, ctx = {}) {
    const proposal = this.getProposal(proposalId, ctx);
    if (!proposal) throw new TreasuryError('Treasury proposal not found', 'TREASURY_PROPOSAL_NOT_FOUND', 404);
    if (proposal.status !== 'pending_approval') return proposal;
    this.db.prepare("UPDATE treasury_proposals SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), proposalId);
    return { ...this.getProposal(proposalId, ctx), executionBoundary: 'APPROVED_PROPOSAL_ONLY', bankContacted: false, paymentExecuted: false };
  }

  requestCanonicalRelease(proposalId, ctx = {}) {
    const proposal = this.getProposal(proposalId, ctx);
    if (!proposal || proposal.status !== 'approved') throw new TreasuryError('Approved proposal required', 'TREASURY_APPROVAL_REQUIRED', 409);
    const actions = { payment: 'payments:payment_proposal_release', collection: 'ar:collection_proposal_release', transfer: 'banking:transfer_request_release', funding: 'finance:funding_request_release' };
    const requestId = id('treq');
    this.db.prepare("UPDATE treasury_proposals SET status='release_requested',canonical_action=?,canonical_request_id=? WHERE id=?").run(actions[proposal.proposalType], requestId, proposalId);
    return { ...this.getProposal(proposalId, ctx), executionBoundary: 'REQUEST_ONLY', bankContacted: false, paymentExecuted: false };
  }

  getProposal(proposalId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM treasury_proposals WHERE id=?').get(proposalId);
    if (!row) return null;
    scope(row.company_id, ctx);
    return { id: row.id, companyId: row.company_id, proposalType: row.proposal_type, sourceAlertId: row.source_alert_id, counterpartyId: row.counterparty_id, sourceAccountId: row.source_account_id, targetAccountId: row.target_account_id, amount: n(row.amount), currency: row.currency, requestedDate: row.requested_date, rationale: row.rationale, status: row.status, approvedBy: row.approved_by, canonicalAction: row.canonical_action, canonicalRequestId: row.canonical_request_id };
  }

  createFacility(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    if (!companyId || !input.lenderPartyId || !input.name || n(input.limitAmount) < 0 || !input.startDate || !input.endDate) throw new TreasuryError('Facility terms are incomplete', 'INVALID_FINANCING_FACILITY');
    const facilityId = id('fac');
    this.db.prepare(`INSERT INTO financing_facilities(id,company_id,lender_party_id,name,facility_type,currency,limit_amount,utilized_amount,available_amount,interest_rate,start_date,end_date,status,created_at) VALUES(?,?,?,?,?,?,?,0,?,?,?,?, 'active',?)`).run(facilityId, companyId, input.lenderPartyId, input.name, input.facilityType || 'revolver', input.currency || 'IQD', n(input.limitAmount), n(input.limitAmount), n(input.interestRate), input.startDate, input.endDate, now());
    return this.getFacility(facilityId, { ...ctx, companyId });
  }

  proposeUtilization(facilityId, input, ctx = {}) {
    const facility = this.getFacility(facilityId, ctx);
    if (!facility || facility.status !== 'active' || n(input.amount) > facility.availableAmount || n(input.amount) <= 0) throw new TreasuryError('Utilization exceeds active availability', 'FACILITY_AVAILABILITY_EXCEEDED', 409);
    const utilizationId = id('fcu');
    this.db.prepare(`INSERT INTO financing_facility_utilizations(id,facility_id,amount,utilization_date,status,reason,created_at) VALUES(?,?,?,?,'proposed',?,?)`).run(utilizationId, facilityId, n(input.amount), input.utilizationDate || now().slice(0, 10), input.reason || 'Liquidity coverage', now());
    return { id: utilizationId, facilityId, amount: n(input.amount), status: 'proposed', executed: false };
  }

  approveUtilization(utilizationId, ctx = {}) {
    const row = this.db.prepare(`SELECT u.*,f.company_id,f.available_amount FROM financing_facility_utilizations u JOIN financing_facilities f ON f.id=u.facility_id WHERE u.id=?`).get(utilizationId);
    if (!row) throw new TreasuryError('Utilization not found', 'FACILITY_UTILIZATION_NOT_FOUND', 404);
    scope(row.company_id, ctx);
    if (row.status !== 'proposed') return { id: row.id, status: row.status };
    if (n(row.amount) > n(row.available_amount)) throw new TreasuryError('Facility availability changed', 'FACILITY_AVAILABILITY_EXCEEDED', 409);
    this.db.prepare("UPDATE financing_facility_utilizations SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(ctx.userId || ctx.actorId || 'system', now(), utilizationId);
    this.db.prepare('UPDATE financing_facilities SET utilized_amount=utilized_amount+?,available_amount=available_amount-? WHERE id=?').run(row.amount, row.amount, row.facility_id);
    return { id: row.id, facilityId: row.facility_id, amount: n(row.amount), status: 'approved', cashReceived: false, bankContacted: false };
  }

  getFacility(facilityId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM financing_facilities WHERE id=?').get(facilityId);
    if (!row) return null;
    scope(row.company_id, ctx);
    return { id: row.id, companyId: row.company_id, lenderPartyId: row.lender_party_id, name: row.name, facilityType: row.facility_type, currency: row.currency, limitAmount: n(row.limit_amount), utilizedAmount: n(row.utilized_amount), availableAmount: n(row.available_amount), interestRate: n(row.interest_rate), startDate: row.start_date, endDate: row.end_date, status: row.status };
  }

  registerInstrument(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    if (!companyId || !['letter_of_credit', 'bank_guarantee'].includes(input.instrumentType) || !input.reference || !input.bankPartyId || !input.beneficiaryPartyId || n(input.amount) <= 0 || !input.expiryDate) throw new TreasuryError('Bank instrument terms are incomplete', 'INVALID_BANK_INSTRUMENT');
    const instrumentId = id('bi');
    this.db.prepare(`INSERT INTO bank_instruments(id,company_id,instrument_type,reference,bank_party_id,beneficiary_party_id,amount,currency,issue_date,expiry_date,status,terms_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`).run(instrumentId, companyId, input.instrumentType, input.reference, input.bankPartyId, input.beneficiaryPartyId, n(input.amount), input.currency || 'IQD', input.issueDate || null, input.expiryDate, JSON.stringify(input.terms || {}), ctx.userId || ctx.actorId || 'system', now());
    return { id: instrumentId, companyId, instrumentType: input.instrumentType, reference: input.reference, amount: n(input.amount), currency: input.currency || 'IQD', expiryDate: input.expiryDate, status: 'draft', providerActivated: false };
  }

  #exposures(flows) {
    const currency = {}; const counterparty = {};
    for (const flow of flows) {
      const signed = (flow.direction === 'outflow' ? -1 : 1) * n(flow.amount);
      const currencyCode = flow.currency || 'IQD'; currency[currencyCode] = round(n(currency[currencyCode]) + signed);
      if (flow.counterpartyId) counterparty[flow.counterpartyId] = round(n(counterparty[flow.counterpartyId]) + signed);
    }
    return { currency, counterparty };
  }

  #createThresholdAlerts({ companyId, forecastId, bucketId, bucket, availableCash, threshold, currency, exposures }) {
    const insert = this.db.prepare(`INSERT INTO treasury_alerts(id,company_id,forecast_id,bucket_id,alert_type,severity,threshold_amount,observed_amount,currency,message,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'open',?)`);
    if (availableCash < threshold) insert.run(id('ta'), companyId, forecastId, bucketId, 'minimum_cash_breach', availableCash < 0 ? 'critical' : 'warning', threshold, round(availableCash), currency, `Available cash below threshold on ${bucket}`, now());
    const largestCurrency = Object.entries(exposures.currency).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (largestCurrency && largestCurrency[0] !== currency && Math.abs(largestCurrency[1]) > Math.abs(threshold)) insert.run(id('ta'), companyId, forecastId, bucketId, 'currency_exposure', 'warning', threshold, largestCurrency[1], largestCurrency[0], `Material ${largestCurrency[0]} exposure on ${bucket}`, now());
  }
}

export function createTreasuryLiquidityService(dialect) { return new TreasuryLiquidityService(dialect); }
