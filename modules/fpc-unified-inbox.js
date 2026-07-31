(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 05 — Unified Inbox & Approval Center (`unified_inbox`).
  //
  // Octagon had two overlapping approval surfaces (`approvals`,
  // `manager_approvals`). This page is the canonical one; both old routes stay
  // as aliases until their callers are migrated (see
  // docs/evidence/final-page-catalog/page-consolidation-register.md §B1).
  //
  // AUTHORITY
  //   query    : the canonical approval engine and notification service via
  //              /api/v1/control-plane/* and the platform bootstrap.
  //   mutation : approval decisions ONLY, through ActionExecutor. This page
  //              never posts, never moves stock, never touches payroll — it
  //              records a decision and lets the owning domain react.
  //
  // BULK RULE
  //   Bulk approve is deliberately absent. Every queue reachable here is
  //   maker-checker or individually-reviewed; §11 forbids bulk approval where
  //   individual review is required, and there is no per-queue policy flag yet
  //   that would let us prove a queue is exempt. Until that flag exists, one
  //   decision = one click. Recorded in DEFERRED_INTEGRATION_AND_HARDENING.md.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'unified_inbox';
  const HOST_ID = 'pageUnifiedInbox';
  const BODY_ID = 'unifiedInboxBody';

  const TABS = [
    { key: 'approvals', labelAr: 'بانتظار اعتمادي', labelEn: 'Awaiting my approval', icon: 'fa-stamp' },
    { key: 'notifications', labelAr: 'الإشعارات', labelEn: 'Notifications', icon: 'fa-bell' },
    { key: 'activities', labelAr: 'الأنشطة المسندة', labelEn: 'Assigned activities', icon: 'fa-calendar-check' },
    { key: 'failures', labelAr: 'أخطاء تحتاج تدخلاً', labelEn: 'Failures needing action', icon: 'fa-triangle-exclamation' },
    { key: 'history', labelAr: 'سجل قراراتي', labelEn: 'My decision history', icon: 'fa-clock-rotate-left' },
  ];

  const state = {
    tab: 'approvals',
    busy: false,
    notice: null,
    data: {
      approvals: { state: 'loading', rows: [] },
      notifications: { state: 'loading', rows: [] },
      activities: { state: 'loading', rows: [] },
      failures: { state: 'loading', rows: [] },
      history: { state: 'loading', rows: [] },
    },
  };

  function K() { return root.OctagonPageKit; }
  function client() { return root.CanonicalClient || null; }
  function host() { return document.getElementById(HOST_ID); }
  function body() { return document.getElementById(BODY_ID); }

  async function loadTab(tab) {
    const kit = K();
    const c = client();
    if (!c) return { state: kit.STATES.NOT_AVAILABLE, rows: [] };

    if (tab === 'approvals') {
      return kit.safeQuery(() => c.query('/control-plane/approvals', { pending_for_me: 1, limit: 200 }));
    }
    if (tab === 'history') {
      return kit.safeQuery(() => c.query('/control-plane/approvals', { decided_by_me: 1, limit: 200 }));
    }
    if (tab === 'notifications') {
      return kit.safeQuery(() => c.query('/control-plane/notifications', { unread: 1, limit: 200 }));
    }
    if (tab === 'activities') {
      // CRM Activities are the canonical "assigned activity" store.
      return kit.safeQuery(() => c.crm.listActivities({ assigned_to_me: 1, state: 'planned', limit: 200 }));
    }
    // failures: outbox / webhook deliveries that need a human
    return kit.safeQuery(() => c.query('/control-plane/outbox', { status: 'failed', limit: 200 }));
  }

  async function refresh() {
    const kit = K();
    state.data[state.tab] = { state: kit.STATES.LOADING, rows: [] };
    render();
    state.data[state.tab] = await loadTab(state.tab);
    render();
  }

  async function decide(approvalId, decision) {
    const kit = K();
    const c = client();
    if (!c || state.busy) return;
    state.busy = true;
    state.notice = null;
    render();
    try {
      // The decision travels through ActionExecutor; approver identity is
      // server-derived and can never be supplied by this page.
      await c.action('approval:decide', { approval_id: approvalId, decision });
      state.notice = {
        tone: 'success',
        ar: decision === 'approved' ? 'تم تسجيل الاعتماد.' : 'تم تسجيل الرفض.',
        en: decision === 'approved' ? 'Approval recorded.' : 'Rejection recorded.',
      };
      await refresh();
    } catch (error) {
      const classified = kit.classifyError(error);
      state.notice = { tone: 'danger', ar: classified.message, en: classified.message };
      render();
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  const COLUMNS = {
    approvals: [
      { key: 'reference', labelAr: 'المرجع', labelEn: 'Reference', render: 'code' },
      { key: 'entity_id', labelAr: 'النوع', labelEn: 'Entity', render: 'badge' },
      { key: 'requested_by', labelAr: 'مقدّم الطلب', labelEn: 'Requested by' },
      { key: 'amount', labelAr: 'المبلغ', labelEn: 'Amount', render: 'money', numeric: true },
      { key: 'status', labelAr: 'الحالة', labelEn: 'Status', render: 'badge' },
      { key: 'created_at', labelAr: 'التاريخ', labelEn: 'Date', render: 'date' },
    ],
    history: [
      { key: 'reference', labelAr: 'المرجع', labelEn: 'Reference', render: 'code' },
      { key: 'entity_id', labelAr: 'النوع', labelEn: 'Entity', render: 'badge' },
      { key: 'status', labelAr: 'قراري', labelEn: 'My decision', render: 'badge' },
      { key: 'decided_at', labelAr: 'تاريخ القرار', labelEn: 'Decided at', render: 'date' },
    ],
    notifications: [
      { key: 'title', labelAr: 'العنوان', labelEn: 'Title' },
      { key: 'category', labelAr: 'الفئة', labelEn: 'Category', render: 'badge' },
      { key: 'created_at', labelAr: 'التاريخ', labelEn: 'Date', render: 'date' },
    ],
    activities: [
      { key: 'subject', labelAr: 'الموضوع', labelEn: 'Subject' },
      { key: 'activity_type', labelAr: 'النوع', labelEn: 'Type', render: 'badge' },
      { key: 'state', labelAr: 'الحالة', labelEn: 'State', render: 'badge' },
      { key: 'due_at', labelAr: 'الاستحقاق', labelEn: 'Due', render: 'date' },
    ],
    failures: [
      { key: 'id', labelAr: 'المعرف', labelEn: 'ID', render: 'code' },
      { key: 'event_type', labelAr: 'الحدث', labelEn: 'Event', render: 'badge' },
      { key: 'attempts', labelAr: 'المحاولات', labelEn: 'Attempts', render: 'number', numeric: true },
      { key: 'last_error', labelAr: 'آخر خطأ', labelEn: 'Last error' },
      { key: 'created_at', labelAr: 'التاريخ', labelEn: 'Date', render: 'date' },
    ],
  };

  function renderBody() {
    const kit = K();
    const result = state.data[state.tab];
    if (result.state === kit.STATES.LOADING) return kit.skeleton(6);
    if (result.state !== kit.STATES.POPULATED && result.state !== kit.STATES.EMPTY) {
      return kit.stateBlock(result.state, result.message);
    }

    const rowActions = state.tab === 'approvals'
      ? [
        { id: 'approve', icon: 'fa-check', labelAr: 'اعتماد', labelEn: 'Approve' },
        { id: 'reject', icon: 'fa-xmark', labelAr: 'رفض', labelEn: 'Reject' },
      ]
      : [];

    return kit.grid(COLUMNS[state.tab], result.rows, {
      total: result.rows.length,
      idKey: 'id',
      rowActions,
    });
  }

  function render() {
    const el = body();
    if (!el) return;
    const kit = K();
    if (!kit) return;

    const pending = state.data.approvals.state === kit.STATES.POPULATED
      ? state.data.approvals.rows.length : null;

    el.innerHTML = `
      ${kit.header({
    titleAr: 'صندوق الوارد ومركز الاعتمادات', titleEn: 'Unified Inbox & Approval Center',
    subtitleAr: 'كل ما ينتظر قرارك أو انتباهك في مكان واحد: الاعتمادات، الإشعارات، الأنشطة المسندة، والأخطاء التي تحتاج تدخلاً.',
    subtitleEn: 'Everything awaiting your decision or attention in one place: approvals, notifications, assigned activities, and failures needing action.',
    icon: 'fa-inbox',
    actions: [{ id: 'refresh', labelAr: 'تحديث', labelEn: 'Refresh', icon: 'fa-rotate' }],
  })}
      ${state.notice ? kit.notice(state.notice.tone, state.notice.ar, state.notice.en) : ''}
      ${kit.kpiRow([{
    id: 'pending-approvals', labelAr: 'بانتظار اعتمادي', labelEn: 'Awaiting my approval',
    value: pending, icon: 'fa-stamp', tone: pending ? 'warn' : 'neutral',
    sourceModule: 'platform_kernel',
    explainAr: 'طلبات الاعتماد التي أنت المعتمد المخوّل لها الآن.',
    explainEn: 'Approval requests for which you are the currently authorised approver.',
  }])}
      ${kit.tabs(TABS, state.tab)}
      ${renderBody()}
      <p class="opk-state-hint" style="margin-top:14px;text-align:start;">
        ${kit.esc(kit.tx(
    'الاعتماد الجماعي غير مفعّل عمداً: كل قائمة هنا تتطلّب مراجعة فردية أو مبدأ الفصل بين المُعِدّ والمعتمِد.',
    'Bulk approval is deliberately disabled: every queue here requires individual review or maker-checker separation.',
  ))}
      </p>
    `;

    kit.bind(el, {
      onAction(id) { if (id === 'refresh') refresh(); },
      onTab(key) { state.tab = key; refresh(); },
      onRowAction(action, id) {
        if (action === 'approve') decide(id, 'approved');
        if (action === 'reject') decide(id, 'rejected');
      },
    });
  }

  function activate() {
    render();
    refresh();
  }

  root.renderUnifiedInbox = activate;
  root.FpcUnifiedInbox = { activate, refresh, state, PAGE_ID, TABS };


  // Route aliases: the retired approval pages resolve here so existing
  // switchPage('approvals') / switchPage('manager_approvals') call sites keep
  // working while they are migrated. Retirement condition is recorded in
  // docs/evidence/final-page-catalog/page-consolidation-register.md (§B1).
  // Mount into the original shell. OctagonPageKit.wirePage owns the whole
  // dance: permission gate, async template hydration, page/nav activation, and
  // nav-group opening. Doing it here rather than per-page is what keeps three
  // pages from drifting into three subtly different activation behaviours.
  OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navUnifiedInbox',
    aliases: ['approvals', 'manager_approvals'],
    activate,
  });
})(window);
