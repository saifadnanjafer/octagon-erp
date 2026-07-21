// Phase 02 Wave E — record history, snapshots, lineage, chatter, activities,
// notifications, secure files, import/export/print/public forms, jobs, webhooks.
// Packets 02.24 – 02.29. Disposable databases only.

import assert from 'node:assert';
import crypto from 'node:crypto';
import { setup, cleanup, run, seedOrg } from './harness.mjs';
import { createHistoryService, createChatterService, CollaborationError } from '../../platform/collaboration/index.mjs';
import { createNotificationService, createMemoryChannel, NotificationError, MANDATORY_CATEGORIES } from '../../platform/notifications/index.mjs';
import { createFileService, createMemoryStorage, safeFilename, FileError } from '../../platform/files/index.mjs';
import { createJobQueue, createWebhookService, WebhookService, JobError } from '../../platform/jobs/index.mjs';
import { createDataExchangeService, neutralizeFormula, toCsv, DataExchangeError } from '../../platform/data-exchange/index.mjs';
import { createPermissionRegistry } from '../../platform/authorization/registry/index.mjs';
import { createPermissionEvaluator, AuthorizationError } from '../../platform/authorization/evaluator/index.mjs';
import { createRoleAdministration } from '../../platform/authorization/roles/index.mjs';
import { createMembershipDirectory } from '../../platform/organizations/memberships/index.mjs';
import { buildDecisionContext, stripUntrustedContext, systemContext } from '../../platform/identity/context/index.mjs';
import { createActionRegistry, createActionExecutor } from '../../platform/kernel/actions/index.mjs';
import { createOutboxDispatcher } from '../../platform/outbox/index.mjs';
import { createSecretVault } from '../../platform/settings/secrets/index.mjs';
import { createConfigurationAuthority } from '../../platform/configuration/index.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

const PERMS = [
  { id: 'crm:crm_lead:read', module_id: 'platform_kernel', kind: 'resource', label_ar: 'قراءة' },
  { id: 'crm:crm_lead:update', module_id: 'platform_kernel', kind: 'action', label_ar: 'تعديل' },
  { id: 'crm:crm_lead:create', module_id: 'platform_kernel', kind: 'action', label_ar: 'إنشاء' },
  { id: 'crm:crm_lead:import', module_id: 'platform_kernel', kind: 'import', label_ar: 'استيراد' },
  { id: 'crm:crm_lead:export', module_id: 'platform_kernel', kind: 'export', label_ar: 'تصدير' },
  { id: 'crm:crm_lead:print', module_id: 'platform_kernel', kind: 'print', label_ar: 'طباعة' },
  { id: 'platform:file:share', module_id: 'platform_kernel', kind: 'share', label_ar: 'مشاركة ملف' },
];

function bootstrap(dialect, { now } = {}) {
  const org = seedOrg(dialect);
  const registry = createPermissionRegistry(dialect);
  registry.registerMany(PERMS);
  const evaluator = createPermissionEvaluator(dialect, { permissionRegistry: registry });
  const roles = createRoleAdministration(dialect, { permissionRegistry: registry, evaluator });
  const memberships = createMembershipDirectory(dialect);

  const actionRegistry = createActionRegistry(dialect);
  const actionExecutor = createActionExecutor(dialect);
  actionRegistry.register({ id: 'crm:import_lead', module_id: 'platform_kernel', entity_id: 'crm_lead', kind: 'domain', transaction_owner: 'action', idempotency_policy: 'supported' });
  const imported = [];
  actionExecutor.registerHandler('crm:import_lead', ({ input }) => {
    if (!input.data?.name) throw new Error('name is required');
    const id = `lead_${imported.length + 1}`;
    imported.push(input.data);
    return { record_id: id };
  });

  const notifications = createNotificationService(dialect, { evaluator, now });
  const storage = createMemoryStorage();
  const files = createFileService(dialect, { storage, evaluator, now });
  const history = createHistoryService(dialect, { evaluator, now });
  const chatter = createChatterService(dialect, { evaluator, notifications, now });
  const configuration = createConfigurationAuthority(dialect, { evaluator });
  const exchange = createDataExchangeService(dialect, { evaluator, actionExecutor, configuration, now });
  const jobs = createJobQueue(dialect, { now });
  const vault = createSecretVault(dialect, { key: TEST_KEY });

  const ctxFor = (userId, request = {}) =>
    buildDecisionContext(dialect, { actorId: userId, actorType: 'user' }, stripUntrustedContext(request), { membershipDirectory: memberships });

  // The manager can do everything on crm_lead; the clerk can only read its own.
  roles.createRole({ id: 'r_ops', tenantId: org.tenantA, name: 'ops' });
  roles.setGrants('r_ops', [{ permission: 'crm:*', scope: 'all' }, { permission: 'platform:file:share', scope: 'all' }]);
  roles.assign({ userId: org.userManager, roleId: 'r_ops', companyId: org.companyA1 });
  roles.createRole({ id: 'r_read', tenantId: org.tenantA, name: 'reader' });
  roles.setGrants('r_read', [{ permission: 'crm:crm_lead:read', scope: 'company' }, { permission: 'crm:crm_lead:update', scope: 'company' }]);
  roles.assign({ userId: org.userClerk, roleId: 'r_read', companyId: org.companyA1 });

  return { org, registry, evaluator, roles, memberships, notifications, files, storage, history, chatter, exchange, jobs, vault, actionRegistry, actionExecutor, configuration, imported, ctxFor };
}

function seedRecord(dialect, { entity = 'crm_lead', id, companyId, createdBy = 'u_manager', data = {} }) {
  const now = new Date().toISOString();
  dialect.prepare(`INSERT INTO x_records (entity, id, company_id, data, created_at, updated_at, created_by, removed, version) VALUES (?,?,?,?,?,?,?,0,1)`)
    .run(entity, id, companyId, JSON.stringify(data), now, now, createdBy);
  return id;
}

// --- 02.24 history, snapshots, lineage --------------------------------------

