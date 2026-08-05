/** BUILD-09R-2 Group C: Lot/Serial Traceability and Recall Analysis workspaces.
 *
 * Traceability answers two questions about one identity: where did this come from (backward
 * chain, to supplier receipts and production consumption) and where did it go (forward chain,
 * to deliveries, production output and current location). The generic table shell could only
 * ever show one flat movement list, which is the one thing a trace is not.
 *
 * Recall Analysis runs the governed case lifecycle in platform/wms/traceability-ops.mjs:
 * identify -> analyze (impact fan-out) -> propose holds -> close. Everything it produces is a
 * PROPOSAL: no customer is messaged, no work item is created, no stock is held. The workspace
 * states that on screen and renders the sendAuthorized / createAuthorized / executionBoundary
 * flags the server returns, because a recall screen that looks like it already notified
 * customers is worse than no screen at all.
 */
(function traceWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, badge, kpis, scopeLine, stepper, field, textarea, lookup, muted } = S;

  const RECALL_STEPS = [['identified', 'Identified', 'محدد'], ['analyzed', 'Analyzed', 'تم التحليل'], ['hold_proposed', 'Holds proposed', 'اقتُرحت الحجوزات'], ['closed', 'Closed', 'مغلق']];
  const STATUS_TONE = { identified: 'warn', analyzing: 'info', analyzed: 'info', hold_proposed: 'warn', approved: 'ok', closed: 'ok', cancelled: 'muted' };
  const QUALITY_TONE = { approved: 'ok', released: 'ok', hold: 'warn', quarantine: 'warn', rejected: 'danger', expired: 'danger' };
  const statusBadge = (status) => badge(status, STATUS_TONE[status] ?? '');

  // ---------------------------------------------------------------- Lot / Serial Traceability

  const traceability = S.createWorkspace({
    pageId: 'lot_serial_traceability',
    prefix: 'tr',
    initialState: () => ({ identityType: 'lot', trace: null, searched: false, loading: false }),

    render(state) {
      const header = scopeLine([state.trace ? `${t('Product', 'المنتج')}: ${esc(state.trace.identity?.productId || '—')}` : '']);
      return `${header}${identityPanel(state)}${state.trace ? tracePanels(state.trace) : (state.searched ? muted('No trace data was returned for that identity.', 'لم تُرجع أي بيانات تتبع لهذه الهوية.') : '')}`;
    },

    bind(container, state, api) {
      const typeToggle = container.querySelector('[data-role="tr-identity-type"]');
      if (typeToggle) typeToggle.addEventListener('change', () => {
        state.identityType = typeToggle.value;
        const slot = container.querySelector('[data-role="tr-identity-slot"]');
        if (slot) {
          slot.innerHTML = state.identityType === 'serial' ? lookup('serials', 'serial_id', 'Serial', 'الرقم التسلسلي') : lookup('lots', 'lot_id', 'Lot', 'الدفعة');
          S.wireLookups(slot, 'trBound');
        }
      });

      const form = container.querySelector('[data-role="tr-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          const identity = state.identityType === 'serial' ? { serial_id: data.serial_id } : { lot_id: data.lot_id };
          if (!identity.lot_id && !identity.serial_id) throw new Error(t('Select a lot or serial first.', 'اختر دفعة أو رقماً تسلسلياً أولاً.'));
          state.trace = await api.query('trace', identity);
          state.searched = true;
        });
      });
    },
  });

  function identityPanel(state) {
    return `<form class="b09r-panel" data-role="tr-form">
      <div class="b09r-panel-head"><h2>${esc(t('Trace identity', 'هوية التتبع'))}</h2></div>
      <p>${esc(t('Traceability follows one canonical lot or serial. Pick the identity, then read the backward chain (where it came from) and the forward chain (where it went).', 'التتبع يلاحق دفعة أو رقماً تسلسلياً واحداً. اختر الهوية، ثم اقرأ السلسلة الخلفية (من أين أتى) والسلسلة الأمامية (إلى أين ذهب).'))}</p>
      <label class="b09r-field-lg"><span>${esc(t('Identity type', 'نوع الهوية'))}</span><select data-role="tr-identity-type">
        <option value="lot"${state.identityType === 'lot' ? ' selected' : ''}>${esc(t('Lot', 'دفعة'))}</option>
        <option value="serial"${state.identityType === 'serial' ? ' selected' : ''}>${esc(t('Serial', 'رقم تسلسلي'))}</option></select></label>
      <div data-role="tr-identity-slot">${state.identityType === 'serial' ? lookup('serials', 'serial_id', 'Serial', 'الرقم التسلسلي') : lookup('lots', 'lot_id', 'Lot', 'الدفعة')}</div>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Trace', 'تتبع'))}</button>
    </form>`;
  }

  function tracePanels(trace) {
    const quality = trace.quality || {};
    return `${kpis([
        ['Movements', 'الحركات', num(trace.movements?.length || 0, 0)],
        ['Locations touched', 'المواقع', num(trace.locationHistory?.length || 0, 0)],
        ['Customer exposure', 'التعرض للعملاء', num(trace.customerExposure?.length || 0, 0), trace.customerExposure?.length ? 'warn' : 'ok'],
        ['Supplier receipts', 'استلامات الموردين', num(trace.supplierExposure?.length || 0, 0)],
      ])}
      <div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Identity and quality', 'الهوية والجودة'))}</h2>
        ${quality.status ? badge(quality.status, QUALITY_TONE[quality.status] ?? '') : ''}${quality.recallFlag ? badge(t('recall flagged', 'معلّم للسحب'), 'danger') : ''}</div>
        <div class="b09r-scope-line" data-role="tr-identity">
          <span>${esc(t('Lot', 'الدفعة'))}: ${esc(trace.identity?.lot?.lot_number || trace.identity?.lot?.id || '—')}</span>
          <span>${esc(t('Serial', 'الرقم التسلسلي'))}: ${esc(trace.identity?.serial?.serial_number || trace.identity?.serial?.id || '—')}</span>
          <span>${esc(t('Current location', 'الموقع الحالي'))}: ${esc(trace.currentLocation || '—')}</span>
          <span>${esc(t('Expires', 'ينتهي'))}: ${esc(when(trace.expiration))}</span></div></div>
      <div class="b09r-chains">
        ${chainPanel('tr-backward', t('Backward chain — origin', 'السلسلة الخلفية — المنشأ'), trace.backwardTrace, t('No inbound movements are recorded for this identity.', 'لا توجد حركات واردة مسجلة لهذه الهوية.'))}
        ${chainPanel('tr-forward', t('Forward chain — destination', 'السلسلة الأمامية — الوجهة'), trace.forwardTrace, t('No outbound movements are recorded for this identity.', 'لا توجد حركات صادرة مسجلة لهذه الهوية.'))}
      </div>
      ${documentsPanel(trace)}
      ${locationsPanel(trace)}`;
  }

  function chainPanel(role, title, chain, emptyText) {
    const rows = (chain || []).length
      ? chain.map((link) => `<div class="b09r-scan-row"><span>${esc(link.from || '—')} → ${esc(link.to || '—')}</span><span>${esc(link.sourceDocumentType || 'stock_move')}</span><span>${esc(link.sourceDocumentId || link.moveId)}</span></div>`).join('')
      : `<p class="b09r-muted">${esc(emptyText)}</p>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(title)}</h2></div><div class="b09r-scan-list" data-role="${esc(role)}">${rows}</div></div>`;
  }

  function documentsPanel(trace) {
    const groups = [
      [t('Supplier receipts', 'استلامات الموردين'), trace.sourceReceipts],
      [t('Production consumption', 'استهلاك الإنتاج'), trace.productionConsumption],
      [t('Production output', 'مخرجات الإنتاج'), trace.productionOutput],
      [t('Deliveries', 'التسليمات'), trace.deliveries],
      [t('Returns', 'المرتجعات'), trace.returns],
    ].filter(([, rows]) => (rows || []).length);
    if (!groups.length) return `<div class="b09r-panel">${muted('No affected documents were found for this identity.', 'لم يتم العثور على وثائق متأثرة لهذه الهوية.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Affected documents', 'الوثائق المتأثرة'))}</h2></div>
      <div data-role="tr-documents">${groups.map(([title, rows]) => `<div class="b09r-group"><div class="b09r-group-head">${badge(title, 'info')}<span>${esc(num(rows.length, 0))}</span></div>
        ${rows.map((row) => `<div class="b09r-scan-row"><span>${esc(row.source_document_type || 'stock_move')}</span><span>${esc(row.source_document_id || row.move_id)}</span><span>${esc(num(row.quantity))}</span></div>`).join('')}</div>`).join('')}</div></div>`;
  }

  function locationsPanel(trace) {
    const rows = trace.locationHistory || [];
    if (!rows.length) return '';
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Affected locations', 'المواقع المتأثرة'))}</h2></div>
      <div class="b09r-scan-list" data-role="tr-locations">${rows.map((row) => `<div class="b09r-scan-row"><span>${esc(row.locationId)}</span>${badge(row.direction === 'source' ? t('out', 'صادر') : t('in', 'وارد'), row.direction === 'source' ? '' : 'info')}<span>${esc(when(row.at))}</span></div>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- Recall Analysis

  const recall = S.createWorkspace({
    pageId: 'recall_analysis',
    prefix: 'rc',
    initialState: () => ({ cases: [], current: null, analysis: null, holds: null, identityType: 'lot', loading: true }),

    async onActivate(state, api) {
      state.cases = await api.query('recall-cases').then((rows) => (Array.isArray(rows) ? rows : []));
      if (state.current) state.current = state.cases.find((row) => row.id === state.current.id) || state.current;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading recall cases…', 'جارِ تحميل حالات السحب…'))}</p></div>`;
      const open = state.cases.filter((row) => row.status !== 'closed');
      const board = kpis([
        ['Recall cases', 'حالات السحب', num(state.cases.length, 0)],
        ['Open', 'مفتوحة', num(open.length, 0), open.length ? 'warn' : 'ok'],
        ['Closed', 'مغلقة', num(state.cases.length - open.length, 0), 'ok'],
      ]);
      return `${scopeLine()}${board}${state.current ? caseDetailPanel(state) : ''}${caseListPanel(state)}${identifyPanel(state)}`;
    },

    bind(container, state, api) {
      const typeToggle = container.querySelector('[data-role="rc-identity-type"]');
      if (typeToggle) typeToggle.addEventListener('change', () => {
        state.identityType = typeToggle.value;
        const slot = container.querySelector('[data-role="rc-identity-slot"]');
        if (slot) {
          slot.innerHTML = state.identityType === 'serial' ? lookup('serials', 'serial_id', 'Serial', 'الرقم التسلسلي') : lookup('lots', 'lot_id', 'Lot', 'الدفعة');
          S.wireLookups(slot, 'rcBound');
        }
      });

      const identify = container.querySelector('[data-role="rc-identify-form"]');
      if (identify) identify.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(identify);
          if (!data.lot_id && !data.serial_id) throw new Error(t('Select the lot or serial being recalled.', 'اختر الدفعة أو الرقم التسلسلي المسحوب.'));
          state.current = await api.call('wms:recall_identify', {
            reference: data.reference, reason: data.reason,
            lot_id: data.lot_id || undefined, serial_id: data.serial_id || undefined,
          });
          state.analysis = null; state.holds = null;
          state.cases = await api.query('recall-cases').then((rows) => (Array.isArray(rows) ? rows : []));
        });
      });

      container.querySelectorAll('[data-role="rc-open"]').forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
        state.current = state.cases.find((row) => row.id === button.dataset.caseId) || null;
        state.analysis = null; state.holds = null;
      })));

      const analyze = container.querySelector('[data-role="rc-analyze"]');
      if (analyze) analyze.addEventListener('click', () => api.guarded(async () => {
        const result = await api.call('wms:recall_analyze', { recall_case_id: state.current.id });
        state.current = result; state.analysis = result;
        state.cases = await api.query('recall-cases').then((rows) => (Array.isArray(rows) ? rows : []));
      }));

      const holds = container.querySelector('[data-role="rc-propose-holds"]');
      if (holds) holds.addEventListener('click', () => api.guarded(async () => {
        const result = await api.call('wms:recall_propose_holds', { recall_case_id: state.current.id });
        state.current = result; state.holds = result;
        state.cases = await api.query('recall-cases').then((rows) => (Array.isArray(rows) ? rows : []));
      }));
    },
  });

  function caseListPanel(state) {
    if (!state.cases.length) return `<div class="b09r-panel">${muted('No recall cases have been identified.', 'لم يتم تحديد أي حالات سحب.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Recall cases', 'حالات السحب'))}</h2></div>
      <div class="b09r-pool-list">${state.cases.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row" data-role="rc-open" data-case-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.reference)}</strong><small>${esc(row.reason)} · ${esc(when(row.identifiedAt))}</small></span>${statusBadge(row.status)}</button>`).join('')}</div></div>`;
  }

  function identifyPanel(state) {
    return `<form class="b09r-panel" data-role="rc-identify-form">
      <div class="b09r-panel-head"><h2>${esc(t('Identify a recall', 'تحديد حالة سحب'))}</h2></div>
      ${field('reference', 'Recall reference', 'مرجع السحب', { required: true, placeholder: t('e.g. RECALL-2026-04', 'مثال: RECALL-2026-04') })}
      ${textarea('reason', 'Reason', 'السبب', { required: true, placeholder: t('Why is this lot being recalled?', 'لماذا تُسحب هذه الدفعة؟') })}
      <label class="b09r-field-lg"><span>${esc(t('Identity type', 'نوع الهوية'))}</span><select data-role="rc-identity-type">
        <option value="lot"${state.identityType === 'lot' ? ' selected' : ''}>${esc(t('Lot', 'دفعة'))}</option>
        <option value="serial"${state.identityType === 'serial' ? ' selected' : ''}>${esc(t('Serial', 'رقم تسلسلي'))}</option></select></label>
      <div data-role="rc-identity-slot">${state.identityType === 'serial' ? lookup('serials', 'serial_id', 'Serial', 'الرقم التسلسلي') : lookup('lots', 'lot_id', 'Lot', 'الدفعة')}</div>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Identify recall case', 'تحديد حالة السحب'))}</button>
    </form>`;
  }

  function caseDetailPanel(state) {
    const current = state.current;
    const summary = current.impactSummary || {};
    const impacts = state.analysis?.impacts || [];
    return `<div class="b09r-panel">
      <div class="b09r-panel-head"><h2>${esc(current.reference)}</h2>${statusBadge(current.status)}</div>
      ${stepper(RECALL_STEPS, current.status)}
      <div class="b09r-scope-line"><span>${esc(t('Reason', 'السبب'))}: ${esc(current.reason)}</span><span>${esc(t('Identified by', 'حددها'))}: ${esc(current.identifiedBy || '—')}</span><span>${esc(t('Approved by', 'اعتمدها'))}: ${esc(current.approvedBy || '—')}</span></div>
      ${summary.totalRecords != null ? kpis([
        ['Affected records', 'السجلات المتأثرة', num(summary.totalRecords, 0), summary.totalRecords ? 'warn' : 'ok'],
        ['Affected quantity', 'الكمية المتأثرة', num(summary.totalQuantity)],
        ['Impact types', 'أنواع التأثير', num(Object.keys(summary.byType || {}).length, 0)],
      ]) : ''}
      ${impacts.length ? `<div class="b09r-scan-list" data-role="rc-impacts">${impacts.map((impact) => `<div class="b09r-scan-row"><span>${esc(impact.record_type)}/${esc(impact.record_id)}</span><span>${esc(num(impact.quantity))}</span>${badge(impact.impact_type, 'info')}${badge(impact.hold_status, 'warn')}</div>`).join('')}</div>` : ''}
      ${proposalNotice(state)}
      <div class="b09r-actions-row">
        ${['identified', 'analyzing', 'analyzed'].includes(current.status) ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="rc-analyze">${esc(t('Analyze impact', 'تحليل التأثير'))}</button>` : ''}
        ${current.status === 'analyzed' ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="rc-propose-holds">${esc(t('Propose holds', 'اقتراح الحجوزات'))}</button>` : ''}
      </div></div>`;
  }

  /** Everything a recall produces is a proposal. Say so, and show the server's own flags. */
  function proposalNotice(state) {
    const current = state.current;
    const notifications = current.notificationProposals || [];
    const workItems = current.workItemProposals || [];
    const holdRequests = state.holds?.holdRequests || [];
    if (!notifications.length && !workItems.length && !holdRequests.length) return '';
    return `<div class="b09r-group" data-role="rc-proposals">
      <div class="b09r-group-head">${badge(t('proposals only — nothing has been sent, created or held', 'مقترحات فقط — لم يُرسل أو يُنشأ أو يُحجز أي شيء'), 'warn')}</div>
      ${notifications.length ? `<div class="b09r-scan-row"><span>${esc(t('Notification proposals', 'مقترحات الإشعار'))}</span><span>${esc(num(notifications.length, 0))}</span>${badge(state.analysis?.externalMessagesSent === false || !state.analysis ? t('not sent', 'لم تُرسل') : t('sent', 'أُرسلت'), 'ok')}</div>` : ''}
      ${workItems.length ? `<div class="b09r-scan-row"><span>${esc(t('Work item proposals', 'مقترحات مهام العمل'))}</span><span>${esc(num(workItems.length, 0))}</span>${badge(state.analysis?.workItemsCreated === false || !state.analysis ? t('not created', 'لم تُنشأ') : t('created', 'أُنشئت'), 'ok')}</div>` : ''}
      ${holdRequests.length ? `<div class="b09r-scan-row"><span>${esc(t('Hold requests', 'طلبات الحجز'))}</span><span>${esc(num(holdRequests.length, 0))}</span>${badge(t('request only', 'طلب فقط'), 'info')}</div>` : ''}
    </div>`;
  }

  root.Build09Traceability = traceability;
  root.Build09RecallAnalysis = recall;
  S.registerOverride('lot_serial_traceability', traceability);
  S.registerOverride('recall_analysis', recall);
})(window);
