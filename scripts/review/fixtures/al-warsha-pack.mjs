// Review Freeze — Al-Warsha vertical pack fixture.
//
// Grounded in database/migrations/089_build12_ai_people_marketing_events_pack.mjs
// and platform/build12/index.mjs (stageWarshaPack / setWarshaPackState).
//
// IMPORTANT SCHEMA NOTE: terminology overlay, readiness profile, workflow
// templates, and KPI profile are NOT separate per-tenant tables — they are
// four JSON columns (terminology_overlay, readiness_categories,
// workflow_templates, kpi_catalog) on the single global catalog row
// `build12_pack_profiles` (id='pack_profile_al_warsha',
// package_id='pack:al_warsha'), already inserted once by migration 089 and
// shared by every tenant. This fixture does not duplicate or mutate that
// row — doing so would edit shared platform catalog data, not demo data.
// Instead it defensively asserts the row exists (idempotent, matches the
// migration's own content byte-for-byte) and reads back its shape for the
// summary, then installs/enables the pack for the demo company's tenant via
// the real per-tenant table, `build12_pack_installations`.
//
// "Role template(s)" has no home anywhere in this schema — build12_pack_profiles
// has no role_templates column, and no other table represents pack-scoped
// role templates. That bullet is reported as NOT FULFILLED rather than
// inventing a new table/column.

function parseOr(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

export async function seedAlWarshaPackFixtures(dialect, { tenantId, companyId, branchId, now }) {
  void branchId; // not needed by the pack tables; kept for signature parity

  // Defensive assert-only insert: identical to migration 089's own row, so a
  // conflict is a true no-op and never overwrites shared catalog data.
  dialect.prepare(`INSERT INTO build12_pack_profiles
    (id,package_id,name,version,status,terminology_overlay,workflow_templates,readiness_categories,kpi_catalog,validation_findings,created_at,updated_at)
    VALUES('pack_profile_al_warsha','pack:al_warsha','Al-Warsha Workshop Operating Pack','1.0.0','validated',?,?,?,?, '[]', ?, ?)
    ON CONFLICT(package_id) DO NOTHING`)
    .run(
      JSON.stringify({ work_order: 'Workshop Job', quality_hold: 'Quality Hold', ready_for_delivery: 'Ready for Delivery' }),
      JSON.stringify(['design_approval', 'material_readiness', 'quality_release', 'delivery_readiness']),
      JSON.stringify(['required_roles', 'workshop_locations', 'work_centers', 'picking_staging', 'quality_checkpoints', 'material_flow', 'delivery_readiness', 'device_readiness', 'critical_skills', 'safe_ai_policy']),
      JSON.stringify(['open_workshop_jobs', 'due_today', 'overdue', 'blocked_materials', 'quality_hold', 'rework', 'ready_for_delivery', 'downtime']),
      now, now,
    );

  // Enabled package record — install/enable pack:al_warsha for the demo
  // company's tenant (build12_pack_installations is tenant-scoped; the demo
  // tenant/company pairing already ties this to c_alwarsha_demo).
  const installId = `rev_pack_install_${tenantId}`;
  dialect.prepare(`INSERT INTO build12_pack_installations
    (id,tenant_id,package_id,extension_installation_id,version,state,created_at,updated_at)
    VALUES(?,?, 'pack:al_warsha', NULL, '1.0.0', 'enabled', ?, ?)
    ON CONFLICT(id) DO NOTHING`)
    .run(installId, tenantId, now, now);

  const profile = dialect.prepare(
    'SELECT terminology_overlay, workflow_templates, readiness_categories, kpi_catalog FROM build12_pack_profiles WHERE package_id = ?',
  ).get('pack:al_warsha');

  const terminologyOverlayKeys = profile ? Object.keys(parseOr(profile.terminology_overlay, {})).length : null;
  const workflowTemplateCount = profile ? parseOr(profile.workflow_templates, []).length : null;
  const readinessCategoryCount = profile ? parseOr(profile.readiness_categories, []).length : null;
  const kpiProfileMetricCount = profile ? parseOr(profile.kpi_catalog, []).length : null;

  return {
    summary: {
      packageId: 'pack:al_warsha',
      installedForTenant: tenantId,
      installedForCompany: companyId,
      installationState: 'enabled',
      terminologyOverlayKeys,
      workflowTemplateCount,
      readinessCategoryCount,
      kpiProfileMetricCount,
      roleTemplates: 'NOT_FULFILLED — no role-template table or column exists in the pack schema (build12_pack_profiles / build12_pack_installations); none was fabricated.',
    },
  };
}
