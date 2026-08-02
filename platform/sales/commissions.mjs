// Sales Commissions Service
'use strict';

import crypto from 'node:crypto';

export class CommissionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CommissionError';
    this.code = code;
  }
}

export class CommissionService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #planRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      name: r.name,
      basis: r.basis,
      defaultRatePct: r.default_rate_pct,
      status: r.status,
      effectiveAt: r.effective_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #accrualRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      salespersonId: r.salesperson_id,
      saleOrderId: r.sale_order_id,
      basisAmount: r.basis_amount,
      commissionAmount: r.commission_amount,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createPlan({ name, companyId, defaultRatePct = 5.0, basis = 'invoice' }, ctx) {
    if (!name || !companyId) {
      throw new CommissionError('name and companyId are required', 'COMMISSION_PLAN_INVALID');
    }
    const id = `cmp_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO commission_plans (id, company_id, name, basis, default_rate_pct, status, effective_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, companyId, name, basis, defaultRatePct, now, now, now);

    return this.getPlan(id);
  }

  getPlan(id) {
    const row = this.dialect.prepare('SELECT * FROM commission_plans WHERE id = ?').get(id);
    return this.#planRow(row);
  }

  listPlans({ companyId }) {
    return this.dialect.prepare('SELECT * FROM commission_plans WHERE company_id = ? ORDER BY created_at DESC')
      .all(companyId)
      .map(r => this.#planRow(r));
  }

  accrueCommission({ planId, salespersonId, saleOrderId, companyId, basisAmount }, ctx) {
    const plan = this.getPlan(planId);
    if (!plan || plan.status !== 'active') {
      throw new CommissionError('Active commission plan not found', 'COMMISSION_PLAN_NOT_FOUND');
    }
    if (!salespersonId || !companyId || basisAmount == null) {
      throw new CommissionError('salespersonId, companyId, and basisAmount are required', 'ACCRUAL_INVALID_INPUT');
    }

    const commissionAmount = Number((basisAmount * (plan.defaultRatePct / 100)).toFixed(2));
    const id = `cma_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO commission_accruals
        (id, company_id, salesperson_id, sale_order_id, basis_amount, commission_amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'accrued', ?, ?)
    `).run(id, companyId, salespersonId, saleOrderId, basisAmount, commissionAmount, now, now);

    const row = this.dialect.prepare('SELECT * FROM commission_accruals WHERE id = ?').get(id);
    return this.#accrualRow(row);
  }

  settleAccrual(accrualId, ctx) {
    const row = this.dialect.prepare('SELECT * FROM commission_accruals WHERE id = ?').get(accrualId);
    if (!row) throw new CommissionError('Commission accrual not found', 'ACCRUAL_NOT_FOUND');
    const now = this.#now();

    this.dialect.prepare(`
      UPDATE commission_accruals
      SET status = 'settled', updated_at = ?
      WHERE id = ?
    `).run(now, accrualId);

    return this.#accrualRow(this.dialect.prepare('SELECT * FROM commission_accruals WHERE id = ?').get(accrualId));
  }

  listAccruals({ companyId, salespersonId, status } = {}) {
    let sql = 'SELECT * FROM commission_accruals WHERE 1=1';
    const params = [];
    if (companyId) {
      sql += ' AND company_id = ?';
      params.push(companyId);
    }
    if (salespersonId) {
      sql += ' AND salesperson_id = ?';
      params.push(salespersonId);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';
    return this.dialect.prepare(sql).all(...params).map(r => this.#accrualRow(r));
  }
}

export function createCommissionService(dialect, deps) {
  return new CommissionService(dialect, deps);
}
