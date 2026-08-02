// BUILD-08 master production schedule projection authority.
'use strict';

import crypto from 'node:crypto';
import { ForecastError } from './forecasting.mjs';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (value) => Number(value || 0);
const rounded = (value) => Number(n(value).toFixed(4));

export class MasterProductionScheduleService {
  constructor(dialect, { forecasting }) {
    this.db = dialect;
    this.forecasting = forecasting;
  }

  run(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    const forecast = this.forecasting.getVersion(input.forecastVersionId, { ...ctx, companyId });
    if (!forecast || forecast.status !== 'published') throw new ForecastError('A published forecast is required', 'PUBLISHED_FORECAST_REQUIRED', 409);
    const horizon = this.forecasting.getHorizon(input.horizonId || forecast.horizonId, { ...ctx, companyId });
    const key = input.idempotencyKey || ctx.idempotencyKey || null;
    if (key) {
      const existing = this.db.prepare('SELECT id FROM mps_runs WHERE idempotency_key=?').get(key);
      if (existing) return this.getRun(existing.id, { ...ctx, companyId });
    }
    const runId = id('mps');
    this.db.prepare(`INSERT INTO mps_runs(id,company_id,horizon_id,forecast_version_id,status,frozen_zone_end,planning_fence_end,assumptions_json,created_by,created_at,idempotency_key)
      VALUES(?,?,?,?,'calculated',?,?,?,?,?,?)`).run(runId, companyId, horizon.id, forecast.id, horizon.frozenUntil, horizon.planningFenceUntil, JSON.stringify(input.assumptions || {}), ctx.userId || ctx.actorId || 'system', now(), key);

    const facts = new Map((input.facts || []).map((fact) => [`${fact.productId}|${fact.bucketStart}`, fact]));
    const insertLine = this.db.prepare(`INSERT INTO mps_lines(id,run_id,product_id,bucket_start,beginning_inventory,confirmed_demand,forecast_demand,safety_stock,scheduled_receipts,open_procurement,open_production,projected_available,gross_requirement,net_requirement,capacity_required,capacity_available,warning_code)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertProposal = this.db.prepare(`INSERT INTO supply_proposals(id,company_id,mps_line_id,proposal_type,product_id,quantity,required_date,status,created_at) VALUES(?,?,?,?,?,?,?,'proposed',?)`);
    for (const forecastLine of forecast.lines) {
      const fact = facts.get(`${forecastLine.productId}|${forecastLine.bucketStart}`) || facts.get(`${forecastLine.productId}|*`) || {};
      const beginning = n(fact.beginningInventory);
      const confirmed = n(fact.confirmedDemand);
      const forecastDemand = n(forecastLine.approvedQuantity);
      const safety = n(fact.safetyStock);
      const receipts = n(fact.scheduledReceipts);
      const openProcurement = n(fact.openProcurement);
      const openProduction = n(fact.openProduction);
      const gross = Math.max(confirmed, forecastDemand) + safety;
      const availableSupply = beginning + receipts + openProcurement + openProduction;
      const net = Math.max(0, gross - availableSupply);
      const projected = availableSupply - Math.max(confirmed, forecastDemand);
      const capacityRequired = n(fact.capacityPerUnit) * Math.max(confirmed, forecastDemand);
      const capacityAvailable = n(fact.capacityAvailable);
      let warning = null;
      if (capacityRequired > capacityAvailable && capacityAvailable > 0) warning = 'CAPACITY_SHORTAGE';
      else if (projected < safety) warning = 'SAFETY_STOCK_BREACH';
      if (horizon.frozenUntil && forecastLine.bucketStart <= horizon.frozenUntil && net > 0) warning = 'FROZEN_ZONE_SHORTAGE';
      const lineId = id('mpsl');
      insertLine.run(lineId, runId, forecastLine.productId, forecastLine.bucketStart, beginning, confirmed, forecastDemand, safety, receipts, openProcurement, openProduction, rounded(projected), rounded(gross), rounded(net), rounded(capacityRequired), rounded(capacityAvailable), warning);
      if (net > 0) {
        const proposalType = fact.supplyType === 'procurement' ? 'procurement' : 'production';
        insertProposal.run(id('sp'), companyId, lineId, proposalType, forecastLine.productId, rounded(net), forecastLine.bucketStart, now());
      }
    }
    return this.getRun(runId, { ...ctx, companyId });
  }

  getRun(runId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM mps_runs WHERE id=?').get(runId);
    if (!row) return null;
    const active = ctx.companyId || ctx.activeCompanyId;
    if (!active || active !== row.company_id) throw new ForecastError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
    const lines = this.db.prepare('SELECT * FROM mps_lines WHERE run_id=? ORDER BY product_id,bucket_start').all(runId).map((line) => ({ id: line.id, productId: line.product_id, bucketStart: line.bucket_start, beginningInventory: n(line.beginning_inventory), confirmedDemand: n(line.confirmed_demand), forecastDemand: n(line.forecast_demand), safetyStock: n(line.safety_stock), scheduledReceipts: n(line.scheduled_receipts), openProcurement: n(line.open_procurement), openProduction: n(line.open_production), projectedAvailable: n(line.projected_available), grossRequirement: n(line.gross_requirement), netRequirement: n(line.net_requirement), capacityRequired: n(line.capacity_required), capacityAvailable: n(line.capacity_available), warningCode: line.warning_code }));
    const proposals = this.db.prepare(`SELECT p.* FROM supply_proposals p JOIN mps_lines l ON l.id=p.mps_line_id WHERE l.run_id=? ORDER BY p.required_date`).all(runId).map((proposal) => this.#mapProposal(proposal));
    return { id: row.id, companyId: row.company_id, horizonId: row.horizon_id, forecastVersionId: row.forecast_version_id, status: row.status, frozenZoneEnd: row.frozen_zone_end, planningFenceEnd: row.planning_fence_end, assumptions: JSON.parse(row.assumptions_json || '{}'), lines, proposals, createdAt: row.created_at };
  }

  listRuns({ companyId } = {}, ctx = {}) {
    const scope = companyId || ctx.companyId;
    return this.db.prepare('SELECT id FROM mps_runs WHERE company_id=? ORDER BY created_at DESC').all(scope).map((row) => this.getRun(row.id, { ...ctx, companyId: scope }));
  }

  approveProposal(proposalId, input = {}, ctx = {}) {
    const proposal = this.#getScopedProposal(proposalId, ctx);
    if (!proposal) throw new ForecastError('Supply proposal not found', 'SUPPLY_PROPOSAL_NOT_FOUND', 404);
    if (proposal.status !== 'proposed') return proposal;
    if (!input.reason) throw new ForecastError('Approval reason is required', 'APPROVAL_REASON_REQUIRED');
    this.db.prepare("UPDATE supply_proposals SET status='approved',approval_reason=?,approved_by=?,approved_at=? WHERE id=?").run(input.reason, ctx.userId || ctx.actorId || 'system', now(), proposalId);
    return this.#getScopedProposal(proposalId, ctx);
  }

  requestCanonicalRelease(proposalId, ctx = {}) {
    const proposal = this.#getScopedProposal(proposalId, ctx);
    if (!proposal || proposal.status !== 'approved') throw new ForecastError('Only approved proposals can request release', 'PROPOSAL_NOT_APPROVED', 409);
    const canonicalAction = proposal.proposalType === 'procurement' ? 'procurement:order_create' : 'manufacturing:production_order_create';
    const requestId = id('release');
    this.db.prepare("UPDATE supply_proposals SET status='release_requested',canonical_action=?,canonical_request_id=? WHERE id=?").run(canonicalAction, requestId, proposalId);
    return { ...this.#getScopedProposal(proposalId, ctx), boundary: 'REQUEST_ONLY', canonicalWriterExecuted: false };
  }

  #getScopedProposal(proposalId, ctx) {
    const row = this.db.prepare('SELECT * FROM supply_proposals WHERE id=?').get(proposalId);
    if (!row) return null;
    const active = ctx.companyId || ctx.activeCompanyId;
    if (!active || active !== row.company_id) throw new ForecastError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
    return this.#mapProposal(row);
  }

  #mapProposal(row) {
    return { id: row.id, companyId: row.company_id, mpsLineId: row.mps_line_id, proposalType: row.proposal_type, productId: row.product_id, quantity: n(row.quantity), requiredDate: row.required_date, status: row.status, approvalReason: row.approval_reason, approvedBy: row.approved_by, canonicalAction: row.canonical_action, canonicalRequestId: row.canonical_request_id };
  }
}

export function createMasterProductionScheduleService(dialect, deps) { return new MasterProductionScheduleService(dialect, deps); }
