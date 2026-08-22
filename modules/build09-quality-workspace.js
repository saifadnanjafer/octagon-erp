/** BUILD-09R-2 Group E: Quality Hold Queue, Rework Workspace and Scrap Approval.
 *
 * One governed chain across three pages (platform/quality/operations.mjs):
 *   checkpoint holds -> disposition requested -> approved (maker-checker) ->
 *   rework route | canonical scrap request -> acknowledged -> closed.
 *
 * Two boundaries the UI must never blur:
 *
 * 1. Approval is a second person. requestDisposition and approveDisposition are deliberately
 *    different actors; the approve control stays visible and the refusal is rendered, so the
 *    requester learns a checker is required rather than wondering why nothing happened.
 *
 * 2. Quality does not move stock. An approved scrap produces a canonical stock:move:post
 *    request that Inventory posts; only then can the disposition be acknowledged, and the
 *    server re-verifies the move's product, quantity and destination before accepting it.
 *    These panels show the request and the pending acknowledgement rather than implying the
 *    scrap has already left the building.
 */
(function qualityWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, badge, kpis, scopeLine, stepper, field, select, textarea, lookup, muted } = S;

  const DISPOSITIONS = [['rework', 'Rework', 'إعادة عمل'], ['scrap', 'Scrap', 'إتلاف'], ['quarantine', 'Quarantine', 'حجر'], ['retest', 'Retest', 'إعادة فحص'], ['conditional_acceptance', 'Conditional acceptance', 'قبول مشروط'], ['return_to_vendor', 'Return to vendor', 'إرجاع للمورد']];
  const DISPOSITION_STEPS = [['requested', 'Requested', 'مطلوب'], ['approved', 'Approved', 'معتمد'], ['awaiting_canonical', 'Awaiting Inventory', 'بانتظار المخزون'], ['completed', 'Completed', 'مكتمل'], ['closed', 'Closed', 'مغلق']];

  const CHECKPOINT_TONE = { pending: '', in_process: 'info', in_progress: 'info', pass: 'ok', released: 'ok', hold: 'danger', fail: 'danger', quarantine: 'warn', ncr: 'danger', conditional: 'warn', rework: 'warn', scrap: 'danger', closed: 'muted' };
  const DISPOSITION_TONE = { requested: 'warn', approved: 'info', route_created: 'info', awaiting_canonical: 'info', completed: 'ok', closed: 'muted' };
  const REWORK_TONE = { planned: '', released: 'info', running: 'info', retest: 'warn', completed: 'ok' };
  const HELD_STATES = ['hold', 'fail', 'quarantine', 'ncr', 'conditional'];

  // ---------------------------------------------------------------- Quality Hold Queue

  const holdQueue = S.createWorkspace({
    pageId: 'quality_hold_queue',
    prefix: 'qh',
    initialState: () => ({ checkpoints: [], current: null, loading: true }),

    async onActivate(state, api) {
      const rows = await api.query('quality-checkpoints').then((list) => (Array.isArray(list) ? list : []));
      state.checkpoints = rows;
      if (state.current) state.current = rows.find((row) => row.id === state.current.id) || null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading quality checkpoints…', 'جارِ تحميل نقاط فحص الجودة…'))}</p></div>`;
      const held = state.checkpoints.filter((row) => HELD_STATES.includes(row.status));
      return `${scopeLine()}${kpis([
          ['Checkpoints', 'نقاط الفحص', num(state.checkpoints.length, 0)],
          ['On hold', 'محجوزة', num(held.length, 0), held.length ? 'danger' : 'ok'],
          ['Rejected units', 'وحدات مرفوضة', num(held.reduce((total, row) => total + Number(row.rejectedQuantity || 0), 0)), held.length ? 'warn' : ''],
          ['NCR linked', 'مرتبطة بعدم مطابقة', num(state.checkpoints.filter((row) => row.ncrId).length, 0)],
        ])}
        ${state.current ? checkpointDetailPanel(state.current) : ''}
        ${holdListPanel(state, held)}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="qh-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        state.current = state.checkpoints.find((row) => row.id === button.dataset.checkpointId) || null;
      })));

      const sync = container.querySelector('[data-role="qh-sync"]');
      if (sync) sync.addEventListener('click', () => api.guarded(async () => {
        state.current = await api.call('quality:checkpoint_sync', { checkpoint_id: state.current.id });
        state.checkpoints = await api.query('quality-checkpoints').then((list) => (Array.isArray(list) ? list : []));
      }));

      const conditional = container.querySelector('[data-role="qh-conditional-form"]');
      if (conditional) conditional.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(conditional);
          state.current = await api.call('quality:checkpoint_conditional_accept', { checkpoint_id: state.current.id, accepted_quantity: Number(data.accepted_quantity), reason_code: data.reason_code || undefined });
          state.checkpoints = await api.query('quality-checkpoints').then((list) => (Array.isArray(list) ? list : []));
        });
      });

      const disposition = container.querySelector('[data-role="qh-disposition-form"]');
      if (disposition) disposition.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(disposition);
          await api.call('quality:disposition_request', {
            checkpoint_id: state.current.id, disposition_type: data.disposition_type,
            quantity: Number(data.quantity), reason_code: data.reason_code,
            source_location_id: data.source_location_id || undefined,
            destination_location_id: data.destination_location_id || undefined,
            ncr_id: data.ncr_id || undefined,
          });
          state.checkpoints = await api.query('quality-checkpoints').then((list) => (Array.isArray(list) ? list : []));
          state.current = state.checkpoints.find((row) => row.id === state.current.id) || state.current;
        });
      });

      const back = container.querySelector('[data-role="qh-back"]');
      if (back) back.addEventListener('click', () => { state.current = null; api.paint(); });
    },
  });

  function holdListPanel(state, held) {
    if (!held.length) return `<div class="b09r-panel">${muted('No quality checkpoints are on hold.', 'لا توجد نقاط فحص جودة محجوزة.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Held records', 'السجلات المحجوزة'))}</h2></div>
      <div class="b09r-pool-list">${held.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.current?.id ? ' b09r-pool-selected' : ''}" data-role="qh-open" data-checkpoint-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.productId)}</strong><small>${esc(row.checkpointType)} · ${esc(row.sourceType)}/${esc(row.sourceId)} · ${esc(when(row.createdAt))}</small></span>
        <span class="b09r-pool-meta">${esc(t('rejected', 'مرفوض'))} ${esc(num(row.rejectedQuantity))}</span>
        ${row.ncrId ? badge('NCR', 'danger') : ''}${badge(row.status, CHECKPOINT_TONE[row.status] ?? '')}</button>`).join('')}</div></div>`;
  }

  function checkpointDetailPanel(current) {
    const evidence = current.evidence || [];
    return `<div class="b09r-panel" data-role="qh-detail">
      <div class="b09r-panel-head"><h2>${esc(current.checkpointType)} · ${esc(current.productId)}</h2>${badge(current.status, CHECKPOINT_TONE[current.status] ?? '')}</div>
      <div class="b09r-scope-line">
        <span>${esc(t('Source', 'المصدر'))}: ${esc(current.sourceType)}/${esc(current.sourceId)}</span>
        <span>${esc(t('Inspection', 'الفحص'))}: ${esc(current.inspectionId || '—')}</span>
        <span>${esc(t('Hold location', 'موقع الحجز'))}: ${esc(current.holdLocationId || '—')}</span>
        <span>${esc(t('NCR', 'عدم المطابقة'))}: ${esc(current.ncrId || '—')}</span></div>
      ${kpis([
        ['Sample size', 'حجم العينة', num(current.sampleSize)],
        ['Accepted', 'مقبول', num(current.acceptedQuantity), Number(current.acceptedQuantity) ? 'ok' : ''],
        ['Rejected', 'مرفوض', num(current.rejectedQuantity), Number(current.rejectedQuantity) ? 'danger' : ''],
      ])}
      <div class="b09r-group" data-role="qh-evidence"><div class="b09r-group-head">${badge(t('evidence', 'الأدلة'), 'info')}<span>${esc(num(evidence.length, 0))}</span></div>
        ${evidence.length ? evidence.map((item) => `<div class="b09r-scan-row"><span>${esc(typeof item === 'string' ? item : (item.label || item.type || JSON.stringify(item)))}</span></div>`).join('') : muted('No evidence has been attached to this checkpoint.', 'لم تُرفق أي أدلة بنقطة الفحص هذه.')}</div>
      ${HELD_STATES.includes(current.status) ? dispositionFormPanel(current) : ''}
      ${['hold', 'fail', 'quarantine'].includes(current.status) ? conditionalFormPanel(current) : ''}
      <div class="b09r-actions-row">
        <button type="button" class="b09-button b09r-btn-xl" data-role="qh-sync">↻ ${esc(t('Sync with canonical inspection', 'مزامنة مع الفحص الرسمي'))}</button>
        <button type="button" class="b09-button b09r-btn-xl" data-role="qh-back">${esc(t('Back to queue', 'العودة للطابور'))}</button>
      </div></div>`;
  }

  function dispositionFormPanel(current) {
    return `<form class="b09r-subform" data-role="qh-disposition-form">
      <div class="b09r-panel-head"><h2>${esc(t('Request disposition', 'طلب قرار المعالجة'))}</h2></div>
      <p>${esc(t('Rework, scrap and return-to-vendor require a canonical NCR link; the server refuses them otherwise.', 'إعادة العمل والإتلاف والإرجاع للمورد تتطلب ربطاً رسمياً بعدم المطابقة؛ وإلا يرفضها الخادم.'))}</p>
      <div class="b09r-grid-2">${select('disposition_type', 'Disposition', 'القرار', DISPOSITIONS, { required: true })}${field('quantity', 'Quantity', 'الكمية', { type: 'number', step: 'any', min: 0, required: true })}</div>
      <div class="b09r-grid-2">${field('reason_code', 'Reason code', 'رمز السبب', { required: true })}${field('ncr_id', 'NCR id', 'معرّف عدم المطابقة', { value: current.ncrId || '' })}</div>
      ${lookup('locations', 'source_location_id', 'Source location', 'موقع المصدر')}
      ${lookup('locations', 'destination_location_id', 'Destination location', 'موقع الوجهة')}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Request disposition', 'طلب القرار'))}</button>
    </form>`;
  }

  function conditionalFormPanel(current) {
    return `<form class="b09r-subform" data-role="qh-conditional-form">
      <div class="b09r-panel-head"><h2>${esc(t('Conditional acceptance', 'قبول مشروط'))}</h2></div>
      <p>${esc(t('A conditional acceptance needs a second person: whoever opened the checkpoint cannot conditionally accept it.', 'القبول المشروط يحتاج شخصاً ثانياً: من فتح نقطة الفحص لا يمكنه قبولها مشروطاً.'))}</p>
      <div class="b09r-grid-2">${field('accepted_quantity', 'Accepted quantity', 'الكمية المقبولة', { type: 'number', step: 'any', min: 0, required: true })}${field('reason_code', 'Reason code', 'رمز السبب')}</div>
      <button type="submit" class="b09-button b09r-btn-xl">${esc(t('Conditionally accept', 'قبول مشروط'))} (${esc(t('max', 'حد أقصى'))} ${esc(num(current.sampleSize))})</button>
    </form>`;
  }

  // ---------------------------------------------------------------- Rework Workspace

  const rework = S.createWorkspace({
    pageId: 'rework_workspace',
    prefix: 'rw',
    initialState: () => ({ routes: [], retest: null, loading: true }),

    async onActivate(state, api) {
      state.routes = await api.query('rework-routes').then((rows) => (Array.isArray(rows) ? rows : []));
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading rework routes…', 'جارِ تحميل مسارات إعادة العمل…'))}</p></div>`;
      if (!state.routes.length) return `${scopeLine()}<div class="b09r-panel">${muted('No rework routes are active. A rework route is created when a rework disposition is approved.', 'لا توجد مسارات إعادة عمل نشطة. يُنشأ المسار عند اعتماد قرار إعادة عمل.')}</div>`;
      return `${scopeLine()}${kpis([
          ['Routes', 'المسارات', num(state.routes.length, 0)],
          ['Running', 'قيد التنفيذ', num(state.routes.filter((row) => row.status === 'running').length, 0), 'info'],
          ['Awaiting retest', 'بانتظار إعادة الفحص', num(state.routes.filter((row) => row.status === 'retest').length, 0), state.routes.some((row) => row.status === 'retest') ? 'warn' : ''],
          ['Completed', 'مكتملة', num(state.routes.filter((row) => row.status === 'completed').length, 0), 'ok'],
        ])}
        <div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Rework routes', 'مسارات إعادة العمل'))}</h2></div>
          <div class="b09r-pool-list" data-role="rw-routes">${state.routes.map(reworkRow).join('')}</div></div>
        ${state.retest ? retestPanel(state.retest) : ''}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="rw-start"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        await api.call('quality:rework_start', { rework_route_id: button.dataset.routeId });
        state.routes = await api.query('rework-routes').then((rows) => (Array.isArray(rows) ? rows : []));
      })));

      container.querySelectorAll('[data-role="rw-complete"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        const result = await api.call('quality:rework_complete', { rework_route_id: button.dataset.routeId });
        state.retest = result.retestProposal || null;
        state.routes = await api.query('rework-routes').then((rows) => (Array.isArray(rows) ? rows : []));
      })));
    },
  });

  function reworkRow(route) {
    const controls = [
      ['planned', 'released'].includes(route.status) ? ['rw-start', t('Start rework', 'بدء إعادة العمل'), 'b09-primary'] : null,
      route.status === 'running' ? ['rw-complete', t('Complete rework', 'إكمال إعادة العمل'), 'b09-primary'] : null,
    ].filter(Boolean);
    return `<div class="b09r-pool-row" data-route-id="${esc(route.id)}">
      <span class="b09r-pool-main"><strong>${esc(route.route_reference)}</strong>
        <small>${esc(t('order', 'أمر'))} ${esc(route.production_order_id || '—')} · ${esc(t('from WO', 'من أمر عمل'))} ${esc(route.source_work_order_id || '—')} · ${esc((route.operations || []).length)} ${esc(t('operations', 'عملية'))}</small></span>
      ${route.retest_required ? badge(t('retest required', 'يلزم إعادة فحص'), 'warn') : badge(t('no retest', 'بدون إعادة فحص'), 'muted')}
      ${badge(route.status, REWORK_TONE[route.status] ?? '')}
      ${controls.map(([role, label, extra]) => `<button type="button" class="b09-button ${extra}" data-role="${esc(role)}" data-route-id="${esc(route.id)}">${esc(label)}</button>`).join('')}
    </div>`;
  }

  function retestPanel(retest) {
    return `<div class="b09r-panel" data-role="rw-retest">
      <div class="b09r-panel-head"><h2>${esc(t('Retest proposal', 'مقترح إعادة الفحص'))}</h2>${badge(t('request only', 'طلب فقط'), 'info')}</div>
      <p>${esc(t('The rework finished and requires a retest. Canonical Quality creates the inspection — this workspace only proposes it.', 'انتهت إعادة العمل وتتطلب إعادة فحص. قسم الجودة الرسمي ينشئ الفحص — هذه المساحة تقترحه فقط.'))}</p>
      <div class="b09r-scope-line"><span>${esc(t('Canonical action', 'الإجراء الرسمي'))}: ${esc(retest.canonicalAction)}</span><span>${esc(t('Boundary', 'الحد'))}: ${esc(retest.executionBoundary)}</span></div></div>`;
  }

  // ---------------------------------------------------------------- Scrap Approval

  const scrap = S.createWorkspace({
    pageId: 'scrap_approval',
    prefix: 'sc',
    initialState: () => ({ dispositions: [], current: null, loading: true }),

    async onActivate(state, api) {
      const rows = await api.query('quality-dispositions').then((list) => (Array.isArray(list) ? list : []));
      state.dispositions = rows;
      if (state.current) state.current = rows.find((row) => row.id === state.current.id) || null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading dispositions…', 'جارِ تحميل القرارات…'))}</p></div>`;
      const pending = state.dispositions.filter((row) => row.status === 'requested');
      return `${scopeLine()}${kpis([
          ['Dispositions', 'القرارات', num(state.dispositions.length, 0)],
          ['Awaiting approval', 'بانتظار الاعتماد', num(pending.length, 0), pending.length ? 'warn' : 'ok'],
          ['Awaiting Inventory', 'بانتظار المخزون', num(state.dispositions.filter((row) => row.status === 'awaiting_canonical').length, 0), 'info'],
          ['Completed', 'مكتملة', num(state.dispositions.filter((row) => ['completed', 'closed'].includes(row.status)).length, 0), 'ok'],
        ])}
        ${state.current ? dispositionDetailPanel(state.current) : ''}
        ${dispositionListPanel(state)}`;
    },

    bind(container, state, api) {
      container.querySelectorAll('[data-role="sc-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        state.current = state.dispositions.find((row) => row.id === button.dataset.dispositionId) || null;
      })));

      const approve = container.querySelector('[data-role="sc-approve-form"]');
      if (approve) approve.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(approve);
          await api.call('quality:disposition_approve', { disposition_id: state.current.id, decision_notes: data.decision_notes || undefined, route_reference: data.route_reference || undefined });
          state.dispositions = await api.query('quality-dispositions').then((list) => (Array.isArray(list) ? list : []));
          state.current = state.dispositions.find((row) => row.id === state.current.id) || null;
        });
      });

      const request = container.querySelector('[data-role="sc-request-canonical"]');
      if (request) request.addEventListener('click', () => api.guarded(async () => {
        await api.call('quality:scrap_request_canonical', { disposition_id: state.current.id });
        state.dispositions = await api.query('quality-dispositions').then((list) => (Array.isArray(list) ? list : []));
        state.current = state.dispositions.find((row) => row.id === state.current.id) || null;
      }));

      const acknowledge = container.querySelector('[data-role="sc-ack-form"]');
      if (acknowledge) acknowledge.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(acknowledge);
          await api.call('quality:scrap_acknowledge', { disposition_id: state.current.id, canonical_result_id: data.canonical_result_id });
          state.dispositions = await api.query('quality-dispositions').then((list) => (Array.isArray(list) ? list : []));
          state.current = state.dispositions.find((row) => row.id === state.current.id) || null;
        });
      });
    },
  });

  function dispositionListPanel(state) {
    if (!state.dispositions.length) return `<div class="b09r-panel">${muted('No dispositions have been requested.', 'لم تُطلب أي قرارات معالجة.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Dispositions', 'القرارات'))}</h2></div>
      <div class="b09r-pool-list">${state.dispositions.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.current?.id ? ' b09r-pool-selected' : ''}" data-role="sc-open" data-disposition-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.dispositionType)}</strong><small>${esc(t('qty', 'كمية'))} ${esc(num(row.quantity))} · ${esc(row.reasonCode || '—')} · ${esc(t('by', 'بواسطة'))} ${esc(row.requestedBy || '—')}</small></span>
        ${badge(row.status, DISPOSITION_TONE[row.status] ?? '')}</button>`).join('')}</div></div>`;
  }

  function dispositionDetailPanel(current) {
    return `<div class="b09r-panel" data-role="sc-detail">
      <div class="b09r-panel-head"><h2>${esc(current.dispositionType)} · ${esc(num(current.quantity))}</h2>${badge(current.status, DISPOSITION_TONE[current.status] ?? '')}</div>
      ${stepper(DISPOSITION_STEPS, current.status === 'route_created' ? 'approved' : current.status)}
      <div class="b09r-scope-line">
        <span>${esc(t('Requested by', 'طلبها'))}: ${esc(current.requestedBy || '—')}</span>
        <span>${esc(t('Approved by', 'اعتمدها'))}: ${esc(current.approvedBy || '—')}</span>
        <span>${esc(t('Reason', 'السبب'))}: ${esc(current.reasonCode || '—')}</span>
        <span>${esc(t('NCR', 'عدم المطابقة'))}: ${esc(current.ncrId || '—')}</span></div>
      <div class="b09r-scope-line"><span>${esc(t('From', 'من'))}: ${esc(current.sourceLocationId || '—')}</span><span>${esc(t('To', 'إلى'))}: ${esc(current.destinationLocationId || '—')}</span></div>
      ${current.status === 'requested' ? approveFormPanel(current) : ''}
      ${current.status === 'approved' && current.canonicalAction === 'stock:move:post' ? canonicalRequestPanel(current) : ''}
      ${current.status === 'awaiting_canonical' ? acknowledgeFormPanel(current) : ''}
      ${['completed', 'closed'].includes(current.status) ? `<p class="b09r-success" data-role="sc-completed">✓ ${esc(t('Canonical scrap acknowledged', 'تم الإقرار بالإتلاف الرسمي'))}: ${esc(current.canonicalResultId || '—')}</p>` : ''}
    </div>`;
  }

  function approveFormPanel(current) {
    return `<form class="b09r-subform" data-role="sc-approve-form">
      <div class="b09r-panel-head"><h2>${esc(t('Approval', 'الاعتماد'))}</h2></div>
      <p>${esc(t('Approval requires a second person — the requester cannot approve their own disposition.', 'الاعتماد يتطلب شخصاً ثانياً — لا يمكن لمقدّم الطلب اعتماد قراره.'))}</p>
      ${textarea('decision_notes', 'Decision notes', 'ملاحظات القرار', { rows: 2 })}
      ${current.dispositionType === 'rework' ? field('route_reference', 'Rework route reference', 'مرجع مسار إعادة العمل') : ''}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Approve disposition', 'اعتماد القرار'))}</button>
    </form>`;
  }

  function canonicalRequestPanel(current) {
    const request = current.canonicalRequest || {};
    return `<div class="b09r-group" data-role="sc-canonical">
      <div class="b09r-group-head">${badge(t('canonical scrap request — Inventory posts it, not Quality', 'طلب إتلاف رسمي — المخزون يرحّله وليس الجودة'), 'info')}</div>
      <div class="b09r-scan-row"><span>${esc(current.canonicalAction)}</span><span>${esc(request.product_id || '—')}</span><span>${esc(num(request.product_qty))}</span><span>${esc(request.location_dest_id || '—')}</span></div>
      <button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="sc-request-canonical">${esc(t('Send canonical scrap request', 'إرسال طلب الإتلاف الرسمي'))}</button>
    </div>`;
  }

  function acknowledgeFormPanel() {
    return `<form class="b09r-subform" data-role="sc-ack-form">
      <div class="b09r-panel-head"><h2>${esc(t('Acknowledge canonical scrap', 'الإقرار بالإتلاف الرسمي'))}</h2></div>
      <p>${esc(t('Paste the posted canonical stock move. The server re-verifies its product, quantity and destination before accepting the acknowledgement.', 'الصق حركة المخزون الرسمية المرحّلة. يعيد الخادم التحقق من المنتج والكمية والوجهة قبل قبول الإقرار.'))}</p>
      ${field('canonical_result_id', 'Canonical stock move id', 'معرّف الحركة المخزنية الرسمية', { required: true })}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Acknowledge', 'إقرار'))}</button>
    </form>`;
  }

  root.Build09QualityHoldQueue = holdQueue;
  root.Build09ReworkWorkspace = rework;
  root.Build09ScrapApproval = scrap;
  S.registerOverride('quality_hold_queue', holdQueue);
  S.registerOverride('rework_workspace', rework);
  S.registerOverride('scrap_approval', scrap);
})(window);
