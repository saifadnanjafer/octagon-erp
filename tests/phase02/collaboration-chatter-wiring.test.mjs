// tests/phase02/collaboration-chatter-wiring.test.mjs
//
// Verification for RG2-P0: Collaboration & Chatter Runtime Wiring

'use strict';

import assert from 'node:assert';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';

function seedRecord(dialect, entity, id, companyId, createdBy) {
  const now = new Date().toISOString();
  dialect.prepare(`
    INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version)
    VALUES (?, ?, ?, '{}', ?, ?, ?, 0, 1)
    ON CONFLICT DO NOTHING
  `).run(entity, id, companyId, now, now, createdBy);
}

async function main() {
  await run('research-gap-modules: platform/collaboration wiring', [
    ['createPlatformAuthority exposes historyService and chatterService', async () => {
      const { dialect, dbPath } = await setup('collab-wiring-a');
      try {
        seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        assert.ok(authority.historyService, 'authority.historyService must be instantiated');
        assert.ok(authority.chatterService, 'authority.chatterService must be instantiated');
        assert.strictEqual(typeof authority.historyService.track, 'function');
        assert.strictEqual(typeof authority.chatterService.post, 'function');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['Collaboration actions execute cleanly through ActionExecutor', async () => {
      const { dialect, dbPath } = await setup('collab-wiring-b');
      try {
        const fixture = seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        seedRecord(dialect, 'work_item', 'wi_1001', fixture.companyA1, fixture.userOwner);
        seedRecord(dialect, 'work_item', 'wi_1000', fixture.companyA1, fixture.userOwner);

        const ctx = {
          actorId: fixture.userOwner,
          actorType: 'user',
          userId: fixture.userOwner,
          tenantId: fixture.tenantA,
          companyId: fixture.companyA1,
          activeCompanyId: fixture.companyA1,
          companyMemberships: [fixture.companyA1],
          enabledModules: ['platform_kernel'],
        };

        // 1. Post a chatter message
        const msgResult = authority.actionExecutor.execute('collaboration:message_post', {
          entity: 'work_item',
          record_id: 'wi_1001',
          body: 'هذه ملاحظة اختبار أولى في المحادثة',
          visibility: 'internal',
        }, ctx);
        assert.ok(msgResult?.id, 'should return generated message ID');

        // 2. Follow record
        const followResult = authority.actionExecutor.execute('collaboration:record_follow', {
          entity: 'work_item',
          record_id: 'wi_1001',
        }, ctx);
        assert.ok(Array.isArray(followResult), 'followers should be an array');
        assert.ok(followResult.some((f) => f.userId === fixture.userOwner), 'userOwner should be a follower');

        // 3. Create activity
        const actResult = authority.actionExecutor.execute('collaboration:activity_create', {
          entity: 'work_item',
          record_id: 'wi_1001',
          kind: 'todo',
          summary_ar: 'مراجعة العقد الفني',
        }, ctx);
        assert.ok(actResult?.id, 'should return created activity');
        assert.strictEqual(actResult.status, 'open');

        // 4. Complete activity
        const compResult = authority.actionExecutor.execute('collaboration:activity_complete', {
          activity_id: actResult.id,
        }, ctx);
        assert.strictEqual(compResult?.status, 'done');

        // 5. Track field history & read
        authority.historyService.track({
          entity: 'work_item',
          recordId: 'wi_1001',
          recordVersion: 1,
          before: { status: 'draft', amount: 1000 },
          after: { status: 'in_progress', amount: 1500 },
          ctx,
        });
        const historyRows = authority.historyService.read('work_item', 'wi_1001', ctx);
        assert.ok(historyRows.length >= 2, 'should track field changes');

        // 6. Create Snapshot
        const snapResult = authority.actionExecutor.execute('history:snapshot_create', {
          entity: 'work_item',
          record_id: 'wi_1001',
          record_version: 1,
          reason: 'posting_lock',
          payload: { status: 'posted', total: 1500 },
        }, ctx);
        assert.ok(snapResult?.id, 'should return snapshot object');
        assert.strictEqual(snapResult.checksum, authority.historyService.verifySnapshot(snapResult.id).expected);

        // 7. Duplicate snapshot for same version and reason fails
        assert.throws(() => {
          authority.actionExecutor.execute('history:snapshot_create', {
            entity: 'work_item',
            record_id: 'wi_1001',
            record_version: 1,
            reason: 'posting_lock',
            payload: { status: 'posted', total: 1500 },
          }, ctx);
        }, /snapshot for this version and reason already exists/);

        // 8. Link Lineage
        const lineageResult = authority.actionExecutor.execute('history:lineage_link', {
          entity: 'work_item',
          record_id: 'wi_1001',
          relation: 'amends',
          related_entity: 'work_item',
          related_record_id: 'wi_1000',
          reason: 'تصحيح الخطأ السابق',
        }, ctx);
        assert.ok(Array.isArray(lineageResult), 'should return lineage rows');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],

    ['Governed Collaboration queries return valid responses through mountApi', async () => {
      const { dialect, dbPath } = await setup('collab-wiring-c');
      try {
        const fixture = seedOrg(dialect);
        const authority = createPlatformAuthority(dialect);
        seedRecord(dialect, 'work_item', 'wi_1001', fixture.companyA1, fixture.userOwner);
        const apiHandler = await authority.mountApi('/api/v1');

        const ctx = {
          userId: fixture.userOwner,
          actorType: 'user',
          companyId: fixture.companyA1,
          correlationId: 'corr_test_collab',
        };

        const mockReq = (url, method = 'GET') => ({
          method,
          headers: {
            'x-user': ctx.userId,
            'x-company': ctx.companyId,
            'x-correlation-id': ctx.correlationId,
          },
        });

        const mockRes = () => {
          let statusCode = 200;
          let body = null;
          return {
            writeHead(status) { statusCode = status; },
            end(data) { body = JSON.parse(data); },
            getStatus: () => statusCode,
            getBody: () => body,
          };
        };

        // Post a message first
        authority.actionExecutor.execute('collaboration:message_post', {
          entity: 'work_item',
          record_id: 'wi_1001',
          body: 'رسالة للاستعلام',
        }, { actorId: fixture.userOwner, userId: fixture.userOwner, tenantId: fixture.tenantA, companyId: fixture.companyA1, activeCompanyId: fixture.companyA1, companyMemberships: [fixture.companyA1] });

        // Query messages
        const res1 = mockRes();
        const url1 = new URL('http://localhost/api/v1/collaboration/messages?entity=work_item&record_id=wi_1001');
        await apiHandler(mockReq(url1), res1, url1);
        assert.strictEqual(res1.getStatus(), 200);
        assert.ok(Array.isArray(res1.getBody()?.data), 'data should contain messages');
        assert.strictEqual(res1.getBody().data.length, 1);

        // Query my activities
        const res2 = mockRes();
        const url2 = new URL('http://localhost/api/v1/collaboration/my_activities');
        await apiHandler(mockReq(url2), res2, url2);
        assert.strictEqual(res2.getStatus(), 200);
        assert.ok(Array.isArray(res2.getBody()?.data), 'data should contain my activities');
      } finally {
        await cleanup(dialect, dbPath);
      }
    }],
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
