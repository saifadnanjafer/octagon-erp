> ⚠️ **SUPERSEDED 2026-05-22** — this doc is preserved for historical reference. All current handover content lives in `octagon-erp/HERE.md`. The full catalog of every doc and its disposition is in `octagon-erp/_safe/MASTER_CATALOG.md`. AI sessions of any model: do not write here. Append checkpoints to `HERE.md` only.

---


﻿# OCTAGON ERP / OMNISYSTEM V4.0 — Master Reference

> **ملف مرجعي رئيسي واحد — آخر تحديث: 2026-05-21**
>
> هذا الملف يحتوي على كل ما يحتاجه أي مطور لمتابعة العمل.
> أي تعديل يجب أن يُسجل هنا مع التاريخ.

---

## 2026-05-22 - React Operation Packs Task Generation

- Added a React Operation Packs page and wired it into the sidebar with the existing `op_packs` key.
- Added two starter operation templates for print and fast signage work.
- The page shows pack KPIs, step owner/SOP/machine metadata, estimated minutes, and generated-task status.
- Added `إنشاء مهام الباقة` to create Task Manager tasks for each pack step.
- Generated tasks carry pack code, step id, assignee, department, linked machine, due date, tags, and `operationPackTaskKey` duplicate protection.
- No backend mutation or database write was added.
- Updated `STRUCTURE.md`: Operation Packs are now 82%.
- Validation: `npm.cmd run build` passes with only the existing Vite chunk-size warning.

---

## 2026-05-22 - React Analytics Trend Bars

- Added historical financial-impact bars from `summary.anomalies.impact_trend`.
- Added a compact executive readout for anomaly trend, automation pressure, employee requests, and delayed projects.
- No backend mutation or data model change was added.
- Updated `STRUCTURE.md`: Analytics / Intelligence is now 92%.
- Validation: `npm.cmd run build` passes.

---

## 2026-05-21 - React Task Manager AI Source Filter

- Added visible Task Manager handling for tasks created from Intelligence findings.
- Tasks carrying custom field `aiFindingKey` now show an `AI` badge on the card.
- Added an AI task KPI count.
- Added a local source filter strip: all / AI / manual.
- No new task model field, backend mutation, or external AI call was added.
- Updated `STRUCTURE.md`: Task Manager remains 99%, with AI source filtering documented.
- Validation: `npm.cmd run build` passes.

---

## 2026-05-21 - React AI Finding To Task Action

- Added a direct remediation action to the React Intelligence Panel.
- Each live deterministic finding can create a Task Manager task with severity mapped to priority.
- Created tasks carry a custom field `aiFindingKey` so the same finding shows `مهمة موجودة` instead of creating duplicates.
- The action pushes a notification and navigates the user to Task Manager.
- No backend mutation or external AI call was added.
- Updated `STRUCTURE.md`: Analytics / Intelligence is now 90%.
- Validation: `npm.cmd run build` passes. Browser automation remains unavailable because Playwright is not installed in this workspace.

---

## 2026-05-21 - React QC Photo Evidence Metadata

- Added local-only before/after photo evidence reference metadata in React QC Center.
- Each QC record card can save a reference/file name and timestamp for `before` and `after` evidence.
- Metadata persists only in browser localStorage under `octagon.qc.photoEvidence.v1`.
- No binary image upload, backend attachment persistence, or live database mutation was added.
- Updated `STRUCTURE.md`: QC Center is now 97%; binary attachment upload remains deferred.
- Validation: `npm.cmd run build` passes. Browser automation was unavailable because Playwright is not installed in this workspace.

---

## 2026-05-21 - SOP Documents Usability Pass

- React SOP Hub now exposes document actions directly in the SOP page: filtered/all SOP print-to-PDF, filtered/all JSON export, selected SOP PDF/Markdown/JSON export.
- Added two starter SOP templates from the page header: operating procedure and quality inspection procedure.
- Added JSON SOP import that accepts a single SOP, an array of SOPs, or an exported `{ sops: [] }` payload and imports non-destructively as local SOP records.
- Added SOP attachment/reference foundation: selected SOPs can capture file/image references as metadata (`name`, `type`, `size`, `addedAt`) and remove them from the visible attachment panel. Binary file storage/upload is intentionally not implemented yet.
- Updated `STRUCTURE.md`: SOP Library is now 86%; attachment/reference foundation and templates/import are done; step reordering remains open.
- Validation: focused TypeScript check for `SOPHub.tsx` and `sopStore.ts` passed; browser smoke on `http://127.0.0.1:5173` confirmed template/import/attachment controls render with no console errors.
- Build note: this was followed by the React Build Baseline Restored pass below; `npm.cmd run build` now passes.

---

## 2026-05-21 - React Build Baseline Restored

- Restored a clean production build for `erp-local/frontend` by aligning the payroll store contract with the pages that consume it.
- Added safe local `updateEmployee`, `deleteEmployee`, and `addRecord` helpers to `payrollStore.ts`; failed employee API adds now fall back to a local optimistic record instead of silently dropping the user action.
- Added optional `year`, `month`, and `day` fields to `AttendanceRecord` for existing Attendance Calendar and Payroll Calculator month filtering.
- Fixed missing icon imports in Attendance Calendar (`Plus`) and Inventory (`Wrench`).
- Validation: `npm.cmd run build` now passes (`tsc && vite build`), producing `dist/index.html`, CSS, and JS assets.

---

## 2026-05-21 - SOP Step Reordering Completed

