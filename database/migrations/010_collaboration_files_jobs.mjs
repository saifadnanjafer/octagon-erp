// 010_collaboration_files_jobs — Phase 02 Wave E (packets 02.24 – 02.30)
//
// Source composition:
// - VNext vnext/server/audit/audit.js, chatter/chatter.js, notify/notify.js,
//   fields/snapshot-fields.js, print/print-templates.js, and
//   modules/governance/integration-engine.js (project-owned, MERGE-CANONICAL).
// - Odoo addons/mail/models/{mail_thread,mail_activity,mail_followers}.py
//   (clean-room): thread/follower/activity separation and tracked-field history.
// - NocoBase audit/history, snapshot, and file plugins (clean-room).
// - Aureus plugins/webkul/chatter/src (MIT reference, behavior only).
// - RuoYi file storage + infra logging starters (MIT reference, behavior only).
// - Odoo odoo/addons/base/models/ir_cron.py (clean-room) for job scheduling.
//
// Invariants (§ 12):
//   - files are PRIVATE by default; a public link is an explicit, expiring,
//     revocable, audited object
//   - a notification is delivered through a durable job, never inline
//   - record history is business history and is distinct from platform_audit_log

export const migration = {
  id: '010_collaboration_files_jobs',
  owner: 'platform.collaboration',
  version: '2.0.0',
  dependsOn: ['009_workflow_approvals_sla'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'VNext audit/chatter/notify/snapshot/print/integration (project-owned) + Odoo mail_thread & ir_cron clean-room + NocoBase history/file clean-room + Aureus/RuoYi references',

  up(dialect) {
    dialect.exec(`
      -- ---- Record history and snapshots (packet 02.24) -----------------------
      -- Business history. Security evidence stays in platform_audit_log.
      CREATE TABLE IF NOT EXISTS record_history (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_version INTEGER NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'user',
        source_channel TEXT NOT NULL DEFAULT 'ui',
        correlation_id TEXT,
        company_id TEXT,
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_history_record ON record_history(entity, record_id, occurred_at);

      -- Immutable point-in-time copies for governed documents, including the
      -- related names/addresses/prices that must not drift after posting.
      CREATE TABLE IF NOT EXISTS record_snapshots (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record_version INTEGER NOT NULL,
        reason TEXT NOT NULL,
        payload TEXT NOT NULL,
        relations TEXT NOT NULL DEFAULT '{}',
        checksum TEXT NOT NULL,
        immutable INTEGER NOT NULL DEFAULT 1,
        company_id TEXT,
        taken_by TEXT NOT NULL,
        taken_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_snapshot ON record_snapshots(entity, record_id, record_version, reason);

      CREATE TABLE IF NOT EXISTS record_lineage (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        relation TEXT NOT NULL CHECK (relation IN ('amends','amended_by','reverses','reversed_by','replaces','replaced_by')),
        related_entity TEXT NOT NULL,
        related_record_id TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_lineage ON record_lineage(entity, record_id);

      CREATE TABLE IF NOT EXISTS retention_policies (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        entity TEXT,
        retain_days INTEGER NOT NULL,
        action TEXT NOT NULL DEFAULT 'archive' CHECK (action IN ('archive','purge')),
        created_at TEXT NOT NULL
      ) STRICT;

      -- ---- Collaboration (packet 02.25) --------------------------------------
      CREATE TABLE IF NOT EXISTS chatter_threads (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        company_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_thread ON chatter_threads(entity, record_id);

      CREATE TABLE IF NOT EXISTS chatter_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES chatter_threads(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','private','external')),
        mentions TEXT NOT NULL DEFAULT '[]',
        attachments TEXT NOT NULL DEFAULT '[]',
        source_channel TEXT NOT NULL DEFAULT 'ui',
        edited_at TEXT,
        removed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON chatter_messages(thread_id, created_at);

      CREATE TABLE IF NOT EXISTS chatter_followers (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES chatter_threads(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        subscribed_by TEXT,
        muted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_follower ON chatter_followers(thread_id, user_id);

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        company_id TEXT,
        kind TEXT NOT NULL DEFAULT 'todo',
        summary_ar TEXT NOT NULL,
        assignee_id TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_activities_assignee ON activities(assignee_id, status, due_at);

      -- ---- Notifications (packet 02.26) --------------------------------------
      CREATE TABLE IF NOT EXISTS notification_templates (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'ar',
        channel TEXT NOT NULL DEFAULT 'inapp',
        subject TEXT,
        body TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'informational' CHECK (category IN ('informational','operational','security','legal')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_template ON notification_templates(event_key, locale, channel);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        event_key TEXT NOT NULL,
        dedupe_key TEXT,
        category TEXT NOT NULL DEFAULT 'informational',
        subject TEXT,
        body TEXT NOT NULL,
        link TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        read_at TEXT,
        archived_at TEXT,
        correlation_id TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, read_at);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_dedupe ON notifications(recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS notification_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        channel TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_pref ON notification_preferences(user_id, event_key, channel);

      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        target TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead','suppressed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_attempt_at TEXT,
        last_error TEXT,
        provider TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_deliveries ON notification_deliveries(status, next_attempt_at);

      CREATE TABLE IF NOT EXISTS provider_health (
        provider TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_failure_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy','degraded','down'))
      ) STRICT;

      -- ---- Secure files (packet 02.27) ---------------------------------------
      CREATE TABLE IF NOT EXISTS file_objects (
        id TEXT PRIMARY KEY,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        storage_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        tenant_id TEXT,
        company_id TEXT,
        scan_status TEXT NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','skipped')),
        scan_detail TEXT,
        uploaded_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_files_company ON file_objects(company_id, deleted_at);

      -- A file is reachable only through an attachment to a registered record,
      -- or through an explicit share. There is no "public files" bucket.
      CREATE TABLE IF NOT EXISTS file_attachments (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES file_objects(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        purpose TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_attachment ON file_attachments(file_id, entity, record_id);
      CREATE INDEX IF NOT EXISTS idx_attachment_record ON file_attachments(entity, record_id);

      CREATE TABLE IF NOT EXISTS file_shares (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL REFERENCES file_objects(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        reason TEXT,
        expires_at TEXT NOT NULL,
        max_downloads INTEGER,
        downloads INTEGER NOT NULL DEFAULT 0,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS file_access_log (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        actor_id TEXT,
        share_id TEXT,
        operation TEXT NOT NULL CHECK (operation IN ('upload','download','delete','share','revoke','denied')),
        reason_code TEXT,
        occurred_at TEXT NOT NULL,
        ip TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_file_access ON file_access_log(file_id, occurred_at);

      -- ---- Import / export / print (packet 02.28) ----------------------------
      CREATE TABLE IF NOT EXISTS import_jobs (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        action_id TEXT NOT NULL,
        file_id TEXT,
        company_id TEXT,
        mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run','execute')),
        row_error_strategy TEXT NOT NULL DEFAULT 'skip' CHECK (row_error_strategy IN ('skip','abort')),
        total_rows INTEGER NOT NULL DEFAULT 0,
        ok_rows INTEGER NOT NULL DEFAULT 0,
        failed_rows INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
        report TEXT,
        idempotency_key TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_import_idempotency ON import_jobs(entity, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS import_rows (
        id TEXT PRIMARY KEY,
        import_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        row_number INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok','failed','skipped')),
        error TEXT,
        record_id TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_import_rows ON import_rows(import_id, status);

      CREATE TABLE IF NOT EXISTS export_jobs (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'csv',
        filters TEXT NOT NULL DEFAULT '{}',
        columns TEXT NOT NULL DEFAULT '[]',
        masked_columns TEXT NOT NULL DEFAULT '[]',
        row_count INTEGER NOT NULL DEFAULT 0,
        company_id TEXT,
        requested_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS print_templates (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        name TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'ar',
        direction TEXT NOT NULL DEFAULT 'rtl' CHECK (direction IN ('rtl','ltr')),
        body TEXT NOT NULL,
        paper TEXT NOT NULL DEFAULT 'A4',
        required_permission TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_print_template ON print_templates(entity, name, locale, version);

      CREATE TABLE IF NOT EXISTS public_form_submissions (
        id TEXT PRIMARY KEY,
        form_key TEXT NOT NULL,
        action_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        ip TEXT,
        accepted INTEGER NOT NULL DEFAULT 0,
        reason_code TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_public_form ON public_form_submissions(form_key, created_at);

      -- ---- Jobs, webhooks, integrations (packet 02.29) -----------------------
      -- platform_jobs (Phase 01) stays the DEFINITION registry. This is the
      -- durable QUEUE of individual runs.
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        tenant_id TEXT,
        company_id TEXT,
        actor_id TEXT,
        service_identity_id TEXT,
        idempotency_key TEXT,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        run_after TEXT NOT NULL,
        lease_id TEXT,
        leased_until TEXT,
        heartbeat_at TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_job_runs ON job_runs(status, run_after);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_job_idempotency ON job_runs(kind, idempotency_key) WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        url TEXT NOT NULL,
        secret_ref TEXT,
        tenant_id TEXT,
        company_id TEXT,
        service_identity_id TEXT,
        headers TEXT NOT NULL DEFAULT '{}',
        mapping TEXT NOT NULL DEFAULT '{}',
        payload_version TEXT NOT NULL DEFAULT '1.0.0',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        created_by TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_webhook_event ON webhook_subscriptions(event_type, active);

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        signature TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        nonce TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at TEXT,
        response_status INTEGER,
        last_error TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_event ON webhook_deliveries(subscription_id, event_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_pending ON webhook_deliveries(status, next_attempt_at);

      -- Replay protection for INBOUND webhooks we receive.
      CREATE TABLE IF NOT EXISTS webhook_inbound_seen (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        nonce TEXT NOT NULL,
        seen_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_nonce ON webhook_inbound_seen(source, nonce);
    `);

    const now = new Date().toISOString();
    // Mandatory notification categories cannot be switched off by a preference.
    dialect.prepare(`
      INSERT INTO notification_templates (id, module_id, event_key, locale, channel, subject, body, category, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
    `).run('tpl_security_ar', 'platform_kernel', 'identity.security_event', 'ar', 'inapp',
      'تنبيه أمني', 'تم تنفيذ إجراء أمني على حسابك: {{action}}', 'security', now);
  },

  down(dialect) {
    dialect.exec(`
      DROP TABLE IF EXISTS webhook_inbound_seen;
      DROP TABLE IF EXISTS webhook_deliveries;
      DROP TABLE IF EXISTS webhook_subscriptions;
      DROP TABLE IF EXISTS job_runs;
      DROP TABLE IF EXISTS public_form_submissions;
      DROP TABLE IF EXISTS print_templates;
      DROP TABLE IF EXISTS export_jobs;
      DROP TABLE IF EXISTS import_rows;
      DROP TABLE IF EXISTS import_jobs;
      DROP TABLE IF EXISTS file_access_log;
      DROP TABLE IF EXISTS file_shares;
      DROP TABLE IF EXISTS file_attachments;
      DROP TABLE IF EXISTS file_objects;
      DROP TABLE IF EXISTS provider_health;
      DROP TABLE IF EXISTS notification_deliveries;
      DROP TABLE IF EXISTS notification_preferences;
      DROP TABLE IF EXISTS notifications;
      DROP TABLE IF EXISTS notification_templates;
      DROP TABLE IF EXISTS activities;
      DROP TABLE IF EXISTS chatter_followers;
      DROP TABLE IF EXISTS chatter_messages;
      DROP TABLE IF EXISTS chatter_threads;
      DROP TABLE IF EXISTS retention_policies;
      DROP TABLE IF EXISTS record_lineage;
      DROP TABLE IF EXISTS record_snapshots;
      DROP TABLE IF EXISTS record_history;
    `);
  }
};
