#!/usr/bin/env node
// Review Freeze 1 — start the real Octagon application shell against the
// disposable review database. Requires review:setup to have run at least
// once (fails fast with instructions otherwise).
//
// Usage: node scripts/review/start.mjs   (or: npm run review:start)
//        PORT=8090 npm run review:start

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const reviewDataDir = path.join(repoRoot, '.review-data');
const reviewDbPath = path.join(reviewDataDir, 'octagon-review.db');
const reviewJsonPath = path.join(reviewDataDir, 'database.json');
const reviewBackupDir = path.join(reviewDataDir, 'legacy-backups');

if (!fs.existsSync(reviewDbPath)) {
  console.error('[review:start] FATAL: no disposable review database found.');
  console.error(`[review:start]   expected: ${reviewDbPath}`);
  console.error('[review:start]   run: npm run review:setup');
  process.exit(1);
}

// server.js's legacy recoverDbIfCorrupt() runs unconditionally on boot and,
// if OCTAGON_DB_FILE is missing, scans OCTAGON_BACKUP_DIR (which DEFAULTS TO
// THE REPO ROOT — server.js:101) for database.backup.*.json and copies the
// newest one in. Left unset, that silently pulls the REAL operational backup
// into the review environment. Two guards, both required:
//   1. Point OCTAGON_BACKUP_DIR at an empty review-scoped directory so the
//      scan can never find an operational backup.
//   2. Make sure no stray database.json/.prev survives a previous run inside
//      .review-data — their mere existence changes server.js's boot path.
fs.mkdirSync(reviewBackupDir, { recursive: true });
fs.rmSync(reviewJsonPath, { force: true });
fs.rmSync(`${reviewJsonPath}.prev`, { force: true });

process.env.OCTAGON_SQLITE_DB_FILE = reviewDbPath;
process.env.OCTAGON_DB_FILE = reviewJsonPath;
process.env.OCTAGON_BACKUP_DIR = reviewBackupDir;
process.env.PORT = process.env.PORT || '8080';

const REVIEW_TAG = 'octagon-review-build12-freeze-v1';

console.log('[review:start] OCTAGON REVIEW ENVIRONMENT (disposable database — not production)');
console.log(`[review:start]   database: ${reviewDbPath}`);
console.log(`[review:start]   port:     ${process.env.PORT}`);
console.log(`[review:start]   url:      http://localhost:${process.env.PORT}`);
console.log(`[review:start]   snapshot: ${REVIEW_TAG}`);
console.log('[review:start]   credentials: .review-data/review-credentials.json (git-ignored, local only)');
console.log('[review:start] starting server…');

createRequire(import.meta.url)(path.join(repoRoot, 'server.js'));
