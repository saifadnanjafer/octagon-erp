// 002_platform_kernel_entities_and_storage
//
// Source composition:
// - VNext 101_r1_lane_a_tables.mjs (project-owned) used as the base for
//   x_records, collection_registry, and field_registry tables.
// - VNext crud-engine.js (project-owned) for the audit (x_audit) and sequence
//   (x_sequences) table shapes.
// - Octagon legacy entities.json (project-owned) for the seed entity list.
//
// Creates the canonical generic document store and seeds the entity registry.
// All metadata changes are migration-controlled; no runtime DDL is performed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultEntitiesPath = path.resolve(here, '../../platform/kernel/entities/default-entities.json');

export const migration = {
  id: '002_platform_kernel_entities_and_storage',
  owner: 'platform.kernel',
  version: '1.0.0',
  dependsOn: ['001_platform_kernel_bootstrap'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext 101_r1_lane_a_tables + legacy entities.json mapped to platform_entities + x_records storage',

  up(dialect) {
    dialect.exec(`
      CREATE TABLE IF NOT EXISTS x_records (
        entity     TEXT NOT NULL,
        id         TEXT NOT NULL,
        company_id TEXT,
        data       TEXT NOT NULL DEFAULT '{}',
        created_at TEXT,
        updated_at TEXT,
        created_by TEXT,
        removed    INTEGER NOT NULL DEFAULT 0,
        version    INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (entity, id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_x_records_entity_removed ON x_records (entity, removed);
      CREATE INDEX IF NOT EXISTS idx_x_records_company ON x_records (company_id);
      CREATE INDEX IF NOT EXISTS idx_x_records_updated ON x_records (entity, updated_at);

      CREATE TABLE IF NOT EXISTS x_audit (
        id        TEXT PRIMARY KEY,
        entity    TEXT NOT NULL,
        record_id TEXT NOT NULL,
        user      TEXT,
        action    TEXT NOT NULL,
        before    TEXT,
        after     TEXT,
        at        TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_x_audit_record ON x_audit (entity, record_id);

      CREATE TABLE IF NOT EXISTS x_sequences (
        id             TEXT PRIMARY KEY,
        module_id      TEXT NOT NULL,
        scope_key      TEXT NOT NULL,
        template       TEXT NOT NULL,
        current_value  INTEGER NOT NULL DEFAULT 0,
        reset_policy   TEXT NOT NULL DEFAULT 'none',
        gap_policy     TEXT NOT NULL DEFAULT 'allowed',
        fiscal_period_key TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS x_chatter (
        id            TEXT PRIMARY KEY,
        entity        TEXT NOT NULL,
        record_id     TEXT NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'message',
        body          TEXT,
        author        TEXT,
        activity_type TEXT,
        due_date      TEXT,
        done          INTEGER NOT NULL DEFAULT 0,
        meta          TEXT,
        created_at    TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_x_chatter_record ON x_chatter (entity, record_id);

      CREATE TABLE IF NOT EXISTS x_followers (
        entity    TEXT NOT NULL,
        record_id TEXT NOT NULL,
        user      TEXT NOT NULL,
        PRIMARY KEY (entity, record_id, user)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS x_views (
        id     TEXT PRIMARY KEY,
        user   TEXT,
        entity TEXT NOT NULL,
        name   TEXT NOT NULL,
        config TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_x_views_entity_user ON x_views (entity, user);

      CREATE TABLE IF NOT EXISTS x_custom_fields (
        entity   TEXT NOT NULL,
        key      TEXT NOT NULL,
        label_ar TEXT,
        type     TEXT NOT NULL DEFAULT 'text',
        options  TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entity, key)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS x_notifications (
        id         TEXT PRIMARY KEY,
        user       TEXT NOT NULL,
        title      TEXT,
        body       TEXT,
        link       TEXT,
        read       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_x_notifications_user ON x_notifications (user, read);

      CREATE TABLE IF NOT EXISTS x_approvals (
        id            TEXT PRIMARY KEY,
        entity        TEXT,
        record_id     TEXT,
        action        TEXT,
        payload       TEXT,
        requester     TEXT,
        approver_role TEXT,
        status        TEXT NOT NULL DEFAULT 'pending',
        decided_by    TEXT,
        decided_at    TEXT,
        cc            TEXT,
        created_at    TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_x_approvals_status ON x_approvals (status, approver_role);
      CREATE INDEX IF NOT EXISTS idx_x_approvals_record ON x_approvals (entity, record_id);
    `);

    const now = new Date().toISOString();
    dialect.prepare(`
      INSERT INTO platform_modules (id, name, version, status, kind, owner, dependencies, optional_dependencies, capabilities, migrations, settings, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        kind = excluded.kind,
        owner = excluded.owner,
        dependencies = excluded.dependencies,
        optional_dependencies = excluded.optional_dependencies,
        capabilities = excluded.capabilities,
        migrations = excluded.migrations,
        settings = excluded.settings,
        updated_at = excluded.updated_at
    `).run(
      'platform_kernel', 'Kernel', '1.0.0', 'enabled', 'core', 'platform',
      '[]', '[]', '[]', '[]', '[]', now, now
    );

    const entities = JSON.parse(fs.readFileSync(defaultEntitiesPath, 'utf8'));
    const ins = dialect.prepare(`
      INSERT INTO platform_entities (
        id, module_id, storage_owner, primary_key, label_ar, label_en, section,
        sequence, seq_field, chatter, acl, status_key, fields, relations, scope,
        lifecycle_policy, query_policy, action_policy, customization_policy,
        history_policy, api_exposed, migration_owner, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        module_id = excluded.module_id,
        storage_owner = excluded.storage_owner,
        primary_key = excluded.primary_key,
        label_ar = excluded.label_ar,
        label_en = excluded.label_en,
        section = excluded.section,
        sequence = excluded.sequence,
        seq_field = excluded.seq_field,
        chatter = excluded.chatter,
        acl = excluded.acl,
        status_key = excluded.status_key,
        fields = excluded.fields,
        relations = excluded.relations,
        scope = excluded.scope,
        lifecycle_policy = excluded.lifecycle_policy,
        query_policy = excluded.query_policy,
        action_policy = excluded.action_policy,
        customization_policy = excluded.customization_policy,
        history_policy = excluded.history_policy,
        api_exposed = excluded.api_exposed,
        migration_owner = excluded.migration_owner,
        updated_at = excluded.updated_at
    `);
    for (const descriptor of Object.values(entities)) {
      ins.run(
        descriptor.id,
        descriptor.module_id,
        descriptor.storage_owner,
        descriptor.primary_key,
        descriptor.label_ar,
        descriptor.label_en,
        descriptor.section || null,
        descriptor.sequence || null,
        descriptor.seq_field || null,
        descriptor.chatter ? 1 : 0,
        descriptor.acl || null,
        descriptor.status_key || null,
        JSON.stringify(descriptor.fields || {}),
        JSON.stringify(descriptor.relations || {}),
        descriptor.scope || 'company',
        descriptor.lifecycle_policy || 'generic',
        descriptor.query_policy || 'scoped',
        descriptor.action_policy || 'registered',
        descriptor.customization_policy || 'metadata',
        descriptor.history_policy || 'audit',
        descriptor.api_exposed !== false ? 1 : 0,
        descriptor.migration_owner || descriptor.module_id,
        now, now
      );
    }
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS x_approvals;
      DROP TABLE IF EXISTS x_notifications;
      DROP TABLE IF EXISTS x_custom_fields;
      DROP TABLE IF EXISTS x_views;
      DROP TABLE IF EXISTS x_followers;
      DROP TABLE IF EXISTS x_chatter;
      DROP TABLE IF EXISTS x_sequences;
      DROP TABLE IF EXISTS x_audit;
      DROP TABLE IF EXISTS x_records;
    `);
    dialect.prepare('DELETE FROM platform_entities WHERE module_id = ?').run('platform_kernel');
    dialect.prepare('DELETE FROM platform_modules WHERE id = ?').run('platform_kernel');
  }
};