- Added selected-SOP step reordering to the React SOP Hub using safe up/down line controls instead of a drag dependency.
- The reorder action moves non-empty SOP content lines and automatically renumbers numbered steps after each move.
- Browser smoke confirmed the step panel renders, the move-down control changes the first SOP step order, and no console errors are emitted.
- Updated `STRUCTURE.md`: SOP Library is now 90%; Sprint 13 SOP attachments/print/templates/import/step ordering is complete for the React hub. Binary attachment storage remains intentionally deferred.
- Validation: `npm.cmd run build` passes after the SOP step reordering patch.

---

## 2026-05-21 - React Task Manager Dependency Pass

- Added explicit task dependencies to the React Task Manager model with `dependencyIds`.
- Task cards now show dependency references, incomplete blocker counts, and add/remove dependency controls.
- Deleting a task now requires an inline second confirmation instead of a single accidental click.
- Confirmed existing Task Manager filters are active for search, status, priority, and assignee; updated status docs accordingly.
- Updated `STRUCTURE.md`: Task Manager is now 84%; safe delete, dependencies, and task filters are done.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed dependency controls render with no console errors.

---

## 2026-05-21 - React Task Manager Movement Controls

- Added explicit previous/next section movement controls to each React Task Manager card, beside the existing status selector.
- The controls update task status through the existing store path and disable naturally at the first/last workflow status.
- This completes the visible "move tasks between sections" requirement without adding a fragile drag dependency.
- Updated `STRUCTURE.md`: Task Manager is now 86%; movement controls, safe delete, dependencies, and filters are done.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed Task Manager opens, dependency chips remain visible, movement text renders, and no console errors are emitted.

---

## 2026-05-21 - React Task Manager Operational Links

- Added optional Task Manager reference fields for SOP, machine, material, and QC records.
- Task cards now show a compact `روابط التشغيل` panel with selectors for SOP, machine, material, and QC.
- SOP options load from the SOP store, QC options use the QC store, material options prefer inventory items and fall back to simple visible material choices when inventory is offline/empty.
- Updated `STRUCTURE.md`: Task Manager is now 88%; the Task Manager link requirement is done for SOP, machine, material, and QC references.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed operational link controls render with no console errors.

---

## 2026-05-21 - React Task Manager Inspector Panel

- Added a visible detail action to every React Task Manager card.
- Added a right-side task inspector panel with immediate-edit fields for title, description, status, priority, assignee, department, and due date.
- The inspector also summarizes dependencies plus SOP, machine, material, and QC operational references.
- Updated `STRUCTURE.md`: Task Manager is now 90%; the Task inspector requirement is done for the React Task Manager.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed visible detail buttons, inspector rendering, editable fields, operational summaries, and no console errors.

---

## 2026-05-21 - React Task Manager Custom Fields

- Added optional `customFields` metadata to React Task Manager tasks with legacy bridge normalization.
- Added a custom fields section to the right-side Task Inspector for task-specific key/value rows.
- Task cards now show a compact custom-field count badge when metadata exists.
- Updated `STRUCTURE.md`: Task Manager is now 92%; custom fields are done for the React Task Manager inspector.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the inspector opens, the custom-field add control renders, a key/value row appears, and no console errors are emitted.

---

## 2026-05-21 - React Task Manager Hierarchy Labels

- Added a visible hierarchy legend to the React Task Manager page.
- The hierarchy now labels the working levels as workspace, department, execution stage, task, and subtask/dependency fields.
- This completes the Sprint 12 "Rename hierarchy levels" requirement without changing the task data contract.
- Updated `STRUCTURE.md`: Task Manager is now 94%; hierarchy-label cleanup is done.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the hierarchy strip renders, board content remains present, and no console errors are emitted.

---

## 2026-05-21 - React Task Manager Calendar View

- Added a third Task Manager view toggle for Calendar.
- Calendar view groups filtered tasks by `dueDate` in chronological order and keeps task detail inspection available from each calendar card.
- This advances the Task Manager view requirement without changing task persistence or adding date-edit side effects.
- Updated `STRUCTURE.md`: Task Manager is now 96%; Board/List/Calendar are done, Timeline/Workload remain open.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the calendar toggle renders, due-date groups appear, task cards remain visible, and no console errors are emitted.

---

## 2026-05-21 - React Task Manager Workload View

- Added a fourth Task Manager view toggle for Workload.
- Workload view groups filtered tasks by assignee and shows open, done, and urgent counts per person.
- Task cards in Workload remain read-only summaries and open the existing right-side inspector.
- Updated `STRUCTURE.md`: Task Manager is now 98%; Board/List/Calendar/Workload are done, Timeline remains open.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the Workload toggle renders, assignee groups and counters appear, and no console errors are emitted.

---

## 2026-05-21 - React Task Manager Timeline View

- Added a fifth Task Manager view toggle for Timeline.
- Timeline view orders filtered due-date tasks chronologically with overdue highlighting and task cards that open the existing inspector.
- Updated `STRUCTURE.md`: Task Manager is now 99%; Board/List/Calendar/Workload/Timeline are done. The only remaining caveat is that assignee/priority/due-date editing is still documented as partial rather than full workflow management.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the Timeline toggle renders, due-date tasks appear in order, and no console errors are emitted.

---

## 2026-05-21 - React Machine Control Queue Surface

- Added a React Machine Control page and wired it into the sidebar under `machines`.
- The page shows seven default machines with status, operator, hours, downtime, maintenance date, load bar, and queue count.
- Machine queues are derived from Task Manager tasks that have `linkedMachine`, so the queue display is visible without mutating task or machine state.
- Added a right-side machine inspector with load/hours summary, linked queue details, and maintenance status.
- Updated `STRUCTURE.md`: Machine Control is now 70%; machine queue display from linked tasks is done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the Machines sidebar entry, 7 queue cards, 7 detail buttons, inspector rendering, and no console errors.

---

