// Checkpoint C5 — visible canonical Administration contract.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(repoRoot, 'modules', 'canonical-administration.js'), 'utf8');
const css = fs.readFileSync(path.join(repoRoot, 'modules', 'canonical-administration.css'), 'utf8');
const index = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(repoRoot, 'services', 'canonicalClient.js'), 'utf8');
const api = fs.readFileSync(path.join(repoRoot, 'platform', 'api', 'index.mjs'), 'utf8');

test('canonical Administration owns the original Admin Panel after legacy renderers', () => {
  assert.match(index, /canonical-administration\.css/);
  assert.match(index, /canonical-administration\.js/);
  assert.ok(index.lastIndexOf('canonical-administration.js') > index.lastIndexOf('app.js'));
  assert.match(source, /__canonicalAdministrationAuthorityActive = true/);
  assert.match(source, /__canonicalAdministrationFinalAuthority/);
});

test('all nineteen required Administration areas are visible bilingual tabs', () => {
  const required = [
    ['companies', 'Companies'], ['branches', 'Branches'], ['users', 'Users'],
    ['roles', 'Roles'], ['permissions', 'Permissions'], ['data-scopes', 'Data Scopes'],
    ['modules', 'Modules'], ['feature-flags', 'Feature Flags'], ['packages', 'Packages'],
    ['licensing', 'Licensing'], ['settings', 'Settings'],
    ['numbering-sequences', 'Numbering Sequences'], ['integrations', 'Integrations'],
    ['api-keys', 'API Keys'], ['jobs', 'Jobs'], ['audit', 'Audit'],
    ['health', 'Health'], ['backups', 'Backups'], ['localization', 'Localization'],
  ];
  for (const [key, label] of required) {
    assert.match(source, new RegExp(`\\['${key}'`), `${key} missing`);
    assert.match(source, new RegExp(label), `${label} missing`);
  }
});

test('module, feature, assignment, licensing, job and access-test commands use exact ActionExecutor actions', () => {
  for (const action of [
    'control:module:set_status', 'control:feature:set', 'control:module:assign',
    'control:license:set', 'control:job:set', 'control:test:ping',
  ]) assert.match(client, new RegExp(action.replaceAll(':', '\\:')));
  assert.match(source, /setModuleStatus/);
  assert.match(source, /assignModule/);
  assert.match(source, /setLicense/);
  assert.match(source, /testPing/);
});

test('server API requires control admin permission and dynamic module access remains server-side', () => {
  assert.match(api, /namespace === 'control-plane'/);
  assert.match(api, /requirePermission\('control:admin'\)/);
  assert.match(api, /MODULE_NOT_ENABLED\|MODULE_UNLICENSED/);
  assert.match(source, /data-module-access/);
  assert.match(source, /data-module-nav/);
});

test('API key rendering cannot expose hashes or secrets', () => {
  assert.doesNotMatch(source, /key_hash|client_secret|secret_value/);
  assert.doesNotMatch(source, /localStorage\.(setItem|removeItem)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/x\//);
});

test('stylesheet is page-scoped, responsive and RTL/LTR aware', () => {
  const selectorLines = css.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('@'));
  assert.ok(selectorLines.every((line) => line.trim().startsWith('#pageAdminPanel')));
  assert.match(css, /@media \(max-width:1100px\)/);
  assert.match(css, /@media \(max-width:768px\)/);
  assert.match(css, /@media \(max-width:420px\)/);
  assert.match(css, /\[dir="ltr"\]/);
});

test('module registers without needing legacy admin state', () => {
  const listeners = new Map();
  const window = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    setTimeout,
    currentPage: '',
    switchPage() {},
  };
  const document = {
    documentElement: { lang: 'ar' },
    addEventListener(type, handler) { listeners.set(type, handler); },
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  vm.runInNewContext(source, { window, document, setTimeout, console });
  assert.equal(window.__canonicalAdministrationAuthorityActive, true);
  assert.equal(window.CanonicalAdministration.areas.length, 19);
});
