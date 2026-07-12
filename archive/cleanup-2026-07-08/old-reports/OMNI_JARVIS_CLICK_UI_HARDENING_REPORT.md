# OMNI / JARVIS click_ui Hardening Report

تاريخ السبرنت: 2026-07-05

## 1. Summary

تم تضييق أداة `click_ui` بحيث لم تعد تضغط أزرار DOM بشكل عام من داخل المتصفح. المسار الجديد يرسل وصف النقرة إلى الخادم عبر `/api/jarvis/action`، والخادم يطبق السياسة الموجودة في `server-jarvis-ui-policy.js`، ثم يرجع `grantId` مؤقت فقط إذا كانت النقرة آمنة وموجودة في allowlist أو مطابقة لنمط آمن.

الأزرار الحساسة مثل `save`, `submit`, `delete`, `approve`, `reject`, `execute`, `post`, `payroll`, `journal`, `settings`, `permission`, وعمليات `import/restore/reset` تُرفض مباشرة. موافقة المدير لا تجعل `click_ui` خطراً قابلاً للتنفيذ؛ أي `click_ui` قديم داخل approval queue يعاد فحصه في `/api/jarvis/execute-approved` ويرفض كـ generic DOM click.

## 2. Files Changed

| File | Change | Reason |
|---|---|---|
| `server-jarvis-ui-policy.js` | إضافة سياسة server-side لتصنيف UI actions مع `classifyUiAction`, `isUiActionAllowed`, `listAllowedUiActions` | جعل الخادم هو مصدر القرار، وليس المتصفح |
| `server-jarvis-security.js` | ربط `click_ui` بالسياسة، إضافة `/api/jarvis/ui-policy`, رفض approved generic `click_ui`, وتسجيل audit | إغلاق bypass الموافقة وتسجيل كل قرار |
| `modules/jarvis-action-agent.js` | استبدال النقر المباشر بطلب server grant ثم `consume-grant` ثم `result` audit | منع المتصفح من self-classification |
| `modules/jarvis-brain.js` | تحديث أداة `click_ui` وإزالة queueApproval للنقرات الحساسة وإزالة raw `el.click()` fallback | الحسّاس يرفض ولا يدخل approval عام |
| `modules/ai-governance.js` | منع approved `click_ui` legacy من الرجوع إلى browser tool runner | موافقة المدير لا تنفذ DOM mutation عام |
| `scripts/jarvis-click-ui-hardening-smoke.mjs` | إضافة smoke test مستقل بقاعدة مؤقتة | إثبات السماح والرفض والتدقيق بدون لمس بيانات ERP الحية |

## 3. click_ui Before/After

قبل السبرنت:

- `click_ui` كان يبحث عن `[data-jarvis-action]` ثم عن أي زر ظاهر بالنص.
- إذا بدا الزر حساساً، كان يضيفه إلى approval queue كـ `payload.tool = "click_ui"`.
- بعد الموافقة، كان هناك خطر أن ينفذ المتصفح نفس `click_ui` كـ DOM click.
- `modules/jarvis-action-agent.js` كان يحتوي fallback يضغط أي عنصر مطابق لـ `[data-jarvis-action]`.

بعد السبرنت:

- `click_ui` لا يضغط قبل قرار الخادم.
- الخادم يصنف `action_id`, `label`, `selector`, `page`, `kind`, و `visible`.
- SAFE يحصل على `grantId` مؤقت ثم يستهلك عبر `/api/jarvis/consume-grant`.
- SENSITIVE و CRITICAL يرجعان `403 denied` مع الرسالة:
  `هذا الزر حساس ولا أقدر أضغطه كـ DOM click. استخدم أداة مخصصة/موافقة سيرفرية.`
- `approval` لا يجيز `click_ui`; إذا وصل `click_ui` إلى `/api/jarvis/execute-approved` يتم رفضه.

## 4. UI Risk Map

