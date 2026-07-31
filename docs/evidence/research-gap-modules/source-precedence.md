# Source Precedence — How It Was Actually Applied

Per the assignment's own precedence order (latest execution report >
executable repository behavior > migrations/manifests > tests > registers >
capability matrix > phase evidence > older handoffs > historical roadmaps >
assumptions), this wave resolved two concrete conflicts:

## Conflict 1 — "FP-2 completed" vs. what branch to fork from

The capability matrix and roadmap docs say nothing about which git branch is
current. The assignment's own prose named `build/octagon-final-page-catalog`
as the expected branch family. Executable repository state (`git log`,
`git status`, `git rev-parse` on both that branch and the unrelated `cutover/*`
branch) was used to verify this — not assumed. Result recorded in
`starting-state.md`.

## Conflict 2 — "Current Octagon" column in the capability matrix vs. actual code

Several matrix rows describe a capability's current state in terms written
before wave-1/wave-2/FP-2 landed (e.g. `PK-026` says "Real read-only scheduler
exists" for the *legacy* scheduler, without knowing `platform/jobs` had since
been built and tested but left unwired). Executable evidence (reading
`platform/jobs/index.mjs`, running `grep` for its importers, running its
existing test suite) proved the richer, more current truth: a second, complete
engine already existed and simply needed connecting — which is a materially
different, cheaper, lower-risk action than the "SPEC-IMPLEMENT" disposition
the matrix's own vocabulary would otherwise suggest.

**Rule actually enforced:** a capability matrix row was never accepted as
proof of absence or presence; only file reads, `grep`, and running tests were
accepted as evidence, matching §3 of the assignment ("A research document
cannot override proven current implementation").
