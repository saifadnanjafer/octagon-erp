# OMNI / JARVIS — SECURITY HARDENING REPORT
### Sprint: 2026-07-05 — Server-side gate + API key migration
> ينفّذ البندين الحرجين من تدقيق `OMNI_JARVIS_ARCHITECTURE_AUDIT.md`:
> **(A)** فرض بوابة الأدوات الخطرة على الخادم، **(B)** إخراج مفاتيح الـ API من كود العميل.
> لا ميزات جديدة — تقوية أمنية فقط. واجهة الدردشة والصوت الحالية لم تتغير سلوكياً للمستخدم المسجَّل.

---

## 1. Summary (الملخص)

قبل هذا السبرنت كانت المشكلة المزدوجة:
1. **البوابة كلها client-side**: أي شخص يفتح الـ console يقدر ينفّذ `window.JarvisBrain.tools.create_journal_entry.run(...)` ويقيّد قيداً مالياً حقيقياً متجاوزاً طابور الموافقة بالكامل.
2. **أربعة مفاتيح API حقيقية مكتوبة داخل كود العميل** (OpenRouter + ContactBox في `modules/ai-providers.js`، وGemini مكرر 6 مرات في `app.js`، وContactBox/Custom في `test-api.js` و`CUSTOM_API_SETUP.md`).

بعد السبرنت:
- كل أداة خطرة/كاتبة للبيانات تحتاج **تصريحاً أحادي الاستخدام (one-time grant) من الخادم** قبل أن يعمل منفّذها — والمنفّذ الحقيقي صار **خاصاً داخل closure** لا يُصدَّر إطلاقاً.
- الأدوات المحكومة (مالية/رواتب/مخزون/كود) تُنشئ **سجل موافقة server-side** ولا تُنفَّذ إلا بعد إعادة تحقق الخادم من الدور والسياسة وقت التنفيذ، مع **منع التنفيذ المزدوج**.
- **صفر مفاتيح في كود العميل**. كل نداءات الذكاء تمر عبر بروكسي الخادم (`/api/ai/chat` و`/api/ai/gemini`) الذي يقرأ المفاتيح من `.env` فقط، مع allowlist للمزوّد والموديل.
- سجل تدقيق مزدوج: `server-ai-audit.log` (JSONL append-only، محصّن ضد كتابات العميل على `/api/db`) + مرآة في `db.audit_log` عبر `appendServerAudit`.

---

## 2. Files Changed

| File | Change | Reason |
|---|---|---|
| `server-jarvis-security.js` | **NEW** — بوابة الأدوات server-side + طابور موافقات + تصاريح one-time + بروكسي AI + تدقيق | قلب السبرنت: PART 2/3/5/7 |
| `server.js` | 3 تعديلات صغيرة: `require('./server-jarvis-security')` + `jarvisSecurity.init({helpers})` + تفويض `/api/jarvis/*` و`/api/ai/*` أول الـ handler. وإصلاح `dotenv` ليقرأ `.env` من `__dirname` بدل `process.cwd()` | ربط الطبقة الجديدة بالبنية القائمة (`requireSession`/`appendServerAudit`)؛ إصلاح تحميل المفاتيح عند الإقلاع من مجلد مختلف |
| `modules/jarvis-brain.js` | كتلة `SERVER_ENFORCED_TOOLS` (10 أدوات): المنفّذات الحقيقية → `INTERNAL_RUNNERS` خاصة، و`.run()` المكشوفة صارت wrapper يطلب grant من `/api/jarvis/action`؛ `runApprovedTool()` + `isServerEnforced()` مُصدَّرة؛ `queueApproval()` يسجّل الموافقة server-side ويحفظ `serverApprovalId` | PART 4 — سد ثغرة الـ console bypass |
| `modules/ai-governance.js` | `executeApprovedAiAction()`: الأدوات المفروضة سيرفرياً تنفَّذ عبر `POST /api/jarvis/execute-approved` → grant → `JarvisBrain.runApprovedTool` (بدل نداء `run` المباشر الذي صار يعيد الطلب للطابور — كان سيصنع حلقة) | PART 3 — إعادة التحقق وقت التنفيذ |
| `modules/ai-providers.js` | حذف مفتاحي OpenRouter/ContactBox؛ `callOpenRouter`/`callContactBox` → `callAiProxy()` عبر `/api/ai/chat` (نفس التواقيع)؛ `scrubLeakedKeys()` ينظف المفاتيح المسربة القديمة من localStorage؛ تحديث تعليق الرأس؛ إزالة شرط "وجود مفتاح" من `chat()` | PART 5 — العميل بلا مفاتيح وبلا Authorization headers |
| `app.js` | حذف مفتاح Gemini من **6 مواقع** (`btnVerifyCalcAI`، استيراد الحقول، `refineImportedRowsWithAI`، موقعا قوانين الرواتب، والنداء المركزي `callOctagonAi`/`OCTAGON_AI_KEY`) — كلها الآن `fetch('/api/ai/gemini')` بنفس شكل الـ payload (بما فيه الصوت inlineData) | PART 5 |
| `test-api.js` | المفتاح المكتوب → `process.env.CUSTOM_API_KEY` (dotenv) | PART 6 |
| `CUSTOM_API_SETUP.md` | المفتاح الحقيقي → `sk-REDACTED` (موضعان) | PART 6 |
| `scratch/update_import_ai.py` | مفتاح Gemini → `AIza-REDACTED` | PART 6 |
| `.env` | أضيفت `OPENROUTER_API_KEY` / `CONTACTBOX_API_KEY` / `GEMINI_API_KEY` (بالقيم الحالية **الواجب تدويرها**) | مصدر المفاتيح الوحيد؛ غير متعقَّب في git |
| `.env.example` | **NEW** — أسماء المتغيرات بقيم placeholder فقط | PART 5 |
| `.gitignore` | أضيف `.env` و`server-ai-approvals.json` | `.env` لم يكن مُتجاهَلاً (لكنه لم يكن متعقَّباً أيضاً — تحقّقنا) |