## 2026-05-21 - React Machine Control Linked SOP Display

- Machine Control now resolves SOP records from queued Task Manager tasks with `linkedSopId`.
- Each machine card shows a linked SOP panel and count beside the queue panel.
- The machine inspector now includes a linked SOP section with SOP title, category, and short content preview.
- Updated `STRUCTURE.md`: Machine Control is now 74%; linked SOP display is done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 7 SOP panels, inspector SOP section rendering, and no console errors.

---

## 2026-05-21 - React Machine Control Job History

- Machine Control now shows a read-only job history panel on every machine card.
- Job history is derived from queued Task Manager tasks first, then falls back to current machine telemetry when no linked queue exists.
- The machine inspector now includes a full job history section with owner, date, status, and source labels.
- No task, SOP, machine, or database mutations were added in this pass.
- Updated `STRUCTURE.md`: Machine Control is now 78%; job history per machine is done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 7 history panels, inspector history rendering, and no console errors.

---

## 2026-05-21 - React Machine Control Downtime Log

- Machine Control now shows a read-only downtime panel on every machine card.
- Downtime logs are derived from current machine downtime telemetry plus urgent queued Task Manager work.
- The machine inspector now includes a downtime log section with duration, impact, date, reason, and notes.
- No task, machine, or database mutations were added in this pass.
- Updated `STRUCTURE.md`: Machine Control is now 82%; downtime logging is done as a read-only React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 7 downtime panels, inspector downtime rendering, and no console errors.

---

## 2026-05-21 - React Machine Control Maintenance Schedule

- Machine Control now shows a read-only maintenance planning panel on every machine card.
- Maintenance due dates are derived from last maintenance date, current status, load, downtime, and open queue pressure.
- The machine inspector now includes a maintenance plan section with due date, type, owner, urgency, and planning note.
- No task, machine, or database mutations were added in this pass.
- Updated `STRUCTURE.md`: Machine Control is now 86%; maintenance scheduling is done as a read-only React planning surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 7 maintenance panels, inspector maintenance rendering, and no console errors.

---

## 2026-05-21 - React Inventory Material Task Links

- Inventory now shows active Task Manager task counts per material in the inventory table.
- Selecting a material opens a linked tasks panel in the movement sidebar with task title, assignee, due date, status, and priority.
- Matching uses explicit `linkedMaterialId` plus material name/category text signals so current seed tasks and future linked tasks both appear.
- Added a read-only fallback material list when the inventory API is empty/offline, keeping the page visible during local browser smoke tests.
- Updated `STRUCTURE.md`: Inventory is now 66%; active task links for materials are done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed Inventory opens, 3 fallback rows render, linked task count cells render, selected-material linked task panel renders, and no console errors.

---

## 2026-05-21 - React Inventory Cost Tracking Display

- Inventory now shows total stock value as a top KPI.
- The material table now shows unit cost and total stock value per material.
- Selecting a material opens a read-only cost panel with unit cost, stock value, waste score, and leak probability.
- Cost display uses existing `unit_cost_avg`, `current_qty`, `waste_score`, and `leak_probability`; no inventory mutations were added.
- Updated `STRUCTURE.md`: Inventory is now 70%; cost tracking per material is done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the cost KPI, 3 cost cells, selected-material cost panel, and no console errors.

---

## 2026-05-21 - React Inventory Supplier Foundation

- Inventory now shows active supplier count as a top KPI.
- The material table now includes a supplier column with supplier name and lead time.
- Selecting a material opens a read-only supplier profile panel with name, category, lead time, contact, and reliability.
- Supplier profiles are a local display foundation derived from material category/fallback catalog; no supplier persistence or mutation was added.
- Updated `STRUCTURE.md`: Inventory is now 74%; supplier management foundation is visible in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed supplier KPI, 3 supplier cells, selected-material supplier panel, and no console errors.

---

## 2026-05-21 - React Inventory Purchase Request Preview

- Inventory now shows suggested purchase request count as a top KPI.
- Selecting a low-stock material opens a preview-only purchase request card with reorder quantity, estimated cost, suggested supplier, lead time, and request route.
- The preview uses existing current quantity, minimum threshold, unit cost, and supplier profile data.
- No purchase request, purchase order, or stock mutation was added in this pass.
- Updated `STRUCTURE.md`: Inventory is now 78%; purchase request generation has a visible preview foundation in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed purchase KPI, selected-material purchase preview panel, and no console errors.

---

## 2026-05-21 - React QC Center Records Filters

- QC Center records tab now has a filter toolbar with text search, severity select, inspector select, status chips, and result count.
- Filtering is read-only and works over existing QC records by title, source, inspector, notes, and fail reason.
- Added stable smoke hooks for the QC page, filter toolbar, and result count.
- Updated `STRUCTURE.md`: QC Center is now 86%; records-tab filters are done in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed QC opens, filters render, search narrows results to 1 / 2, and no console errors.

---

## 2026-05-21 - React QC Center Material Batch Context

- QC record cards now show a read-only material/batch context panel.
- Context is derived from QC record title/source/notes against a local material context catalog.
- The panel shows material name, batch code, current stock, minimum stock, and low-stock/readiness status.
- No QC, inventory, task, or database mutation was added in this pass.
- Updated `STRUCTURE.md`: QC Center is now 88%; inventory batch-level QC context is visible in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 2 material context cards render and no console errors.

## 2026-05-21 - React QC Center Checklist Template Polish

- QC template cards now show coverage status, usage count, pass rate, and failure/rework count.
- The templates tab uses existing QC record/template state only; no QC record or template mutation was added.
- Added stable smoke hooks for template cards and template stats.
- Updated `STRUCTURE.md`: QC Center is now 90%; QC checklist templates are polished in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 2 template cards, 2 template stats panels, and no console errors.

