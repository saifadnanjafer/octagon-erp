// Checkpoint G — multi-process concurrency worker.
//
// Executed as a SEPARATE OS PROCESS by
// tests/checkpoint-g/multi_process_concurrency.test.mjs. Each worker opens its
// OWN database connection to the same disposable SQLite file and issues one
// governed action, so the contention is real inter-process contention rather
// than interleaved microtasks in one event loop.
//
// Contract: argv[2] is a JSON job. The worker prints exactly one JSON line to
// stdout and exits 0 even when the action is rejected — a rejection is a
// result, not a harness failure. The parent decides whether the observed mix of
// winners and losers is correct.

import { openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

function emit(payload) {
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...payload })}\n`);
}

let db;
try {
  const job = JSON.parse(process.argv[2]);
  const { dbPath, actionId, input, idempotencyKey, barrierAt } = job;

  db = openMigrationDatabase(dbPath);
  const executor = createPlatformAuthority(db).actionExecutor;

  const ctx = {
    tenantId: 'default',
    companyId: 'default',
    branchId: 'default',
    userId: job.userId || 'ckg-concurrency',
    sourceChannel: 'node-test',
  };

  // Wall-clock barrier: every worker is told the same start instant by the
  // parent, so they contend rather than queue behind each other's startup cost
  // (module loading dominates otherwise, and the race never actually happens).
  if (barrierAt) {
    const spin = () => { while (Date.now() < barrierAt) { /* busy-wait to the barrier */ } };
    spin();
  }

  const startedAt = Date.now();
  try {
    const result = executor.execute(actionId, { ...input, idempotency_key: idempotencyKey }, ctx);
    emit({ ok: true, actionId, resultId: result?.id ?? null, durationMs: Date.now() - startedAt });
  } catch (err) {
    emit({
      ok: false,
      actionId,
      code: err?.code || null,
      message: String(err?.message || err).slice(0, 300),
      durationMs: Date.now() - startedAt,
    });
  }
} catch (fatal) {
  emit({ ok: false, fatal: true, message: String(fatal?.message || fatal).slice(0, 300) });
} finally {
  try { db?.close(); } catch { /* closing a failed handle is not a result */ }
}
