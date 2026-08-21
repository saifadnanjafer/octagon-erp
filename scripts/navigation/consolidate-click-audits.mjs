#!/usr/bin/env node
// Combine bounded authenticated click-audit slices into the canonical full-run
// artifact. This preserves every per-page terminal observation while avoiding
// a single long-running browser process masking its last completed slice.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const evidence = path.join(root, 'docs', 'autopilot', 'evidence');
const offsets = [0, 25, 50, 75, 100, 125, 150, 175, 200];
const inputPath = (offset) => path.join(evidence, `NAVIGATION-RECOVERY-1-click-audit-${offset || 'all'}.json`);
const slices = offsets.map((offset) => JSON.parse(fs.readFileSync(inputPath(offset), 'utf8')));
const items = slices.flatMap((slice) => slice.items || []);
const seen = new Set();
for (const item of items) {
  if (seen.has(item.id)) throw new Error(`duplicate navigation audit item: ${item.id}`);
  seen.add(item.id);
}
if (items.length !== 221) throw new Error(`expected 221 current primary destinations, received ${items.length}`);
const failures = items.filter((item) => item.status !== 'PASS');
const output = {
  generatedAt: new Date().toISOString(),
  startedAt: slices[0].startedAt,
  completedAt: slices.at(-1).generatedAt,
  baseUrl: slices[0].baseUrl,
  method: 'authenticated Chromium visible clicks only; no direct switchPage calls; bounded 25-page slices consolidated without dropping per-page evidence',
  slices: offsets.map((offset, index) => ({ offset, totals: slices[index].totals, generatedAt: slices[index].generatedAt })),
  totals: { total: items.length, pass: items.length - failures.length, fail: failures.length },
  items,
};
fs.writeFileSync(inputPath(0), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Consolidated click audit: ${output.totals.pass}/${output.totals.total} passed; ${output.totals.fail} failed.`);
process.exitCode = failures.length ? 1 : 0;
