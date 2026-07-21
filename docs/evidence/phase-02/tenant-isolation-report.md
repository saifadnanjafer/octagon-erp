# Tenant, Company, Branch, and Record Isolation Report

`platform/organizations/memberships/index.mjs` is the membership and operating-
scope authority. Decision contexts derive active company and branch only from
active memberships; service identities are bounded to their declared tenant and
company. Record list, detail, count, export, file, job, and document-state paths
use the same evaluator scope decision.

Evidence: `tests/phase02/authorization.test.mjs` **32/32 passed**, including
list/detail/count agreement, direct-ID IDOR, cross-tenant denial, export parity,
missing-membership denial, service-identity job scope, and document-state
authorization. `tests/phase02/security-suite.test.mjs` **24/24 passed**, including
cross-tenant list/detail/export/file adversarial checks.

