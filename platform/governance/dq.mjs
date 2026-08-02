// Data Quality Management (DQM) Service
'use strict';

import crypto from 'node:crypto';

export class DqError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DqError';
    this.code = code;
  }
}

export class DataQualityService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #ruleRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      ruleCode: r.rule_code,
      name: r.name,
      entityType: r.entity_type,
      dimension: r.dimension,
      severity: r.severity,
      conditionExpression: r.condition_expression,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #exceptionRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      ruleId: r.rule_id,
      entityType: r.entity_type,
      recordId: r.record_id,
      severity: r.severity,
      assignedOwner: r.assigned_owner,
      status: r.status,
      dueDate: r.due_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  #waiverRow(r) {
    return r && {
      id: r.id,
      companyId: r.company_id,
      exceptionId: r.exception_id,
      requestedBy: r.requested_by,
      approvedBy: r.approved_by,
      reason: r.reason,
      status: r.status,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  publishRule({ ruleCode, name, entityType = 'party', dimension = 'completeness', severity = 'medium', conditionExpression }, ctx = {}) {
    if (!ruleCode || !name || !conditionExpression) {
      throw new DqError('ruleCode, name, and conditionExpression are required', 'RULE_INVALID_INPUT');
    }
    const id = `dq_rule_${crypto.randomUUID()}`;
    const companyId = ctx.companyId || 'default';
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO dq_rules (id, company_id, rule_code, name, entity_type, dimension, severity, condition_expression, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, companyId, ruleCode, name, entityType, dimension, severity, conditionExpression, now, now);

    return this.getRule(id);
  }

  getRule(id) {
    const row = this.dialect.prepare('SELECT * FROM dq_rules WHERE id = ?').get(id);
    return this.#ruleRow(row);
  }

  listRules({ companyId = 'default', entityType } = {}) {
    let sql = "SELECT * FROM dq_rules WHERE status = 'active' AND (company_id = ? OR company_id = '*')";
    const params = [companyId];
    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }
    return this.dialect.prepare(sql).all(...params).map(r => this.#ruleRow(r));
  }

  runScan({ companyId = 'default', entityType = 'party' }, ctx = {}) {
    const rules = this.listRules({ companyId, entityType });
    const now = this.#now();
    let recordsScanned = 0;
    let exceptionsFound = 0;

    if (entityType === 'party') {
      const records = this.dialect.prepare("SELECT * FROM parties WHERE company_id = ? OR company_id = '*'").all(companyId);
      recordsScanned = records.length;

      for (const rec of records) {
        for (const rule of rules) {
          let passed = true;
          if (rule.dimension === 'completeness' && rule.conditionExpression.includes('name')) {
            if (!rec.name || !rec.name.trim()) passed = false;
          }

          if (!passed) {
            exceptionsFound++;
            const id = `dq_exc_${crypto.randomUUID()}`;
            this.dialect.prepare(`
              INSERT INTO dq_exceptions (id, company_id, rule_id, entity_type, record_id, severity, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
            `).run(id, companyId, rule.id, entityType, rec.id, rule.severity, now, now);
          }
        }
      }
    }

    const overallScore = recordsScanned > 0 ? Number((((recordsScanned - exceptionsFound) / recordsScanned) * 100).toFixed(2)) : 100.0;
    const scanId = `dq_scan_${crypto.randomUUID()}`;

    this.dialect.prepare(`
      INSERT INTO dq_scan_runs (id, company_id, scanned_entities, records_scanned, exceptions_found, overall_score, triggered_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(scanId, companyId, JSON.stringify([entityType]), recordsScanned, exceptionsFound, overallScore, ctx.userId || 'system', now);

    return {
      scanId,
      companyId,
      recordsScanned,
      exceptionsFound,
      overallScore,
      createdAt: now,
    };
  }

  assignException(exceptionId, ownerId, dueDate, ctx = {}) {
    const exc = this.getException(exceptionId);
    if (!exc) throw new DqError('Exception not found', 'EXCEPTION_NOT_FOUND');
    const now = this.#now();

    this.dialect.prepare(`
      UPDATE dq_exceptions
      SET assigned_owner = ?, due_date = ?, status = 'in_remediation', updated_at = ?
      WHERE id = ?
    `).run(ownerId, dueDate || null, now, exceptionId);

    return this.getException(exceptionId);
  }

  getException(id) {
    const row = this.dialect.prepare('SELECT * FROM dq_exceptions WHERE id = ?').get(id);
    return this.#exceptionRow(row);
  }

  listExceptions({ companyId = 'default', status, entityType } = {}) {
    let sql = "SELECT * FROM dq_exceptions WHERE company_id = ? OR company_id = '*'";
    const params = [companyId];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }
    return this.dialect.prepare(sql).all(...params).map(r => this.#exceptionRow(r));
  }

  requestWaiver({ exceptionId, reason }, ctx = {}) {
    const exc = this.getException(exceptionId);
    if (!exc) throw new DqError('Exception not found', 'EXCEPTION_NOT_FOUND');
    if (!reason) throw new DqError('Reason is required', 'WAIVER_REASON_REQUIRED');

    const id = `dq_wvr_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO dq_waivers (id, company_id, exception_id, requested_by, reason, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'requested', ?, ?)
    `).run(id, exc.companyId, exceptionId, ctx.userId || 'system', reason, now, now);

    return this.getWaiver(id);
  }

  getWaiver(id) {
    const row = this.dialect.prepare('SELECT * FROM dq_waivers WHERE id = ?').get(id);
    return this.#waiverRow(row);
  }

  approveWaiver(waiverId, ctx = {}) {
    const waiver = this.getWaiver(waiverId);
    if (!waiver) throw new DqError('Waiver not found', 'WAIVER_NOT_FOUND');

    const now = this.#now();

    this.dialect.prepare(`
      UPDATE dq_waivers
      SET status = 'approved', approved_by = ?, updated_at = ?
      WHERE id = ?
    `).run(ctx.userId || 'system', now, waiverId);

    this.dialect.prepare(`
      UPDATE dq_exceptions
      SET status = 'waived', updated_at = ?
      WHERE id = ?
    `).run(now, waiver.exceptionId);

    return this.getWaiver(waiverId);
  }
}

export function createDataQualityService(dialect, deps) {
  return new DataQualityService(dialect, deps);
}
