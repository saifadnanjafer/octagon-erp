import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');

// Loads the browser IIFE modules against a minimal DOM-free `window` stand-in, so this test
// exercises the actual registries (not a re-typed copy of them) without needing a browser.
function loadIntoWindow(...files) {
  const window = { document: { documentElement: { lang: 'ar', dir: 'rtl' } }, localStorage: null };
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'modules', file), 'utf8');
    vm.runInNewContext(source, { window }, { filename: file });
  }
  return window;
}

test('every action referenced by a BUILD-09 page has a real form and a real permission mapping', () => {
  const workspacesSource = fs.readFileSync(path.join(root, 'modules/build09-workspaces.js'), 'utf8');
  const window = loadIntoWindow('build09-action-forms.js');

  // PAGES and ACTION_PERMISSIONS are private to the workspaces IIFE, so extract the action ids
  // it dispatches to canWrite()/actionDialog() the same way the audit that found the original
  // bug did: from the literal action-id strings embedded in the PAGES config source.
  const pagesBlock = workspacesSource.slice(workspacesSource.indexOf('const PAGES = {'), workspacesSource.indexOf('// Mirrors platform_actions'));
  assert.ok(pagesBlock.length > 500, 'could not isolate the PAGES config block - the source layout changed, update this test\'s slice markers');
  const actionIds = new Set();
  const actionIdPattern = /'((?:wms|shopfloor|quality):[a-z_]+)'/g;
  let match;
  while ((match = actionIdPattern.exec(pagesBlock))) actionIds.add(match[1]);
  assert.ok(actionIds.size >= 60, `expected at least 60 distinct action ids referenced by pages, found ${actionIds.size}`);

  const missingForms = [];
  const emptyForms = [];
  for (const actionId of actionIds) {
    const definition = window.OctagonActionForms.get(actionId);
    if (!definition) { missingForms.push(actionId); continue; }
    if (!Array.isArray(definition.fields) || definition.fields.length === 0) emptyForms.push(actionId);
    for (const field of definition.fields) {
      assert.ok(field.name, `${actionId} has a field with no name`);
      assert.ok(field.type, `${actionId}.${field.name} has no type`);
      assert.ok(field.label && field.label.en && field.label.ar, `${actionId}.${field.name} is missing a bilingual label`);
      if (field.type === 'select') assert.ok(Array.isArray(field.options) && field.options.length, `${actionId}.${field.name} is a select with no options`);
      if (field.type === 'lookup') assert.ok(field.resource, `${actionId}.${field.name} is a lookup with no resource`);
    }
  }
  assert.deepEqual(missingForms, [], `these page-referenced actions have no entry in OctagonActionForms.registry at all (the exact bug class this test guards against): ${missingForms.join(', ')}`);
  assert.deepEqual(emptyForms, [], `these actions have a registry entry but zero fields: ${emptyForms.join(', ')}`);

  const permissionMapPattern = /'((?:wms|shopfloor|quality):[a-z_]+)':\s*'[a-z_:]+'/g;
  const mappedActionIds = new Set();
  while ((match = permissionMapPattern.exec(workspacesSource))) mappedActionIds.add(match[1]);
  const unmappedPermissions = [...actionIds].filter((id) => !mappedActionIds.has(id));
  assert.deepEqual(unmappedPermissions, [], `these page-referenced actions have no entry in ACTION_PERMISSIONS, so canWrite() can never disable them for an unauthorized user: ${unmappedPermissions.join(', ')}`);
});

test('every governed lookup resource referenced by a form field is declared in OctagonGovernedLookups', () => {
  // octagon-governed-lookups.js only reads window.OctagonApiClient/OctagonRuntimeContext
  // inside search(), which this test never calls, so it is safe to load standalone here.
  const lookupsWindow = loadIntoWindow('octagon-governed-lookups.js');
  const formsWindow = loadIntoWindow('build09-action-forms.js');
  const declaredResources = new Set(Object.keys(lookupsWindow.OctagonGovernedLookups.resources));
  const usedResources = new Set();
  for (const definition of Object.values(formsWindow.OctagonActionForms.registry)) {
    for (const field of definition.fields) if (field.type === 'lookup') usedResources.add(field.resource);
  }
  const undeclaredResources = [...usedResources].filter((resource) => !declaredResources.has(resource));
  assert.deepEqual(undeclaredResources, [], `form fields reference lookup resources OctagonGovernedLookups does not know how to route: ${undeclaredResources.join(', ')}`);
});
