# Internal Workshop Operational Completion Wave

Date: 2026-08-05
Branch: `codex/octagon-feature-page-expansion-marathon`
Starting tip: `226ff973bd7391c92eb0037f0ffc29b24a8b89da`
Verified implementation tip: `f0b47def450c8c585699a07739fd829adff1c1f3`
Remote implementation tip: `f0b47def450c8c585699a07739fd829adff1c1f3`

The final governance commit containing this evidence has subject
`chore(autopilot): record internal workshop operational completion`. A tracked file cannot
contain its own commit SHA, so the implementation tip above names the tested, pushed commit
immediately before the evidence envelope. The post-push local/upstream/remote equality check is
the authority for the final closure SHA.

## Scope and runtime

- Implemented by OpenAI Codex (GPT-5).
- The wave adds the Workshop Command Center, My Work daily operations, readiness/setup wizard,
  scoped KPI drilldowns, operational briefing guidance, and readiness action planning.
- The implementation uses existing canonical authorities and governed action endpoints. It does
  not introduce a second stock writer, production authority, quality authority, task authority,
  or operational database.
- No BUILD-11, VNext, Telegram, `main`, payroll, attendance, timesheet, or live operational-data
  work was started.
- BUILD-11 remains `PENDING` and is still the supervised queue's active eligible task.

## Delivered operational surfaces

### Workshop Command Center

- Five required sections: Today, Urgent, Operational Queues, System Health, and My Work.
- Eighteen role-aware KPI signals backed by real bounded SQL against canonical authorities.
- Explicit `ready`, `permission_denied`, and `unavailable` states; one failed signal cannot hide
  other usable signals.
- Company, warehouse, and actor scope are enforced server-side before queries execute.
- Every KPI has a registered permission, canonical target, bounded drilldown, responsible role,
  response cadence, response window, safe response steps, escalation rule, and evidence list.
- The accessible drilldown drawer supports keyboard focus trapping, Escape/backdrop close, retry,
  empty/error/loading states, and navigation to the canonical workspace.

### My Work

- Assigned, due today, overdue, blocked/waiting, and recent views.
- Actor filtering can only narrow the signed-in actor and cannot expand into another actor's work.
- Company-scoped, permission-filtered sources with server-side family/status/priority/due filters.
- Bounded pagination, deterministic priority ordering, responsive cards, and canonical deep links.

### Readiness and setup

- Ten categories and more than thirty real readiness checks.
- Transparent formula: mandatory READY divided by mandatory evaluable states; optional,
  permission-hidden, and unsupported checks are excluded from the denominator.
- Every check uses an explicit non-binary state and points to its canonical setup workspace.
- Every check has responsible-role guidance, safe setup steps, required evidence, prerequisite
  dependencies, and deterministic next-action ordering.
- Readiness evaluation and action planning are read-only and proved to make zero database changes.

## Disposable pilot acceptance

The pilot creates a fresh disposable database and seven explicit actors covering supervisor,
warehouse operator, production, quality, maintenance, sales, and finance duties. It completes:

1. Customer order and production demand.
2. Production order and governed material issue.
3. Shop-floor execution and quality checkpoint.
4. Finished-goods receipt through canonical Inventory.
5. Delivery, customer invoice, payment, and closure.

The same disposable pilot proves three exception paths:

- Receiving discrepancy requires a different reviewer before posting.
- Material shortage remains a governed proposal and does not mutate canonical stock.
- Failed quality inspection creates NCR-linked rework/retest through the Quality authority.

Role-boundary tests prove non-overlapping work queues, denial of cross-actor filter expansion,
manager-only readiness access, useful permission-filtered operator Command Center data, and
company/warehouse isolation.

## Chromium acceptance

All four workshop browser flows pass serially:

1. Supervisor opens the scoped Command Center, sees five sections and at least sixteen cards,
   opens a bounded live KPI drilldown, and navigates to populated My Work.
