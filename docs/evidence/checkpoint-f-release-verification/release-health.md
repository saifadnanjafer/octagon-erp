# Checkpoint F — release health

## Result: NOT BUILT in this checkpoint

The Administration release-health view required by the mission was **not
built**. No fabricated green status is presented anywhere.

## What already exists

`server.js` exposes diagnostic endpoints that read real server state:

| Endpoint | Reports |
|---|---|
| `GET /api/server/status` | running server status |
| `GET /api/release/status` | release status |
| `GET /api/backup/verify` | backup manifest verification |
| `GET` / `POST /api/restore/dry-run` | restore dry-run |

These were **not** audited against the mission's required field list.

## What Checkpoint F makes reportable that was not before

A release-health view needs a truthful **canonical-authority-conflict** and
**legacy-writer-conflict** signal. Before this checkpoint that signal could not
be computed for seven domains:
`createLegacyWriterRetirementGuard(...).status()` knew only the six Phase 04
domains, so Projects, Engineering, Manufacturing, Quality, Assets, Maintenance
and Fleet were invisible to it. A health view would have reported green for
domains it could not see — worse than reporting nothing.

After this checkpoint `status()` reports all **13** lockable domains with
`cutoverEnabled`, the lock row and `enforced` per domain. Asserted by
`records the true enforcement state of the legacy writer retirement`.

## What a truthful health view would report today

| Signal | Real value |
|---|---|
| Migration status | 60/60 applied on fresh install; rerun idempotent |
| Registered modules | 18 — one of which is a **test fixture shipped enabled** |
| Registered actions | 330, no duplicate id |
| Registered entities | 158, no competing ownership |
| Database dialect | `sqlite` (the postgres adapter is a fail-closed stub) |
| Canonical-authority conflicts | none at registry level |
| **Legacy-writer conflicts** | **12 of 13 domains un-retired; only FINANCE enforced** |
| Opening-cutover gate | unresolved, fail-closed |
| Audit health | every action declares `audit_policy='required'` |
| Backup status | not verified in this checkpoint |

## Required fields not yet sourced

Running application version, commit SHA, unhealthy modules, missing
dependencies, missing configuration, failed jobs, outbox backlog, and session
health were **not** wired to a view. Recorded in
[unresolved-risks.md](unresolved-risks.md).
