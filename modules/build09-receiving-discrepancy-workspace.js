/** BUILD-09R-2: Receiving Discrepancies is an exception desk, never a stock writer. */
(function receivingDiscrepancies(root) {
  'use strict';
  const S = root.OctagonBuild09R;
  const { escapeHtml: esc, t, num, badge, kpis, scopeLine, select, textarea, muted } = S;
  const label = (row, camel, snake) => row[camel] ?? row[snake] ?? '';
  const tone = { open: 'warn', approved: 'ok', rejected: 'danger' };
  const load = async (state, api) => {
    const rows = await api.query('receiving-discrepancies', state.status ? { status: state.status } : {});
    state.rows = Array.isArray(rows) ? rows : [];
    state.selected = state.rows.find((row) => label(row, 'id', 'id') === state.selectedId) || state.rows[0] || null;
    state.selectedId = state.selected?.id || '';
  };
  function detail(row) {
    if (!row) return `<section class="b09r-panel"><h2>${esc(t('Select an exception', 'اختر استثناءً'))}</h2>${muted('There are no discrepancies in this scoped queue.', 'لا توجد فروقات في هذا الطابور ضمن النطاق.')}</section>`;
    const status = label(row, 'status', 'status'); const expected = label(row, 'expectedValue', 'expected_value'); const actual = label(row, 'actualValue', 'actual_value');
    return `<section class="b09r-panel" data-role="rd-detail"><div class="b09r-panel-head"><h2>${esc(t('Exception review', 'مراجعة الاستثناء'))}</h2>${badge(status, tone[status] || '')}</div><div class="b09r-grid-2"><p><strong>${esc(t('Type', 'النوع'))}</strong><br>${esc(label(row, 'type', 'discrepancy_type'))}</p><p><strong>${esc(t('Receiving session', 'جلسة الاستلام'))}</strong><br>${esc(label(row, 'sessionId', 'session_id'))}</p><p><strong>${esc(t('Expected', 'المتوقع'))}</strong><br>${esc(expected || '—')}</p><p><strong>${esc(t('Actual', 'الفعلي'))}</strong><br>${esc(actual || '—')}</p><p><strong>${esc(t('Reported by', 'أبلغ عنه'))}</strong><br>${esc(label(row, 'requestedBy', 'requested_by') || '—')}</p><p><strong>${esc(t('Reason', 'السبب'))}</strong><br>${esc(label(row, 'reason', 'reason') || '—')}</p></div>${status === 'open' ? decisionForm(row) : `<p class="b09r-muted">${esc(t('This decision is immutable in this workspace. Review the audit record above.', 'هذا القرار ثابت في مساحة العمل هذه. راجع سجل التدقيق أعلاه.'))}</p>`}</section>`;
  }
  function decisionForm(row) { return `<form data-role="rd-decision-form"><p>${esc(t('A reporter cannot approve their own discrepancy. The server makes the final scope and maker-checker decision.', 'لا يمكن للمبلّغ اعتماد فرقِه. الخادم هو من يحسم النطاق وقرار فصل المهام النهائي.'))}</p><div class="b09r-grid-2">${select('decision', 'Decision', 'القرار', [['approved', 'Approve receipt line', 'اعتماد سطر الاستلام'], ['rejected', 'Reject receipt line', 'رفض سطر الاستلام']], { required: true })}${textarea('reason', 'Decision note', 'ملاحظة القرار', { required: true, rows: 2 })}</div><button class="b09-button b09-primary b09r-btn-xl" type="submit">${esc(t('Record governed decision', 'تسجيل قرار محكوم'))}</button></form>`; }
  const workspace = S.createWorkspace({
    pageId: 'receiving_discrepancies', prefix: 'rd', initialState: () => ({ rows: [], selected: null, selectedId: '', status: 'open', loading: true }), onActivate: load,
    render(state) {
      if (state.loading) return `${scopeLine()}<section class="b09r-panel"><p class="b09-status" data-phase="loading">${esc(t('Loading receiving exceptions…', 'جارِ تحميل استثناءات الاستلام…'))}</p></section>`;
      const open = state.rows.filter((row) => label(row, 'status', 'status') === 'open').length;
      return `${scopeLine()}${kpis([['Visible exceptions', 'الاستثناءات الظاهرة', num(state.rows.length, 0)], ['Awaiting decision', 'بانتظار القرار', num(open, 0), open ? 'warn' : 'ok'], ['Approved', 'معتمد', num(state.rows.filter((row) => label(row, 'status', 'status') === 'approved').length, 0), 'ok'], ['Rejected', 'مرفوض', num(state.rows.filter((row) => label(row, 'status', 'status') === 'rejected').length, 0), 'danger']])}<section class="b09r-panel"><div class="b09r-panel-head"><h2>${esc(t('Receiving exception queue', 'طابور استثناءات الاستلام'))}</h2><label class="b09-query-field"><span>${esc(t('Status', 'الحالة'))}</span><select data-role="rd-filter"><option value="open"${state.status === 'open' ? ' selected' : ''}>${esc(t('Open', 'مفتوح'))}</option><option value="">${esc(t('All', 'الكل'))}</option><option value="approved"${state.status === 'approved' ? ' selected' : ''}>${esc(t('Approved', 'معتمد'))}</option><option value="rejected"${state.status === 'rejected' ? ' selected' : ''}>${esc(t('Rejected', 'مرفوض'))}</option></select></label></div><div class="b09r-card-list" data-role="rd-list">${state.rows.map((row) => `<button type="button" class="b09r-card" data-role="rd-select" data-discrepancy-id="${esc(row.id)}"><strong>${esc(`${label(row, 'type', 'discrepancy_type')} · ${label(row, 'sessionId', 'session_id')}`)}</strong>${badge(label(row, 'status', 'status'), tone[label(row, 'status', 'status')] || '')}<small>${esc(t('Expected', 'المتوقع'))}: ${esc(label(row, 'expectedValue', 'expected_value') || '—')} · ${esc(t('Actual', 'الفعلي'))}: ${esc(label(row, 'actualValue', 'actual_value') || '—')}</small></button>`).join('') || muted('No receiving exceptions match this filter.', 'لا توجد استثناءات استلام تطابق هذا المرشح.')}</div></section>${detail(state.selected)}`;
    },
    bind(container, state, api) {
      const filter = container.querySelector('[data-role="rd-filter"]'); if (filter) filter.addEventListener('change', () => api.guarded(async () => { state.status = filter.value; state.selectedId = ''; await load(state, api); }));
      container.querySelectorAll('[data-role="rd-select"]').forEach((button) => button.addEventListener('click', () => { state.selectedId = button.dataset.discrepancyId; state.selected = state.rows.find((row) => row.id === state.selectedId) || null; api.paint(); }));
      const form = container.querySelector('[data-role="rd-decision-form"]'); if (form) form.addEventListener('submit', (event) => { event.preventDefault(); api.guarded(async () => { const data = api.formData(form); await api.call('wms:receiving_discrepancy_approve', { session_id: label(state.selected, 'sessionId', 'session_id'), discrepancy_id: state.selected.id, decision: data.decision, reason: data.reason }); await load(state, api); }); });
    },
  });
  S.registerOverride('receiving_discrepancies', workspace);
})(window);
