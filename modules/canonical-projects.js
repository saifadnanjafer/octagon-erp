(function (root) {
  'use strict';

  // Checkpoint D1: visible Projects workspace over the canonical Octagon
  // runtime. Every mutation below travels through
  // CanonicalClient -> /api/v1/action/:actionId -> ActionExecutor.
  // Project tasks are canonical Work Items; costs are derived server-side
  // from canonical facts. Nothing here writes payroll, stock, or the GL.
  root.__canonicalProjectsAuthorityActive = true;

  const state = {
    active: 'dashboard',
    loading: false,
    busy: false,
    error: null,
    notice: null,
    selectedProjectId: null,
    report: 'profitability',
    rows: {
      projects: [], templates: [], phases: [], milestones: [], costCodes: [],
      commitments: [], changeOrders: [], risks: [], issues: [], tasks: [],
      effort: [], billing: [], resources: [], costRates: [], report: [],
    },
    detail: { project: null, budget: null, costing: null, profitability: null },
  };

  const tabs = [
    ['dashboard', 'لوحة المشاريع', 'Project Dashboard', 'fa-chart-line'],
    ['projects', 'المشاريع', 'Projects', 'fa-diagram-project'],
    ['templates', 'القوالب', 'Templates', 'fa-clone'],
    ['phases', 'المراحل', 'Phases', 'fa-layer-group'],
    ['milestones', 'المعالم', 'Milestones', 'fa-flag-checkered'],
    ['wbs', 'هيكل تجزئة العمل', 'Work Breakdown Structure', 'fa-sitemap'],
    ['tasks', 'مهام المشروع', 'Project Tasks', 'fa-list-check'],
    ['budget', 'الموازنة', 'Budget', 'fa-scale-balanced'],
    ['commitments', 'الالتزامات', 'Commitments', 'fa-file-signature'],
    ['cost-codes', 'رموز التكلفة', 'Cost Codes', 'fa-hashtag'],
    ['change-orders', 'أوامر التغيير', 'Change Orders', 'fa-pen-to-square'],
    ['risks', 'المخاطر', 'Risks', 'fa-triangle-exclamation'],
    ['issues', 'المشكلات', 'Issues', 'fa-circle-exclamation'],
    ['documents', 'الوثائق', 'Documents', 'fa-folder-open'],
    ['billing', 'الفوترة', 'Billing', 'fa-file-invoice-dollar'],
    ['profitability', 'الربحية', 'Profitability', 'fa-coins'],
    ['resources', 'عرض الموارد', 'Resource View', 'fa-users-gear'],
    ['reports', 'تقارير المشاريع', 'Project Reports', 'fa-chart-column'],
  ];

  const REPORTS = [
    ['profitability', 'الربحية', 'Profitability'],
    ['budget_vs_actual', 'الموازنة مقابل الفعلي', 'Budget vs Actual'],
    ['commitments', 'الالتزامات', 'Commitments'],
    ['cost_by_code', 'التكلفة حسب الرمز', 'Cost by Code'],
    ['milestones', 'المعالم', 'Milestones'],
    ['risks', 'المخاطر', 'Risks'],
    ['overdue_work', 'الأعمال المتأخرة', 'Overdue Work'],
    ['revenue', 'الإيرادات', 'Revenue'],
  ];

  function client() { return root.CanonicalClient || null; }
  function isArabic() {
    const lang = String(document.documentElement.lang || '').toLowerCase();
    return document.documentElement.dir === 'rtl' || !lang || lang.startsWith('ar');
  }
  function tx(ar, en) { return isArabic() ? ar : en; }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function money(value) {
    return new Intl.NumberFormat(isArabic() ? 'ar-IQ' : 'en-US', { maximumFractionDigits: 2 })
      .format(Number(value || 0));
  }
  function date(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? esc(value) : parsed.toLocaleDateString(isArabic() ? 'ar-IQ' : 'en-GB');
  }
  function badge(value) {
    const key = String(value || 'unknown');
    return `<span class="cp-badge cp-state-${esc(key.replace(/[^a-z0-9_-]/gi, '-'))}">${esc(key)}</span>`;
  }
  function host() { return document.getElementById('pageProjects'); }

  function normalizeError(error) {
    if (!error) return tx('حدث خطأ غير معروف.', 'An unknown error occurred.');
    if (error.isAuthorization) return tx('لا تملك صلاحية تنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    if (error.code) return `${error.code}: ${error.message}`;
    return error.message || String(error);
  }

  function loadingState() {
    return `<div class="cp-state cp-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><strong>${tx('جاري تحميل حقائق المشاريع القانونية…', 'Loading canonical Project facts…')}</strong></div>`;
  }
  function errorState() {
    return `<div class="cp-state cp-error" role="alert"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${tx('تعذر تحميل المشاريع', 'Projects could not be loaded')}</strong><p>${esc(state.error)}</p></div><button type="button" data-cp-action="refresh">${tx('إعادة المحاولة', 'Retry')}</button></div>`;
  }
  function emptyState(label) {
    return `<div class="cp-state cp-empty"><i class="fa-regular fa-folder-open"></i><strong>${esc(label)}</strong><span>${tx('استخدم الإجراء المناسب لإنشاء أول سجل قانوني.', 'Use the relevant action to create the first canonical record.')}</span></div>`;
  }
  function needProject() {
    return `<div class="cp-state cp-empty"><i class="fa-solid fa-diagram-project"></i><strong>${tx('اختر مشروعاً أولاً', 'Select a project first')}</strong><span>${tx('افتح تبويب «المشاريع» واختر مشروعاً لعرض هذه المنطقة.', 'Open the Projects tab and choose a project to view this area.')}</span></div>`;
  }

  function selectedProject() {
    return state.rows.projects.find((row) => row.id === state.selectedProjectId) || null;
  }

  function shell() {
    const el = host();
    if (!el) return;
    const current = selectedProject();
    el.innerHTML = `
      <section class="cp-workspace" data-cp-workspace>
        <header class="cp-hero">
          <div>
            <span class="cp-eyebrow">${tx('أوكتاغون ERP · دورة المشاريع القانونية', 'Octagon ERP · Canonical project cycle')}</span>
            <h2>${tx('المشاريع', 'Projects')}</h2>
            <p>${tx('من العقد إلى الربحية، عبر المهام والمخزون والمالية القانونيين.', 'Contract-to-profitability execution through canonical Work Items, Inventory, and Finance.')}</p>
          </div>
          <div class="cp-hero-actions">
            <span class="cp-authority"><i class="fa-solid fa-shield-halved"></i>${tx('هوية ونطاق من الخادم', 'Server-derived identity and scope')}</span>
            ${current ? `<span class="cp-current"><i class="fa-solid fa-diagram-project"></i>${esc(current.project_number)} · ${esc(current.name)}</span>` : ''}
            <button type="button" class="cp-icon-btn" data-cp-action="refresh" title="${tx('تحديث', 'Refresh')}"><i class="fa-solid fa-rotate"></i></button>
          </div>
        </header>
        <nav class="cp-tabs" aria-label="${tx('مساحات المشاريع', 'Project areas')}">
          ${tabs.map(([key, ar, en, icon]) => `<button type="button" class="${state.active === key ? 'active' : ''}" data-cp-tab="${key}"><i class="fa-solid ${icon}"></i><span>${tx(ar, en)}</span></button>`).join('')}
        </nav>
        <div class="cp-feedback" aria-live="polite">${state.notice ? `<div class="cp-notice"><i class="fa-solid fa-circle-check"></i>${esc(state.notice)}</div>` : ''}</div>
        <main class="cp-body">${state.loading ? loadingState() : state.error ? errorState() : renderActive()}</main>
      </section>`;
    bind(el);
  }

  function kpi(label, value, detail, icon) {
    return `<article class="cp-kpi"><i class="fa-solid ${icon}"></i><div><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(detail || '')}</small></div></article>`;
  }

  function table(headers, bodyRows, emptyLabel) {
    if (!bodyRows.length) return emptyState(emptyLabel);
    return `<div class="cp-table-wrap"><table class="cp-table">
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${bodyRows.join('')}</tbody>
    </table></div>`;
  }

  // -------------------------------------------------------------------------
  // Areas
  // -------------------------------------------------------------------------

  function renderDashboard() {
    const projects = state.rows.projects;
    const active = projects.filter((p) => p.status === 'active');
    const openRisks = state.rows.risks.filter((r) => r.state === 'open');
    const openIssues = state.rows.issues.filter((i) => i.state === 'open' || i.state === 'in_progress');
    const contractValue = projects.reduce((sum, p) => sum + Number(p.contract_value || 0), 0);
    const profit = state.rows.report && state.report === 'profitability' ? state.rows.report : [];
    const recognised = profit.reduce((sum, r) => sum + Number(r.recognised_revenue || 0), 0);
    const actualCost = profit.reduce((sum, r) => sum + Number(r.actual_cost || 0), 0);

    return `
      <div class="cp-kpis">
        ${kpi(tx('المشاريع النشطة', 'Active projects'), active.length, tx(`${projects.length} إجمالاً`, `${projects.length} total`), 'fa-diagram-project')}
        ${kpi(tx('قيمة العقود', 'Contract value'), money(contractValue), tx('من سجل المشاريع', 'from the project register'), 'fa-file-contract')}
        ${kpi(tx('الإيراد المعترف به', 'Recognised revenue'), money(recognised), tx('مشتق من حقائق الفوترة', 'derived from billing facts'), 'fa-coins')}
        ${kpi(tx('التكلفة الفعلية', 'Actual cost'), money(actualCost), tx('مشتقة من الحقائق القانونية', 'derived from canonical facts'), 'fa-sack-dollar')}
        ${kpi(tx('مخاطر مفتوحة', 'Open risks'), openRisks.length, tx('تحتاج تخفيفاً', 'need mitigation'), 'fa-triangle-exclamation')}
        ${kpi(tx('مشكلات مفتوحة', 'Open issues'), openIssues.length, tx('تحتاج حلاً', 'need resolution'), 'fa-circle-exclamation')}
      </div>
      <section class="cp-panel">
        <h3>${tx('أحدث المشاريع', 'Recent projects')}</h3>
        ${table(
          [tx('الرقم', 'Number'), tx('الاسم', 'Name'), tx('الحالة', 'Status'), tx('طريقة الفوترة', 'Billing'), tx('قيمة العقد', 'Contract'), ''],
          projects.slice(0, 8).map((row) => `<tr>
            <td>${esc(row.project_number)}</td><td>${esc(row.name)}</td>
            <td>${badge(row.status)}</td><td>${esc(row.billing_method)}</td>
            <td>${money(row.contract_value)}</td>
            <td><button type="button" class="cp-link" data-cp-select="${esc(row.id)}">${tx('فتح', 'Open')}</button></td>
          </tr>`),
          tx('لا توجد مشاريع بعد', 'No projects yet'),
        )}
      </section>`;
  }

  function renderProjects() {
    return `
      <section class="cp-panel">
        <h3>${tx('إنشاء مشروع', 'Create project')}</h3>
        <form class="cp-form" data-cp-form="project">
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="140"></label>
          <label>${tx('قيمة العقد', 'Contract value')}<input name="contract_value" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('طريقة الفوترة', 'Billing method')}<select name="billing_method">
            <option value="fixed_price">${tx('سعر ثابت', 'Fixed price')}</option>
            <option value="milestone">${tx('حسب المعالم', 'Milestone')}</option>
            <option value="time_and_material">${tx('وقت ومواد', 'Time & material')}</option>
          </select></label>
          <label>${tx('نسبة المحتجز %', 'Retention %')}<input name="retention_percent" type="number" step="0.01" min="0" max="99" value="0"></label>
          <label>${tx('تاريخ البدء', 'Start date')}<input name="start_date" type="date"></label>
          <label>${tx('تاريخ الانتهاء', 'End date')}<input name="end_date" type="date"></label>
          <label>${tx('القالب', 'Template')}<select name="template_id">
            <option value="">${tx('بدون قالب', 'No template')}</option>
            ${state.rows.templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
          </select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('سجل المشاريع', 'Project register')}</h3>
        ${table(
          [tx('الرقم', 'Number'), tx('الاسم', 'Name'), tx('الحالة', 'Status'), tx('البدء', 'Start'), tx('الانتهاء', 'End'), tx('قيمة العقد', 'Contract'), tx('المهام', 'Tasks'), tx('إجراءات', 'Actions')],
          state.rows.projects.map((row) => `<tr class="${row.id === state.selectedProjectId ? 'cp-row-active' : ''}">
            <td>${esc(row.project_number)}</td><td>${esc(row.name)}</td>
            <td>${badge(row.status)}</td><td>${date(row.start_date)}</td><td>${date(row.end_date)}</td>
            <td>${money(row.contract_value)}</td><td>${esc(row.task_count ?? '—')}</td>
            <td class="cp-actions">
              <button type="button" class="cp-link" data-cp-select="${esc(row.id)}">${tx('اختيار', 'Select')}</button>
              ${row.status === 'draft' ? `<button type="button" class="cp-link" data-cp-status="${esc(row.id)}" data-cp-to="active">${tx('تفعيل', 'Activate')}</button>` : ''}
              ${row.status === 'active' ? `<button type="button" class="cp-link" data-cp-status="${esc(row.id)}" data-cp-to="on_hold">${tx('تعليق', 'Hold')}</button>` : ''}
              ${row.status === 'on_hold' ? `<button type="button" class="cp-link" data-cp-status="${esc(row.id)}" data-cp-to="active">${tx('استئناف', 'Resume')}</button>` : ''}
              ${row.status === 'active' ? `<button type="button" class="cp-link" data-cp-status="${esc(row.id)}" data-cp-to="completed">${tx('إنهاء', 'Complete')}</button>` : ''}
            </td>
          </tr>`),
          tx('لا توجد مشاريع بعد', 'No projects yet'),
        )}
      </section>`;
  }

  function renderTemplates() {
    return `
      <section class="cp-panel">
        <h3>${tx('إنشاء قالب مشروع', 'Create project template')}</h3>
        <form class="cp-form" data-cp-form="template">
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="120"></label>
          <label>${tx('الرمز', 'Code')}<input name="code" maxlength="40" placeholder="TPL-FITOUT"></label>
          <label>${tx('المراحل (مفصولة بفاصلة)', 'Phases (comma separated)')}<input name="phases" placeholder="${tx('تصميم، تنفيذ، تسليم', 'Design, Build, Handover')}"></label>
          <label>${tx('رموز التكلفة (مفصولة بفاصلة)', 'Cost codes (comma separated)')}<input name="cost_codes" placeholder="MAT, LAB, SUB"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('القوالب المتاحة', 'Available templates')}</h3>
        ${table(
          [tx('الرمز', 'Code'), tx('الاسم', 'Name'), tx('طريقة الفوترة', 'Billing'), tx('إجراءات', 'Actions')],
          state.rows.templates.map((row) => `<tr>
            <td>${esc(row.code)}</td><td>${esc(row.name)}</td><td>${esc(row.default_billing_method)}</td>
            <td>${state.selectedProjectId ? `<button type="button" class="cp-link" data-cp-apply-template="${esc(row.id)}">${tx('تطبيق على المحدد', 'Apply to selected')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد قوالب', 'No templates'),
        )}
      </section>`;
  }

  function renderPhases() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('إضافة مرحلة', 'Add phase')}</h3>
        <form class="cp-form" data-cp-form="phase">
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="120"></label>
          <label>${tx('رمز WBS', 'WBS code')}<input name="wbs_code" maxlength="40"></label>
          <label>${tx('البدء المخطط', 'Planned start')}<input name="planned_start" type="date"></label>
          <label>${tx('الانتهاء المخطط', 'Planned end')}<input name="planned_end" type="date"></label>
          <label>${tx('المرحلة الأصل', 'Parent phase')}<select name="parent_phase_id">
            <option value="">${tx('بدون', 'None')}</option>
            ${state.rows.phases.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة', 'Add')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('مراحل المشروع', 'Project phases')}</h3>
        ${table(
          [tx('WBS'), tx('الاسم', 'Name'), tx('الحالة', 'Status'), tx('التقدم', 'Progress'), tx('البدء', 'Start'), tx('الانتهاء', 'End'), tx('إجراءات', 'Actions')],
          state.rows.phases.map((row) => `<tr>
            <td>${esc(row.wbs_code || '—')}</td><td>${esc(row.name)}</td>
            <td>${badge(row.status)}</td><td>${esc(Number(row.progress || 0))}%</td>
            <td>${date(row.planned_start)}</td><td>${date(row.planned_end)}</td>
            <td>${row.status !== 'completed' ? `<button type="button" class="cp-link" data-cp-phase-complete="${esc(row.id)}">${tx('إكمال', 'Complete')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد مراحل', 'No phases'),
        )}
      </section>`;
  }

  function renderWbs() {
    const project = selectedProject();
    if (!project) return needProject();
    const phases = state.rows.phases;
    if (!phases.length) return emptyState(tx('لا يوجد هيكل تجزئة عمل', 'No work breakdown structure'));
    const byParent = new Map();
    phases.forEach((p) => {
      const key = p.parent_phase_id || '__root__';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(p);
    });
    const tasksByPhase = new Map();
    state.rows.tasks.forEach((t) => {
      const key = t.source_line_id || '__none__';
      if (!tasksByPhase.has(key)) tasksByPhase.set(key, []);
      tasksByPhase.get(key).push(t);
    });
    function branch(parentKey, depth) {
      const children = byParent.get(parentKey) || [];
      if (!children.length) return '';
      return `<ul class="cp-wbs-level">${children.map((p) => `
        <li>
          <div class="cp-wbs-node">
            <span class="cp-wbs-code">${esc(p.wbs_code || '—')}</span>
            <strong>${esc(p.name)}</strong>
            ${badge(p.status)}
            <small>${esc(Number(p.progress || 0))}%</small>
          </div>
          ${(tasksByPhase.get(p.id) || []).length ? `<ul class="cp-wbs-tasks">${(tasksByPhase.get(p.id) || []).map((t) => `<li><i class="fa-solid fa-list-check"></i>${esc(t.title)} ${badge(t.status)}</li>`).join('')}</ul>` : ''}
          ${depth < 5 ? branch(p.id, depth + 1) : ''}
        </li>`).join('')}</ul>`;
    }
    return `<section class="cp-panel"><h3>${tx('هيكل تجزئة العمل', 'Work Breakdown Structure')}</h3>
      <div class="cp-wbs">${branch('__root__', 0)}</div></section>`;
  }

  function renderTasks() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('إضافة مهمة (عنصر عمل قانوني)', 'Add task (canonical Work Item)')}</h3>
        <p class="cp-hint"><i class="fa-solid fa-circle-info"></i>${tx('مهام المشاريع تُخزَّن في سلطة عناصر العمل القانونية، وليس في جدول مهام منفصل.', 'Project tasks are stored in the canonical Work Item authority, not a separate task table.')}</p>
        <form class="cp-form" data-cp-form="task">
          <label>${tx('العنوان', 'Title')}<input name="title" required maxlength="160"></label>
          <label>${tx('المرحلة', 'Phase')}<select name="phase_id">
            <option value="">${tx('بدون', 'None')}</option>
            ${state.rows.phases.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الساعات المقدرة', 'Estimated hours')}<input name="estimated_hours" type="number" step="0.25" min="0" value="0"></label>
          <label>${tx('تاريخ الاستحقاق', 'Due date')}<input name="due_date" type="date"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة', 'Add')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('مهام المشروع', 'Project tasks')}</h3>
        ${table(
          [tx('العنوان', 'Title'), tx('الحالة', 'Status'), tx('المرحلة', 'Stage'), tx('الاستحقاق', 'Due'), tx('مقدرة', 'Est.'), tx('فعلية', 'Actual')],
          state.rows.tasks.map((row) => `<tr>
            <td>${esc(row.title)}</td><td>${badge(row.status)}</td><td>${esc(row.stage || '—')}</td>
            <td>${date(row.due_date)}</td><td>${esc(Number(row.estimated_hours || 0))}</td><td>${esc(Number(row.actual_hours || 0))}</td>
          </tr>`),
          tx('لا توجد مهام', 'No tasks'),
        )}
      </section>`;
  }

  function renderCostCodes() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('إضافة رمز تكلفة', 'Add cost code')}</h3>
        <form class="cp-form" data-cp-form="cost-code">
          <label>${tx('الرمز', 'Code')}<input name="code" required maxlength="30"></label>
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="120"></label>
          <label>${tx('نوع التكلفة', 'Cost type')}<select name="cost_type">
            <option value="material">${tx('مواد', 'Material')}</option>
            <option value="labor">${tx('عمالة', 'Labor')}</option>
            <option value="machine">${tx('آلات', 'Machine')}</option>
            <option value="subcontract">${tx('مقاولة باطن', 'Subcontract')}</option>
            <option value="overhead">${tx('أعباء غير مباشرة', 'Overhead')}</option>
            <option value="other">${tx('أخرى', 'Other')}</option>
          </select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة', 'Add')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('رموز التكلفة', 'Cost codes')}</h3>
        ${table(
          [tx('الرمز', 'Code'), tx('الاسم', 'Name'), tx('النوع', 'Type')],
          state.rows.costCodes.map((row) => `<tr><td>${esc(row.code)}</td><td>${esc(row.name)}</td><td>${esc(row.cost_type)}</td></tr>`),
          tx('لا توجد رموز تكلفة', 'No cost codes'),
        )}
      </section>`;
  }

  function renderBudget() {
    const project = selectedProject();
    if (!project) return needProject();
    const budget = state.detail.budget;
    return `
      <section class="cp-panel">
        <h3>${tx('تحديد سطر موازنة', 'Set budget line')}</h3>
        <form class="cp-form" data-cp-form="budget">
          <label>${tx('رمز التكلفة', 'Cost code')}<select name="cost_code_id" required>
            ${state.rows.costCodes.map((c) => `<option value="${esc(c.id)}">${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
          </select></label>
          <label>${tx('المبلغ', 'Amount')}<input name="amount" type="number" step="0.01" min="0" required></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('حفظ', 'Save')}</button>
          <button type="button" class="cp-secondary" data-cp-action="approve-budget" ${state.busy ? 'disabled' : ''}>${tx('اعتماد الموازنة', 'Approve budget')}</button>
        </form>
        <p class="cp-hint"><i class="fa-solid fa-circle-info"></i>${tx('بعد الاعتماد لا يمكن تعديل السطر إلا عبر مسار المراجعة المحكوم.', 'Once approved, a line can only change through the governed revision path.')}</p>
      </section>
      <section class="cp-panel">
        <h3>${tx('الموازنة مقابل الفعلي', 'Budget vs actual')}</h3>
        ${budget ? table(
          [tx('الرمز', 'Code'), tx('الحالة', 'State'), tx('المعتمد', 'Approved'), tx('المنقح', 'Revised'), tx('الملتزم به', 'Committed'), tx('الفعلي', 'Actual'), tx('الفرق', 'Variance')],
          budget.lines.map((row) => `<tr class="${row.over_budget ? 'cp-row-warn' : ''}">
            <td>${esc(row.code)}</td><td>${badge(row.budget_state)}</td>
            <td>${money(row.approved_amount)}</td><td>${money(row.revised_amount)}</td>
            <td>${money(row.open_committed)}</td><td>${money(row.actual_cost)}</td>
            <td>${money(row.variance)}</td>
          </tr>`),
          tx('لا توجد سطور موازنة', 'No budget lines'),
        ) : emptyState(tx('لا توجد بيانات موازنة', 'No budget data'))}
        ${budget ? `<div class="cp-totals">
          <span>${tx('الموازنة الفعالة', 'Effective budget')}: <strong>${money(budget.totals.effective_budget)}</strong></span>
          <span>${tx('الالتزامات المفتوحة', 'Open commitments')}: <strong>${money(budget.totals.open_committed)}</strong></span>
          <span>${tx('التكلفة الفعلية', 'Actual cost')}: <strong>${money(budget.totals.actual_cost)}</strong></span>
          <span>${tx('الفرق', 'Variance')}: <strong>${money(budget.totals.variance)}</strong></span>
        </div>` : ''}
      </section>`;
  }

  function renderCommitments() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('تسجيل التزام', 'Record commitment')}</h3>
        <form class="cp-form" data-cp-form="commitment">
          <label>${tx('رمز التكلفة', 'Cost code')}<select name="cost_code_id" required>
            ${state.rows.costCodes.map((c) => `<option value="${esc(c.id)}">${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
          </select></label>
          <label>${tx('المبلغ', 'Amount')}<input name="amount" type="number" step="0.01" min="0.01" required></label>
          <label>${tx('المصدر', 'Source')}<select name="source_type">
            <option value="purchase_order">${tx('أمر شراء', 'Purchase order')}</option>
            <option value="subcontract">${tx('مقاولة باطن', 'Subcontract')}</option>
            <option value="manual">${tx('يدوي', 'Manual')}</option>
          </select></label>
          <label>${tx('الوصف', 'Description')}<input name="description" maxlength="160"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('تسجيل', 'Record')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('الالتزامات', 'Commitments')}</h3>
        ${table(
          [tx('المصدر', 'Source'), tx('الوصف', 'Description'), tx('المبلغ', 'Amount'), tx('المحرر', 'Released'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
          state.rows.commitments.map((row) => `<tr>
            <td>${esc(row.source_type)}</td><td>${esc(row.description || '—')}</td>
            <td>${money(row.amount)}</td><td>${money(row.released_amount)}</td><td>${badge(row.state)}</td>
            <td>${['open', 'partially_released'].includes(row.state) ? `<button type="button" class="cp-link" data-cp-release="${esc(row.id)}">${tx('تحرير', 'Release')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد التزامات', 'No commitments'),
        )}
      </section>`;
  }

  function renderChangeOrders() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('إنشاء أمر تغيير', 'Create change order')}</h3>
        <form class="cp-form" data-cp-form="change-order">
          <label>${tx('العنوان', 'Title')}<input name="title" required maxlength="140"></label>
          <label>${tx('أثر التكلفة', 'Cost impact')}<input name="cost_impact" type="number" step="0.01" value="0"></label>
          <label>${tx('أثر الإيراد', 'Revenue impact')}<input name="revenue_impact" type="number" step="0.01" value="0"></label>
          <label>${tx('أثر الجدول (أيام)', 'Schedule impact (days)')}<input name="schedule_impact_days" type="number" step="1" value="0"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إنشاء', 'Create')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('أوامر التغيير', 'Change orders')}</h3>
        ${table(
          [tx('الرقم', 'Number'), tx('العنوان', 'Title'), tx('أثر التكلفة', 'Cost'), tx('أثر الإيراد', 'Revenue'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
          state.rows.changeOrders.map((row) => `<tr>
            <td>${esc(row.change_number)}</td><td>${esc(row.title)}</td>
            <td>${money(row.cost_impact)}</td><td>${money(row.revenue_impact)}</td><td>${badge(row.state)}</td>
            <td class="cp-actions">${['draft', 'submitted'].includes(row.state) ? `
              <button type="button" class="cp-link" data-cp-co-approve="${esc(row.id)}">${tx('اعتماد', 'Approve')}</button>
              <button type="button" class="cp-link cp-danger" data-cp-co-reject="${esc(row.id)}">${tx('رفض', 'Reject')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد أوامر تغيير', 'No change orders'),
        )}
      </section>`;
  }

  function renderRisks() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('تسجيل خطر', 'Register risk')}</h3>
        <form class="cp-form" data-cp-form="risk">
          <label>${tx('العنوان', 'Title')}<input name="title" required maxlength="140"></label>
          <label>${tx('الاحتمالية (1-5)', 'Probability (1-5)')}<input name="probability" type="number" min="1" max="5" value="3"></label>
          <label>${tx('الأثر (1-5)', 'Impact (1-5)')}<input name="impact" type="number" min="1" max="5" value="3"></label>
          <label>${tx('التخفيف', 'Mitigation')}<input name="mitigation" maxlength="200"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('تسجيل', 'Register')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('سجل المخاطر', 'Risk register')}</h3>
        ${table(
          [tx('العنوان', 'Title'), tx('الاحتمالية', 'Prob.'), tx('الأثر', 'Impact'), tx('الشدة', 'Severity'), tx('الحالة', 'State'), tx('إجراءات', 'Actions')],
          state.rows.risks.map((row) => `<tr class="${row.severity >= 15 ? 'cp-row-warn' : ''}">
            <td>${esc(row.title)}</td><td>${esc(row.probability)}</td><td>${esc(row.impact)}</td>
            <td>${esc(row.severity)}</td><td>${badge(row.state)}</td>
            <td>${row.state === 'open' ? `<button type="button" class="cp-link" data-cp-risk-mitigate="${esc(row.id)}">${tx('تخفيف', 'Mitigate')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد مخاطر', 'No risks'),
        )}
      </section>`;
  }

  function renderIssues() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('تسجيل مشكلة', 'Raise issue')}</h3>
        <form class="cp-form" data-cp-form="issue">
          <label>${tx('العنوان', 'Title')}<input name="title" required maxlength="140"></label>
          <label>${tx('الخطورة', 'Severity')}<select name="severity">
            <option value="low">${tx('منخفضة', 'Low')}</option>
            <option value="medium" selected>${tx('متوسطة', 'Medium')}</option>
            <option value="high">${tx('عالية', 'High')}</option>
            <option value="critical">${tx('حرجة', 'Critical')}</option>
          </select></label>
          <label>${tx('الوصف', 'Description')}<input name="description" maxlength="200"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('تسجيل', 'Raise')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('المشكلات', 'Issues')}</h3>
        ${table(
          [tx('العنوان', 'Title'), tx('الخطورة', 'Severity'), tx('الحالة', 'State'), tx('الحل', 'Resolution'), tx('إجراءات', 'Actions')],
          state.rows.issues.map((row) => `<tr class="${row.severity === 'critical' && row.state === 'open' ? 'cp-row-warn' : ''}">
            <td>${esc(row.title)}</td><td>${badge(row.severity)}</td><td>${badge(row.state)}</td>
            <td>${esc(row.resolution || '—')}</td>
            <td>${['open', 'in_progress'].includes(row.state) ? `<button type="button" class="cp-link" data-cp-issue-resolve="${esc(row.id)}">${tx('حل', 'Resolve')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد مشكلات', 'No issues'),
        )}
      </section>`;
  }

  function renderMilestones() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('إضافة معلم', 'Add milestone')}</h3>
        <form class="cp-form" data-cp-form="milestone">
          <label>${tx('الاسم', 'Name')}<input name="name" required maxlength="140"></label>
          <label>${tx('تاريخ الاستحقاق', 'Due date')}<input name="due_date" type="date"></label>
          <label>${tx('مبلغ الفوترة', 'Billing amount')}<input name="billing_amount" type="number" step="0.01" min="0" value="0"></label>
          <label>${tx('قابل للفوترة', 'Billable')}<select name="is_billable"><option value="1">${tx('نعم', 'Yes')}</option><option value="0">${tx('لا', 'No')}</option></select></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('إضافة', 'Add')}</button>
        </form>
      </section>
      <section class="cp-panel">
        <h3>${tx('المعالم', 'Milestones')}</h3>
        ${table(
          [tx('الاسم', 'Name'), tx('الاستحقاق', 'Due'), tx('مبلغ الفوترة', 'Billing'), tx('الحالة', 'Status'), tx('إجراءات', 'Actions')],
          state.rows.milestones.map((row) => `<tr>
            <td>${esc(row.name)}</td><td>${date(row.due_date)}</td><td>${money(row.billing_amount)}</td>
            <td>${badge(row.status)}</td>
            <td class="cp-actions">
              ${row.status === 'pending' ? `<button type="button" class="cp-link" data-cp-milestone-achieve="${esc(row.id)}">${tx('تحقيق', 'Achieve')}</button>` : ''}
              ${row.status === 'achieved' && row.is_billable && !row.billing_request_id ? `<button type="button" class="cp-link" data-cp-milestone-bill="${esc(row.id)}" data-cp-amount="${esc(row.billing_amount)}">${tx('فوترة', 'Bill')}</button>` : ''}
              ${row.status !== 'pending' && !(row.status === 'achieved' && row.is_billable && !row.billing_request_id) ? '—' : ''}
            </td>
          </tr>`),
          tx('لا توجد معالم', 'No milestones'),
        )}
      </section>`;
  }

  function renderDocuments() {
    const project = selectedProject();
    if (!project) return needProject();
    const docs = Array.isArray(project.documents) ? project.documents : [];
    return `<section class="cp-panel">
      <h3>${tx('وثائق المشروع', 'Project documents')}</h3>
      ${docs.length ? `<ul class="cp-docs">${docs.map((d) => `<li><i class="fa-regular fa-file"></i>${esc(typeof d === 'string' ? d : (d.name || d.url || ''))}</li>`).join('')}</ul>`
        : emptyState(tx('لا توجد وثائق مرفقة', 'No attached documents'))}
      <p class="cp-hint"><i class="fa-solid fa-circle-info"></i>${tx('المرفقات تُدار عبر إجراء تحديث المشروع المحكوم.', 'Attachments are managed through the governed project update action.')}</p>
    </section>`;
  }

  function renderBilling() {
    const project = selectedProject();
    if (!project) return needProject();
    return `
      <section class="cp-panel">
        <h3>${tx('طلب فوترة', 'Request billing')}</h3>
        <form class="cp-form" data-cp-form="billing">
          <label>${tx('المبلغ الإجمالي', 'Gross amount')}<input name="amount" type="number" step="0.01" min="0.01" required></label>
          <label>${tx('طريقة الفوترة', 'Billing method')}<select name="billing_method">
            <option value="fixed_price">${tx('سعر ثابت', 'Fixed price')}</option>
            <option value="milestone">${tx('حسب المعالم', 'Milestone')}</option>
            <option value="time_and_material">${tx('وقت ومواد', 'Time & material')}</option>
          </select></label>
          <label>${tx('المعلم', 'Milestone')}<select name="milestone_id">
            <option value="">${tx('بدون', 'None')}</option>
            ${state.rows.milestones.filter((m) => m.status === 'achieved').map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
          </select></label>
          <label>${tx('الوصف', 'Description')}<input name="description" maxlength="160"></label>
          <button type="submit" ${state.busy ? 'disabled' : ''}>${tx('طلب', 'Request')}</button>
        </form>
        <p class="cp-hint"><i class="fa-solid fa-shield-halved"></i>${tx('المالية هي الكاتب الوحيد لدفتر الأستاذ؛ هذه الشاشة ترفع طلباً محكوماً فقط.', 'Finance is the only GL writer; this screen raises a governed request only.')}</p>
      </section>
      <section class="cp-panel">
        <h3>${tx('طلبات الفوترة', 'Billing requests')}</h3>
        ${table(
          [tx('الطريقة', 'Method'), tx('الإجمالي', 'Gross'), tx('المحتجز', 'Retention'), tx('الصافي', 'Net'), tx('الحالة', 'State'), tx('مستند المالية', 'Finance doc'), tx('إجراءات', 'Actions')],
          state.rows.billing.map((row) => `<tr>
            <td>${esc(row.billing_method)}</td><td>${money(row.gross_amount)}</td>
            <td>${money(row.retention_amount)}</td><td>${money(row.net_amount)}</td>
            <td>${badge(row.state)}</td><td>${esc(row.finance_document_id || '—')}</td>
            <td>${row.state === 'draft' ? `<button type="button" class="cp-link" data-cp-billing-approve="${esc(row.id)}">${tx('اعتماد', 'Approve')}</button>` : '—'}</td>
          </tr>`),
          tx('لا توجد طلبات فوترة', 'No billing requests'),
        )}
      </section>`;
  }

  function renderProfitability() {
    const project = selectedProject();
    if (!project) return needProject();
    const p = state.detail.profitability;
    if (!p) return emptyState(tx('لا توجد بيانات ربحية', 'No profitability data'));
    return `
      <div class="cp-kpis">
        ${kpi(tx('قيمة العقد', 'Contract value'), money(p.contract_value), '', 'fa-file-contract')}
        ${kpi(tx('الإيراد المعترف به', 'Recognised revenue'), money(p.recognised_revenue), tx('مفوتر + معتمد', 'invoiced + approved'), 'fa-coins')}
        ${kpi(tx('التكلفة الفعلية', 'Actual cost'), money(p.actual_cost), tx('مشتقة من الحقائق', 'derived from facts'), 'fa-sack-dollar')}
        ${kpi(tx('الهامش', 'Margin'), money(p.margin), `${esc(p.margin_percent)}%`, 'fa-chart-pie')}
        ${kpi(tx('المحتجز', 'Retention held'), money(p.retention_held), '', 'fa-vault')}
      </div>
      <section class="cp-panel">
        <h3>${tx('تفصيل التكلفة', 'Cost breakdown')}</h3>
        ${table(
          [tx('البند', 'Component'), tx('المبلغ', 'Amount')],
          [
            [tx('مواد', 'Material'), p.material_cost],
            [tx('مشتريات', 'Procurement'), p.procurement_cost],
            [tx('مقاولة باطن', 'Subcontract'), p.subcontract_cost],
            [`${tx('عمالة', 'Labor')} (${esc(p.labor_hours)}h)`, p.labor_cost],
            [`${tx('آلات', 'Machine')} (${esc(p.machine_hours)}h)`, p.machine_cost],
            [tx('أعباء غير مباشرة', 'Overhead'), p.overhead_cost],
          ].map(([label, value]) => `<tr><td>${label}</td><td>${money(value)}</td></tr>`),
          tx('لا توجد تكاليف', 'No costs'),
        )}
        <p class="cp-hint"><i class="fa-solid fa-circle-info"></i>${tx('كل هذه الأرقام مشتقة وقت القراءة من الحقائق القانونية ولا تُخزَّن كسلطة مستقلة.', 'Every figure here is derived at read time from canonical facts and is never stored as an independent authority.')}</p>
      </section>`;
  }

  function renderResources() {
    return `<section class="cp-panel">
      <h3>${tx('عرض الموارد', 'Resource view')}</h3>
      <p class="cp-hint"><i class="fa-solid fa-shield-halved"></i>${tx('الجهد مسجَّل كحقائق مشاريع جديدة بمعدلات تكلفة معيارية — لا يقرأ ولا يكتب الرواتب أو الحضور.', 'Effort is recorded as new project facts at configured standard rates — payroll and attendance are never read or written.')}</p>
      ${table(
        [tx('المرجع', 'Reference'), tx('الدور', 'Role'), tx('النوع', 'Type'), tx('عدد القيود', 'Entries'), tx('الساعات', 'Hours'), tx('التكلفة', 'Cost')],
        state.rows.resources.map((row) => `<tr>
          <td>${esc(row.employee_ref || '—')}</td><td>${esc(row.role_key)}</td><td>${esc(row.entry_type)}</td>
          <td>${esc(row.entries)}</td><td>${esc(Number(row.hours || 0))}</td><td>${money(row.cost)}</td>
        </tr>`),
        tx('لا يوجد جهد مسجل', 'No effort recorded'),
      )}
    </section>`;
  }

  function renderReports() {
    return `
      <section class="cp-panel">
        <nav class="cp-report-tabs">
          ${REPORTS.map(([key, ar, en]) => `<button type="button" class="${state.report === key ? 'active' : ''}" data-cp-report="${key}">${tx(ar, en)}</button>`).join('')}
        </nav>
      </section>
      <section class="cp-panel">
        <h3>${tx('نتيجة التقرير', 'Report result')}</h3>
        ${renderReportTable(state.rows.report)}
      </section>`;
  }

  function renderReportTable(rows) {
    if (!Array.isArray(rows) || !rows.length) return emptyState(tx('لا توجد بيانات لهذا التقرير', 'No data for this report'));
    const headers = Object.keys(rows[0]).slice(0, 9);
    return table(
      headers,
      rows.slice(0, 200).map((row) => `<tr>${headers.map((h) => {
        const value = row[h];
        if (typeof value === 'number') return `<td>${money(value)}</td>`;
        if (value && typeof value === 'object') return `<td>${esc(JSON.stringify(value).slice(0, 60))}</td>`;
        return `<td>${esc(value == null ? '—' : value)}</td>`;
      }).join('')}</tr>`),
      tx('لا توجد بيانات', 'No data'),
    );
  }

  function renderActive() {
    switch (state.active) {
      case 'dashboard': return renderDashboard();
      case 'projects': return renderProjects();
      case 'templates': return renderTemplates();
      case 'phases': return renderPhases();
      case 'milestones': return renderMilestones();
      case 'wbs': return renderWbs();
      case 'tasks': return renderTasks();
      case 'budget': return renderBudget();
      case 'commitments': return renderCommitments();
      case 'cost-codes': return renderCostCodes();
      case 'change-orders': return renderChangeOrders();
      case 'risks': return renderRisks();
      case 'issues': return renderIssues();
      case 'documents': return renderDocuments();
      case 'billing': return renderBilling();
      case 'profitability': return renderProfitability();
      case 'resources': return renderResources();
      case 'reports': return renderReports();
      default: return renderDashboard();
    }
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  async function refresh() {
    const api = client();
    if (!api) {
      state.error = tx('طبقة النقل القانونية غير متاحة.', 'The canonical transport layer is unavailable.');
      shell();
      return;
    }
    state.loading = true;
    state.error = null;
    shell();
    try {
      const [projects, templates, resources, costRates] = await Promise.all([
        api.projects.list(),
        api.projects.listTemplates(),
        api.projects.resources(),
        api.projects.costRates(),
      ]);
      state.rows.projects = projects || [];
      state.rows.templates = templates || [];
      state.rows.resources = resources || [];
      state.rows.costRates = costRates || [];

      if (state.selectedProjectId && !state.rows.projects.some((p) => p.id === state.selectedProjectId)) {
        state.selectedProjectId = null;
      }
      if (!state.selectedProjectId && state.rows.projects.length) {
        state.selectedProjectId = state.rows.projects[0].id;
      }
      if (state.selectedProjectId) await loadProjectDetail(state.selectedProjectId);
      state.rows.report = await api.projects.report(state.report);
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false;
      shell();
    }
  }

  async function loadProjectDetail(projectId) {
    const api = client();
    if (!api || !projectId) return;
    const params = { project_id: projectId };
    const [detail, phases, milestones, costCodes, commitments, changeOrders, risks, issues, tasks, effort, billing, budget, profitability] =
      await Promise.all([
        api.projects.get(projectId),
        api.projects.listPhases(params),
        api.projects.listMilestones(params),
        api.projects.listCostCodes(params),
        api.projects.listCommitments(params),
        api.projects.listChangeOrders(params),
        api.projects.listRisks(params),
        api.projects.listIssues(params),
        api.projects.listTasks(projectId),
        api.projects.listEffort(params),
        api.projects.listBilling(params),
        api.projects.budget(projectId),
        api.projects.profitability(params),
      ]);
    state.detail.project = detail;
    state.rows.phases = phases || [];
    state.rows.milestones = milestones || [];
    state.rows.costCodes = costCodes || [];
    state.rows.commitments = commitments || [];
    state.rows.changeOrders = changeOrders || [];
    state.rows.risks = risks || [];
    state.rows.issues = issues || [];
    state.rows.tasks = tasks || [];
    state.rows.effort = effort || [];
    state.rows.billing = billing || [];
    state.detail.budget = budget || null;
    state.detail.profitability = profitability || null;
  }

  async function command(successMessage, run) {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    state.notice = null;
    shell();
    try {
      await run();
      state.notice = successMessage;
      await refresh();
    } catch (error) {
      state.error = normalizeError(error);
      state.busy = false;
      shell();
      return;
    }
    state.busy = false;
    shell();
  }

  async function selectProject(projectId) {
    state.selectedProjectId = projectId;
    state.loading = true;
    shell();
    try {
      await loadProjectDetail(projectId);
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false;
      shell();
    }
  }

  // -------------------------------------------------------------------------
  // Binding
  // -------------------------------------------------------------------------

  function bind(el) {
    const api = client();
    const project = () => state.selectedProjectId;

    el.querySelectorAll('[data-cp-tab]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.active = button.dataset.cpTab;
        state.notice = null;
        if (state.active === 'reports') {
          state.loading = true;
          shell();
          try { state.rows.report = await api.projects.report(state.report); }
          catch (error) { state.error = normalizeError(error); }
          finally { state.loading = false; shell(); }
        } else shell();
      });
    });

    el.querySelectorAll('[data-cp-action="refresh"]').forEach((b) => b.addEventListener('click', () => refresh()));
    el.querySelectorAll('[data-cp-select]').forEach((b) => b.addEventListener('click', () => selectProject(b.dataset.cpSelect)));

    el.querySelectorAll('[data-cp-report]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.report = button.dataset.cpReport;
        state.loading = true;
        shell();
        try { state.rows.report = await api.projects.report(state.report); }
        catch (error) { state.error = normalizeError(error); }
        finally { state.loading = false; shell(); }
      });
    });

    el.querySelectorAll('[data-cp-status]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم تحديث حالة المشروع.', 'Project status updated.'),
      () => api.projects.setStatus({ project_id: b.dataset.cpStatus, status: b.dataset.cpTo }),
    )));

    const form = (name) => el.querySelector(`[data-cp-form="${name}"]`);
    const on = (name, handler) => {
      const node = form(name);
      if (node) node.addEventListener('submit', (event) => { event.preventDefault(); handler(new FormData(node)); });
    };

    on('project', (data) => command(tx('تم إنشاء المشروع.', 'Project created.'), () => api.projects.create({
      name: data.get('name'),
      contract_value: Number(data.get('contract_value') || 0),
      billing_method: data.get('billing_method'),
      retention_percent: Number(data.get('retention_percent') || 0),
      start_date: data.get('start_date') || null,
      end_date: data.get('end_date') || null,
      template_id: data.get('template_id') || null,
    })));

    on('template', (data) => command(tx('تم إنشاء القالب.', 'Template created.'), () => api.projects.createTemplate({
      name: data.get('name'),
      code: data.get('code') || undefined,
      phases: String(data.get('phases') || '').split(',').map((s) => s.trim()).filter(Boolean)
        .map((name, index) => ({ key: name, name, sequence: (index + 1) * 10 })),
      cost_codes: String(data.get('cost_codes') || '').split(',').map((s) => s.trim()).filter(Boolean)
        .map((code) => ({ code, name: code })),
    })));

    on('phase', (data) => command(tx('تمت إضافة المرحلة.', 'Phase added.'), () => api.projects.createPhase({
      project_id: project(),
      name: data.get('name'),
      wbs_code: data.get('wbs_code') || '',
      planned_start: data.get('planned_start') || null,
      planned_end: data.get('planned_end') || null,
      parent_phase_id: data.get('parent_phase_id') || null,
    })));

    on('milestone', (data) => command(tx('تمت إضافة المعلم.', 'Milestone added.'), () => api.projects.createMilestone({
      project_id: project(),
      name: data.get('name'),
      due_date: data.get('due_date') || null,
      billing_amount: Number(data.get('billing_amount') || 0),
      is_billable: data.get('is_billable') === '1',
    })));

    on('task', (data) => command(tx('تمت إضافة المهمة كعنصر عمل قانوني.', 'Task added as a canonical Work Item.'), () => api.projects.createTask({
      project_id: project(),
      title: data.get('title'),
      phase_id: data.get('phase_id') || null,
      estimated_hours: Number(data.get('estimated_hours') || 0),
      due_date: data.get('due_date') || null,
    })));

    on('cost-code', (data) => command(tx('تمت إضافة رمز التكلفة.', 'Cost code added.'), () => api.projects.createCostCode({
      project_id: project(),
      code: data.get('code'),
      name: data.get('name'),
      cost_type: data.get('cost_type'),
    })));

    on('budget', (data) => command(tx('تم حفظ سطر الموازنة.', 'Budget line saved.'), () => api.projects.setBudgetLine({
      project_id: project(),
      cost_code_id: data.get('cost_code_id'),
      amount: Number(data.get('amount')),
    })));

    on('commitment', (data) => command(tx('تم تسجيل الالتزام.', 'Commitment recorded.'), () => api.projects.recordCommitment({
      project_id: project(),
      cost_code_id: data.get('cost_code_id'),
      amount: Number(data.get('amount')),
      source_type: data.get('source_type'),
      description: data.get('description') || '',
    })));

    on('change-order', (data) => command(tx('تم إنشاء أمر التغيير.', 'Change order created.'), () => api.projects.createChangeOrder({
      project_id: project(),
      title: data.get('title'),
      cost_impact: Number(data.get('cost_impact') || 0),
      revenue_impact: Number(data.get('revenue_impact') || 0),
      schedule_impact_days: Number(data.get('schedule_impact_days') || 0),
    })));

    on('risk', (data) => command(tx('تم تسجيل الخطر.', 'Risk registered.'), () => api.projects.createRisk({
      project_id: project(),
      title: data.get('title'),
      probability: Number(data.get('probability') || 3),
      impact: Number(data.get('impact') || 3),
      mitigation: data.get('mitigation') || '',
    })));

    on('issue', (data) => command(tx('تم تسجيل المشكلة.', 'Issue raised.'), () => api.projects.createIssue({
      project_id: project(),
      title: data.get('title'),
      severity: data.get('severity'),
      description: data.get('description') || '',
    })));

    on('billing', (data) => command(tx('تم رفع طلب الفوترة.', 'Billing request raised.'), () => api.projects.requestBilling({
      project_id: project(),
      amount: Number(data.get('amount')),
      billing_method: data.get('billing_method'),
      milestone_id: data.get('milestone_id') || undefined,
      description: data.get('description') || '',
    })));

    el.querySelectorAll('[data-cp-action="approve-budget"]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم اعتماد الموازنة.', 'Budget approved.'),
      () => api.projects.approveBudget({ project_id: project() }),
    )));
    el.querySelectorAll('[data-cp-apply-template]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم تطبيق القالب.', 'Template applied.'),
      () => api.projects.applyTemplate({ project_id: project(), template_id: b.dataset.cpApplyTemplate }),
    )));
    el.querySelectorAll('[data-cp-phase-complete]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم إكمال المرحلة.', 'Phase completed.'),
      () => api.projects.updatePhase({ phase_id: b.dataset.cpPhaseComplete, status: 'completed', progress: 100 }),
    )));
    el.querySelectorAll('[data-cp-milestone-achieve]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم تحقيق المعلم.', 'Milestone achieved.'),
      () => api.projects.achieveMilestone({ milestone_id: b.dataset.cpMilestoneAchieve }),
    )));
    el.querySelectorAll('[data-cp-milestone-bill]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم رفع طلب فوترة المعلم.', 'Milestone billing requested.'),
      () => api.projects.requestBilling({
        project_id: project(),
        milestone_id: b.dataset.cpMilestoneBill,
        billing_method: 'milestone',
        amount: Number(b.dataset.cpAmount || 0),
      }),
    )));
    el.querySelectorAll('[data-cp-release]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم تحرير الالتزام.', 'Commitment released.'),
      () => api.projects.releaseCommitment({ commitment_id: b.dataset.cpRelease }),
    )));
    el.querySelectorAll('[data-cp-co-approve]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم اعتماد أمر التغيير.', 'Change order approved.'),
      () => api.projects.approveChangeOrder({
        change_order_id: b.dataset.cpCoApprove,
        cost_code_id: state.rows.costCodes[0] ? state.rows.costCodes[0].id : undefined,
      }),
    )));
    el.querySelectorAll('[data-cp-co-reject]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم رفض أمر التغيير.', 'Change order rejected.'),
      () => api.projects.rejectChangeOrder({ change_order_id: b.dataset.cpCoReject }),
    )));
    el.querySelectorAll('[data-cp-risk-mitigate]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم تحديث الخطر.', 'Risk updated.'),
      () => api.projects.updateRisk({ risk_id: b.dataset.cpRiskMitigate, state: 'mitigated' }),
    )));
    el.querySelectorAll('[data-cp-issue-resolve]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم حل المشكلة.', 'Issue resolved.'),
      () => api.projects.resolveIssue({ issue_id: b.dataset.cpIssueResolve, resolution: 'Resolved from Projects workspace' }),
    )));
    el.querySelectorAll('[data-cp-billing-approve]').forEach((b) => b.addEventListener('click', () => command(
      tx('تم اعتماد طلب الفوترة.', 'Billing request approved.'),
      () => api.projects.approveBilling({ billing_request_id: b.dataset.cpBillingApprove }),
    )));
  }

  function activate() {
    shell();
    refresh();
  }

  const previousRender = root.renderProjectsPage;
  root.renderProjectsPage = function renderCanonicalProjects() { activate(); };
  root.CanonicalProjects = {
    activate,
    refresh,
    state,
    TABS: tabs.map(([key, ar, en, icon]) => ({ key, label: { ar, en }, icon })),
    previousRender,
    selectTab(key) { state.active = key; shell(); },
  };

  // `projects` is a core pageMap entry, so the shell asynchronously hydrates
  // views/projects.html into #pageProjects. That fetch resolves AFTER
  // switchPage's synchronous render dispatch and would overwrite this
  // workspace with the retired legacy markup. Wrapping switchPage and
  // activating only once the template load has settled makes the ordering
  // deterministic instead of a race. Follows the established module
  // switchPage-wrap pattern (see modules/appointments.js).
  function wireSwitch() {
    if (root.__canonicalProjectsWrapped || typeof root.switchPage !== 'function') return;
    const orig = root.switchPage;
    root.switchPage = function (page) {
      const result = orig.apply(this, arguments);
      if (page === 'projects') {
        const settle = typeof root.ensurePageTemplateLoaded === 'function'
          ? Promise.resolve(root.ensurePageTemplateLoaded('projects')).catch(() => {})
          : Promise.resolve();
        settle.then(() => {
          // Re-check: the user may have navigated away while the view loaded.
          const el = host();
          if (el && el.classList.contains('page-active')) activate();
        });
      }
      return result;
    };
    root.__canonicalProjectsWrapped = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSwitch, { once: true });
  } else {
    wireSwitch();
  }

  const mount = document.getElementById('pageProjects');
  if (mount && mount.classList.contains('page-active')) activate();
})(window);