## 2026-05-21 - React QC Center SOP Recommendations

- QC records tab now shows read-only SOP improvement recommendations derived from failed/rework records, checklist gaps, weak template coverage, and material readiness.
- The panel does not create tasks, update SOPs, or mutate QC/database state.
- Added stable smoke hooks for the recommendations panel and recommendation cards.
- Updated `STRUCTURE.md`: QC Center is now 92%; SOP improvement recommendations are visible in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed the recommendations panel, 2 recommendation cards, records filters, and no console errors.

## 2026-05-21 - React QC Center Photo Evidence Placeholders

- QC record cards now show before/after photo evidence placeholders with status text based on QC record state.
- The photo slots are display-only; binary attachment persistence remains intentionally deferred until a safe storage path is added.
- Added stable smoke hooks for photo evidence cards and before/after slots.
- Updated `STRUCTURE.md`: QC Center is now 94%; before/after photo placeholders are visible in the React surface.
- Validation: `npm.cmd run build` passes; browser smoke on `http://127.0.0.1:5173` confirmed 2 photo evidence cards, 4 photo slots, the SOP recommendations panel, and no console errors.

## 2026-05-21 - React QC Center Rework Path QA and Task Link

- Rework tasks created from QC decisions now carry `linkedQcRecordId`, so Task Manager can trace the task back to the originating QC record.
- Added stable smoke hooks for QC record actions, decision confirmation, Task Manager cards, Task Manager totals, operational link count, and linked QC selector.
- Browser smoke from a fresh reload verified pending QC -> rework status, Task Manager total 5 -> 6, operational link count 1, and `linkedQcRecordId=qc-1`.
- Updated `STRUCTURE.md`: QC Center is now 96%; React rework task generation and Task Manager QC linking are verified.
- Validation: `npm.cmd run build` passes; browser smoke emitted no console errors.

## 2026-05-21 - Standalone Saif Personal Task HTML

- Corrected Saif's personal task board to a simple separate HTML file: `saif-tasks.html`.
- Removed the React `saif_tasks` page and sidebar integration.
- Removed search/filter scope from this personal board per Saif's correction.
- Do not recreate the removed React page or add search/filter unless Saif explicitly asks.
- The standalone file has quick manual entry, lightweight local AI-style command parsing, and simple new/doing/done columns.
- Tasks persist only in browser `localStorage`; no ERP database, Task Manager, Kanban, Command Center, or workflow data is mutated.
- Updated `STRUCTURE.md`: `saif-tasks.html` is documented as standalone personal HTML, not an ERP app page.
- Validation: `npm.cmd run build` passes after removing the React integration.

## 2026-05-21 - React Kanban QC Rework Visibility

- Added a read-only QC rework links panel to the React Kanban page.
- The panel reads Task Manager tasks that carry `linkedQcRecordId` and shows their originating QC record when available.
- The panel is visible even when no Kanban board is loaded from the backend, so QC rework visibility is not blocked by Kanban API state.
- No Kanban backend card creation or live database mutation was added.
- Updated `STRUCTURE.md`: Kanban-card QC visibility is now covered by a read-only React panel; safe attachment persistence remains the next QC decision point.
- Validation: `npm.cmd run build` passes; browser smoke confirmed the Kanban body shows `روابط إعادة عمل QC`, the panel exists in DOM, count renders, and no console errors are emitted.

---

## 2026-05-13 - Phase 3 Full System Polish + Permissions Foundation

- Added foundation-only users/roles/permissions under `omni.users`, `omni.roles`, and `omni.permissions` with manager, employee, and operator defaults. No page restrictions are enforced yet.
- Notification routing metadata now includes `targetUserId`, `targetRole`, and `targetName`; the dropdown includes a sound toggle and the system update log has expanded filters.
- Command Center now has a compact focus filter strip, system log shortcut, clearer request/purchase navigation, and remains the manager daily screen.
- Kanban board fit was polished for large screens with safer board height, horizontal scroll, compact KPI spacing, and clearer card title wrapping.
- Expenses and Income remain single-entry forms; setup actions were moved toward Admin Panel instead of staying in the recording forms.
- Admin Panel now shows setup-management foundation for departments, people/entities, expense categories, income sources, notification settings, and roles/permissions.
- Customers now have non-destructive company/shop/balance-direction fields and visible badges for `عليه`, `له`, and `متوازن`.
- Receipt remains the only multi-line item/table finance page.
- AI chat launcher is more active visually and its inline script brace issue was fixed.
- Validation: `node --check app.js` PASS; inline script parse PASS; local server returned 200. Manual browser QA remains partial.

---

## 2026-05-13 - Phase 2 Request Side Effects + Purchase Lifecycle

- Added administrative foundation for `omni.notifications`, `omni.systemLog`, `omni.requests`, and `omni.purchaseOrders` with safe non-destructive normalization.
- Added global notification bell/dropdown, unread count, mark-read actions, built-in notification sound, and system update log modal.
- Routed Inventory purchase requests and Employee UI leave/attendance-correction/advance requests to Command Center.
- Command Center now includes pending manager approval cards plus purchase tracking filters for active/pending/approved/ordered/partial/received states.
- Added idempotent approval side-effect dispatcher: approved leave writes manager-approved leave markers to existing Timesheet records; approved attendance correction preserves original times and writes corrected times with compatibility aliases; approved purchase creates a purchase order and Kanban procurement card.
- Receiving purchase orders updates actual material stock only on receive and preserves reservations.
- Inventory stock indicator is now a segmented stock meter instead of a battery visual.
- Global layout clipping was reduced by relaxing unsafe fixed page/content heights.
- Validation: `node --check app.js` PASS; local server returned 200. Browser automation was skipped because Playwright was unavailable.