async function testHistoryTracksOnlyRealChanges() {
  const { dialect, dbPath } = await setup();
  const { org, history, ctxFor } = bootstrap(dialect);
  const ctx = ctxFor(org.userManager);
  const written = history.track({
    entity: 'crm_lead', recordId: 'lead_1', recordVersion: 2,
    before: { name: 'Acme', status: 'new', note: 'x' },
    after: { name: 'Acme Corp', status: 'new', note: 'x' },
    ctx,
  });
  assert.deepStrictEqual(written, ['name'], 'an unchanged field writes no history row');
  const rows = history.read('crm_lead', 'lead_1', ctx);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].actor_id, org.userManager);
  assert.strictEqual(rows[0].source_channel, 'ui');
  assert.strictEqual(JSON.parse(rows[0].new_value), 'Acme Corp');
  await cleanup(dialect, dbPath);
}

async function testHistoryIsMaskedLikeTheRecord() {
  const { dialect, dbPath } = await setup();
  const { org, history, roles, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_read', [
    { entity: 'crm_lead', field: 'national_id', access: 'masked' },
    { entity: 'crm_lead', field: 'internal_score', access: 'none' },
  ]);
  const mgrCtx = ctxFor(org.userManager);
  history.track({
    entity: 'crm_lead', recordId: 'lead_1', recordVersion: 2,
    before: { national_id: '199012345678', internal_score: 10, name: 'A' },
    after: { national_id: '199099999999', internal_score: 99, name: 'B' },
    ctx: mgrCtx,
  });
  const clerkView = history.read('crm_lead', 'lead_1', ctxFor(org.userClerk));
  assert.ok(!clerkView.some((r) => r.field === 'internal_score'), 'a hidden field never appears in history');
  const maskedRow = clerkView.find((r) => r.field === 'national_id');
  assert.strictEqual(maskedRow.masked, true);
  assert.ok(!String(maskedRow.new_value).includes('199099999999'), 'history cannot be a masking bypass');
  assert.ok(clerkView.some((r) => r.field === 'name'));
  await cleanup(dialect, dbPath);
}

async function testSnapshotImmutabilityAndLineage() {
  const { dialect, dbPath } = await setup();
  const { org, history, ctxFor } = bootstrap(dialect);
  const ctx = ctxFor(org.userManager);
  const snap = history.snapshot({
    entity: 'invoice', recordId: 'inv_1', recordVersion: 1, reason: 'posted',
    payload: { total: 1000 },
    relations: { customer_name: 'Acme', customer_address: 'Baghdad', tax_rate: 0.15, unit_price: 250 },
    ctx,
  });
  assert.strictEqual(snap.immutable, true);
  assert.strictEqual(history.verifySnapshot(snap.id).valid, true);

  // a second snapshot for the same version+reason is refused
  assert.throws(() => history.snapshot({ entity: 'invoice', recordId: 'inv_1', recordVersion: 1, reason: 'posted', payload: { total: 9999 }, ctx }),
    (e) => e.code === 'SNAPSHOT_IMMUTABLE');
  // the original is untouched: the posted document keeps the values it was posted with
  assert.strictEqual(history.getSnapshot(snap.id).payload.total, 1000);
  assert.strictEqual(history.getSnapshot(snap.id).relations.customer_name, 'Acme');

  // tampering is detectable
  dialect.prepare("UPDATE record_snapshots SET payload = ? WHERE id = ?").run(JSON.stringify({ total: 5 }), snap.id);
  assert.strictEqual(history.verifySnapshot(snap.id).valid, false);

  // amendment lineage is recorded in both directions
  history.link({ entity: 'invoice', recordId: 'inv_2', relation: 'amends', relatedEntity: 'invoice', relatedRecordId: 'inv_1', reason: 'price correction', ctx });
  assert.strictEqual(history.lineage('invoice', 'inv_2')[0].relation, 'amends');
  assert.strictEqual(history.lineage('invoice', 'inv_1')[0].relation, 'amended_by');
  assert.throws(() => history.link({ entity: 'invoice', recordId: 'x', relation: 'nonsense', relatedEntity: 'invoice', relatedRecordId: 'y', ctx }),
    (e) => e.code === 'LINEAGE_RELATION_INVALID');
  await cleanup(dialect, dbPath);
}

async function testRetentionNeverPurgesSnapshots() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T00:00:00.000Z');
  const { org, history, ctxFor } = bootstrap(dialect, { now: () => clock });
  const ctx = ctxFor(org.userManager);
  history.track({ entity: 'crm_lead', recordId: 'lead_1', recordVersion: 1, before: {}, after: { name: 'A' }, ctx });
  history.snapshot({ entity: 'invoice', recordId: 'inv_1', recordVersion: 1, reason: 'posted', payload: { total: 1 }, ctx });
  history.setRetention({ subject: 'record_history', retainDays: 30, action: 'purge' });

  clock = new Date('2026-10-21T00:00:00.000Z');
  const result = history.applyRetention();
  assert.strictEqual(result[0].removed, 1, 'old history is purged by policy');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM record_snapshots').get().n), 1,
    'an immutable snapshot of a posted document outlives the retention window');
  await cleanup(dialect, dbPath);
}

// --- 02.25 chatter, followers, activities ------------------------------------

