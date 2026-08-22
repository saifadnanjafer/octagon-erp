import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

function navigationRegistry() {
  const start = appSource.indexOf('const navDomains = [');
  const end = appSource.indexOf('\nfunction getNavGroupForPage');
  assert.ok(start >= 0 && end > start, 'navigation registry is present in app.js');
  const context = {};
  vm.runInNewContext(`${appSource.slice(start, end)}\nglobalThis.registry = { navDomains, navGroupMeta, navGroupPages };`, context);
  return context.registry;
}

function staticNavButtons() {
  return [...indexSource.matchAll(/<button\b(?=[^>]*\bclass=["'][^"']*\bnav-btn\b[^"']*["'])(?=[^>]*\bdata-page=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/button>/g)]
    .map(([, page, body]) => ({
      page,
      label: body.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    }));
}

test('navigation divides every registered page into short, named groups', () => {
  const { navDomains, navGroupMeta, navGroupPages } = navigationRegistry();
  const domains = Array.from(navDomains, domain => domain.key);
  const configuredGroups = Array.from(navDomains).flatMap(domain => Array.from(domain.groups));
  const configuredPages = Array.from(Object.values(navGroupPages)).flatMap(pages => Array.from(pages));

  assert.deepEqual(domains, ['core', 'ops', 'finance', 'commercial', 'resources', 'intelligence', 'admin']);
  assert.equal(new Set(configuredGroups).size, configuredGroups.length, 'a group belongs to one top-level domain');
  assert.equal(new Set(configuredPages).size, configuredPages.length, 'a page belongs to one sidebar group');

  configuredGroups.forEach(group => {
    assert.ok(navGroupMeta[group]?.label, `${group} has a visible Arabic group label`);
    assert.ok(navGroupMeta[group]?.icon, `${group} has a group icon`);
    assert.ok((navGroupPages[group] || []).length <= 14, `${group} keeps its menu short enough to scan`);
  });
});

test('every primary sidebar entry is mapped, labelled, and given an icon at assembly time', () => {
  const { navGroupPages } = navigationRegistry();
  const configuredPages = new Set(Array.from(Object.values(navGroupPages)).flatMap(pages => Array.from(pages)));
  const nonPrimaryControls = new Set(['calculator', 'kanban', 'locations', 'workshop_tv', 'pos_deepening']);
  const buttons = staticNavButtons();

  assert.ok(buttons.length > 150, 'the full static page catalogue was inspected');
  buttons.forEach(({ page, label }) => {
    assert.ok(configuredPages.has(page) || nonPrimaryControls.has(page), `${page} is assigned to a deliberate group or classified outside primary navigation`);
    assert.ok(label.length > 0, `${page} has a written label in its source entry`);
  });
  assert.match(appSource, /function normaliseNavigationButton\(button\)/, 'late and legacy entries are normalised');
  assert.match(appSource, /iconElement\.className = `fa-solid \$\{groupIcon\}`/, 'normalisation supplies a meaningful group icon');
});

test('sidebar clicks preserve the full module navigation chain', () => {
  assert.match(
    appSource,
    /\(window\.switchPage \|\| switchPage\)\(page\);/,
    'sidebar clicks use the wrapped page switcher so module-owned workspaces hydrate first'
  );
});
