/** BUILD-09R-2 Group D: Shop-Floor Terminal and Work-Center Queue workspaces.
 *
 * The terminal is what an operator stands in front of, so it is built for that: one active
 * operation filling the screen, a live elapsed-time clock, large start/pause/resume/complete
 * controls, and an output pad for produced / rejected / scrap quantities.
 *
 * The single most important thing this page must not do is imply it changed the canonical work
 * order. platform/manufacturing/shopfloor.mjs makes every transition REQUEST_ONLY: the session
 * moves to `awaiting_canonical` and only reaches the requested status once canonical
 * Manufacturing has actually moved the work order and the operator acknowledges it. The terminal
 * therefore renders `awaiting_canonical` as its own visible waiting state with an explicit
 * acknowledge control, instead of optimistically showing "running".
 *
 * The elapsed clock ticks a single text node on an interval rather than repainting - a repaint
 * every second would destroy whatever the operator is typing into the output pad.
 */
(function shopfloorWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, minutes, badge, kpis, progressBar, scopeLine, field, textarea, muted } = S;

  const STATUS_TONE = { ready: '', assigned: 'info', running: 'ok', paused: 'warn', awaiting_canonical: 'info', quality_hold: 'danger', blocked: 'danger', rework: 'warn', completed: 'ok' };
  const statusBadge = (status) => badge(status, STATUS_TONE[status] ?? '');
  const ACTIVE = ['ready', 'assigned', 'running', 'paused', 'awaiting_canonical', 'quality_hold', 'blocked', 'rework'];

  const elapsedMinutes = (session) => {
    if (!session?.actualStartAt) return 0;
    const end = session.actualEndAt ? new Date(session.actualEndAt) : new Date();
    return Math.max(0, (end.getTime() - new Date(session.actualStartAt).getTime()) / 60000);
  };

  // ---------------------------------------------------------------- Shop-Floor Terminal

  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };

  const terminal = S.createWorkspace({
    pageId: 'shopfloor_terminal',
    prefix: 'sf',
    initialState: () => ({ sessions: [], current: null, timeline: [], loading: true }),

    async onActivate(state, api) {
      const rows = await api.query('shopfloor-sessions').then((list) => (Array.isArray(list) ? list : []));
      state.sessions = rows.filter((row) => ACTIVE.includes(row.status));
      state.current = state.current ? rows.find((row) => row.id === state.current.id) || null : null;
    },

    render(state) {
      stopTick();
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading shop-floor sessions…', 'جارِ تحميل جلسات أرض المصنع…'))}</p></div>`;
      if (!state.current) return `${scopeLine()}${terminalPickerPanel(state)}`;
      const current = state.current;
      return `${scopeLine([`${t('Work centre', 'مركز العمل')}: ${esc(current.workCenterId || '—')}`, statusBadge(current.status)])}
        ${activeOperationPanel(current)}
        ${current.status === 'awaiting_canonical' ? awaitingPanel(current) : ''}
        ${outputPanel(current)}
        ${controlsPanel(current)}
        ${timelinePanel(state)}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="sf-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        const rows = await api.query('shopfloor-sessions').then((list) => (Array.isArray(list) ? list : []));
        state.current = rows.find((row) => row.id === button.dataset.sessionId) || null;
        state.timeline = state.current ? await api.query('shopfloor-timeline', { session_id: state.current.id }).catch(() => []) : [];
      })));

      // Tick only the clock's own text node - never repaint, or the output pad loses its input.
      const clock = container.querySelector('[data-role="sf-elapsed"]');
      if (clock && state.current?.status === 'running') {
        tick = setInterval(() => {
          const node = document.querySelector(`[data-build09-page="shopfloor_terminal"] [data-role="sf-elapsed"]`);
          if (!node) { stopTick(); return; }
          node.textContent = minutes(elapsedMinutes(state.current));
        }, 1000);
      }

      const outputForm = container.querySelector('[data-role="sf-output-form"]');
      if (outputForm) outputForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(outputForm);
          const result = await api.call('shopfloor:operation_output', {
            session_id: state.current.id,
            produced_quantity: Number(data.produced_quantity || 0),
            rejected_quantity: Number(data.rejected_quantity || 0),
            scrap_quantity: Number(data.scrap_quantity || 0),
            notes: data.notes || undefined,
          });
          state.current = result;
        });
      });

      [['sf-start', 'shopfloor:operation_start'], ['sf-pause', 'shopfloor:operation_pause'], ['sf-resume', 'shopfloor:operation_resume'], ['sf-complete', 'shopfloor:operation_complete']].forEach(([role, actionId]) => {
        const button = container.querySelector(`[data-role="${role}"]`);
        if (button) button.addEventListener('click', () => api.guarded(async () => {
          state.current = await api.call(actionId, { session_id: state.current.id });
        }));
      });

      const acknowledge = container.querySelector('[data-role="sf-acknowledge"]');
      if (acknowledge) acknowledge.addEventListener('click', () => api.guarded(async () => {
        state.current = await api.call('shopfloor:operation_acknowledge', { session_id: state.current.id });
        state.timeline = await api.query('shopfloor-timeline', { session_id: state.current.id }).catch(() => []);
      }));

      const back = container.querySelector('[data-role="sf-back"]');
      if (back) back.addEventListener('click', () => { stopTick(); state.current = null; api.paint(); });
    },
  });

  function terminalPickerPanel(state) {
    if (!state.sessions.length) return `<div class="b09r-panel">${muted('No shop-floor session is open at this warehouse.', 'لا توجد جلسة أرض مصنع مفتوحة في هذا المستودع.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Open operations', 'العمليات المفتوحة'))}</h2></div>
      <div class="b09r-pool-list">${state.sessions.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row" data-role="sf-open" data-session-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.workOrderId)}</strong><small>${esc(row.workCenterId || '—')} · ${esc(row.operatorId || t('unassigned', 'غير مسند'))}</small></span>
        ${statusBadge(row.status)}</button>`).join('')}</div></div>`;
  }

  function activeOperationPanel(current) {
    const planned = current.plannedQuantity;
    const done = Number(current.producedQuantity || 0);
    return `<div class="b09r-panel b09r-terminal" data-role="sf-active">
      <div class="b09r-panel-head"><h2>${esc(current.workOrderId)}</h2>${statusBadge(current.status)}</div>
      <div class="b09r-terminal-grid">
        <div class="b09r-terminal-cell"><small>${esc(t('Production order', 'أمر الإنتاج'))}</small><strong>${esc(current.productionOrderId || '—')}</strong></div>
        <div class="b09r-terminal-cell"><small>${esc(t('Operator', 'المشغل'))}</small><strong data-role="sf-operator">${esc(current.operatorId || t('unassigned', 'غير مسند'))}</strong></div>
        <div class="b09r-terminal-cell"><small>${esc(t('Shift', 'الوردية'))}</small><strong>${esc(current.shiftCode || '—')}</strong></div>
        <div class="b09r-terminal-cell b09r-terminal-clock"><small>${esc(t('Elapsed', 'الوقت المنقضي'))}</small><strong data-role="sf-elapsed">${esc(current.actualStartAt ? minutes(elapsedMinutes(current)) : t('not started', 'لم تبدأ'))}</strong></div>
      </div>
      ${kpis([
        ['Planned', 'المخطط', planned == null ? '—' : num(planned)],
        ['Produced', 'المنتَج', num(done), done ? 'ok' : '', 'sf-produced'],
        ['Rejected', 'المرفوض', num(current.rejectedQuantity), Number(current.rejectedQuantity) ? 'danger' : '', 'sf-rejected'],
        ['Scrap', 'الهالك', num(current.scrapQuantity), Number(current.scrapQuantity) ? 'warn' : '', 'sf-scrap'],
      ])}
      ${planned == null ? '' : progressBar(done, planned, current.rejectedQuantity)}
      ${current.instructions ? `<p data-role="sf-instructions">${esc(current.instructions)}</p>` : ''}
      ${current.qualityCheckpointRequired ? badge(t('quality checkpoint required before completion', 'يلزم فحص جودة قبل الإكمال'), 'warn') : ''}
    </div>`;
  }

  /** The canonical boundary made visible: the session is NOT yet in the requested status. */
  function awaitingPanel(current) {
    const request = current.canonicalRequest || {};
    return `<div class="b09r-panel" data-role="sf-awaiting">
      <div class="b09r-panel-head"><h2>${esc(t('Awaiting canonical Manufacturing', 'بانتظار التصنيع الرسمي'))}</h2>${badge(t('request only', 'طلب فقط'), 'info')}</div>
      <p>${esc(t('This terminal requested the transition; it did not perform it. The operation reaches the requested status only once canonical Manufacturing moves the work order.', 'طلبت هذه المحطة الانتقال ولم تنفّذه. لا تصل العملية إلى الحالة المطلوبة إلا بعد أن ينقل التصنيع الرسمي أمر العمل.'))}</p>
      <div class="b09r-scope-line"><span>${esc(t('Requested status', 'الحالة المطلوبة'))}: ${esc(request.requested_status || '—')}</span><span>${esc(t('Canonical action', 'الإجراء الرسمي'))}: ${esc(current.canonicalAction || '—')}</span></div>
      <button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="sf-acknowledge">${esc(t('Acknowledge canonical transition', 'الإقرار بالانتقال الرسمي'))}</button>
    </div>`;
  }

  function outputPanel(current) {
    if (!['running', 'paused', 'rework'].includes(current.status)) return '';
    return `<form class="b09r-panel" data-role="sf-output-form">
      <div class="b09r-panel-head"><h2>${esc(t('Record output', 'تسجيل الإنتاج'))}</h2></div>
      <div class="b09r-grid-3">
        ${field('produced_quantity', 'Produced', 'المنتَج', { type: 'number', step: 'any', min: 0, value: '0' })}
        ${field('rejected_quantity', 'Rejected', 'المرفوض', { type: 'number', step: 'any', min: 0, value: '0' })}
        ${field('scrap_quantity', 'Scrap', 'الهالك', { type: 'number', step: 'any', min: 0, value: '0' })}
      </div>
      ${textarea('notes', 'Notes', 'ملاحظات', { rows: 2 })}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Record output', 'تسجيل الإنتاج'))}</button>
    </form>`;
  }

  function controlsPanel(current) {
    const controls = [
      ['ready', 'assigned'].includes(current.status) ? ['sf-start', t('Start operation', 'بدء العملية'), 'b09-primary'] : null,
      current.status === 'running' ? ['sf-pause', t('Pause', 'إيقاف مؤقت'), ''] : null,
      current.status === 'paused' ? ['sf-resume', t('Resume', 'استئناف'), 'b09-primary'] : null,
      ['running', 'paused', 'rework'].includes(current.status) ? ['sf-complete', t('Complete operation', 'إكمال العملية'), 'b09-primary'] : null,
    ].filter(Boolean);
    return `<div class="b09r-panel"><div class="b09r-actions-row" data-role="sf-controls">
      ${controls.map(([role, label, extra]) => `<button type="button" class="b09-button ${extra} b09r-btn-xl" data-role="${esc(role)}">${esc(label)}</button>`).join('')}
      <button type="button" class="b09-button b09r-btn-xl" data-role="sf-back">${esc(t('Back to operations', 'العودة للعمليات'))}</button>
    </div></div>`;
  }

  function timelinePanel(state) {
    const rows = state.timeline || [];
    if (!rows.length) return '';
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Operation timeline', 'الخط الزمني للعملية'))}</h2></div>
      <div class="b09r-scan-list" data-role="sf-timeline">${rows.map((row) => `<div class="b09r-scan-row"><span>${esc(row.event_type)}</span><span>${esc(row.from_status || '—')} → ${esc(row.to_status || '—')}</span><span>${esc(when(row.occurred_at))}</span></div>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- Work-Center Queue

  const queue = S.createWorkspace({
    pageId: 'workcenter_queue',
    prefix: 'wq',
    initialState: () => ({ board: null, selectedId: null, loading: true }),

    async onActivate(state, api) {
      state.board = await api.query('shopfloor-board');
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading the work-centre queue…', 'جارِ تحميل طابور مراكز العمل…'))}</p></div>`;
      const board = state.board || { sessions: [], byStatus: {}, byWorkCenter: {}, blocked: [] };
      const sessions = (board.sessions || []).filter((row) => ACTIVE.includes(row.status));
      if (!sessions.length) return `${scopeLine()}<div class="b09r-panel">${muted('No work-centre sessions are queued.', 'لا توجد جلسات مراكز عمل في الطابور.')}</div>`;

      const centres = sessions.reduce((out, row) => ({ ...out, [row.workCenterId || 'unassigned']: [...(out[row.workCenterId || 'unassigned'] || []), row] }), {});
      return `${scopeLine([`${t('Work centres', 'مراكز العمل')}: ${esc(num(Object.keys(centres).length, 0))}`])}
        ${kpis([
          ['Queued', 'في الطابور', num(sessions.length, 0)],
          ['Running', 'قيد التشغيل', num(board.byStatus?.running || 0, 0), 'ok'],
          ['Paused', 'متوقف مؤقتاً', num(board.byStatus?.paused || 0, 0), (board.byStatus?.paused || 0) ? 'warn' : ''],
          ['Quality hold / blocked', 'حجز جودة / معطل', num((board.blocked || []).length, 0), (board.blocked || []).length ? 'danger' : 'ok'],
        ])}
        ${Object.entries(centres).map(([centre, rows]) => workCentrePanel(centre, rows, state)).join('')}
        ${state.selectedId ? assignPanel(sessions.find((row) => row.id === state.selectedId)) : ''}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="wq-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.sessionId === state.selectedId ? null : button.dataset.sessionId;
        api.paint();
      }));

      const assign = container.querySelector('[data-role="wq-assign-form"]');
      if (assign) assign.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(assign);
          await api.call('shopfloor:operator_assign', { session_id: assign.dataset.sessionId, operator_id: data.operator_id, shift_code: data.shift_code || undefined });
          state.board = await api.query('shopfloor-board');
        });
      });

      const handoff = container.querySelector('[data-role="wq-handoff-form"]');
      if (handoff) handoff.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(handoff);
          await api.call('shopfloor:operation_handoff', { session_id: handoff.dataset.sessionId, to_operator_id: data.to_operator_id, shift_code: data.shift_code || undefined, notes: data.notes || undefined });
          state.board = await api.query('shopfloor-board');
        });
      });
    },
  });

  function workCentrePanel(centre, rows, state) {
    // Queue priority is planned start, then creation - the same order the domain lists them in.
    const ordered = [...rows].sort((left, right) => String(left.plannedStartAt || left.createdAt).localeCompare(String(right.plannedStartAt || right.createdAt)));
    return `<div class="b09r-panel" data-role="wq-centre" data-work-center="${esc(centre)}">
      <div class="b09r-panel-head"><h2>${esc(centre)}</h2>${badge(`${num(ordered.length, 0)} ${t('queued', 'في الطابور')}`, 'info')}</div>
      <div class="b09r-pool-list">${ordered.map((row, index) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="wq-select" data-session-id="${esc(row.id)}">
        <span class="b09r-queue-rank">${esc(num(index + 1, 0))}</span>
        <span class="b09r-pool-main"><strong>${esc(row.workOrderId)}</strong><small>${esc(row.operatorId || t('unassigned', 'غير مسند'))} · ${esc(row.shiftCode || t('no shift', 'بدون وردية'))} · ${esc(when(row.plannedStartAt))}</small></span>
        ${qualityBadge(row)}${statusBadge(row.status)}</button>`).join('')}</div></div>`;
  }

  function qualityBadge(row) {
    if (row.status === 'quality_hold') return badge(t('quality hold', 'حجز جودة'), 'danger');
    if (row.qualityCheckpointRequired) return badge(t('checkpoint required', 'يلزم فحص'), 'warn');
    return badge(t('no checkpoint', 'بدون فحص'), 'muted');
  }

  function assignPanel(row) {
    if (!row) return '';
    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(row.workOrderId)}</h2>${statusBadge(row.status)}</div>
      <form data-role="wq-assign-form" data-session-id="${esc(row.id)}" class="b09r-subform">
        <div class="b09r-grid-2">${field('operator_id', 'Assign operator', 'إسناد مشغل', { required: true })}${field('shift_code', 'Shift', 'الوردية')}</div>
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Assign', 'إسناد'))}</button>
      </form>
      <form data-role="wq-handoff-form" data-session-id="${esc(row.id)}" class="b09r-subform">
        <div class="b09r-grid-2">${field('to_operator_id', 'Hand off to', 'تسليم إلى', { required: true })}${field('shift_code', 'Shift', 'الوردية')}</div>
        ${textarea('notes', 'Handoff notes', 'ملاحظات التسليم', { rows: 2 })}
        <button type="submit" class="b09-button b09r-btn-xl">${esc(t('Hand off operation', 'تسليم العملية'))}</button>
      </form>
    </div>`;
  }

  root.Build09ShopfloorTerminal = terminal;
  root.Build09WorkcenterQueue = queue;
  S.registerOverride('shopfloor_terminal', terminal);
  S.registerOverride('workcenter_queue', queue);
})(window);