async function testChatterInheritsRecordPermission() {
  const { dialect, dbPath } = await setup();
  const { org, chatter, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const mgrCtx = ctxFor(org.userManager);
  chatter.post({ entity: 'crm_lead', recordId: 'lead_1', body: 'مرحباً', ctx: mgrCtx, readPermission: 'crm:crm_lead:read' });

  // the outsider is in another company and cannot read the record — nor its chatter
  const outsiderCtx = ctxFor(org.userOutsider);
  assert.throws(() => chatter.messages('crm_lead', 'lead_1', outsiderCtx, { readPermission: 'crm:crm_lead:read' }),
    (e) => e instanceof AuthorizationError);
  assert.throws(() => chatter.post({ entity: 'crm_lead', recordId: 'lead_1', body: 'x', ctx: outsiderCtx, readPermission: 'crm:crm_lead:read' }),
    (e) => e instanceof AuthorizationError);
  assert.strictEqual(chatter.messages('crm_lead', 'lead_1', ctxFor(org.userClerk), { readPermission: 'crm:crm_lead:read' }).length, 1);
  await cleanup(dialect, dbPath);
}

async function testMentionScopeAndFollowerAuthorization() {
  const { dialect, dbPath } = await setup();
  const { org, chatter, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const mgrCtx = ctxFor(org.userManager);
  // mentioning the outsider (no access) silently drops the mention rather than
  // notifying them about a record they cannot see
  const posted = chatter.post({
    entity: 'crm_lead', recordId: 'lead_1', body: 'يرجى المتابعة',
    mentions: [org.userClerk, org.userOutsider], ctx: mgrCtx, readPermission: 'crm:crm_lead:read',
  });
  assert.deepStrictEqual(posted.mentions, [org.userClerk]);
  assert.deepStrictEqual(posted.droppedMentions, [org.userOutsider]);

  // subscribing an unauthorized user as a follower is refused outright
  assert.throws(() => chatter.addFollower('crm_lead', 'lead_1', org.userOutsider, mgrCtx, { readPermission: 'crm:crm_lead:read' }),
    (e) => e.code === 'FOLLOWER_NOT_AUTHORIZED');
  chatter.addFollower('crm_lead', 'lead_1', org.userClerk, mgrCtx, { readPermission: 'crm:crm_lead:read' });
  assert.ok(chatter.followers('crm_lead', 'lead_1').some((f) => f.userId === org.userClerk));
  assert.ok(chatter.followers('crm_lead', 'lead_1').some((f) => f.userId === org.userManager), 'the author follows automatically');
  await cleanup(dialect, dbPath);
}

async function testAttachmentCannotBeSmuggledAcrossRecords() {
  const { dialect, dbPath } = await setup();
  const { org, chatter, files, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  seedRecord(dialect, { id: 'lead_2', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const file = files.upload({
    filename: 'quote.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 quote'),
    entity: 'crm_lead', recordId: 'lead_2', ctx, writePermission: 'crm:crm_lead:update',
  });
  assert.throws(() => chatter.post({ entity: 'crm_lead', recordId: 'lead_1', body: 'انظر المرفق', attachments: [file.id], ctx, readPermission: 'crm:crm_lead:read' }),
    (e) => e.code === 'ATTACHMENT_NOT_ON_RECORD');
  await cleanup(dialect, dbPath);
}

async function testActivitiesAndDeadlines() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, chatter, ctxFor } = bootstrap(dialect, { now: () => clock });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const activity = chatter.createActivity({
    entity: 'crm_lead', recordId: 'lead_1', summaryAr: 'اتصل بالعميل',
    assigneeId: org.userClerk, dueAt: '2026-07-22T09:00:00.000Z', ctx, readPermission: 'crm:crm_lead:read',
  });
  assert.strictEqual(activity.status, 'open');
  assert.throws(() => chatter.createActivity({ entity: 'crm_lead', recordId: 'lead_1', summaryAr: 'x', assigneeId: org.userOutsider, ctx, readPermission: 'crm:crm_lead:read' }),
    (e) => e.code === 'ASSIGNEE_NOT_AUTHORIZED');

  const clerkCtx = ctxFor(org.userClerk);
  assert.strictEqual(chatter.myActivities(clerkCtx).length, 1);
  assert.strictEqual(chatter.myActivities(clerkCtx, { overdueOnly: true }).length, 0);
  clock = new Date('2026-07-23T09:00:00.000Z');
  assert.strictEqual(chatter.myActivities(clerkCtx, { overdueOnly: true }).length, 1, 'the deadline is now overdue');
  chatter.completeActivity(activity.id, clerkCtx);
  assert.strictEqual(chatter.myActivities(clerkCtx).length, 0);
  await cleanup(dialect, dbPath);
}

// --- 02.26 notifications ----------------------------------------------------

async function testNotificationDedupeAndInbox() {
  const { dialect, dbPath } = await setup();
  const { org, notifications, ctxFor } = bootstrap(dialect);
  const first = notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'عميل جديد', dedupeKey: 'evt-1' });
  const second = notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'عميل جديد', dedupeKey: 'evt-1' });
  assert.strictEqual(first.created, true);
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.deduped, true);

  const clerkCtx = ctxFor(org.userClerk);
  assert.strictEqual(notifications.unreadCount(clerkCtx), 1);
  const inbox = notifications.inbox(clerkCtx);
  assert.strictEqual(inbox.length, 1);
  notifications.markRead(inbox[0].id, clerkCtx);
  assert.strictEqual(notifications.unreadCount(clerkCtx), 0);

  // a recipient cannot read or mutate someone else's notification
  assert.throws(() => notifications.markRead(inbox[0].id, ctxFor(org.userManager)), (e) => e.code === 'NOTIFICATION_NOT_FOUND');
  assert.strictEqual(notifications.inbox(ctxFor(org.userManager)).length, 0);
  await cleanup(dialect, dbPath);
}

async function testPreferencesCannotSilenceSecurityNotices() {
  const { dialect, dbPath } = await setup();
  const { org, notifications } = bootstrap(dialect);
  notifications.defineTemplate({ moduleId: 'platform_kernel', eventKey: 'lead.assigned', body: 'عميل', category: 'informational' });
  notifications.setPreference(org.userClerk, 'lead.assigned', 'email', false);
  const informational = notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'x', channels: ['inapp', 'email'] });
  assert.deepStrictEqual(informational.queuedChannels, ['inapp'], 'the preference suppressed the email channel');

  // a security notice ignores the preference
  notifications.setPreference(org.userClerk, 'identity.security_event', 'email', false);
  const security = notifications.notify({ recipientId: org.userClerk, eventKey: 'identity.security_event', payload: { action: 'password reset' }, channels: ['inapp', 'email'] });
  assert.strictEqual(security.category, 'security');
  assert.deepStrictEqual(security.queuedChannels, ['inapp', 'email'], 'a mandatory category cannot be switched off');
  assert.ok(MANDATORY_CATEGORIES.includes('security'));
  await cleanup(dialect, dbPath);
}