---

## 2026-05-13 - Workflow Mouse UX + Inventory Battery + Admin Panel Foundation

- Workflow mouse UX polished: node click opens quick edit menu, drag has threshold, port connection is explicit, edge click opens toolbar, Escape cancels connection, and delete is limited to explicit controls/Delete key confirmation.
- Inventory now shows reservation-aware battery indicators beside available quantity.
- Added safe `admin_panel` page under OMNISYSTEM and non-destructive `omni.adminSettings` defaults.
- Validation: `node --check app.js` PASS; local server returned 200; Chrome CDP smoke checks passed for changed Workflow, Inventory, and Admin Panel surfaces.
- Remaining native popups are reported in locked/global payroll, finance, import, and destructive utility code and were not changed.

---

# 1. معلومات المشروع

| المفتاح | القيمة |
|---------|--------|
| المشروع | Octagon ERP / OMNISYSTEM V4.0 |
| النوع | Workshop Operating System — نظام تشغيل ورشة |
| اللغة | HTML + CSS + Vanilla JS (SPA) |
| الخادم | Node.js static server + JSON API (port 8080) |
| قاعدة البيانات | `database.json` (localStorage + file) |
| التشغيل | `node server.js` → `http://localhost:8080` |

---

# 2. هيكل الملفات

```
octagon-erp/
├── index.html          ← صفحة SPA الرئيسية (جميع الصفحات + المودالات + المفتش)
├── app.js              ← كل المنطق والحالة ووظائف الرسم (~9700+ سطر)
├── style.css           ← الأنماط الأساسية (~3400+ سطر)
├── server.js           ← خادم Node.js + JSON API
├── database.json       ← مخزن البيانات (الموظفين، المالية، omni)
├── HERE.md             ← سجل التسليم (المصدر)
├── STRUCTURE.md        ← هيكل الصفحات والحالة (المصدر)
├── CODEX_RUNBOOK.md    ← بروتوكول التطوير (المصدر)
├── README.md           ← معلومات عامة
├── hand over/
│   └── OCTAGON_MASTER_REFERENCE.md ← ★ هذا الملف ★
├── archive/            ← ملفات MD قديمة محفوظة
├── extra md/           ← وثائق التصميم الأصلية (01-15)
├── company/            ← ملفات هيكل الشركة
└── erp-local/          ← مشروع ERP منفصل (Vite + React)
```

---

# 3. القواعد الأساسية المطلقة

## ⛔ ممنوع — NEVER DO

1. **لا تمس الصفحات المقفلة** (Payroll + Finance) بدون إذن صريح من سيف
2. **لا تمسح database.json** أو تعيد تعيينه
3. **لا تعيد كتابة الملفات بالكامل** — فقط patches تدريجية
4. **لا تستخدم `prompt()` في المتصفح** — استخدم `showOmniModal()` أو `showOmniPrompt()`
5. **لا تزعم وجود ذكاء اصطناعي حقيقي** — الاقتراحات الذكية من بيانات النظام الحقيقية

## ✅ مطلوب — ALWAYS DO

1. شغّل `node --check app.js` بعد كل تعديل
2. حدّث هذا الملف مع التاريخ بعد كل جلسة عمل
3. استخدم normalize functions غير مدمرة لإضافة حقول جديدة
4. احفظ بـ `saveData()` بعد كل تغيير بيانات
5. اختبر أن الصفحات الأخرى لم تتأثر

---

# 4. سجل الصفحات — Page Registry

## القسم 1: الرواتب والموارد البشرية (مقفل 🔒)

| # | مفتاح الصفحة | الاسم | الاكتمال | الحالة |
|---|-------------|-------|---------|--------|
| 1 | `calculator` | الحاسبة الذكية | 100% | 🔒 LOCKED |
| 2 | `timesheet` | التايم شيت الذكي | 100% | 🔒 LOCKED |
| 3 | `calendar` | تقويم الدوام | 100% | 🔒 LOCKED |
| 4 | `import` | استيراد البيانات | 100% | 🔒 LOCKED |
| 5 | `employees` | الموظفين والأرصدة | 100% | 🔒 LOCKED |
| 6 | `report` | التقرير النهائي | 100% | 🔒 LOCKED |

## القسم 2: المالية (مقفل 🔒)

| # | مفتاح الصفحة | الاسم | الاكتمال | الحالة |
|---|-------------|-------|---------|--------|
| 7 | `finance` | الداشبورد المالي | 96% | 🔒 LOCKED |
| 8 | `cashbox` | قاصة الورشة | 98% | 🔒 LOCKED |
| 9 | `expenses` | المصروفات | 96% | 🔒 LOCKED |
| 10 | `income` | الواردات | 96% | 🔒 LOCKED |
| 11 | `customers` | أرصدة العملاء | 92% | 🔒 LOCKED |
| 12 | `receipt` | إنشاء وصل | 94% | 🔒 LOCKED |

## القسم 3: OMNISYSTEM V4.0 (مفتوح 🟢)

