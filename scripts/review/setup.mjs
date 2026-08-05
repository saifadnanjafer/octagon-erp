#!/usr/bin/env node
// Review Freeze 1 — disposable review environment setup.
//
// Creates a FRESH database at .review-data/octagon-review.db (never
// database.db, never database.json — see identities.mjs's operational-path
// guard), runs every accepted migration, seeds the 19 review identities
// (two tenants/companies/branches) and every domain's demo fixtures, then
// prints local start instructions. Makes no external network calls.
//
// Usage: node scripts/review/setup.mjs   (or: npm run review:setup)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { seedReviewIdentities, writeReviewManifest, REVIEW_PASSWORD } from './identities.mjs';
import { REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH, ISOLATION_TENANT, ISOLATION_COMPANY, ISOLATION_BRANCH } from './roles.mjs';

import { seedWorkshopFixtures } from './fixtures/workshop.mjs';
import { seedWarehouseFixtures } from './fixtures/warehouse.mjs';
import { seedProductionFixtures } from './fixtures/production.mjs';
import { seedQualityFixtures } from './fixtures/quality.mjs';
import { seedCommercialSaasFixtures } from './fixtures/commercial-saas.mjs';
import { seedAlWarshaPackFixtures } from './fixtures/al-warsha-pack.mjs';
import { seedAiFixtures } from './fixtures/ai.mjs';
import { seedPeopleDevelopmentFixtures } from './fixtures/people-development.mjs';
import { seedMarketingFixtures } from './fixtures/marketing.mjs';
import { seedEventsFixtures } from './fixtures/events.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const reviewDataDir = path.join(repoRoot, '.review-data');
export const reviewDbPath = path.join(reviewDataDir, 'octagon-review.db');
export const reviewManifestPath = path.join(reviewDataDir, 'review-credentials.json');

function nowIso() { return new Date().toISOString(); }

async function main() {
  fs.mkdirSync(reviewDataDir, { recursive: true });

  process.env.OCTAGON_REVIEW_FIXTURE = '1';
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('[review:setup] FATAL: refusing to run with NODE_ENV=production');
    process.exit(1);
  }

  console.log('[review:setup] creating fresh disposable database…');
  await freshInstall({ dbPath: reviewDbPath, actor: 'review-setup' });

  const dialect = openMigrationDatabase(reviewDbPath);
  const now = nowIso();
  try {
    // Prove disposability to database/migration-runner/startup-policy.mjs using
    // its own sanctioned marker (see tests/cutover/_staged-clone.mjs), the same
    // mechanism the cutover tooling uses for staged clones. Without this, the
    // startup classifier falls through to UNKNOWN and server.js refuses to
    // open the database at all ("database identity unknown; failing closed").
    dialect.exec(`CREATE TABLE IF NOT EXISTS cutover_staged_fixture (
      id TEXT PRIMARY KEY, is_disposable INTEGER NOT NULL, source_label TEXT,
      created_at TEXT NOT NULL, source_db_sha256 TEXT, note TEXT);`);
    dialect.prepare(`INSERT OR REPLACE INTO cutover_staged_fixture
        (id, is_disposable, source_label, created_at, source_db_sha256, note)
      VALUES ('staged', 1, ?, ?, NULL, ?)`)
      .run('octagon-review-freeze-1', now, 'Disposable Review Freeze fixture database. Never operational.');

    console.log('[review:setup] seeding review identities…');
    const seeded = seedReviewIdentities(dialect, { dbPath: reviewDbPath });

    const domains = [
      ['workshop', seedWorkshopFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['warehouse', seedWarehouseFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['production', seedProductionFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['quality', seedQualityFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['commercial/SaaS', seedCommercialSaasFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['Al-Warsha pack', seedAlWarshaPackFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['AI', seedAiFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['people development', seedPeopleDevelopmentFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['marketing', seedMarketingFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
      ['events', seedEventsFixtures, REVIEW_TENANT, REVIEW_COMPANY, REVIEW_BRANCH],
    ];

    const summaries = {};
    for (const [label, fn, tenantId, companyId, branchId] of domains) {
      console.log(`[review:setup] seeding ${label} fixtures…`);
      summaries[label] = await fn(dialect, { tenantId, companyId, branchId, now });
    }

    const manifestPath = writeReviewManifest(reviewManifestPath, seeded);

    fs.writeFileSync(
      path.join(reviewDataDir, 'fixture-summary.json'),
      JSON.stringify({ generatedAt: now, summaries }, null, 2),
      'utf8',
    );

    console.log('');
    console.log('[review:setup] DONE.');
    console.log(`[review:setup]   database:   ${reviewDbPath}`);
    console.log(`[review:setup]   identities: ${seeded.users.length} seeded (password in ${manifestPath}, git-ignored)`);
    console.log(`[review:setup]   tenants:    ${REVIEW_TENANT} / ${ISOLATION_TENANT}`);
    console.log(`[review:setup]   companies:  ${REVIEW_COMPANY} / ${ISOLATION_COMPANY}`);
    console.log('[review:setup]');
    console.log('[review:setup] Next: npm run review:start');
  } finally {
    dialect.close();
  }
}

main().catch((error) => {
  console.error('[review:setup] FAILED:', error && error.stack || error);
  process.exit(1);
});
