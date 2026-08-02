import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('BUILD-09R has one canonical runtime context and preference-only storage', () => {
  const source = read('modules/octagon-runtime-context.js');
  assert.match(source, /\/api\/v1\/runtime\/context/);
  assert.match(source, /availableWarehouses/);
  assert.match(source, /state\.availableWarehouses\.some/);
  assert.match(source, /localStorage\.removeItem/);
  assert.match(source, /setWarehouse/);
  assert.doesNotMatch(read('modules/build09-workspaces.js'), /__octagonBootstrap\?\./);
});

test('BUILD-09R API client handles envelopes, aborts, and duplicate submissions', () => {
  const source = read('modules/octagon-api-client.js');
  assert.match(source, /AbortController/);
  assert.match(source, /DUPLICATE_SUBMISSION/);
  assert.match(source, /correlationId/);
  assert.match(source, /body\?\.success === false/);
  assert.match(source, /credentials: 'same-origin'/);
});

test('BUILD-09R forms expose governed fields instead of a raw JSON console', () => {
  const source = read('modules/build09-action-forms.js');
  const workspace = read('modules/build09-workspaces.js');
  assert.match(source, /type: 'number'/);
  assert.match(source, /registry/);
  assert.match(workspace, /OctagonActionForms\.collect/);
  assert.doesNotMatch(workspace, /JSON\.parse\(dialog\.querySelector\('textarea'/);
});

test('BUILD-09R context endpoint is session-derived and server-scoped', () => {
  const source = read('platform/api/index.mjs');
  assert.match(source, /namespace === 'runtime' && resource === 'context'/);
  assert.match(source, /organization_memberships/);
  assert.match(source, /WHERE company_id = \? AND is_active = 1/);
  assert.match(source, /availableWarehouses/);
  assert.doesNotMatch(source, /query\.company_id/);
});

test('BUILD-09R exposes bounded governed lookups and resource permissions', () => {
  const lookups = read('modules/octagon-governed-lookups.js');
  const api = read('platform/api/build09.mjs');
  assert.match(lookups, /Math\.min\(100/);
  assert.match(lookups, /OctagonApiClient\.get/);
  assert.match(api, /BUILD09_RESOURCE_PERMISSIONS/);
  assert.match(api, /wms:receiving:view/);
  assert.match(api, /quality:disposition:view/);
});
