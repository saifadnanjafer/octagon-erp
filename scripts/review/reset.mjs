#!/usr/bin/env node
// Review Freeze 1 — reset the disposable review database.
//
// Removes ONLY .review-data/ (never touches database.db / database.json /
// any operational path — it doesn't even reference them) and re-runs setup
// deterministically.
//
// Usage: node scripts/review/reset.mjs   (or: npm run review:reset)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const reviewDataDir = path.join(repoRoot, '.review-data');

console.log(`[review:reset] removing ${reviewDataDir}…`);
fs.rmSync(reviewDataDir, { recursive: true, force: true });

console.log('[review:reset] re-running review:setup…');
const result = spawnSync(process.execPath, [path.join(here, 'setup.mjs')], { stdio: 'inherit' });
process.exit(result.status ?? 1);
