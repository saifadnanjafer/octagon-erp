// Mapping registry — Checkpoint I5A.
//
// Governed mapping rules for translation decisions (UOM, Location, Account, Journal, etc.).

'use strict';

import crypto from 'node:crypto';

export function seedDefaultMappings(dialect, actor = 'system') {
  const now = new Date().toISOString();

  // 1. Owner-approved UOM mappings
  const uomMappings = [
    {
      ruleDomain: 'UOM',
      sourceKey: 'قطعة',
      sourceLabel: 'قطعة',
      destinationKind: 'uom',
      destinationKey: 'piece',
      destinationLabelAr: 'قطعة',
      destinationLabelEn: 'Piece',
      factor: '1',
      decisionReason: 'Owner-approved fixed UOM mapping: category unit, UOM piece, factor 1',
    },
    {
      ruleDomain: 'UOM',
      sourceKey: 'لوح',
      sourceLabel: 'لوح',
      destinationKind: 'uom',
      destinationKey: 'sheet',
      destinationLabelAr: 'لوح',
      destinationLabelEn: 'Sheet',
      factor: '1',
      decisionReason: 'Owner-approved fixed UOM mapping: category discrete_package, UOM sheet, factor 1',
    },
    {
      ruleDomain: 'UOM',
      sourceKey: 'علبة',
      sourceLabel: 'علبة',
      destinationKind: 'uom',
      destinationKey: 'box',
      destinationLabelAr: 'علبة',
      destinationLabelEn: 'Box',
      factor: '1',
      decisionReason: 'Owner-approved fixed UOM mapping: category discrete_package, UOM box, factor 1',
    },
    {
      ruleDomain: 'UOM',
      sourceKey: 'رول',
      sourceLabel: 'رول',
      destinationKind: 'uom',
      destinationKey: 'roll',
      destinationLabelAr: 'رول',
      destinationLabelEn: 'Roll',
      factor: '1',
      decisionReason: 'Owner-approved fixed UOM mapping: category discrete_package, UOM roll, factor 1',
    },
    {
      ruleDomain: 'UOM',
      sourceKey: 'متر',
      sourceLabel: 'متر',
      destinationKind: 'uom',
      destinationKey: 'meter',
      destinationLabelAr: 'متر',
      destinationLabelEn: 'Meter',
      factor: '1',
      decisionReason: 'Owner-approved fixed UOM mapping: category length, UOM meter, factor 1',
    },
  ];

  // 2. Topology & Location mappings
  const locationMappings = [
    {
      ruleDomain: 'LOCATION',
      sourceKey: 'LOC_MAIN',
      sourceLabel: 'omni.storageLocations/LOC_MAIN',
      destinationKind: 'stock_location',
      destinationKey: 'LOC_MAIN',
      destinationLabelAr: 'المخزن الرئيسي',
      destinationLabelEn: 'Main Stock',
      factor: null,
      decisionReason: 'Physical stock topology authority omni.storageLocations/LOC_MAIN',
    },
    {
      ruleDomain: 'LOCATION',
      sourceKey: 'MAIN_STOCK',
      sourceLabel: 'omni.storageLocations/MAIN_STOCK',
      destinationKind: 'stock_location',
      destinationKey: 'MAIN_STOCK',
      destinationLabelAr: 'المخزن الرئيسي',
      destinationLabelEn: 'Main Stock',
      factor: null,
      decisionReason: 'Physical stock topology authority omni.storageLocations/MAIN_STOCK',
    },
    {
      ruleDomain: 'LOCATION',
      sourceKey: 'LOC_WIP',
      sourceLabel: 'omni.storageLocations/LOC_WIP',
      destinationKind: 'stock_location',
      destinationKey: 'LOC_WIP',
      destinationLabelAr: 'ورشة التنفيذ',
      destinationLabelEn: 'Execution Workshop',
      factor: null,
      decisionReason: 'Physical stock topology authority omni.storageLocations/LOC_WIP',
    },
    {
      ruleDomain: 'LOCATION',
      sourceKey: 'LOC_SCRAP',
      sourceLabel: 'locations/LOC_SCRAP',
      destinationKind: 'stock_location',
      destinationKey: 'LOC_SCRAP',
      destinationLabelAr: 'تسوية الفروقات',
      destinationLabelEn: 'Scrap Location',
      factor: null,
      decisionReason: 'Virtual location from legacy locations',
    },
    {
      ruleDomain: 'LOCATION',
      sourceKey: 'LOC_SUPPLIERS',
      sourceLabel: 'locations/LOC_SUPPLIERS',
      destinationKind: 'stock_location',
      destinationKey: 'LOC_SUPPLIERS',
      destinationLabelAr: 'الموردون',
      destinationLabelEn: 'Supplier Location',
      factor: null,
      decisionReason: 'Virtual location from legacy locations',
    },
  ];

  const allRules = [...uomMappings, ...locationMappings];

  dialect.exec('BEGIN IMMEDIATE;');
  try {
    for (const r of allRules) {
      const id = `mr_${crypto.randomBytes(6).toString('hex')}`;
      dialect.prepare(`
        INSERT INTO cutover_mapping_rules (
          id, rule_domain, source_key, source_label, destination_kind,
          destination_key, destination_label_ar, destination_label_en, factor,
          decision_reason, decided_by, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(rule_domain, source_key) DO UPDATE SET
          source_label = excluded.source_label,
          destination_kind = excluded.destination_kind,
          destination_key = excluded.destination_key,
          destination_label_ar = excluded.destination_label_ar,
          destination_label_en = excluded.destination_label_en,
          factor = excluded.factor,
          decision_reason = excluded.decision_reason,
          decided_by = excluded.decided_by,
          updated_at = excluded.updated_at
      `).run(
        id, r.ruleDomain, r.sourceKey, r.sourceLabel, r.destinationKind,
        r.destinationKey, r.destinationLabelAr, r.destinationLabelEn, r.factor,
        r.decisionReason, actor, now, now
      );
    }
    dialect.exec('COMMIT;');
  } catch (err) {
    dialect.exec('ROLLBACK;');
    throw err;
  }

  return listMappingRules(dialect);
}