async function testProviderTimeoutRetryAndDeadLetter() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, notifications } = bootstrap(dialect, { now: () => clock });
  const email = createMemoryChannel('email', { failTimes: 2 });
  notifications.registerChannel(email);
  notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'x', channels: ['email'] });

  let summary = notifications.dispatch();
  assert.strictEqual(summary.failed, 1, 'the first attempt failed');
  assert.strictEqual(email.sent.length, 0);
  clock = new Date('2026-07-21T09:05:00.000Z');
  summary = notifications.dispatch();
  assert.strictEqual(summary.failed, 1);
  clock = new Date('2026-07-21T09:15:00.000Z');
  summary = notifications.dispatch();
  assert.strictEqual(summary.delivered, 1, 'the third attempt succeeded');
  assert.strictEqual(email.sent.length, 1);
  assert.strictEqual(notifications.providerHealth().find((p) => p.provider === 'email').status, 'healthy');

  // a permanently broken provider dead-letters instead of retrying forever
  const whatsapp = createMemoryChannel('whatsapp', { alwaysFail: true });
  notifications.registerChannel(whatsapp);
  notifications.notify({ recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'y', channels: ['whatsapp'], dedupeKey: 'wa-1' });
  for (let i = 0; i < 5; i++) { clock = new Date(clock.getTime() + 600000); notifications.dispatch(); }
  assert.strictEqual(notifications.deadLetters().length, 1);
  assert.strictEqual(notifications.providerHealth().find((p) => p.provider === 'whatsapp').status, 'degraded');
  await cleanup(dialect, dbPath);
}

async function testNotificationPayloadIsMasked() {
  const { dialect, dbPath } = await setup();
  const { org, notifications, roles } = bootstrap(dialect);
  roles.setFieldRules('r_read', [{ entity: 'crm_lead', field: 'national_id', access: 'masked' }]);
  notifications.notify({
    recipientId: org.userClerk, eventKey: 'lead.assigned', body: 'عميل جديد',
    payload: { entity: 'crm_lead', data: { name: 'Acme', national_id: '199012345678' } },
  });
  const stored = dialect.prepare('SELECT payload FROM notifications').get().payload;
  assert.ok(!stored.includes('199012345678'), 'a notification payload cannot leak a masked field');
  assert.ok(stored.includes('Acme'));
  await cleanup(dialect, dbPath);
}

async function testOutboxRollbackMeansNoNotification() {
  const { dialect, dbPath } = await setup();
  const { org, notifications } = bootstrap(dialect);
  const dispatcher = createOutboxDispatcher(dialect);
  notifications.consumeOutbox(dispatcher);

  // A transaction that rolls back leaves no outbox row, so nothing is ever sent.
  dialect.exec('BEGIN IMMEDIATE;');
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, actor_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, 'workflow.notify', '1.0.0', 'platform_workflow', 'crm_lead:lead_1', ?, ?, ?, ?, 0, 3, 'pending')
  `).run(crypto.randomUUID(), org.userManager, JSON.stringify({ to: org.userClerk, title: 'rolled back' }), new Date().toISOString(), new Date().toISOString());
  dialect.exec('ROLLBACK;');
  dispatcher.dispatch();
  assert.strictEqual(notifications.inbox({ actorId: org.userClerk }).length, 0, 'a rolled-back transaction sends nothing');

  // A committed one does deliver.
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, actor_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, 'workflow.notify', '1.0.0', 'platform_workflow', 'crm_lead:lead_1', ?, ?, ?, ?, 0, 3, 'pending')
  `).run(crypto.randomUUID(), org.userManager, JSON.stringify({ to: org.userClerk, title: 'committed' }), new Date().toISOString(), new Date().toISOString());
  dispatcher.dispatch();
  assert.strictEqual(notifications.inbox({ actorId: org.userClerk }).length, 1);
  await cleanup(dialect, dbPath);
}

// --- 02.27 secure files -----------------------------------------------------