---

## 3. Server-Side Gate (البوابة السيفرية)

المسار: **`POST /api/jarvis/action`** في `server-jarvis-security.js`، مفوَّض من أول سطر في request handler بـ `server.js`.

1. **الهوية**: `requireSession(req,res)` — نفس أساس الجلسات الموجود (`/api/auth/login` + كوكي `octagon_session`). في وضع التطوير المحلي يوجد الـ bypass القائم أصلاً (`local-dev` → admin) — موثَّق كمؤقت في رأس الملف.
2. **السياسة**: `serverGateTool(name)` — **جدول مخاطر server-side** يعكس `TOOL_RISK`/`APPROVAL_REQUIRED`/`GATE_TARGET` من `ai-governance.js`. الخادم **لا يثق بأي راية خطورة من العميل**، والأداة غير المعروفة **fail-closed** (تعامَل كـ high → موافقة).
3. **آمنة/متوسطة** (`create_task`, `create_customer`): تصريح فوري أحادي الاستخدام (`grantId`, TTL 120s) + تدقيق `requested`/`granted`.
4. **محكومة** (`create_journal_entry`, `add_customer_debt`, `record_customer_payment`, `create_purchase_expense`, `create_sales_receipt`, `modify_material`, `modify_employee`, `execute_js_mutation`): سجل موافقة في `server-ai-approvals.json` + ردّ `approval_required` — **لا تنفيذ**.
5. **منع الالتفاف على العميل**: في `jarvis-brain.js` المنفّذ الحقيقي محفوظ في `INTERNAL_RUNNERS` (closure خاص غير مُصدَّر). الـ `.run()` المكشوفة على `window.JarvisBrain.tools` مجرّد wrapper: بلا grant صالح يستهلكه الخادم (`/api/jarvis/consume-grant`) **لا يعمل شيء**. فشل الشبكة = **fail-closed** للأدوات المالية (و fail-open مُدقَّق فقط لـ `create_task`/`create_customer` حفاظاً على الاستخدام دون خادم).
6. **الأدوات الحرجة** (`execute_js_mutation` وأشباهها): محجوبة حتى بعد الموافقة ما لم يُضبط `OCTAGON_ALLOW_CRITICAL_TOOLS=true`.

## 4. Approval Revalidation (إعادة التحقق عند التنفيذ)

