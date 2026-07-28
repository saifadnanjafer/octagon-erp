(function (root) {
  'use strict';

  // Checkpoint C4: every visible task surface reads and writes the canonical
  // Work Item authority through CanonicalClient.
  root.__canonicalWorkManagementAuthorityActive = true;

  const tabs = [
    ['task_manager', 'مدير المهام', 'Task Manager', 'fa-list-check'],
    ['kanban', 'كانبان', 'Kanban', 'fa-table-columns'],
    ['calendar', 'التقويم', 'Calendar', 'fa-calendar-days'],
    ['my_tasks', 'مهامي', 'My Tasks', 'fa-user-check'],
    ['workload', 'عبء الفريق', 'Team Workload', 'fa-people-group'],
    ['workshop_tv', 'شاشة الورشة', 'Workshop TV', 'fa-tv'],
    ['mobile', 'مهام الجوال', 'Mobile Tasks', 'fa-mobile-screen'],
    ['sla', 'قائمة SLA', 'SLA Worklist', 'fa-stopwatch'],
    ['dependencies', 'الاعتماديات', 'Dependency View', 'fa-diagram-project'],
  ];
  const stages = [
    ['backlog', 'المتراكم', 'Backlog'],
    ['planned', 'مخطط', 'Planned'],
    ['in_progress', 'قيد التنفيذ', 'In Progress'],
    ['review', 'مراجعة', 'Review'],
    ['blocked', 'محجوب', 'Blocked'],
    ['done', 'مكتمل', 'Done'],
  ];
  const state = {
    active: 'task_manager',
    loading: false,
    error: null,
    notice: null,
    selectedId: null,
    search: '',
    group: 'stage',
    sort: 'due_date',
    rows: [],
    mineRows: [],
    reports: { workload: [], overdue: [], sla: [], inactive: [], completion: [] },
  };

  function language() {
    return String(document.documentElement.lang || 'ar').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  }
  function tx(ar, en) { return language() === 'ar' ? ar : en; }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }
  function api() {
    if (!root.CanonicalClient?.workItems) throw new Error('Canonical Work Item client is unavailable');
    return root.CanonicalClient.workItems;
  }
  function host() { return document.getElementById('pageTaskManager'); }
  function dateValue(value) { return value ? String(value).slice(0, 10) : ''; }
  function formatDate(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleDateString(language() === 'ar' ? 'ar-IQ' : 'en-GB'); } catch (_) { return value; }
  }
  function normalizeError(error) {
    if (error?.isAuthorization || Number(error?.status) === 401 || Number(error?.status) === 403) {
      return tx('ليس لديك صلاحية لتنفيذ هذا الإجراء.', 'You are not authorized to perform this action.');
    }
    return error?.message || tx('تعذر إكمال الطلب.', 'The request could not be completed.');
  }
  function selected() { return state.rows.find((row) => row.id === state.selectedId) || null; }
  function openRows() { return state.rows.filter((row) => !['done', 'cancelled', 'archived'].includes(row.status)); }
  function importance(value) {
    const count = Math.max(1, Math.min(5, Number(value) || 3));
    return `<span class="cwm-importance" aria-label="${escapeHtml(tx('الأهمية', 'Importance'))} ${count}">${[1, 2, 3, 4, 5].map((level) => `<i class="${level <= count ? 'active' : ''}"></i>`).join('')}</span>`;
  }
  function riskClass(row) {
    if (row.status === 'done') return 'cwm-done';
    if (row.is_overdue) return 'cwm-overdue';
    if (!row.due_date) return 'cwm-no-date';
    const days = Math.ceil((Date.parse(row.due_date) - Date.now()) / 86_400_000);
    if (days <= 1) return 'cwm-due-now';
    if (days <= 3) return 'cwm-due-soon';
    return 'cwm-on-track';
  }
  function card(row, compact = false) {
    const blockers = row.dependencies?.length || 0;
    const subtasks = row.subtasks?.length || 0;
    return `<article class="cwm-card ${riskClass(row)} ${compact ? 'compact' : ''}" style="--cwm-opacity:${Number(row.visual_opacity || 1)}" data-cwm-task="${escapeHtml(row.id)}" draggable="${row.status === 'done' ? 'false' : 'true'}">
      <div class="cwm-card-head"><span class="cwm-priority cwm-priority-${escapeHtml(row.priority)}">${escapeHtml(row.priority)}</span>${importance(row.importance)}</div>
      <h4>${escapeHtml(row.title)}</h4>
      ${compact ? '' : `<p>${escapeHtml(row.description || tx('لا يوجد وصف', 'No description'))}</p>`}
      <div class="cwm-card-meta"><span><i class="fa-regular fa-user"></i>${escapeHtml(row.assigned_user_id || tx('غير مسند', 'Unassigned'))}</span><span><i class="fa-regular fa-calendar"></i>${formatDate(row.due_date)}</span></div>
      <div class="cwm-card-links"><span>${escapeHtml(row.stage)}</span><span>${Number(row.progress || 0)}%</span>${blockers ? `<span><i class="fa-solid fa-link"></i>${blockers}</span>` : ''}${subtasks ? `<span><i class="fa-solid fa-code-branch"></i>${subtasks}</span>` : ''}</div>
      <div class="cwm-progress"><i style="width:${Math.max(0, Math.min(100, Number(row.progress || 0)))}%"></i></div>
    </article>`;
  }
  function empty(label) {
    return `<div class="cwm-empty"><i class="fa-regular fa-folder-open"></i><p>${escapeHtml(label)}</p></div>`;
  }
  function filteredRows() {
    const search = state.search.trim().toLowerCase();
    const rows = search
      ? state.rows.filter((row) => `${row.title} ${row.description || ''} ${row.assigned_user_id || ''} ${row.assigned_team_id || ''}`.toLowerCase().includes(search))
      : [...state.rows];
    const direction = state.sort === 'importance' ? -1 : 1;
    return rows.sort((a, b) => String(a[state.sort] || '').localeCompare(String(b[state.sort] || '')) * direction);
  }
  function createForm() {
    return `<form class="cwm-form cwm-create-form" data-cwm-form="create">
      <div class="cwm-form-heading"><h3>${tx('إنشاء مهمة قانونية', 'Create canonical task')}</h3><span>${tx('سجل واحد لكل العروض', 'One record across every view')}</span></div>
      <label>${tx('العنوان', 'Title')}<input name="title" required></label>
      <label class="wide">${tx('الوصف', 'Description')}<textarea name="description" rows="2"></textarea></label>
      <label>${tx('المسند إليه', 'Assignee')}<input name="assigned_user_id" value="usr_test_workshop"></label>
      <label>${tx('الفريق', 'Team')}<input name="assigned_team_id" value="team-workshop"></label>
      <label>${tx('الأولوية', 'Priority')}<select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
      <label>${tx('الأهمية', 'Importance')}<select name="importance">${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${value === 3 ? 'selected' : ''}>${value}/5</option>`).join('')}</select></label>
      <label>${tx('البداية', 'Start')}<input type="date" name="start_date"></label>
      <label>${tx('الاستحقاق', 'Due')}<input type="date" name="due_date" required></label>
      <label>${tx('الجهد المتوقع', 'Estimated effort')}<input type="number" min="0" step="0.25" name="estimated_hours" value="2"></label>
      <label>${tx('التكرار', 'Recurrence')}<select name="recurrence_rule"><option value="none">None</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      <label>${tx('موعد SLA', 'SLA due')}<input type="datetime-local" name="sla_due_at"></label>
      <label>${tx('المراقبون', 'Watchers')}<input name="watchers" placeholder="user-1, user-2"></label>
      <label>${tx('رابط المشروع', 'Project link')}<input name="project_ref"></label>
      <label>${tx('رابط المبيعات', 'Sales link')}<input name="sales_ref"></label>
      <label>${tx('رابط المشتريات', 'Procurement link')}<input name="procurement_ref"></label>
      <label>${tx('رابط الجودة', 'Quality link')}<input name="quality_ref"></label>
      <label>${tx('رابط الصيانة', 'Maintenance link')}<input name="maintenance_ref"></label>
      <label class="wide">${tx('قائمة الفحص', 'Checklist')}<input name="checklist" placeholder="${escapeHtml(tx('سلامة، أدوات، جودة', 'Safety, tools, quality'))}"></label>
      <label class="wide">${tx('\u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062a', 'Attachments')}<input name="attachments" placeholder="${escapeHtml(tx('\u0627\u0633\u0645 \u0645\u0644\u0641\u060c \u0631\u0627\u0628\u0637 \u0623\u0648 \u0645\u0631\u062c\u0639', 'File name, link, or reference'))}"></label>
      <label class="wide">${tx('\u0627\u0644\u062a\u0639\u0644\u064a\u0642\u0627\u062a', 'Comments')}<textarea name="comments" rows="2" placeholder="${escapeHtml(tx('\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u062a\u0646\u0641\u064a\u0630', 'Execution notes'))}"></textarea></label>
      <button class="cwm-primary" type="submit"><i class="fa-solid fa-plus"></i>${tx('إنشاء المهمة', 'Create task')}</button>
    </form>`;
  }
  function inspector(row) {
    if (!row) return `<aside class="cwm-inspector">${empty(tx('اختر مهمة لعرض العلاقات والإجراءات.', 'Select a task to inspect relations and actions.'))}</aside>`;
    const candidates = state.rows.filter((candidate) => candidate.id !== row.id && !row.dependencies?.some((dep) => dep.blocker_work_item_id === candidate.id));
    return `<aside class="cwm-inspector" data-cwm-inspector="${escapeHtml(row.id)}">
      <header><div><span>${escapeHtml(row.id)}</span><h3>${escapeHtml(row.title)}</h3></div>${importance(row.importance)}</header>
      <div class="cwm-inspector-grid">
        <span>${tx('الحالة', 'Status')}<b>${escapeHtml(row.status)}</b></span>
        <span>${tx('المرحلة', 'Stage')}<b>${escapeHtml(row.stage)}</b></span>
        <span>${tx('العمر', 'Aging')}<b>${Number(row.aging_days || 0)} ${tx('يوم', 'days')}</b></span>
        <span>${tx('الخمول', 'Inactive')}<b>${Number(row.inactivity_days || 0)} ${tx('يوم', 'days')}</b></span>
      </div>
      <form data-cwm-form="assign" class="cwm-inline-form">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="expected_version" value="${Number(row.version)}">
        <input name="assigned_user_id" value="${escapeHtml(row.assigned_user_id || '')}" placeholder="${escapeHtml(tx('المسند', 'Assignee'))}">
        <input name="assigned_team_id" value="${escapeHtml(row.assigned_team_id || '')}" placeholder="${escapeHtml(tx('الفريق', 'Team'))}">
        <button>${tx('إسناد', 'Assign')}</button>
      </form>
      <form data-cwm-form="subtask" class="cwm-inline-form">
        <input type="hidden" name="parent_id" value="${escapeHtml(row.id)}">
        <input name="title" required placeholder="${escapeHtml(tx('عنوان المهمة الفرعية', 'Subtask title'))}">
        <button>${tx('إضافة فرعية', 'Add subtask')}</button>
      </form>
      <form data-cwm-form="dependency" class="cwm-inline-form">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="expected_version" value="${Number(row.version)}">
        <select name="blocker_work_item_id" required><option value="">${tx('اختر السابق', 'Choose predecessor')}</option>${candidates.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(candidate.title)}</option>`).join('')}</select>
        <button>${tx('إضافة اعتماد', 'Add dependency')}</button>
      </form>
      <form data-cwm-form="due" class="cwm-inline-form">
        <input type="hidden" name="id" value="${escapeHtml(row.id)}"><input type="hidden" name="expected_version" value="${Number(row.version)}">
        <input type="date" name="due_date" value="${dateValue(row.due_date)}" required>
        <button>${tx('تحريك الموعد', 'Move date')}</button>
      </form>
      <div class="cwm-relations">
        <h4>${tx('السابقون واللاحقون', 'Predecessors & successors')}</h4>
        ${(row.dependencies || []).map((dep) => `<span><i class="fa-solid fa-arrow-right"></i>${escapeHtml(state.rows.find((candidate) => candidate.id === dep.blocker_work_item_id)?.title || dep.blocker_work_item_id)}</span>`).join('') || `<small>${tx('لا توجد اعتماديات', 'No dependencies')}</small>`}
        ${(row.blockers || []).map((dep) => `<span><i class="fa-solid fa-arrow-left"></i>${escapeHtml(state.rows.find((candidate) => candidate.id === dep.work_item_id)?.title || dep.work_item_id)}</span>`).join('')}
        <h4>${tx('المهام الفرعية', 'Subtasks')}</h4>
        ${(row.subtasks || []).map((subtask) => `<span>${escapeHtml(subtask.title)} · ${escapeHtml(subtask.status)}</span>`).join('') || `<small>${tx('لا توجد مهام فرعية', 'No subtasks')}</small>`}
      </div>
      <div class="cwm-inspector-actions">
        <button data-cwm-complete="${escapeHtml(row.id)}" data-version="${Number(row.version)}" ${row.status === 'done' ? 'disabled' : ''}><i class="fa-solid fa-check"></i>${tx('إكمال', 'Complete')}</button>
        <button data-cwm-cancel="${escapeHtml(row.id)}" data-version="${Number(row.version)}" ${['done', 'cancelled'].includes(row.status) ? 'disabled' : ''}><i class="fa-solid fa-ban"></i>${tx('إلغاء', 'Cancel')}</button>
      </div>
    </aside>`;
  }
  function taskManagerView() {
    const rows = filteredRows();
    const keyFor = (row) => {
      if (state.group === 'team') return row.assigned_team_id || tx('غير مسند لفريق', 'No team');
      if (state.group === 'assignee') return row.assigned_user_id || tx('غير مسند', 'Unassigned');
      return row.stage || tx('بلا مرحلة', 'No stage');
    };
    const groups = new Map();
    for (const row of rows) {
      const key = keyFor(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const grouped = [...groups.entries()].map(([key, items]) => `<section class="cwm-task-group" data-cwm-group-value="${escapeHtml(key)}"><header><h3>${escapeHtml(key)}</h3><b>${items.length}</b></header><div class="cwm-task-list">${items.map((row) => card(row)).join('')}</div></section>`).join('');
    return `<div class="cwm-task-layout"><section>${grouped || empty(tx('لا توجد مهام.', 'No tasks.'))}${createForm()}</section>${inspector(selected())}</div>`;
  }
  function kanbanView() {
    const rows = filteredRows();
    return `<div class="cwm-kanban">${stages.map(([stage, ar, en]) => {
      const cards = rows.filter((row) => row.stage === stage);
      return `<section class="cwm-kanban-column" data-cwm-drop="${stage}"><header><span>${tx(ar, en)}</span><b>${cards.length}</b></header><div>${cards.map((row) => card(row, true)).join('') || empty(tx('فارغ', 'Empty'))}</div></section>`;
    }).join('')}</div>`;
  }
  function calendarView() {
    const groups = new Map();
    for (const row of filteredRows().filter((item) => item.due_date)) {
      const key = dateValue(row.due_date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return `<div class="cwm-calendar">${[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => `<section><header><span>${formatDate(day)}</span><b>${rows.length}</b></header>${rows.map((row) => card(row, true)).join('')}</section>`).join('') || empty(tx('لا توجد مهام مؤرخة.', 'No dated tasks.'))}</div>`;
  }
  function myTasksView() {
    const search = state.search.trim().toLowerCase();
    const rows = state.mineRows.filter((row) => !search || `${row.title} ${row.description || ''}`.toLowerCase().includes(search));
    return `<div class="cwm-my-tasks"><div class="cwm-mobile-list">${rows.map((row) => card(row, true)).join('') || empty(tx('لا توجد مهام مسندة.', 'No assigned tasks.'))}</div></div>`;
  }
  function workloadView() {
    const rows = state.reports.workload || [];
    const completion = state.reports.completion?.[0] || { total: 0, completed: 0, completion_rate: 0 };
    const max = Math.max(1, ...rows.map((row) => Number(row.estimated_hours || row.open || 0)));
    return `<div class="cwm-workload"><article class="cwm-completion-card"><header><i class="fa-solid fa-chart-pie"></i><div><h3>${tx('معدل الإكمال', 'Completion rate')}</h3><span>${Number(completion.completed)} / ${Number(completion.total)} ${tx('مهمة مكتملة', 'tasks completed')}</span></div></header><div class="cwm-loadbar"><i style="width:${Math.max(0, Math.min(100, Number(completion.completion_rate || 0)))}%"></i></div><footer>${Number(completion.completion_rate || 0)}%</footer></article>${rows.map((row) => `<article><header><i class="fa-solid fa-user-gear"></i><div><h3>${escapeHtml(row.employee)}</h3><span>${Number(row.open)} ${tx('مفتوحة', 'open')} · ${Number(row.overdue)} ${tx('متأخرة', 'overdue')}</span></div></header><div class="cwm-loadbar"><i style="width:${Math.min(100, (Number(row.estimated_hours || row.open) / max) * 100)}%"></i></div><footer>${Number(row.estimated_hours || 0)}h ${tx('مخطط', 'planned')} · ${Number(row.actual_hours || 0)}h ${tx('فعلي', 'actual')}</footer></article>`).join('')}</div>`;
  }
  function workshopTvView() {
    const rows = openRows().sort((a, b) => Number(b.importance) - Number(a.importance)).slice(0, 12);
    return `<div class="cwm-tv"><header><span class="cwm-live-dot"></span><h2>${tx('شاشة الورشة الحية', 'Live Workshop TV')}</h2><time>${new Date().toLocaleString(language() === 'ar' ? 'ar-IQ' : 'en-GB')}</time></header><div>${rows.map((row) => card(row, true)).join('') || empty(tx('لا توجد أعمال مفتوحة.', 'No open work.'))}</div></div>`;
  }
  function mobileView() {
    return `<div class="cwm-phone"><header><i class="fa-solid fa-bars"></i><strong>OCTAGON · ${tx('مهامي', 'My Tasks')}</strong><i class="fa-regular fa-bell"></i></header><div>${openRows().map((row) => card(row, true)).join('') || empty(tx('لا توجد مهام.', 'No tasks.'))}</div></div>`;
  }
  function slaView() {
    const rows = openRows().filter((row) => row.sla_due_at);
    return `<div class="cwm-sla">${rows.map((row) => `<article class="${row.sla_breached ? 'breached' : 'on-track'}"><i class="fa-solid ${row.sla_breached ? 'fa-triangle-exclamation' : 'fa-shield-check'}"></i><div><h3>${escapeHtml(row.title)}</h3><span>${escapeHtml(row.sla_policy || tx('SLA افتراضي', 'Default SLA'))} · ${formatDate(row.sla_due_at)}</span></div><b>${row.sla_breached ? tx('مخترق', 'Breached') : tx('ضمن الوقت', 'On track')}</b></article>`).join('') || empty(tx('لا توجد مهام مرتبطة بـ SLA.', 'No SLA-linked tasks.'))}</div>`;
  }
  function dependencyView() {
    const rows = filteredRows().filter((row) => row.dependencies?.length || row.blockers?.length);
    return `<div class="cwm-dependency-map">${rows.map((row) => `<article><div class="cwm-node">${importance(row.importance)}<h3>${escapeHtml(row.title)}</h3><span>${escapeHtml(row.stage)}</span></div><div class="cwm-edges">${(row.dependencies || []).map((dep) => `<span><i class="fa-solid fa-arrow-right-long"></i>${escapeHtml(state.rows.find((candidate) => candidate.id === dep.blocker_work_item_id)?.title || dep.blocker_work_item_id)}</span>`).join('')}${(row.blockers || []).map((dep) => `<span><i class="fa-solid fa-arrow-left-long"></i>${escapeHtml(state.rows.find((candidate) => candidate.id === dep.work_item_id)?.title || dep.work_item_id)}</span>`).join('')}</div></article>`).join('') || empty(tx('لا توجد سلاسل اعتماد.', 'No dependency chains.'))}</div>`;
  }
  function activeView() {
    if (state.active === 'kanban') return kanbanView();
    if (state.active === 'calendar') return calendarView();
    if (state.active === 'my_tasks') return myTasksView();
    if (state.active === 'workload') return workloadView();
    if (state.active === 'workshop_tv') return workshopTvView();
    if (state.active === 'mobile') return mobileView();
    if (state.active === 'sla') return slaView();
    if (state.active === 'dependencies') return dependencyView();
    return taskManagerView();
  }
  function shellMarkup() {
    const open = openRows();
    return `<section class="cwm-shell" dir="${escapeHtml(language() === 'ar' ? 'rtl' : 'ltr')}">
      <header class="cwm-hero"><div><span>CHECKPOINT C4 · CANONICAL WORK ITEMS</span><h1><i class="fa-solid fa-list-check"></i>${tx('إدارة العمل القانونية', 'Canonical Work Management')}</h1><p>${tx('مدير المهام وكانبان والتقويم والورشة والجوال وSLA والاعتماديات على سجل واحد.', 'Task Manager, Kanban, Calendar, workshop, mobile, SLA, and dependencies on one authority.')}</p></div><button data-cwm-refresh><i class="fa-solid fa-rotate"></i>${tx('تحديث', 'Refresh')}</button></header>
      <div class="cwm-kpis"><article><span>${tx('مفتوحة', 'Open')}</span><b>${open.length}</b></article><article><span>${tx('متأخرة', 'Overdue')}</span><b>${open.filter((row) => row.is_overdue).length}</b></article><article><span>${tx('SLA مخترق', 'SLA breached')}</span><b>${open.filter((row) => row.sla_breached).length}</b></article><article><span>${tx('محجوبة', 'Blocked')}</span><b>${open.filter((row) => row.status === 'blocked' || row.dependencies?.length).length}</b></article></div>
      <nav class="cwm-tabs">${tabs.map(([key, ar, en, icon]) => `<button class="${state.active === key ? 'active' : ''}" data-cwm-tab="${key}"><i class="fa-solid ${icon}"></i><span>${tx(ar, en)}</span></button>`).join('')}</nav>
      <div class="cwm-toolbar"><label><i class="fa-solid fa-magnifying-glass"></i><input data-cwm-search value="${escapeHtml(state.search)}" placeholder="${escapeHtml(tx('بحث في كل المهام', 'Search all tasks'))}"></label><select data-cwm-group><option value="stage">${tx('تجميع: المرحلة', 'Group: stage')}</option><option value="team">${tx('تجميع: الفريق', 'Group: team')}</option><option value="assignee">${tx('تجميع: المسند', 'Group: assignee')}</option></select><select data-cwm-sort><option value="due_date">${tx('ترتيب: الاستحقاق', 'Sort: due')}</option><option value="importance">${tx('ترتيب: الأهمية', 'Sort: importance')}</option><option value="updated_at">${tx('ترتيب: النشاط', 'Sort: activity')}</option></select></div>
      <div class="cwm-feedback" aria-live="polite">${state.notice ? `<div class="cwm-notice">${escapeHtml(state.notice)}</div>` : ''}${state.error ? `<div class="cwm-error">${escapeHtml(state.error)}</div>` : ''}</div>
      <main class="cwm-body">${state.loading ? `<div class="cwm-loading"><i class="fa-solid fa-spinner fa-spin"></i>${tx('تحميل حقائق العمل القانونية…', 'Loading canonical work facts…')}</div>` : activeView()}</main>
    </section>`;
  }
  function render() {
    const element = host();
    if (!element) return;
    element.classList.add('canonical-work-management-page');
    element.innerHTML = shellMarkup();
    bind(element);
  }
  async function refresh() {
    state.loading = true; state.error = null; render();
    try {
      const [rows, mineRows, workload, overdue, sla, inactive, completion] = await Promise.all([
        api().list({ limit: 500 }),
        api().list({ limit: 500, mine: 1 }),
        api().report('workload'),
        api().report('overdue'),
        api().report('sla'),
        api().report('inactive'),
        api().report('completion'),
      ]);
      state.rows = rows;
      state.mineRows = mineRows;
      state.reports = { workload, overdue, sla, inactive, completion };
      if (state.selectedId && !rows.some((row) => row.id === state.selectedId)) state.selectedId = null;
    } catch (error) {
      state.error = normalizeError(error);
    } finally {
      state.loading = false; render();
    }
  }
  async function command(message, task, selectResult = false) {
    state.loading = true; state.error = null; state.notice = null; render();
    try {
      const result = await task();
      const item = result?.item || result;
      if (selectResult && item?.id) state.selectedId = item.id;
      state.notice = message;
      await refresh();
    } catch (error) {
      state.loading = false;
      state.error = normalizeError(error);
      render();
    }
  }
  function formObject(form) {
    return Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => value !== ''));
  }
  function submitCreateForm(form = host()?.querySelector('[data-cwm-form="create"]')) {
    if (!form) throw new Error('Canonical Work Item create form is unavailable');
    if (!form.checkValidity()) {
      form.reportValidity();
      return false;
    }
    const input = formObject(form);
    input.importance = Number(input.importance);
    input.estimated_hours = Number(input.estimated_hours || 0);
    input.watchers = String(input.watchers || '').split(',').map((value) => value.trim()).filter(Boolean);
    input.checklist_json = String(input.checklist || '').split(',').map((title) => title.trim()).filter(Boolean).map((title) => ({ title, done: false }));
    input.attachments_json = String(input.attachments || '').split(',').map((reference) => reference.trim()).filter(Boolean).map((reference) => ({ reference }));
    input.comments_json = String(input.comments || '').trim() ? [{ body: String(input.comments).trim() }] : [];
    delete input.checklist;
    delete input.attachments;
    delete input.comments;
    if (input.start_date) input.start_date = `${input.start_date}T08:00:00.000Z`;
    if (input.due_date) input.due_date = `${input.due_date}T17:00:00.000Z`;
    if (input.sla_due_at) input.sla_due_at = new Date(input.sla_due_at).toISOString();
    command(tx('تم إنشاء المهمة على السلطة القانونية.', 'Task created on the canonical authority.'), () => api().create(input), true);
    return true;
  }
  function submitAssignForm(form = host()?.querySelector('[data-cwm-form="assign"]')) {
    if (!form) throw new Error('Canonical Work Item assignment form is unavailable');
    const input = formObject(form);
    input.expected_version = Number(input.expected_version);
    command(tx('تم تحديث الإسناد.', 'Assignment updated.'), () => api().assign(input), true);
    return true;
  }
  function submitSubtaskForm(form = host()?.querySelector('[data-cwm-form="subtask"]')) {
    if (!form) throw new Error('Canonical Work Item subtask form is unavailable');
    command(tx('تمت إضافة المهمة الفرعية.', 'Subtask added.'), () => api().addSubtask(formObject(form)));
    return true;
  }
  function submitDependencyForm(form = host()?.querySelector('[data-cwm-form="dependency"]')) {
    if (!form) throw new Error('Canonical Work Item dependency form is unavailable');
    const input = formObject(form);
    input.expected_version = Number(input.expected_version);
    command(tx('تمت إضافة الاعتماد.', 'Dependency added.'), () => api().addDependency(input), true);
    return true;
  }
  function submitDueForm(form = host()?.querySelector('[data-cwm-form="due"]')) {
    if (!form) throw new Error('Canonical Work Item due-date form is unavailable');
    const input = formObject(form);
    input.expected_version = Number(input.expected_version);
    input.due_date = `${input.due_date}T17:00:00.000Z`;
    command(tx('تم تحريك تاريخ الاستحقاق.', 'Due date moved.'), () => api().update(input), true);
    return true;
  }
  function moveTask(id, stage) {
    const row = state.rows.find((item) => item.id === id);
    if (!row || row.stage === stage) return false;
    command(tx('تم نقل المهمة على كانبان.', 'Task moved on Kanban.'), () => api().transition({
      id,
      stage,
      expected_version: row.version,
    }));
    return true;
  }
  function completeTask(id, version) {
    command(tx('تم إكمال المهمة.', 'Task completed.'), () => api().complete({
      id,
      expected_version: Number(version),
    }), true);
    return true;
  }
  function bind(element) {
    element.querySelector('[data-cwm-refresh]')?.addEventListener('click', refresh);
    element.querySelectorAll('[data-cwm-tab]').forEach((button) => button.addEventListener('click', () => {
      state.active = button.dataset.cwmTab; render();
    }));
    element.querySelector('[data-cwm-search]')?.addEventListener('input', (event) => {
      state.search = event.target.value; render();
      const input = host()?.querySelector('[data-cwm-search]'); input?.focus(); input?.setSelectionRange(state.search.length, state.search.length);
    });
    element.querySelector('[data-cwm-sort]')?.addEventListener('change', (event) => { state.sort = event.target.value; render(); });
    element.querySelector('[data-cwm-group]')?.addEventListener('change', (event) => { state.group = event.target.value; render(); });
    element.querySelectorAll('[data-cwm-task]').forEach((task) => {
      task.addEventListener('click', () => { state.selectedId = task.dataset.cwmTask; if (state.active !== 'task_manager') state.active = 'task_manager'; render(); });
      task.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/work-item-id', task.dataset.cwmTask));
    });
    element.querySelectorAll('[data-cwm-drop]').forEach((column) => {
      column.addEventListener('dragover', (event) => { event.preventDefault(); column.classList.add('drop-active'); });
      column.addEventListener('dragleave', () => column.classList.remove('drop-active'));
      column.addEventListener('drop', (event) => {
        event.preventDefault(); column.classList.remove('drop-active');
        const id = event.dataTransfer.getData('text/work-item-id');
        moveTask(id, column.dataset.cwmDrop);
      });
    });
    const create = element.querySelector('[data-cwm-form="create"]');
    create?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitCreateForm(create);
    });
    const assign = element.querySelector('[data-cwm-form="assign"]');
    assign?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitAssignForm(assign);
    });
    const subtask = element.querySelector('[data-cwm-form="subtask"]');
    subtask?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitSubtaskForm(subtask);
    });
    const dependency = element.querySelector('[data-cwm-form="dependency"]');
    dependency?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitDependencyForm(dependency);
    });
    const due = element.querySelector('[data-cwm-form="due"]');
    due?.addEventListener('submit', (event) => {
      event.preventDefault();
      submitDueForm(due);
    });
    element.querySelector('[data-cwm-complete]')?.addEventListener('click', (event) => {
      completeTask(event.currentTarget.dataset.cwmComplete, event.currentTarget.dataset.version);
    });
    element.querySelector('[data-cwm-cancel]')?.addEventListener('click', (event) => {
      command(tx('تم إلغاء المهمة.', 'Task cancelled.'), () => api().cancel({
        id: event.currentTarget.dataset.cwmCancel,
        expected_version: Number(event.currentTarget.dataset.version),
      }), true);
    });
  }
  function activate(tab = 'task_manager') {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('page-active'));
    document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
    const page = host();
    const nav = document.getElementById('navTaskManager');
    if (page) page.classList.add('page-active');
    if (nav) nav.classList.add('active');
    for (const id of ['navKanban', 'navWorkshopTv']) {
      const legacy = document.getElementById(id);
      if (legacy) legacy.hidden = true;
    }
    state.active = tabs.some(([key]) => key === tab) ? tab : 'task_manager';
    root.currentPage = 'task_manager';
    render();
    refresh();
  }
  function installRouteAuthority() {
    if (typeof root.switchPage !== 'function' || root.switchPage.__canonicalWorkManagementFinalAuthority) return;
    const previous = root.switchPage;
    const canonicalSwitch = function canonicalWorkManagementSwitch(page) {
      const aliases = { task_manager: 'task_manager', kanban: 'kanban', workshop_tv: 'workshop_tv' };
      if (aliases[page]) {
        if (!host() && typeof root.ensurePageTemplateLoaded === 'function') {
          return Promise.resolve(root.ensurePageTemplateLoaded('task_manager')).then(() => activate(aliases[page]));
        }
        activate(aliases[page]);
        return;
      }
      return previous.apply(this, arguments);
    };
    canonicalSwitch.__canonicalWorkManagementFinalAuthority = true;
    canonicalSwitch.__canonicalWorkManagementPreviousSwitch = previous;
    root.switchPage = canonicalSwitch;
  }

  root.CanonicalWorkManagement = {
    activate,
    refresh,
    render,
    completeTask,
    moveTask,
    submitAssignForm,
    submitCreateForm,
    submitDependencyForm,
    submitDueForm,
    submitSubtaskForm,
    state,
    tabs: tabs.map(([key]) => key),
  };
  root.addEventListener?.('octagon:language-applied', render);
  root.addEventListener?.('octagon:canonical-changed', (event) => {
    if (event.detail?.domain === 'WORK_ITEM' && root.currentPage === 'task_manager') refresh();
  });
  document.addEventListener('DOMContentLoaded', installRouteAuthority);
  root.addEventListener?.('load', installRouteAuthority);
  [0, 50, 250, 1000, 2500].forEach((delay) => setTimeout(installRouteAuthority, delay));
  installRouteAuthority();
})(window);
