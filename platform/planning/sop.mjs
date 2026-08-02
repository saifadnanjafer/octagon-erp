// BUILD-08 sales and operations planning authority.
'use strict';

import crypto from 'node:crypto';
import { ForecastError } from './forecasting.mjs';

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (value) => Number(value || 0);

export class SalesOperationsPlanningService {
  constructor(dialect) { this.db = dialect; }

  createCycle(input, ctx = {}) {
    const companyId = input.companyId || ctx.companyId;
    if (!companyId || !input.name || !input.periodStart || !input.periodEnd) throw new ForecastError('Cycle identity and dates are required', 'INVALID_SOP_CYCLE');
    if (input.periodStart > input.periodEnd) throw new ForecastError('S&OP dates are inverted', 'INVALID_SOP_RANGE');
    const row = this.db.prepare('SELECT MAX(revision) AS revision FROM sop_cycles WHERE company_id=? AND name=?').get(companyId, input.name);
    const revision = Number(row?.revision || 0) + 1;
    const cycleId = id('sop');
    this.db.prepare(`INSERT INTO sop_cycles(id,company_id,name,period_start,period_end,status,revision,created_by,created_at) VALUES(?,?,?,?,?,'draft',?,?,?)`).run(cycleId, companyId, input.name, input.periodStart, input.periodEnd, revision, ctx.userId || ctx.actorId || 'system', now());
    return this.getCycle(cycleId, { ...ctx, companyId });
  }