المسار: **`POST /api/jarvis/execute-approved`** — يتطلب دور مدير (`requireRoleSession(['system.admin','workshop.manager'])`) ويقوم بـ:
1. إعادة تحميل السجل من مخزن الخادم (وليس من حالة العميل).
2. رفض `executed` (منع تنفيذ مزدوج — يُعلَّم executed **قبل** إرجاع الـ grant) ورفض `rejected`.
3. إعادة فحص سياسة البوابة وقت التنفيذ (بما فيها حجب critical).
4. إصدار grant أحادي الاستخدام **بحجج السجل المعتمدة** — حجج العميل تُتجاهل إذا وُجد سجل، فلا يمكن تبديل المبلغ بعد الموافقة.
5. تدقيق قبل وبعد (`approved` → `granted` → `executed`/`failed` عبر `/api/jarvis/result`).

على العميل: `executeApprovedAiAction()` في `ai-governance.js` يستدعي هذا المسار ثم `JarvisBrain.runApprovedTool(grantId, tool, args)` الذي يستهلك الـ grant سيرفرياً قبل تشغيل المنفّذ الخاص. **الموافقة وحدها لم تعد كافية.**

## 5. API Key Migration (هجرة المفاتيح)

أُزيلت من كود العميل نهائياً:
| Key | كانت في | الآن |
|---|---|---|
| OpenRouter (`sk-or-v1-…`) | `modules/ai-providers.js:69` | `OPENROUTER_API_KEY` في `.env` |
| ContactBox (`sk-0e9…`) | `modules/ai-providers.js:73` | `CONTACTBOX_API_KEY` في `.env` |
| Gemini (`AIza…`) | `app.js` ×6 مواقع | `GEMINI_API_KEY` في `.env` |
| Custom/ContactBox (`sk-IlqDH…`) | `test-api.js`, `CUSTOM_API_SETUP.md` | `CUSTOM_API_KEY` (كانت أصلاً في `.env`) + redaction |

البروكسي: `POST /api/ai/chat` (openrouter/contactbox، allowlist بادئات موديلات + سقف tokens 4000 + سقف حجم رسائل) و`POST /api/ai/gemini` (يمرر `contents` كما هي — يشمل الصوت inlineData للتفريغ الصوتي — بسقف 16MB). الخادم لا يعيد المفتاح أبداً، وغياب المفتاح يرجع خطأ 503 نظيفاً. إضافة: `scrubLeakedKeys()` يمسح المفاتيح المسربة القديمة إن كانت محفوظة في `localStorage.octagonAIProvider` من نسخ سابقة.

## 6. Remaining Manual Steps (خطوات يدوية متبقية — مهمة)

1. **دوّر مفتاح OpenRouter** (dashboard → revoke + create) ثم حدّث `.env`. المفتاح القديم مكشوف في git history.
2. **دوّر مفتاح Gemini** (Google AI Studio) ثم حدّث `.env`.
3. **دوّر مفتاح ContactBox** و`CUSTOM_API_KEY` ثم حدّث `.env`.
4. git history لا يزال يحتوي المفاتيح القديمة — التدوير هو العلاج الحقيقي (لا يلزم history rewrite لمشروع محلي، لكن لا تدفع الـ repo لأي remote قبل التدوير).
5. عند أي نشر: تأكد من وجود `.env` على جهاز الخادم، وامسح كاش المتصفح/الـ service-worker حتى لا تُخدَّم نسخ JS قديمة تحمل المفاتيح (bump `?v=` إن لزم).
6. سجّل خروج/دخول مرة واحدة بعد التحديث حتى تُبنى جلسة الخادم (`syncServerAuthSession`) — بدونها نداءات AI في وضع production سترجع 401.
7. تنظيف اختياري: مهمة اختبار باسم `smoke: server-grant task` أُنشئت أثناء الفحص في مدير المهام — احذفها من الواجهة إن أزعجتك.

## 7. Smoke Test Results

