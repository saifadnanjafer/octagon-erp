# Test Suite Register

## Wave 2 checkpoint commands

| Command | Exit | Result |
|---|---:|---|
| `node --test tests/phase04/opening_cutover_phase04.test.mjs tests/phase04/legacy_migration.test.mjs` | 0 | 6/6 before failure-injection addition |
| `node --test --test-name-pattern="rolls back every migrated fact" tests/phase04/opening_cutover_phase04.test.mjs` | 0 | 1/1 |
| `node --test tests/phase04/*.test.mjs` | 0 | 47/47, 0 fail, 0 skip |
| `node tests/phase02/browser-evidence.test.mjs` | 0 | 3/3 contract-level HTTP/source checks |
| `node scripts/inspect_legacy_opening_snapshot.mjs database.db` | 0 | operational source observed; all component hashes unchanged |

The 47-test Phase 04 aggregate is counted once. Earlier focused runs are
development checks and are not added to 47.

The Phase 02 suite explicitly labels itself contract-level. It is not counted as
real browser evidence.

## Current proof boundary

Deterministic backend, migration, rollback, WAL, security, HTTP, and atomicity
proof is green. Real Chromium acceptance through the original shell is still
missing and remains a hard gate.
