/**
 * Rollback compatibility layer — runner-owned, forward-maintained.
 *
 * Migrations 001–062 are historical and immutable. When a historical `down()`
 * turns out to be unsafe against real populated data, the fix belongs HERE, not
 * in the migration file: editing an applied migration rewrites recorded history
 * and breaks source-checksum integrity.
 *
 * This module runs registered pre-down steps immediately before a migration's
 * own `down()`. Each step is:
 *
 *   - narrowly scoped to one migration id;
 *   - limited to removing rows the migration's own `down()` is about to orphan;
 *   - idempotent and safe to run when the tables are already absent;
 *   - documented with the concrete failure it prevents.
 *
 * A step must never destroy data the migration was not responsible for. These
 * are dependency resolutions, not data cleanups of convenience.
 */

/** True when a table exists in the current schema. */
function tableExists(dialect, table) {
  return Boolean(
    dialect.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table)
  );
}

/**
 * Null a self-referencing foreign key before its table is dropped.
 *
 * SQLite's DROP TABLE performs an implicit DELETE FROM. A row whose FK points at
 * another row in the same table therefore violates the constraint during the
 * drop, even though the whole table is going away.
 */
function breakSelfReference(dialect, table, column) {
  if (!tableExists(dialect, table)) return { table, column, skipped: 'table absent' };
  const before = dialect
    .prepare(`SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" <> ''`)
    .get().n;
  if (!before) return { table, column, cleared: 0 };
  dialect.exec(`UPDATE "${table}" SET "${column}" = NULL WHERE "${column}" IS NOT NULL;`);
  return { table, column, cleared: before };
}

/**
 * Remove settings owned by a module, innermost dependency first.
 *
 *     settings_values.key -> platform_settings.key -> platform_modules.id
 *
 * Settings can be registered against a module at RUNTIME rather than by a
 * migration, so no later migration's `down()` removes them. When a module-owning
 * migration deletes its `platform_modules` row, those runtime rows are left
 * dangling and the rollback aborts at commit time.
 */
function clearModuleSettings(dialect, moduleId) {
  const result = { moduleId, settingsValues: 0, settings: 0 };
  if (!tableExists(dialect, 'platform_settings')) return { ...result, skipped: 'platform_settings absent' };

  if (tableExists(dialect, 'settings_values')) {
    const rows = dialect
      .prepare('SELECT COUNT(*) AS n FROM settings_values WHERE key IN (SELECT key FROM platform_settings WHERE module_id = ?)')
      .get(moduleId).n;
    if (rows) {
      dialect
        .prepare('DELETE FROM settings_values WHERE key IN (SELECT key FROM platform_settings WHERE module_id = ?)')
        .run(moduleId);
      result.settingsValues = rows;
    }
  }

  const settings = dialect.prepare('SELECT COUNT(*) AS n FROM platform_settings WHERE module_id = ?').get(moduleId).n;
  if (settings) {
    dialect.prepare('DELETE FROM platform_settings WHERE module_id = ?').run(moduleId);
    result.settings = settings;
  }
  return result;
}

/**
 * Registry of pre-down compatibility steps, keyed by migration id.
 *
 * Add an entry only with a reproduced failure and a note describing it.
 */
export const PRE_DOWN_STEPS = Object.freeze({
  '014_finance_canonical_schema_and_coa': {
    reason:
      'down() drops finance_accounts, whose parent_id self-references, and deletes its ' +
      'platform_modules row while runtime-registered settings still reference it. ' +
      'Reproduced on a populated clone: 11 of 16 accounts self-referenced, and ' +
      'settings_values -> platform_settings -> platform_modules left one dangling ' +
      'reference that aborted the rollback at COMMIT.',
    apply(dialect) {
      return {
        selfReference: breakSelfReference(dialect, 'finance_accounts', 'parent_id'),
        moduleSettings: clearModuleSettings(dialect, 'finance_canonical'),
      };
    },
  },
});

/**
 * Run the registered pre-down step for a migration, if any.
 * Returns a describable result for the run report, or null when nothing applied.
 */
export function applyPreDownCompatibility(dialect, migrationId, dialectName = 'sqlite') {
  const step = PRE_DOWN_STEPS[migrationId];
  if (!step) return null;
  // These steps use SQLite-specific schema introspection. Other dialects fall
  // through untouched rather than silently claiming coverage they do not have.
  if (dialectName !== 'sqlite') {
    return { migrationId, skipped: `no compatibility step implemented for dialect "${dialectName}"` };
  }
  return { migrationId, reason: step.reason, detail: step.apply(dialect) };
}

export function hasPreDownCompatibility(migrationId) {
  return Object.hasOwn(PRE_DOWN_STEPS, migrationId);
}
