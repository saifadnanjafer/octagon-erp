#!/usr/bin/env node
// Review Freeze 2 — print the fixed, disposable local review credentials.
//
// This command is read-only: it never regenerates the database, rotates the
// password, or changes the credentials manifest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REVIEW_PASSWORD, REVIEW_TAG, REVIEW_URL } from './identities.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const manifestPath = path.join(repoRoot, '.review-data', 'review-credentials.json');

if (!fs.existsSync(manifestPath)) {
  console.error('[review:credentials] FATAL: credentials manifest is missing.');
  console.error('[review:credentials]   run: npm.cmd run review:setup');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.sharedPassword !== REVIEW_PASSWORD) {
  console.error('[review:credentials] FATAL: manifest does not contain the sanctioned fixed review password.');
  process.exit(1);
}

console.log('[review:credentials] DISPOSABLE LOCAL REVIEW ONLY');
console.log(`[review:credentials] review tag: ${manifest.reviewTag || REVIEW_TAG}`);
console.log(`[review:credentials] review URL: ${manifest.url || REVIEW_URL}`);
console.log(`[review:credentials] shared fixed password: ${manifest.sharedPassword}`);
console.log(`[review:credentials] credentials file: ${manifestPath}`);
console.log('[review:credentials] WARNING: these credentials are intentionally fixed for pre-adoption review only.');
console.log('[review:credentials] WARNING: review:reset does not change the password; never use it in production or remote deployments.');
console.log('');
console.log('[review:credentials] accounts:');
for (const account of manifest.accounts || []) {
  console.log(`  ${account.username} — ${account.role}`);
}
