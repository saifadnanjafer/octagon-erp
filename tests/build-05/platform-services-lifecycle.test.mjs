import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openMigrationDatabase, freshInstall } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createMemoryChannel } from '../../platform/notifications/index.mjs';

function tmpDb() {
  return path.join(os.tmpdir(), `octagon-b05-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('BUILD-05 Collaboration, Notification Platform, Scheduled Reports, Search & Saved Views Full Lifecycle', async () => {
  const dbPath = tmpDb();
  await freshInstall({ dbPath });
  const dialect = openMigrationDatabase(dbPath);
  const authority = createPlatformAuthority(dialect);

  dialect.prepare(`
    INSERT INTO identity_users (id, tenant_id, login, name, email, is_owner, status, created_at, updated_at)
    VALUES ('usr_sales_rep', 'default', 'salesrep', 'Sales Rep', 'rep@example.com', 0, 'active', ?, ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString(), new Date().toISOString());

  dialect.prepare(`
    INSERT INTO identity_users (id, tenant_id, login, name, email, is_owner, status, created_at, updated_at)
    VALUES ('build-05-test', 'default', 'b05test', 'B05 Test', 'b05@example.com', 1, 'active', ?, ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString(), new Date().toISOString());

  dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_b05_owner', 'build-05-test', 'user', 'role_default_owner', NULL, 'active', ?, 'test')
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString());

  dialect.prepare(`
    INSERT INTO authorization_role_assignments (id, user_id, actor_type, role_id, company_id, status, created_at, created_by)
    VALUES ('asg_b05_rep', 'usr_sales_rep', 'user', 'role_default_owner', NULL, 'active', ?, 'test')
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString());

  dialect.prepare(`
    INSERT INTO organization_memberships (id, tenant_id, company_id, user_id, status, created_at)
    VALUES ('mem_rep', 'default', 'default', 'usr_sales_rep', 'active', ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString());

  dialect.prepare(`
    INSERT INTO parties (id, company_id, name, status, created_at, updated_at)
    VALUES ('prt_cust_01', 'default', 'VIP Client', 'active', ?, ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString(), new Date().toISOString());

  dialect.prepare(`
    INSERT INTO sale_contracts (id, company_id, name, partner_id, state, start_date, created_at)
    VALUES ('contract_1001', 'default', 'CNT-1001', 'prt_cust_01', 'active', '2026-08-01', ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString());

  dialect.prepare(`
    INSERT INTO x_records (id, entity, company_id, created_by, data, created_at, updated_at)
    VALUES ('contract_1001', 'sale_contract', 'default', 'build-05-test', '{}', ?, ?)
    ON CONFLICT DO NOTHING
  `).run(new Date().toISOString(), new Date().toISOString());

  const ctx = {
    userId: 'build-05-test',
    actorId: 'build-05-test',
    companyId: 'default',
    branchId: 'default',
    now: new Date().toISOString(),
  };

  // 1. Collaboration & Activities
  const post = authority.chatter.post({
    entity: 'sale_contract',
    recordId: 'contract_1001',
    body: 'Contract created for VIP client',
    ctx,
  });
  assert.ok(post.id);
  assert.ok(post.threadId);

  authority.chatter.addFollower('sale_contract', 'contract_1001', 'usr_sales_rep', ctx);
  let followers = authority.chatter.followers('sale_contract', 'contract_1001');
  assert.equal(followers.some(f => f.userId === 'usr_sales_rep'), true);

  authority.chatter.removeFollower('sale_contract', 'contract_1001', 'usr_sales_rep', ctx);
  followers = authority.chatter.followers('sale_contract', 'contract_1001');
  assert.equal(followers.some(f => f.userId === 'usr_sales_rep'), false);

  const act = authority.chatter.createActivity({
    entity: 'sale_contract',
    recordId: 'contract_1001',
    kind: 'call',
    summaryAr: 'متابعة العقد مع العميل',
    assigneeId: 'usr_sales_rep',
    ctx,
  });
  assert.ok(act.id);
  assert.equal(act.status, 'open');

  const reassigned = authority.chatter.reassignActivity(act.id, 'usr_mgr_01', ctx);
  assert.equal(reassigned.assigneeId, 'usr_mgr_01');

  const completed = authority.chatter.completeActivity(act.id, ctx);
  assert.equal(completed.status, 'done');

  const reopened = authority.chatter.reopenActivity(act.id, ctx);
  assert.equal(reopened.status, 'open');

  const snap = authority.history.snapshot({
    entity: 'sale_contract',
    recordId: 'contract_1001',
    recordVersion: 1,
    reason: 'Initial approval snapshot',
    payload: { totalAmount: 50000, status: 'approved' },
    ctx,
  });
  assert.ok(snap.id);
  const verifyResult = authority.history.verifySnapshot(snap.id);
  assert.equal(verifyResult.valid, true);

  const lineageLinks = authority.history.link({
    entity: 'sale_contract',
    recordId: 'contract_1001',
    relation: 'amends',
    relatedEntity: 'sale_contract',
    relatedRecordId: 'contract_1000',
    reason: 'Contract amendment v2',
    ctx,
  });
  assert.ok(lineageLinks.length > 0);

  // 2. Notification Platform
  const emailChannel = createMemoryChannel('email');
  authority.notifications.registerChannel(emailChannel);

  authority.notifications.defineTemplate({
    id: 'tpl_contract_approved',
    moduleId: 'platform_kernel',
    eventKey: 'contract.approved',
    locale: 'ar',
    channel: 'email',
    subject: 'تم اعتماد العقد {{contractNumber}}',
    body: 'عزيزي {{recipientName}}، تم اعتماد العقد الخاص بك بمبلغ {{amount}}',
    category: 'informational',
  });

  const notifyRes = authority.notifications.notify({
    recipientId: 'usr_sales_rep',
    eventKey: 'contract.approved',
    subject: 'تم اعتماد العقد 1001',
    body: 'عزيزي المندوب، تم اعتماد العقد',
    channels: ['inapp', 'email'],
    companyId: 'cmp_main',
  });
  assert.equal(notifyRes.created, true);

  const dispatchSummary = authority.notifications.dispatch({ batchSize: 10 });
  assert.equal(dispatchSummary.delivered >= 2, true);
  assert.equal(emailChannel.sent.length, 1);

  // Preference suppression test
  authority.notifications.setPreference('usr_sales_rep', 'contract.approved', 'email', false);
  const enabledBefore = authority.notifications.isChannelEnabled('usr_sales_rep', 'contract.approved', 'email', 'informational');
  assert.equal(enabledBefore, false);

  // Mandatory security/legal category bypasses preference suppression
  const mandatoryEnabled = authority.notifications.isChannelEnabled('usr_sales_rep', 'contract.approved', 'email', 'security');
  assert.equal(mandatoryEnabled, true);

  // Inbox operations
  const unreadCount = authority.notifications.unreadCount({ actorId: 'usr_sales_rep' });
  assert.ok(unreadCount >= 1);

  const inboxItems = authority.notifications.inbox({ actorId: 'usr_sales_rep' });
  assert.ok(inboxItems.length > 0);

  authority.notifications.markRead(inboxItems[0].id, { actorId: 'usr_sales_rep' });
  authority.notifications.archive(inboxItems[0].id, { actorId: 'usr_sales_rep' });

  // 3. Scheduled Reports
  const reportSchedule = authority.scheduledReports.create({
    name: 'التقرير الأسبوعي للمبيعات',
    report_key: 'sales_weekly_summary',
    schedule: '0 8 * * 1',
    audience: ['usr_owner_01', 'usr_sales_rep'],
    format: 'pdf',
  }, ctx);
  assert.ok(reportSchedule.id);
  assert.equal(reportSchedule.active, true);

  const deliveryResult = authority.scheduledReports.deliver({
    jobId: `scheduled_report_${reportSchedule.id}`,
    createdAt: new Date().toISOString(),
  });
  assert.equal(deliveryResult.staged, true);
  assert.equal(deliveryResult.deliveries.length, 2);

  const paused = authority.scheduledReports.pause(reportSchedule.id, ctx);
  assert.equal(paused.active, false);

  // 4. Search & Saved Views
  const searchResults = authority.platformSearch.search('sale_contract');
  assert.ok(searchResults.length > 0);

  const savedView = authority.configuration.saveView({
    entity: 'sale_contract',
    name: 'عقود المبيعات النشطة',
    filters: { status: { op: 'eq', value: 'approved' } },
    view_type: 'list',
    ownerId: ctx.userId,
    companyId: ctx.companyId,
  }, ctx.userId, ctx);
  assert.ok(savedView.id);

  dialect.close();
  fs.unlinkSync(dbPath);
});
