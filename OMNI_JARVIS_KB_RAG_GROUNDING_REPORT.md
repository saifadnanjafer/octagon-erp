# OMNI JARVIS KB RAG GROUNDING REPORT

## 1. Summary
تم بنجاح تحديث المساعد الذكي "Jarvis / أومني" بإضافة إمكانية الـ RAG (Retrieval-Augmented Generation) لربطه بقاعدة المعرفة (Knowledge Base) الخاصة بنظام Octagon ERP. يمكن للمساعد الآن قراءة السياسات والأدلة المنشورة، والـ SOPs المعتمدة للإجابة بدقة على الأسئلة الإجرائية دون اللجوء لاختراع سياسات من وحي الخيال.

## 2. Files Changed
| File | Change | Reason |
|---|---|---|
| `server-jarvis-kb-rag.js` | `[NEW]` | محرك البحث (Retriever) الجديد من جهة الخادم لضمان حجب البيانات وبحث الكلمات المفتاحية بشكل موثوق. |
| `server-jarvis-security.js` | `[MODIFY]` | إضافة بوابات الـ API الخاصة بقاعدة المعرفة (`/api/jarvis/kb/search` و `/api/jarvis/kb/context`) مع التحقق من الجلسات (Sessions). |
| `modules/jarvis-brain.js` | `[MODIFY]` | إضافة فحص تلقائي للسؤال، بحيث يجلب المساعد الـ KB Context في أسئلة (السياسات/كيفية الاستخدام) ويضخها في الـ Prompt. |
| `modules/knowledge-base.js` | `[MODIFY]` | تحديث أداة `search_knowledge_base` لاستخدام الـ Server API بدلاً من البحث الداخلي. |
| `scripts/jarvis-kb-rag-smoke.mjs` | `[NEW]` | ملف لاختبار صحة البحث والتطبيع اللغوي وحماية الأسرار. |

## 3. Knowledge Sources
| Source | Included? | Fields | Limitations |
|---|---|---|---|
| **Articles** (`omni.knowledge.articles`) | Yes | Title, Body, Tags | فقط المنشورة (`status === 'published'`) يتم تضمينها. |
| **SOPs** (`omni.sops`) | Yes | Title, Description, Steps | فقط المعتمدة، ولا يتم تضمين المسودات (`draft`). |
| **FAQs** | No (future) | - | لم يتم تضمينها بعد (يمكن إضافتها بسهولة في التحديث القادم). |

## 4. Retrieval Architecture
تم بناء المعمارية لتعمل محلياً بصورة قطعية (Deterministic Local Search) من خلال:
1. **التطبيع (Normalization)**: 
   - العربي: إزالة التشكيل، التطويل، توحيد الهمزات (أ إ آ -> ا)، والتاء المربوطة.
   - الإنجليزي: تحويل أحرف صغيرة وإزالة الرموز الخاصة مع الاحتفاظ بالأحرف والأرقام `[^\p{L}\p{N}\s]`.
2. **الترتيب (Ranking)**: نظام نقاط مبسط (Scoring) يمنح وزن أعلى لعنوان المقال ثم جسم المقال، ثم الكلمات المفتاحية المتفرقة.
3. **الحماية والاقتطاع (Redaction & Trimming)**: دالة `redactKbResult()` تصطاد تلقائياً أسرار `Bearer`، `sk-`، وأي كلمات مثل `password` لتستبدلها بـ `[REDACTED]`.

## 5. API Endpoints
- **`GET /api/jarvis/kb/search?q=...&limit=5`**: للبحث المباشر عبر الواجهة إذا لزم الأمر، يرجع مصفوفة `results`.
- **`POST /api/jarvis/kb/search`**: نفس مسار الـ GET لكن يدعم حمولات JSON كبيرة للـ POST.
- **`POST /api/jarvis/kb/context`**: يقوم بإرجاع سياق مصغر مخصص للـ LLM، يقتطع النتائج إذا تجاوزت حدود الـ 20,000 حرف لتوفير الـ Tokens، ويرسل تعليمات مرافقة: `mustNotInvent: true`.

## 6. Jarvis Integration
- **متى يستخدم الـ KB؟**: إذا استشعر الـ RegExp بالأسئلة الإجرائية (شلون، كيف، سياسة، FAQ، دليل، خطوات...). 
- **متى لا يستخدمه؟**: الأوامر المباشرة (مثل: "افتح المهام"، "اعتمد الطلب") والانتقالات السريعة في الواجهة `Simple Navigate`، وذلك لتوفير الوقت.

## 7. Grounding Rules
تم إضافة تعليمات للموديل في دالة `buildPlannerPrompt()`:
- الـ KB هو المصدر الرسمي والوحيد للإجابة عن الأسئلة التشغيلية.
- اللقطة السريعة (Snapshot) هي المصدر لحالة النظام اللحظية.
- يجب ذكر (Cite) اسم المصدر أو الدليل من الـ KB أثناء التحدث للمستخدم.
- يُمنع اختراع قواعد إذا كانت نتيجة الـ KB فارغة `noResults: true`.

## 8. Smoke Test Results
- `jarvis-kb-rag-smoke.mjs`: **PASS (8/8)** 
  - (اجتاز اختبارات: التطبيع العربي/الإنجليزي، منع الأسرار، الحجم المحدود، استجابة فارغة عند عدم وجود تطابق).
- `jarvis-server-side-mutations-smoke.mjs`: **PASS (22/22)**
- `jarvis-click-ui-hardening-smoke.mjs`: **PASS (24/24)**
- *لا توجد تراجعات برمجية في مسارات الحماية.*

## 9. Remaining Risks
- **ضعف المحتوى**: يعتمد الأداء كلياً على جودة الـ SOPs والمقالات؛ إذا كانت فارغة سيرد Jarvis بعدم المعرفة.
- **بدون تضمين (No Embeddings)**: البحث الحالي يعتمد على الكلمات المفتاحية، قد لا يجد المقالات إذا استخدم المستخدم مرادفات لم تُذكر في النص الأصلي.
- **أقسام غير مشمولة**: بيانات `FAQs` المستقلة في قاعدة المعرفة غير مدرجة حالياً وتتطلب شمولاً في `loadKnowledgeSources`.

## 10. Next Sprint Recommendation
التوصيات للسبرنت القادم:
1. **Post-execution read-back verification**: تزويد المساعد بصلاحية قراءة حالة النظام مرة أخرى للتأكد بعد تنفيذه أمراً.
2. **Durable memory**: بناء ذاكرة مستمرة ليتمكن Jarvis من تذكر تفضيلات المستخدم بين الجلسات.
3. **DOM reader hardening**: تحسين حماية وقوة قراءة عناصر الشاشة.
4. **Stable data-jarvis-action tagging**: ضبط عناصر الواجهة لاستخدام علامات HTML قياسية للتسهيل على المساعد.
5. **Optional embedding/vector search later**: الاستعداد لترقية محرك البحث لاحقاً لاستخدام تقنية الـ Vector Embeddings لزيادة الذكاء.
