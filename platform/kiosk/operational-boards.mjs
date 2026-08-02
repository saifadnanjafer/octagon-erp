// BUILD-10 Slice 5: Configurable Large-Screen Operational Boards
'use strict';

export function upsertBoardConfig(db, input, ctx) {
  const companyId = ctx.company_id || ctx.companyId;
  const boardKey = input.board_key || input.boardKey;
  const titleAr = input.title_ar || input.titleAr || 'شاشة العمليات';
  const titleEn = input.title_en || input.titleEn || 'Operations Board';
  const actor = ctx.actor || ctx.actorId || ctx.userId || 'system';
  const now = new Date().toISOString();

  if (!companyId) {
    const error = new Error('Company scope required for board config');
    error.code = 'COMPANY_SCOPE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const id = `brdc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO operational_board_configs (id, company_id, branch_id, board_key, title_ar, title_en, auto_refresh_seconds, layout_config_json, is_read_only, is_active, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
    ON CONFLICT(company_id, board_key) DO UPDATE SET
      title_ar = excluded.title_ar,
      title_en = excluded.title_en,
      auto_refresh_seconds = excluded.auto_refresh_seconds,
      layout_config_json = excluded.layout_config_json,
      updated_at = excluded.updated_at
  `).run(id, companyId, ctx.branch_id || ctx.branchId || null, boardKey, titleAr, titleEn, input.auto_refresh_seconds || 15, JSON.stringify(input.layout_config || {}), actor, now, now);

  return { id, companyId, boardKey, titleAr, titleEn, autoRefreshSeconds: input.auto_refresh_seconds || 15, isReadOnly: true };
}

export function getBoardData(db, params) {
  const companyId = params.company_id || params.companyId;
  const boardKey = params.board_key || params.boardKey;

  if (!companyId || !boardKey) {
    const error = new Error('Company scope and board key are required');
    error.code = 'BOARD_PARAMS_REQUIRED';
    error.statusCode = 400;
    throw error;
  }

  const config = db.prepare('SELECT * FROM operational_board_configs WHERE company_id = ? AND board_key = ?').get(companyId, boardKey) || {
    board_key: boardKey,
    title_ar: 'شاشة التشغيل',
    title_en: 'Operations Board',
    auto_refresh_seconds: 15,
    is_read_only: 1
  };

  let items = [];
  if (boardKey === 'fleet_ops') {
    items = db.prepare('SELECT id, name, vehicle_number FROM fleet_vehicles WHERE company_id = ? LIMIT 10').all(companyId);
  } else if (boardKey === 'device_health') {
    items = db.prepare('SELECT id, external_ref, device_type, health_state FROM iot_devices WHERE company_id = ? LIMIT 10').all(companyId);
  } else if (boardKey === 'alert_center') {
    items = db.prepare('SELECT id, alert_type, severity, message, status FROM iot_device_alerts WHERE company_id = ? LIMIT 10').all(companyId);
  } else {
    items = [{ id: 'item-1', label: 'Sample Operational Metric', value: 100 }];
  }

  return {
    boardKey,
    titleAr: config.title_ar,
    titleEn: config.title_en,
    autoRefreshSeconds: config.auto_refresh_seconds,
    isReadOnly: !!config.is_read_only,
    staleIndicator: false,
    updatedAt: new Date().toISOString(),
    items
  };
}
