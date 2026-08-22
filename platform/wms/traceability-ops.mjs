// BUILD-09 traceability overlay. Canonical stock/MRP/quality records remain the source of truth.
'use strict';
import crypto from 'node:crypto';

export class TraceabilityError extends Error {
  constructor(message, code, statusCode = 422) { super(message); this.name = 'TraceabilityError'; this.code = code; this.statusCode = statusCode; }
}

const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (value, fallback = {}) => { try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; } };

function scope(input) {
  if (!input.company_id) throw new TraceabilityError('Active company is required', 'COMPANY_SCOPE_REQUIRED', 403);
  return input.company_id;
}

function canonicalIdentity(db, input) {
  const companyId = scope(input);
  if (!input.lot_id && !input.serial_id) throw new TraceabilityError('lot_id or serial_id is required', 'TRACE_IDENTITY_REQUIRED');
  const lot = input.lot_id ? db.prepare('SELECT * FROM stock_lots WHERE id=? AND company_id=?').get(input.lot_id, companyId) : null;
  const serial = input.serial_id ? db.prepare('SELECT * FROM stock_serials WHERE id=? AND company_id=?').get(input.serial_id, companyId) : null;
  if (input.lot_id && !lot) throw new TraceabilityError('Lot is outside company scope', 'LOT_SCOPE_DENIED', 403);
  if (input.serial_id && !serial) throw new TraceabilityError('Serial is outside company scope', 'SERIAL_SCOPE_DENIED', 403);
  if (lot && serial && serial.lot_id !== lot.id) throw new TraceabilityError('Serial does not belong to the selected lot', 'TRACE_IDENTITY_MISMATCH', 409);
  const productId = serial?.product_id || lot?.product_id;
  if (input.product_id && input.product_id !== productId) throw new TraceabilityError('Product does not match canonical trace identity', 'TRACE_PRODUCT_MISMATCH', 409);
  return { companyId, lot, serial, productId };
}

