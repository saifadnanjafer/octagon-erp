// Phase 04 browser cutover gate.
//
// This file intentionally does not simulate browser coverage with source-text
// checks or an in-memory database. Phase 04 browser validation is blocked until
// the disposable legacy migration reconciles stock, reservations, valuation,
// and stock-to-GL without invented accounting facts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputPath = path.join(
  repoRoot,
  'docs',
  'evidence',
  'phase-04-remediation',
  'browser-scenario-results.json',
);

export function recordBlockedBrowserGate() {
  const result = {
    schemaVersion: 2,
    status: 'BLOCKED',
    executed: false,
    cutoverActivated: false,
    reasonCode: 'LEGACY_RECONCILIATION_BLOCKED',
    reason: 'Canonical UI cutover is unsafe while opening stock, reservation lineage, valuation, and stock-to-GL do not reconcile.',
    prohibitedEvidence: [
      'source-text inspection presented as browser execution',
      'in-memory database calls presented as browser execution',
      'success totals that ignore failed scenarios',
    ],
    prerequisite: 'Resolve or formally approve source-backed opening-stock and reservation lineage, rerun disposable migration to PASSED, then execute real browser scenarios.',
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = recordBlockedBrowserGate();
  console.error(`[${result.status}] ${result.reasonCode}: ${result.reason}`);
  process.exitCode = 2;
}
