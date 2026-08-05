import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('drilldown panel is an accessible modal with a canonical target action', () => {
  const view = read('views/workshop_command_center.html');
  assert.match(view, /id="workshopDrilldown"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(view, /aria-labelledby="workshopDrilldownTitle"/);
  assert.match(view, /id="workshopDrilldownClose"[^>]+aria-label="Close details"/);
  assert.match(view, /id="workshopDrilldownOpenTarget"/);
});

test('Command Center cards open registered metrics in the drilldown module', () => {
  const command = read('modules/workshop-command-center.js');
  const drilldown = read('modules/workshop-drilldown.js');
  assert.match(command, /data-metric=/);
  assert.match(command, /WorkshopDrilldown\.open/);
  assert.match(drilldown, /\/api\/v1\/workshop\/drilldown\?metric_id=/);
  assert.match(drilldown, /encodeURIComponent\(state\.metricId\)/);
  assert.match(drilldown, /WorkshopShell\.navigate\(target\)/);
});

test('drilldown interaction supports Escape, focus trapping, backdrop close, retry, and loading state', () => {
  const source = read('modules/workshop-drilldown.js');
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /function trapFocus/);
  assert.match(source, /backdrop\.addEventListener\('click', close\)/);
  assert.match(source, /workshopDrilldownRetry/);
  assert.match(source, /workshop-loading/);
  assert.match(source, /returnFocus/);
});

test('drilldown frontend does not access local storage, database mirrors, or raw fetch', () => {
  const source = read('modules/workshop-drilldown.js');
  assert.doesNotMatch(source, /localStorage\.(getItem|setItem)/);
  assert.doesNotMatch(source, /database\.json|PentagonDB/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /OctagonApiClient\.get/);
});

test('workshop API exposes drilldown only through the read-only workshop router', () => {
  const api = read('platform/api/workshop.mjs');
  const router = read('platform/api/index.mjs');
  assert.match(api, /drilldown:\s*'platform:db:read'/);
  assert.match(api, /resource === 'drilldown'/);
  assert.match(api, /buildWorkshopDrilldown/);
  assert.match(router, /namespace === 'workshop'.*req\.method === 'GET'/s);
  assert.doesNotMatch(api, /\b(INSERT|UPDATE|DELETE)\b/);
});
