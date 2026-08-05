/** Governed Production Material workspaces. Inventory effects remain request-only. */
(function productionMaterialWorkspaces(root) {
  'use strict';

  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, badge, kpis, scopeLine, muted, lookup, field, select } = S;

  const TYPES = {
    requests: new Set(['request', 'reservation']),
    movements: new Set(['issue', 'return']),
    receipts: new Set(['production_receipt']),
  };

  async function loadRows(api) {
    const result = await api.query('material-flow');
    return Array.isArray(result) ? result : [];
  }

  function label(record, fallback) {
    return record?.name || record?.order_number || record?.code || fallback || '—';
  }

  function statusBadge(status) {
    const tone = status === 'completed' ? 'ok' : status === 'shortage' ? 'danger' : status === 'awaiting_canonical' ? 'warn' : 'info';
    return badge(status || 'requested', tone);
  }

  function timeline(row) {
    const entries = [
      [t('Requested', 'طُلب'), row.requestedBy, row.createdAt],
      [t('Approved', 'اعتُمد'), row.approvedBy, row.approvedBy ? row.updatedAt : null],
      [t('Updated', 'حُدّث'), null, row.updatedAt],
    ].filter((entry) => entry[2]);
    return `<ol class="b09r-stepper" data-role="pm-timeline">${entries.map(([event, actor, at]) => `<li><strong>${esc(event)}</strong><small>${esc(actor || '—')} · ${esc(when(at))}</small></li>`).join('')}</ol>`;
  }

  function quantityGrid(row) {
    const requirement = row.requirement || {};
    return `<div class="b09r-grid-2">
      <span>${esc(t('Required', 'المطلوب'))}: <strong>${esc(num(requirement.required_quantity))}</strong></span>
      <span>${esc(t('Requested', 'الكمية المطلوبة'))}: <strong>${esc(num(row.requestedQuantity))}</strong></span>
      <span>${esc(t('Available', 'المتاح'))}: <strong>${esc(num(row.availableQuantity))}</strong></span>
      <span>${esc(t('Reserved', 'المحجوز'))}: <strong>${esc(num(requirement.reserved_quantity))}</strong></span>
      <span>${esc(t('Approved', 'المعتمد'))}: <strong>${esc(num(row.approvedQuantity))}</strong></span>
      <span>${esc(t('Issued', 'المصروف'))}: <strong>${esc(num(requirement.issued_quantity))}</strong></span>
      <span>${esc(t('Returned', 'المرتجع'))}: <strong>${esc(num(requirement.returned_quantity))}</strong></span>
      <span>${esc(t('Shortage', 'النقص'))}: <strong>${esc(num(row.shortageQuantity))}</strong></span>
    </div>`;
  }

  function recordCard(row, selected, role) {
    return `<button type="button" class="b09r-queue-row${selected ? ' b09r-selected' : ''}" data-role="${esc(role)}" data-id="${esc(row.id)}">
      <span class="b09r-pool-main"><strong>${esc(label(row.product, row.productId))}</strong>
      <small>${esc(label(row.productionOrder, row.productionOrderId))} · ${esc(label(row.workOrder, row.workOrderId))}</small></span>
      ${statusBadge(row.status)}</button>`;
  }

  function createRequestForm() {
    return `<form class="b09r-panel" data-role="pmr-create">
      <div class="b09r-panel-head"><h2>${esc(t('Create material request', 'إنشاء طلب مواد'))}</h2></div>
      ${lookup('productionOrders', 'production_order_id', 'Production order', 'أمر الإنتاج')}
      ${lookup('workOrders', 'work_order_id', 'Work order', 'أمر العمل')}
      ${lookup('products', 'product_id', 'Material', 'المادة')}
      ${lookup('locations', 'source_location_id', 'Source location', 'موقع المصدر')}
      ${lookup('locations', 'destination_location_id', 'Work center / staging destination', 'وجهة مركز العمل / التجهيز')}
      ${field('requested_quantity', 'Quantity', 'الكمية', { type: 'number', min: 0, step: '0.01', required: true })}
      ${select('request_type', 'Request type', 'نوع الطلب', [['request','Request','طلب'],['reservation','Reservation','حجز']], { required: true })}
      <button class="b09-button b09-primary" type="submit">${esc(t('Create governed request', 'إنشاء طلب محكوم'))}</button>
    </form>`;
  }

  const requests = S.createWorkspace({
    pageId: 'production_material_requests', prefix: 'pmr',
    initialState: () => ({ rows: [], selectedId: '', filter: '', loading: true }),
    async onActivate(state, api) { state.rows = await loadRows(api); },
    render(state) {
      if (state.loading) return `${scopeLine()}${muted('Loading material requests…', 'جارِ تحميل طلبات المواد…')}`;
      const rows = state.rows.filter((row) => TYPES.requests.has(row.requestType) && (!state.filter || row.status === state.filter));
      const selected = rows.find((row) => row.id === state.selectedId) || rows[0] || null;
      return `${scopeLine()}${kpis([['Requests','الطلبات',num(rows.length,0)],['Shortages','النواقص',num(rows.filter(r=>r.status==='shortage').length,0),'danger'],['Approved','المعتمدة',num(rows.filter(r=>['task_created','awaiting_canonical','completed'].includes(r.status)).length,0),'ok']])}
        <section class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Request and shortage control', 'الطلبات والتحكم بالنقص'))}</h2>
        <select data-role="pmr-filter"><option value="">All states</option><option value="requested">Requested</option><option value="shortage">Shortage</option><option value="availability_checked">Available</option></select></div>
        <div class="b09r-grid-2"><div>${rows.map((row)=>recordCard(row, selected?.id===row.id, 'pmr-select')).join('') || muted('No material requests in this scope.','لا توجد طلبات مواد في هذا النطاق.')}</div>${selected ? requestDetail(selected) : ''}</div></section>${createRequestForm()}`;
    },
    bind(container, state, api) {
      container.querySelector('[data-role="pmr-filter"]')?.addEventListener('change', (event) => { state.filter = event.target.value; api.paint(); });
      container.querySelectorAll('[data-role="pmr-select"]').forEach((button) => button.addEventListener('click', () => { state.selectedId = button.dataset.id; api.paint(); }));
      const form = container.querySelector('[data-role="pmr-create"]');
      form?.addEventListener('submit', (event) => { event.preventDefault(); api.guarded(async () => { const data = api.formData(form); await api.call('shopfloor:material_request', data); state.rows = await loadRows(api); }); });
      container.querySelector('[data-role="pmr-check"]')?.addEventListener('click', (event) => api.guarded(async () => { await api.call('shopfloor:material_availability', { request_id: event.currentTarget.dataset.id }); state.rows = await loadRows(api); }));
      container.querySelector('[data-role="pmr-approve"]')?.addEventListener('click', (event) => api.guarded(async () => { await api.call('shopfloor:material_approve', { request_id: event.currentTarget.dataset.id }); state.rows = await loadRows(api); }));
    },
  });

  function requestDetail(row) {
    return `<article class="b09r-panel" data-role="pmr-detail"><div class="b09r-panel-head"><h2>${esc(label(row.product,row.productId))}</h2>${statusBadge(row.status)}</div>
      <p>${esc(t('Production','الإنتاج'))}: ${esc(label(row.productionOrder,row.productionOrderId))} · ${esc(label(row.workOrder,row.workOrderId))} · ${esc(label(row.workOrder && { name: row.workOrder.work_center_name }, row.workOrder?.work_center_code))}</p>
      <p>${esc(t('Required date','التاريخ المطلوب'))}: ${esc(when(row.productionOrder?.planned_start_date))} · ${esc(t('Source','المصدر'))}: ${esc(label(row.sourceLocation,row.sourceLocationId))}</p>
      ${quantityGrid(row)}${timeline(row)}<div class="b09r-actions-row">
      ${['requested','shortage','availability_checked'].includes(row.status) ? `<button class="b09-button" data-role="pmr-check" data-id="${esc(row.id)}">${esc(t('Check availability','فحص التوفر'))}</button>` : ''}
      ${['requested','shortage','availability_checked'].includes(row.status) ? `<button class="b09-button b09-primary" data-role="pmr-approve" data-id="${esc(row.id)}">${esc(t('Approve proposal','اعتماد المقترح'))}</button>` : ''}</div>
      <p class="b09r-muted">${esc(t('No reject, cancel, or replenishment handler exists in the current server contract.','لا يوجد معالج رفض أو إلغاء أو تجديد في عقد الخادم الحالي.'))}</p></article>`;
  }

  function canonicalForm(row, prefix) {
    if (row.status === 'task_created') return `<button class="b09-button b09-primary" data-role="${prefix}-request" data-id="${esc(row.id)}">${esc(t('Request canonical movement','طلب الحركة الرسمية'))}</button>`;
    if (row.status === 'awaiting_canonical') return `<form data-role="${prefix}-ack" data-id="${esc(row.id)}">${field('canonical_result_id','Canonical Inventory result','نتيجة المخزون الرسمية',{required:true})}<button class="b09-button b09-primary" type="submit">${esc(t('Acknowledge','إقرار'))}</button></form>`;
    return '';
  }

  function movementWorkspace() {
    return S.createWorkspace({ pageId:'production_issue_return',prefix:'pmi',initialState:()=>({rows:[],selectedId:'',loading:true}),async onActivate(s,api){s.rows=await loadRows(api);},
      render(s){if(s.loading)return `${scopeLine()}${muted('Loading issue and return queue…','جارِ تحميل طابور الصرف والإرجاع…')}`;const rows=s.rows.filter(r=>TYPES.movements.has(r.requestType));const selected=rows.find(r=>r.id===s.selectedId)||rows[0]||null;return `${scopeLine()}${kpis([['Issues','الصرف',num(rows.filter(r=>r.requestType==='issue').length,0)],['Returns','الإرجاع',num(rows.filter(r=>r.requestType==='return').length,0)],['Awaiting Inventory','بانتظار المخزون',num(rows.filter(r=>r.status==='awaiting_canonical').length,0),'warn']])}<section class="b09r-panel"><div class="b09r-grid-2"><div>${rows.map(r=>recordCard(r,selected?.id===r.id,'pmi-select')).join('')||muted('No issue or return requests.','لا توجد طلبات صرف أو إرجاع.')}</div>${selected?`<article class="b09r-panel"><h2>${esc(selected.requestType==='return'?t('Material return','إرجاع المواد'):t('Material issue','صرف المواد'))}</h2>${quantityGrid(selected)}<p>${esc(label(selected.sourceLocation,selected.sourceLocationId))} → ${esc(label(selected.destinationLocation,selected.destinationLocationId))}</p><p>${esc(t('Lot / serial','الدفعة / الرقم التسلسلي'))}: ${esc(selected.lotId||selected.serialId||'—')}</p>${canonicalForm(selected,'pmi')}${timeline(selected)}</article>`:''}</div></section>`;},
      bind(c,s,api){c.querySelectorAll('[data-role="pmi-select"]').forEach(b=>b.addEventListener('click',()=>{s.selectedId=b.dataset.id;api.paint();}));c.querySelector('[data-role="pmi-request"]')?.addEventListener('click',e=>api.guarded(async()=>{await api.call('shopfloor:material_request_canonical',{request_id:e.currentTarget.dataset.id});s.rows=await loadRows(api);}));const form=c.querySelector('[data-role="pmi-ack"]');form?.addEventListener('submit',e=>{e.preventDefault();api.guarded(async()=>{await api.call('shopfloor:material_acknowledge',{request_id:form.dataset.id,...api.formData(form)});s.rows=await loadRows(api);});});}
    });
  }

  function receiptWorkspace() {
    return S.createWorkspace({pageId:'production_receipt',prefix:'prc',initialState:()=>({rows:[],selectedId:'',loading:true}),async onActivate(s,api){s.rows=await loadRows(api);},render(s){if(s.loading)return `${scopeLine()}${muted('Loading production receipts…','جارِ تحميل إيصالات الإنتاج…')}`;const rows=s.rows.filter(r=>TYPES.receipts.has(r.requestType));const selected=rows.find(r=>r.id===s.selectedId)||rows[0]||null;return `${scopeLine()}${kpis([['Receipts','الإيصالات',num(rows.length,0)],['Pending','معلقة',num(rows.filter(r=>r.status!=='completed').length,0),'warn'],['Completed','مكتملة',num(rows.filter(r=>r.status==='completed').length,0),'ok']])}<section class="b09r-panel"><div class="b09r-grid-2"><div>${rows.map(r=>recordCard(r,selected?.id===r.id,'prc-select')).join('')||muted('No production receipt proposals.','لا توجد مقترحات استلام إنتاج.')}</div>${selected?`<article class="b09r-panel"><h2>${esc(label(selected.product,selected.productId))}</h2><p>${esc(t('Planned output','المخرج المخطط'))}: ${esc(num(selected.productionOrder?.planned_quantity))} · ${esc(t('Accepted','المقبول'))}: ${esc(num(selected.approvedQuantity))}</p><p>${esc(t('Destination','الوجهة'))}: ${esc(label(selected.destinationLocation,selected.destinationLocationId))}</p><p>${esc(t('Quality state','حالة الجودة'))}: ${esc(selected.qualityStatus||t('Quality is verified by the canonical checkpoint workspace','تُتحقق الجودة في مساحة نقاط الفحص الرسمية'))}</p>${canonicalForm(selected,'prc')}${selected.canonicalResultId?`<p data-role="prc-reference">${esc(t('Inventory reference','مرجع المخزون'))}: ${esc(selected.canonicalResultId)}</p>`:''}${timeline(selected)}<button class="b09-button" data-role="prc-trace">${esc(t('Open traceability','فتح التتبع'))}</button></article>`:''}</div><p class="b09r-muted">${esc(t('Quality and Inventory remain authoritative; this workspace creates no stock directly.','تبقى الجودة والمخزون سلطتين رسميتين؛ هذه المساحة لا تنشئ مخزوناً مباشرة.'))}</p></section>`;},bind(c,s,api){c.querySelectorAll('[data-role="prc-select"]').forEach(b=>b.addEventListener('click',()=>{s.selectedId=b.dataset.id;api.paint();}));c.querySelector('[data-role="prc-request"]')?.addEventListener('click',e=>api.guarded(async()=>{await api.call('shopfloor:material_request_canonical',{request_id:e.currentTarget.dataset.id});s.rows=await loadRows(api);}));const form=c.querySelector('[data-role="prc-ack"]');form?.addEventListener('submit',e=>{e.preventDefault();api.guarded(async()=>{await api.call('shopfloor:material_acknowledge',{request_id:form.dataset.id,...api.formData(form)});s.rows=await loadRows(api);});});c.querySelector('[data-role="prc-trace"]')?.addEventListener('click',()=>root.switchPage('lot_serial_traceability'));}});
  }

  const movement=movementWorkspace();const receipt=receiptWorkspace();
  root.Build09ProductionMaterialRequests=requests;root.Build09ProductionIssueReturn=movement;root.Build09ProductionReceipt=receipt;
  S.registerOverride('production_material_requests',requests);S.registerOverride('production_issue_return',movement);S.registerOverride('production_receipt',receipt);
})(window);