function profileRow(db, identity) {
  if (identity.serial) return db.prepare('SELECT * FROM wms_trace_profiles WHERE company_id=? AND serial_id=?').get(identity.companyId, identity.serial.id);
  return db.prepare('SELECT * FROM wms_trace_profiles WHERE company_id=? AND lot_id=? AND serial_id IS NULL').get(identity.companyId, identity.lot.id);
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id, companyId: row.company_id, productId: row.product_id, lotId: row.lot_id, serialId: row.serial_id,
    supplierLot: row.supplier_lot, internalLot: row.internal_lot, manufactureDate: row.manufacture_date,
    expiryDate: row.expiry_date, retestDate: row.retest_date, qualityStatus: row.quality_status,
    recallFlag: Boolean(row.recall_flag), sourceReceiptType: row.source_receipt_type,
    sourceReceiptId: row.source_receipt_id, assetId: row.asset_id, metadata: parse(row.metadata_json),
    lotNumber: row.lot_number, serialNumber: row.serial_number, locationId: row.location_id,
    updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function upsertTraceProfile(db, input) {
  const identity = canonicalIdentity(db, input);
  const existing = profileRow(db, identity);
  const stamp = now();
  const expiryDate = input.expiry_date ?? existing?.expiry_date ?? identity.lot?.expires_at ?? null;
  const manufactureDate = input.manufacture_date ?? existing?.manufacture_date ?? identity.lot?.manufactured_at ?? null;
  const qualityStatus = input.quality_status || existing?.quality_status || 'inspection';
  const allowed = ['released', 'inspection', 'conditional', 'hold', 'quarantine', 'rejected', 'expired'];
  if (!allowed.includes(qualityStatus)) throw new TraceabilityError('Invalid trace quality status', 'TRACE_QUALITY_INVALID');
  if (existing) {
    db.prepare(`UPDATE wms_trace_profiles SET supplier_lot=?,internal_lot=?,manufacture_date=?,expiry_date=?,retest_date=?,
      source_receipt_type=?,source_receipt_id=?,asset_id=?,metadata_json=?,updated_by=?,updated_at=? WHERE id=?`).run(
      input.supplier_lot ?? existing.supplier_lot, input.internal_lot ?? existing.internal_lot,
      manufactureDate, expiryDate, input.retest_date ?? existing.retest_date,
      input.source_receipt_type ?? existing.source_receipt_type, input.source_receipt_id ?? existing.source_receipt_id,
      input.asset_id ?? existing.asset_id, JSON.stringify(input.metadata ?? parse(existing.metadata_json)), input.actor, stamp, existing.id,
    );
    return mapProfile(db.prepare('SELECT * FROM wms_trace_profiles WHERE id=?').get(existing.id));
  }
  const id = uid('trace');
  db.prepare(`INSERT INTO wms_trace_profiles(
    id,company_id,product_id,lot_id,serial_id,supplier_lot,internal_lot,manufacture_date,expiry_date,retest_date,
    quality_status,recall_flag,source_receipt_type,source_receipt_id,asset_id,metadata_json,updated_by,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`).run(
    id, identity.companyId, identity.productId, identity.lot?.id || identity.serial?.lot_id || null, identity.serial?.id || null,
    input.supplier_lot || null, input.internal_lot || identity.lot?.lot_number || null, manufactureDate, expiryDate,
    input.retest_date || null, qualityStatus, input.source_receipt_type || null, input.source_receipt_id || null,
    input.asset_id || null, JSON.stringify(input.metadata || {}), input.actor, stamp, stamp,
  );
  return mapProfile(db.prepare('SELECT * FROM wms_trace_profiles WHERE id=?').get(id));
}

export function setTraceQualityStatus(db, input) {
  const identity = canonicalIdentity(db, input);
  const row = profileRow(db, identity);
  if (!row) throw new TraceabilityError('Trace profile does not exist', 'TRACE_PROFILE_MISSING', 404);
  if (row.updated_by === input.actor) throw new TraceabilityError('Quality status change requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const allowed = ['released', 'inspection', 'conditional', 'hold', 'quarantine', 'rejected', 'expired'];
  if (!allowed.includes(input.quality_status)) throw new TraceabilityError('Invalid trace quality status', 'TRACE_QUALITY_INVALID');
  const metadata = { ...parse(row.metadata_json), lastQualityDecision: { from: row.quality_status, to: input.quality_status, reason: input.reason || null, approvedBy: input.actor, at: now() } };
  db.prepare('UPDATE wms_trace_profiles SET quality_status=?,metadata_json=?,updated_by=?,updated_at=? WHERE id=?').run(input.quality_status, JSON.stringify(metadata), input.actor, now(), row.id);
  return { ...mapProfile(db.prepare('SELECT * FROM wms_trace_profiles WHERE id=?').get(row.id)), canonicalQualityWritten: false };
}

function movementRows(db, identity) {
  return db.prepare(`SELECT ml.id line_id,ml.move_id,ml.product_id,ml.lot_id,ml.serial_id,ml.quantity,ml.uom_id,
      ml.source_document_type,ml.source_document_id,ml.source_line_id,ml.created_at line_created_at,
      m.reference,m.location_id,m.location_dest_id,m.state,m.move_date
    FROM stock_move_lines ml JOIN stock_moves m ON m.id=ml.move_id
    WHERE ml.company_id=? AND (? IS NULL OR ml.lot_id=?) AND (? IS NULL OR ml.serial_id=?)
    ORDER BY m.move_date,ml.created_at`).all(identity.companyId, identity.lot?.id || identity.serial?.lot_id || null,
    identity.lot?.id || identity.serial?.lot_id || null, identity.serial?.id || null, identity.serial?.id || null);
}

function classifyMovement(row) {
  const source = String(row.source_document_type || '').toLowerCase();
  if (/production|manufactur|mrp/.test(source)) return source.includes('output') ? 'production_output' : 'production_consumption';
  if (/delivery|sale|shipment/.test(source)) return 'delivery';
  if (/purchase|receipt|supplier/.test(source)) return 'supplier';
  if (/rma/.test(source)) return 'rma';
  if (/return/.test(source)) return 'return';
  if (/asset/.test(source)) return 'asset';
  return 'stock';
}

export function queryTrace(db, input) {
  const identity = canonicalIdentity(db, input);
  const profile = profileRow(db, identity);
  const movements = movementRows(db, identity).map((row) => ({ ...row, traceType: classifyMovement(row) }));
  const locations = new Map();
  for (const move of movements) {
    locations.set(move.location_id, { locationId: move.location_id, direction: 'source', at: move.move_date, moveId: move.move_id });
    locations.set(move.location_dest_id, { locationId: move.location_dest_id, direction: 'destination', at: move.move_date, moveId: move.move_id });
  }
  const sourceReceipts = movements.filter((row) => ['supplier', 'return', 'rma'].includes(row.traceType));
  const productionConsumption = movements.filter((row) => row.traceType === 'production_consumption');
  const productionOutput = movements.filter((row) => row.traceType === 'production_output');
  const deliveries = movements.filter((row) => row.traceType === 'delivery');
  const returns = movements.filter((row) => ['return', 'rma'].includes(row.traceType));
  const assets = movements.filter((row) => row.traceType === 'asset');
  const backward = movements.map((row) => ({ from: row.location_dest_id, to: row.location_id, moveId: row.move_id, sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id }));
  const forward = movements.map((row) => ({ from: row.location_id, to: row.location_dest_id, moveId: row.move_id, sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id }));
  return {
    identity: { companyId: identity.companyId, productId: identity.productId, lot: identity.lot, serial: identity.serial },
    profile: mapProfile(profile), movements, forwardTrace: forward, backwardTrace: backward,
    currentLocation: movements.length ? movements.at(-1).location_dest_id : null,
    locationHistory: [...locations.values()], sourceReceipts, productionConsumption, productionOutput,
    deliveries, returns, assets,
    customerExposure: deliveries.map((row) => ({ sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id, quantity: row.quantity })),
    supplierExposure: sourceReceipts.map((row) => ({ sourceDocumentType: row.source_document_type, sourceDocumentId: row.source_document_id, quantity: row.quantity })),
    quality: profile ? { status: profile.quality_status, recallFlag: Boolean(profile.recall_flag), retestDate: profile.retest_date } : null,
    expiration: profile?.expiry_date || identity.lot?.expires_at || null,
  };
}

export function expirationQueue(db, input) {
  const companyId = scope(input);
  const through = input.through_date || new Date(Date.now() + Number(input.days || 30) * 86400000).toISOString();
  return db.prepare(`SELECT p.*,l.lot_number,s.serial_number,current.location_dest_id location_id FROM wms_trace_profiles p
    LEFT JOIN stock_lots l ON l.id=p.lot_id LEFT JOIN stock_serials s ON s.id=p.serial_id
    LEFT JOIN stock_move_lines current_line ON current_line.id=(
      SELECT ml.id FROM stock_move_lines ml JOIN stock_moves m ON m.id=ml.move_id
      WHERE ml.company_id=p.company_id AND (ml.lot_id=p.lot_id OR (p.serial_id IS NOT NULL AND ml.serial_id=p.serial_id))
      ORDER BY m.move_date DESC,ml.created_at DESC LIMIT 1)
    LEFT JOIN stock_moves current ON current.id=current_line.move_id
    LEFT JOIN stock_locations current_location ON current_location.id=current.location_dest_id
    WHERE p.company_id=? AND p.expiry_date IS NOT NULL AND p.expiry_date<=? AND p.quality_status NOT IN ('rejected','expired')
      AND (? IS NULL OR current_location.warehouse_id=?)
    ORDER BY p.expiry_date`).all(companyId, through, input.warehouse_id || null, input.warehouse_id || null).map(mapProfile);
}

export function recallCandidates(db, input) {
  const companyId = scope(input);
  const through = input.through_date || now();
  return db.prepare(`SELECT * FROM wms_trace_profiles WHERE company_id=? AND
    (recall_flag=1 OR quality_status IN ('hold','quarantine','rejected','expired') OR (expiry_date IS NOT NULL AND expiry_date<=?))
    ORDER BY recall_flag DESC,expiry_date`).all(companyId, through).map(mapProfile);
}

function recallRow(db, input) {
  const companyId = scope(input);
  const row = db.prepare('SELECT * FROM wms_recall_cases WHERE id=? AND company_id=?').get(input.recall_case_id, companyId);
  if (!row) throw new TraceabilityError('Recall case is outside company scope', 'RECALL_SCOPE_DENIED', 403);
  return row;
}

function mapRecall(row) {
  return { id: row.id, companyId: row.company_id, reference: row.reference, lotId: row.lot_id, serialId: row.serial_id,
    reason: row.reason, status: row.status, impactSummary: parse(row.impact_summary_json),
    notificationProposals: parse(row.notification_proposals_json, []), workItemProposals: parse(row.work_item_proposals_json, []),
    identifiedBy: row.identified_by, approvedBy: row.approved_by, identifiedAt: row.identified_at,
    updatedAt: row.updated_at, closedAt: row.closed_at };
}

export function identifyRecall(db, input) {
  const identity = canonicalIdentity(db, input);
  const reference = String(input.reference || '').trim();
  if (!reference || !input.reason) throw new TraceabilityError('Recall reference and reason are required', 'RECALL_INPUT_REQUIRED');
  const replay = db.prepare('SELECT * FROM wms_recall_cases WHERE company_id=? AND reference=?').get(identity.companyId, reference);
  if (replay) return mapRecall(replay);
  const id = uid('recall'); const stamp = now();
  db.prepare(`INSERT INTO wms_recall_cases(id,company_id,reference,lot_id,serial_id,reason,status,identified_by,identified_at,updated_at)
    VALUES(?,?,?,?,?,?,'identified',?,?,?)`).run(id, identity.companyId, reference, identity.lot?.id || identity.serial?.lot_id || null, identity.serial?.id || null, input.reason, input.actor, stamp, stamp);
  return mapRecall(db.prepare('SELECT * FROM wms_recall_cases WHERE id=?').get(id));
}

export function analyzeRecall(db, input) {
  const recall = recallRow(db, input);
  if (!['identified', 'analyzing', 'analyzed'].includes(recall.status)) throw new TraceabilityError(`Recall case is ${recall.status}`, 'RECALL_ANALYZE_INVALID_STATE', 409);
  const trace = queryTrace(db, { company_id: recall.company_id, lot_id: recall.lot_id, serial_id: recall.serial_id });
  const grouped = new Map();
  for (const row of trace.movements) {
    const type = classifyMovement(row);
    const impactType = type === 'supplier' ? 'supplier' : type;
    const recordType = row.source_document_type || 'stock_move';
    const recordId = row.source_document_id || row.move_id;
    const key = `${impactType}:${recordType}:${recordId}`;
    const previous = grouped.get(key);
    grouped.set(key, { impactType, recordType, recordId, productId: row.product_id,
      quantity: Number(row.quantity) + Number(previous?.quantity || 0), details: { moveIds: [...(previous?.details.moveIds || []), row.move_id], locationId: row.location_dest_id } });
  }
  const insert = db.prepare(`INSERT INTO wms_recall_impacts(id,recall_case_id,impact_type,record_type,record_id,product_id,quantity,company_id,details_json,hold_status)
    VALUES(?,?,?,?,?,?,?,?,?,'proposed') ON CONFLICT(recall_case_id,impact_type,record_type,record_id) DO UPDATE SET quantity=excluded.quantity,details_json=excluded.details_json`);
  for (const impact of grouped.values()) insert.run(uid('impact'), recall.id, impact.impactType, impact.recordType, impact.recordId, impact.productId, impact.quantity, recall.company_id, JSON.stringify(impact.details));
  const impacts = db.prepare('SELECT * FROM wms_recall_impacts WHERE recall_case_id=? ORDER BY impact_type,record_type,record_id').all(recall.id);
  const summary = impacts.reduce((acc, impact) => { acc.totalRecords += 1; acc.totalQuantity += Number(impact.quantity || 0); acc.byType[impact.impact_type] = (acc.byType[impact.impact_type] || 0) + 1; return acc; }, { totalRecords: 0, totalQuantity: 0, byType: {} });
  const notifications = impacts.filter((impact) => ['customer', 'delivery', 'supplier'].includes(impact.impact_type)).map((impact) => ({ channel: 'proposal_only', audienceType: impact.impact_type, recordType: impact.record_type, recordId: impact.record_id, sendAuthorized: false }));
  const workItems = impacts.map((impact) => ({ title: `Assess recall impact ${impact.record_type}/${impact.record_id}`, sourceType: 'wms_recall_case', sourceId: recall.id, impactType: impact.impact_type, createAuthorized: false }));
  db.prepare(`UPDATE wms_recall_cases SET status='analyzed',impact_summary_json=?,notification_proposals_json=?,work_item_proposals_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(summary), JSON.stringify(notifications), JSON.stringify(workItems), now(), recall.id);
  return { ...mapRecall(db.prepare('SELECT * FROM wms_recall_cases WHERE id=?').get(recall.id)), impacts, externalMessagesSent: false, workItemsCreated: false };
}

export function proposeRecallHolds(db, input) {
  const recall = recallRow(db, input);
  if (recall.status !== 'analyzed') throw new TraceabilityError(`Recall case is ${recall.status}`, 'RECALL_HOLD_INVALID_STATE', 409);
  if (recall.identified_by === input.actor) throw new TraceabilityError('Recall hold approval requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  db.prepare(`UPDATE wms_recall_cases SET status='hold_proposed',approved_by=?,updated_at=? WHERE id=?`).run(input.actor, now(), recall.id);
  const impacts = db.prepare('SELECT * FROM wms_recall_impacts WHERE recall_case_id=?').all(recall.id);
  const holdRequests = impacts.map((impact) => ({ canonicalAction: impact.impact_type === 'stock' ? 'quality:hold:request' : 'work_item:create', impactId: impact.id, recordType: impact.record_type, recordId: impact.record_id, executionBoundary: 'REQUEST_ONLY' }));
  return { ...mapRecall(db.prepare('SELECT * FROM wms_recall_cases WHERE id=?').get(recall.id)), holdRequests, canonicalStockWritten: false, canonicalQualityWritten: false };
}

export function closeRecall(db, input) {
  const recall = recallRow(db, input);
  if (!['hold_proposed', 'approved', 'cancelled'].includes(recall.status)) throw new TraceabilityError(`Recall case is ${recall.status}`, 'RECALL_CLOSE_INVALID_STATE', 409);
  if (recall.identified_by === input.actor) throw new TraceabilityError('Recall closure requires maker-checker', 'MAKER_CHECKER_REQUIRED', 403);
  const stamp = now();
  db.prepare(`UPDATE wms_recall_cases SET status='closed',approved_by=COALESCE(approved_by,?),closed_at=?,updated_at=? WHERE id=?`).run(input.actor, stamp, stamp, recall.id);
  return mapRecall(db.prepare('SELECT * FROM wms_recall_cases WHERE id=?').get(recall.id));
}

export function listRecallCases(db, input) {
  const companyId = scope(input); let sql = 'SELECT * FROM wms_recall_cases WHERE company_id=?'; const params = [companyId];
  if (input.status) { sql += ' AND status=?'; params.push(input.status); }
  sql += ' ORDER BY identified_at DESC';
  return db.prepare(sql).all(...params).map(mapRecall);
}