  addScenario(cycleId, input, ctx = {}) {
    const cycle = this.getCycle(cycleId, ctx);
    if (!cycle || ['published', 'revised'].includes(cycle.status)) throw new ForecastError('Cycle is not editable', 'SOP_CYCLE_IMMUTABLE', 409);
    const scenarioId = id('sops');
    const demand = n(input.demandQuantity);
    const supply = n(input.supplyQuantity);
    const capacityRequired = n(input.capacityRequired);
    const capacityAvailable = n(input.capacityAvailable);
    const gaps = [];
    if (supply < demand) gaps.push({ code: 'SUPPLY_GAP', quantity: demand - supply });
    if (capacityAvailable < capacityRequired) gaps.push({ code: 'CAPACITY_GAP', quantity: capacityRequired - capacityAvailable });
    this.db.prepare(`INSERT INTO sop_scenarios(id,cycle_id,name,demand_quantity,supply_quantity,inventory_projection,capacity_required,capacity_available,revenue_projection,cost_projection,actual_demand,actual_supply,assumptions_json,gaps_json,resolutions_json,selected,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(scenarioId, cycleId, input.name || 'Scenario', demand, supply, n(input.inventoryProjection), capacityRequired, capacityAvailable, n(input.revenueProjection), n(input.costProjection), input.actualDemand ?? null, input.actualSupply ?? null, JSON.stringify(input.assumptions || []), JSON.stringify(gaps), JSON.stringify(input.resolutions || []), input.selected ? 1 : 0, now());
    this.db.prepare("UPDATE sop_cycles SET status='review' WHERE id=?").run(cycleId);
    return this.getScenario(scenarioId, ctx);
  }

  getScenario(scenarioId, ctx = {}) {
    const row = this.db.prepare(`SELECT s.*,c.company_id FROM sop_scenarios s JOIN sop_cycles c ON c.id=s.cycle_id WHERE s.id=?`).get(scenarioId);
    if (!row) return null;
    this.#assertCompany(row.company_id, ctx);
    return { id: row.id, cycleId: row.cycle_id, name: row.name, demandQuantity: n(row.demand_quantity), supplyQuantity: n(row.supply_quantity), inventoryProjection: n(row.inventory_projection), capacityRequired: n(row.capacity_required), capacityAvailable: n(row.capacity_available), revenueProjection: n(row.revenue_projection), costProjection: n(row.cost_projection), projectedMargin: n(row.revenue_projection) - n(row.cost_projection), actualDemand: row.actual_demand === null ? null : n(row.actual_demand), actualSupply: row.actual_supply === null ? null : n(row.actual_supply), demandVariance: row.actual_demand === null ? null : n(row.actual_demand) - n(row.demand_quantity), supplyVariance: row.actual_supply === null ? null : n(row.actual_supply) - n(row.supply_quantity), assumptions: JSON.parse(row.assumptions_json || '[]'), gaps: JSON.parse(row.gaps_json || '[]'), resolutions: JSON.parse(row.resolutions_json || '[]'), selected: Boolean(row.selected) };
  }

  review(cycleId, input, ctx = {}) {
    const cycle = this.getCycle(cycleId, ctx);
    if (!cycle || !['review', 'draft'].includes(cycle.status)) throw new ForecastError('Cycle is not reviewable', 'SOP_NOT_REVIEWABLE', 409);
    if (!['approve', 'revise', 'reject'].includes(input.decision) || !input.notes) throw new ForecastError('Decision and notes are required', 'INVALID_SOP_REVIEW');
    this.db.prepare('INSERT INTO sop_reviews(id,cycle_id,decision,notes,reviewed_by,reviewed_at) VALUES(?,?,?,?,?,?)').run(id('sopr'), cycleId, input.decision, input.notes, ctx.userId || ctx.actorId || 'system', now());
    const status = input.decision === 'approve' ? 'approved' : input.decision === 'revise' ? 'revised' : 'draft';
    this.db.prepare('UPDATE sop_cycles SET status=? WHERE id=?').run(status, cycleId);
    return this.getCycle(cycleId, ctx);
  }

  publish(cycleId, scenarioId, ctx = {}) {
    const cycle = this.getCycle(cycleId, ctx);
    const scenario = this.getScenario(scenarioId, ctx);
    if (!cycle || cycle.status !== 'approved' || scenario?.cycleId !== cycleId) throw new ForecastError('Approved cycle and owned scenario are required', 'SOP_APPROVAL_REQUIRED', 409);
    this.db.prepare('UPDATE sop_scenarios SET selected=CASE WHEN id=? THEN 1 ELSE 0 END WHERE cycle_id=?').run(scenarioId, cycleId);
    this.db.prepare("UPDATE sop_cycles SET status='published',published_at=?,published_by=? WHERE id=?").run(now(), ctx.userId || ctx.actorId || 'system', cycleId);
    return this.getCycle(cycleId, ctx);
  }

  getCycle(cycleId, ctx = {}) {
    const row = this.db.prepare('SELECT * FROM sop_cycles WHERE id=?').get(cycleId);
    if (!row) return null;
    this.#assertCompany(row.company_id, ctx);
    const scenarios = this.db.prepare('SELECT id FROM sop_scenarios WHERE cycle_id=? ORDER BY created_at').all(cycleId).map((item) => this.getScenario(item.id, ctx));
    const reviews = this.db.prepare('SELECT * FROM sop_reviews WHERE cycle_id=? ORDER BY reviewed_at').all(cycleId).map((review) => ({ id: review.id, decision: review.decision, notes: review.notes, reviewedBy: review.reviewed_by, reviewedAt: review.reviewed_at }));
    return { id: row.id, companyId: row.company_id, name: row.name, periodStart: row.period_start, periodEnd: row.period_end, status: row.status, revision: row.revision, publishedAt: row.published_at, scenarios, reviews };
  }

  listCycles({ companyId } = {}, ctx = {}) {
    const scope = companyId || ctx.companyId;
    return this.db.prepare('SELECT id FROM sop_cycles WHERE company_id=? ORDER BY created_at DESC').all(scope).map((row) => this.getCycle(row.id, { ...ctx, companyId: scope }));
  }

  #assertCompany(companyId, ctx) {
    const active = ctx.companyId || ctx.activeCompanyId;
    if (!active || active !== companyId) throw new ForecastError('Company scope denied', 'COMPANY_SCOPE_DENIED', 403);
  }
}

export function createSalesOperationsPlanningService(dialect) { return new SalesOperationsPlanningService(dialect); }
