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
const targetFlag = args.indexOf('--to');
const target = targetFlag >= 0 ? args[targetFlag + 1] : null;
const stepsFlag = args.indexOf('--steps');
const steps = stepsFlag >= 0 ? Number(args[stepsFlag + 1]) : null;
const allowFullChain = args.includes('--allow-full-chain');

if (command === 'status') {
  console.log(JSON.stringify(await migrationStatus({ dbPath }), null, 2));
} else if (command === 'up' || command === 'down') {
  const result = await runMigrations({ dbPath, direction: command, dryRun, actor, target, steps, allowFullChain });
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
  console.error(
    'Usage: node scripts/migrate.mjs [status|up|down|fresh|fingerprint] [--db path] [--dry-run] [--actor actor]\n' +
      '  down targets (choose one):\n' +
      '    --to <migration_id>   roll back everything applied after <migration_id>\n' +
      '    --steps <n>           roll back the n most recent migrations\n' +
      '    --allow-full-chain    confirm total teardown of a populated database\n' +
      '  Rollback is refused against the operational database.'
  );
  process.exitCode = 1;
}
