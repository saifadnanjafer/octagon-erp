// Commercial RMA & Warranty Inspection Service
'use strict';

import crypto from 'node:crypto';

export class RmaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RmaError';
    this.code = code;
  }
}

export class RmaService {
  constructor(dialect, { now = () => new Date() } = {}) {
    this.dialect = dialect;
    this.now = now;
  }

  #now() { return this.now().toISOString(); }

  #row(r) {
    return r && {
      id: r.id,
      rmaId: r.rma_id,
      inspectorId: r.inspector_id,
      result: r.result,
      disposition: r.disposition,
      notes: r.notes,
      createdAt: r.created_at,
    };
  }

  createInspection({ rmaId, inspectorId, result = 'pass', disposition = 'pending', notes = '' }, ctx) {
    if (!rmaId || !inspectorId) {
      throw new RmaError('rmaId and inspectorId are required', 'RMA_INVALID_INPUT');
    }
    const id = `rmainsp_${crypto.randomUUID()}`;
    const now = this.#now();

    this.dialect.prepare(`
      INSERT INTO commercial_rma_inspections (id, rma_id, inspector_id, result, disposition, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, rmaId, inspectorId, result, disposition, notes, now);

    return this.getInspection(id);
  }

  updateInspectionStatus(id, { result, disposition, notes }, ctx) {
    const existing = this.getInspection(id);
    if (!existing) throw new RmaError('RMA inspection record not found', 'RMA_NOT_FOUND');

    const nextResult = result || existing.result;
    const nextDisposition = disposition || existing.disposition;
    const nextNotes = notes !== undefined ? notes : existing.notes;

    this.dialect.prepare(`
      UPDATE commercial_rma_inspections
      SET result = ?, disposition = ?, notes = ?
      WHERE id = ?
    `).run(nextResult, nextDisposition, nextNotes, id);

    return this.getInspection(id);
  }

  getInspection(id) {
    const row = this.dialect.prepare('SELECT * FROM commercial_rma_inspections WHERE id = ?').get(id);
    return this.#row(row);
  }

  listInspections({ rmaId } = {}) {
    let sql = 'SELECT * FROM commercial_rma_inspections WHERE 1=1';
    const params = [];
    if (rmaId) {
      sql += ' AND rma_id = ?';
      params.push(rmaId);
    }
    sql += ' ORDER BY created_at DESC';
    return this.dialect.prepare(sql).all(...params).map(r => this.#row(r));
  }
}

export function createRmaService(dialect, deps) {
  return new RmaService(dialect, deps);
}
