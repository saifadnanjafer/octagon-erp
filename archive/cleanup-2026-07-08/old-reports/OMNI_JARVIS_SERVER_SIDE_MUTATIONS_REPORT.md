# OMNI_JARVIS_SERVER_SIDE_MUTATIONS_REPORT.md

## 1. Summary

تم نقل مسار أدوات Jarvis/Omni الكاتبة من تنفيذ المتصفح إلى تنفيذ الخادم عبر `server-jarvis-tools.js` و`POST /api/jarvis/action` و`POST /api/jarvis/execute-approved`.

النتيجة الحالية:

- أدوات الكتابة المتوسطة مثل `create_task` و`create_customer` تنفذ مباشرة على الخادم وتعيد تحديث الواجهة من `GET /api/db`.
- أدوات المالية/المخزون/الموظفين عالية الخطورة تنشئ موافقة server-side أولاً، ولا تنفذ إلا عبر `POST /api/jarvis/execute-approved`.
- `execute-approved` يستخدم الحجج المحفوظة داخل سجل الموافقة، وليس الحجج التي يرسلها المتصفح وقت التنفيذ، لذلك تبديل المبلغ أو النص بعد الموافقة لا يعمل.
- `execute_js_mutation` لم يعد ينفذ. الخادم يرفضه حتى بعد الموافقة ما لم يتم فتح متغير بيئة خاص، وبوجود المنفذ الحالي هو مرفوض أيضاً.
- الأدوات غير المعروفة أصبحت `denied` فوراً ولا تنشئ سجل موافقة وهمي.

## 2. Files Changed

| File | Change | Reason |
|---|---|---|
| `server-jarvis-tools.js` | Registry server-side يحتوي `getServerJarvisTool()`, `listServerJarvisTools()`, `executeServerJarvisTool()` ومنفذات أدوات الكتابة | تنفيذ الطفرات على الخادم ضد قاعدة البيانات الحقيقية |
| `server-jarvis-security.js` | ربط executor registry، تنفيذ الأدوات الآمنة/المتوسطة على الخادم، إنشاء موافقات للأدوات العالية، تنفيذ الموافقات server-side، رفض unknown tools، ودعم `OCTAGON_JARVIS_APPROVALS_FILE` / `OCTAGON_JARVIS_AUDIT_LOG_FILE` للاختبار | إغلاق مسار grant-to-client للأدوات الكاتبة ومنع تبديل الحجج |
| `modules/jarvis-brain.js` | أدوات `SERVER_ENFORCED_TOOLS` أصبحت wrappers فقط تستدعي `/api/jarvis/action` ثم `refreshServerState()` من `/api/db` | المتصفح يطلب فقط ولا يكتب persistent business data عبر أدوات Jarvis |
| `modules/ai-governance.js` | `executeApprovedAiAction()` يستدعي `/api/jarvis/execute-approved` للأدوات server-enforced، وتمت محاذاة مخاطر أدوات المالية مع server gate | منع تنفيذ الموافقات محلياً وتصحيح صلاحيات المدير |
| `scripts/jarvis-server-side-mutations-smoke.mjs` | Smoke harness يعزل قاعدة البيانات وملفات الموافقات/audit في temp paths | اختبار السبرنت بدون لمس `database.json` أو `database.db` |
| `OMNI_JARVIS_SERVER_SIDE_MUTATIONS_REPORT.md` | هذا التقرير | توثيق الخريطة والنتائج والمخاطر المتبقية |

## 3. Mutation Map

