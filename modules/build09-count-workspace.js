/** BUILD-09R-2 Group B: Cycle Count Plans, Count Session and Variance Review workspaces.
 *
 * Three pages, one governed lifecycle (platform/wms/cycle-counting.mjs):
 *   plan -> session (blind or directed) -> record lines -> submit -> variance review ->
 *   approve or recount -> canonical adjustment request -> acknowledge -> closed.
 *
 * Two rules shape the UI and are worth stating explicitly:
 *
 * 1. Blind count means blind. When a session is blind and still counting, the server omits
 *    theoreticalQuantity entirely; these panels render the field as "blind" and never fall back
 *    to a cached or inferred expected value, because showing the counter what they are supposed
 *    to find is exactly what a blind count exists to prevent.
 *
 * 2. Counting never writes stock. A variance produces a REQUEST_ONLY canonical adjustment
 *    proposal that canonical Inventory posts; the workspace shows the proposal and the
 *    acknowledgement step, and says so on screen.
 */
(function countWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, percent, when, badge, kpis, scopeLine, stepper, field, select, lookup, muted, textarea } = S;

  const SCOPES = [['location', 'Location', 'موقع'], ['product', 'Product', 'منتج'], ['zone', 'Zone', 'منطقة'], ['abc', 'ABC class', 'تصنيف ABC'], ['ad_hoc', 'Ad hoc', 'حسب الحاجة']];
  const ABC = [['A', 'Class A', 'تصنيف A'], ['B', 'Class B', 'تصنيف B'], ['C', 'Class C', 'تصنيف C']];
  const MODES = [['true', 'Blind count', 'جرد أعمى'], ['false', 'Directed count', 'جرد موجّه']];
  const COUNT_STEPS = [['counting', 'Count', 'الجرد'], ['variance_review', 'Variance review', 'مراجعة الفروقات'], ['approved', 'Approved', 'معتمد'], ['awaiting_canonical', 'Adjustment requested', 'طُلبت التسوية'], ['closed', 'Closed', 'مغلق']];

  const STATUS_TONE = { assigned: '', counting: 'info', recount: 'warn', variance_review: 'warn', submitted: 'info', approved: 'ok', awaiting_canonical: 'info', closed: 'ok' };
  const statusBadge = (status) => badge(status, STATUS_TONE[status] ?? '');
  const isOpen = (session) => ['assigned', 'counting', 'recount'].includes(session.status);
  const blindHidden = (session, line) => session.blindCount && isOpen(session) && line.theoreticalQuantity == null;

  // ---------------------------------------------------------------- Cycle Count Plans

  const plans = S.createWorkspace({
    pageId: 'cycle_count_plans',
    prefix: 'cp',
    initialState: () => ({ plans: [], scope: 'location', started: null, loading: true }),

    async onActivate(state, api) {
      state.plans = await api.query('count-plans').then((rows) => (Array.isArray(rows) ? rows : []));
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading count plans…', 'جارِ تحميل خطط الجرد…'))}</p></div>`;
      const blind = state.plans.filter((plan) => plan.blindCount).length;
      const board = kpis([
        ['Plans', 'الخطط', num(state.plans.length, 0)],
        ['Blind', 'أعمى', num(blind, 0), blind ? 'info' : ''],
        ['Directed', 'موجّه', num(state.plans.length - blind, 0)],
        ['Active', 'نشطة', num(state.plans.filter((plan) => plan.active).length, 0), 'ok'],
      ]);
      return `${scopeLine()}${board}${planListPanel(state)}${planFormPanel(state)}${state.started ? startedPanel(state.started) : ''}`;
    },

    bind(container, state, api) {
      const scopeSelect = container.querySelector('[data-role="cp-scope"]');
      // The selector fields are scope-dependent; swap them without touching the rest of the form.
      if (scopeSelect) scopeSelect.addEventListener('change', () => {
        state.scope = scopeSelect.value;
        const slot = container.querySelector('[data-role="cp-selector"]');
        if (slot) { slot.innerHTML = scopeSelector(state.scope); S.wireLookups(slot, 'cpBound'); }
      });

      const form = container.querySelector('[data-role="cp-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          await api.call('wms:count_plan_create', {
            name: data.name, count_scope: data.count_scope,
            location_id: data.location_id || undefined, product_id: data.product_id || undefined,
            zone_id: data.zone_id || undefined, abc_class: data.abc_class || undefined,
            frequency_days: Number(data.frequency_days || 30),
            tolerance_quantity: Number(data.tolerance_quantity || 0),
            tolerance_percent: Number(data.tolerance_percent || 0),
            blind_count: data.blind_count !== 'false',
            next_count_date: data.next_count_date || undefined,
          });
          state.plans = await api.query('count-plans').then((rows) => (Array.isArray(rows) ? rows : []));
        });
      });

      container.querySelectorAll('[data-role="cp-start"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        state.started = await api.call('wms:count_session_start', { plan_id: button.dataset.planId });
      })));
    },
  });

  function scopeSelector(scope) {
    if (scope === 'location') return lookup('locations', 'location_id', 'Location', 'الموقع');
    if (scope === 'product') return lookup('products', 'product_id', 'Product', 'المنتج');
    if (scope === 'zone') return field('zone_id', 'Zone id', 'معرّف المنطقة', { required: true });
    if (scope === 'abc') return select('abc_class', 'ABC class', 'تصنيف ABC', ABC, { required: true });
    return `<p class="b09r-muted">${esc(t('An ad-hoc plan counts whatever the session targets at start time.', 'الخطة حسب الحاجة تجرد ما تحدده الجلسة عند البدء.'))}</p>`;
  }

  function planListPanel(state) {
    if (!state.plans.length) return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Count plans', 'خطط الجرد'))}</h2></div>${muted('No cycle count plans exist for this warehouse yet.', 'لا توجد خطط جرد دوري لهذا المستودع بعد.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Count plans', 'خطط الجرد'))}</h2></div>
      <div class="b09r-pool-list">${state.plans.map((plan) => `<div class="b09r-pool-row">
        <span class="b09r-pool-main"><strong>${esc(plan.name)}</strong><small>${esc(plan.countScope)} · ${esc(t('every', 'كل'))} ${esc(num(plan.frequencyDays, 0))} ${esc(t('days', 'يوم'))} · ${esc(t('tolerance', 'التسامح'))} ${esc(num(plan.toleranceQuantity))} / ${esc(percent(plan.tolerancePercent))}</small></span>
        ${badge(plan.blindCount ? t('blind', 'أعمى') : t('directed', 'موجّه'), plan.blindCount ? 'info' : 'muted')}
        <button type="button" class="b09-button" data-role="cp-start" data-plan-id="${esc(plan.id)}">${esc(t('Start session', 'بدء جلسة'))}</button></div>`).join('')}</div></div>`;
  }

  function planFormPanel(state) {
    return `<form class="b09r-panel" data-role="cp-form">
      <div class="b09r-panel-head"><h2>${esc(t('New count plan', 'خطة جرد جديدة'))}</h2></div>
      ${field('name', 'Plan name', 'اسم الخطة', { required: true })}
      <div class="b09r-grid-2">
        <label class="b09r-field-lg"><span>${esc(t('Count scope', 'نطاق الجرد'))}</span><select name="count_scope" data-role="cp-scope" required>${SCOPES.map(([value, en, ar]) => `<option value="${esc(value)}"${value === state.scope ? ' selected' : ''}>${esc(t(en, ar))}</option>`).join('')}</select></label>
        ${select('blind_count', 'Count mode', 'وضع الجرد', MODES, { required: true })}
      </div>
      <div data-role="cp-selector">${scopeSelector(state.scope)}</div>
      <div class="b09r-grid-2">${field('tolerance_quantity', 'Tolerance quantity', 'تسامح الكمية', { type: 'number', step: 'any', min: 0, value: '0' })}${field('tolerance_percent', 'Tolerance %', 'نسبة التسامح %', { type: 'number', step: 'any', min: 0, value: '0' })}</div>
      <div class="b09r-grid-2">${field('frequency_days', 'Frequency (days)', 'التكرار (أيام)', { type: 'number', min: 1, value: '30' })}${field('next_count_date', 'Next count', 'الجرد القادم', { type: 'date' })}</div>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Create count plan', 'إنشاء خطة جرد'))}</button>
    </form>`;
  }

  function startedPanel(session) {
    return `<div class="b09r-panel"><p class="b09r-success" data-role="cp-started">✓ ${esc(t('Session started', 'بدأت الجلسة'))}: ${esc(session.id)} · ${esc(num((session.lines || []).length, 0))} ${esc(t('lines', 'سطر'))}</p>
      <p>${esc(t('Open the Count Session workspace to record the count.', 'افتح مساحة جلسة الجرد لتسجيل الجرد.'))}</p></div>`;
  }

  // ---------------------------------------------------------------- Count Session

  const session = S.createWorkspace({
    pageId: 'count_session',
    prefix: 'cs',
    initialState: () => ({ sessions: [], current: null, loading: true }),

    async onActivate(state, api) {
      const rows = await api.query('count-sessions').then((list) => (Array.isArray(list) ? list : []));
      state.sessions = rows.filter(isOpen);
      if (state.current) state.current = rows.find((row) => row.id === state.current.id) || null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading count sessions…', 'جارِ تحميل جلسات الجرد…'))}</p></div>`;
      if (!state.current) return `${scopeLine()}${sessionPickerPanel(state)}`;
      const current = state.current;
      const lines = current.lines || [];
      const counted = lines.filter((line) => line.countedQuantity != null).length;
      return `${scopeLine([`${t('Session', 'الجلسة')}: ${esc(current.id)}`, statusBadge(current.status), badge(current.blindCount ? t('blind', 'أعمى') : t('directed', 'موجّه'), current.blindCount ? 'info' : 'muted')])}
        ${stepper(COUNT_STEPS, current.status)}
        ${kpis([
          ['Lines', 'السطور', num(lines.length, 0)],
          ['Counted', 'تم جرده', num(counted, 0), counted === lines.length && lines.length ? 'ok' : 'info'],
          ['Remaining', 'المتبقي', num(lines.length - counted, 0), lines.length - counted ? 'warn' : ''],
        ])}
        ${countLinesPanel(current)}
        ${submitPanel(current, counted)}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="cs-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        const rows = await api.query('count-sessions').then((list) => (Array.isArray(list) ? list : []));
        state.current = rows.find((row) => row.id === button.dataset.sessionId) || null;
      })));

      container.querySelectorAll('[data-role="cs-line-form"]').forEach((form) => form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          state.current = await api.call('wms:count_line_record', {
            session_id: state.current.id, line_id: form.dataset.lineId,
            counted_quantity: Number(data.counted_quantity),
            discrepancy_reason: data.discrepancy_reason || undefined,
          });
        });
      }));

      const submit = container.querySelector('[data-role="cs-submit"]');
      if (submit) submit.addEventListener('click', () => api.guarded(async () => {
        state.current = await api.call('wms:count_submit', { session_id: state.current.id });
      }));

      const back = container.querySelector('[data-role="cs-back"]');
      if (back) back.addEventListener('click', () => { state.current = null; api.paint(); });
    },
  });

  function sessionPickerPanel(state) {
    if (!state.sessions.length) return `<div class="b09r-panel">${muted('No count session is open. Start one from a count plan.', 'لا توجد جلسة جرد مفتوحة. ابدأ واحدة من خطة جرد.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Open count sessions', 'جلسات الجرد المفتوحة'))}</h2></div>
      <div class="b09r-pool-list">${state.sessions.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row" data-role="cs-open" data-session-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.freezeReference || row.id)}</strong><small>${esc(row.sessionType)} · ${esc(num((row.lines || []).length, 0))} ${esc(t('lines', 'سطر'))} · ${esc(when(row.createdAt))}</small></span>
        ${badge(row.blindCount ? t('blind', 'أعمى') : t('directed', 'موجّه'), row.blindCount ? 'info' : 'muted')}${statusBadge(row.status)}</button>`).join('')}</div></div>`;
  }

  function countLinesPanel(current) {
    const lines = current.lines || [];
    if (!lines.length) return `<div class="b09r-panel">${muted('This session has no count lines.', 'لا تحتوي هذه الجلسة على سطور جرد.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Count lines', 'سطور الجرد'))}</h2>
        ${current.blindCount ? badge(t('expected quantity hidden', 'الكمية المتوقعة مخفية'), 'info') : ''}</div>
      ${lines.map((line) => countLineRow(current, line)).join('')}</div>`;
  }

  function countLineRow(current, line) {
    const done = line.countedQuantity != null;
    const expected = blindHidden(current, line) ? t('blind', 'أعمى') : num(line.theoreticalQuantity);
    return `<form class="b09r-count-line${done ? ' b09r-pool-selected' : ''}" data-role="cs-line-form" data-line-id="${esc(line.id)}">
      <span class="b09r-pool-main"><strong>${esc(line.productId)}</strong><small>${esc(t('at', 'في'))} ${esc(line.locationId)}</small></span>
      <span class="b09r-count-expected"><small>${esc(t('Expected', 'المتوقع'))}</small><strong data-role="cs-expected">${esc(expected)}</strong></span>
      <label class="b09r-count-input"><span>${esc(t('Counted', 'المجرود'))}</span><input name="counted_quantity" type="number" step="any" min="0" required value="${done ? esc(String(line.countedQuantity)) : ''}"></label>
      <input name="discrepancy_reason" placeholder="${esc(t('Reason (optional)', 'السبب (اختياري)'))}" autocomplete="off" value="${esc(line.discrepancyReason && line.discrepancyReason !== 'COUNT_VARIANCE' ? line.discrepancyReason : '')}">
      <button type="submit" class="b09-button${done ? '' : ' b09-primary'}">${esc(done ? t('Update', 'تحديث') : t('Record', 'تسجيل'))}</button>
    </form>`;
  }

  function submitPanel(current, counted) {
    const lines = current.lines || [];
    const ready = lines.length > 0 && counted === lines.length;
    return `<div class="b09r-panel">
      <p>${esc(t('Submitting compares each counted quantity against the frozen snapshot and flags every line outside tolerance.', 'التسليم يقارن كل كمية مجرودة بالنسخة المجمدة ويُعلّم كل سطر خارج حدود التسامح.'))}</p>
      <div class="b09r-actions-row">
        <button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="cs-submit"${ready ? '' : ' disabled'} title="${esc(ready ? '' : t('Every line must be recorded first', 'يجب تسجيل كل السطور أولاً'))}">${esc(t('Submit count', 'تسليم الجرد'))}</button>
        <button type="button" class="b09-button b09r-btn-xl" data-role="cs-back">${esc(t('Back to sessions', 'العودة للجلسات'))}</button>
      </div></div>`;
  }

  // ---------------------------------------------------------------- Variance Review

  const variance = S.createWorkspace({
    pageId: 'variance_review',
    prefix: 'vr',
    initialState: () => ({ sessions: [], current: null, proposal: null, loading: true }),

    async onActivate(state, api) {
      const rows = await api.query('count-sessions').then((list) => (Array.isArray(list) ? list : []));
      state.sessions = rows.filter((row) => ['variance_review', 'submitted', 'approved', 'awaiting_canonical'].includes(row.status));
      if (state.current) state.current = rows.find((row) => row.id === state.current.id) || null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading variances…', 'جارِ تحميل الفروقات…'))}</p></div>`;
      const picker = variancePickerPanel(state);
      if (!state.current) return `${scopeLine()}${picker}`;
      const current = state.current;
      const varianceLines = (current.lines || []).filter((line) => Number(line.varianceQuantity || 0) !== 0);
      const exceeded = varianceLines.filter((line) => line.toleranceExceeded).length;
      return `${scopeLine([`${t('Session', 'الجلسة')}: ${esc(current.id)}`, statusBadge(current.status)])}
        ${stepper(COUNT_STEPS, current.status)}
        ${kpis([
          ['Variance lines', 'سطور الفروقات', num(varianceLines.length, 0), varianceLines.length ? 'warn' : 'ok'],
          ['Outside tolerance', 'خارج التسامح', num(exceeded, 0), exceeded ? 'danger' : 'ok'],
          ['Counted by', 'جردها', current.lines?.find((line) => line.countedBy)?.countedBy || '—'],
        ])}
        ${varianceLinesPanel(varianceLines, current)}
        ${decisionPanel(state, current, varianceLines)}
        ${picker}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="vr-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        const rows = await api.query('count-sessions').then((list) => (Array.isArray(list) ? list : []));
        state.current = rows.find((row) => row.id === button.dataset.sessionId) || null;
        state.proposal = null;
      })));

      const approveForm = container.querySelector('[data-role="vr-approve-form"]');
      if (approveForm) approveForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(approveForm);
          state.current = await api.call('wms:count_approve_variance', { session_id: state.current.id, reason: data.reason || undefined });
        });
      });

      const recount = container.querySelector('[data-role="vr-recount"]');
      if (recount) recount.addEventListener('click', () => api.guarded(async () => {
        const recounted = await api.call('wms:count_recount', { session_id: state.current.id });
        state.current = recounted;
        state.proposal = null;
      }));

      const adjust = container.querySelector('[data-role="vr-adjust"]');
      if (adjust) adjust.addEventListener('click', () => api.guarded(async () => {
        const result = await api.call('wms:count_request_adjustment', { session_id: state.current.id });
        state.current = result;
        state.proposal = result.requests ? { requests: result.requests, inventoryWritten: result.inventoryWritten } : null;
      }));
    },
  });

  function variancePickerPanel(state) {
    if (!state.sessions.length) return `<div class="b09r-panel">${muted('No count variances are awaiting review.', 'لا توجد فروقات جرد بانتظار المراجعة.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Sessions awaiting review', 'جلسات بانتظار المراجعة'))}</h2></div>
      <div class="b09r-pool-list">${state.sessions.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row" data-role="vr-open" data-session-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.freezeReference || row.id)}</strong><small>${esc(num(row.varianceCount, 0))} ${esc(t('variances', 'فرق'))} · ${esc(when(row.updatedAt))}</small></span>
        ${statusBadge(row.status)}</button>`).join('')}</div></div>`;
  }

  function varianceLinesPanel(lines, current) {
    if (!lines.length) return `<div class="b09r-panel">${muted('This session recorded no variances — it can be closed without an inventory adjustment.', 'لم تسجل هذه الجلسة أي فروقات — يمكن إغلاقها بدون تسوية مخزنية.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Variances', 'الفروقات'))}</h2></div>
      <div class="b09r-scan-list" data-role="vr-lines">${lines.map((line) => `<div class="b09r-scan-row${line.toleranceExceeded ? ' b09r-scan-discrepancy' : ''}">
        <span><strong>${esc(line.productId)}</strong><br><small>${esc(line.locationId)}</small></span>
        <span>${esc(t('expected', 'المتوقع'))} ${esc(num(line.theoreticalQuantity))} → ${esc(t('counted', 'المجرود'))} ${esc(num(line.countedQuantity))}</span>
        <span class="${Number(line.varianceQuantity) > 0 ? 'b09r-success' : 'b09r-error'}">${esc(Number(line.varianceQuantity) > 0 ? '+' : '')}${esc(num(line.varianceQuantity))} (${esc(percent(line.variancePercent))})</span>
        ${line.toleranceExceeded ? badge(t('outside tolerance', 'خارج التسامح'), 'danger') : badge(t('within tolerance', 'ضمن التسامح'), 'ok')}</div>`).join('')}</div>
      <p class="b09r-muted">${esc(t('Counted by', 'جردها'))} ${esc(current.lines?.find((line) => line.countedBy)?.countedBy || '—')} · ${esc(t('created by', 'أنشأها'))} ${esc(current.createdBy || '—')}</p></div>`;
  }

  function decisionPanel(state, current, varianceLines) {
    if (current.status === 'awaiting_canonical' || state.proposal) return proposalPanel(state, current);
    if (current.status === 'approved') {
      return `<div class="b09r-panel"><p class="b09r-success">✓ ${esc(t('Variances approved.', 'تم اعتماد الفروقات.'))}</p>
        <p>${esc(varianceLines.length ? t('Request the canonical inventory adjustment — this workspace proposes it; canonical Inventory posts it.', 'اطلب التسوية المخزنية الرسمية — هذه المساحة تقترحها، وقسم المخزون الرسمي يرحّلها.') : t('No variances, so no adjustment is required. Requesting will simply close the session.', 'لا فروقات، فلا حاجة لتسوية. الطلب سيغلق الجلسة فقط.'))}</p>
        <button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="vr-adjust">${esc(t('Request canonical adjustment', 'طلب التسوية الرسمية'))}</button></div>`;
    }
    if (current.status === 'closed') return `<div class="b09r-panel"><p class="b09r-success">✓ ${esc(t('Session closed.', 'أُغلقت الجلسة.'))}</p></div>`;
    return `<form class="b09r-panel" data-role="vr-approve-form">
      <div class="b09r-panel-head"><h2>${esc(t('Approval', 'الاعتماد'))}</h2></div>
      <p>${esc(t('Approval is a maker-checker boundary: whoever created the session or counted a line cannot approve its variances.', 'الاعتماد حد تدقيق مزدوج: من أنشأ الجلسة أو جرد أي سطر لا يمكنه اعتماد فروقاتها.'))}</p>
      ${textarea('reason', 'Variance reason', 'سبب الفرق', { placeholder: t('Why does the stock differ?', 'لماذا يختلف المخزون؟') })}
      <div class="b09r-actions-row">
        <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Approve variances', 'اعتماد الفروقات'))}</button>
        <button type="button" class="b09-button b09r-btn-xl" data-role="vr-recount">${esc(t('Request recount', 'طلب إعادة الجرد'))}</button>
      </div></form>`;
  }

  function proposalPanel(state, current) {
    const requests = state.proposal?.requests || current.adjustmentRequest?.requests || [];
    return `<div class="b09r-panel" data-role="vr-proposal">
      <div class="b09r-panel-head"><h2>${esc(t('Canonical adjustment proposal', 'مقترح التسوية الرسمية'))}</h2>${badge(t('request only', 'طلب فقط'), 'info')}</div>
      <p>${esc(t('No stock has moved. Each line below is a proposed canonical stock move for Inventory to post; the session closes once every proposal is acknowledged.', 'لم تتحرك أي كمية. كل سطر أدناه حركة مخزنية مقترحة ليرحّلها قسم المخزون؛ وتُغلق الجلسة بعد الإقرار بكل المقترحات.'))}</p>
      <div class="b09r-scan-list">${requests.length ? requests.map((request) => `<div class="b09r-scan-row"><span>${esc(request.product_id)}</span><span>${esc(request.count_location_id)}</span><span>${esc(num(request.product_qty))}</span>${badge(request.direction, request.direction === 'gain' ? 'ok' : 'danger')}</div>`).join('') : muted('No adjustment lines were proposed.', 'لم تُقترح أي سطور تسوية.')}</div>
    </div>`;
  }

  root.Build09CountPlans = plans;
  root.Build09CountSession = session;
  root.Build09VarianceReview = variance;
  S.registerOverride('cycle_count_plans', plans);
  S.registerOverride('count_session', session);
  S.registerOverride('variance_review', variance);
})(window);
