# OMNI JARVIS ENRICHED SNAPSHOT REPORT

## 1. Summary
يقوم التحديث الجديد بتزويد المساعد الذكي "Jarvis / أومني" بسياق بيانات أغنى يعكس الحالة الفعلية للنظام بدلاً من مجرد أرقام وحسابات بسيطة. تم نقل بناء اللقطة (Snapshot) إلى جهة الخادم (Server-Side) لمنع التلاعب وتوفير بيانات محددة وهيكلية مثل المهام المتأخرة، وضع المخزون، وملخص المالية والموافقات.

## 2. Files Changed
| File | Change | Reason |
|---|---|---|
| `server-jarvis-snapshot.js` | `[NEW]` | Contains server-side generation logic, limits, and redactions. |
| `server-jarvis-security.js` | `[MODIFY]` | Added `GET /api/jarvis/snapshot` endpoint, secured with session requirements. |
| `modules/jarvis-brain.js` | `[MODIFY]` | Updated turn flow to fetch snapshot asynchronously before LLM planning. |

## 3. Snapshot Architecture
تم بناء اللقطة عبر مسار مخصص في `server-jarvis-security.js` يتم استدعاؤه قبل تفكير LLM. يقوم الملف الجديد `server-jarvis-snapshot.js` بتجميع ملخص للموديلات (Modules) المطلوبة وتصغير حجم القوائم (Truncation) وإخفاء الحقول الحساسة (Redaction).
- **السرية**: يتم فلترة أي مفتاح يحتوي على "password" أو "secret" أو "apikey" تلقائياً واستبدال قيمته بـ `[REDACTED]`.
- **الحدود**: يعتمد حجم القوائم على خيارات `scope` لضمان عدم تجاوز حدود الذاكرة الخاصة بالموديل الذكي.

## 4. Snapshot Schema
الشكل الهيكلي لبيانات اللقطة:
```json
{
  "generatedAt": "2026-07-05T01:50:00.000Z",
  "scope": "standard",
  "system": {
    "mode": "production",
    "serverEnforcedTools": ["add_customer_debt", "..."]
  },
  "business": {
    "employees": 12,
    "materials": 45,
    "customers": 80,
    "tasks": 20,
    "pendingApprovals": 3
  },
  "limitations": [
    "Data is truncated to fit context limits.",
    "Never invent records that are not in this snapshot."
  ],
  "alerts": [
    "2 overdue tasks.",
    "5 items have low stock."
  ],
  "finance": {},
  "tasks": {},
  "inventory": {},
  "employees": {},
  "approvals": {}
}
```

## 5. Module Coverage
| Module | Included Fields | Status | Limitations |
|---|---|---|---|
| Finance | Customers, top debtors, recent account moves | Active | Detailed journal lines not included |
| Tasks | Total, open, overdue, recent overdue tasks | Active | Limited by `scope` limit |
| Customers | Top debtors | Active | General info is limited |
| Employees | Total, active, recent | Active | No personal secrets or raw payroll rules included |
| Inventory | Total, low stock items, low stock counts | Active | Full catalog is truncated |
| Approvals | Pending count, recent pending requests | Active | Only high-level targets included |
| Alerts | Overdue tasks, low stock, pending approvals | Active | Only top 3 alerts currently generated |

## 6. Jarvis Integration
تم تحديث مسار `handle()` داخل `jarvis-brain.js` لكي يجلب اللقطة من الخادم بناءً على نوع الطلب. إذا كان الطلب استفساراً عميقاً يتم طلب `scope=standard` أو `deep`. بعدها تُمرر هذه اللقطة إلى `buildPlannerPrompt()` لكي تصبح جزءاً من `system_prompt` للموديل أثناء خطوة التخطيط. 

## 7. Size and Redaction Rules
- تم إضافة نظام اقتطاع (`safeSlice`) لضمان عدم إرسال كامل جداول قواعد البيانات في الـ LLM Prompt.
- دالة `redactSnapshot()` تمر على الكائن وتقوم بتصفية مفاتيح الأمان والسرية وتستبدلها بـ `[REDACTED]`.
- دالة `estimateSnapshotSize()` تحمي النظام عبر إجبار النطاق `scope=brief` إذا تجاوز الحجم 100 كيلوبايت.

## 8. Smoke Test Results
- `jarvis-server-side-mutations-smoke.mjs`: **PASS** (22/22)
- `jarvis-click-ui-hardening-smoke.mjs`: **PASS** (24/24)
- `test-builder.js`: **PASS** (Validates builder output without routing/session).
- Snapshot API Route returns valid JSON and successfully rejects unauthenticated requests (Tested).

## 9. Remaining Risks
- بعض الموديلات لا تزال تمتلك بيانات تقريبية (`shallow`).
- المخطط لا يزال يعتمد على دقة `database.json` بدلاً من قواعد الـ SQLite القوية في بعض المواقف.
- لم يتم معالجة الرصيد التراكمي التاريخي بالكامل في اللقطة السريعة بسبب حجمه الضخم.
- هناك فرصة للتأخير الزمني إذا كان الخادم بطيئاً بسبب جلب اللقطة قبل التخطيط.

## 10. Next Sprint Recommendation
التوصيات للمرحلة القادمة:
1. **KB RAG grounding**: السماح لـ Jarvis بقراءة مقالات المعرفة والسياسات.
2. **Post-execution read-back verification**: تزويد Jarvis بلقطة ثانية بعد تنفيذ الأوامر للتأكد.
3. **Durable memory**: بناء ذاكرة دائمة للحوارات والملاحظات.
4. **DOM reader hardening**: تحسين قدرة الذكاء الاصطناعي على قراءة الشاشة وتحليل العناصر.
