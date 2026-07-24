import crypto from 'node:crypto';

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function positiveQuantity(value, label = 'quantity') {
  const quantity = Number(value);
  if (!(quantity > 0)) throw new Error(`${label} must be greater than zero`);
  return quantity;
}

function reservationUsage(db, reservationId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event_type = 'consumed' THEN quantity ELSE 0 END), 0) AS consumed,
      COALESCE(SUM(CASE WHEN event_type IN ('released','expired') THEN quantity ELSE 0 END), 0) AS released,
      COALESCE(SUM(CASE WHEN event_type = 'reversed' THEN quantity ELSE 0 END), 0) AS reversed
    FROM stock_reservation_events
    WHERE reservation_id = ?
  `).get(reservationId);
  return {
    consumed: Number(row.consumed || 0),
    released: Number(row.released || 0),
    reversed: Number(row.reversed || 0),
  };
}

function remainingQuantity(db, reservation) {
  const usage = reservationUsage(db, reservation.id);
  return Math.max(0, Number(reservation.quantity) - usage.consumed - usage.released + usage.reversed);
}

function getScopedReservation(db, companyId, reservationId) {
  const reservation = db.prepare(`
    SELECT r.*, trace.serial_id
    FROM stock_reservations r
    LEFT JOIN stock_reservation_traceability trace ON trace.reservation_id = r.id
    WHERE r.id = ? AND r.company_id = ?
  `).get(reservationId, companyId);
  if (!reservation) throw new Error(`Reservation not found: ${reservationId}`);
  return reservation;
}

function adjustReservedProjection(db, reservation, delta) {
  const quant = db.prepare(`
    SELECT id, quantity, reserved_quantity FROM stock_quants
    WHERE company_id = ? AND product_id = ? AND location_id = ?
  `).get(reservation.company_id, reservation.product_id, reservation.location_id);
  if (!quant) throw new Error('Reservation balance projection is missing');
  const next = Number(quant.reserved_quantity || 0) + Number(delta);
  if (next < -0.0000001 || next > Number(quant.quantity || 0) + 0.0000001) {
    throw new Error('Reservation projection would exceed on-hand stock');
  }
  db.prepare(`
    UPDATE stock_quants SET reserved_quantity = ?, updated_at = ? WHERE id = ?
  `).run(Math.max(0, next), new Date().toISOString(), quant.id);
}

function appendEvent(db, reservation, {
  event_type,
  quantity,
  idempotency_key,
  actor,
  from_location_id = null,
  to_location_id = null,
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO stock_reservation_events (
      id, reservation_id, company_id, event_type, quantity,
      from_location_id, to_location_id, serial_id, source_document_type,
      source_document_id, source_line_id, idempotency_key, actor_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id('sre'),
    reservation.id,
    reservation.company_id,
    event_type,
    quantity,
    from_location_id,
    to_location_id,
    reservation.serial_id || null,
    reservation.source_document_type,
    reservation.source_document_id,
    reservation.source_line_id || null,
    idempotency_key,
    actor,
    now,
  );
}

export function reserveStock(db, payload) {
  const {
    company_id,
    branch_id = null,
    warehouse_id,
    location_id,
    product_id,
    lot_id = null,
    serial_id = null,
    package_id = null,
    source_document_type,
    source_document_id,
    source_line_id = null,
    priority = 10,
    expires_at = null,
    allow_partial = false,
    idempotency_key,
    actor,
  } = payload;
  const requested = positiveQuantity(payload.quantity);
  if (!warehouse_id || !location_id || !product_id || !source_document_type || !source_document_id) {
    throw new Error('warehouse, location, product, source document type, and source document id are required');
  }
  const location = db.prepare(`
    SELECT id FROM stock_locations
    WHERE id = ? AND company_id = ? AND warehouse_id = ? AND usage = 'internal'
  `).get(location_id, company_id, warehouse_id);
  if (!location) throw new Error('Reservation location is outside the active warehouse scope');
  if (branch_id) {
    const branchScope = db.prepare(`
      SELECT 1 FROM warehouse_branch_scopes
      WHERE warehouse_id = ? AND company_id = ? AND branch_id = ?
    `).get(warehouse_id, company_id, branch_id);
    if (!branchScope) throw new Error('Reservation warehouse is outside the active branch scope');
  }
  const product = db.prepare('SELECT id FROM product_variants WHERE id = ? AND company_id = ?').get(product_id, company_id);
  if (!product) throw new Error('Reservation product is outside the active company');
  if (serial_id && requested !== 1) throw new Error('Serialized reservations require quantity 1');

  const quant = db.prepare(`
    SELECT quantity, reserved_quantity FROM stock_quants
    WHERE company_id = ? AND product_id = ? AND location_id = ?
  `).get(company_id, product_id, location_id);
  const available = Number(quant?.quantity || 0) - Number(quant?.reserved_quantity || 0);
  const allocated = allow_partial ? Math.min(requested, Math.max(0, available)) : requested;
  if (!(allocated > 0) || (!allow_partial && available + 0.0000001 < requested)) {
    throw new Error(`Available stock insufficient for reservation by ${requested - Math.max(0, available)}`);
  }

  const now = new Date().toISOString();
  const reservation = {
    id: payload.id || id('sres'),
    company_id,
    branch_id,
    warehouse_id,
    location_id,
    product_id,
    lot_id,
    serial_id,
    package_id,
    source_document_type,
    source_document_id,
    source_line_id,
    quantity: allocated,
    status: allocated < requested ? 'partially_reserved' : 'reserved',
    priority: Number(priority) || 10,
    expires_at,
  };
  db.prepare(`
    INSERT INTO stock_reservations (
      id, company_id, branch_id, warehouse_id, location_id, product_id,
      variant_id, lot_id, package_id, source_document_type, source_document_id,
      source_line_id, quantity, status, priority, expires_at, version,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    reservation.id,
    company_id,
    branch_id,
    warehouse_id,
    location_id,
    product_id,
    product_id,
    lot_id,
    package_id,
    source_document_type,
    source_document_id,
    source_line_id,
    allocated,
    reservation.status,
    reservation.priority,
    expires_at,
    now,
    now,
  );
  if (serial_id) {
    db.prepare(`
      INSERT INTO stock_reservation_traceability (reservation_id, serial_id, created_at)
      VALUES (?, ?, ?)
    `).run(reservation.id, serial_id, now);
  }
  adjustReservedProjection(db, reservation, allocated);
  appendEvent(db, reservation, {
    event_type: allocated < requested ? 'partially_reserved' : 'reserved',
    quantity: allocated,
    idempotency_key: `${idempotency_key}:reserve`,
    actor,
    to_location_id: location_id,
  });
  return { ...reservation, requested_quantity: requested, remaining_quantity: allocated, version: 1, created_at: now, updated_at: now };
}

