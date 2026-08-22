// RENUMBERED 086 -> 091 (2026-08-22). This migration was authored on the
// wip/july-2026-payroll-workbook-sync branch at the same time main independently
// created its own 086_build10_actions_and_permissions_followup. Two different
// migrations therefore claimed 086. main's chain 086-090 is already applied to
// the operational database, so this one is re-parented to run after 090. Its
// content is unchanged: a descriptive correction to entity lifecycle labels,
// which does not depend on its position in the chain.
// Forward safety correction for descriptive lifecycle labels introduced by
// post-062 migrations. The entity descriptor vocabulary is intentionally
// closed; "governed" and "explicit" describe governance, not lifecycle
// policies. These entities all expose domain actions and status transitions,
// so workflow is the canonical lifecycle policy.

'use strict';

export const migration = {
  id: '091_canonical_entity_lifecycle_policies',
  owner: 'platform.kernel',
  version: '10.5.0',
  parent: '090_build09_wms_shopfloor_quality_view_permissions_followup',
  dependsOn: ['090_build09_wms_shopfloor_quality_view_permissions_followup'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'irreversible-safety-correction',
  sourceProvenance: 'Forward correction: normalize descriptive post-062 lifecycle labels to the closed entity descriptor vocabulary.',

  up(db) {
    db.prepare(`
      UPDATE platform_entities
      SET lifecycle_policy = 'workflow', updated_at = ?
      WHERE lifecycle_policy IN ('governed', 'explicit')
    `).run(new Date().toISOString());

    const invalid = db.prepare(`
      SELECT COUNT(*) AS count
      FROM platform_entities
      WHERE lifecycle_policy NOT IN ('generic', 'state_machine', 'workflow', 'immutable', 'append_only')
    `).get();
    if (Number(invalid.count) !== 0) {
      throw new Error(`entity lifecycle policy normalization left ${invalid.count} invalid rows`);
    }
  },

  down(db) {
    // Do not restore invalid labels. The correction is deliberately forward-only
    // because rollback would make the complete entity registry unreadable again.
    const invalid = db.prepare(`
      SELECT COUNT(*) AS count
      FROM platform_entities
      WHERE lifecycle_policy NOT IN ('generic', 'state_machine', 'workflow', 'immutable', 'append_only')
    `).get();
    if (Number(invalid.count) !== 0) {
      throw new Error(`entity lifecycle policy registry is invalid: ${invalid.count} rows`);
    }
  },
};

export default migration;
