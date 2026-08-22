/** BUILD-09R-2 Group A: purpose-built Wave Planning and Wave Execution workspaces.
 *
 * Wave Planning is a task-pool -> selection -> grouping-rule -> calculate -> review flow: the
 * planner picks from the real unassigned pick-task pool, states the grouping rule and the
 * picker/team, and the wave is calculated server-side. Wave Execution is the release/monitor
 * half: release state, live completion progress, exception count and staging status per wave.
 *
 * Both defer entirely to platform/wms/waves.mjs for authority. In particular the wave
 * maker-checker rule (creator may not review; reviewer may not release) is enforced by the
 * server; these pages surface the refusal as a readable denied panel rather than hiding the
 * control, so the operator learns *why* a second approver is required.
 */
(function waveWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, badge, kpis, progressBar, scopeLine, stepper, field, select, lookup, muted } = S;

  const WAVE_TYPES = [['wave', 'Wave', 'موجة'], ['batch', 'Batch', 'دفعة'], ['cluster', 'Cluster', 'عنقود'], ['zone', 'Zone', 'منطقة']];
  const GROUPINGS = [['manual', 'Manual selection', 'اختيار يدوي'], ['zone', 'By zone', 'حسب المنطقة'], ['route', 'By route', 'حسب المسار'], ['product', 'By product', 'حسب المنتج'], ['carrier', 'By carrier', 'حسب الناقل'], ['customer', 'By customer', 'حسب العميل']];
  const PLAN_STEPS = [['pool', 'Task pool', 'مجموعة المهام'], ['rule', 'Grouping rule', 'قاعدة التجميع'], ['calculated', 'Calculated', 'محسوبة'], ['reviewed', 'Reviewed', 'تمت المراجعة']];

  const STATUS_TONE = { draft: '', calculated: 'info', reviewed: 'ok', released: 'ok', active: 'info', partially_completed: 'warn', exception: 'danger', completed: 'ok', cancelled: 'muted', blocked: 'danger' };
  const statusBadge = (status) => badge(status, STATUS_TONE[status] ?? '');

  // ---------------------------------------------------------------- Wave Planning

  const planning = S.createWorkspace({
    pageId: 'wave_planning',
    prefix: 'wp',
    initialState: () => ({ phase: 'pool', pool: [], selected: [], wave: null, loading: true }),

    async onActivate(state, api) {
      state.loading = true;
      const rows = await api.query('pick-tasks');
      // Only genuinely plannable work belongs in a wave pool: unwaved, not yet executing.
      state.pool = (Array.isArray(rows) ? rows : []).filter((task) => !task.waveId && ['ready', 'assigned', 'pending'].includes(task.status));
      state.loading = false;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}${stepper(PLAN_STEPS, state.phase)}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading the pick-task pool…', 'جارِ تحميل مجموعة مهام الالتقاط…'))}</p></div>`;

      const header = scopeLine([
        state.wave ? `${t('Wave', 'الموجة')}: ${esc(state.wave.name)}` : '',
        state.wave ? statusBadge(state.wave.status) : '',
      ]);
      const steps = stepper(PLAN_STEPS, state.phase);
      const summary = kpis([
        ['Pool size', 'حجم المجموعة', num(state.pool.length, 0)],
        ['Selected', 'المحدد', num(state.selected.length, 0), state.selected.length ? 'info' : '', 'wp-selected-kpi'],
        ['Planned tasks', 'المهام المخططة', num(state.wave?.taskCount ?? 0, 0), state.wave?.taskCount ? 'ok' : ''],
      ]);

      if (state.phase === 'calculated' || state.phase === 'reviewed') return `${header}${steps}${summary}${calculatedPanel(state)}`;
      return `${header}${steps}${summary}${poolPanel(state)}${rulePanel(state)}`;
    },

    bind(container, state, api) {
      // Selection changes patch the DOM in place instead of repainting: a full re-render would
      // wipe whatever the planner has already typed into the grouping-rule form below the pool.
      const syncSelection = () => {
        container.querySelectorAll('[data-role="wp-toggle"]').forEach((box) => {
          const chosen = state.selected.includes(box.dataset.taskId);
          box.checked = chosen;
          box.closest('.b09r-pool-row')?.classList.toggle('b09r-pool-selected', chosen);
        });
        container.querySelectorAll('[data-role="wp-selected-count"],[data-role="wp-selected-kpi"]').forEach((node) => { node.textContent = num(state.selected.length, 0); });
        const all = container.querySelector('[data-role="wp-select-all"]');
        if (all) all.textContent = state.selected.length === state.pool.length && state.pool.length ? t('Clear selection', 'إلغاء التحديد') : t('Select all', 'تحديد الكل');
      };

      container.querySelectorAll('[data-role="wp-toggle"]').forEach((box) => box.addEventListener('change', () => {
        const id = box.dataset.taskId;
        state.selected = box.checked ? [...new Set([...state.selected, id])] : state.selected.filter((value) => value !== id);
        syncSelection();
      }));

      const selectAll = container.querySelector('[data-role="wp-select-all"]');
      if (selectAll) selectAll.addEventListener('click', () => {
        state.selected = state.selected.length === state.pool.length ? [] : state.pool.map((task) => task.id);
        syncSelection();
      });

      const ruleForm = container.querySelector('[data-role="wp-rule-form"]');
      if (ruleForm) ruleForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          if (!state.selected.length) throw new Error(t('Select at least one pick task for the wave.', 'اختر مهمة التقاط واحدة على الأقل للموجة.'));
          const data = api.formData(ruleForm);
          const wave = await api.call('wms:wave_create', {
            name: data.name, wave_type: data.wave_type, grouping_strategy: data.grouping_strategy,
            priority: Number(data.priority || 100), cutoff_at: data.cutoff_at || undefined,
            staging_location_id: data.staging_location_id || undefined, operator_id: data.operator_id || undefined,
            criteria: { task_ids: state.selected },
          });
          state.wave = await api.call('wms:wave_calculate', { wave_id: wave.id, criteria: { task_ids: state.selected } });
          state.phase = 'calculated';
        });
      });

      const review = container.querySelector('[data-role="wp-review"]');
      if (review) review.addEventListener('click', () => api.guarded(async () => {
        state.wave = await api.call('wms:wave_review', { wave_id: state.wave.id });
        state.phase = 'reviewed';
      }));

      const recalc = container.querySelector('[data-role="wp-recalculate"]');
      if (recalc) recalc.addEventListener('click', () => api.guarded(async () => {
        state.wave = await api.call('wms:wave_calculate', { wave_id: state.wave.id, criteria: { task_ids: state.selected } });
        state.phase = 'calculated';
      }));

      const restart = container.querySelector('[data-role="wp-restart"]');
      if (restart) restart.addEventListener('click', () => { api.reset(); planning.activate(); });
    },
  });

  function poolPanel(state) {
    const rows = state.pool.length
      ? state.pool.map((task) => `<label class="b09r-pool-row${state.selected.includes(task.id) ? ' b09r-pool-selected' : ''}">
          <input type="checkbox" data-role="wp-toggle" data-task-id="${esc(task.id)}"${state.selected.includes(task.id) ? ' checked' : ''}>
          <span class="b09r-pool-main"><strong>${esc(task.sourceDocumentId || task.id)}</strong><small>${esc(task.productId)} · ${esc(t('qty', 'كمية'))} ${esc(num(task.requestedQuantity))}</small></span>
          <span class="b09r-pool-meta">${esc(t('seq', 'ترتيب'))} ${esc(num(task.routeSequence, 0))}</span>
          ${statusBadge(task.status)}</label>`).join('')
      : `<p class="b09r-muted">${esc(t('No unwaved pick tasks are available to plan. Create pick tasks first, or clear an existing wave.', 'لا توجد مهام التقاط غير مجدولة للتخطيط. أنشئ مهام التقاط أولاً أو ألغِ موجة قائمة.'))}</p>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Task pool', 'مجموعة المهام'))}</h2>
        ${state.pool.length ? `<button type="button" class="b09-button" data-role="wp-select-all">${esc(state.selected.length === state.pool.length ? t('Clear selection', 'إلغاء التحديد') : t('Select all', 'تحديد الكل'))}</button>` : ''}</div>
      <div class="b09r-pool-list" data-role="wp-pool">${rows}</div></div>`;
  }

  function rulePanel(state) {
    return `<form class="b09r-panel" data-role="wp-rule-form">
      <div class="b09r-panel-head"><h2>${esc(t('Grouping rule', 'قاعدة التجميع'))}</h2></div>
      <p>${esc(t('The rule decides how the selected tasks are consolidated into pick groups, and who executes them.', 'تحدد القاعدة كيفية تجميع المهام المحددة في مجموعات التقاط، ومن ينفذها.'))}</p>
      ${field('name', 'Wave name', 'اسم الموجة', { required: true, placeholder: t('e.g. WAVE-AM-01', 'مثال: WAVE-AM-01') })}
      <div class="b09r-grid-2">${select('wave_type', 'Wave type', 'نوع الموجة', WAVE_TYPES, { required: true })}${select('grouping_strategy', 'Grouping strategy', 'استراتيجية التجميع', GROUPINGS, { required: true })}</div>
      <div class="b09r-grid-2">${field('priority', 'Priority', 'الأولوية', { type: 'number', value: '100', min: 1 })}${field('cutoff_at', 'Cut-off', 'الموعد النهائي', { type: 'datetime-local' })}</div>
      ${field('operator_id', 'Picker / team', 'الملتقط / الفريق', { placeholder: t('Operator or team id', 'معرّف الملتقط أو الفريق') })}
      ${lookup('locations', 'staging_location_id', 'Staging location', 'موقع التجهيز')}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Create and calculate wave', 'إنشاء وحساب الموجة'))} (<span data-role="wp-selected-count">${esc(num(state.selected.length, 0))}</span>)</button>
    </form>`;
  }

  function calculatedPanel(state) {
    const wave = state.wave || {};
    const groups = (wave.tasks || []).reduce((out, task) => ({ ...out, [task.consolidatedGroup || 'ungrouped']: [...(out[task.consolidatedGroup || 'ungrouped'] || []), task] }), {});
    const groupList = Object.entries(groups).map(([name, tasks]) => `<div class="b09r-group">
        <div class="b09r-group-head">${badge(name, 'info')}<span>${esc(num(tasks.length, 0))} ${esc(t('tasks', 'مهمة'))}</span></div>
        ${tasks.map((task) => `<div class="b09r-scan-row"><span>${esc(task.pickTaskId)}</span><span>${esc(task.productId)}</span>${statusBadge(task.status)}</div>`).join('')}</div>`).join('')
      || muted('The wave calculated with no consolidated groups.', 'تم حساب الموجة بدون مجموعات مدمجة.');

    const reviewed = state.phase === 'reviewed' || wave.status === 'reviewed';
    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(t('Calculated wave', 'الموجة المحسوبة'))}</h2>${statusBadge(wave.status)}</div>
      <div class="b09r-scope-line"><span>${esc(t('Type', 'النوع'))}: ${esc(wave.waveType || '—')}</span><span>${esc(t('Grouping', 'التجميع'))}: ${esc(wave.groupingStrategy || '—')}</span><span>${esc(t('Priority', 'الأولوية'))}: ${esc(num(wave.priority, 0))}</span><span>${esc(t('Cut-off', 'الموعد النهائي'))}: ${esc(when(wave.cutoffAt))}</span></div>
      ${groupList}
      ${reviewed
        ? `<p class="b09r-success">✓ ${esc(t('Reviewed. Release it from the Wave Execution workspace.', 'تمت المراجعة. أطلقها من مساحة تنفيذ الموجات.'))}</p>`
        : `<p>${esc(t('Review is a second-person check — the planner who created the wave cannot review it.', 'المراجعة تدقيق من شخص ثانٍ — لا يمكن للمخطط الذي أنشأ الموجة أن يراجعها.'))}</p>`}
      <div class="b09r-actions-row">
        ${reviewed ? '' : `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="wp-review">${esc(t('Submit for review', 'إرسال للمراجعة'))}</button>`}
        <button type="button" class="b09-button b09r-btn-xl" data-role="wp-recalculate">${esc(t('Recalculate', 'إعادة الحساب'))}</button>
        <button type="button" class="b09-button b09r-btn-xl" data-role="wp-restart">${esc(t('Plan another wave', 'تخطيط موجة أخرى'))}</button>
      </div></div>`;
  }

  // ---------------------------------------------------------------- Wave Execution

  const execution = S.createWorkspace({
    pageId: 'wave_execution',
    prefix: 'we',
    initialState: () => ({ waves: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      state.loading = true;
      const rows = await api.query('waves');
      state.waves = Array.isArray(rows) ? rows : [];
      if (state.selectedId && !state.waves.some((wave) => wave.id === state.selectedId)) state.selectedId = null;
      state.loading = false;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading waves…', 'جارِ تحميل الموجات…'))}</p></div>`;
      const live = state.waves.filter((wave) => !['cancelled'].includes(wave.status));
      const totals = live.reduce((out, wave) => ({
        tasks: out.tasks + Number(wave.taskCount || 0),
        done: out.done + Number(wave.completedTaskCount || 0),
        exceptions: out.exceptions + Number(wave.exceptionCount || 0),
      }), { tasks: 0, done: 0, exceptions: 0 });

      const board = kpis([
        ['Active waves', 'الموجات النشطة', num(live.filter((wave) => ['released', 'active', 'partially_completed', 'exception'].includes(wave.status)).length, 0), 'info'],
        ['Tasks in flight', 'مهام قيد التنفيذ', num(totals.tasks - totals.done, 0)],
        ['Completed', 'مكتملة', num(totals.done, 0), 'ok'],
        ['Exceptions', 'استثناءات', num(totals.exceptions, 0), totals.exceptions ? 'danger' : ''],
      ]);

      const selected = state.waves.find((wave) => wave.id === state.selectedId);
      return `${scopeLine([`${t('Waves', 'الموجات')}: ${esc(num(state.waves.length, 0))}`])}${board}${waveListPanel(state)}${selected ? waveDetailPanel(selected) : ''}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="we-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.waveId === state.selectedId ? null : button.dataset.waveId;
        api.paint();
      }));

      const refresh = container.querySelector('[data-role="we-refresh"]');
      if (refresh) refresh.addEventListener('click', () => api.guarded(() => execution.api.reload()));

      [['we-release', 'wms:wave_release'], ['we-complete', 'wms:wave_complete'], ['we-cancel', 'wms:wave_cancel']].forEach(([role, actionId]) => {
        const button = container.querySelector(`[data-role="${role}"]`);
        if (button) button.addEventListener('click', () => api.guarded(async () => {
          await api.call(actionId, { wave_id: button.dataset.waveId });
          await execution.api.reload();
        }));
      });
    },
  });

  // Re-reading the wave list is needed by several controls; expose it on the workspace api.
  execution.api.reload = async () => {
    const state = execution.state();
    const rows = await execution.api.query('waves');
    state.waves = Array.isArray(rows) ? rows : [];
    state.loading = false;
  };

  function waveListPanel(state) {
    if (!state.waves.length) return `<div class="b09r-panel">${muted('No waves exist for this warehouse. Plan one in Wave Planning.', 'لا توجد موجات في هذا المستودع. خطط واحدة في تخطيط الموجات.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Waves', 'الموجات'))}</h2><button type="button" class="b09-button" data-role="we-refresh">↻ ${esc(t('Refresh', 'تحديث'))}</button></div>
      <div class="b09r-pool-list" data-role="we-list">${state.waves.map((wave) => `<button type="button" class="b09r-queue-row b09r-wave-row${wave.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="we-select" data-wave-id="${esc(wave.id)}">
        <span class="b09r-pool-main"><strong>${esc(wave.name)}</strong><small>${esc(wave.waveType)} · ${esc(wave.groupingStrategy)}</small></span>
        <span class="b09r-wave-progress">${progressBar(wave.completedTaskCount, wave.taskCount, wave.exceptionCount)}</span>
        ${statusBadge(wave.status)}</button>`).join('')}</div></div>`;
  }

  function waveDetailPanel(wave) {
    const staged = (wave.tasks || []).filter((task) => ['staged', 'awaiting_canonical', 'completed'].includes(task.status)).length;
    const controls = [
      wave.status === 'reviewed' ? ['we-release', t('Release wave', 'إطلاق الموجة'), 'b09-primary'] : null,
      ['released', 'active', 'partially_completed'].includes(wave.status) ? ['we-complete', t('Complete wave', 'إكمال الموجة'), 'b09-primary'] : null,
      ['draft', 'calculated', 'reviewed', 'released', 'blocked', 'exception'].includes(wave.status) ? ['we-cancel', t('Cancel wave', 'إلغاء الموجة'), ''] : null,
    ].filter(Boolean);

    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(wave.name)}</h2>${statusBadge(wave.status)}</div>
      <div class="b09r-scope-line"><span>${esc(t('Created by', 'أنشأها'))}: ${esc(wave.createdBy || '—')}</span><span>${esc(t('Reviewed by', 'راجعها'))}: ${esc(wave.reviewedBy || '—')}</span><span>${esc(t('Released by', 'أطلقها'))}: ${esc(wave.releasedBy || '—')}</span></div>
      ${kpis([
        ['Planned', 'مخطط', num(wave.taskCount, 0)],
        ['Completed', 'مكتمل', num(wave.completedTaskCount, 0), 'ok'],
        ['Exceptions', 'استثناءات', num(wave.exceptionCount, 0), Number(wave.exceptionCount) ? 'danger' : ''],
        ['Staged', 'مجهز', num(staged, 0), staged ? 'info' : ''],
      ])}
      ${progressBar(wave.completedTaskCount, wave.taskCount, wave.exceptionCount)}
      <div class="b09r-scope-line"><span>${esc(t('Staging location', 'موقع التجهيز'))}: ${esc(wave.stagingLocationId || t('not set', 'غير محدد'))}</span><span>${esc(t('Operator', 'المشغل'))}: ${esc(wave.operatorId || '—')}</span></div>
      <div class="b09r-scan-list" data-role="we-tasks">${(wave.tasks || []).length
        ? wave.tasks.map((task) => `<div class="b09r-scan-row"><span>${esc(task.pickTaskId)}</span><span>${esc(task.productId)}</span><span>${esc(task.assignedTo || t('unassigned', 'غير مسند'))}</span>${statusBadge(task.status)}</div>`).join('')
        : muted('This wave has no calculated tasks yet.', 'لا تحتوي هذه الموجة على مهام محسوبة بعد.')}</div>
      <div class="b09r-actions-row">${controls.map(([role, label, extra]) => `<button type="button" class="b09-button ${extra} b09r-btn-xl" data-role="${esc(role)}" data-wave-id="${esc(wave.id)}">${esc(label)}</button>`).join('')}</div>
    </div>`;
  }

  root.Build09WavePlanning = planning;
  root.Build09WaveExecution = execution;
  S.registerOverride('wave_planning', planning);
  S.registerOverride('wave_execution', execution);
})(window);
