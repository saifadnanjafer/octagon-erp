// platform/quality/ncr-capa.mjs — NCR & CAPA Domain Engine (uses canonical Work Items).

'use strict';

import crypto from 'node:crypto';
import { QualityError } from './inspection.mjs';

function nowISO() {
  return new Date().toISOString();
}

export function createNCR(db, input) {
  const { title, inspection_id, severity, disposition, root_cause, description } = input;
  if (!title || !inspection_id) throw new QualityError('title and inspection_id are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const insp = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(inspection_id);
  if (!insp) throw new QualityError(`inspection ${inspection_id} not found`, 'QUALITY_INSPECTION_NOT_FOUND');

  const companyId = input.company_id || 'default';
  const id = `qncr_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM quality_ncrs WHERE company_id = ?').get(companyId);
  const ncrNumber = `NCR-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();
  const actor = input.actor || input.assigned_to || 'usr_qc';

  dialect.prepare(`
    INSERT INTO quality_ncrs (
      id, company_id, ncr_number, inspection_id, title, severity, disposition, root_cause, state, assigned_to, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    id, companyId, ncrNumber, inspection_id, title, severity || 'minor',
    disposition || 'hold', root_cause || description || '', actor, now, now
  );

  // Update inspection state to ncr
  dialect.prepare("UPDATE quality_inspections SET state = 'ncr', updated_at = ? WHERE id = ?").run(now, inspection_id);

  return { id, ncr_number: ncrNumber, state: 'open' };
}

export function createCAPA(db, input) {
  const { title, ncr_id, action_type, description, corrective_action, target_date, assigned_to } = input;
  if (!title || !ncr_id) throw new QualityError('title and ncr_id are required', 'INPUT_MISSING_FIELD');

  const dialect = db;
  const ncr = dialect.prepare('SELECT * FROM quality_ncrs WHERE id = ?').get(ncr_id);
  if (!ncr) throw new QualityError(`ncr ${ncr_id} not found`, 'NCR_NOT_FOUND');

  const companyId = input.company_id || 'default';
  const id = `qcapa_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM quality_capas WHERE company_id = ?').get(companyId);
  const capaNumber = `CAPA-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const now = nowISO();
  const actor = input.actor || assigned_to || 'usr_qc';

  // Create canonical Work Item for tracking CAPA execution
  const workItemId = `wi_${crypto.randomUUID()}`;
  dialect.prepare(`
    INSERT INTO work_items (
      id, company_id, source_type, title, status, priority, created_at, updated_at
    ) VALUES (?, ?, 'capa_action', ?, 'todo', 'high', ?, ?)
  `).run(workItemId, companyId, `[CAPA] ${title}`, now, now);

  dialect.prepare(`
    INSERT INTO quality_capas (
      id, company_id, capa_number, ncr_id, work_item_id, title, action_type, description, state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    id, companyId, capaNumber, ncr_id, workItemId, title, action_type || 'corrective',
    corrective_action || description || '', now, now
  );

  return { id, capa_number: capaNumber, work_item_id: workItemId, state: 'open' };
}

export function closeCAPA(db, input) {
  const { capa_id } = input;
  const dialect = db;
  const capa = dialect.prepare('SELECT * FROM quality_capas WHERE id = ?').get(capa_id);
  if (!capa) throw new QualityError(`capa ${capa_id} not found`, 'CAPA_NOT_FOUND');

  const now = nowISO();
  dialect.prepare("UPDATE quality_capas SET state = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(now, now, capa_id);
  if (capa.work_item_id) {
    dialect.prepare("UPDATE work_items SET status = 'completed', updated_at = ? WHERE id = ?").run(now, capa.work_item_id);
  }

  return { id: capa_id, state: 'closed' };
}
