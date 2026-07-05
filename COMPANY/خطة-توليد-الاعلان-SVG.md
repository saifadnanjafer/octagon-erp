# خطة توليد الإعلان كـ SVG فيكتور (بدون واجهة)

> مستند تجهيزي لميزة في `نظام-التسعير-للوحات.html`.
> الهدف: توليد **تصميم اللوحة فقط** (بدون خلفية/واجهة) كـ **SVG متجهي حقيقي** — قابل للتكبير بلا نهاية، ألوان دقيقة، جاهز للقص/الطباعة/التنفيذ.

> **✅ القرار المعتمد والمنفّذ (TRACE وليس نص/خط):**
> رُفض منهج `<text>`+font لأنه ينتج نصاً لا أشكالاً (ماكينة القص لا تقصّ النص، والنموذج اللغوي لا يولّد مسارات حروف عربية موثوقة).
> المعتمد: **تتبُّع الصورة النقطية → مسارات أشكال (paths)** عبر مكتبة [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs) في المتصفح.
> المصدر يُتتبَّع (التصميم التنفيذي / الإعلان / أي مرفق كاللوغو) فيصبح كل لون/حرف **شكلاً مستقلاً قابلاً للقص**.
> أوضاع: مسطّح (6 ألوان) / مفصّل (16) / أبيض وأسود + إمكانية **فرض لوحة ألوان قص** (HEX) لدقة الألوان.
> الدوال: `traceToSVG` / `traceSourceImg` / `traceAttachment` / `hexToRgba` / `downloadSVG` / `copySVG`. مكتبة محمّلة من CDN في `<head>`.
> ما تبقّى من هذا المستند أدناه هو التصميم الأصلي (منهج النص) — مُبقى **للمرجعية التاريخية فقط**.

---

## 1. لماذا SVG وليس صورة PNG؟

الوضع الحالي (`generateVector` في الـHTML) يستعمل **نموذج صور** (`google/gemini-3.1-flash-image`) → الناتج **صورة نقطية (raster)**:
- ❌ تتبكسل عند التكبير.
- ❌ الألوان تقريبية لا قيم HEX مضبوطة.
- ❌ القياسات «مرسومة» وليست حقيقية — لا يمكن قياسها في برنامج القص.
- ❌ غير قابلة للتحرير (لا طبقات، لا مسارات).

الهدف من هذه الميزة: ناتج **SVG**:
- ✅ متجهي — يكبر لأي مقاس بلا فقدان جودة.
- ✅ كل عنصر مسار/شكل مستقل → قابل للتحرير في Illustrator / Inkscape / ماكينة القص.
- ✅ ألوان `fill="#RRGGBB"` مضبوطة 100%.
- ✅ `viewBox` يطابق الأبعاد الحقيقية بالسنتيمتر → القياسات صحيحة هندسياً.
- ✅ خطوط أبعاد (dimension lines) حقيقية محسوبة، لا «مرسومة بالعين».

---

## 2. الفكرة المعمارية

بدل نموذج الصور، نستعمل **نموذج النص** (`anthropic/claude-sonnet-4-5` عبر OpenRouter — موجود أصلاً كـ `AI_VISION_MODEL`) ونطلب منه **توليد كود SVG خام**.

```
المدخلات (من state)            →   Claude (نص)   →   كود <svg>…</svg>   →   حقن مباشر في الصفحة + تنزيل .svg
- الأبعاد width×height (سم)
- نص الإعلان العربي
- الألوان المطلوبة (HEX)
- المواصفات buildVisualSpec()
- (اختياري) لوغو SVG مرفق
```

النقطة المفتاحية: الـ`viewBox` = `0 0 {width*10} {height*10}` (1 سم = 10 وحدات) → نسبة حقيقية + سهولة حساب خطوط الأبعاد.

---

## 3. مدخلات جديدة مطلوبة في `state.ai`

```js
colors: [],          // مصفوفة ألوان مطلوبة: [{name:'أحمر الشعار', hex:'#E11D2A'}, ...]
svgCode: '',         // ناتج كود الـSVG الخام
svgGenerating: false,
svgError: '',
fontChoice: 'Cairo', // خط عربي للنص
```

نحتاج واجهة صغيرة لإدخال الألوان (منتقي لون + اسم) قبل التوليد — لأن الـSVG يحتاج HEX صريح لا «ذهبي فاخر».

---

## 4. تحدّي الخط العربي في SVG (الأهم)

`<text>` العربي في SVG يعتمد على خط النظام/المتصفح، ويُكسر التشكيل (الحروف تنفصل) عند فتح الملف في برنامج لا يدعم العربي.

**ثلاثة مسارات، نختار حسب الأولوية:**

| المسار | الوصف | جاهزية القص | تعقيد |
|--------|-------|------------|-------|
| (أ) `<text>` + خط مضمّن | نضع `font-family` ونعتمد على المتصفح للعرض | ❌ النص يبقى نص (ماكينة القص لا تقصه كمسار) | منخفض |
| (ب) تحويل النص لمسارات (paths) | نحوّل الحروف إلى `<path>` عبر opentype.js | ✅ مثالي للقص | متوسط |
| (ج) Claude يرسم الحروف كمسارات | نطلب من النموذج توليد مسارات الحروف مباشرة | ⚠️ غير موثوق للعربي | عالٍ |