async function testPathTraversalAndMimeSpoofing() {
  const { dialect, dbPath } = await setup();
  const { org, files, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);

  assert.strictEqual(safeFilename('../../etc/passwd'), 'passwd');
  assert.strictEqual(safeFilename('..\\..\\windows\\system32\\cmd'), 'cmd');
  assert.strictEqual(safeFilename('....'), 'file');

  const traversal = files.upload({
    filename: '../../../etc/passwd.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4'),
    entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update',
  });
  assert.strictEqual(traversal.filename, 'passwd.pdf');
  const storageKey = dialect.prepare('SELECT storage_key FROM file_objects WHERE id = ?').get(traversal.id).storage_key;
  assert.ok(!storageKey.includes('..'), 'the storage key is derived, never caller-supplied');

  // MIME spoofing: a PNG header declared as a PDF
  assert.throws(() => files.upload({
    filename: 'evil.pdf', mimeType: 'application/pdf', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
    entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update',
  }), (e) => e.code === 'FILE_MIME_SPOOFED');

  // blocked extension and disallowed MIME
  assert.throws(() => files.upload({ filename: 'x.exe', mimeType: 'application/pdf', buffer: Buffer.from('%PDF'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' }),
    (e) => e.code === 'FILE_EXTENSION_BLOCKED');
  assert.throws(() => files.upload({ filename: 'x.bin', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' }),
    (e) => e.code === 'FILE_MIME_BLOCKED');
  await cleanup(dialect, dbPath);
}

async function testOversizeAndVirusScan() {
  const { dialect, dbPath } = await setup();
  const { org, ctxFor, evaluator, storage } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const small = createFileService(dialect, { storage, evaluator, maxBytes: 16 });
  assert.throws(() => small.upload({ filename: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(1000, 'a'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' }),
    (e) => e.code === 'FILE_TOO_LARGE');
  assert.throws(() => small.upload({ filename: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' }),
    (e) => e.code === 'FILE_EMPTY');

  const scanned = createFileService(dialect, {
    storage, evaluator,
    scanner: { scan: (buf) => ({ clean: !buf.toString().includes('EICAR'), detail: 'test-signature' }) },
  });
  assert.throws(() => scanned.upload({ filename: 'v.txt', mimeType: 'text/plain', buffer: Buffer.from('EICAR-TEST'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' }),
    (e) => e.code === 'FILE_INFECTED');
  const clean = scanned.upload({ filename: 'ok.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' });
  assert.strictEqual(clean.scanStatus, 'clean');
  await cleanup(dialect, dbPath);
}

async function testFileIdorAndCrossTenantDenial() {
  const { dialect, dbPath } = await setup();
  const { org, files, ctxFor } = bootstrap(dialect);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const file = files.upload({ filename: 'private.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 secret'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' });

  // knowing the id proves nothing: the outsider cannot read the attached record
  assert.throws(() => files.download(file.id, ctxFor(org.userOutsider), { readPermission: 'crm:crm_lead:read' }), (e) => e.code === 'FILE_NOT_FOUND');
  // a cross-tenant actor is refused with the identical opaque reason
  assert.throws(() => files.download(file.id, ctxFor(org.userBeta), { readPermission: 'crm:crm_lead:read' }), (e) => e.code === 'FILE_NOT_FOUND');
  // a guessed id is indistinguishable from a denied one
  assert.throws(() => files.download('file_invented', ctx), (e) => e.code === 'FILE_NOT_FOUND');
  // the authorized actor succeeds
  assert.strictEqual(files.download(file.id, ctx, { readPermission: 'crm:crm_lead:read' }).buffer.toString(), '%PDF-1.4 secret');

  const denials = files.accessLog(file.id).filter((l) => l.operation === 'denied');
  assert.ok(denials.length >= 2, 'every denial is logged');
  await cleanup(dialect, dbPath);
}

async function testShareLinkExpiryRevocationAndGuessing() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, files, ctxFor } = bootstrap(dialect, { now: () => clock });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const file = files.upload({ filename: 'q.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 q'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' });

  // sharing requires the share permission
  assert.throws(() => files.share(file.id, { ctx: ctxFor(org.userClerk), readPermission: 'crm:crm_lead:read' }), (e) => e instanceof AuthorizationError);

  const share = files.share(file.id, { expiresInMinutes: 30, maxDownloads: 2, reason: 'sent to customer', ctx, readPermission: 'crm:crm_lead:read' });
  assert.ok(files.redeemShare(share.token).buffer.length > 0);
  assert.ok(files.redeemShare(share.token).buffer.length > 0);
  assert.throws(() => files.redeemShare(share.token), (e) => e.code === 'SHARE_INVALID', 'the download cap is enforced');

  // a guessed token is refused with the same opaque error
  assert.throws(() => files.redeemShare('guessed-token'), (e) => e.code === 'SHARE_INVALID');

  const share2 = files.share(file.id, { expiresInMinutes: 30, ctx, readPermission: 'crm:crm_lead:read' });
  clock = new Date('2026-07-21T10:00:00.000Z');
  assert.throws(() => files.redeemShare(share2.token), (e) => e.code === 'SHARE_INVALID', 'an expired link is dead');

  const share3 = files.share(file.id, { expiresInMinutes: 30, ctx, readPermission: 'crm:crm_lead:read' });
  files.revokeShare(share3.shareId, ctx);
  assert.throws(() => files.redeemShare(share3.token), (e) => e.code === 'SHARE_INVALID');
  // the raw token is never persisted
  assert.ok(dialect.prepare('SELECT token_hash FROM file_shares').all().every((r) => r.token_hash !== share.token));
  await cleanup(dialect, dbPath);
}

async function testOrphanCleanup() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, files, storage, ctxFor } = bootstrap(dialect, { now: () => clock });
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  const ctx = ctxFor(org.userManager);
  const file = files.upload({ filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a'), entity: 'crm_lead', recordId: 'lead_1', ctx, writePermission: 'crm:crm_lead:update' });
  storage.put('stray/blob', Buffer.from('orphan'));

  files.delete(file.id, ctx, { readPermission: 'crm:crm_lead:read' });
  assert.throws(() => files.download(file.id, ctx, { readPermission: 'crm:crm_lead:read' }), (e) => e.code === 'FILE_NOT_FOUND');

  clock = new Date('2026-09-21T09:00:00.000Z');
  const cleaned = files.cleanupOrphans({ retainDeletedDays: 30 });
  assert.strictEqual(cleaned.purged, 1);
  assert.strictEqual(cleaned.strayBlobsRemoved, 1);
  assert.strictEqual(storage.has('stray/blob'), false);
  await cleanup(dialect, dbPath);
}

// --- 02.28 import / export / print / public forms ---------------------------

async function testImportDryRunThenExecute() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, imported, ctxFor } = bootstrap(dialect);
  const ctx = ctxFor(org.userManager);
  const rows = [{ name: 'Acme' }, { name: '' }, { name: 'Globex' }];

  const dry = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows, ctx, mode: 'dry_run', importPermission: 'crm:crm_lead:import' });
  assert.strictEqual(dry.okRows, 3, 'a dry run validates shape without executing');
  assert.strictEqual(imported.length, 0, 'nothing was created');

  const executed = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows, ctx, mode: 'execute', importPermission: 'crm:crm_lead:import' });
  assert.strictEqual(executed.okRows, 2);
  assert.strictEqual(executed.failedRows, 1, 'the bad row failed and was reported');
  assert.strictEqual(imported.length, 2);
  assert.ok(executed.rows.find((r) => r.row_number === 2).error.includes('name is required'));

  // abort strategy stops at the first failure
  const aborted = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows, ctx, mode: 'execute', rowErrorStrategy: 'abort', importPermission: 'crm:crm_lead:import' });
  assert.strictEqual(aborted.report.aborted, true);
  assert.strictEqual(aborted.report.processed, 2);
  await cleanup(dialect, dbPath);
}

async function testImportIsPermissionCheckedAndIdempotent() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, imported, ctxFor } = bootstrap(dialect);
  // the clerk holds no import permission
  assert.throws(() => exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows: [{ name: 'X' }], ctx: ctxFor(org.userClerk), mode: 'execute', importPermission: 'crm:crm_lead:import' }),
    (e) => e instanceof AuthorizationError, 'an import cannot bypass permissions');

  const ctx = ctxFor(org.userManager);
  const first = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows: [{ name: 'Acme' }], ctx, mode: 'execute', idempotencyKey: 'batch-1', importPermission: 'crm:crm_lead:import' });
  const repeat = exchange.import({ entity: 'crm_lead', actionId: 'crm:import_lead', rows: [{ name: 'Acme' }], ctx, mode: 'execute', idempotencyKey: 'batch-1', importPermission: 'crm:crm_lead:import' });
  assert.strictEqual(repeat.duplicate, true);
  assert.strictEqual(repeat.id, first.id);
  assert.strictEqual(imported.length, 1, 'a duplicate import creates nothing extra');
  await cleanup(dialect, dbPath);
}

