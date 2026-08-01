# Autopilot Blockers Register

| ID | Severity | Status | Blocking condition | Resolution authority |
| --- | --- | --- | --- | --- |
| AP-B01 | critical | resolved | Owner selected the cutover baseline; published CAP-00 audit records divergence and integration boundaries. | Owner |
| AP-B02 | medium | observed | `octagon-final-page-catalog` has unowned modified screenshot evidence; it is excluded from this lean controller. | Worktree owner |
| AP-B03 | high | open | Operational cutover remains owner-gated; staged readiness is not authorization to touch operational data. | Owner |
| AP-B04 | medium | open | Gemini CLI is not installed in this environment, so Gemini-specific command, resume, and policy syntax is deliberately unsupported. | Environment owner |

Do not close a blocker merely because a JSON file changed. Link closure to an evidence record, a normal pushed commit, and verified remote SHA equality.
