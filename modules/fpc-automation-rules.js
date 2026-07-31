(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Automation Rules (`automation_rules`) — FP-2E.
  //
  // Governed READ projection over the canonical automation authority via
  // /api/v1/automation/{rules,runs}. Automations may invoke registered
  // actions only; this page mutates nothing.
  // ---------------------------------------------------------------------

  const PAGE_ID = 'automation_rules';
  const HOST_ID = 'pageAutomationRules';
  const BODY_ID = 'automationRulesBody';

  const state = {
    loading: false,
    error: null,
    activeTab: 'rules',
    rules: [],
    runs: [],
    runsRuleId: null,
  };

  function K() { return root.OctagonPageKit; }
  function body() { return document.getElementById(BODY_ID); }

  async function apiQuery(path) {
    const res = await fetch(`/api/v1/${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || json.error);
    return json.data || [];
  }

  async function loadData() {
    state.loading = true;
    state.error = null;
    const kit = K();
    const b = body();
    if (b && kit) kit.renderState(b, kit.STATES.LOADING, { title: 'جاري تحميل قواعد الأتمتة...' });

    try {
      state.rules = await apiQuery('automation/rules');
    } catch (err) {
      state.error = err.message || 'فشل تحميل قواعد الأتمتة';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadRuns(ruleId) {
    state.runsRuleId = ruleId;
    state.activeTab = 'runs';
    state.runs = [];
    render();
    try {
      state.runs = await apiQuery(`automation/runs?rule_id=${encodeURIComponent(ruleId)}`);
    } catch (err) {
      state.error = err.message || 'فشل تحميل سجل التنفيذ';
    } finally {
      render();
    }
  }

  function triggerLabel(rule) {
    const cfg = rule.trigger_config || {};
    return rule.trigger_type || cfg.type || '—';
  }

  function renderHeader() {
    const kit = K();
    return kit.renderHeader({
      title: 'قواعد الأتمتة',
      subtitle: 'قواعد المشغلات والشروط والإجراءات المسجلة وسجل التنفيذ — من سلطة الأتمتة المرجعية',
      actionsHtml: '',
    });
  }

  function renderTabs() {
    const kit = K();
    return kit.renderTabStrip({
      tabs: [
        { id: 'rules', label: 'القواعد', badge: state.rules.length },
        { id: 'runs', label: state.runsRuleId ? `سجل التنفيذ (${state.runsRuleId})` : 'سجل التنفيذ', badge: state.runs.length },
      ],
      activeTab: state.activeTab,
      onSelect: 'OctagonAutomationRules.switchTab',
    });
  }

  function renderRulesTab() {
    const kit = K();
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'المعرف', render: row => kit.bidi(row.id) },
        { key: 'name', title: 'القاعدة', render: row => kit.esc(row.label_ar || row.name || row.id) },
        { key: 'trigger', title: 'المشغل', render: row => kit.bidi(triggerLabel(row)) },
        { key: 'action', title: 'الإجراء المسجل', render: row => kit.bidi(row.action_id || row.action || '—') },
        { key: 'enabled', title: 'الحالة', render: row => kit.renderStatusBadge(row.enabled ? 'مفعّلة' : 'معطّلة', row.enabled ? 'active' : 'inactive') },
        { key: 'runs', title: 'التنفيذ', render: row => `<button class="text-emerald-700 underline text-sm" onclick="OctagonAutomationRules.showRuns('${row.id}')">السجل</button>` },
      ],
      rows: state.rules,
      emptyTitle: 'لا توجد قواعد أتمتة',
      emptySubtitle: 'لم يتم تعريف أي قاعدة أتمتة بعد',
    });
  }

  function renderRunsTab() {
    const kit = K();
    if (!state.runsRuleId) {
      return `
        <div class="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          اختر «السجل» بجانب أي قاعدة لعرض تاريخ تنفيذها الفعلي.
        </div>
      `;
    }
    return kit.renderTable({
      columns: [
        { key: 'id', title: 'التنفيذ', render: row => kit.bidi(row.id) },
        { key: 'occurred', title: 'الوقت', render: row => kit.bidi(row.occurred_at || '—') },
        { key: 'result', title: 'النتيجة', render: row => kit.renderStatusBadge(row.result || row.status || '—', (row.result || '') === 'success' ? 'active' : (row.result || '') === 'failed' ? 'blocked' : 'draft') },
        { key: 'detail', title: 'التفصيل', render: row => kit.esc(row.error || row.detail || '—') },
      ],
      rows: state.runs,
      emptyTitle: 'لا يوجد سجل تنفيذ',
      emptySubtitle: 'لم تُنفَّذ هذه القاعدة بعد',
    });
  }

  function render() {
    const kit = K();
    const b = body();
    if (!b || !kit) return;

    if (state.error) {
      kit.renderState(b, kit.STATES.BACKEND_FAILURE, {
        title: 'تعذر تحميل قواعد الأتمتة',
        subtitle: state.error,
        onRetry: 'OctagonAutomationRules.reload()',
      });
      return;
    }

    let tabContent = '';
    if (state.activeTab === 'rules') tabContent = renderRulesTab();
    else if (state.activeTab === 'runs') tabContent = renderRunsTab();

    b.innerHTML = `
      ${renderHeader()}
      ${renderTabs()}
      <div class="mt-4">
        ${tabContent}
      </div>
    `;
  }

  function activate() {
    loadData();
  }

  root.OctagonPageKit.wirePage({
    pageId: PAGE_ID,
    sectionId: HOST_ID,
    navId: 'navAutomationRules',
    activate,
  });

  root.OctagonAutomationRules = {
    reload: loadData,
    showRuns: loadRuns,
    switchTab: function (tabId) {
      state.activeTab = tabId;
      render();
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
