import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('modules/build11-workspaces.js', 'utf8');
const styles = fs.readFileSync('modules/build11-workspaces.css', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const permissions = fs.readFileSync('services/permissionService.js', 'utf8');
const pages = ['saas_overview', 'tenant_directory', 'tenant_detail', 'commercial_plans', 'subscriptions', 'entitlements', 'seats_and_limits', 'usage_and_quotas', 'billing_simulator', 'extension_marketplace', 'extension_installations'];

test('BUILD-11 commercial workspaces are registered inside the existing shell', () => {
  for (const page of pages) {
    assert.match(source, new RegExp(`${page}:`));
    assert.match(index, new RegExp(`data-page=["']${page}["']`), `${page} must be reachable from navigation`);
    assert.match(permissions, new RegExp(`\\b${page}:`), `${page} needs a local permission policy`);
  }
  assert.match(index, /modules\/build11-workspaces\.js/);
  assert.match(index, /modules\/build11-workspaces\.css/);
});

test('BUILD-11 workspaces use real scoped APIs, governed actions, and honest UI states', () => {
  assert.match(source, /\/api\/v1\/saas\//);
  assert.match(source, /\/api\/v1\/action\//);
  assert.match(source, /data-state="empty"/);
  assert.match(source, /data-state=\"\$\{error\.status === 403 \? 'denied' : 'error'\}\"/);
  assert.match(source, /data-role="status"/);
  assert.match(source, /tenant-create/);
  assert.match(source, /tenant-provision/);
  assert.match(source, /usage-record/);
  assert.match(source, /package-validate/);
  assert.match(source, /credentials: 'same-origin'/);
});

test('BUILD-11 supports Arabic/LTR/RTL, keyboard focus, and responsive tables', () => {
  assert.match(source, /document\.documentElement\.dir === 'rtl'/);
  assert.match(source, /octagon:language-changed/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /overflow:auto/);
  assert.match(styles, /text-align:start/);
});
