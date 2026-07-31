(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Page 04 — My Work (`my_work`).
  //
  // One personal surface over every kind of execution work assigned to the
  // acting user. Octagon already has board tools (`kanban`, `task_manager`),
  // but both are *board* views of a queue someone else owns. This page answers
  // the different question: "what is MINE, across every module, right now?"
  //
  // AUTHORITY
  //   query    : canonical Work Items only (/api/v1/work-items/*). Project
  //              tasks, quality actions, maintenance jobs and HSE corrective
  //              actions are already Work Items — this page does NOT create a
  //              second task store for them.
  //   mutation : work_item:transition / work_item:complete, both through
  //              ActionExecutor. Nothing else. Approving, posting, releasing
  //              stock and every other governed act stays on its owning page.
  //
  // Scope is server-derived: "assigned to me" is resolved from the session, so
  // this page cannot be pointed at another user's queue.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'my_work';
  const HOST_ID = 'pageMyWork';
  const BODY_ID = 'myWorkBody';

  const VIEWS = [
    { key: 'today', labelAr: 'اليوم', labelEn: 'Today', icon: 'fa-calendar-day' },
    { key: 'overdue', labelAr: 'متأخر', labelEn: 'Overdue', icon: 'fa-triangle-exclamation' },
    { key: 'upcoming', labelAr: 'قادم', labelEn: 'Upcoming', icon: 'fa-forward' },
    { key: 'all', labelAr: 'الكل', labelEn: 'All', icon: 'fa-list' },
    { key: 'completed', labelAr: 'مكتمل', labelEn: 'Completed', icon: 'fa-circle-check' },
  ];

  const state = {
    view: 'today',
    filters: {},
    result: { state: 'loading', rows: [] },
    busy: false,
    notice: null,
  };

  function K() { return root.OctagonPageKit; }
  function client() { return root.CanonicalClient || null; }
  function host() { return document.getElementById(HOST_ID); }
  function body() { return document.getElementById(BODY_ID); }

  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  }

  /**
   * Partition the assigned queue into the five views.
   *
   * Deliberately client-side over an already-scoped result set: these are
   * presentation buckets over rows the server already decided this user may
   * see. No filtering here grants access to anything the query did not return.
   */
  function bucket(rows, view) {
    const now = new Date();
    const closed = new Set(['completed', 'done', 'closed', 'cancelled']);
    const open = rows.filter((r) => !closed.has(String(r.state || '').toLowerCase()));

    if (view === 'completed') {
      return rows.filter((r) => closed.has(String(r.state || '').toLowerCase()));
    }
    if (view === 'all') return open;
    if (view === 'overdue') {
      return open.filter((r) => r.due_date && new Date(r.due_date) < startOfToday());
    }
    if (view === 'today') {
      return open.filter((r) => {
        if (!r.due_date) return false;
        const due = new Date(r.due_date);
        return due >= startOfToday() && due <= endOfToday();
      });
    }
    // upcoming
    return open.filter((r) => r.due_date && new Date(r.due_date) > endOfToday())
      .concat(open.filter((r) => !r.due_date));
  }

  function counts(rows) {
    return VIEWS.reduce((acc, v) => {
      acc[v.key] = bucket(rows, v.key).length;
      return acc;
    }, {});
  }

  async function refresh() {
    const kit = K();
    const c = client();
    if (!c || !c.workItems) {
      state.result = { state: kit.STATES.NOT_AVAILABLE, rows: [] };
      render();
      return;
    }
    state.result = { state: kit.STATES.LOADING, rows: [] };
    render();

    const params = { assigned_to_me: 1, limit: 300 };
    if (state.filters.q) params.q = state.filters.q;
    if (state.filters.priority) params.priority = state.filters.priority;

    state.result = await kit.safeQuery(() => c.workItems.list(params));
    render();
  }

  async function command(successAr, successEn, run) {
    const kit = K();
    if (state.busy) return;
    state.busy = true;
    state.notice = null;
    render();
    try {
      await run();
      state.notice = { tone: 'success', ar: successAr, en: successEn };
      await refresh();
    } catch (error) {
      const classified = kit.classifyError(error);
      state.notice = {
        tone: 'danger',
        ar: classified.message || 'تعذّر تنفيذ الإجراء.',
        en: classified.message || 'The action could not be completed.',
      };
      render();
    } finally {
      state.busy = false;
    }
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function renderBody() {
    const kit = K();
    if (state.result.state === kit.STATES.LOADING) return kit.skeleton(6);
    if (state.result.state !== kit.STATES.POPULATED && state.result.state !== kit.STATES.EMPTY) {
      return kit.stateBlock(state.result.state, state.result.message);
    }

    const rows = bucket(state.result.rows, state.view);

    return kit.grid(
      [
        { key: 'reference', labelAr: 'المرجع', labelEn: 'Reference', render: 'code' },
        { key: 'title', labelAr: 'العنوان', labelEn: 'Title' },
        { key: 'work_type', labelAr: 'النوع', labelEn: 'Type', render: 'badge' },
        { key: 'state', labelAr: 'الحالة', labelEn: 'State', render: 'badge' },
        { key: 'priority', labelAr: 'الأولوية', labelEn: 'Priority', render: 'badge' },
        { key: 'due_date', labelAr: 'الاستحقاق', labelEn: 'Due', render: 'date' },
      ],
      rows,
      {
        total: rows.length,
        idKey: 'id',
        emptyState: kit.STATES.EMPTY,
        rowActions: state.view === 'completed' ? [] : [
          {
            id: 'start', icon: 'fa-play', labelAr: 'بدء', labelEn: 'Start',
            when: (r) => String(r.state || '').toLowerCase() !== 'in_progress',
          },
          { id: 'complete', icon: 'fa-check', labelAr: 'إكمال', labelEn: 'Complete' },
          { id: 'open', icon: 'fa-arrow-up-right-from-square', labelAr: 'فتح', labelEn: 'Open' },
        ],
      },
    );
  }

  function render() {
    const el = body();
    if (!el) return;
    const kit = K();
    if (!kit) return;

    const all = state.result.state === kit.STATES.POPULATED ? state.result.rows : [];
    const tabCounts = counts(all);

    el.innerHTML = `
      ${kit.header({
    titleAr: 'أعمالي', titleEn: 'My Work',
    subtitleAr: 'كل بنود العمل المسندة إليك عبر الوحدات: مهام المشاريع، إجراءات الجودة، أعمال الصيانة، والإجراءات التصحيحية.',
    subtitleEn: 'Every Work Item assigned to you across modules: project tasks, quality actions, maintenance jobs and corrective actions.',
    icon: 'fa-list-check',
    actions: [{ id: 'refresh', labelAr: 'تحديث', labelEn: 'Refresh', icon: 'fa-rotate' }],
  })}
      ${state.notice ? kit.notice(state.notice.tone, state.notice.ar, state.notice.en) : ''}
      ${kit.tabs(VIEWS.map((v) => ({ ...v, count: tabCounts[v.key] })), state.view)}
      ${kit.filterBar([
    {
      id: 'priority', type: 'select', labelAr: 'الأولوية', labelEn: 'Priority',
      options: [
        { value: 'urgent', labelAr: 'عاجل', labelEn: 'Urgent' },
        { value: 'high', labelAr: 'مرتفع', labelEn: 'High' },
        { value: 'normal', labelAr: 'عادي', labelEn: 'Normal' },
        { value: 'low', labelAr: 'منخفض', labelEn: 'Low' },
      ],
    },
  ], state.filters)}
      ${renderBody()}
    `;

    kit.bind(el, {
      onAction(id) { if (id === 'refresh') refresh(); },
      onTab(key) { state.view = key; render(); },
      onFilter(id, value) { state.filters[id] = value; refresh(); },
      onRefresh() { refresh(); },
      onRowAction(action, id) {
        const c = client();
        if (!c || !c.workItems) return;
        if (action === 'open' && typeof root.switchPage === 'function') {
          root.switchPage('task_manager');
          return;
        }
        if (action === 'start') {
          command('تم بدء بند العمل.', 'Work item started.',
            () => c.workItems.transition({ work_item_id: id, target_state: 'in_progress' }));
        }
        if (action === 'complete') {
          command('تم إكمال بند العمل.', 'Work item completed.',
            () => c.workItems.complete({ work_item_id: id }));
        }
      },
    });
  }

  function activate() {
    render();
    refresh();
  }

  root.renderMyWork = activate;
  root.FpcMyWork = { activate, refresh, state, PAGE_ID, VIEWS };

  // Mount into the original shell. OctagonPageKit.wirePage owns the whole
  // dance: permission gate, async template hydration, page/nav activation, and
  // nav-group opening. Doing it here rather than per-page is what keeps three
  // pages from drifting into three subtly different activation behaviours.
  OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navMyWork',
    activate,
  });
})(window);