**القرار المبدئي:** نبدأ بالمسار (أ) للعرض السريع داخل الأداة، ثم نضيف زر **«تحويل النص لمسارات»** بالمسار (ب) باستخدام [opentype.js](https://github.com/opentypejs/opentype.js) + خط `Cairo`/`Tajawal` (نحمّله كـ woff/ttf) لإخراج نسخة جاهزة للتنفيذ.

---

## 5. بروميت التوليد (مسودة)

```
You are a production sign vector artist. Output ONLY raw valid SVG code (no markdown,
no ```svg fences, no explanation). Start with <svg and end with </svg>.

CANVAS: viewBox="0 0 {W*10} {H*10}" (1 cm = 10 units). Real sign size {W}×{H} cm.
Background: none/transparent.

DRAW (flat orthographic production view):
1. The sign artwork — Arabic text "{adText}" as <text> with font-family="{font}",
   correct RTL direction, sized to fill the artwork area proportionally.
2. Exact required colors as solid fills — use ONLY these HEX values: {colors list}.
3. Engineering DIMENSION LINES (thin {strokeColor} lines, arrowheads, numeric labels in cm)
   for overall width and overall height, positioned just outside the artwork.
4. A small legend box (bottom corner) listing material/spec notes from: {spec}.
No gradients, no glow, no 3D, no photographic effects. Clean flat manufacturing drawing.
Use <g> groups with id labels: id="artwork", id="dimensions", id="legend".
```

ملاحظة: تنظيف الناتج إجبارياً — إزالة أي ```‎svg / نص قبل `<svg`، والتحقق أنه يبدأ بـ`<svg` وينتهي بـ`</svg>` قبل الحقن.

---

## 6. دوال جديدة (مخطط)

```js
function buildSvgPrompt(){ /* يبني البروميت أعلاه من state */ }

async function generateAdSVG(){
  // orPost(AI_VISION_MODEL, [...نص فقط...], {max_tokens:4000})
  // ناتج = orText(result) → تنظيف الأسوار → التحقق <svg…</svg>
  // state.ai.svgCode = cleaned; render();
}

function renderSvgInline(){ /* حقن state.ai.svgCode في حاوية + معاينة حية */ }
function downloadSVG(){ /* Blob type image/svg+xml → تنزيل .svg */ }
function svgToPaths(){ /* المرحلة 2: opentype.js لتحويل <text> → <path> */ }
```

**التنزيل:**
```js
const blob = new Blob([state.ai.svgCode], {type:'image/svg+xml;charset=utf-8'});
const a = document.createElement('a');
a.href = URL.createObjectURL(blob); a.download = 'تصميم-تنفيذي.svg'; a.click();
```

---

## 7. التكامل مع الأداة الحالية

- يدخل كـ **زر ثالث** أسفل كتلة `vectorBlock` في `aiGeneratorHtml()`:
  «توليد SVG متجهي (قابل للتحرير)» — منفصل عن زر التصميم النقطي الحالي.
- المعاينة: حقن مباشر داخل `<div>` (الـSVG يُعرض حياً) + زرّي **تنزيل SVG** و **نسخ الكود**.
- الـSVG الناتج لا يُضاف لمرفقات الوصل (المرفقات نقطية) — بل ينزّل كملف مستقل للتنفيذ.

---

## 8. مراحل التنفيذ

- **المرحلة 1 — أساس:** منتقي ألوان + `generateAdSVG` بالمسار (أ) `<text>` + معاينة حية + تنزيل `.svg`. (نتيجة قابلة للعرض فوراً)
- **المرحلة 2 — جاهزية القص:** زر «تحويل النص لمسارات» عبر opentype.js (مسار ب) → SVG حروفه `<path>`.
- **المرحلة 3 — دقة هندسية:** حساب خطوط الأبعاد برمجياً (لا نتركها للنموذج) لضمان أرقام مضبوطة 100%.
- **المرحلة 4 — قوالب:** مكتبة قوالب SVG جاهزة (حروف بارزة / لايت بوكس / كوبوند) يملؤها النموذج بالنص واللون فقط → نتائج أدق وأسرع.

---

## 9. ملاحظات/مخاطر

- النماذج النصية قد تُخرج SVG غير صالح أحياناً → **إلزامي**: تحقق + إعادة محاولة + عرض رسالة خطأ واضحة.
- التشكيل العربي في `<text>`: المسار (ب) هو الحل النهائي للتنفيذ الفعلي.
- حجم `max_tokens` يجب أن يكفي لـSVG معقّد (≥ 4000).
- ربط الألوان من اللوغو المرفق: في المرحلة 4 نستخرج HEX من الصورة المرفقة (canvas) ونمرّرها كقائمة ألوان جاهزة.
