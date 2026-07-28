// 051_checkpoint_c_control_entity_policy — Checkpoint C6 closure hardening
//
// Migration 050 introduced the Control Plane audit entity with the descriptive
// lifecycle label "governed". The Phase 01 entity registry has a closed policy
// vocabulary and correctly rejects that value. This forward-only correction
// keeps migration history immutable and restores registry-wide compatibility.

export const migration = {
  id: '051_checkpoint_c_control_entity_policy',
  owner: 'platform.kernel',
  version: '1.30.0',
  parent: '050_control_plane_module_management',
  dependsOn: ['050_control_plane_module_management'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'irreversible-safety-correction',
  sourceProvenance: 'Current Octagon Phase 01 entity descriptor contract; forward correction of the Checkpoint C5 Control Plane audit entity',

  up(db) {
    const result = db.prepare(`
      UPDATE platform_entities
      SET lifecycle_policy = 'generic', updated_at = ?
      WHERE id = 'control_plane'
    `).run(new Date().toISOString());
    if (result.changes !== 1) {
      throw new Error('Control Plane entity is required before migration 051');
    }
  },

  down(db) {
    // Deliberately retain the valid value. Restoring "governed" would make the
    // complete entity registry unreadable and is not a safe rollback.
    const row = db.prepare(`
      SELECT lifecycle_policy FROM platform_entities WHERE id = 'control_plane'
    `).get();
    if (!row || row.lifecycle_policy !== 'generic') {
      throw new Error('Migration 051 safety correction cannot be reversed');
    }
  },
};

export default migration;
