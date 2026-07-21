// 004_platform_kernel_views
//
// Source composition:
// - VNext vnext/client/r3-ui.js and views-fields.js (project-owned) for view
//   descriptor, menu, and route concepts.
// - NocoBase SchemaComponent (clean-room reference) for data/view separation.
// - Frappe form/list/grid (MIT reference) for view types.
//
// Adds the view version history table and seeds a reference page.

import crypto from 'node:crypto';

export const migration = {
  id: '004_platform_kernel_views',
  owner: 'platform.kernel',
  version: '1.0.0',
  dependsOn: ['003_platform_kernel_actions_and_lifecycle'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext r3-ui.js + views-fields.js mapped to platform_views + platform_view_versions',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS platform_view_versions (
        id TEXT PRIMARY KEY,
        view_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        entity_id TEXT,
        view_type TEXT NOT NULL,
        route TEXT,
        menu_location TEXT,
        layout_schema TEXT NOT NULL DEFAULT '{}',
        layout_version TEXT NOT NULL,
        actions TEXT NOT NULL DEFAULT '[]',
        required_permissions TEXT NOT NULL DEFAULT '[]',
        required_feature_states TEXT NOT NULL DEFAULT '[]',
        localization_keys TEXT NOT NULL DEFAULT '{}',
        extension_patches TEXT NOT NULL DEFAULT '[]',
        recorded_by TEXT,
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_view_versions_view ON platform_view_versions(view_id);
    `);

    const now = new Date().toISOString();
    dialect.prepare(`
      INSERT INTO platform_views (
        id, module_id, entity_id, view_type, route, menu_location, layout_schema, layout_version,
        actions, required_permissions, required_feature_states, localization_keys, extension_patches,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        entity_id = excluded.entity_id,
        view_type = excluded.view_type,
        route = excluded.route,
        menu_location = excluded.menu_location,
        layout_schema = excluded.layout_schema,
        layout_version = excluded.layout_version,
        actions = excluded.actions,
        required_permissions = excluded.required_permissions,
        required_feature_states = excluded.required_feature_states,
        localization_keys = excluded.localization_keys,
        extension_patches = excluded.extension_patches,
        updated_at = excluded.updated_at
    `).run(
      'kernel_reference_page', 'platform_kernel', 'product_category', 'page', '/kernel/reference', 'platform:reference',
      JSON.stringify({ title_ar: 'صفحة المرجع', component: 'ReferencePage' }), '1',
      JSON.stringify(['create', 'list']),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ title: 'reference_page_title' }),
      JSON.stringify([]),
      now, now
    );

    dialect.prepare(`
      INSERT INTO platform_view_versions (id, view_id, module_id, entity_id, view_type, route, menu_location, layout_schema, layout_version, actions, required_permissions, required_feature_states, localization_keys, extension_patches, recorded_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), 'kernel_reference_page', 'platform_kernel', 'product_category', 'page', '/kernel/reference', 'platform:reference',
      JSON.stringify({ title_ar: 'صفحة المرجع', component: 'ReferencePage' }), '1',
      JSON.stringify(['create', 'list']), JSON.stringify([]), JSON.stringify([]), JSON.stringify({ title: 'reference_page_title' }), JSON.stringify([]),
      'platform_kernel', now
    );
  },

  down(dialect) {
    dialect.exec('DROP TABLE IF EXISTS platform_view_versions;');
    dialect.prepare('DELETE FROM platform_views WHERE module_id = ?').run('platform_kernel');
  }
};