| # | مفتاح الصفحة | الاسم | الاكتمال | الحالة |
|---|-------------|-------|---------|--------|
| 13 | `command_center` | مركز القيادة | 90% | 🟢 OPEN |
| 14 | `kanban` | اللوحة التنفيذية | 90% | 🟢 OPEN |
| 15 | `workflow` | مصمم العمليات | 94% | 🟢 OPEN |
<!-- 2026-05-13 - Fix: Comprehensive Workflow Test Example
Completed: guarded `مثال فحص شامل` CTA, empty-canvas CTA, comprehensive production demo builder, append/replace modal flow, 14 Arabic workflow nodes, 16 labeled normal/success/failure/rework routes, auto-linking to existing SOP/machine/material/op-pack/QC template data, post-load summary modal, template integration, and inventory success/failure ports for material branching.
Partial: manual browser QA remains. Next: load the demo in append/replace modes, validate, inspect links, publish-gate, and verify fit/minimap/curved edges. -->
| 16 | `op_packs` | باقات العمليات | 82% | 🟢 OPEN |
| 17 | `task_manager` | إدارة المهام | 99% | 🟢 OPEN |
| 18 | `sop` | مكتبة SOP | 90% | 🟢 OPEN |
| 19 | `machines` | المكائن | 86% | 🟢 OPEN |
| 20 | `inventory` | المخزون والمواد | 78% | 🟢 OPEN |
| 21 | `qc_center` | مركز الجودة | 96% | 🟢 OPEN |
| 22 | `analytics` | التحليلات والذكاء التشغيلي | 88% | 🟢 OPEN |
| 23 | `employee_ui` | لوحة الموظف | 75% | 🟢 OPEN |

---

# 5. السلسلة التشغيلية — Operational Chain

```
Order → Workflow → Operation Pack → SOP → Task → Machine → Material → QC → Cost → Delivery
```

كل ميزة جديدة يجب أن ترتبط بهذه السلسلة.

---

# 6. خريطة البيانات — Data Persistence

| كائن البيانات | المفتاح | ملاحظة |
|-------------|--------|--------|
| `employees` | `employees` | مقفل |
| `finance` | `finance` | مقفل |
| `omni.kanban` | columns + cards | مع حقول الربط الكاملة |
| `omni.workflow` | nodes + edges | مع حقول الربط الموسعة |
| `omni.taskManager` | spaces/depts/sections/types/tasks | مع حقول الربط |
| `omni.sops` | مكتبة SOP V2 | 35+ حقل |
| `omni.machines` | المكائن + الطابور | |
| `omni.materials` | المواد + الحجوزات | |
| `omni.opPacks` | باقات العمليات + الخطوات | |
| `omni.qcRecords` | سجلات الجودة | |
| `omni.orders` | الطلبات | |
| `omni.employeeRequests` | طلبات الموظفين (إجازة، سلفة، كشف حساب) | جديد 2026-05-13 |
| `omni.employeeAttendance` | بصمات الحضور | جديد 2026-05-13 |
| `omni.departments` | الأقسام والفروع | |

---

# 7. نظام المودال — Omni Modal Engine

> تم بتاريخ: 2026-05-12

تم استبدال جميع استدعاءات `prompt()` بنظام مودال داخلي:

```javascript
showOmniModal(title, htmlContent, onConfirmCallback) → Promise
showOmniPrompt(message, defaultValue) → Promise<string>
```

**القاعدة:** لا تستخدم `prompt()` أبداً — استخدم `showOmniModal` أو `showOmniPrompt`.

---

# 8. بروتوكول العمل لكل جلسة

```
1. اقرأ هذا الملف أولاً
2. حدد المهمة ذات الأولوية القصوى
3. طبّق patches صغيرة وآمنة
4. شغّل node --check app.js
5. حدّث هذا الملف مع التاريخ
6. اكتب نقطة الاستئناف بالضبط
7. توقف فقط بعد أن يكون المشروع نظيفاً وقابلاً للاستئناف
```

---

# 9. Normalize Functions الحالية

هذه الوظائف تعمل عند كل `ensureOmni()` وتضيف حقول جديدة بدون مسح البيانات القديمة:

| الوظيفة | الغرض |
|---------|-------|
| `normalizeOmniLinks()` | حقول ربط البطاقات/المهام |
| `normalizeSops()` | ترقية SOP لمخطط V2 |
| `normalizeWorkflowNodes()` | حقول موسعة لعقد سير العمل |
| `workflow_designer_v2` | منافذ وروابط وعلاقات مصمم العمليات V2 |
| `normalizeOperationPackSteps()` | معرفات وروابط خطوات باقات العمليات |
| `normalizeMachineQueues()` | مصفوفات طابور المكائن |
| `normalizeMaterialReservations()` | حقول حجز المواد |
| `normalizeOmniDepartments()` | أقسام الورشة |
| `normalizeKanbanCardUx()` | ألوان وتعيينات بطاقات كانبان |
| `kanban_executive_board_v2` | ترقية غير مدمرة لحقول بطاقات اللوحة التنفيذية |
| `normalizeEmployeePortalData()` | طلبات الموظفين وسجل الحضور |

---

# 10. سجل التطوير الزمني — Development Timeline

## 2026-04-05 — الأساس
- إنشاء المشروع الأول: حاسبة الرواتب
- HTML + CSS + JS أساسي

## 2026-04-07 — نظام ERP
- بناء نظام المالية (المصروفات، الواردات، القاصة، العملاء)
- إضافة صفحة الموظفين

## 2026-04-09 — OMNISYSTEM V3
- إضافة 11 صفحة OMNISYSTEM (كانبان، سير العمل، SOP، المكائن، المخزون...)
- بناء نظام sidebar متعدد المجموعات

## 2026-04-12 — التوثيق
- إنشاء ملفات التوثيق 01-15 (الآن في archive/)
- إنشاء FULL_PRODUCT_DOCUMENTATION.md (الآن في archive/)

## 2026-04-15 — استقرار
- إصلاح CSS ومشاكل التخطيط
- تأكيد عمل جميع الصفحات