| # | Test | Result |
|---|---|---|
| 0 | `node --check` على السبعة ملفات المعدّلة | ✅ OK جميعها |
| 1 | Safe action لا يزال يعمل: `POST /api/jarvis/action {create_task}` → `granted+grantId`؛ ومن المتصفح `tools.create_task.run()` أنشأ المهمة فعلاً عبر grant | ✅ |
| 2 | Dangerous action: `{create_journal_entry}` → `approval_required` + سجل server-side، **لم يُنفَّذ** | ✅ |
| 3 | Approved action revalidates: `execute-approved` → grant؛ إعادة النداء → `409 double execution blocked`؛ `consume-grant` ثانيةً → `403` | ✅ |
| 4 | **Console bypass مقطوع**: من متصفح حقيقي `JarvisBrain.tools.create_journal_entry.run({amount:999999})` → `{ok:false, blocked:true}` و`finance.transactions` بقيت 526→526 (صفر تعديل) | ✅ |
| 5 | AI عبر البروكسي: OpenRouter/DeepSeek ردّ "OK" (تكلفة $0.0000032)، وGemini ردّ "OK" | ✅ |
| 6 | Missing key: إطلاق بـ `OPENROUTER_API_KEY=` فارغ → `503 "OPENROUTER_API_KEY is not configured on the server (.env)"` نظيف | ✅ |
| 7 | No hardcoded keys: مسح كامل للـ repo — المفاتيح الحقيقية موجودة **فقط** في `.env` (غير متعقَّب+متجاهَل)؛ `database.json`/`database.db` نظيفان | ✅ |
| 8 | Unknown tool fail-closed: `{tool:"totally_made_up_tool"}` → `approval_required` بخطورة high | ✅ |
| 9 | Boot sanity: التطبيق أقلع بلا أي console errors؛ الملاح الحتمي (`افتح المخزون`) اشتغل | ✅ |
| 10 | Audit trail: `server-ai-audit.log` سجّل requested/granted/approval_queued/grant_refused/logged بكل حدث | ✅ |

## 8. Remaining Risks (المخاطر المتبقية — بصراحة)

1. **التنفيذ الفعلي ما زال client-side**: الخادم يمنح/يمنع، لكن الطفرة نفسها تجري في JS المتصفح على مخزن `omni` ثم تُحفَظ عبر `/api/db`. مهاجم بكامل صلاحيات الـ console يستطيع تعديل `omni`/`finance` **مباشرةً كبيانات خام** متجاوزاً الأدوات كلياً. سدّها الحقيقي = APIs طفرات server-side (سبرنت لاحق أكبر).
2. **Local-dev bypass**: على localhost خارج production أي طلب = admin (سلوك قائم أصلاً بكل endpoints الحساسة، ورثته الطبقة الجديدة). في production (`NODE_ENV=production` — مضبوطة حالياً في `.env`) يتعطل.
3. **مزامنة جدول البوابة**: `TOOL_RISK` في الخادم **مرآة يدوية** لـ `ai-governance.js` — أداة كاتبة جديدة يجب إضافتها في `SERVER_ENFORCED_TOOLS` (client) وجدول الخادم. الأداة غير المعروفة fail-closed، فالنسيان يُظهر موافقات زائدة لا ثغرة.
4. **fail-open مقصود** لـ `create_task`/`create_customer` عند سقوط الخادم (غير مالية) — موثَّق في الكود.
5. **Grants في الذاكرة**: إعادة تشغيل الخادم بين الموافقة والتنفيذ تُبطل الـ grant (يعاد التنفيذ من الطابور — إزعاج لا ثغرة). سجل الموافقات نفسه محفوظ على القرص.
6. **المستخدم غير المسجَّل**: في production بلا جلسة خادم، نداءات AI ترجع 401 والأوامر تسقط إلى المخطط الحتمي المحلي — سلوك آمن لكنه فرق ملحوظ عن السابق (كان AI يعمل بلا أي جلسة لأنه كان ينادي المزودين مباشرة).
7. المفاتيح القديمة في git history حتى التدوير (بند 6).

## 9. Next Recommended Sprint

1. **Enrich snapshot** — سياق record-level للصفحة الحالية + السجل المحدد (`jarvisGetSelectedRecordContext`) داخل `buildPlannerPrompt()`.
2. **KB RAG grounding** — فهرسة `omni.knowledgeBase` (احترام `jarvisReadable`) وحقن top-k في سياق المخطط.
3. **Durable memory** — ترحيل `TURN_HISTORY` إلى تخزين دائم + ذاكرة ملخَّصة طويلة المدى.
4. **Post-execution read-back verification** — بعد كل تنفيذ، قراءة تحقق من المخزن قبل قول "تم".
5. **DOM reader hardening** + بدء APIs الطفرات server-side للأدوات المالية (يحل الخطر رقم 1 جذرياً).
