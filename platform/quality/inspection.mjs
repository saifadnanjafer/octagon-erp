// platform/quality/inspection.mjs — Quality Plans & Inspections Domain Engine.

'use strict';

import crypto from 'node:crypto';

export class QualityError extends Error {
  constructor(message, code = 'QUALITY_ERROR', statusCode = 422) {
    super(message);
    this.name = 'QualityError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function nowISO() {
  return new Date().toISOString();
}

export function createQualityPlan(db, input) {
  const { name, title, code, product_id, category, inspection_points, points } = input;
  const planName = name || title;
  if (!planName) throw new QualityError('name is required', 'INPUT_MISSING_FIELD');

  const companyId = input.company_id || 'default';
  const dialect = db;
  const id = `qplan_${crypto.randomUUID()}`;
  const planCode = code || `QP-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO quality_plans (id, company_id, code, name, product_id, category, version, state, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'approved', ?, ?)
  `).run(id, companyId, planCode, planName, product_id || null, category || 'general', now, now);

  const pts = Array.isArray(inspection_points) ? inspection_points : (Array.isArray(points) ? points : []);
  if (pts.length > 0) {
    for (const pt of pts) {
      const ptId = pt.id || `qpt_${crypto.randomUUID()}`;
      dialect.prepare(`
        INSERT INTO quality_inspection_points (id, company_id, plan_id, sequence, title, test_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(ptId, companyId, id, pt.sequence || 10, pt.title || pt.parameter || 'Inspection Point', pt.test_type || 'pass_fail', now);
    }
  } else {
    const ptId = `qpt_${crypto.randomUUID()}`;
    dialect.prepare(`
      INSERT INTO quality_inspection_points (id, company_id, plan_id, sequence, title, test_type, created_at)
      VALUES (?, ?, ?, 10, 'General Quality Point', 'pass_fail', ?)
    `).run(ptId, companyId, id, now);
  }

  return { id, code: planCode, title: planName, name: planName, state: 'approved' };
}

export function createQualityInspection(db, input) {
  const { inspection_type, source_type, source_id, product_id, lot_number, serial_number, sample_size, plan_id, domain_type, reference_id } = input;
  const iType = inspection_type || domain_type || 'incoming';
  const sType = source_type || 'purchase_receipt';
  const sId = source_id || reference_id || 'PO-001';
  const pId = product_id || 'prod_default';
  const dialect = db;

  const companyId = input.company_id || 'default';
  const id = `qinsp_${crypto.randomUUID()}`;
  const countRow = dialect.prepare('SELECT COUNT(*) as c FROM quality_inspections WHERE company_id = ?').get(companyId);
  const inspNumber = `QI-${String((countRow?.c || 0) + 1).padStart(5, '0')}`;
  const sSize = Number(sample_size || 1.0);
  const now = nowISO();

  dialect.prepare(`
    INSERT INTO quality_inspections (
      id, company_id, plan_id, inspection_number, inspection_type, source_type, source_id,
      product_id, lot_number, serial_number, sample_size, inspected_quantity, passed_quantity,
      failed_quantity, state, inspector_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 0.0, 'pending', ?, ?, ?)
  `).run(
    id, companyId, plan_id || null, inspNumber, iType, sType, sId,
    pId, lot_number || null, serial_number || null, sSize, input.inspector_id || input.actor || 'usr_inspector', now, now
  );

  return { id, inspection_number: inspNumber, state: 'pending' };
}

export function recordInspectionResults(db, input) {
  const { inspection_id, point_id, result_value, pass_fail, notes, plan_id, results } = input;
  const dialect = db;
  let inspId = inspection_id;
  const now = nowISO();

  if (!inspId && plan_id) {
    const created = createQualityInspection(dialect, input);
    inspId = created.id;
  }

  const insp = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(inspId);
  if (!insp) throw new QualityError(`inspection ${inspId} not found`, 'QUALITY_INSPECTION_NOT_FOUND');

  // Resolve or create fallback point
  let fallbackPtId = point_id;
  if (!fallbackPtId && insp.plan_id) {
    fallbackPtId = dialect.prepare('SELECT id FROM quality_inspection_points WHERE plan_id = ? LIMIT 1').get(insp.plan_id)?.id;
  }
  if (!fallbackPtId) {
    fallbackPtId = dialect.prepare('SELECT id FROM quality_inspection_points LIMIT 1').get()?.id;
  }
  if (!fallbackPtId) {
    fallbackPtId = `qpt_${crypto.randomUUID()}`;
    dialect.prepare(`
      INSERT INTO quality_inspection_points (id, company_id, plan_id, sequence, title, test_type, created_at)
      VALUES (?, ?, ?, 10, 'General Inspection Point', 'pass_fail', ?)
    `).run(fallbackPtId, insp.company_id, insp.plan_id || 'qplan_default', now);
  }

  let hasFail = false;
  if (Array.isArray(results) && results.length > 0) {
    for (const r of results) {
      const resId = `qres_${crypto.randomUUID()}`;
      if (r.result === 'fail') hasFail = true;
      dialect.prepare(`
        INSERT INTO quality_inspection_results (id, company_id, inspection_id, point_id, result_value, pass_fail, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(resId, insp.company_id, inspId, r.point_id || fallbackPtId, r.value_num !== undefined ? String(r.value_num) : null, r.result || 'pass', r.notes || '', now);
    }
  } else {
    const resId = `qres_${crypto.randomUUID()}`;
    if (pass_fail === 'fail') hasFail = true;
    dialect.prepare(`
      INSERT INTO quality_inspection_results (id, company_id, inspection_id, point_id, result_value, pass_fail, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(resId, insp.company_id, inspId, point_id || fallbackPtId, result_value !== undefined ? String(result_value) : null, pass_fail || 'pass', notes || '', now);
  }

  const finalState = hasFail ? 'fail' : 'pass';
  dialect.prepare('UPDATE quality_inspections SET state = ?, updated_at = ? WHERE id = ?').run(finalState, now, inspId);
  return { id: inspId, overall_result: finalState, state: finalState };
}

export function passInspection(db, input) {
  const { inspection_id, inspected_quantity } = input;
  const dialect = db;
  const insp = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(inspection_id);
  if (!insp) throw new QualityError(`inspection ${inspection_id} not found`, 'QUALITY_INSPECTION_NOT_FOUND');

  const qty = inspected_quantity ? Number(inspected_quantity) : insp.sample_size;
  const now = nowISO();
  const actor = input.actor || input.inspector_id || 'usr_inspector';

  dialect.prepare(`
    UPDATE quality_inspections
    SET state = 'pass', inspected_quantity = ?, passed_quantity = ?, inspector_id = ?, inspected_at = ?, updated_at = ?
    WHERE id = ?
  `).run(qty, qty, actor, now, now, inspection_id);

  return { id: inspection_id, state: 'pass', passed_quantity: qty };
}

export function failInspection(db, input) {
  const { inspection_id, inspected_quantity, failed_quantity } = input;
  const dialect = db;
  const insp = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(inspection_id);
  if (!insp) throw new QualityError(`inspection ${inspection_id} not found`, 'QUALITY_INSPECTION_NOT_FOUND');

  const iQty = inspected_quantity ? Number(inspected_quantity) : insp.sample_size;
  const fQty = failed_quantity ? Number(failed_quantity) : iQty;
  const pQty = iQty - fQty;
  const now = nowISO();
  const actor = input.actor || input.inspector_id || 'usr_inspector';

  dialect.prepare(`
    UPDATE quality_inspections
    SET state = 'fail', inspected_quantity = ?, passed_quantity = ?, failed_quantity = ?, inspector_id = ?, inspected_at = ?, updated_at = ?
    WHERE id = ?
  `).run(iQty, Math.max(0, pQty), fQty, actor, now, now, inspection_id);

  return { id: inspection_id, state: 'fail', failed_quantity: fQty };
}

export function releaseInspection(db, input) {
  const { inspection_id } = input;
  const dialect = db;
  const insp = dialect.prepare('SELECT * FROM quality_inspections WHERE id = ?').get(inspection_id);
  if (!insp) throw new QualityError(`inspection ${inspection_id} not found`, 'QUALITY_INSPECTION_NOT_FOUND');

  dialect.prepare("UPDATE quality_inspections SET state = 'released', updated_at = ? WHERE id = ?").run(nowISO(), inspection_id);
  return { id: inspection_id, state: 'released' };
}
