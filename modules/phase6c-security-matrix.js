(function () {
  'use strict';

  const root = window;
  const ACTIONS = [
    'banking.reconciliation.create',
    'banking.reconciliation.match',
    'banking.reconciliation.unmatch',
    'banking.reconciliation.finalize',
    'banking.reconciliation.adjustment_request',
    'banking.reconciliation.legacy_finance_movement',
    'inventory.location.create',
    'inventory.location.transfer',
    'inventory.location.adjust',
    'inventory.location.issue',
    'inventory.location.receive',
    'inventory.location.negative_issue',
    'inventory.location.delete_with_stock',
    'accounting.coa.create',
    'accounting.coa.edit_safe',
    'accounting.coa.edit_used',
    'accounting.coa.deactivate',
    'accounting.coa.deactivate_used',
    'accounting.coa.delete_used',
    'risk_compliance.write',
    'risk_compliance.delete',
    'finance.direct_posting.external',
    'ai.high_risk_write'
  ];

  const FALLBACK_USERS = [
    { id: 'system', name: 'مدير النظام', groups: ['system.admin'] },
    { id: 'mgr_finance', name: 'مدير المالية', groups: ['finance.manager'] },
    { id: 'user_finance', name: 'مستخدم المالية', groups: ['finance.user'] },
    { id: 'mgr_workshop', name: 'مدير الورشة', groups: ['workshop.manager'] },
    { id: 'user_workshop', name: 'مستخدم الورشة', groups: ['workshop.user'] },
    { id: 'employee', name: 'موظف عادي', groups: [] }
  ];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function users() {
    let live = [];
    try {
      const omniUsers = Array.isArray(root.omni?.users) ? root.omni.users : [];
      live = omniUsers.filter(u => u && u.is_active !== false && Array.isArray(u.groups));
    } catch (_) {}
    const byId = new Map();
    [...live, ...FALLBACK_USERS].forEach(user => {
      if (!byId.has(user.id)) byId.set(user.id, user);
    });
    return [...byId.values()].slice(0, 8);
  }

  function explain(actionKey, user) {
    if (!root.PermissionService || typeof root.PermissionService.explainAction !== 'function') {
      return { actionKey, label: actionKey, outcome: 'blocked', allowed: false, riskLevel: 'unknown', reason: 'permission_service_unavailable' };
    }
    return root.PermissionService.explainAction(actionKey, { dryRun: true }, user);
  }

  function badge(explained) {
    const outcome = explained.outcome || (explained.allowed ? 'allowed' : 'blocked');
    const cls = outcome === 'allowed' ? 'ok' : outcome === 'approval_required' ? 'warn' : 'bad';
    const label = outcome === 'allowed' ? 'مسموح' : outcome === 'approval_required' ? 'موافقة' : 'محظور';
    return '<span class="p6a-chip ' + cls + '" title="' + esc(explained.reason || '') + '">' + label + '</span>';
  }

  function render() {
    const body = document.getElementById('securityCenterBody');
    if (!body || document.getElementById('phase6cSecurityMatrix')) return;
    const sampleUsers = users();
    const rows = ACTIONS.map(actionKey => {
      const sample = explain(actionKey, sampleUsers[0] || FALLBACK_USERS[0]);
      const cells = sampleUsers.map(user => '<td>' + badge(explain(actionKey, user)) + '</td>').join('');
      return '<tr><td><strong>' + esc(sample.label || actionKey) + '</strong><span class="p6a-muted">' + esc(actionKey) + '</span></td><td>' + esc(sample.riskLevel || '') + '</td><td>' + esc(sample.defaultPolicy || '') + '</td>' + cells + '</tr>';
    }).join('');
    const head = sampleUsers.map(user => '<th>' + esc(user.name || user.id) + '<span class="p6a-muted">' + esc((user.groups || []).join(',') || 'unmapped') + '</span></th>').join('');
    body.insertAdjacentHTML('beforeend', '<section class="p6a-shell" id="phase6cSecurityMatrix"><section class="p6a-panel"><div class="p6a-heading"><div><h3>مصفوفة صلاحيات الأفعال الحساسة</h3><p>فحص dry-run داخل مركز الأمن. لا يكتب بيانات ولا يغيّر الصلاحيات أثناء العرض.</p></div><div class="p6a-chip-row"><span class="p6a-chip ok">صفحات 86/86</span><span class="p6a-chip warn">High-risk unmapped deny</span><span class="p6a-chip">Default-allow للصفحات المحلية</span></div></div><div class="p6a-warning"><strong>قاعدة Phase 6C:</strong> الصفحات غير المعرّفة تبقى متاحة للتطوير المحلي، لكن الأفعال عالية/حرجة الخطورة غير المعرّفة تُحظر أو تُحوّل إلى طلب موافقة.</div><div class="p6a-table-wrap"><table class="p6a-table"><thead><tr><th>الفعل</th><th>الخطورة</th><th>السياسة</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div><div class="p6a-muted" style="margin-top:10px">مسار الموافقات: createOmniRequest / Command Center. طلبات Phase 6C تحمل actionKey وsourcePage/sourceModule والمستخدم والهدف وbefore/after وriskLevel وrequestedAt وstatus.</div></section></section>');
  }

  function schedule() {
    setTimeout(render, 80);
    setTimeout(render, 350);
  }

  const originalSwitchPage = root.switchPage;
  if (typeof originalSwitchPage === 'function' && !originalSwitchPage.__phase6cMatrixWrapped) {
    const wrapped = function (page, ...args) {
      const result = originalSwitchPage.apply(this, [page, ...args]);
      if (page === 'security_center') schedule();
      return result;
    };
    wrapped.__phase6cMatrixWrapped = true;
    root.switchPage = wrapped;
  }

  document.addEventListener('click', event => {
    const btn = event.target?.closest?.('[data-page="security_center"], [onclick*="security_center"]');
    if (btn) schedule();
  });
  document.addEventListener('DOMContentLoaded', schedule);

  root.Phase6CSecurityMatrix = { render, actions: ACTIONS, users };
})();
