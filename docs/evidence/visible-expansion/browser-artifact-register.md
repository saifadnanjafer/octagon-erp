# Browser Artifact Register — Checkpoint C

## C1 Sales

| Artifact | Purpose | Review |
|---|---|---|
| `screenshots-c/sales/c1-01-sales-dashboard-ar-desktop.png` | canonical Sales landing, Arabic RTL | PASS |
| `screenshots-c/sales/c1-02-lead-converted-ar.png` | visible lead conversion | PASS |
| `screenshots-c/sales/c1-03-order-delivered-invoiced-returned-ar.png` | order detail, project/attachments/profitability/timeline, and Inventory/Finance/return consequences | PASS |
| `screenshots-c/sales/c1-04-sales-report-margin-ar.png` | canonical margin report | PASS |
| `screenshots-c/sales/c1-05-sales-dashboard-en-ltr.png` | English LTR | PASS |
| `screenshots-c/sales/c1-06-sales-tablet-768.png` | tablet | PASS |
| `screenshots-c/sales/c1-07-sales-mobile-375.png` | mobile without page overflow | PASS |
| `screenshots-c/sales/c1-08-viewer-server-denial.png` | server-derived viewer denial | PASS |

Raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/checkpoint-c-browser-results.json`.

Raw traces remain gitignored. PNGs contain only disposable test data and no
cookies, passwords, or production records.

## C2 Procurement

| Artifact | Purpose | Review |
|---|---|---|
| `screenshots-c/procurement/c2-01-procurement-dashboard-ar-desktop.png` | canonical Procurement landing, Arabic RTL | PASS |
| `screenshots-c/procurement/c2-02-purchase-request-ar.png` | governed purchase request | PASS |
| `screenshots-c/procurement/c2-03-supplier-comparison-ar.png` | two suppliers with price/tax/lead/delivery comparison | PASS |
| `screenshots-c/procurement/c2-04-purchase-order-received-matched-billed-ar.png` | order facts, commitment workflow, quality, attachments, timeline, and actions | PASS |
| `screenshots-c/procurement/c2-05-receipt-quality-ar.png` | Inventory receipt and quality fact | PASS |
| `screenshots-c/procurement/c2-06-three-way-match-ar.png` | clean match and mismatch worklist | PASS |
| `screenshots-c/procurement/c2-07-supplier-bill-request-ar.png` | Finance supplier bill request | PASS |
| `screenshots-c/procurement/c2-08-supplier-performance-ar.png` | supplier scorecard | PASS |
| `screenshots-c/procurement/c2-09-procurement-en-ltr.png` | English LTR | PASS |
| `screenshots-c/procurement/c2-10-procurement-tablet-768.png` | tablet | PASS |
| `screenshots-c/procurement/c2-11-procurement-mobile-375.png` | mobile without page overflow | PASS |
| `screenshots-c/procurement/c2-12-viewer-server-denial.png` | server-derived viewer denial | PASS |

Final raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-06-05-015Z/checkpoint-c-browser-results.json`.

## C3 Point of Sale

| Artifact | Purpose | Review |
|---|---|---|
| `screenshots-c/pos/c3-01-pos-dashboard-ar-desktop.png` | canonical POS landing and atomic path, Arabic RTL | PASS |
| `screenshots-c/pos/c3-02-session-open-cashbox-ar.png` | terminal, cashier session, and opening cash | PASS |
| `screenshots-c/pos/c3-03-catalogue-availability-ar.png` | catalogue search and Inventory availability | PASS |
| `screenshots-c/pos/c3-04-split-payment-sale-ar.png` | visible split cash/card sale and success state | PASS |
| `screenshots-c/pos/c3-05-fiscal-receipt-register-ar.png` | completed receipt register | PASS |
| `screenshots-c/pos/c3-06-return-refund-ar.png` | canonical return/refund register | PASS |
| `screenshots-c/pos/c3-07-session-reconciliation-ar.png` | opening/sales/refunds/expected/counted/variance | PASS |
| `screenshots-c/pos/c3-08-audit-outbox-ar.png` | action audit and atomic outbox evidence | PASS |
| `screenshots-c/pos/c3-09-pos-en-ltr.png` | English LTR | PASS |
| `screenshots-c/pos/c3-10-pos-tablet-768.png` | tablet | PASS |
| `screenshots-c/pos/c3-11-pos-mobile-375.png` | mobile without page overflow | PASS |
| `screenshots-c/pos/c3-12-viewer-server-denial.png` | server-derived viewer denial | PASS |

