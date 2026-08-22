# BUILD-12 AI, People, Marketing, Events, and Al-Warsha Evidence

## Published checkpoint

- Branch: `codex/octagon-feature-page-expansion-marathon`
- Implementation checkpoint: `58249a238acfc3e33b1a0ee8ef92f3d85c0d062e`
- Final closure commit: `c95a1d63d62017c5d3203af13142ff36716fee45`
- Remote equality: verified local `HEAD`, upstream, and remote branch at the same SHA.
- Scope: BUILD-12 only. BUILD-13 remains pending.

## Implemented authority

- Additive migration 089 registers the governed AI, People Development,
  consent-aware Marketing simulation, Events, and Al-Warsha metadata entities,
  permissions, actions, simulator provider/tasks, entitlements, and `ai_usage`
  hard quota.
- AI execution is deterministic simulator-only, bounded by registered task
  context and classifications, records hashes/redactions/blocked instructions,
  requires review for medium/high risk proposals, and never autonomously
  executes a canonical action.
- People Development is scoped to skills, evidence, plans, learning, and
  certifications; it does not touch payroll, attendance, or timesheets.
- Marketing uses consent-aware audiences, maker-checker content, and explicit
  simulation-only attribution; Events uses capacity/waitlist and attendee-only
  check-in separate from employee attendance; Al-Warsha uses BUILD-11 safe
  extension lifecycle metadata only.
- Global provider/task/profile reads are kept separate from tenant-scoped rows.

## UI and acceptance

- 24 purpose-built workspaces are wired into the existing shell and nav.
- Guided inputs avoid raw JSON/manifest entry and expose governance labels,
  risk, context, review, no-auto-execution, simulation, empty, error, denied,
  Arabic/English, RTL/LTR, responsive, and keyboard-focus states.
- `npm.cmd run test:build-12`: **17/17 passed** serially:
  4 contract tests, 5 real-shell Chromium flows, and 8 domain tests.
- `npm.cmd run test:migration`: **5/5 suites passed**, including historical
  immutability and rollback compatibility.

## Closure regression record

The full authorized acceptance record is green:

- BUILD-12 focused suite: **17/17** (4 contracts, 5 real-shell Chromium,
  8 domain tests).
- BUILD-09 serial suite: **65/65**, including all 32 workspace flows and
  cross-domain/Chromium acceptance.
- BUILD-08: **17/17**; BUILD-10: **37/37**; BUILD-11: **19/19**.
- Workshop: **80/80**; permissions: **40/40**; autopilot: **3/3**;
  unit: **12/12**; migration: **5/5**.

The final evidence commit refreshes STATE/QUEUE to COMPLETE and is published
with local/upstream/remote equality and a clean worktree. No external AI,
payment, SMS, email, advertising, operational-data, Finance, Inventory,
Manufacturing, Quality, payroll, attendance, timesheet, Telegram, VNext, or
BUILD-13 work is in scope.