export function releaseReservation(db, payload) {
  const reservation = getScopedReservation(db, payload.company_id, payload.reservation_id);
  const remaining = remainingQuantity(db, reservation);
  if (!(remaining > 0)) throw new Error('Reservation has no releasable quantity');
  adjustReservedProjection(db, reservation, -remaining);
  appendEvent(db, reservation, {
    event_type: 'released',
    quantity: remaining,
    idempotency_key: `${payload.idempotency_key}:release`,
    actor: payload.actor,
    from_location_id: reservation.location_id,
  });
  db.prepare(`
    UPDATE stock_reservations
    SET status = 'released', version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), reservation.id);
  return { ...getScopedReservation(db, payload.company_id, reservation.id), remaining_quantity: 0 };
}

export function expireReservation(db, payload) {
  const reservation = getScopedReservation(db, payload.company_id, payload.reservation_id);
  const remaining = remainingQuantity(db, reservation);
  if (!(remaining > 0)) throw new Error('Reservation has no expirable quantity');
  if (reservation.expires_at && reservation.expires_at > new Date().toISOString() && !payload.force) {
    throw new Error('Reservation has not expired');
  }
  adjustReservedProjection(db, reservation, -remaining);
  appendEvent(db, reservation, {
    event_type: 'expired',
    quantity: remaining,
    idempotency_key: `${payload.idempotency_key}:expire`,
    actor: payload.actor,
    from_location_id: reservation.location_id,
  });
  db.prepare("UPDATE stock_reservations SET status = 'expired', version = version + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), reservation.id);
  return { ...getScopedReservation(db, payload.company_id, reservation.id), remaining_quantity: 0 };
}

export function consumeReservation(db, payload) {
  const reservation = getScopedReservation(db, payload.company_id, payload.reservation_id);
  const remaining = remainingQuantity(db, reservation);
  const quantity = positiveQuantity(payload.quantity);
  if (quantity > remaining + 0.0000001) throw new Error('Reservation consumption exceeds remaining quantity');
  adjustReservedProjection(db, reservation, -quantity);
  appendEvent(db, reservation, {
    event_type: 'consumed',
    quantity,
    idempotency_key: `${payload.idempotency_key}:consume`,
    actor: payload.actor,
    from_location_id: reservation.location_id,
  });
  const nextRemaining = remaining - quantity;
  db.prepare(`
    UPDATE stock_reservations
    SET status = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(nextRemaining <= 0.0000001 ? 'consumed' : 'partially_reserved', new Date().toISOString(), reservation.id);
  return { ...getScopedReservation(db, payload.company_id, reservation.id), remaining_quantity: Math.max(0, nextRemaining) };
}

export function reallocateReservation(db, payload) {
  const reservation = getScopedReservation(db, payload.company_id, payload.reservation_id);
  const remaining = remainingQuantity(db, reservation);
  if (!(remaining > 0)) throw new Error('Reservation has no reallocatable quantity');
  const target = db.prepare(`
    SELECT id FROM stock_locations
    WHERE id = ? AND company_id = ? AND warehouse_id = ? AND usage = 'internal'
  `).get(payload.location_id, payload.company_id, payload.warehouse_id);
  if (!target) throw new Error('Reallocation target is outside the active warehouse scope');
  const targetQuant = db.prepare(`
    SELECT quantity, reserved_quantity FROM stock_quants
    WHERE company_id = ? AND product_id = ? AND location_id = ?
  `).get(payload.company_id, reservation.product_id, payload.location_id);
  const targetAvailable = Number(targetQuant?.quantity || 0) - Number(targetQuant?.reserved_quantity || 0);
  if (targetAvailable + 0.0000001 < remaining) throw new Error('Reallocation target has insufficient available stock');
  adjustReservedProjection(db, reservation, -remaining);
  const targetReservation = { ...reservation, warehouse_id: payload.warehouse_id, location_id: payload.location_id };
  adjustReservedProjection(db, targetReservation, remaining);
  appendEvent(db, reservation, {
    event_type: 'reallocated',
    quantity: remaining,
    idempotency_key: `${payload.idempotency_key}:reallocate`,
    actor: payload.actor,
    from_location_id: reservation.location_id,
    to_location_id: payload.location_id,
  });
  db.prepare(`
    UPDATE stock_reservations
    SET warehouse_id = ?, location_id = ?, version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(payload.warehouse_id, payload.location_id, new Date().toISOString(), reservation.id);
  return { ...getScopedReservation(db, payload.company_id, reservation.id), remaining_quantity: remaining };
}

export function reverseReservationConsumption(db, payload) {
  const reservation = getScopedReservation(db, payload.company_id, payload.reservation_id);
  const usage = reservationUsage(db, reservation.id);
  const quantity = positiveQuantity(payload.quantity);
  if (quantity > usage.consumed - usage.reversed + 0.0000001) {
    throw new Error('Reservation reversal exceeds consumed quantity');
  }
  adjustReservedProjection(db, reservation, quantity);
  appendEvent(db, reservation, {
    event_type: 'reversed',
    quantity,
    idempotency_key: `${payload.idempotency_key}:reverse`,
    actor: payload.actor,
    to_location_id: reservation.location_id,
  });
  db.prepare(`
    UPDATE stock_reservations
    SET status = 'reserved', version = version + 1, updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), reservation.id);
  return { ...getScopedReservation(db, payload.company_id, reservation.id), remaining_quantity: remainingQuantity(db, reservation) };
}

export function listReservations(db, { company_id, warehouse_id = null, source_document_id = null, status = null }) {
  let sql = `
    SELECT r.*, trace.serial_id
    FROM stock_reservations r
    LEFT JOIN stock_reservation_traceability trace ON trace.reservation_id = r.id
    WHERE r.company_id = ?
  `;
  const params = [company_id];
  if (warehouse_id) {
    sql += ' AND r.warehouse_id = ?';
    params.push(warehouse_id);
  }
  if (source_document_id) {
    sql += ' AND r.source_document_id = ?';
    params.push(source_document_id);
  }
  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.priority, r.created_at, r.id';
  return db.prepare(sql).all(...params).map((row) => ({
    ...row,
    remaining_quantity: remainingQuantity(db, row),
  }));
}