2. Warehouse Operator opens an assigned pick, reaches canonical Picking Execution, invokes the
   real governed assignment action, and sees refreshed assigned status.
3. Supervisor opens readiness, follows the missing Quality Plan setup link, creates a plan with
   the canonical action, and sees readiness improve to READY.
4. Live role switching changes navigation and actor-specific data; a forbidden direct Quality
   disposition API request returns 403.

The page performance assertion for Command Center remained within its declared five-second load
budget. Browser suites run serially as required by repository policy.

## Genuine integration defects closed

- Readiness BOM and routing queries now use their real `state` columns rather than nonexistent
  `status` columns.
- Quality drilldowns use `opened_by`; maintenance drilldowns use `reported_at`.
- All eighteen drilldown SQL definitions execute successfully against a fresh installed schema.
- The topology Chromium regression previously assumed exactly one zone after creation even though
  its fixture seeds `B-STO`. The product correctly created and rendered `A-01`; the assertion now
  waits for that specific created zone rather than an invalid total-card count.
- The Command Center attention assertion now verifies lane reconciliation rather than requiring
  fixture data to invent an alert.

## Size and file floors

Measured from the starting tip through the final working tree before this evidence document:

| Metric | Result | Required |
|---|---:|---:|
| Changed implementation/test files | 45 | at least 25 |
| Added implementation/config lines | 2,200 | at least 2,200 |
| Added test lines | 1,703 | at least 900 |
| Total added implementation/test lines | 3,903 | more than 3,500 |

The evidence and state files in the final governance commit are additional to those floors.

## Exact verification results

| Gate | Result |
|---|---:|
| `npm.cmd run test:workshop` | 80/80 passed |
| Focused final Command Center domain | 8/8 passed |
| Focused final topology Chromium | 1/1 passed |
| `npm.cmd run test:build-08` | 17/17 passed |
| BUILD-09 domain and contract slice | 34/34 passed |
| BUILD-09 browser slice 1, including 32-page matrix | 17/17 passed |
| BUILD-09 browser slice 2 plus corrected topology rerun | 14/14 passed |
| BUILD-09 combined official-file coverage | 65/65 passed |
| `npm.cmd run test:build-10` | 37/37 passed |
| `npm.cmd run test:permissions` | 40/40 passed |
| `npm.cmd run test:migration` | 5/5 test files passed |
| `npm.cmd run test:autopilot` | 3/3 passed |

The monolithic BUILD-09 wrapper exceeded the shell envelope because its 36 files launch many
independent Chromium/server fixtures. The unchanged official files were therefore run with
`--test-concurrency=1` in three complete, non-overlapping slices. The only assertion failure was
the invalid seeded-zone count described above; after correction, its unchanged 15-second wait
passes. No timeout was raised and no failing result is represented as a pass.

## Publication sequence

1. `1d7e4837aa359bf71a615cc5a84cbfb81a96338a` —
   `feat(workshop-command): add role-aware internal command center`
2. `ea1107b2003143607f81ec8d575bb4c83b8346c9` —
   `feat(workshop-daily): add My Work daily operations`
3. `622315765720debbf1664428f2a6fac8691e7eb1` —
   `feat(workshop-readiness): add setup and readiness wizard`
4. `186a65e6d28b604db2f5491fa54911a6daf0770f` —
   `test(workshop-pilot): add disposable role-based lifecycle`
5. `4d7e3bff44de820cee6a6814a2e481faf58aaeda` —
   `test(workshop-shell): prove command readiness and scope in Chromium`
6. `f0b47def450c8c585699a07739fd829adff1c1f3` —
   `fix(workshop-pilot): close genuine integration defects`
7. Final evidence/governance commit —
   `chore(autopilot): record internal workshop operational completion`

Every implementation checkpoint was pushed normally. Final acceptance requires the governance
commit to be pushed, a clean worktree, and exact equality between local HEAD, upstream, and the
GitHub branch reference.
