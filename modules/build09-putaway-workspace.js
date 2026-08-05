/** BUILD-09R-2 Group H: Putaway Rules, Putaway Task Queue, Replenishment Rules and
 * Replenishment Proposals.
 *
 * Putaway and replenishment share one shape even though they move stock in opposite
 * directions (inbound-to-bin vs bin-to-bin): a governed rule decides eligibility and
 * destination, a request produces a scan-driven wms_warehouse_tasks row, and only Inventory
 * ever posts the canonical stock:move:post that actually moves the stock. That shared task
 * lifecycle (source scan -> destination scan -> request canonical -> acknowledge canonical)
 * is written once here and used by both queue pages instead of twice.
 *
 * Rules pages are deliberately thin: a rule is configuration, not a workflow, so each gets a
 * list plus a governed-lookup create form and nothing else. The two queue pages carry the
 * real operational weight - they are where a task is actually accepted, scanned and closed.
 *
 * Boundaries this UI must not blur: an override onto a restricted location, and a replenishment
 * approval, are both maker-checker verdicts the server enforces (the creator cannot approve
 * their own proposal, and a restricted override needs a second approver) - refusals surface as
 * the kernel's own "denied" panel rather than being predicted or gated client-side.
 */
(function putawayWorkspaces(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, when, badge, kpis, scopeLine, stepper, field, select, lookup, muted } = S;

  const TASK_STEPS = [['ready', 'Ready', 'جاهزة'], ['source_scanned', 'Source scanned', 'مصدر ممسوح'], ['destination_scanned', 'Destination scanned', 'وجهة ممسوحة'], ['awaiting_canonical', 'Awaiting Inventory', 'بانتظار المخزون'], ['completed', 'Completed', 'مكتملة']];
  const TASK_TONE = { ready: '', assigned: 'info', source_scanned: 'info', destination_scanned: 'info', awaiting_canonical: 'warn', completed: 'ok', cancelled: 'muted' };
  const REC_TONE = { suggested: '', accepted: 'info', task_created: 'info', overridden: 'warn', completed: 'ok', exception: 'danger', cancelled: 'muted' };
  const PROPOSAL_TONE = { proposed: '', partial: 'warn', blocked: 'danger', auto_approved: 'info', approved: 'info', task_created: 'info', awaiting_canonical: 'warn', completed: 'ok', cancelled: 'muted', failed: 'danger' };
  const OPEN_REC = ['suggested', 'accepted'];
  const OPEN_TASK = ['ready', 'assigned', 'source_scanned', 'destination_scanned', 'awaiting_canonical'];
  const OPEN_PROPOSAL = ['proposed', 'partial', 'auto_approved', 'approved', 'blocked', 'failed'];
  const stepFor = (status) => (['assigned'].includes(status) ? 'ready' : status);

  const qualityOptions = [['released', 'Released', 'مُفرج عنه'], ['hold', 'On hold', 'محجوز'], ['quarantine', 'Quarantine', 'حجر صحي']];

  // ---------------------------------------------------------------- shared task-scan panel

  /** One task-lifecycle card, reused by the putaway queue and the replenishment proposal
   *  detail - the scan/request/acknowledge shape and the actions it fires are identical for
   *  both, since both write into the same wms_warehouse_tasks table. */
  function taskCard(prefix, task) {
    return `<div class="b09r-group" data-role="${prefix}-task" data-task-id="${esc(task.id)}">
      <div class="b09r-group-head"><strong>${esc(task.productId || task.id.slice(0, 8))}</strong>${badge(task.status, TASK_TONE[task.status] ?? '')}</div>
      ${stepper(TASK_STEPS, stepFor(task.status))}
      <div class="b09r-scope-line">
        <span>${esc(t('Quantity', 'الكمية'))}: ${esc(num(task.quantity))}</span>
        <span>${esc(t('From', 'من'))}: ${esc(task.sourceLocationId || '—')}</span>
        <span>${esc(t('To', 'إلى'))}: ${esc(task.destinationLocationId || '—')}</span>
        <span>${esc(t('Assigned', 'مُسندة إلى'))}: ${esc(task.assignedTo || '—')}</span></div>

      ${['ready', 'assigned'].includes(task.status) ? `<form class="b09r-subform" data-role="${prefix}-scan-source-form" data-task-id="${esc(task.id)}">
        <div class="b09r-grid-2">${field('barcode', 'Source barcode', 'باركود المصدر', { required: true, autofocus: true })}
          <button type="submit" class="b09-button b09-primary">${esc(t('Scan source', 'مسح المصدر'))}</button></div></form>` : ''}

      ${task.status === 'source_scanned' ? `<form class="b09r-subform" data-role="${prefix}-scan-dest-form" data-task-id="${esc(task.id)}">
        <div class="b09r-grid-2">${field('barcode', 'Destination barcode', 'باركود الوجهة', { required: true, autofocus: true })}
          <button type="submit" class="b09-button b09-primary">${esc(t('Scan destination', 'مسح الوجهة'))}</button></div></form>` : ''}

      ${task.status === 'destination_scanned' ? `<button type="button" class="b09-button b09-primary" data-role="${prefix}-request-canonical" data-task-id="${esc(task.id)}">${esc(t('Request canonical movement', 'طلب الحركة الرسمية'))}</button>
        <p class="b09r-muted">${esc(t('This only requests the move — Inventory still posts it.', 'هذا طلب فقط — يبقى المخزون هو من يرحّل الحركة.'))}</p>` : ''}

      ${task.status === 'awaiting_canonical' ? `<form class="b09r-subform" data-role="${prefix}-ack-form" data-task-id="${esc(task.id)}">
        <div class="b09r-panel-head"><h2>${esc(t('Acknowledge canonical movement', 'الإقرار بالحركة الرسمية'))}</h2></div>
        <p>${esc(t('The server re-verifies the posted move before accepting it.', 'يعيد الخادم التحقق من الحركة المرحّلة قبل قبولها.'))}</p>
        ${field('canonical_result_id', 'Canonical stock move id', 'معرّف الحركة المخزنية الرسمية', { required: true })}
        <button type="submit" class="b09-button b09-primary">${esc(t('Acknowledge', 'إقرار'))}</button></form>` : ''}

      ${task.status === 'completed' ? `<p class="b09r-success" data-role="${prefix}-task-completed">✓ ${esc(t('Completed', 'مكتملة'))}: ${esc(task.canonicalResultId || '—')}</p>` : ''}
    </div>`;
  }

  /** Binds the four task actions inside `container` for every task card of `prefix`, calling
   *  `reload` after each mutation settles. Shared verbatim by both queue pages. */
  function bindTaskCard(container, api, prefix, reload) {
    container.querySelectorAll(`[data-role="${prefix}-scan-source-form"]`).forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      api.guarded(async () => { await api.call('wms:task_scan_source', { task_id: form.dataset.taskId, barcode: api.formData(form).barcode }); await reload(); });
    }));
    container.querySelectorAll(`[data-role="${prefix}-scan-dest-form"]`).forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      api.guarded(async () => { await api.call('wms:task_scan_destination', { task_id: form.dataset.taskId, barcode: api.formData(form).barcode }); await reload(); });
    }));
    container.querySelectorAll(`[data-role="${prefix}-request-canonical"]`).forEach((button) => button.addEventListener('click', () => api.guarded(async () => {
      await api.call('wms:task_request_canonical', { task_id: button.dataset.taskId }); await reload();
    })));
    container.querySelectorAll(`[data-role="${prefix}-ack-form"]`).forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      api.guarded(async () => { await api.call('wms:task_acknowledge_canonical', { task_id: form.dataset.taskId, canonical_result_id: api.formData(form).canonical_result_id }); await reload(); });
    }));
  }

  // ---------------------------------------------------------------- Putaway Rules

  const putawayRules = S.createWorkspace({
    pageId: 'putaway_rules',
    prefix: 'pwr',
    initialState: () => ({ rules: [], loading: true }),

    async onActivate(state, api) {
      const rules = await api.query('putaway-rules');
      state.rules = Array.isArray(rules) ? rules : [];
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading putaway rules…', 'جارِ تحميل قواعد الإيداع…'))}</p></div>`;
      const active = state.rules.filter((rule) => rule.active).length;
      return `${scopeLine()}${kpis([
          ['Rules', 'القواعد', num(state.rules.length, 0)],
          ['Active', 'نشطة', num(active, 0), active ? 'ok' : ''],
        ])}
        <div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Putaway rules', 'قواعد الإيداع'))}</h2></div>
          ${state.rules.length ? `<div class="b09r-pool-list">${state.rules.map((rule) => `<div class="b09r-queue-row b09r-wave-row" data-role="pwr-row">
              <span class="b09r-pool-main"><strong>${esc(rule.name)}</strong><small>${esc(t('strategy', 'الاستراتيجية'))} ${esc(rule.strategy)} · ${esc(t('priority', 'الأولوية'))} ${esc(num(rule.priority, 0))}${rule.productId ? ` · ${esc(rule.productId)}` : ''}${rule.destinationZoneId ? ` · ${esc(t('zone', 'منطقة'))} ${esc(rule.destinationZoneId)}` : ''}${rule.destinationLocationId ? ` · ${esc(rule.destinationLocationId)}` : ''}</small></span>
              ${badge(rule.active ? t('active', 'نشطة') : t('inactive', 'غير نشطة'), rule.active ? 'ok' : 'muted')}</div>`).join('')}</div>`
            : muted('No putaway rules are configured for this warehouse.', 'لا توجد قواعد إيداع مهيأة لهذا المستودع.')}</div>
        ${createRuleFormPanel()}`;
    },

    bind(container, state, api) {
      const form = container.querySelector('[data-role="pwr-create-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          await api.call('wms:putaway_rule_create', {
            name: data.name, strategy: data.strategy, priority: Number(data.priority || 100),
            allow_split: data.allow_split === '1', product_id: data.product_id || undefined,
            destination_zone_id: data.destination_zone_id || undefined, destination_location_id: data.destination_location_id || undefined,
            lot_pattern: data.lot_pattern || undefined, requires_quality_status: data.requires_quality_status || undefined,
          });
          const rules = await api.query('putaway-rules');
          state.rules = Array.isArray(rules) ? rules : [];
          form.reset();
        });
      });
    },
  });

  function createRuleFormPanel() {
    return `<form class="b09r-panel" data-role="pwr-create-form">
      <div class="b09r-panel-head"><h2>${esc(t('New putaway rule', 'قاعدة إيداع جديدة'))}</h2></div>
      <p>${esc(t('Leave product empty for a fallback rule that matches any receipt. At least one destination is required.', 'اترك المنتج فارغاً لقاعدة احتياطية تطابق أي استلام. يلزم تحديد وجهة واحدة على الأقل.'))}</p>
      ${field('name', 'Rule name', 'اسم القاعدة', { required: true })}
      ${lookup('products', 'product_id', 'Product (optional)', 'المنتج (اختياري)')}
      <div class="b09r-grid-2">${lookup('zones', 'destination_zone_id', 'Destination zone', 'منطقة الوجهة')}${lookup('locations', 'destination_location_id', 'Destination location', 'موقع الوجهة')}</div>
      <div class="b09r-grid-2">${select('strategy', 'Strategy', 'الاستراتيجية', [['priority', 'Priority order', 'ترتيب الأولوية'], ['affinity', 'Product affinity', 'تقارب المنتج']], { value: 'priority' })}${field('priority', 'Priority', 'الأولوية', { type: 'number', min: 1, value: '100' })}</div>
      <div class="b09r-grid-2">${select('allow_split', 'Allow split across locations', 'السماح بالتوزيع على أكثر من موقع', [['1', 'Yes', 'نعم'], ['0', 'No', 'لا']], { value: '1' })}${select('requires_quality_status', 'Requires quality status', 'يتطلب حالة جودة', [['', 'Any', 'أي حالة'], ...qualityOptions])}</div>
      ${field('lot_pattern', 'Lot pattern (regex, optional)', 'نمط الدفعة (تعبير نمطي، اختياري)')}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Create rule', 'إنشاء القاعدة'))}</button>
    </form>`;
  }

  // ---------------------------------------------------------------- Putaway Task Queue

  const putawayQueue = S.createWorkspace({
    pageId: 'putaway_task_queue',
    prefix: 'pwq',
    initialState: () => ({ recommendations: [], tasks: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      const [recommendations, tasks] = await Promise.all([api.query('putaway-queue'), api.query('tasks', { task_type: 'putaway' })]);
      state.recommendations = Array.isArray(recommendations) ? recommendations : [];
      state.tasks = Array.isArray(tasks) ? tasks : [];
      if (state.selectedId && !state.recommendations.some((row) => row.id === state.selectedId)) state.selectedId = null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading the putaway queue…', 'جارِ تحميل طابور الإيداع…'))}</p></div>`;
      const openRec = state.recommendations.filter((row) => OPEN_REC.includes(row.status));
      const openTasks = state.tasks.filter((row) => OPEN_TASK.includes(row.status));
      const completed = state.tasks.filter((row) => row.status === 'completed').length;
      const selected = state.recommendations.find((row) => row.id === state.selectedId);
      return `${scopeLine()}${kpis([
          ['Pending recommendations', 'توصيات معلّقة', num(openRec.length, 0), openRec.length ? 'warn' : 'ok'],
          ['Open tasks', 'مهام مفتوحة', num(openTasks.length, 0), openTasks.length ? 'info' : ''],
          ['Completed', 'مكتملة', num(completed, 0), 'ok'],
          ['Exceptions', 'استثناءات', num(state.recommendations.filter((row) => row.status === 'exception').length, 0), state.recommendations.some((row) => row.status === 'exception') ? 'danger' : 'ok'],
        ])}
        ${recommendationListPanel(state)}
        ${selected ? recommendationDetailPanel(selected, state) : ''}
        ${requestFormPanel()}
        ${openTaskListPanel(state)}`;
    },

    bind(container, state, api) {
      const reload = async () => {
        const [recommendations, tasks] = await Promise.all([api.query('putaway-queue'), api.query('tasks', { task_type: 'putaway' })]);
        state.recommendations = Array.isArray(recommendations) ? recommendations : [];
        state.tasks = Array.isArray(tasks) ? tasks : [];
      };

      container.querySelectorAll('[data-role="pwq-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.recommendationId === state.selectedId ? null : button.dataset.recommendationId;
        api.paint();
      }));

      const requestForm = container.querySelector('[data-role="pwq-request-form"]');
      if (requestForm) requestForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(requestForm);
          if (!data.product_id) throw new Error(t('Select a product from the search results.', 'اختر منتجاً من نتائج البحث.'));
          if (!data.source_location_id) throw new Error(t('Select a source location from the search results.', 'اختر موقع مصدر من نتائج البحث.'));
          const recommendation = await api.call('wms:putaway_recommend', {
            product_id: data.product_id, source_location_id: data.source_location_id,
            quantity: Number(data.quantity), quality_status: data.quality_status || undefined,
            allow_partial: data.allow_partial === '1',
          });
          await reload();
          state.selectedId = recommendation.id;
          requestForm.reset();
        });
      });

      const acceptButton = container.querySelector('[data-role="pwq-accept"]');
      if (acceptButton) acceptButton.addEventListener('click', () => api.guarded(async () => {
        await api.call('wms:putaway_accept', { recommendation_id: acceptButton.dataset.recommendationId });
        await reload();
      }));

      const overrideForm = container.querySelector('[data-role="pwq-override-form"]');
      if (overrideForm) overrideForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(overrideForm);
          if (!data.destination_location_id) throw new Error(t('Select a destination from the search results.', 'اختر وجهة من نتائج البحث.'));
          await api.call('wms:putaway_override', {
            recommendation_id: overrideForm.dataset.recommendationId,
            destination_location_id: data.destination_location_id, reason: data.reason,
            approved_by: data.approved_by || undefined,
          });
          await reload();
        });
      });

      bindTaskCard(container, api, 'pwq', reload);
    },
  });

  function recommendationListPanel(state) {
    if (!state.recommendations.length) return `<div class="b09r-panel">${muted('The putaway queue is empty — nothing is waiting to be put away.', 'طابور الإيداع فارغ — لا يوجد شيء بانتظار الإيداع.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Recommendations', 'التوصيات'))}</h2></div>
      <div class="b09r-pool-list" data-role="pwq-list">${state.recommendations.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="pwq-select" data-recommendation-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.productId)}</strong><small>${esc(t('from', 'من'))} ${esc(row.sourceLocationId)} · ${esc(num(row.quantity))}</small></span>
        ${badge(row.status, REC_TONE[row.status] ?? '')}</button>`).join('')}</div></div>`;
  }

  function recommendationDetailPanel(row, state) {
    const relatedTasks = state.tasks.filter((task) => task.sourceRecordType === 'putaway_recommendation' && task.sourceRecordId === row.id);
    return `<div class="b09r-panel" data-role="pwq-detail">
      <div class="b09r-panel-head"><h2>${esc(row.productId)}</h2>${badge(row.status, REC_TONE[row.status] ?? '')}</div>
      <div class="b09r-scope-line">
        <span>${esc(t('Source', 'المصدر'))}: ${esc(row.sourceLocationId)}</span>
        <span>${esc(t('Quantity', 'الكمية'))}: ${esc(num(row.quantity))}</span>
        <span>${esc(t('Quality', 'الجودة'))}: ${esc(row.qualityStatus)}</span>
        <span>${esc(t('Requested by', 'طلبها'))}: ${esc(row.requestedBy || '—')}</span></div>
      ${row.lines?.length ? `<div class="b09r-scan-list">${row.lines.map((line) => `<div class="b09r-scan-row"><span>${esc(t('Destination', 'الوجهة'))}: ${esc(line.destinationLocationId)}</span><span>${esc(num(line.quantity))}</span>${line.restrictionOverride ? badge(t('restricted', 'مقيّد'), 'warn') : ''}</div>`).join('')}</div>` : ''}
      ${row.exceptionReason ? `<p class="b09r-error">${esc(t('Exception', 'استثناء'))}: ${esc(row.exceptionReason)}</p>` : ''}

      ${OPEN_REC.includes(row.status) ? `<div class="b09r-actions-row"><button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="pwq-accept" data-recommendation-id="${esc(row.id)}">${esc(t('Accept recommendation', 'قبول التوصية'))}</button></div>
        <form class="b09r-subform" data-role="pwq-override-form" data-recommendation-id="${esc(row.id)}">
          <div class="b09r-panel-head"><h2>${esc(t('Override destination', 'تجاوز الوجهة'))}</h2></div>
          <p>${esc(t('A restricted destination needs a second approver — the server refuses a self-approved override.', 'الوجهة المقيّدة تحتاج معتمداً ثانياً — يرفض الخادم التجاوز المعتمد ذاتياً.'))}</p>
          ${lookup('locations', 'destination_location_id', 'Override destination', 'وجهة التجاوز')}
          ${field('reason', 'Reason', 'السبب', { required: true })}
          ${field('approved_by', 'Approved by (if restricted)', 'اعتمدها (إن كانت مقيّدة)')}
          <button type="submit" class="b09-button b09r-btn-xl">${esc(t('Override', 'تجاوز'))}</button></form>` : ''}

      ${relatedTasks.length ? `<div class="b09r-panel-head"><h2>${esc(t('Tasks', 'المهام'))}</h2></div>${relatedTasks.map((task) => taskCard('pwq', task)).join('')}` : ''}
    </div>`;
  }

  function requestFormPanel() {
    return `<form class="b09r-panel" data-role="pwq-request-form">
      <div class="b09r-panel-head"><h2>${esc(t('Request a putaway recommendation', 'طلب توصية إيداع'))}</h2></div>
      <p>${esc(t('Requesting is refused when no governed rule matches or no destination has capacity — that is a server verdict, not a client guess.', 'يُرفض الطلب عند عدم مطابقة أي قاعدة أو عدم توفر سعة في أي وجهة — وهذا حكم من الخادم لا تخمين من العميل.'))}</p>
      ${lookup('products', 'product_id', 'Product', 'المنتج')}
      ${lookup('locations', 'source_location_id', 'Source location', 'الموقع المصدر')}
      <div class="b09r-grid-2">${field('quantity', 'Quantity', 'الكمية', { type: 'number', step: 'any', min: 0, required: true })}${select('quality_status', 'Quality status', 'حالة الجودة', [['released', 'Released', 'مُفرج عنه'], ...qualityOptions.slice(1)], { value: 'released' })}</div>
      ${select('allow_partial', 'Allow partial allocation', 'السماح بتوزيع جزئي', [['0', 'No', 'لا'], ['1', 'Yes', 'نعم']], { value: '0' })}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Request putaway', 'طلب الإيداع'))}</button>
    </form>`;
  }

  function openTaskListPanel(state) {
    const orphanTasks = state.tasks.filter((task) => OPEN_TASK.includes(task.status) && task.sourceRecordId !== state.selectedId);
    if (!orphanTasks.length) return '';
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('All open putaway tasks', 'كل مهام الإيداع المفتوحة'))}</h2></div>
      ${orphanTasks.map((task) => taskCard('pwq', task)).join('')}</div>`;
  }

  // ---------------------------------------------------------------- Replenishment Rules

  const replenishmentRules = S.createWorkspace({
    pageId: 'replenishment_rules',
    prefix: 'rpr',
    initialState: () => ({ rules: [], loading: true }),

    async onActivate(state, api) {
      const rules = await api.query('replenishment-rules');
      state.rules = Array.isArray(rules) ? rules : [];
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading replenishment rules…', 'جارِ تحميل قواعد إعادة التعبئة…'))}</p></div>`;
      const active = state.rules.filter((rule) => rule.active).length;
      return `${scopeLine()}${kpis([
          ['Rules', 'القواعد', num(state.rules.length, 0)],
          ['Active', 'نشطة', num(active, 0), active ? 'ok' : ''],
          ['Auto-approving', 'اعتماد تلقائي', num(state.rules.filter((rule) => rule.autoApprovalLimit > 0).length, 0)],
        ])}
        <div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Replenishment rules', 'قواعد إعادة التعبئة'))}</h2></div>
          ${state.rules.length ? `<div class="b09r-pool-list">${state.rules.map((rule) => `<div class="b09r-queue-row b09r-wave-row" data-role="rpr-row">
              <span class="b09r-pool-main"><strong>${esc(rule.productId || rule.categoryId || rule.id.slice(0, 8))}</strong><small>${esc(rule.sourceLocationId)} → ${esc(rule.destinationLocationId)} · ${esc(t('reorder', 'إعادة الطلب'))} ${esc(num(rule.reorderPoint))} · ${esc(t('target', 'الهدف'))} ${esc(num(rule.targetQuantity))}</small></span>
              ${badge(rule.active ? t('active', 'نشطة') : t('inactive', 'غير نشطة'), rule.active ? 'ok' : 'muted')}</div>`).join('')}</div>`
            : muted('No replenishment rules exist for this warehouse.', 'لا توجد قواعد إعادة تعبئة لهذا المستودع.')}</div>
        ${createReplenishmentRuleFormPanel()}`;
    },

    bind(container, state, api) {
      const form = container.querySelector('[data-role="rpr-create-form"]');
      if (form) form.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(form);
          if (!data.product_id) throw new Error(t('Select a product from the search results.', 'اختر منتجاً من نتائج البحث.'));
          if (!data.source_location_id || !data.destination_location_id) throw new Error(t('Select both a source and destination location.', 'اختر موقع مصدر وموقع وجهة.'));
          await api.call('wms:replenishment_rule_create', {
            product_id: data.product_id, source_location_id: data.source_location_id, destination_location_id: data.destination_location_id,
            minimum_quantity: Number(data.minimum_quantity || 0), maximum_quantity: Number(data.maximum_quantity),
            reorder_point: Number(data.reorder_point || data.minimum_quantity || 0), target_quantity: Number(data.target_quantity || data.maximum_quantity),
            safety_quantity: Number(data.safety_quantity || 0), priority: Number(data.priority || 100),
            schedule: data.schedule, auto_approval_limit: Number(data.auto_approval_limit || 0),
          });
          const rules = await api.query('replenishment-rules');
          state.rules = Array.isArray(rules) ? rules : [];
          form.reset();
        });
      });
    },
  });

  function createReplenishmentRuleFormPanel() {
    return `<form class="b09r-panel" data-role="rpr-create-form">
      <div class="b09r-panel-head"><h2>${esc(t('New replenishment rule', 'قاعدة إعادة تعبئة جديدة'))}</h2></div>
      <p>${esc(t('Source and destination must be different locations in this warehouse.', 'يجب أن يكون المصدر والوجهة موقعين مختلفين في هذا المستودع.'))}</p>
      ${lookup('products', 'product_id', 'Product', 'المنتج')}
      <div class="b09r-grid-2">${lookup('locations', 'source_location_id', 'Source location', 'الموقع المصدر')}${lookup('locations', 'destination_location_id', 'Destination location', 'موقع الوجهة')}</div>
      <div class="b09r-grid-2">${field('minimum_quantity', 'Minimum', 'الحد الأدنى', { type: 'number', step: 'any', min: 0, value: '0' })}${field('reorder_point', 'Reorder point', 'نقطة إعادة الطلب', { type: 'number', step: 'any', min: 0 })}</div>
      <div class="b09r-grid-2">${field('target_quantity', 'Target', 'الهدف', { type: 'number', step: 'any', min: 0, required: true })}${field('maximum_quantity', 'Maximum', 'الحد الأقصى', { type: 'number', step: 'any', min: 0, required: true })}</div>
      <div class="b09r-grid-2">${field('safety_quantity', 'Safety stock', 'مخزون الأمان', { type: 'number', step: 'any', min: 0, value: '0' })}${field('priority', 'Priority', 'الأولوية', { type: 'number', min: 1, value: '100' })}</div>
      <div class="b09r-grid-2">${select('schedule', 'Schedule', 'الجدولة', [['demand', 'On demand', 'عند الطلب'], ['periodic', 'Periodic', 'دوري'], ['manual', 'Manual', 'يدوي']], { value: 'demand' })}${field('auto_approval_limit', 'Auto-approval limit (0 = manual only)', 'حد الاعتماد التلقائي (0 = يدوي فقط)', { type: 'number', step: 'any', min: 0, value: '0' })}</div>
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Create rule', 'إنشاء القاعدة'))}</button>
    </form>`;
  }

  // ---------------------------------------------------------------- Replenishment Proposals

  const replenishmentProposals = S.createWorkspace({
    pageId: 'replenishment_proposals',
    prefix: 'rpp',
    initialState: () => ({ proposals: [], rules: [], tasks: [], selectedId: null, loading: true }),

    async onActivate(state, api) {
      const [proposals, rules, tasks] = await Promise.all([api.query('replenishment-proposals'), api.query('replenishment-rules'), api.query('tasks', { task_type: 'replenishment' })]);
      state.proposals = Array.isArray(proposals) ? proposals : [];
      state.rules = Array.isArray(rules) ? rules : [];
      state.tasks = Array.isArray(tasks) ? tasks : [];
      if (state.selectedId && !state.proposals.some((row) => row.id === state.selectedId)) state.selectedId = null;
    },

    render(state) {
      if (state.loading) return `${scopeLine()}<div class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading replenishment proposals…', 'جارِ تحميل مقترحات إعادة التعبئة…'))}</p></div>`;
      const open = state.proposals.filter((row) => OPEN_PROPOSAL.includes(row.status));
      const blocked = state.proposals.filter((row) => row.status === 'blocked').length;
      const selected = state.proposals.find((row) => row.id === state.selectedId);
      return `${scopeLine()}${kpis([
          ['Open', 'مفتوحة', num(open.length, 0), open.length ? 'info' : 'ok'],
          ['Blocked', 'محظورة', num(blocked, 0), blocked ? 'danger' : 'ok'],
          ['Completed', 'مكتملة', num(state.proposals.filter((row) => row.status === 'completed').length, 0), 'ok'],
        ])}
        ${calculateFormPanel(state)}
        ${proposalListPanel(state)}
        ${selected ? proposalDetailPanel(selected, state) : ''}`;
    },

    bind(container, state, api) {
      const reload = async () => {
        const [proposals, tasks] = await Promise.all([api.query('replenishment-proposals'), api.query('tasks', { task_type: 'replenishment' })]);
        state.proposals = Array.isArray(proposals) ? proposals : [];
        state.tasks = Array.isArray(tasks) ? tasks : [];
      };

      const calcForm = container.querySelector('[data-role="rpp-calculate-form"]');
      if (calcForm) calcForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          const data = api.formData(calcForm);
          await api.call('wms:replenishment_calculate', { rule_id: data.rule_id || undefined });
          await reload();
        });
      });

      container.querySelectorAll('[data-role="rpp-select"]').forEach((button) => button.addEventListener('click', () => {
        state.selectedId = button.dataset.proposalId === state.selectedId ? null : button.dataset.proposalId;
        api.paint();
      }));

      [['rpp-approve', 'wms:replenishment_approve', 'proposal_id'], ['rpp-retry', 'wms:replenishment_retry', 'proposal_id']].forEach(([role, actionId, key]) => {
        const button = container.querySelector(`[data-role="${role}"]`);
        if (button) button.addEventListener('click', () => api.guarded(async () => { await api.call(actionId, { [key]: button.dataset.proposalId }); await reload(); }));
      });

      const cancelForm = container.querySelector('[data-role="rpp-cancel-form"]');
      if (cancelForm) cancelForm.addEventListener('submit', (event) => {
        event.preventDefault();
        api.guarded(async () => {
          await api.call('wms:replenishment_cancel', { proposal_id: cancelForm.dataset.proposalId, reason: api.formData(cancelForm).reason });
          await reload();
        });
      });

      bindTaskCard(container, api, 'rpp', reload);
    },
  });

  function calculateFormPanel(state) {
    const ruleOptions = [['', t('All active rules', 'كل القواعد النشطة'), t('All active rules', 'كل القواعد النشطة')], ...state.rules.filter((rule) => rule.active).map((rule) => [rule.id, `${rule.productId || rule.id.slice(0, 8)} (${rule.sourceLocationId} → ${rule.destinationLocationId})`, `${rule.productId || rule.id.slice(0, 8)} (${rule.sourceLocationId} → ${rule.destinationLocationId})`])];
    return `<form class="b09r-panel" data-role="rpp-calculate-form">
      <div class="b09r-panel-head"><h2>${esc(t('Calculate replenishment', 'حساب إعادة التعبئة'))}</h2></div>
      <p>${esc(t('Evaluates every active rule against current on-hand and demand, and proposes a movable quantity for each shortfall.', 'يقيّم كل قاعدة نشطة مقابل المخزون الحالي والطلب، ويقترح كمية قابلة للنقل لكل نقص.'))}</p>
      ${select('rule_id', 'Rule', 'القاعدة', ruleOptions)}
      <button type="submit" class="b09-button b09-primary b09r-btn-xl">${esc(t('Calculate now', 'احسب الآن'))}</button>
    </form>`;
  }

  function proposalListPanel(state) {
    if (!state.proposals.length) return `<div class="b09r-panel">${muted('No replenishment proposals are pending review.', 'لا توجد مقترحات تعبئة قيد المراجعة.')}</div>`;
    return `<div class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Proposals', 'المقترحات'))}</h2></div>
      <div class="b09r-pool-list" data-role="rpp-list">${state.proposals.map((row) => `<button type="button" class="b09r-queue-row b09r-wave-row${row.id === state.selectedId ? ' b09r-pool-selected' : ''}" data-role="rpp-select" data-proposal-id="${esc(row.id)}">
        <span class="b09r-pool-main"><strong>${esc(row.productId)}</strong><small>${esc(t('proposed', 'المقترح'))} ${esc(num(row.proposedQuantity))} ${esc(t('of', 'من'))} ${esc(num(row.requestedQuantity))}</small></span>
        ${badge(row.status, PROPOSAL_TONE[row.status] ?? '')}</button>`).join('')}</div></div>`;
  }

  function proposalDetailPanel(row, state) {
    const task = state.tasks.find((candidate) => candidate.sourceRecordType === 'replenishment_proposal' && candidate.sourceRecordId === row.id);
    return `<div class="b09r-panel" data-role="rpp-detail">
      <div class="b09r-panel-head"><h2>${esc(row.productId)}</h2>${badge(row.status, PROPOSAL_TONE[row.status] ?? '')}</div>
      ${kpis([
        ['Destination on-hand', 'رصيد الوجهة', num(row.destinationOnHand)],
        ['Requested', 'المطلوب', num(row.requestedQuantity)],
        ['Available', 'المتاح', num(row.availableQuantity)],
        ['Proposed', 'المقترح', num(row.proposedQuantity), 'info'],
        ['Shortage', 'النقص', num(row.shortageQuantity), row.shortageQuantity > 0 ? 'warn' : 'ok'],
      ])}
      <div class="b09r-scope-line">
        <span>${esc(t('Source', 'المصدر'))}: ${esc(row.sourceLocationId)}</span>
        <span>${esc(t('Destination', 'الوجهة'))}: ${esc(row.destinationLocationId)}</span>
        <span>${esc(t('Created by', 'أنشأها'))}: ${esc(row.createdBy || '—')}</span>
        <span>${esc(t('Approved by', 'اعتمدها'))}: ${esc(row.approvedBy || '—')}</span></div>
      ${row.blockReason ? `<p class="b09r-error">${esc(t('Blocked', 'محظورة'))}: ${esc(row.blockReason)}</p>` : ''}

      ${['proposed', 'partial', 'auto_approved'].includes(row.status) ? `<p>${esc(t('Approval is a second person: whoever created this proposal cannot approve it (auto-approved proposals are exempt).', 'الاعتماد من شخص ثانٍ: من أنشأ هذا المقترح لا يمكنه اعتماده (المقترحات المعتمدة تلقائياً مستثناة).'))}</p>` : ''}
      <div class="b09r-actions-row">
        ${['proposed', 'partial', 'auto_approved', 'failed'].includes(row.status) ? `<button type="button" class="b09-button b09-primary b09r-btn-xl" data-role="rpp-approve" data-proposal-id="${esc(row.id)}">${esc(t('Approve', 'اعتماد'))}</button>` : ''}
        ${['blocked', 'failed', 'partial'].includes(row.status) ? `<button type="button" class="b09-button b09r-btn-xl" data-role="rpp-retry" data-proposal-id="${esc(row.id)}">${esc(t('Retry availability', 'إعادة محاولة التوفر'))}</button>` : ''}
      </div>
      ${!['awaiting_canonical', 'completed', 'cancelled'].includes(row.status) ? `<form class="b09r-subform" data-role="rpp-cancel-form" data-proposal-id="${esc(row.id)}">
        <div class="b09r-grid-2">${field('reason', 'Cancellation reason', 'سبب الإلغاء', { required: true })}<button type="submit" class="b09-button">${esc(t('Cancel proposal', 'إلغاء المقترح'))}</button></div></form>` : ''}

      ${task ? `<div class="b09r-panel-head"><h2>${esc(t('Task', 'المهمة'))}</h2></div>${taskCard('rpp', task)}` : ''}
    </div>`;
  }

  root.Build09PutawayRules = putawayRules;
  root.Build09PutawayQueue = putawayQueue;
  root.Build09ReplenishmentRules = replenishmentRules;
  root.Build09ReplenishmentProposals = replenishmentProposals;
  S.registerOverride('putaway_rules', putawayRules);
  S.registerOverride('putaway_task_queue', putawayQueue);
  S.registerOverride('replenishment_rules', replenishmentRules);
  S.registerOverride('replenishment_proposals', replenishmentProposals);
})(window);