| Button / Action | Location | Risk | Current Behavior | New Behavior |
|---|---|---|---|---|
| Sidebar navigation `.nav-btn[data-page]` | `index.html` | SAFE | كان يمكن ضغطه بالنص أو selector | مسموح كـ `navigation` بعد server grant |
| `page.open.*` | `modules/jarvis-action-agent.js` / `modules/jarvis-brain.js` | SAFE | كان ينفذ مباشرة في المتصفح | مسموح بعد `/api/jarvis/action` |
| `tab:*`, `mrp.tab.*`, `qc.tab.*` | `modules/mrp.js`, `modules/page-qc.js` | SAFE | كان يضغط tagged button مباشرة | مسموح كـ `switch_tab` |
| `inventory.filter.low_stock` | `modules/jarvis-action-agent.js` | SAFE | كان ينفذ من registry | مسموح كـ `apply_filter` |
| `open-modal:create-task`, `open_task_modal` | policy allowlist | SAFE | لم يكن مفصولاً عن النقر العام | مسموح لفتح modal فقط |
| `work_orders.open_wizard` | `modules/work-orders.js` | SAFE | tagged action عام | مسموح كـ opener غير كاتب |
| `saveEmployeeData()` / `حفظ البيانات` | `app.js` | SENSITIVE | كان يمكن أن يطابقه النص ثم يذهب للموافقة | مرفوض كـ generic DOM click |
| `addExpenseFromForm()` / `تسجيل المصروف` | `views/expenses.html` | SENSITIVE | زر مالي يكتب عبر UI | مرفوض؛ يحتاج server-side finance tool |
| `approveOmniRequest()` / `rejectOmniRequest()` | `app.js` | SENSITIVE | approve/reject من UI | مرفوض كـ `click_ui` |
| `poDecideLeave()` / `poDecideExpense()` | `modules/people-ops.js` | SENSITIVE | HR/expense decision من DOM | مرفوض؛ يحتاج أداة مخصصة |
| `publishWorkflow()` / `triggerWorkflowExecution()` | `views/workflow.html`, `app.js` | SENSITIVE | publish/execute بالزر | مرفوض كـ generic click |
| `postJEFromUI()` / `saveNewJE()` | `app.js` | CRITICAL | journal draft/post من DOM | مرفوض؛ الترحيل يحتاج مسار محاسبي server-side |
| `wsClosePayrollPeriod()` / `wsPostPayrollAccrual()` / `wsPaySalary()` | `modules/workshop-ledger.js` | CRITICAL | payroll close/post/pay من DOM | مرفوض دائماً كـ `click_ui` |
| `importDataClick()` / `resetAllData()` | `index.html` | CRITICAL | restore/reset من DOM | مرفوض دائماً |
| Unknown `[data-jarvis-action]` مثل `work_orders.submit_wizard` | modules with tagged buttons | SENSITIVE | كان يضغط إذا وجد العنصر | fail closed حتى يضاف كأداة server-side أو allowlist آمن |
| Hidden target | أي view/module | CRITICAL | tagged hidden element could be selected by old collector | مرفوض إذا `visible=false`، والcollector صار يجمع visible فقط |

## 5. Allowlist

الأفعال المسموحة حالياً:

- `navigate_to_page`
- `open_panel`
- `switch_tab`
- `focus_search`
- `apply_filter`
- `open_task_modal`
- `open_customer_modal`
- `scroll_to_section`
- `page.open.*`
- `navigate:*`
- `tab:*`
- `filter:*`
- `search:*`
- `focus:*`
- `open-panel:*`
- `open-modal:*`
- `scroll:*`
- `mrp.tab.*`
- `qc.tab.*`
- `inventory.filter.low_stock`
- `work_orders.open_wizard`
- `work_orders.back_to_list`
- `work_orders.cancel_wizard`

أي `action_id` غير موجود في allowlist أو لا يطابق prefix آمن يفشل closed.

## 6. Denied Sensitive Actions

تم رفض هذه العائلات من خلال `server-jarvis-ui-policy.js`:

