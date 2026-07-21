# Field Mask Report

`platform/authorization/evaluator/index.mjs` owns field visibility, masking,
read-only, and protected-write decisions. The same partition is applied to
records, list/detail results, exports, reports, history, chatter, notifications,
and print payloads; the most restrictive applicable role wins.

Evidence: `tests/phase02/authorization.test.mjs` **32/32 passed** and
`tests/phase02/security-suite.test.mjs` **24/24 passed**. Covered cases include
every-surface masking, protected-field write rejection, restrictive-role
precedence, mask shape, report/history/notification leakage, and support-bundle
redaction.

