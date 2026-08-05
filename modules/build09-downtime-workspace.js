/** BUILD-09R-2 Group F: Downtime Board and Operational Performance.
 *
 * The Downtime Board is a live board: what is down right now, why, for how long, at which work
 * centre, and whether a maintenance request has been proposed against it. Open events tick their
 * own duration cell rather than repainting, so the board can be left on a wall display.
 *
 * Operational Performance is where honesty matters most. platform/manufacturing/
 * downtime-performance.mjs deliberately returns null for availability / performance / quality
 * rate / OEE when the underlying evidence (a planned window, a run time, recorded output) does
 * not exist, and ships a `metricsReliable` flag per metric saying so. A dashboard that rendered
 * those nulls as 0% would invent a catastrophic reading out of missing data, and a dashboard
 * that rendered them as 100% would hide a real problem. This page renders them as an explicit
 * "not available" with the reason, and only draws a number the server vouched for.
 */
(function downtimeWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, percent, when, minutes, badge, kpis, scopeLine, field, select, textarea, muted } = S;

  const CATEGORIES = [['breakdown', 'Breakdown', 'عطل'], ['setup', 'Setup / changeover', 'إعداد / تبديل'], ['material', 'Material shortage', 'نقص مواد'], ['quality', 'Quality', 'جودة'], ['operator', 'Operator', 'مشغل'], ['planned', 'Planned maintenance', 'صيانة مخططة'], ['other', 'Other', 'أخرى']];
  const CATEGORY_TONE = { breakdown: 'danger', material: 'warn', quality: 'danger', operator: 'warn', setup: 'info', planned: 'muted', other: '' };
  const STATUS_TONE = { open: 'danger', maintenance_proposed: 'warn', ended: 'ok', closed: 'muted', cancelled: 'muted' };

  const isOpen = (event) => !event.endsAt;
  const liveMinutes = (event) => (event.startsAt ? Math.max(0, (Date.now() - new Date(event.startsAt).getTime()) / 60000) : 0);
  const eventMinutes = (event) => (isOpen(event) ? liveMinutes(event) : Number(event.durationMinutes || 0));

  // ---------------------------------------------------------------- Downtime Board

  let tick = null;
  const stopTick = () => { if (tick) { clearInterval(tick); tick = null; } };

  const board = S.createWorkspace({
    pageId: 'downtime_board',
    prefix: 'dt',
    initialState: () => ({ events: [], sessions: [], category: '', loading: true }),

    async onActivate(state, api) {
      const [events, sessions] = await Promise.all([
        api.query('downtime', state.category ? { reason_category: state.category } : {}),
        api.query('shopfloor-sessions'),
      ]);
      state.events = Array.isArray(events) ? events : [];
      state.sessions = (Array.isArray(sessions) ? sessions : []).filter((row) => ['running', 'paused', 'blocked', 'quality_hold'].includes(row.status));
    },

    render(state) {
      stopTick();
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading downtime events…', 'جارِ تحميل أحداث التوقف…'))}</p></div>`;
      const open = state.events.filter(isOpen);
      const closed = state.events.filter((event) => !isOpen(event));
      const totalMinutes = closed.reduce((sum, event) => sum + Number(event.durationMinutes || 0), 0);
      const byCategory = state.events.reduce((out, event) => ({ ...out, [event.reasonCategory]: (out[event.reasonCategory] || 0) + eventMinutes(event) }), {});
      const worst = Object.entries(byCategory).sort((left, right) => right[1] - left[1])[0];

      return `${scopeLine([`${t('Events', 'الأحداث')}: ${esc(num(state.events.length, 0))}`])}
        ${kpis([
          ['Down now', 'متوقف الآن', num(open.length, 0), open.length ? 'danger' : 'ok'],
          ['Closed downtime', 'توقف منتهٍ', minutes(totalMinutes), totalMinutes ? 'warn' : ''],
          ['Top reason', 'أكثر سبب', worst ? worst[0] : '—', worst ? 'warn' : ''],
          ['Maintenance proposed', 'صيانة مقترحة', num(state.events.filter((event) => event.status === 'maintenance_proposed').length, 0), state.events.some((event) => event.status === 'maintenance_proposed') ? 'warn' : ''],
        ])}
        ${activeDowntimePanel(open)}
        ${startDowntimePanel(state)}
        ${historyPanel(state, closed)}`;
    },

    bind(container, state, api) {
      // Only the open events' duration cells tick; the rest of the board is untouched.
      const cells = container.querySelectorAll('[data-role="dt-live"]');
      if (cells.length) {
        tick = setInterval(() => {
          const live = document.querySelectorAll('[data-build09-page="downtime_board"] [data-role="dt-live"]');
          if (!live.length) { stopTick(); return; }
          live.forEach((cell) => {
            const startedAt = cell.dataset.startsAt;
            if (startedAt) cell.textContent = minutes(Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000));
          });
        }, 1000);
      }

      const filter = container.querySelector('[data-role="dt-filter"]');
      if (filter) filter.addEventListener('change', () => api.guarded(async () => {
        state.category = filter.value;
        const events = await api.query('downtime', state.category ? { reason_category: state.category } : {});
        state.events = Array.isArray(events) ? events : [];
      }));

      const startForm = container.querySelector('[data-role="dt-start-form"]');
      if (startForm) startForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(startForm);
          await api.call('shopfloor:downtime_start', {
            session_id: data.session_id, reason_code: data.reason_code, reason_category: data.reason_category,
            asset_reference: data.asset_reference || undefined, notes: data.notes || undefined,
            planned: data.reason_category === 'planned' || undefined,
            maintenance_required: startForm.elements.maintenance_required.checked || undefined,
          });
          await board.api.reload(state, api);
        });
      });

      container.querySelectorAll('[data-role="dt-end"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        await api.call('shopfloor:downtime_end', { downtime_id: button.dataset.downtimeId });
        await board.api.reload(state, api);
      })));
    },
  });

  board.api.reload = async (state, api) => {
    const events = await api.query('downtime', state.category ? { reason_category: state.category } : {});
    state.events = Array.isArray(events) ? events : [];
  };

  function activeDowntimePanel(open) {
    if (!open.length) return `<div class="b09r-panel" data-role="dt-active"><div class="b09r-panel-head"><h2>${esc(t('Active downtime', 'التوقف النشط'))}</h2>${badge(t('all running', 'الكل يعمل'), 'ok')}</div>${muted('Nothing is down right now.', 'لا يوجد توقف حالياً.')}</div>`;
    return `<div class="b09r-panel b09r-downtime-live" data-role="dt-active">
      <div class="b09r-panel-head"><h2>${esc(t('Active downtime', 'التوقف النشط'))}</h2>${badge(`${num(open.length, 0)} ${t('down', 'متوقف')}`, 'danger')}</div>
      ${open.map((event) => `<div class="b09r-downtime-row" data-downtime-id="${esc(event.id)}">
        <span class="b09r-pool-main"><strong>${esc(event.workCenterId || '—')}</strong><small>${esc(event.reasonCode)} · ${esc(event.assetReference || t('no asset', 'بدون أصل'))}</small></span>
        ${badge(event.reasonCategory, CATEGORY_TONE[event.reasonCategory] ?? '')}
        <span class="b09r-downtime-clock"><small>${esc(t('Down for', 'متوقف منذ'))}</small><strong data-role="dt-live" data-starts-at="${esc(event.startsAt)}">${esc(minutes(liveMinutes(event)))}</strong></span>
        ${event.recurringIssue ? badge(t('recurring', 'متكرر'), 'danger') : ''}
        ${maintenanceBadge(event)}
        <button type="button" class="b09-button b09-primary" data-role="dt-end" data-downtime-id="${esc(event.id)}">${esc(t('End downtime', 'إنهاء التوقف'))}</button>
      </div>`).join('')}</div>`;
  }

  /** A proposed maintenance request is a proposal - it names no canonical request until one exists. */
  function maintenanceBadge(event) {
    if (event.maintenanceRequestId) return badge(`${t('maintenance', 'صيانة')} ${event.maintenanceRequestId}`, 'info');
    if (event.status === 'maintenance_proposed') return badge(t('maintenance proposed — not created', 'صيانة مقترحة — لم تُنشأ'), 'warn');
    return '';
  }

  function startDowntimePanel(state) {
    if (!state.sessions.length) return `<div class="b09r-panel">${muted('No shop-floor session is active, so downtime cannot be logged against one.', 'لا توجد جلسة أرض مصنع نشطة، فلا يمكن تسجيل توقف عليها.')}</div>`;
    const sessionOptions = state.sessions.map((row) => [row.id, `${row.workCenterId || '—'} · ${row.workOrderId}`, `${row.workCenterId || '—'} · ${row.workOrderId}`]);
    return `<form class="b09r-panel" data-role="dt-start-form">
      <div class="b09r-panel-head"><h2>${esc(t('Log downtime', 'تسجيل توقف'))}</h2></div>
      ${select('session_id', 'Session', 'الجلسة', sessionOptions, { required: true })}
      <div class="b09r-grid-2">${select('reason_category', 'Reason category', 'فئة السبب', CATEGORIES, { required: true })}${field('reason_code', 'Reason code', 'رمز السبب', { required: true })}</div>
      ${field('asset_reference', 'Asset reference', 'مرجع الأصل')}
      ${textarea('notes', 'Notes', 'ملاحظات', { rows: 2 })}
      <label class="b09r-checkbox"><input type="checkbox" name="maintenance_required"><span>${esc(t('Propose a maintenance request (proposal only — Maintenance creates it)', 'اقتراح طلب صيانة (مقترح فقط — قسم الصيانة ينشئه)'))}</span></label>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Start downtime', 'بدء التوقف'))}</button>
    </form>`;
  }

  function historyPanel(state, closed) {
    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(t('Downtime history', 'سجل التوقف'))}</h2>
        <label class="b09-query-field"><span>${esc(t('Reason', 'السبب'))}</span><select data-role="dt-filter"><option value="">${esc(t('All', 'الكل'))}</option>${CATEGORIES.map(([value, en, ar]) => `<option value="${esc(value)}"${value === state.category ? ' selected' : ''}>${esc(t(en, ar))}</option>`).join('')}</select></label></div>
      <div class="b09r-scan-list" data-role="dt-history">${closed.length
        ? closed.map((event) => `<div class="b09r-scan-row">
            <span><strong>${esc(event.workCenterId || '—')}</strong><br><small>${esc(event.reasonCode)}</small></span>
            ${badge(event.reasonCategory, CATEGORY_TONE[event.reasonCategory] ?? '')}
            <span>${esc(minutes(event.durationMinutes))}</span>
            <span>${esc(when(event.startsAt))}</span>
            ${badge(event.status, STATUS_TONE[event.status] ?? '')}</div>`).join('')
        : muted('No downtime has been closed in this scope.', 'لم يُغلق أي توقف ضمن هذا النطاق.')}</div></div>`;
  }

  // ---------------------------------------------------------------- Operational Performance

  const performance = S.createWorkspace({
    pageId: 'operational_performance',
    prefix: 'op',
    initialState: () => ({ summary: null, sessions: [], loading: true }),

    async onActivate(state, api) {
      const [summary, sessions] = await Promise.all([api.query('work-center-performance'), api.query('shopfloor-sessions')]);
      state.summary = summary;
      state.sessions = Array.isArray(sessions) ? sessions : [];
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading performance metrics…', 'جارِ تحميل مقاييس الأداء…'))}</p></div>`;
      const summary = state.summary;
      if (!summary || !summary.sessions) {
        return `${scopeLine()}<div class="b09r-panel" data-role="op-empty">${muted('No performance metrics are available yet — they require completed shop-floor sessions with recorded timing and output.', 'لا تتوفر مقاييس أداء بعد — فهي تتطلب جلسات أرض مصنع مكتملة بتوقيت ومخرجات مسجلة.')}</div>`;
      }
      const queue = state.sessions.filter((row) => ['ready', 'assigned', 'awaiting_canonical'].includes(row.status)).length;
      const throughput = (summary.metrics || []).reduce((sum, row) => sum + Number(row.producedQuantity || 0), 0);
      const rejected = (summary.metrics || []).reduce((sum, row) => sum + Number(row.rejectedQuantity || 0), 0);
      const downtime = (summary.metrics || []).reduce((sum, row) => sum + Number(row.downtimeMinutes || 0), 0);

      return `${scopeLine([`${t('Sessions measured', 'الجلسات المقاسة')}: ${esc(num(summary.sessions, 0))}`])}
        ${kpis([
          ['Throughput', 'الإنتاجية', num(throughput), throughput ? 'ok' : ''],
          ['Rejected', 'المرفوض', num(rejected), rejected ? 'danger' : ''],
          ['Queue size', 'حجم الطابور', num(queue, 0), queue ? 'info' : ''],
          ['Downtime', 'وقت التوقف', minutes(downtime), downtime ? 'warn' : ''],
        ])}
        ${rateCardsPanel(summary)}
        ${sessionMetricsPanel(summary)}`;
    },

    bind() {},
  });

  /**
   * A metric the server could not compute is rendered as "not available" with its reason - never
   * as 0%, which would read as a catastrophic line rather than as missing evidence.
   */
  function rateCard(metric, labelEn, labelAr, value, whyEn, whyAr) {
    const available = value != null;
    return `<div class="b09r-kpi${available ? ' b09r-kpi-ok' : ' b09r-kpi-unavailable'}" data-role="op-rate" data-metric="${esc(metric)}" data-metric-available="${available}">
      <span class="b09r-kpi-label">${esc(t(labelEn, labelAr))}</span>
      <strong class="b09r-kpi-value">${esc(available ? percent(Number(value) * 100) : t('not available', 'غير متاح'))}</strong>
      ${available ? '' : `<small class="b09r-kpi-why">${esc(t(whyEn, whyAr))}</small>`}</div>`;
  }

  function rateCardsPanel(summary) {
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Work-centre rates', 'معدلات مركز العمل'))}</h2>
        ${badge(t('evidence-based — unmeasured rates stay blank', 'قائمة على الأدلة — المعدلات غير المقاسة تبقى فارغة'), 'info')}</div>
      <div class="b09r-kpis" data-role="op-rates">
        ${rateCard('availability', 'Availability', 'الجاهزية', summary.availability, 'Needs a planned start and end window on the session.', 'تتطلب نافذة بداية ونهاية مخططة للجلسة.')}
        ${rateCard('performance', 'Performance', 'الأداء', summary.performance, 'Needs a planned run time and recorded output.', 'تتطلب زمن تشغيل مخطط ومخرجات مسجلة.')}
        ${rateCard('qualityRate', 'Quality rate', 'معدل الجودة', summary.qualityRate, 'Needs recorded produced or rejected quantities.', 'تتطلب كميات منتجة أو مرفوضة مسجلة.')}
        ${rateCard('oee', 'OEE', 'الفعالية الكلية', summary.oee, 'Needs all three of availability, performance and quality.', 'تتطلب الجاهزية والأداء والجودة معاً.')}
      </div></div>`;
  }

  function sessionMetricsPanel(summary) {
    const rows = summary.metrics || [];
    if (!rows.length) return '';
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Per-session metrics', 'مقاييس كل جلسة'))}</h2></div>
      <div class="b09r-scan-list" data-role="op-sessions">${rows.map((row) => `<div class="b09r-scan-row">
        <span><strong>${esc(row.workOrderId)}</strong><br><small>${esc(row.workCenterId || '—')}</small></span>
        <span>${esc(t('produced', 'منتَج'))} ${esc(num(row.producedQuantity))} / ${esc(t('rejected', 'مرفوض'))} ${esc(num(row.rejectedQuantity))}</span>
        <span>${esc(t('runtime', 'زمن التشغيل'))} ${esc(row.runtimeMinutes == null ? '—' : minutes(row.runtimeMinutes))}</span>
        <span>${esc(t('downtime', 'توقف'))} ${esc(minutes(row.downtimeMinutes))}</span>
        <span data-role="op-session-oee">${esc(row.oee == null ? t('OEE n/a', 'الفعالية غير متاحة') : `OEE ${percent(Number(row.oee) * 100)}`)}</span></div>`).join('')}</div></div>`;
  }

  root.Build09DowntimeBoard = board;
  root.Build09OperationalPerformance = performance;
  S.registerOverride('downtime_board', board);
  S.registerOverride('operational_performance', performance);
})(window);
