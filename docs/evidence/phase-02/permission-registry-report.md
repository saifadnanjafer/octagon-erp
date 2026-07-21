# Permission Registry and Evaluator Report

## Implemented

- `platform/authorization/registry/index.mjs` owns stable permission tokens, dependencies, retirement, and snapshots.
- `platform/authorization/evaluator/index.mjs` is the server decision authority for action, record, field, tenant, company, branch, document state, job, file, export, and service-identity paths.
- Deny precedence, stale-cache invalidation, field masks, protected-write rejection, scope predicates, audit decision evidence, and no-loopback bypass are enforced.
- `platform/governance/permissions/index.mjs` remains the Phase 01 compatibility shim and delegates to the canonical evaluator contract.

## Evidence

Command: `node tests/phase02/authorization.test.mjs`  
Result: **32/32 passed** (2026-07-21).

Command: `node tests/phase02/security-suite.test.mjs`  
Relevant result: direct hidden-action call, body-supplied identity, loopback bypass, cross-tenant access, masked leakage, import bypass, and AI/service-identity overreach all passed.

The live legacy ACL adapter remains an explicit cutover item; these results are
canonical-platform and disposable-database evidence, not a claim that every
legacy HTTP route has already switched writers.

