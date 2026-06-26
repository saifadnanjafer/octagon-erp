/**
 * Phase 7A stabilization layer.
 *
 * Add-only module. It does not add sidebar pages and does not replace existing
 * renderers. It injects release, audit, backup, period-lock, and deployment
 * data-quality panels into existing Octagon surfaces.
 */
(function () {
  'use strict';

  const root = window;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const nowIso = () => new Date().toISOString();
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const asArray = value => Array.isArray(value) ? value : [];
  const money = value => Number(value || 0);
  let releaseStatusCache = null;

  function O() {
    try {
      if (typeof root.ensureOmni === 'function') root.ensureOmni();
      return typeof root.omni !== 'undefined' ? root.omni : null;
    } catch (_) {
      return null;
    }
  }

  function F() {
    try {
      if (typeof root.ensureFinance === 'function') root.ensureFinance();
      return typeof root.finance !== 'undefined' ? root.finance : null;
    } catch (_) {
      return null;
    }
  }

  function user() {
    try { return root.PentagonAuth?.getCurrentUser?.() || root.OctagonAuth?.getCurrentUser?.() || {}; } catch (_) { return {}; }
  }

  function hasGroup(group) {
    const u = user();
    return Array.isArray(u.groups) && u.groups.includes(group);
  }

  function canAdmin() {
    return hasGroup('system.admin') || hasGroup('finance.manager');
  }

  function toast(message, type) {
    try { root.showToast?.(message, type || 'info'); } catch (_) {}
  }

  function audit(action, status, payload) {
    const o = O();
    const u = user();
    const event = {
      module: 'phase7a',
      source: 'phase7a_stabilization',
      action,
      status: status || 'logged',
      title: action,
      actorId: u.id || 'unknown',
      actorName: u.displayName || u.name || u.id || 'unknown',
      risk: payload?.risk || 'medium',
      payload: payload || {},
      timestamp: nowIso()
    };
    try { root.recordOmniHistoryEvent?.(event); } catch (_) {}
    try { root.addOmniSystemLog?.({ action, page: 'phase7a', severity: status === 'blocked' ? 'warning' : 'info', message: action, payload }); } catch (_) {}
    if (o) {
      if (!Array.isArray(o.phase7aAudit)) o.phase7aAudit = [];
      o.phase7aAudit.unshift(event);
      if (o.phase7aAudit.length > 500) o.phase7aAudit.length = 500;
    }
  }

  function ensureState() {
    const o = O();
    const f = F();
    if (o) {
      if (!o.phase7a || typeof o.phase7a !== 'object') o.phase7a = {};
      o.phase7a.startedAt = o.phase7a.startedAt || nowIso();
      o.phase7a.phase = 'Phase 7A';
      o.phase7a.serverSessionBridge = true;
      o.phase7a.auditCenter = true;
      o.phase7a.backupVerification = true;
      o.phase7a.releaseReadiness = true;
      o.phase7a.dataQualityExpansion = true;
    }
    if (f && !Array.isArray(f.periodLocks)) f.periodLocks = [];
    if (o) {
      if (!o.finance || typeof o.finance !== 'object') o.finance = {};
      if (!Array.isArray(o.finance.periodLocks)) o.finance.periodLocks = [];
    }
  }

  function save() {
    try { root.saveData?.(); } catch (_) {}
  }

  function periodLocks() {
    ensureState();
    const f = F();
    if (f && Array.isArray(f.periodLocks)) return f.periodLocks;
    const o = O();
    return asArray(o?.finance?.periodLocks);
  }

  function dateInRange(date, lock) {
    const d = String(date || '').slice(0, 10);
    return !!d && d >= String(lock.periodStart || '') && d <= String(lock.periodEnd || '') && lock.status === 'locked';
  }

  function isDateLocked(date, companyId) {
    return periodLocks().some(lock => {
      if (lock.status !== 'locked') return false;
      if (companyId && lock.companyId && lock.companyId !== companyId) return false;
      return dateInRange(date, lock);
    });
  }

  function lockForDate(date, companyId) {
    return periodLocks().find(lock => {
      if (lock.status !== 'locked') return false;
      if (companyId && lock.companyId && lock.companyId !== companyId) return false;
      return dateInRange(date, lock);
    }) || null;
  }

  function addPeriodLock(periodStart, periodEnd, reason) {
    ensureState();
    if (!canAdmin()) {
      toast('Period lock changes require finance manager or system admin.', 'warning');
      audit('period_lock_blocked', 'blocked', { periodStart, periodEnd, reason, risk: 'high' });
      return null;
    }
    const f = F();
    const u = user();
    const lock = {
      id: (root.makeId ? root.makeId('plock') : ('plock_' + Date.now())),
      companyId: root.getActiveCompanyId?.() || root.getActiveOrgCompany?.()?.id || '',
      periodStart,
      periodEnd,
      status: 'locked',
      lockedBy: u.id || '',
      lockedByName: u.displayName || u.name || u.id || '',
      lockedAt: nowIso(),
      reason: reason || 'Phase 7A manual lock',
      unlockedBy: '',
      unlockedAt: '',
      unlockReason: '',
      approvalId: ''
    };
    if (f && Array.isArray(f.periodLocks)) f.periodLocks.unshift(lock);
    else O().finance.periodLocks.unshift(lock);
    audit('period_locked', 'success', { ...lock, risk: 'high' });
    save();
    injectAll();
    toast('Period locked.', 'success');
    return lock;
  }

  function unlockPeriodLock(id, reason) {
    if (!canAdmin()) {
      toast('Period unlock requires finance manager or system admin.', 'warning');
      audit('period_unlock_blocked', 'blocked', { id, reason, risk: 'high' });
      return false;
    }
    const lock = periodLocks().find(item => item.id === id);
    if (!lock) return false;
    const u = user();
    lock.status = 'open';
    lock.unlockedBy = u.id || '';
    lock.unlockedByName = u.displayName || u.name || u.id || '';
    lock.unlockedAt = nowIso();
    lock.unlockReason = reason || 'Manual unlock';
    audit('period_unlocked', 'success', { ...lock, risk: 'high' });
    save();
    injectAll();
    toast('Period unlocked.', 'success');
    return true;
  }

  function defaultPeriodRange() {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const start = `${y}-${m}-01`;
    const end = new Date(y, today.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { start, end };
  }

  function periodLockPanel() {
    const range = defaultPeriodRange();
    const rows = periodLocks();
    return `
      <section class="admin-card admin-card-wide" id="phase7aPeriodLockPanel">
        <h3><i class="fa-solid fa-lock"></i> Phase 7A period lock foundation</h3>
        <p class="admin-note">Foundation only: no period is locked automatically. New finance transaction writes are blocked when their date falls inside a locked period.</p>
        <div class="admin-org-global-grid">
          <div><label>Start</label><input id="p7aLockStart" type="date" class="form-input" value="${range.start}"></div>
          <div><label>End</label><input id="p7aLockEnd" type="date" class="form-input" value="${range.end}"></div>
          <div><label>Reason</label><input id="p7aLockReason" class="form-input" value="Month-end close protection"></div>
          <div style="display:flex;align-items:end"><button class="btn-primary" onclick="OctagonPeriodLocks.lockFromForm()">Lock period</button></div>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-mini-table">
            <thead><tr><th>Status</th><th>Period</th><th>Reason</th><th>By</th><th>Action</th></tr></thead>
            <tbody>${rows.slice(0, 20).map(lock => `<tr>
              <td><span class="analytics-risk-badge" style="background:${lock.status === 'locked' ? '#f59e0b' : '#34d399'}">${esc(lock.status)}</span></td>
              <td>${esc(lock.periodStart)} - ${esc(lock.periodEnd)}</td>
              <td>${esc(lock.reason || lock.unlockReason || '')}</td>
              <td>${esc(lock.lockedByName || lock.lockedBy || '')}</td>
              <td>${lock.status === 'locked' ? `<button class="btn-secondary btn-sm" onclick="OctagonPeriodLocks.unlock('${esc(lock.id)}')">Unlock</button>` : '-'}</td>
            </tr>`).join('') || '<tr><td colspan="5">No period locks yet.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function collectAuditEvents() {
    const o = O() || {};
    const fromHistory = asArray(o.historyLedger).map(item => ({ ...item, _source: 'historyLedger' }));
    const fromAudit = asArray(root.audit_log || root.db?.audit_log || []).map(item => ({ ...item, _source: 'audit_log' }));
    const fromPhase = asArray(o.phase7aAudit).map(item => ({ ...item, _source: 'phase7aAudit' }));
    const all = [...fromPhase, ...fromHistory, ...fromAudit];
    const seen = new Set();
    return all.filter(event => {
      const id = event.id || `${event.timestamp || event.date}-${event.action}-${event.actorId || event.user_id}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).sort((a, b) => String(b.timestamp || b.date || '').localeCompare(String(a.timestamp || a.date || '')));
  }

  function auditPanel() {
    const events = collectAuditEvents();
    const highRisk = events.filter(e => /ai|finance|stock|payroll|auth|login|permission|approval|period|qc|security/i.test(`${e.module || ''} ${e.action || ''} ${e.source || ''} ${e.risk || ''}`));
    const blocked = events.filter(e => ['blocked', 'failed', 'error', 'approval_requested'].includes(e.status || e.result));
    return `
      <section class="admin-card admin-card-wide" id="phase7aAuditPanel">
        <h3><i class="fa-solid fa-shield-halved"></i> Phase 7A audit review</h3>
        <div class="admin-audit-kpis">
          <div><b>${events.length}</b><span>Total audit events</span></div>
          <div><b>${highRisk.length}</b><span>High-risk related</span></div>
          <div><b>${blocked.length}</b><span>Blocked / failed / approval</span></div>
          <div><b>${events.filter(e => /login|logout|auth/i.test(e.action || e.module || '')).length}</b><span>Auth events</span></div>
          <div><b>${events.filter(e => /ai|jarvis/i.test(e.module || e.source || e.action || '')).length}</b><span>AI events</span></div>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-mini-table">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Result</th><th>Risk/source</th></tr></thead>
            <tbody>${events.slice(0, 80).map(e => `<tr>
              <td>${esc(e.timestamp || e.date || '')}</td>
              <td>${esc(e.actorName || e.user_name || e.actorId || e.user_id || '')}<small style="display:block;color:var(--text-muted)">${esc(e.actorRole || e.role || '')}</small></td>
              <td><b>${esc(e.action || e.event_type || '')}</b><small style="display:block;color:var(--text-muted)">${esc(e.module || e.page || '')}</small></td>
              <td>${esc(e.status || e.result || 'logged')}</td>
              <td>${esc(e.risk || e.riskLevel || '-')}/${esc(e.source || e._source || '')}</td>
            </tr>`).join('') || '<tr><td colspan="5">No audit events found.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function fetchReleaseStatus(force) {
    if (releaseStatusCache && !force) return releaseStatusCache;
    try {
      const res = await fetch('/api/release/status');
      releaseStatusCache = await res.json();
    } catch (error) {
      releaseStatusCache = { error: error.message || 'release status unavailable' };
    }
    return releaseStatusCache;
  }

  function releaseReadinessPanel(status) {
    status = status || releaseStatusCache || {};
    const git = status.git || {};
    const route = status.route || {};
    const backup = status.backup || {};
    const dirty = !!String(git.statusShort || '').trim();
    const checks = [
      ['Route static baseline', route.navCount === 86 && route.viewMarkerCount === 86 && route.viewFiles === 86],
      ['No duplicate sidebar pages', asArray(route.duplicateDataPages).length === 0],
      ['No missing view templates', asArray(route.missingViewFiles).length === 0],
      ['Database parses', backup.databaseParse?.ok === true],
      ['Backup exists', Number(backup.count || 0) > 0],
      ['Server session foundation', status.auth?.serverSessionFoundation === true],
      ['Git worktree clean', !dirty],
      ['Remote configured', !!String(git.remote || '').trim()]
    ];
    return `
      <section class="admin-card admin-card-wide" id="phase7aReleasePanel">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
          <h3><i class="fa-solid fa-rocket"></i> Phase 7A release readiness</h3>
          <button class="btn-secondary" onclick="OctagonPhase7A.refreshReleaseStatus()">Refresh</button>
        </div>
        <div class="admin-health-grid">
          <div class="admin-health-tile"><span>Commit</span><b>${esc(git.head || 'unknown')}</b></div>
          <div class="admin-health-tile"><span>Branch</span><b>${esc(git.branch || 'unknown')}</b></div>
          <div class="admin-health-tile"><span>Dirty state</span><b>${dirty ? 'dirty' : 'clean'}</b></div>
          <div class="admin-health-tile"><span>Routes</span><b>${esc(route.navCount || '?')}/${esc(route.viewFiles || '?')}</b></div>
          <div class="admin-health-tile"><span>Backups</span><b>${esc(backup.count || 0)}</b></div>
          <div class="admin-health-tile"><span>Remote</span><b>${String(git.remote || '').trim() ? 'configured' : 'missing'}</b></div>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-mini-table">
            <thead><tr><th>Checklist item</th><th>Status</th><th>Evidence</th></tr></thead>
            <tbody>${checks.map(([label, ok]) => `<tr>
              <td>${esc(label)}</td>
              <td><span class="analytics-risk-badge" style="background:${ok ? '#34d399' : '#f59e0b'}">${ok ? 'OK' : 'Review'}</span></td>
              <td>${esc(status.generatedAt || '')}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function backupHealthPanel(status) {
    status = status || releaseStatusCache || {};
    const backup = status.backup || {};
    const latest = backup.latest || {};
    return `
      <section class="admin-card admin-card-wide" id="phase7aBackupPanel">
        <h3><i class="fa-solid fa-shield"></i> Phase 7A backup verification</h3>
        <div class="admin-health-grid">
          <div class="admin-health-tile"><span>Database parse</span><b>${backup.databaseParse?.ok ? 'PASS' : 'FAIL'}</b></div>
          <div class="admin-health-tile"><span>Backup folder</span><b>${esc(backup.backupDir || '-')}</b></div>
          <div class="admin-health-tile"><span>Backup count</span><b>${esc(backup.count || 0)}</b></div>
          <div class="admin-health-tile"><span>Latest backup</span><b>${esc(latest.file || 'none')}</b></div>
        </div>
        <p class="admin-note">Restore remains manual and destructive; this panel performs dry-run verification only.</p>
        <button class="btn-secondary" onclick="OctagonPhase7A.verifyLatestBackup()">Verify latest backup</button>
        <pre id="phase7aBackupVerifyResult" style="white-space:pre-wrap;margin-top:10px;color:var(--text-muted)"></pre>
      </section>
    `;
  }

  function dataQualityChecks(status) {
    const o = O() || {};
    const f = F() || {};
    const route = status?.route || {};
    const git = status?.git || {};
    const backup = status?.backup || {};
    const issues = [];
    const add = (severity, source, issue, recommendation) => issues.push({ severity, source, issue, recommendation });
    asArray(o.users).forEach(u => { if (!u.role && !u.roleId) add('P0', 'users', `User ${u.id || u.name} has no role`, 'Assign an explicit role before deployment.'); });
    asArray(o.roles).forEach(r => { if (!asArray(r.groups).length && !asArray(r.permissions).length) add('P1', 'roles', `Role ${r.id || r.name} has no groups/permissions`, 'Review role template.'); });
    asArray(root.employees || []).forEach(emp => { if (!emp.status && emp.is_active === undefined) add('P2', 'employees', `Employee ${emp.name || emp.id} has no active status`, 'Set active/inactive status.'); });
    asArray(f.accounts).forEach(acc => { if (!acc.type) add('P1', 'finance.accounts', `Account ${acc.code || acc.id} missing type`, 'Assign account type before financial statements.'); });
    asArray(root.journals || []).forEach(j => { if (j.account_id && !asArray(f.accounts).some(a => a.id === j.account_id || a.code === j.account_id)) add('P1', 'journals', `Journal ${j.id || j.name} references missing account`, 'Map journal to existing account.'); });
    asArray(o.materials).forEach(m => { if (money(m.cost || m.unitCost || m.avgCost) <= 0) add('P1', 'materials', `Material ${m.name || m.id} has no cost`, 'Add costing before job margin reports.'); if (money(m.qty || m.quantity || m.stock) < 0) add('P0', 'materials', `Material ${m.name || m.id} has negative stock`, 'Reconcile stock immediately.'); });
    asArray(o.locationStock).forEach(s => { if (money(s.qty) < 0) add('P0', 'locationStock', `Negative location stock for ${s.materialId || s.id}`, 'Investigate location movements.'); });
    asArray(f.customers || o.customers).forEach(c => { if (!c.name || !c.phone) add('P2', 'customers', `Customer ${c.id || c.name || 'unknown'} missing name/phone`, 'Complete customer contact fields.'); });
    asArray(o.suppliers).forEach(s => { if (!s.name || !s.phone) add('P2', 'suppliers', `Supplier ${s.id || s.name || 'unknown'} missing name/phone`, 'Complete supplier contact fields.'); });
    asArray(o.requests).forEach(req => { if ((req.status || '').includes('pending') && req.createdAt && ((Date.now() - new Date(req.createdAt).getTime()) / 86400000) > 7) add('P1', 'approvals', `Pending approval older than 7 days: ${req.id}`, 'Escalate or close old request.'); });
    asArray(o.aiApprovalQueue || o.aiQueue || []).forEach(item => { if (!item.requestedBy && !item.requestedById) add('P0', 'ai', `AI request ${item.id || item.action || 'unknown'} has no user stamp`, 'Reject or enrich before execution.'); });
    if (!backup.databaseParse?.ok) add('P0', 'database', 'database.json parse failed or status unavailable', 'Run parse check before deployment.');
    if (!backup.count) add('P0', 'backup', 'No server backup detected', 'Create and verify a local backup.');
    if (!String(git.remote || '').trim()) add('P1', 'git', 'No remote Git configured', 'Configure remote backup before heavy Phase 7 work.');
    if (String(git.statusShort || '').trim()) add('P1', 'git', 'Uncommitted files exist', 'Review and commit or park changes before release.');
    if (route.navCount !== 86 || route.viewMarkerCount !== 86 || route.viewFiles !== 86) add('P0', 'routes', 'Route/view count mismatch', 'Restore 86/86 baseline before feature work.');
    if (asArray(route.missingViewFiles).length) add('P0', 'views', 'Missing view templates', 'Add or restore missing view files.');
    if (!asArray(o.users).length) add('P1', 'runtime seeds', 'omni.users is empty in file and runtime-seeded', 'Backfill durable production users during auth hardening.');
    return issues;
  }

  function dataQualityPanel(status) {
    const issues = dataQualityChecks(status || releaseStatusCache || {});
    return `
      <section class="admin-card admin-card-wide" id="phase7aDataQualityPanel">
        <h3><i class="fa-solid fa-magnifying-glass-chart"></i> Phase 7A deployment blockers</h3>
        <p class="admin-note">Read-only checks. No auto-fix is performed.</p>
        <div class="admin-audit-kpis">
          <div><b>${issues.length}</b><span>Total issues</span></div>
          <div><b>${issues.filter(i => i.severity === 'P0').length}</b><span>P0</span></div>
          <div><b>${issues.filter(i => i.severity === 'P1').length}</b><span>P1</span></div>
          <div><b>${issues.filter(i => i.severity === 'P2').length}</b><span>P2</span></div>
        </div>
        <div class="analytics-table-wrap">
          <table class="analytics-mini-table">
            <thead><tr><th>Severity</th><th>Source</th><th>Issue</th><th>Recommendation</th></tr></thead>
            <tbody>${issues.slice(0, 120).map(i => `<tr>
              <td><span class="analytics-risk-badge" style="background:${i.severity === 'P0' ? '#ef4444' : i.severity === 'P1' ? '#f59e0b' : '#64748b'}">${esc(i.severity)}</span></td>
              <td>${esc(i.source)}</td>
              <td>${esc(i.issue)}</td>
              <td>${esc(i.recommendation)}</td>
            </tr>`).join('') || '<tr><td colspan="4">No deployment blockers detected by Phase 7A checks.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function authStatusPanel() {
    const session = root.__octagonServerSession || {};
    const u = user();
    return `
      <section class="admin-card admin-card-wide" id="phase7aAuthPanel">
        <h3><i class="fa-solid fa-key"></i> Phase 7A server session bridge</h3>
        <div class="admin-health-grid">
          <div class="admin-health-tile"><span>Current client user</span><b>${esc(u.displayName || u.name || u.id || 'guest')}</b></div>
          <div class="admin-health-tile"><span>Server session</span><b>${session.authenticated ? 'active' : 'not established'}</b></div>
          <div class="admin-health-tile"><span>Switcher policy</span><b>admin/dev only</b></div>
          <div class="admin-health-tile"><span>Password storage</span><b>hash + salt</b></div>
        </div>
        <p class="admin-note">This is a minimal bridge: the server can issue an HttpOnly session after credential validation, while the local-first client fallback remains available for development.</p>
      </section>
    `;
  }

  function injectInto(containerId, html) {
    const el = document.getElementById(containerId);
    if (!el) return;
    let wrap = el.querySelector('#phase7aInjected');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'phase7aInjected';
      wrap.style.display = 'grid';
      wrap.style.gap = '16px';
      el.appendChild(wrap);
    }
    wrap.innerHTML = html;
  }

  function injectAll() {
    const status = releaseStatusCache || {};
    injectInto('securityCenterBody', authStatusPanel() + auditPanel() + periodLockPanel());
    injectInto('deployReadyBody', releaseReadinessPanel(status) + backupHealthPanel(status));
    injectInto('dataQualityBody', dataQualityPanel(status));
    const financePage = document.getElementById('pageFinance');
    if (financePage && !financePage.querySelector('#phase7aFinanceLockHost')) {
      const host = document.createElement('div');
      host.id = 'phase7aFinanceLockHost';
      host.innerHTML = periodLockPanel();
      financePage.appendChild(host);
    } else {
      const host = document.getElementById('phase7aFinanceLockHost');
      if (host) host.innerHTML = periodLockPanel();
    }
  }

  async function refreshReleaseStatus() {
    await fetchReleaseStatus(true);
    injectAll();
  }

  async function verifyLatestBackup() {
    const target = document.getElementById('phase7aBackupVerifyResult');
    if (target) target.textContent = 'Verifying latest backup...';
    try {
      const res = await fetch('/api/backup/verify');
      const payload = await res.json();
      if (target) target.textContent = JSON.stringify(payload, null, 2);
      toast(payload.success ? 'Backup verification passed.' : 'Backup verification needs review.', payload.success ? 'success' : 'warning');
    } catch (error) {
      if (target) target.textContent = error.message || String(error);
      toast('Backup verification failed.', 'danger');
    }
  }

  function wrapFinanceWrites() {
    if (root.__phase7aFinanceWrapped || typeof root.addFinanceTransaction !== 'function') return;
    const original = root.addFinanceTransaction;
    root.addFinanceTransaction = function (tx, options) {
      const date = tx?.date || todayIso();
      const companyId = tx?.companyId || root.getActiveCompanyId?.() || '';
      const lock = lockForDate(date, companyId);
      if (lock && !(options && options.allowLockedPeriodWrite)) {
        audit('locked_period_write_blocked', 'blocked', { date, companyId, lockId: lock.id, txType: tx?.type || '', amount: tx?.amount || 0, risk: 'critical' });
        toast('Finance period is locked. Write was blocked or must be approval-routed.', 'warning');
        return null;
      }
      return original.apply(this, arguments);
    };
    root.__phase7aFinanceWrapped = true;
  }

  function wrapSwitchPage() {
    if (root.__phase7aSwitchWrapped || typeof root.switchPage !== 'function') return;
    const original = root.switchPage;
    root.switchPage = function () {
      const result = original.apply(this, arguments);
      setTimeout(injectAll, 80);
      return result;
    };
    root.__phase7aSwitchWrapped = true;
  }

  root.OctagonPeriodLocks = {
    list: periodLocks,
    isDateLocked,
    lockFromForm() {
      const start = document.getElementById('p7aLockStart')?.value || todayIso();
      const end = document.getElementById('p7aLockEnd')?.value || start;
      const reason = document.getElementById('p7aLockReason')?.value || '';
      return addPeriodLock(start, end, reason);
    },
    unlock(id) {
      const reason = root.prompt ? root.prompt('Unlock reason:', 'Approved adjustment window') : 'Manual unlock';
      if (reason === null) return false;
      return unlockPeriodLock(id, reason || 'Manual unlock');
    }
  };

  root.OctagonPhase7A = {
    refreshReleaseStatus,
    verifyLatestBackup,
    dataQualityChecks: () => dataQualityChecks(releaseStatusCache || {}),
    auditEvents: collectAuditEvents,
    injectAll
  };

  function init() {
    ensureState();
    wrapFinanceWrites();
    wrapSwitchPage();
    fetch('/api/auth/session').then(res => res.json()).then(payload => { root.__octagonServerSession = payload; }).catch(() => {});
    fetchReleaseStatus(true).then(injectAll);
    setTimeout(injectAll, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
