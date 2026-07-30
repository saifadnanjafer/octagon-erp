# CRM test-suite register

All results are from disposable databases or the disposable preview server.

| Suite | Result |
|---|---:|
| CRM domain | 14/14 |
| CRM migration 065 | 8/8 |
| Activity-unification migration 066 | 6/6 |
| Opportunity/activity lifecycle | 11/11 |
| Single write authority | 6/6 |
| API and governance | 2/2 |
| Runtime integration | 2/2 |
| Original-shell contracts | 12/12 |
| Wave 1 registry | 6/6 |
| Permission regression | 35/35 |
| Authenticated Chromium smoke | PASS |

Migration tests include fresh up, populated upgrade, rerun, rollback/reapply,
foreign-key cleanliness, and typed irreversible refusal where rollback would
discard direct Party-subject Activity data.
