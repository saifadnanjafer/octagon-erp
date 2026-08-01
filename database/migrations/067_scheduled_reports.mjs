export const migration = {
  id: '067_scheduled_reports', owner: 'platform.kernel', version: '1.46.0', parent: '066_commercial_warranty_registry', dependsOn: ['066_commercial_warranty_registry'],
  dialect: ['sqlite', 'postgres'], transactionPolicy: 'required', rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-05 governed scheduled-report definitions; delivery is a durable job, never a scheduler-side mutation.',
  up(db) { db.exec(`CREATE TABLE IF NOT EXISTS report_schedules (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, owner_id TEXT, name TEXT NOT NULL, report_key TEXT NOT NULL,
    schedule TEXT NOT NULL, audience TEXT NOT NULL DEFAULT '[]', format TEXT NOT NULL DEFAULT 'pdf' CHECK(format IN ('pdf','xlsx')),
    active INTEGER NOT NULL DEFAULT 1, last_delivered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_report_schedules_scope ON report_schedules(company_id, owner_id, active);`); },
  down(db) { db.exec('DROP INDEX IF EXISTS idx_report_schedules_scope; DROP TABLE IF EXISTS report_schedules;'); },
};
