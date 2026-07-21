# Phase 01 Test Evidence

**Phase:** 01  
**Date:** 2026-07-21  
**Node.js:** v24.14.1  
**Database:** SQLite (node:sqlite DatabaseSync), disposable temp databases only.  

---

## Test commands and results

All commands run from `octagon-erp/` on disposable SQLite databases in `os.tmpdir()`.

```bash
node tests/migration/runner.test.mjs && \
node tests/unit/modules.test.mjs && \
node tests/unit/entities.test.mjs && \
node tests/unit/repositories.test.mjs && \
node tests/unit/actions.test.mjs && \
node tests/unit/views.test.mjs && \
node tests/unit/sequences.test.mjs && \
node tests/unit/events.test.mjs && \
node tests/unit/api.test.mjs && \
node tests/unit/control-plane.test.mjs
```

**Result:** **all tests passed** (2026-07-21).

---

## Detailed test coverage

### Migration runner (`tests/migration/runner.test.mjs`)
- `freshInstall`
- `statusAndReRun`
- `dependencyOrder`
- `dependencyCycleDetection`
- `missingDependency`
- `downRollback`
- `concurrentRunLock`
- `postgresDialectStub`

### Module registry (`tests/unit/modules.test.mjs`)
- `manifestValidation`
- `installAndEnable`
- `dependencyBlock`
- `disableAndUninstall`
- `uninstallWithDependents`
- `loadOrder`
- `loadOrderCycle`
- `diskDiscovery`

### Entity registry (`tests/unit/entities.test.mjs`)
- `descriptorValidation`
- `reservedEntityName`
- `duplicateEntityUpsert`
- `moduleMustBeEnabled`
- `defaultEntitiesSeeded`
- `relationValidation`
- `unregisterEntity`
- `auditWritten`

### Repository (`tests/unit/repositories.test.mjs`)
- `genericMasterCrud`
- `protectedEntityMutationDenied`
- `scopeIsolation`
- `filterPaginationAndSort`
- `summary`
- `relationExpand`
- `concurrentUpdateVersion`
- `auditHistory`
- `writeGuards`
- `legacyAdapterReadOnly`
- `maxLimitEnforced`

### Actions / lifecycle (`tests/unit/actions.test.mjs`)
- `lifecycleDefinitionRegistration`
- `invalidLifecycleRejected`
- `lifecycleTransition`
- `illegalTransitionRejected`
- `staleVersionRejected`
- `terminalStateBlocksGenericUpdate`
- `actionRegistryAndExecution`
- `idempotencyKey`
- `crmLeadLifecycleAction`
- `reverseVsCancel`
- `amendPreservesLineage`
- `actionAuditAndOutbox`
- `preconditionDenial`

### Views (`tests/unit/views.test.mjs`)
- `viewRegistration`
- `routeConflict`
- `menuOrder`
- `disabledModuleRouteRemoved`
- `versionRollback`
- `patchConflict`
- `localizationKeyPresence`

### Sequences (`tests/unit/sequences.test.mjs`)
- `basicSequence`
- `companyIsolation`
- `calendarMonthReset`
- `peekSeq`
- `resetSeq`
- `formatSequence`

### Events / outbox (`tests/unit/events.test.mjs`)
- `eventRegistration`
- `payloadSchemaValidation`
- `outboxDispatch`
- `outboxRetryAndDeadLetter`
- `outboxReplay`
- `outboxNoConsumerNoop`

### API (`tests/unit/api.test.mjs`)
- `metaEntities`
- `genericCrud`
- `protectedMutationDenied`
- `actionEndpoint`
- `idempotentCommand`
- `unknownRoute`

### Control plane (`tests/unit/control-plane.test.mjs`)
- `executionContext`
- `settingsRegistry`
- `featureFlagRegistry`
- `permissionHookDenyByDefault`
- `permissionHookWithGrant`
- `jobRegistry`
- `healthRegistry`

---

## Exclusions

- Production database `database.db` was not touched.
- Browser/UI automation tests are not included in Phase 01; the existing shell remains manually verified as loadable.
- Concurrency stress tests use sequential in-process calls; distributed load testing is deferred.

---

## Next review

Update this evidence after every test run or test addition in subsequent phases.
