// platform/domains/rental/service.mjs — Rental and Equipment Hire Domain Services.

export function getAgreement(db, agreementId, companyId) {
  const row = db.prepare(`
    SELECT * FROM rental_agreements WHERE id = ? AND (company_id = ? OR company_id = '*')
  `).get(agreementId, companyId);
  return row || null;
}

export function generateAgreementNumber(db, companyId) {
  const year = new Date().getFullYear();
  const prefix = `RNT-${year}-`;
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM rental_agreements WHERE company_id = ? AND agreement_number LIKE ?
  `).get(companyId, `${prefix}%`);
  const seq = (countRow ? countRow.cnt : 0) + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

export function configureRentalProduct(db, {
  company_id,
  product_id,
  asset_id = null,
  daily_rate,
  weekly_rate = 0,
  monthly_rate = 0,
  deposit_amount = 0,
  is_serialized = 0
}) {
  const existing = db.prepare('SELECT id FROM rental_product_configs WHERE company_id = ? AND product_id = ?').get(company_id, product_id);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE rental_product_configs
      SET asset_id = ?, daily_rate = ?, weekly_rate = ?, monthly_rate = ?,
          deposit_amount = ?, is_serialized = ?, updated_at = ?
      WHERE id = ?
    `).run(asset_id, daily_rate, weekly_rate, monthly_rate, deposit_amount, is_serialized, now, existing.id);
    return db.prepare('SELECT * FROM rental_product_configs WHERE id = ?').get(existing.id);
  }

  const id = `rpc-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO rental_product_configs (
      id, company_id, product_id, asset_id, daily_rate, weekly_rate,
      monthly_rate, deposit_amount, is_serialized, is_available_for_rent,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, company_id, product_id, asset_id, daily_rate, weekly_rate, monthly_rate, deposit_amount, is_serialized, now, now);

  return db.prepare('SELECT * FROM rental_product_configs WHERE id = ?').get(id);
}

/**
 * Checks if a product/asset has overlapping active reservations or maintenance holds.
 * Prevents double booking!
 */
export function checkAvailability(db, { product_id, asset_id = null, start_date, end_date }) {
  // Check overlapping reservations
  const overlappingRes = db.prepare(`
    SELECT COUNT(*) as cnt FROM rental_reservations
    WHERE product_id = ? AND status = 'confirmed'
      AND (asset_id IS NULL OR ? IS NULL OR asset_id = ?)
      AND NOT (reserved_to <= ? OR reserved_from >= ?)
  `).get(product_id, asset_id, asset_id, start_date, end_date);

  if (overlappingRes && overlappingRes.cnt > 0) {
    return { available: false, reason: 'DOUBLE_BOOKING_CONFLICT: Product/Asset is already reserved during this window' };
  }

  // Check maintenance holds
  const overlappingMaint = db.prepare(`
    SELECT COUNT(*) as cnt FROM rental_maintenance_holds
    WHERE product_id = ?
      AND (asset_id IS NULL OR ? IS NULL OR asset_id = ?)
      AND NOT (end_date <= ? OR start_date >= ?)
  `).get(product_id, asset_id, asset_id, start_date, end_date);

  if (overlappingMaint && overlappingMaint.cnt > 0) {
    return { available: false, reason: 'MAINTENANCE_HOLD_CONFLICT: Equipment is undergoing scheduled maintenance' };
  }

  return { available: true };
}

export function createAgreement(db, {
  company_id,
  branch_id = null,
  party_id,
  project_id = null,
  planned_start,
  planned_end,
  currency = 'IQD',
  lines = []
}, user) {
  if (!company_id || !party_id || !planned_start || !planned_end) {
    throw new Error('MISSING_REQUIRED_FIELDS: company_id, party_id, planned_start, planned_end are required');
  }

  // Verify availability for each line
  for (const line of lines) {
    const avail = checkAvailability(db, {
      product_id: line.product_id,
      asset_id: line.asset_id || null,
      start_date: planned_start,
      end_date: planned_end
    });

    if (!avail.available) {
      throw new Error(`UNAVAILABLE_FOR_RENT: ${avail.reason}`);
    }
  }

  const id = `rnt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const agreement_number = generateAgreementNumber(db, company_id);
  const now = new Date().toISOString();

  let totalRent = 0;
  let totalDeposit = 0;

  db.prepare(`
    INSERT INTO rental_agreements (
      id, company_id, branch_id, agreement_number, party_id, project_id,
      status, planned_start, planned_end, currency, total_rent_amount,
      deposit_amount, version, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      'reserved', ?, ?, ?, 0.0,
      0.0, 1, ?, ?, ?
    )
  `).run(
    id, company_id, branch_id, agreement_number, party_id, project_id,
    planned_start, planned_end, currency, user.id || 'system', now, now
  );

  // Add Lines and Create Reservations
  for (const line of lines) {
    const lineId = `rntl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const cfg = db.prepare('SELECT * FROM rental_product_configs WHERE company_id = ? AND product_id = ?').get(company_id, line.product_id);
    const dailyRate = line.unit_daily_rate !== undefined ? line.unit_daily_rate : (cfg ? cfg.daily_rate : 0);
    const deposit = cfg ? cfg.deposit_amount : 0;

    const startDateObj = new Date(planned_start);
    const endDateObj = new Date(planned_end);
    const diffTime = Math.abs(endDateObj - startDateObj);
    const rentalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const lineTotal = dailyRate * rentalDays * (line.quantity || 1);

    totalRent += lineTotal;
    totalDeposit += deposit;

    db.prepare(`
      INSERT INTO rental_lines (id, agreement_id, product_id, asset_id, quantity, unit_daily_rate, rental_days, total_amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
    `).run(lineId, id, line.product_id, line.asset_id || null, line.quantity || 1, dailyRate, rentalDays, lineTotal, now);

    // Lock availability window in reservations
    const resId = `res-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    db.prepare(`
      INSERT INTO rental_reservations (id, agreement_id, product_id, asset_id, reserved_from, reserved_to, quantity, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
    `).run(resId, id, line.product_id, line.asset_id || null, planned_start, planned_end, line.quantity || 1, now);
  }

  // Update totals
  db.prepare(`
    UPDATE rental_agreements SET total_rent_amount = ?, deposit_amount = ? WHERE id = ?
  `).run(totalRent, totalDeposit, id);

  // Add Deposit tracking record if deposit required
  if (totalDeposit > 0) {
    const depId = `dep-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    db.prepare(`
      INSERT INTO rental_deposits (id, agreement_id, amount, status, created_at, updated_at)
      VALUES (?, ?, ?, 'held', ?, ?)
    `).run(depId, id, totalDeposit, now, now);
  }

  return getAgreement(db, id, company_id);
}

export function handoverRental(db, { agreement_id, company_id, received_by_person, notes = '' }, user) {
  const ag = getAgreement(db, agreement_id, company_id);
  if (!ag) {
    throw new Error(`AGREEMENT_NOT_FOUND: Rental agreement ${agreement_id} not found`);
  }

  if (ag.status !== 'reserved' && ag.status !== 'prepared') {
    throw new Error(`INVALID_HANDOVER_STATE: Cannot handover agreement in state ${ag.status}`);
  }

  const now = new Date().toISOString();
  const hoId = `ho-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  db.prepare(`
    INSERT INTO rental_handovers (id, agreement_id, handover_date, handover_by_user_id, received_by_person, checklist_verified, notes, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(hoId, agreement_id, now, user.id || 'system', received_by_person, notes, now);

  db.prepare(`
    UPDATE rental_agreements SET status = 'active', actual_start = ?, updated_at = ? WHERE id = ? AND company_id = ?
  `).run(now, now, agreement_id, company_id);

  return getAgreement(db, agreement_id, company_id);
}

export function extendRental(db, { agreement_id, company_id, extension_days, additional_amount = 0 }, user) {
  const ag = getAgreement(db, agreement_id, company_id);
  if (!ag) {
    throw new Error(`AGREEMENT_NOT_FOUND: Rental agreement ${agreement_id} not found`);
  }

  if (ag.status !== 'active' && ag.status !== 'extended') {
    throw new Error(`CANNOT_EXTEND: Rental agreement is not active (current: ${ag.status})`);
  }

  const currentEndObj = new Date(ag.planned_end);
  const newEndObj = new Date(currentEndObj);
  newEndObj.setDate(newEndObj.getDate() + extension_days);
  const newEndStr = newEndObj.toISOString();
  const now = new Date().toISOString();

  const extId = `ext-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  db.prepare(`
    INSERT INTO rental_extensions (id, agreement_id, extension_days, previous_end, new_end, additional_amount, approved_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(extId, agreement_id, extension_days, ag.planned_end, newEndStr, additional_amount, user.id || 'system', now);

  const updatedRent = ag.total_rent_amount + additional_amount;

  db.prepare(`
    UPDATE rental_agreements SET status = 'extended', planned_end = ?, total_rent_amount = ?, updated_at = ? WHERE id = ? AND company_id = ?
  `).run(newEndStr, updatedRent, now, agreement_id, company_id);

  // Extend reservation window
  db.prepare(`
    UPDATE rental_reservations SET reserved_to = ? WHERE agreement_id = ?
  `).run(newEndStr, agreement_id);

  return getAgreement(db, agreement_id, company_id);
}

export function returnRental(db, { agreement_id, company_id, is_damaged = 0, notes = '' }, user) {
  const ag = getAgreement(db, agreement_id, company_id);
  if (!ag) {
    throw new Error(`AGREEMENT_NOT_FOUND: Rental agreement ${agreement_id} not found`);
  }

  const now = new Date().toISOString();
  const retId = `ret-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

  db.prepare(`
    INSERT INTO rental_returns (id, agreement_id, return_date, received_by_user_id, is_damaged, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(retId, agreement_id, now, user.id || 'system', is_damaged ? 1 : 0, notes, now);

  const nextStatus = is_damaged ? 'damaged' : 'returned';

  db.prepare(`
    UPDATE rental_agreements SET status = ?, actual_end = ?, updated_at = ? WHERE id = ? AND company_id = ?
  `).run(nextStatus, now, now, agreement_id, company_id);

  // Release reservations
  db.prepare(`
    UPDATE rental_reservations SET status = 'released' WHERE agreement_id = ?
  `).run(agreement_id);

  return getAgreement(db, agreement_id, company_id);
}

export function setMaintenanceHold(db, { product_id, asset_id = null, start_date, end_date, reason }) {
  const id = `mhold-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO rental_maintenance_holds (id, product_id, asset_id, start_date, end_date, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, product_id, asset_id || null, start_date, end_date, reason, now);

  return db.prepare('SELECT * FROM rental_maintenance_holds WHERE id = ?').get(id);
}

export function listAgreements(db, { company_id, status, party_id, limit = 100, offset = 0 }) {
  const filters = ['(company_id = ? OR company_id = \'*\')'];
  const params = [company_id];

  if (status) { filters.push('status = ?'); params.push(status); }
  if (party_id) { filters.push('party_id = ?'); params.push(party_id); }

  const where = filters.join(' AND ');
  const rows = db.prepare(`SELECT * FROM rental_agreements WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), Number(offset));
  const total = db.prepare(`SELECT COUNT(*) as n FROM rental_agreements WHERE ${where}`).get(...params).n;

  return { rows, total };
}
