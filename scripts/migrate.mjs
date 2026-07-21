#!/usr/bin/env node
import path from 'node:path';
import { migrationStatus, runMigrations, freshInstall, schemaFingerprint } from '../database/migration-runner/index.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'status';
const dbFlag = args.indexOf('--db');
const dbPath = dbFlag >= 0 ? path.resolve(args[dbFlag + 1]) : path.resolve('database-test-migrations.db');
const dryRun = args.includes('--dry-run');
const actorFlag = args.indexOf('--actor');
const actor = actorFlag >= 0 ? args[actorFlag + 1] : 'cli';

if (command === 'status') {
  console.log(JSON.stringify(await migrationStatus({ dbPath }), null, 2));
} else if (command === 'up' || command === 'down') {
  const result = await runMigrations({ dbPath, direction: command, dryRun, actor });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'fresh') {
  const result = await freshInstall({ dbPath, actor });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'fingerprint') {
  const { openMigrationDatabase } = await import('../database/migration-runner/index.mjs');
  const dialect = openMigrationDatabase(dbPath);
  try {
    console.log(JSON.stringify({ fingerprint: schemaFingerprint(dialect), dbPath }, null, 2));
  } finally {
    dialect.close();
  }
} else {
  console.error('Usage: node scripts/migrate.mjs [status|up|down|fresh|fingerprint] [--db path] [--dry-run] [--actor actor]');
  process.exitCode = 1;
}