## 2026-05-05 — Sprint 7: مراجعة الرواتب والمالية
- مزامنة الراتب الاسمي بين الحاسبة والموظف
- إضافة ملخص الرواتب النهائي في التايم شيت
- إضافة التفاصيل المالية اليومية في التقويم
- تحسين صفحة الموظفين (حالة النشاط، الترتيب، الفلتر)
- إضافة إدارة الوصولات مع العملاء
- إضافة KPIs مالية

## 2026-05-10 — Sprint 8: تحسين UX
- إضافة مجموعات الشريط الجانبي القابلة للطي
- بناء مركز القيادة مع اقتراحات ذكية من بيانات حقيقية
- إضافة ألوان بطاقات كانبان ومفتش جانبي
- إضافة ربط مباشر (SOP، مكائن، مواد) من المفتش

## 2026-05-11 — Sprint 9: تلميع المالية
- تحسين الموظفين: فلتر النشاط، الترتيب، حفظ الأيقونة
- تحسين القاصة: تنقل التاريخ (سابق/تالي/اليوم)
- تحرير المصروفات/الواردات بنفس السجل بدون تكرار
- تحسين الوصولات: بنود المبيعات، المدفوع/المتبقي
- إضافة ملخص التقرير الذكي

## 2026-05-11 — Sprint 10: هندسة مساحة العمل المتصلة
- بناء محرر خطوات باقات العمليات (CRUD كامل)
- إضافة مركز صحة النظام (validateOmniIntegrity)
- تحسين محاكاة سير العمل مع نموذج مفصل
- إضافة لوحة الروابط العكسية (Relations) في المفتشات
- إضافة عرض جدولي بديل لكانبان ومدير المهام

## 2026-05-12 — Omni Modal Engine
- بناء محرك المودال الداخلي (`showOmniModal`, `showOmniPrompt`)
- استبدال 60+ استدعاء `prompt()` بمودالات داخلية
- إصلاح CSS لأزرار الأدوات (flex-wrap)

## 2026-05-13 — Sprint: لوحة الموظف العملية
- تصميم لوحة الموظف الكاملة: 6 بطاقات + شريط الحالة
- بصمة اليوم، مهامي، راتبي/سلفي، طلبات، موافقة المدير
- إصلاح قوائم الاختيار + تنظيف ملفات MD

## 2026-05-13 — Sprint: Kanban Executive Board V2
- large-screen Kanban layout with sticky toolbar, horizontal board grid, WIP counters, empty states, and scoped V2 CSS classes.
- Board health KPIs: total cards, active, overdue, critical, no assignee, missing materials, machine pressure, and health score/status.
- Department workload, employee workload, and machine pressure panels with clickable filters.
- Advanced filters: search, assignee, priority, department, machine, status, risk, due date, QC, and SOP.
- Card V2 design with operational indicators for SOP, machine, materials, QC, comments, attachments, cost, readiness, age, and risk.
- Card risk engine, column stats, board/list/workload views, big-screen toggle, density toggle, inspector V2 summary, and quick actions.
- Partial: manual browser QA and full tab-by-tab inspector polish remain.

## 2026-05-13 — Sprint: Workflow Designer Finalization / n8n-Style Workflow V2
- Arabic UI cleanup for Workflow header, actions, palette, inspector, validation, publish, preview, and templates.
- Zoom/pan/fit/reset canvas navigation with persisted `workflow_viewport_v1`.
- Consistent Bezier edges using source/target ports plus selected/warning states and wide hitboxes.
- Node ports for input/output/success/failure/rework with safe click-to-connect behavior.
- Auto layout, snap/grid controls, minimap, keyboard shortcuts, and memory-only undo/redo foundation.
- Background entity links for SOP, machine, operation pack, Kanban card, QC, order, department/branch, plus relations/backlinks panel.
- Deep validation engine, publish gating/metadata, execution preview, and Arabic workflow templates.
- Partial: manual browser QA remains for canvas interactions.

## 2026-05-13 — Sprint: Task Manager V2 / ClickUp-Style Work OS
- Clarified Task Manager as the internal work/task database: Workflow = method, Kanban = daily execution, Task Manager = responsibilities.
- Added non-destructive `task_manager_v2` normalization for task status, priority, assignees, departments/lists/categories, operational links, dependencies, recurring metadata, comments, activity, archive/delete safety.
- Added views: list, board, table, workload, overdue, and my tasks.
- Added filters for search, department, assignee/unassigned, status, priority, due state, Kanban/SOP/QC links.
- Added Task Inspector V2 tabs: overview, Checklist, links, SOP, machine, materials, QC, comments, activity, dependencies.
- Added Kanban integration helpers: create card from task, link existing card, open linked card, and sync foundations.
- Added Workflow, Operation Pack, QC/Rework, SOP, Machine, Material, QC record, Employee UI, recurring, dependency, workload, archive/delete helper foundations.
- Added scoped Task Manager V2 styles.
- Completion: `task_manager` is now estimated at 78%.
- Partial: manual browser QA remains; optional Operation Pack task generation checkbox is not wired yet.

## 2026-05-13 — Sprint: QC Center Full Control System
- Added non-destructive `qc_center_v2` normalization for QC records, source links, checklists, severity, machine/material/SOP context, rework fields, cost, attachments/photos, notes, and activity.
- Added default Arabic QC templates and helpers to create, update, delete, and apply templates.
- Added rule-based mandatory QC settings for delivery, operation cards, machine cards, high priority, operation pack execution, and failed-QC delivery blocking.
- Added Kanban QC integration: QC status helper, records-by-card helper, create-QC-from-card helper, and completion gating.
- Added Workflow QC node helpers and Operation Pack QC field normalization plus generated Kanban cards carrying `requiresQc`, `qcTemplateId`, and `qcCriteria`.
- Added SOP QC criteria reuse and SOP quality-problem detection.
- Added machine/material QC context capture from Kanban cards, workflow nodes, and operation pack steps.
- Added Rework automation that creates linked Kanban Rework cards and avoids duplicates.
- Added QC Center V2 UI with KPIs, tabs, dashboard, records, rework, templates, SOP problems, stats, and settings.
- Added QC record inspector tabs for overview, checklist, source, SOP, machine, materials, rework, cost, and activity.
- Added Command Center QC alerts and Analytics QC helper functions.
- Initial completion: `qc_center` was estimated at 82% after this sprint; follow-up React polish has since raised it to 96%.
- Remaining polish: safe attachment persistence remains future work; Kanban QC visibility is read-only unless backend card creation is explicitly requested.