export function setMappingRule(dialect, rule = {}, actor = 'system') {
  if (!rule.ruleDomain || !rule.sourceKey || !rule.destinationKind || !rule.destinationKey) {
    throw new TypeError('setMappingRule requires ruleDomain, sourceKey, destinationKind, and destinationKey');
  }

  const now = new Date().toISOString();
  const id = `mr_${crypto.randomBytes(6).toString('hex')}`;

  dialect.prepare(`
    INSERT INTO cutover_mapping_rules (
      id, rule_domain, source_key, source_label, destination_kind,
      destination_key, destination_label_ar, destination_label_en, factor,
      decision_reason, decided_by, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(rule_domain, source_key) DO UPDATE SET
      source_label = COALESCE(excluded.source_label, cutover_mapping_rules.source_label),
      destination_kind = excluded.destination_kind,
      destination_key = excluded.destination_key,
      destination_label_ar = COALESCE(excluded.destination_label_ar, cutover_mapping_rules.destination_label_ar),
      destination_label_en = COALESCE(excluded.destination_label_en, cutover_mapping_rules.destination_label_en),
      factor = COALESCE(excluded.factor, cutover_mapping_rules.factor),
      decision_reason = COALESCE(excluded.decision_reason, cutover_mapping_rules.decision_reason),
      decided_by = excluded.decided_by,
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `).run(
    id, rule.ruleDomain, rule.sourceKey, rule.sourceLabel || rule.sourceKey,
    rule.destinationKind, rule.destinationKey, rule.destinationLabelAr || null,
    rule.destinationLabelEn || null, rule.factor || null, rule.decisionReason || null,
    actor, rule.isActive ?? 1, now, now
  );

  return getMappingRule(dialect, rule.ruleDomain, rule.sourceKey);
}

export function getMappingRule(dialect, ruleDomain, sourceKey) {
  return dialect.prepare(`
    SELECT * FROM cutover_mapping_rules
    WHERE rule_domain = ? AND source_key = ? AND is_active = 1
  `).get(ruleDomain, sourceKey) || null;
}

export function listMappingRules(dialect, ruleDomain = null) {
  if (ruleDomain) {
    return dialect.prepare('SELECT * FROM cutover_mapping_rules WHERE rule_domain = ? AND is_active = 1 ORDER BY source_key').all(ruleDomain);
  }
  return dialect.prepare('SELECT * FROM cutover_mapping_rules WHERE is_active = 1 ORDER BY rule_domain, source_key').all();
}