async function testImportRespectsFieldMasks() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, roles, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_ops', [{ entity: 'crm_lead', field: 'internal_score', access: 'none' }]);
  const ctx = ctxFor(org.userManager);
  const result = exchange.import({
    entity: 'crm_lead', actionId: 'crm:import_lead',
    rows: [{ name: 'Acme', internal_score: 99 }], ctx, mode: 'execute', importPermission: 'crm:crm_lead:import',
  });
  assert.strictEqual(result.failedRows, 1, 'an import cannot write a protected field');
  assert.ok(result.rows[0].error.includes('permission denied') || result.rows[0].error.length > 0);
  await cleanup(dialect, dbPath);
}

async function testExportScopeMaskingAndFormulaInjection() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, roles, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_read', [
    { entity: 'crm_lead', field: 'national_id', access: 'masked' },
    { entity: 'crm_lead', field: 'internal_score', access: 'none' },
  ]);
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1, data: { name: 'Acme', national_id: '199012345678', internal_score: 91 } });
  seedRecord(dialect, { id: 'lead_2', companyId: org.companyA2, data: { name: 'Other Co' } });
  seedRecord(dialect, { id: 'lead_3', companyId: org.companyA1, data: { name: '=cmd|\' /C calc\'!A0' } });

  const clerkCtx = ctxFor(org.userClerk);
  const result = exchange.export({ entity: 'crm_lead', ctx: clerkCtx, exportPermission: 'crm:crm_lead:read' });
  assert.strictEqual(result.rowCount, 2, 'the export sees only the clerk\'s company');
  assert.ok(!result.content.includes('199012345678'), 'a masked field is masked in the export');
  assert.ok(!result.content.includes('91'), 'a hidden field never reaches the export');
  assert.ok(!result.columns.includes('internal_score'));
  // CSV injection is neutralized
  assert.ok(result.content.includes("'=cmd"), 'a leading = is escaped so a spreadsheet will not execute it');

  // a caller cannot widen the column list to reach a hidden field
  const widened = exchange.export({ entity: 'crm_lead', ctx: clerkCtx, exportPermission: 'crm:crm_lead:read', columns: ['name', 'internal_score', 'national_id'] });
  assert.ok(!widened.columns.includes('internal_score'));
  assert.ok(!widened.content.includes('91'));

  assert.strictEqual(neutralizeFormula('=1+1'), "'=1+1");
  assert.strictEqual(neutralizeFormula('safe'), 'safe');
  await cleanup(dialect, dbPath);
}

async function testPrintRtlMaskingAndEscaping() {
  const { dialect, dbPath } = await setup();
  const { org, exchange, roles, ctxFor } = bootstrap(dialect);
  roles.setFieldRules('r_read', [{ entity: 'crm_lead', field: 'national_id', access: 'masked' }]);
  // The record must exist: printing is record-scoped like every other read.
  seedRecord(dialect, { id: 'lead_1', companyId: org.companyA1 });
  exchange.registerPrintTemplate({
    moduleId: 'platform_kernel', entity: 'crm_lead', name: 'lead_card', locale: 'ar', direction: 'rtl',
    body: '<div>الاسم: {{name}} — الهوية: {{national_id}}</div>',
    requiredPermission: 'crm:crm_lead:print',
  });
  const mgr = exchange.render({ entity: 'crm_lead', name: 'lead_card', recordId: 'lead_1', data: { name: 'Acme', national_id: '199012345678' }, ctx: ctxFor(org.userManager) });
  assert.strictEqual(mgr.direction, 'rtl');
  assert.strictEqual(mgr.locale, 'ar');
  assert.ok(mgr.html.includes('الاسم: Acme'));
  assert.ok(mgr.html.includes('199012345678'));

  // the clerk lacks print permission entirely
  assert.throws(() => exchange.render({ entity: 'crm_lead', name: 'lead_card', recordId: 'lead_1', data: {}, ctx: ctxFor(org.userClerk) }),
    (e) => e instanceof AuthorizationError);

  // markup in a record value is escaped, never injected
  const escaped = exchange.render({ entity: 'crm_lead', name: 'lead_card', recordId: 'lead_1', data: { name: '<script>alert(1)</script>', national_id: '1' }, ctx: ctxFor(org.userManager) });
  assert.ok(!escaped.html.includes('<script>'));
  assert.ok(escaped.html.includes('&lt;script&gt;'));
  await cleanup(dialect, dbPath);
}

async function testPublicFormAbuseControls() {
  const { dialect, dbPath } = await setup();
  const { exchange, imported } = bootstrap(dialect);
  const sys = systemContext(dialect, { companyId: 'c_alpha_1', tenantId: 't_alpha' });
  const ok = exchange.submitPublicForm({ formKey: 'contact', actionId: 'crm:import_lead', payload: { name: 'Visitor' }, ip: '1.2.3.4', systemCtx: sys, rateLimitPerHour: 2 });
  assert.strictEqual(ok.accepted, true);
  assert.strictEqual(imported.length, 1);

  exchange.submitPublicForm({ formKey: 'contact', actionId: 'crm:import_lead', payload: { name: 'Visitor 2' }, ip: '1.2.3.4', systemCtx: sys, rateLimitPerHour: 2 });
  assert.throws(() => exchange.submitPublicForm({ formKey: 'contact', actionId: 'crm:import_lead', payload: { name: 'V3' }, ip: '1.2.3.4', systemCtx: sys, rateLimitPerHour: 2 }),
    (e) => e.code === 'PUBLIC_FORM_RATE_LIMITED');

  // an oversized payload is refused before any work
  assert.throws(() => exchange.submitPublicForm({ formKey: 'big', actionId: 'crm:import_lead', payload: { name: 'x'.repeat(70000) }, ip: '5.6.7.8', systemCtx: sys }),
    (e) => e.code === 'PUBLIC_FORM_TOO_LARGE');

  // a failing action tells the anonymous caller nothing about internals
  let leaked = null;
  try { exchange.submitPublicForm({ formKey: 'contact2', actionId: 'crm:import_lead', payload: {}, ip: '9.9.9.9', systemCtx: sys }); } catch (e) { leaked = e; }
  assert.strictEqual(leaked.code, 'PUBLIC_FORM_REJECTED');
  assert.ok(!leaked.message.includes('name is required'), 'internal validation detail is not disclosed publicly');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM public_form_submissions WHERE accepted = 0').get().n), 3);
  await cleanup(dialect, dbPath);
}

// --- 02.29 jobs and webhooks ------------------------------------------------

