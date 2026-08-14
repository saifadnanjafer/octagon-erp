# Stale Spec Reconciliation

Every page spec records `catalog_baseline_sha` and `last_verified_sha`. At creation both are `25c24df753962bbf3c13301eed71624bc0ee39b6`. The catalog intentionally does not follow later engineering changes.

## Procedure

1. Obtain the Product Recovery final SHA.
2. Run `git diff --name-status 25c24df753962bbf3c13301eed71624bc0ee39b6..PRODUCT_RECOVERY_FINAL_SHA` in a read-only clone or checkout.
3. Map changed `index.html`, `app.js`, `server.js`, `services/`, `modules/`, `platform/`, `views/`, migrations, and tests to affected page IDs using MANIFEST.json sourceFiles plus page-id search.
4. Reopen only affected specs. Update AS-IS sections to the final SHA; preserve TARGET BUSINESS CONTRACT text unless the owner changes the contract.
5. Recompute GAP, functional/usability assessments, actions, API evidence, and relationship edges.
6. Set `last_verified_sha` to the Product Recovery final SHA and append a dated Change History entry.
7. Re-run the catalog validator/generator in a dedicated documentation worktree; do not write product, navigation, or autopilot documents from this branch.

## Reconciliation rules

- A source change does not automatically mean a business contract changed.
- A navigation click pass does not replace real browser lifecycle proof.
- Preserve historical specs when a page is later consolidated; change canonical status and add canonical_home rather than deleting the file.
- Resolve the BUILD-12 renderer-source contradiction explicitly after Product Recovery.
