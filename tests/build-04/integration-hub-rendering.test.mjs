import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Integration Hub render hooks are scoped to their activated surface', () => {
  const marketplace = read('modules/platform-marketplace.js');
  const ecommerce = read('modules/ecommerce-connectors.js');

  assert.match(marketplace, /if \(page === 'integration_hub'\) scheduleRender\('hub'\);/);
  assert.match(marketplace, /function isHubActive\(\)/);
  assert.match(marketplace, /scheduleRender\('admin'\);/);
  assert.doesNotMatch(marketplace, /function renderAll\(/);
  assert.match(ecommerce, /if \(page === 'integration_hub'\) scheduleRender\(\);/);
  assert.match(ecommerce, /function init\(\) \{ ensureRoot\(\); installHooks\(\); \}/);
});

test('Integration Hub retains staged-only connector boundaries', () => {
  const ecommerce = read('modules/ecommerce-connectors.js');
  const marketplace = read('modules/platform-marketplace.js');

  assert.match(ecommerce, /No real\s+\* external API call/);
  assert.match(marketplace, /Marketplace remains staged/);
  assert.doesNotMatch(ecommerce, /fetch\s*\(/);
});