async function testJobLeaseCrashRetryAndDeadLetter() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, jobs } = bootstrap(dialect, { now: () => clock });
  let attempts = 0;
  jobs.registerHandler('flaky', () => { attempts += 1; if (attempts < 3) throw new Error('transient'); return { ok: true }; });
  jobs.registerHandler('always_bad', () => { throw new Error('permanent'); });

  const flaky = jobs.enqueue({ kind: 'flaky', tenantId: org.tenantA, companyId: org.companyA1 });
  // duplicate lease is impossible
  const first = jobs.claim();
  assert.ok(first);
  assert.strictEqual(jobs.claim(), null, 'a leased job cannot be claimed twice');
  assert.throws(() => jobs.execute(flaky.id, 'wrong-lease'), (e) => e.code === 'STALE_LEASE');

  let outcome = jobs.execute(first.jobId, first.leaseId);
  assert.strictEqual(outcome.status, 'failed');
  clock = new Date(clock.getTime() + 600000);
  const second = jobs.claim();
  jobs.execute(second.jobId, second.leaseId);
  clock = new Date(clock.getTime() + 600000);
  const third = jobs.claim();
  outcome = jobs.execute(third.jobId, third.leaseId);
  assert.strictEqual(outcome.status, 'succeeded');
  assert.strictEqual(jobs.get(flaky.id).progress, 100);

  // exhausting retries dead-letters
  jobs.enqueue({ kind: 'always_bad' });
  for (let i = 0; i < 4; i++) { clock = new Date(clock.getTime() + 600000); jobs.drain(); }
  assert.strictEqual(jobs.deadLetters().length, 1);

  // worker crash: a stale lease is reclaimed
  const stuck = jobs.enqueue({ kind: 'flaky' });
  const claimed = jobs.claim();
  dialect.prepare('UPDATE job_runs SET leased_until = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', claimed.jobId);
  assert.ok(jobs.recoverStaleLeases().includes(claimed.jobId));
  assert.strictEqual(jobs.get(stuck.id).status, 'queued');
  await cleanup(dialect, dbPath);
}

