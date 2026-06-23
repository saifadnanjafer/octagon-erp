/**
 * OCTAGON OMNISYSTEM — modules/page-help-manual.js
 *
 * GO 16 Phase 3: first FULL PAGE renderer extracted from app.js into its own module.
 * Loaded after app.js; invoked at runtime by switchPage("help_manual"). Self-contained:
 * only touches #helpManualBody and emits switchPage(...) calls inside onclick strings.
 * Pattern proof for migrating larger leaf pages the same way.
 */
function renderHelpManualPage() {
  const body = document.getElementById('helpManualBody');
  if (!body) return;
  body.className = 'automation-shell';
  body.innerHTML = `<div class="automation-hero"><div><h2><i class="fa-solid fa-circle-question text-accent-cyan"></i> دليل الاستخدام السريع</h2><p>الدليل الكامل موجود في ملف USER_GUIDE_AR.md، وهذه نسخة تشغيلية مختصرة داخل التطبيق للوصول السريع لأهم النوافذ ومسارات العمل.</p></div><div class="automation-hero-actions"><button class="btn-secondary" onclick="switchPage('intelligence')">AI Dashboard</button><button class="btn-secondary" onclick="switchPage('whatsapp')">WhatsApp</button><button class="btn-secondary" onclick="switchPage('automation')">Automation</button></div></div><div class="automation-rule-grid">${[['مركز القيادة','command_center','قرارات وموافقات ومتابعة تشغيلية.'],['Task Manager','task_manager','قاعدة المهام والمسؤوليات ومخرجات AI الآمنة.'],['Automation','automation','قواعد تشتغل على أحداث النظام.'],['AI Dashboard','intelligence','جاهزية AI للقراءة والكتابة والفجوات.'],['WhatsApp','whatsapp','تحليل رسائل الورشة وتحويلها بعد الموافقة.'],['SOP Library','sop','قاعدة المعرفة والإجراءات.']].map(([label,page,note]) => `<div class="automation-rule-card"><div class="automation-rule-head"><h3>${label}</h3></div><p>${note}</p><button class="btn-primary" onclick="switchPage('${page}')">فتح</button></div>`).join('')}</div>`;
}
