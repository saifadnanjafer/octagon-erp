import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Workshop Command Center has a unique sidebar route, view, page map, and permission mapping', () => {
  const html = read('index.html');
  const app = read('app.js');
  const permissions = read('services/permissionService.js');
  const view = read('views/workshop_command_center.html');
  assert.equal((html.match(/data-page="workshop_command_center"/g) || []).length, 1);
  assert.match(html, /view:workshop_command_center/);
  assert.match(app, /workshop_command_center:\s*'pageWorkshopCommandCenter'/);
  assert.match(app, /renderWorkshopCommandCenter/);
  assert.match(permissions, /workshop_command_center:\s*\['workshop\.user'/);
  assert.match(view, /id="pageWorkshopCommandCenter"/);
  assert.match(view, /id="workshopCommandBody"/);
});

test('Workshop browser module uses the governed API client and canonical deep-link navigation', () => {
  const module = read('modules/workshop-command-center.js');
  assert.match(module, /OctagonApiClient\.get\('\/api\/v1\/workshop\/command-center'\)/);
  assert.match(module, /WorkshopShell\.navigate/);
  assert.doesNotMatch(module, /localStorage\.(getItem|setItem)/);
  assert.doesNotMatch(module, /PentagonDB|database\.json/);
});

test('Command API is read-only, permission-gated, and preserves per-card permission filtering', () => {
  const router = read('platform/api/index.mjs');
  const handler = read('platform/api/workshop.mjs');
  const catalog = read('platform/workshop/command-center-catalog.mjs');
  assert.match(router, /namespace === 'workshop'.*req\.method === 'GET'/s);
  assert.match(router, /WORKSHOP_RESOURCE_PERMISSIONS/);
  assert.match(handler, /buildWorkshopCommandCenter/);
  assert.match(catalog, /permission_denied|platform:db:read|wms:receiving:view|quality:checkpoint:view/);
  assert.doesNotMatch(handler, /INSERT|UPDATE|DELETE/);
});

test('internal workshop sidebar baseline contains Command Center and My Work exactly once', () => {
  const html = read('index.html');
  for (const page of ['workshop_command_center', 'my_work']) {
    assert.equal((html.match(new RegExp(`data-page="${page}"`, 'g')) || []).length, 1);
    assert.equal((html.match(new RegExp(`view:${page}`, 'g')) || []).length, 1);
  }
});