| Tool | Before | After | Persistent Target | Risk | Moved Server-Side? |
|---|---|---|---|---|---|
| `create_task` | `modules/jarvis-brain.js` كان ينادي `window.createTaskInSelectedSpace()` ثم `saveData()` | `server-jarvis-tools.js` ينشئ المهمة ويعمل `saveDb()` | `db.omni.taskManager...tasks[]` | medium | Yes |
| `create_customer` | client finance object ثم save | server executor ينشئ العميل | `db.finance.customers[]` | medium | Yes |
| `add_customer_debt` | client `ensureFinance()` / `addFinanceTransaction()` | approval ثم server executor | `db.finance.customers[]`, `db.finance.transactions[]` | high | Yes |
| `record_customer_payment` | client finance transaction | approval ثم server executor | `db.finance.transactions[]` | high | Yes |
| `create_purchase_expense` | client finance transaction | approval ثم server executor | `db.finance.transactions[]` | high | Yes |
| `create_sales_receipt` | client sales/income transaction | approval ثم server executor | `db.finance.customers[]`, `db.finance.transactions[]` | high | Yes |
| `create_journal_entry` | client كان يستطيع الوصول لمنطق ledger بعد الموافقة | server يتحقق من التوازن ثم يضيف إلى `omni.aiPendingJournalEntries` فقط | `db.omni.aiPendingJournalEntries[]` | high | Partial: quarantined |
| `modify_material` | client يعدل `omni.materials` ثم save | approval ثم server executor بتحديث whitelist فقط | `db.omni.materials[]` | high | Yes |
| `modify_employee` | client يعدل employee object ثم save | approval ثم server executor بتحديث whitelist فقط | `db.employees[]` | high | Yes |
| `execute_js_mutation` | arbitrary browser JS بعد موافقة | server refuses | arbitrary browser/server state | critical | Disabled |
| `click_ui` | browser DOM click | unchanged for safe UI actions; sensitive clicks remain approval-gated but DOM execution is not server-side | contextual UI state | contextual | Remaining risk |

## 4. Server Tool Registry

`server-jarvis-tools.js` هو مكان التنفيذ الفعلي:

- `getServerJarvisTool(toolName)` يرجع تعريف الأداة إن كانت مدعومة server-side.
- `listServerJarvisTools()` يعرض أسماء الأدوات.
- `executeServerJarvisTool(toolName, args, context)` يحمل DB عبر `loadDbForMutation()`, ينفذ الأداة، ثم يحفظ عبر `saveDb()`.

الخادم يولد `id`, `createdAt`, `date`, `status`, وmetadata بنفسه. الحقول القادمة من العميل مثل id/status/user/risk لا يتم الوثوق بها.

## 5. Updated Action Flow

`User -> Client Wrapper -> POST /api/jarvis/action -> server gate -> server executor -> audit -> UI refresh`

تفصيل المسار:

1. `window.JarvisBrain.tools.<tool>.run(args)` للأدوات الكاتبة لا ينفذ mutation.
2. wrapper يرسل `tool` و`args` إلى `/api/jarvis/action`.
3. `serverGateTool()` يحدد risk من جدول server-side فقط.
4. `create_task` و`create_customer` تنفذ فوراً server-side.
5. الأدوات العالية ترجع `status: "approval_required"` مع `approvalId`.
6. بعد `status: "executed"`، العميل ينادي `refreshServerState(tool)` ويقرأ `/api/db`.

## 6. Approval Execution Flow

`Manager approve -> POST /api/jarvis/execute-approved -> reload approval -> re-check role -> re-check policy -> execute server tool -> mark executed -> audit`

المهم:

- `execute-approved` لا يرجع `grantId` للأدوات الكاتبة.
- عند وجود `approvalId`، الخادم يستخدم `record.args` المخزنة وقت طلب الموافقة.
- `payload.args` في طلب التنفيذ يتم تجاهلها لمنع arg swapping.
- السجل يتحول إلى `executed` قبل التنفيذ لمنع double execution، ثم يرجع إلى `approved` فقط إذا فشل executor القابل لإعادة المحاولة.

## 7. Client-Side Bypass Result

النتيجة المثبتة:

