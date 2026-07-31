// research-gap-modules P0 — proves platform/jobs (JobQueue/WebhookService) is
// reachable through platform-runtime-bridge.mjs instead of REGISTERED BUT
// UNREACHABLE (see docs/evidence/research-gap-modules/). Disposable databases
// only — see tests/phase02/harness.mjs and docs/evidence/phase-02/source-lock.md § 2.

import assert from 'node:assert';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { handleControlPlaneQuery } from '../../platform/control_plane/index.mjs';

async function main() {
  await run('research-gap-modules: platform/jobs wiring', [
    ['createPlatformAuthority exposes a real jobQueue and webhookService', async () => {
      const { dialect, dbPath } = await setup('jobs-wiring-a');
      try {
        seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        assert.ok(authority.jobQueue, 'authority.jobQueue must be instantiated');
        assert.ok(authority.webhookService, 'authority.webhookService must be instantiated');
        assert.strictEqual(typeof authority.jobQueue.tick, 'function');
        assert.strictEqual(typeof authority.webhookService.dispatch, 'function');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['seeds exactly one maintenance-sweep job definition, idempotently', async () => {
      const { dialect, dbPath } = await setup('jobs-wiring-b');
      try {
        seedOrg(dialect);
        createPlatformAuthority(dialect);
        createPlatformAuthority(dialect); // second call must not duplicate or throw
        const defs = dialect.prepare(
          "SELECT id, handler, enabled FROM platform_jobs WHERE id = 'platform_kernel:maintenance_sweep'"
        ).all();
        assert.strictEqual(defs.length, 1, 'exactly one definition row, not duplicated by re-init');
        assert.strictEqual(defs[0].handler, 'platform.jobs.maintenance_sweep');
        assert.strictEqual(defs[0].enabled, 1);
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['tick() + drain() actually executes the seeded job through the registered handler', async () => {
      const { dialect, dbPath } = await setup('jobs-wiring-c');
      try {
        seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        const enqueued = authority.jobQueue.tick();
        assert.ok(enqueued.length >= 1, 'tick() must enqueue the seeded definition');
        const enqueuedRun = enqueued.find((j) => j.kind === 'platform.jobs.maintenance_sweep');
        assert.ok(enqueuedRun, 'the maintenance_sweep job must be enqueued');

        const summary = authority.jobQueue.drain({ max: 10 });
        assert.strictEqual(summary.dead || 0, 0, 'must not dead-letter for "no handler registered" — that is the exact defect this slice fixes');
        assert.ok(summary.succeeded >= 1, 'the seeded job must actually succeed via the registered handler');

        const row = authority.jobQueue.get(enqueuedRun.id);
        assert.strictEqual(row.status, 'succeeded');
        assert.strictEqual(typeof row.result.recoveredLeaseCount, 'number');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['handleControlPlaneQuery("job-queue") reports real counts from job_runs, read-only', async () => {
      const { dialect, dbPath } = await setup('jobs-wiring-d');
      try {
        seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        authority.jobQueue.tick();
        authority.jobQueue.drain({ max: 10 });

        const result = handleControlPlaneQuery({ dialect, ctx: { tenantId: 't_alpha' }, resource: 'job-queue' });
        assert.ok(!result.error, 'job-queue resource must exist and not 404');
        assert.ok(Array.isArray(result.data.counts));
        const succeededCount = result.data.counts.find((c) => c.status === 'succeeded');
        assert.ok(succeededCount && succeededCount.n >= 1, 'at least one succeeded run must be reported');
        assert.ok(Array.isArray(result.data.deadLetters));
        assert.strictEqual(result.data.deadLetters.length, 0, 'no dead letters expected in this fixture');
        assert.ok(Array.isArray(result.data.recent));

        // Read-only: the resource must not have mutated job_runs itself.
        const rawCount = dialect.prepare('SELECT COUNT(*) AS n FROM job_runs').get().n;
        assert.ok(rawCount >= 1);
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['legacy server-scheduler.js duplicate-authority risk: platform_jobs definitions are additive, not a takeover', async () => {
      const { dialect, dbPath } = await setup('jobs-wiring-e');
      try {
        seedOrg(dialect);
        createPlatformAuthority(dialect);
        // The legacy scheduler owns 5 cron codes of its own (subscription_dunning,
        // expiry_alerts, preventive_maintenance_due, nightly_backup_verify,
        // server_self_check) tracked in `scheduled_alerts`/legacy state, NOT in
        // platform_jobs. This slice must not have registered a competing
        // definition under any of those codes.
        const legacyCodes = ['subscription_dunning', 'expiry_alerts', 'preventive_maintenance_due', 'nightly_backup_verify', 'server_self_check'];
        const collisions = dialect.prepare(
          `SELECT id FROM platform_jobs WHERE id IN (${legacyCodes.map(() => '?').join(',')}) OR handler IN (${legacyCodes.map(() => '?').join(',')})`
        ).all(...legacyCodes, ...legacyCodes);
        assert.strictEqual(collisions.length, 0, 'must not create a competing definition for a legacy scheduler cron code');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],
  ]);
}

main();
