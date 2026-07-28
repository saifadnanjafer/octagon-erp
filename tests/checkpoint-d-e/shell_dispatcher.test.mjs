// Checkpoint D — original-shell page dispatcher contracts.
//
// Section 18 of the assignment asked for the duplicate-`switchPage` defect to
// be resolved. Investigation showed there is no duplicate `switchPage` (see
// docs/evidence/checkpoint-d-e/dispatcher-audit.md); the real defect was a
// view-template load race. These are static contracts over the real source so
// that a genuine navigation duplicate, or a canonical module that mounts
// without gating on template hydration, fails loudly.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appSource = fs.readFileSync(path.join(repo, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

const CANONICAL_MODULES = [
  { file: 'canonical-projects.js', page: 'projects', flag: '__canonicalProjectsWrapped', host: 'pageProjects' },
  { file: 'canonical-engineering.js', page: 'mrp', flag: '__canonicalEngineeringWrapped', host: 'pageMrp' },
];

test('app.js declares exactly one switchPage — there is one dispatch authority', () => {
  const definitions = appSource.match(/^function switchPage\s*\(/gm) || [];
  assert.equal(
    definitions.length, 1,
    `expected exactly one "function switchPage" in app.js, found ${definitions.length}`,
  );
});

test('no navigation-related function is defined twice at top level in app.js', () => {
  const names = appSource.match(/^function [A-Za-z0-9_]+/gm) || [];
  const seen = new Map();
  for (const raw of names) {
    const name = raw.replace('function ', '');
    seen.set(name, (seen.get(name) || 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);

  // renderAttendanceCalendar is a known pre-existing duplicate in the frozen
  // attendance area. It is unrelated to navigation and deliberately untouched.
  // Anything else appearing here is a new last-definition-wins hazard.
  assert.deepStrictEqual(
    duplicates.sort(), ['renderAttendanceCalendar'],
    `unexpected duplicate top-level function definitions in app.js: ${duplicates.join(', ')}`,
  );

  for (const name of duplicates) {
    assert.ok(
      !/switch|page|nav/i.test(name),
      `${name} is duplicated AND navigation-related — that is a dispatch hazard`,
    );
  }
});

test('index.html installs a single idempotent template guard', () => {
  assert.ok(
    htmlSource.includes('__octagonTemplateGuard'),
    'the template guard must mark itself so it cannot be installed twice',
  );
  const installs = htmlSource.match(/guardedSwitchPage\.__octagonTemplateGuard\s*=\s*true/g) || [];
  assert.equal(installs.length, 1, 'exactly one template guard may be installed');
  assert.ok(
    htmlSource.includes('await window.ensurePageTemplateLoaded(page)'),
    'the guard must hydrate the view before delegating to the dispatcher',
  );
});

for (const mod of CANONICAL_MODULES) {
  test(`${mod.file} mounts through the effective dispatcher without adding a new one`, () => {
    const source = fs.readFileSync(path.join(repo, 'modules', mod.file), 'utf8');

    // It wraps the existing dispatcher...
    assert.ok(
      /const orig = root\.switchPage;/.test(source),
      `${mod.file} must capture the existing switchPage`,
    );
    // ...and always delegates to it, so permission checks, lazy view loading
    // and every other module's initialisation still run.
    assert.ok(
      /orig\.apply\(this, arguments\)/.test(source),
      `${mod.file} must delegate to the original dispatcher`,
    );
    // ...and gates its own activation on template hydration, which is the
    // actual fix for the D1 race.
    assert.ok(
      source.includes(`ensurePageTemplateLoaded('${mod.page}')`),
      `${mod.file} must gate activation on ensurePageTemplateLoaded('${mod.page}')`,
    );
    // ...and cannot install a second wrapper on re-evaluation.
    assert.ok(
      source.includes(`root.${mod.flag}`),
      `${mod.file} must guard its wrapper with ${mod.flag}`,
    );
    // ...and targets a real page host that exists in the shell.
    assert.ok(
      source.includes(`getElementById('${mod.host}')`),
      `${mod.file} must mount on #${mod.host}`,
    );
    assert.ok(
      htmlSource.includes(`id="${mod.host}"`) || appSource.includes(`'${mod.host}'`),
      `#${mod.host} must exist in the original shell`,
    );
  });

  test(`${mod.file} is loaded by the original shell`, () => {
    assert.ok(
      new RegExp(`<script src="modules/${mod.file.replace('.', '\\.')}\\?v=`).test(htmlSource),
      `${mod.file} must be script-tagged in index.html with a cache version`,
    );
  });
}

test('canonical modules do not replace window.switchPage outright', () => {
  for (const mod of CANONICAL_MODULES) {
    const source = fs.readFileSync(path.join(repo, 'modules', mod.file), 'utf8');
    // Assigning a function that never calls `orig` would silently orphan the
    // rest of the shell's navigation.
    const assignments = source.match(/root\.switchPage\s*=\s*function/g) || [];
    assert.equal(assignments.length, 1, `${mod.file} may install at most one wrapper`);
  }
});