Final C1+C2+C3 raw trace:
`test-artifacts/checkpoint-c-2026-07-28T03-51-11-913Z/checkpoint-c-browser-results.json`.

## C4 Work Management

| Artifact | Purpose | Review |
|---|---|---|
| `screenshots-c/work-management/c4-01-work-management-dashboard-ar-desktop.png` | canonical Work Management landing, Arabic RTL | PASS |
| `screenshots-c/work-management/c4-02-task-created-assigned-ar.png` | canonical task create and assignment | PASS |
| `screenshots-c/work-management/c4-03-subtask-dependency-ar.png` | subtask, watcher, importance and dependency relations | PASS |
| `screenshots-c/work-management/c4-04-kanban-moved-ar.png` | versioned Kanban transition | PASS |
| `screenshots-c/work-management/c4-05-calendar-moved-ar.png` | same-record calendar due-date movement | PASS |
| `screenshots-c/work-management/c4-06-completed-task-ar.png` | gated completion at 100 percent | PASS |
| `screenshots-c/work-management/c4-07-team-workload-ar.png` | workload and completion report | PASS |
| `screenshots-c/work-management/c4-08-workshop-tv-ar.png` | canonical live Workshop TV | PASS |
| `screenshots-c/work-management/c4-09-work-management-en-ltr.png` | English LTR | PASS |
| `screenshots-c/work-management/c4-10-work-management-tablet-768.png` | tablet | PASS |
| `screenshots-c/work-management/c4-11-work-management-mobile-375.png` | mobile without page overflow | PASS |
| `screenshots-c/work-management/c4-12-viewer-server-denial.png` | server-derived viewer denial | PASS |

Final C1+C2+C3+C4 raw trace:
`test-artifacts/checkpoint-c-2026-07-28T05-26-01-449Z/checkpoint-c-browser-results.json`.

## C5 Administration and Module Control

| Artifact | Purpose | Review |
|---|---|---|
| `screenshots-c/administration/c5-01-module-control-ar-desktop.png` | nineteen-area Control Plane and module facts, Arabic RTL | PASS |
| `screenshots-c/administration/c5-02-module-assigned-navigation-visible-ar.png` | company assignment and visible navigation preview | PASS |
| `screenshots-c/administration/c5-03-module-disabled-navigation-hidden-ar.png` | disabled status, blocked health, hidden navigation | PASS |
| `screenshots-c/administration/c5-04-disabled-module-server-denial-ar.png` | UI feedback after direct server denial | PASS |
| `screenshots-c/administration/c5-05-module-reenabled-access-restored-ar.png` | restored status, navigation, and action access | PASS |
| `screenshots-c/administration/c5-06-unlicensed-module-denial-ar.png` | explicit unlicensed state and denial | PASS |
| `screenshots-c/administration/c5-07-feature-flags-ar.png` | governed feature registry | PASS |
| `screenshots-c/administration/c5-08-health-ar.png` | module and service health registry | PASS |
| `screenshots-c/administration/c5-09-administration-en-ltr.png` | English LTR | PASS |
| `screenshots-c/administration/c5-10-administration-tablet-768.png` | tablet | PASS |
| `screenshots-c/administration/c5-11-administration-mobile-375.png` | mobile without page-level overflow | PASS |
| `screenshots-c/administration/c5-12-viewer-control-plane-denial.png` | restricted viewer server denial | PASS |

Final C1+C2+C3+C4+C5 raw trace:
`test-artifacts/checkpoint-c-2026-07-28T05-53-33-383Z/checkpoint-c-browser-results.json`.

All C5 PNGs were reviewed directly. They contain disposable fixture facts only,
with no cookies, passwords, API-key hashes, secrets, or operational records.

## Final C6 artifact registration

- Trace: `test-artifacts/checkpoint-c-2026-07-28T07-34-22-151Z/`
- Result JSON:
  `test-artifacts/checkpoint-c-2026-07-28T07-34-22-151Z/checkpoint-c-browser-results.json`
- Chromium: Chrome/150.0.7871.24; result 90/90.
- Reviewed screenshot roots: `screenshots-c/sales`, `procurement`, `pos`,
  `work-management`, and `administration` (56 registered PNGs total).

The final replay regenerated the direct screenshot paths; the reviewed tracked
PNGs were retained to avoid binary churn. C6 Phase 02/03 regression artifacts
were moved recoverably to the shared COMPANY project-artifact archive and were
not staged.