- `save`, `submit`, `delete`, `remove`
- `approve`, `reject`, `confirm`
- `post`, `execute`, `publish`, `unpublish`
- `pay`, `payroll`, `journal`, `ledger`
- `settings`, `permission`, `user`, `employee`
- `customer debt`, `payment`
- `import`, `restore`, `reset`, `wipe`, `delete all`
- `execute_js`, `javascript`, `eval`
- العربية: `حفظ`, `تقديم`, `تسجيل`, `حذف`, `إزالة`, `اعتماد`, `موافقة`, `رفض`, `ترحيل`, `تنفيذ`, `تشغيل`, `دفع`, `راتب`, `رواتب`, `قيد`, `صلاحية`, `إعدادات`, `استيراد`, `استعادة`, `تصفير`, `إغلاق الشهر`

## 7. Approval Rule

القاعدة الجديدة واضحة:

`approval` لا يحول `click_ui` إلى أداة آمنة.

إذا احتاجت عملية حساسة إلى التنفيذ، يجب تمثيلها كأداة محددة في الخادم مثل `create_sales_receipt`, `record_customer_payment`, `create_purchase_expense`, أو أداة جديدة مخصصة. لا يجوز تنفيذها كزر عام داخل DOM.

## 8. Smoke Test Results

تم تشغيل:

- `node --check server-jarvis-ui-policy.js` — PASS
- `node --check server-jarvis-security.js` — PASS
- `node --check modules/jarvis-action-agent.js` — PASS
- `node --check modules/jarvis-brain.js` — PASS
- `node --check modules/ai-governance.js` — PASS
- `node --check scripts/jarvis-click-ui-hardening-smoke.mjs` — PASS
- `node scripts\jarvis-click-ui-hardening-smoke.mjs` — `24/24 passed`
- `node scripts\jarvis-server-side-mutations-smoke.mjs` — `22/22 passed`

Smoke coverage:

- `click_ui` can navigate to a safe page — PASS
- `click_ui` can switch a safe tab — PASS
- `click_ui` can open a safe modal — PASS
- `click_ui` cannot click delete — PASS
- `click_ui` cannot click approve — PASS
- `click_ui` cannot click save/submit — PASS
- `click_ui` cannot click payroll finalization — PASS
- `click_ui` cannot click finance post/journal actions — PASS
- Unknown selector/action fails closed — PASS
- Approval does not allow sensitive generic DOM click — PASS
- Safe allowlisted action still works — PASS
- Denied and allowed `click_ui` decisions are logged — PASS

## 9. Remaining Risks

- Browser cache قد يبقي نسخة قديمة من `modules/jarvis-action-agent.js` أو `modules/jarvis-brain.js` إلى أن يتم hard refresh/cache bust.
- Raw console edits خارج Jarvis ما زالت خارج نطاق هذا السبرنت.
- Modules كثيرة ما زالت تستخدم `saveData()` مباشرة في UI العادي؛ هذا السبرنت يغلق `click_ui` وليس كل UI write path.
- `POST /api/db` ما زال route واسع وخطر إذا أسيء استخدامه في local/dev.
- بعض الأزرار الآمنة لم يتم وسمها بعد بـ `data-jarvis-action`; النص الآمن قد يعمل فقط إذا صنفه الخادم كـ safe label، والأفضل إضافة stable action ids.
- عمليات مثل `work_orders.submit_wizard`, `qc.add_record`, `mrp.run_mrp` رفضت أو ستُرفض كـ unknown/sensitive إلى أن تتحول إلى server-side tools أو allowlist مدروس.

## 10. Next Sprint Recommendation

الترتيب المقترح بعد هذا السبرنت:

1. Enriched snapshot
2. KB RAG grounding
3. Post-execution read-back verification
4. Durable memory
5. DOM reader hardening

قبل الانتقال لهذه البنود، الأفضل إضافة `data-jarvis-action` مستقر للأزرار الآمنة فقط، وتحويل أي زر حساس مطلوب فعلاً إلى أداة server-side باسم محدد بدلاً من `click_ui`.