## 2026-05-13 — Fix: Restore Analytics Visual Snapshot Bars
- Restored the classic Analytics visual snapshot section as `لقطة تشغيلية مباشرة`.
- Restored/enhanced task distribution bars, machine pressure bars, and employee workload/performance bars.
- Added department pressure bars for department/section/branch workload.
- Kept smart KPI cards and smart recommendations from the newer Analytics intelligence layer.
- Added `عرض مختصر`, `عرض تفصيلي`, and `عرض شاشة كبيرة` modes with localStorage persistence.
- Analytics remains read-only and does not mutate operational data.
- Completion: `analytics` is now estimated at 88%.
- Partial: manual browser QA and historical trend bars remain future work.

## 2026-05-13 — Sprint: Analytics Intelligence Brain ★ الأحدث
- **9 تبويبات ذكية**: نظرة اليوم، الأقسام، الموظفين، المكائن، التأخير، المواد، الجودة، الكلفة، التوقعات
- **8 بطاقات KPI**: صحة التشغيل، مهام مفتوحة، متأخرة، مكائن متوقفة، مواد في خطر، نسبة الجودة، موظفين مضغوطين
- **فلتر تاريخ**: اليوم / 7 أيام / 30 يوم / هذا الشهر / كل البيانات
- **ضغط الأقسام**: جدول كامل مع أشرطة تحميل وشارات حالة
- **ضغط الموظفين**: مهام مفتوحة/متأخرة/عاجلة + نسبة الإنجاز
- **ذكاء المكائن**: طابور، دقائق منتظرة، بطاقات مرتبطة، تقييم الضغط
- **تحليل التأخير**: مهام متأخرة + عالقة + بدون موعد/مسؤول
- **مخاطر المواد**: مخزون/محجوز/متوفر/مطلوب/نقص + شارة خطورة
- **تحليل الجودة و SOP**: نسبة النجاح، أسباب الفشل، SOPs المشكلة
- **الكلفة والربحية**: إجمالي الكلفة حسب القسم ونوع العمل
- **توقعات تشغيلية**: تنبيهات مبنية على بيانات حقيقية (ليست AI)
- **اقتراحات ذكية**: إعادة توزيع، شراء مواد، مراجعة SOP...
- **تصدير/طباعة**: لقطة تحليلات للطباعة

---

# 11. الأولويات التالية — What To Do Next

1. ✅ ~~لوحة الموظف~~ (تم 2026-05-13)
2. ✅ ~~التحليلات والذكاء التشغيلي~~ (تم 2026-05-13)
3. 🔲 اختبار Workflow Designer V2 في المتصفح على شاشة كبيرة
4. 🔲 اختبار Kanban Executive Board V2 في المتصفح على شاشة كبيرة
5. 🔲 إضافة ويدجت طلبات الموظفين المعلقة في مركز القيادة
6. 🔲 ربط توصيات التحليلات في مركز القيادة
7. 🔲 وضع الموظف فقط (إخفاء القوائم الإدارية)
8. 🔲 تحسين مدير المهام (حذف، فلاتر، مفتش)
9. 🔲 نظام إشعارات الموظف
10. 🔲 QC → Rework أوتوماتيكي كامل
11. 🔲 طباعة/تصدير SOP
12. 🔲 Backend حقيقي (PostgreSQL + FastAPI)

---

# 12. قواعد الأمان — Safety Rules

| القاعدة | التفصيل |
|---------|---------|
| الصفحات المقفلة | لا تُعدَّل إلا بإذن صريح من سيف |
| database.json | لا يُمسح أبداً |
| طلبات الموظفين | لا تؤثر مباشرة على الرواتب/المالية حتى الموافقة |
| كشف الراتب الكامل | يتطلب موافقة المسؤول |
| تصحيح البصمة | طلب فقط، ليس تعديل مباشر |
| المعاملات المالية المحررة | تُحدّث نفس السجل ولا تُنشئ تكرار |
| ترحيل الوصولات | محمي بمعرف المصدر لمنع التكرار |
| اقتراحات مركز القيادة | من بيانات حقيقية، ليست AI حقيقي |
| CSS | استخدم classes مخصصة فقط، لا تعدّل `.card .btn .page` العامة |

---

# 13. نقطة الاستئناف الحالية — Current Resume Point

> **التاريخ:** 2026-05-13 بعد Sprint Workflow Designer Finalization / n8n-Style Workflow V2
>
> **آخر فحص:** `node --check app.js` → ✅ PASS
>
> **الخطوة التالية:**
> 1. اختبار متصفح لمصمم العمليات على شاشة كبيرة: zoom/pan، ports، edge selection/delete، auto-layout، minimap، templates، validation، publish
> 2. إصلاح أي overflow أو مشاكل تفاعل في canvas أو inspector
> 3. اختبار الصفحات المرتبطة سريعاً: Kanban، SOP، Machines، Inventory، QC، Command Center
> 4. بعد ذلك اختبار Kanban Executive Board V2 في المتصفح