async function testJobIdempotencyScopeAndCronTick() {
  const { dialect, dbPath } = await setup();
  const { org, jobs } = bootstrap(dialect);
  jobs.registerHandler('sync', () => ({ done: true }));
  const a = jobs.enqueue({ kind: 'sync', idempotencyKey: 'nightly-2026-07-21', tenantId: org.tenantA, companyId: org.companyA1 });
  const b = jobs.enqueue({ kind: 'sync', idempotencyKey: 'nightly-2026-07-21', tenantId: org.tenantA, companyId: org.companyA1 });
  assert.strictEqual(a.id, b.id, 'a duplicate enqueue returns the original');
  assert.strictEqual(Number(dialect.prepare('SELECT COUNT(*) AS n FROM job_runs').get().n), 1);
  // the job carries its tenant/company so a handler can never act globally by accident
  assert.strictEqual(jobs.get(a.id).tenantId, org.tenantA);
  assert.strictEqual(jobs.get(a.id).companyId, org.companyA1);

  // a cron tick ENQUEUES work; it performs no business mutation itself
  dialect.prepare(`INSERT INTO platform_jobs (id, module_id, name, schedule, handler, enabled, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)`)
    .run('cron_nightly', 'platform_kernel', 'nightly', '0 0 * * *', 'sync', new Date().toISOString(), new Date().toISOString());
  const ticked = jobs.tick();
  assert.strictEqual(ticked.length, 1);
  assert.strictEqual(ticked[0].kind, 'sync');
  assert.strictEqual(jobs.tick().length, 1, 'a repeated tick in the same minute is idempotent');
  assert.strictEqual(Number(dialect.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE kind = 'sync'").get().n), 2);

  jobs.cancel(a.id);
  assert.strictEqual(jobs.get(a.id).status, 'cancelled');
  await cleanup(dialect, dbPath);
}

async function testWebhookSigningRetryAndReplay() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  const { org, vault } = bootstrap(dialect, { now: () => clock });
  vault.declare({ ref: 'secret://webhook.partner', moduleId: 'platform_kernel' });
  vault.set('secret://webhook.partner', 'partner-signing-secret');

  const calls = [];
  let failNext = 2;
  const webhooks = createWebhookService(dialect, {
    vault, now: () => clock,
    transport: (req) => { calls.push(req); if (failNext-- > 0) throw new Error('connection reset'); return { status: 200 }; },
  });
  webhooks.subscribe({ id: 'whs_1', moduleId: 'platform_kernel', eventType: 'lead.created', url: 'https://partner.example/hook', secretRef: 'secret://webhook.partner', tenantId: org.tenantA, companyId: org.companyA1 });

  webhooks.queue({ eventType: 'lead.created', eventId: 'evt-1', payload: { id: 'lead_1' }, tenantId: org.tenantA, companyId: org.companyA1 });
  // the same event is never queued twice
  webhooks.queue({ eventType: 'lead.created', eventId: 'evt-1', payload: { id: 'lead_1' }, tenantId: org.tenantA, companyId: org.companyA1 });
  assert.strictEqual(webhooks.deliveries('whs_1').length, 1);

  let summary = webhooks.dispatch();
  assert.strictEqual(summary.failed, 1);
  clock = new Date(clock.getTime() + 600000);
  webhooks.dispatch();
  clock = new Date(clock.getTime() + 600000);
  summary = webhooks.dispatch();
  assert.strictEqual(summary.sent, 1, 'the delivery succeeded after retries');

  // the signature is verifiable and covers timestamp + nonce + body
  const sent = calls[calls.length - 1];
  const expected = WebhookService.sign('partner-signing-secret', {
    timestamp: sent.headers['x-octagon-timestamp'], nonce: sent.headers['x-octagon-nonce'], body: sent.body,
  });
  assert.strictEqual(sent.headers['x-octagon-signature'], expected);
  assert.ok(!sent.body.includes('partner-signing-secret'), 'the secret never appears in the payload');

  // an https URL is required
  assert.throws(() => webhooks.subscribe({ moduleId: 'platform_kernel', eventType: 'x', url: 'http://evil.example/hook' }), (e) => e.code === 'WEBHOOK_URL_INSECURE');
  await cleanup(dialect, dbPath);
}

async function testInboundWebhookReplayProtection() {
  const { dialect, dbPath } = await setup();
  let clock = new Date('2026-07-21T09:00:00.000Z');
  bootstrap(dialect, { now: () => clock });
  const webhooks = createWebhookService(dialect, { now: () => clock });
  const secret = 'inbound-secret';
  const body = JSON.stringify({ event: 'payment.settled' });
  const timestamp = clock.toISOString();
  const nonce = 'nonce-1';
  const signature = WebhookService.sign(secret, { timestamp, nonce, body });

  assert.strictEqual(webhooks.verifyInbound({ source: 'partner', secret, signature, timestamp, nonce, body }).ok, true);
  // exact replay is rejected even though the signature is still valid
  assert.strictEqual(webhooks.verifyInbound({ source: 'partner', secret, signature, timestamp, nonce, body }).reasonCode, 'WEBHOOK_REPLAYED');
  // a forged signature is rejected
  assert.strictEqual(webhooks.verifyInbound({ source: 'partner', secret, signature: 'f'.repeat(64), timestamp, nonce: 'n2', body }).reasonCode, 'WEBHOOK_BAD_SIGNATURE');
  // a stale timestamp is rejected
  clock = new Date('2026-07-21T10:00:00.000Z');
  const staleSig = WebhookService.sign(secret, { timestamp, nonce: 'n3', body });
  assert.strictEqual(webhooks.verifyInbound({ source: 'partner', secret, signature: staleSig, timestamp, nonce: 'n3', body }).reasonCode, 'WEBHOOK_STALE_TIMESTAMP');
  await cleanup(dialect, dbPath);
}

async function testExternalCallOnlyAfterCommit() {
  const { dialect, dbPath } = await setup();
  const { org, vault } = bootstrap(dialect);
  const calls = [];
  const webhooks = createWebhookService(dialect, { vault, transport: (r) => { calls.push(r); return { status: 200 }; } });
  webhooks.subscribe({ id: 'whs_1', moduleId: 'platform_kernel', eventType: 'action.execute', url: 'https://partner.example/hook' });
  const dispatcher = createOutboxDispatcher(dialect);
  webhooks.consumeOutbox(dispatcher, ['action.execute']);

  // A rolled-back transaction leaves no outbox row, so no webhook is queued.
  dialect.exec('BEGIN IMMEDIATE;');
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, actor_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, 'action.execute', '1.0.0', 'platform_kernel', 'crm_lead:lead_1', ?, '{}', ?, ?, 0, 3, 'pending')
  `).run(crypto.randomUUID(), org.userManager, new Date().toISOString(), new Date().toISOString());
  dialect.exec('ROLLBACK;');
  dispatcher.dispatch();
  webhooks.dispatch();
  assert.strictEqual(calls.length, 0, 'no external call was made for a rolled-back transaction');

  // A committed one is queued and then delivered.
  dialect.prepare(`
    INSERT INTO platform_outbox (id, event_type, schema_version, module_id, aggregate_id, actor_id, payload, created_at, scheduled_at, attempts, max_attempts, status)
    VALUES (?, 'action.execute', '1.0.0', 'platform_kernel', 'crm_lead:lead_2', ?, '{}', ?, ?, 0, 3, 'pending')
  `).run(crypto.randomUUID(), org.userManager, new Date().toISOString(), new Date().toISOString());
  dispatcher.dispatch();
  webhooks.dispatch();
  assert.strictEqual(calls.length, 1, 'the external call happens only after commit');
  await cleanup(dialect, dbPath);
}

// --- runner -----------------------------------------------------------------

await run('Phase 02 / history, collaboration, notifications, files, exchange, jobs, webhooks', [
  ['02.24 history tracks only real changes', testHistoryTracksOnlyRealChanges],
  ['02.24 history is masked like the record', testHistoryIsMaskedLikeTheRecord],
  ['02.24 snapshot immutability and amendment lineage', testSnapshotImmutabilityAndLineage],
  ['02.24 retention never purges snapshots', testRetentionNeverPurgesSnapshots],
  ['02.25 chatter inherits record permission', testChatterInheritsRecordPermission],
  ['02.25 mention scope and follower authorization', testMentionScopeAndFollowerAuthorization],
  ['02.25 attachment cannot be smuggled across records', testAttachmentCannotBeSmuggledAcrossRecords],
  ['02.25 activities, assignment, deadlines', testActivitiesAndDeadlines],
  ['02.26 dedupe and inbox scope', testNotificationDedupeAndInbox],
  ['02.26 preferences cannot silence security notices', testPreferencesCannotSilenceSecurityNotices],
  ['02.26 provider timeout, retry, dead-letter, health', testProviderTimeoutRetryAndDeadLetter],
  ['02.26 notification payload is masked', testNotificationPayloadIsMasked],
  ['02.26 outbox rollback sends nothing', testOutboxRollbackMeansNoNotification],
  ['02.27 path traversal and MIME spoofing', testPathTraversalAndMimeSpoofing],
  ['02.27 oversize and virus scan', testOversizeAndVirusScan],
  ['02.27 file IDOR and cross-tenant denial', testFileIdorAndCrossTenantDenial],
  ['02.27 share expiry, revocation, guessing, download cap', testShareLinkExpiryRevocationAndGuessing],
  ['02.27 orphan cleanup', testOrphanCleanup],
  ['02.28 import dry run then execute', testImportDryRunThenExecute],
  ['02.28 import is permission-checked and idempotent', testImportIsPermissionCheckedAndIdempotent],
  ['02.28 import respects field masks', testImportRespectsFieldMasks],
  ['02.28 export scope, masking, formula injection', testExportScopeMaskingAndFormulaInjection],
  ['02.28 print RTL, masking, escaping', testPrintRtlMaskingAndEscaping],
  ['02.28 public form abuse controls', testPublicFormAbuseControls],
  ['02.29 job lease, crash, retry, dead-letter', testJobLeaseCrashRetryAndDeadLetter],
  ['02.29 job idempotency, scope, cron tick', testJobIdempotencyScopeAndCronTick],
  ['02.29 webhook signing, retry, duplicate suppression', testWebhookSigningRetryAndReplay],
  ['02.29 inbound webhook replay protection', testInboundWebhookReplayProtection],
  ['02.29 external call only after commit', testExternalCallOnlyAfterCommit],
]);
