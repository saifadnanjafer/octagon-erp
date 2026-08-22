// Product Recovery 1 follow-up: register the read/`:view` permission tokens
// that platform/api/build09.mjs's BUILD09_RESOURCE_PERMISSIONS map already
// requires for GET /api/v1/wms/<resource> requests, but that were never
// added to authorization_permissions.
//
// Root cause, found via docs/product/PAGE_REALITY_LEDGER.md: the wms query
// namespace (unlike every other query namespace, which accepts the generic
// platform:db:read) requires a resource-scoped permission per
// BUILD09_RESOURCE_PERMISSIONS. Migrations 076 and 079 registered four of
// those tokens (wms:topology:view, wms:putaway:view, wms:replenishment:view,
// shopfloor:performance:view); the other sixteen were referenced by the
// route map from the start but never inserted into authorization_permissions,
// so platform/authorization/evaluator/index.mjs's registry.assertKnown()
// fails closed on them for every role, including sysadmin — not a role-grant
// problem, a missing-registration problem. No role in review OR production
// could ever have been granted these, because the token did not exist.
//
// This migration only ADDS the missing registrations; it does not touch
// platform_actions or existing permissions, and does not grant them to any
// role (see scripts/review/roles.mjs for the review-only grant to sysadmin).
'use strict';

const MODULE_ID = 'build09_followup';

// module_id must match the moduleId already used by each domain's owning
// migration (076: stock_wms, 079: operations_manufacturing, 080:
// operations_quality) — the evaluator's module-state check
// (ctx.enabledModules.includes(def.moduleId)) gates on this, so a wrong
// module_id here would trade a permission-registry denial for a
// module-disabled denial instead of actually fixing anything.
const WMS_PERMISSIONS = [
  ['wms:locations:view', 'locations', 'view', 0],
  ['wms:receiving:view', 'receiving', 'view', 0],
  ['wms:discrepancies:view', 'discrepancies', 'view', 0],
  ['wms:picking:view', 'picking', 'view', 0],
  ['wms:waves:view', 'waves', 'view', 0],
  ['wms:cycle_count:view', 'cycle_count', 'view', 0],
  ['wms:docks:view', 'docks', 'view', 0],
  ['wms:crossdock:view', 'crossdock', 'view', 0],
  ['wms:traceability:view', 'traceability', 'view', 0],
  ['wms:recall:view', 'recall', 'view', 0],
];
const SHOPFLOOR_PERMISSIONS = [
  ['shopfloor:terminal:view', 'shopfloor_terminal', 'view', 0],
  ['shopfloor:material:view', 'production_material', 'view', 0],
  ['shopfloor:downtime:view', 'downtime', 'view', 0],
];
const QUALITY_PERMISSIONS = [
  ['quality:checkpoint:view', 'quality_checkpoint', 'view', 0],
  ['quality:disposition:view', 'quality_disposition', 'view', 0],
  ['quality:rework:view', 'quality_rework', 'view', 0],
];
const PERMISSIONS = [...WMS_PERMISSIONS, ...SHOPFLOOR_PERMISSIONS, ...QUALITY_PERMISSIONS];

export const migration = {
  id: '090_build09_wms_shopfloor_quality_view_permissions_followup',
  owner: MODULE_ID,
  version: '9.4.0',
  parent: '089_build12_ai_people_marketing_events_pack',
  dependsOn: ['089_build12_ai_people_marketing_events_pack'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'Product Recovery 1 — close the wms/shopfloor/quality view-permission registration gap found by the page reality ledger',

  up(db) {
    const now = new Date().toISOString();
    const insertFor = (moduleId) => db.prepare(`INSERT INTO authorization_permissions(id,module_id,kind,resource,action,label_ar,label_en,sensitive,depends_on,deprecated,created_at,updated_at)
      VALUES(?,'${moduleId}','action',?,?,?, ?,?,'[]',0,?,?)
      ON CONFLICT(id) DO UPDATE SET sensitive=excluded.sensitive,updated_at=excluded.updated_at`);
    const wms = insertFor('stock_wms');
    const shopfloor = insertFor('operations_manufacturing');
    const quality = insertFor('operations_quality');
    WMS_PERMISSIONS.forEach(([id, resource, verb, sensitive]) => wms.run(id, resource, verb, id, id, sensitive, now, now));
    SHOPFLOOR_PERMISSIONS.forEach(([id, resource, verb, sensitive]) => shopfloor.run(id, resource, verb, id, id, sensitive, now, now));
    QUALITY_PERMISSIONS.forEach(([id, resource, verb, sensitive]) => quality.run(id, resource, verb, id, id, sensitive, now, now));
  },

  down(db) {
    PERMISSIONS.forEach(([id]) => db.prepare('DELETE FROM authorization_permissions WHERE id=?').run(id));
  },
};

export default migration;
