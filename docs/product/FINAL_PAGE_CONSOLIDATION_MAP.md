# Final Page Consolidation Map

Baseline primary destinations: **231**. Current primary destinations: **221**.
The 10 current-pass demotions are retained as compatible redirects; no route or
capability was silently removed. Five earlier tab/alias classifications are also
recorded below for a complete compatibility map.

| Original page | Disposition | Canonical home | Type | Compatible route | Commit |
|---|---|---|---|---|---|
| `calculator` | MOVE_TO_TAB | `timesheet` | TAB | yes | `e0e0861` |
| `kanban` | MOVE_TO_TAB | `task_manager` | TAB | yes | `e0e0861` |
| `locations` | MOVE_TO_TAB | `warehouses` | TAB | yes | `e0e0861` |
| `pos_deepening` | ALIAS_ONLY | `pos` | ALIAS | yes | `e0e0861` |
| `workshop_tv` | MOVE_TO_TAB | `task_manager` | TAB | yes | `e0e0861` |
| `knowledge` | ALIAS_ONLY | `knowledge_base` | ALIAS | yes | `e0e0861` |
| `geofence_events` | MOVE_TO_TAB | `geofence_management` | TAB | yes | `e0e0861` |
| `consolidation_lineage` | MOVE_TO_TAB | `consolidation_groups` | TAB | yes | `e0e0861` |
| `consolidation_runs` | MOVE_TO_TAB | `consolidation_groups` | TAB | yes | `e0e0861` |
| `forecast_accuracy` | MOVE_TO_TAB | `forecast_overrides` | TAB | yes | `e0e0861` |
| `forecast_versions` | MOVE_TO_TAB | `forecast_overrides` | TAB | yes | `e0e0861` |
| `device_enrollment` | MOVE_TO_TAB | `device_registry` | TAB | yes | `e0e0861` |
| `replenishment_rules` | MOVE_TO_TAB | `putaway_rules` | TAB | yes | `e0e0861` |
| `receiving_discrepancies` | MOVE_TO_TAB | `mobile_receiving` | TAB | yes | `e0e0861` |
| `mps_proposals` | MOVE_TO_TAB | `mps` | TAB | yes | `e0e0861` |

The JSON companion includes every retained primary page as well as every
reclassification.

## Business-level review of remaining candidates (closure pass)

Reviewed on business object, user goal, role, lifecycle stage, data authority,
primary action, frequency and navigation context — not on the similarity score.
**No further merge was executed**: every surviving candidate is either a
canonical-authority cutover the BUILD-13 handover gates behind an owner mapping
decision, or a product-identity question only the owner can answer.

| Pair | Business object | Data authority | Class | Reason |
|---|---|---|---|---|
| `inventory` / `canonical_inventory` | same (stock) | **different** — legacy `omni` vs canonical | OWNER_DECISION_REQUIRED | The only pair the analyzer itself escalated above class C, matching GAP-001 independently. Resolving it means retiring a legacy writer. |
| `home` / `wfl_home` | same (landing page) | same | OWNER_DECISION_REQUIRED | A genuine role-filter variant, so structurally a merge candidate — but `home` is the boot default and which is canonical is a product-identity call. |
| `customers` / `parties` | **different** — AR balance vs party master | different | KEEP_SEPARATE | The catalog flagged this only *if* Customers is a finance-filtered party view. It is not: it owns posting a charge against a customer balance. Both can create a customer, which is a duplicate create path worth an owner call; removing either would lose a working path. |
| `content_approvals` / `approvals` | different targets, same verb | different | OWNER_DECISION_REQUIRED | Catalog C-028. The generic queue does not understand content targets, so merging now would lose capability. |
| `command_center` / `workshop_command_center` | same kind, different scope | same | KEEP_SEPARATE | Whole-business vs workshop-scoped; both P0 and both in daily use. |
| `wave_planning` / `wave_execution` | same object, different lifecycle stage | same | KEEP_SEPARATE | Catalog C-004 requires the creator/reviewer and release boundaries stay separate. |
| `pick_task_queue` / `putaway_task_queue` | different physical operations | same | KEEP_SEPARATE | Inbound putaway and outbound picking share vocabulary, not a task. |
| `extension_marketplace` / `extension_installations` | same object, different lifecycle stage | same | KEEP_SEPARATE | Browse/validate versus staged/enable. |
| `fuel_telemetry` / `suspected_fuel_loss_queue` | measurement vs exception queue | same | KEEP_SEPARATE | A queue of suspected losses is not the telemetry it derives from. |
| Remaining 137 scored pairs | — | — | KEEP_SEPARATE | Class C: distinct business objects sharing vocabulary. |

**Capability loss this pass: 0.** No page was retired, hidden or redirected.
