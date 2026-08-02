// Credit Profiles and Collections Service
'use strict';

import crypto from 'node:crypto';

export class CreditCollectionsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CreditCollectionsError';
    this.code = code;
  }
}

export class CreditCollectionsService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #profileRow(r) {
    return r && {
      id: r.id,
      customerId: r.customer_id,
      companyId: r.company_id,
      creditLimit: r.credit_limit,
      openAr: r.open_ar,
      overdueExposure: r.overdue_exposure,
      unbilledExposure: r.unbilled_exposure,
      creditHold: r.credit_hold === 1,
      holdReason: r.hold_reason,
      dunningStage: r.dunning_stage,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #promiseRow(r) {
    return r && {
      id: r.id,
      customerId: r.customer_id,
      companyId: r.company_id,
      collectorId: r.collector_id,
      amount: r.amount,
      promiseDate: r.promise_date,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createOrUpdateCreditProfile({ customerId, companyId, creditLimit = 0 }, ctx) {
    if (!customerId || !companyId) {
      throw new CreditCollectionsError('customerId and companyId are required', 'CREDIT_INVALID_INPUT');
    }
    const existing = this.getCreditProfile(customerId, companyId);
    const now = this.#now();

    if (existing) {
      this.dialect.prepare(`
        UPDATE customer_credit_profiles
        SET credit_limit = ?, updated_at = ?
        WHERE id = ?
      `).run(creditLimit, now, existing.id);
      return this.getCreditProfile(customerId, companyId);
    } else {
      const id = `cred_${crypto.randomUUID()}`;
      this.dialect.prepare(`
        INSERT INTO customer_credit_profiles
          (id, customer_id, company_id, credit_limit, open_ar, overdue_exposure, unbilled_exposure, credit_hold, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0.0, 0.0, 0.0, 0, ?, ?)
      `).run(id, customerId, companyId, creditLimit, now, now);
      return this.getCreditProfile(customerId, companyId);
    }
  }

  setCreditHold(customerId, companyId, hold, reason = '', ctx) {
    const profile = this.getCreditProfile(customerId, companyId);
    if (!profile) throw new CreditCollectionsError('Credit profile not found', 'CREDIT_PROFILE_NOT_FOUND');
    const now = this.#now();

    this.dialect.prepare(`
      UPDATE customer_credit_profiles
      SET credit_hold = ?, hold_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(hold ? 1 : 0, reason, now, profile.id);

    return this.getCreditProfile(customerId, companyId);
  }

  getCreditProfile(customerId, companyId) {
    const row = this.dialect.prepare('SELECT * FROM customer_credit_profiles WHERE customer_id = ? AND company_id = ?').get(customerId, companyId);
    return this.#profileRow(row);
  }

  createCollectionPromise({ customerId, companyId, collectorId = 'system', amount, promiseDate, notes = '' }, ctx) {
    if (!customerId || !companyId || amount == null || !promiseDate) {
      throw new CreditCollectionsError('customerId, companyId, amount and promiseDate are required', 'PROMISE_INVALID_INPUT');
    }
    const id = `prm_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO collection_promises
        (id, customer_id, company_id, collector_id, amount, promise_date, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, customerId, companyId, collectorId, amount, promiseDate, notes, now, now);

    const row = this.dialect.prepare('SELECT * FROM collection_promises WHERE id = ?').get(id);
    return this.#promiseRow(row);
  }

  fulfillCollectionPromise(promiseId, ctx) {
    const row = this.dialect.prepare('SELECT * FROM collection_promises WHERE id = ?').get(promiseId);
    if (!row) throw new CreditCollectionsError('Promise not found', 'PROMISE_NOT_FOUND');
    const now = this.#now();

    this.dialect.prepare(`
      UPDATE collection_promises
      SET status = 'fulfilled', updated_at = ?
      WHERE id = ?
    `).run(now, promiseId);

    return this.#promiseRow(this.dialect.prepare('SELECT * FROM collection_promises WHERE id = ?').get(promiseId));
  }

  listCollectionPromises({ companyId, customerId, status } = {}) {
    let sql = 'SELECT * FROM collection_promises WHERE 1=1';
    const params = [];
    if (companyId) {
      sql += ' AND company_id = ?';
      params.push(companyId);
    }
    if (customerId) {
      sql += ' AND customer_id = ?';
      params.push(customerId);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY promise_date ASC';
    return this.dialect.prepare(sql).all(...params).map(r => this.#promiseRow(r));
  }
}

export function createCreditCollectionsService(dialect, deps) {
  return new CreditCollectionsService(dialect, deps);
}