- النداء المباشر مثل `window.JarvisBrain.tools.create_journal_entry.run(...)` لا يكتب في المتصفح؛ هو wrapper يطلب `/api/jarvis/action`.
- إذا الخادم غير متاح، wrapper يرجع fail-closed برسالة `Server gate unreachable`.
- `create_journal_entry` لا يضيف أي قيد عند طلب الموافقة. بعد الموافقة يضيف فقط pending journal entry في `omni.aiPendingJournalEntries` ولا يرحل إلى ledger.
- `execute_js_mutation` مرفوض ولا ينفذ JS.

## 8. Smoke Test Results

تم تشغيل:

```bash
node --check server-jarvis-security.js
node --check server-jarvis-tools.js
node --check modules/jarvis-brain.js
node --check modules/ai-governance.js
node --check scripts/jarvis-server-side-mutations-smoke.mjs
node scripts/jarvis-server-side-mutations-smoke.mjs
```

نتيجة smoke:

| Test | Result |
|---|---|
| Unknown tool fails closed | PASS |
| Unknown tool did not create approval | PASS |
| Read-only tool still receives safe grant | PASS |
| `create_task` executes server-side | PASS |
| `create_task` persisted through server DB | PASS |
| `create_customer` executes server-side | PASS |
| `create_customer` persisted through server DB | PASS |
| Dangerous finance action returns `approval_required` | PASS |
| Approval request did not mutate finance records | PASS |
| Approval record can be approved server-side | PASS |
| Approved finance action executes server-side | PASS |
| Approved args are immutable against execute-time swapping | PASS |
| Approved action cannot execute twice | PASS |
| Critical JS mutation is not executed by approval path | PASS |
| Client write wrappers fail closed when server unavailable | PASS |
| Client refreshes state from real DB after server mutation | PASS |
| Approved UI path calls `execute-approved` | PASS |
| Audit log includes `requested` | PASS |
| Audit log includes `approval_queued` | PASS |
| Audit log includes `approved` | PASS |
| Audit log includes `executed` | PASS |
| Audit log includes `denied` | PASS |

Final: `22/22 passed`.

## 9. Remaining Risks

- `window.omni`, `finance`, و`employees` ما زالت live browser caches. أدوات Jarvis الكاتبة لم تعد تكتبها مباشرة، لكن raw console يمكنه تغيير الذاكرة المحلية.
- `saveData()` و`POST /api/db` ما زالا مسار حفظ واسع للتطبيق كله. الخادم يحميهما بجلسة/local-dev، لكنهما خارج نطاق أداة Jarvis المحددة.
- كثير من modules القديمة تستخدم `saveData()` مباشرة كجزء من UI الطبيعي. هذا ليس bypass خاص بـ Jarvis، لكنه يعني أن تحويل كل ERP إلى APIs دقيقة يحتاج سبرنت أكبر.
- `click_ui` لا يمكن تنفيذه server-side لأنه DOM action. النقرات الحساسة محكومة بالموافقة، لكن تنفيذ DOM نفسه يبقى في المتصفح.
- `create_journal_entry` حالياً quarantined في `omni.aiPendingJournalEntries` وليس posted إلى `account_moves`; هذا مقصود حتى لا نكسر hash chain/ledger sequence.
- auth في local-dev يسمح `system.admin` على localhost. في الإنتاج يجب ضبط `NODE_ENV=production` أو `OCTAGON_PRODUCTION=true`.
- أي JS قديم مخزن في cache/deployed client قد يبقى يعمل حتى إعادة تحميل الصفحة بدون cache.

## 10. Next Sprint Recommendation

بعد نجاح هذا السبرنت، الترتيب الصحيح:

1. Enriched snapshot.
2. KB RAG grounding.
3. Post-execution read-back verification.
4. Durable memory.
5. DOM reader hardening.

قبل RAG أو memory، الأفضل سبرنت صغير إضافي: تحويل `click_ui` للأزرار الحساسة إلى allowlist server-declared actions أو تعطيل تنفيذها من approval queue إذا كانت تمس finance/payroll/settings.
