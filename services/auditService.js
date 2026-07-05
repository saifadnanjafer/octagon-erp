(function () {
  'use strict';

  const root = window;
  const services = root.OctagonServices || root.PentagonServices || {};
  root.OctagonServices = services;
  root.PentagonServices = services;

  const utils = services.utils || {
    now() {
      return new Date().toISOString();
    },
    makeId(prefix) {
      return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    },
    clone(value) {
      return JSON.parse(JSON.stringify(value));
    },
  };
  services.utils = utils;

  function asNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clampConfidence(value) {
    return Math.max(0, Math.min(1, asNumber(value, 1)));
  }

  function estimateFinancialImpact(data = {}) {
    const candidates = [
      data.financial_impact_estimated,
      data.amount,
      data.total,
      data.totalAmount,
      data.debit,
      data.credit,
      data.balance,
      data.open_amount,
    ];
    const value = candidates.find(item => Number.isFinite(Number(item)));
    return Math.abs(asNumber(value, 0));
  }

  function normalizeAuditEvent(event = {}) {
    if (!event.id) event.id = utils.makeId('AUD');
    if (!event.event_type) event.event_type = event.action || 'system.event';
    if (event.record_id === undefined) event.record_id = event.entity_id || event.entityId || '';
    if (event.data === undefined) event.data = {};
    if (!event.timestamp) event.timestamp = event.date || event.created_at || utils.now();
    if (!event.user_id) event.user_id = event.actor_id || event.created_by || 'system';
    if (!event.user_name) event.user_name = event.actor || event.created_by_name || 'النظام';
    event.confidence_score = clampConfidence(event.confidence_score);
    event.financial_impact_estimated = estimateFinancialImpact({
      ...event.data,
      financial_impact_estimated: event.financial_impact_estimated,
    });
    event.anomaly_flag = Boolean(event.anomaly_flag);
    if (!event.source) event.source = event.data?.source || event.page || 'AuditService';
    return event;
  }

  function normalizeAuditLog(db) {
    if (!db || typeof db !== 'object') return [];
    if (!Array.isArray(db.audit_log)) db.audit_log = [];
    db.audit_log.forEach(normalizeAuditEvent);
    return db.audit_log;
  }

  const DB = root.OctagonDB || root.PentagonDB || {
    cache: null,
    cacheStr: null,
    async load(options = {}) {
      if (this.cache && !options.force) {
        normalizeAuditLog(this.cache);
        return this.cache;
      }
      const res = await fetch('/api/db', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('تعذر تحميل قاعدة البيانات');
      this.cache = await res.json();
      normalizeAuditLog(this.cache);
      this.cacheStr = JSON.stringify(this.cache);
      return this.cache;
    },
    getCached() {
      return this.cache;
    },
    async save(db = this.cache) {
      if (!db) throw new Error('لا توجد قاعدة بيانات للحفظ');
      normalizeAuditLog(db);
      
      const collectionsToTrack = [
        'employees', 'contacts', 'departments', 'users', 'locations', 'quants', 'stock_moves', 
        'transfers', 'journals', 'journal_entries', 'account_moves', 'account_payments', 'account_partial_reconciles',
        'employee_advances', 'payroll_periods', 'employee_payroll_closings', 'payroll_payments', 'payroll_adjustments',
        'payments', 'maintenance_requests', 'production_orders', 'work_orders', 'audit_log'
      ];
      
      let cachedDb = null;
      try {
        cachedDb = this.cacheStr ? JSON.parse(this.cacheStr) : null;
      } catch (e) {}
      
      let changedCollection = null;
      let changedCount = 0;
      let otherChanges = false;
      
      if (cachedDb) {
        const allKeys = new Set([...Object.keys(db), ...Object.keys(cachedDb)]);
        for (const key of allKeys) {
          const before = cachedDb[key];
          const after = db[key];
          const beforeStr = JSON.stringify(before);
          const afterStr = JSON.stringify(after);
          
          if (beforeStr !== afterStr) {
            if (key === 'omni' && before && after) {
              const omniKeys = new Set([...Object.keys(after), ...Object.keys(before)]);
              for (const ok of omniKeys) {
                if (JSON.stringify(before[ok]) !== JSON.stringify(after[ok])) {
                  if (Array.isArray(after[ok])) {
                    changedCount++;
                    changedCollection = `omni.${ok}`;
                  } else {
                    otherChanges = true;
                  }
                }
              }
            } else if (Array.isArray(after) && collectionsToTrack.includes(key)) {
              changedCount++;
              changedCollection = key;
            } else {
              otherChanges = true;
            }
          }
        }
      } else {
        otherChanges = true;
      }
      
      if (changedCount === 1 && !otherChanges && changedCollection) {
        try {
          const pathParts = changedCollection.split('.');
          let beforeCol = cachedDb;
          for (const p of pathParts) { beforeCol = beforeCol?.[p]; }
          let afterCol = db;
          for (const p of pathParts) { afterCol = afterCol?.[p]; }
          
          let singleRecordAppend = null;
          if (Array.isArray(beforeCol) && Array.isArray(afterCol)) {
            if (afterCol.length === beforeCol.length + 1) {
              const allPrevMatch = beforeCol.every((val, idx) => JSON.stringify(val) === JSON.stringify(afterCol[idx]));
              if (allPrevMatch) {
                const newRecord = afterCol[afterCol.length - 1];
                if (newRecord && newRecord.id) {
                  singleRecordAppend = newRecord;
                }
              }
            } else if (afterCol.length === beforeCol.length) {
              let modifiedIdx = -1;
              let modifiedCount = 0;
              for (let i = 0; i < afterCol.length; i++) {
                if (JSON.stringify(beforeCol[i]) !== JSON.stringify(afterCol[i])) {
                  modifiedIdx = i;
                  modifiedCount++;
                }
              }
              if (modifiedCount === 1 && afterCol[modifiedIdx] && afterCol[modifiedIdx].id) {
                singleRecordAppend = afterCol[modifiedIdx];
              }
            }
          }
          
          if (singleRecordAppend) {
            const res = await fetch('/api/record', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection: changedCollection,
                id: singleRecordAppend.id,
                data: singleRecordAppend
              }),
            });
            if (res.ok) {
              console.log(`Delta Write [record]: saved ${changedCollection} id=${singleRecordAppend.id}`);
              this.cacheStr = JSON.stringify(db);
              this.cache = db;
              return db;
            }
          }
          
          const res = await fetch('/api/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: changedCollection, data: afterCol }),
          });
          if (res.ok) {
            console.log(`Delta Write [collection]: saved ${changedCollection}`);
            this.cacheStr = JSON.stringify(db);
            this.cache = db;
            return db;
          }
        } catch (deltaErr) {
          console.warn('Delta write failed, falling back to full save:', deltaErr.message);
        }
      }
      
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(db),
      });
      if (!res.ok) throw new Error('تعذر حفظ قاعدة البيانات');
      this.cacheStr = JSON.stringify(db);
      this.cache = db;
      return db;
    },
    async mutate(mutator) {
      const db = await this.load();
      const result = await mutator(db);
      await this.save(db);
      return result;
    },
  };
  root.OctagonDB = DB;
  root.PentagonDB = DB;

  function userListFromDb(db) {
    if (!db || typeof db !== 'object') return [];
    const topUsers = Array.isArray(db.users) ? db.users : [];
    const omniUsers = db.omni && Array.isArray(db.omni.users) ? db.omni.users : [];
    const merged = [...topUsers];
    const seenIds = new Set(topUsers.map(u => u.id));
    omniUsers.forEach(u => { if (!seenIds.has(u.id)) merged.push(u); });
    return merged;
  }

  const Auth = root.OctagonAuth || root.PentagonAuth || {
    _currentUserId: (typeof localStorage !== 'undefined' && (localStorage.getItem('octagon_user_id') || localStorage.getItem('pentagon_user_id'))) || '',
    getCurrentUser() {
      const db = DB.getCached();
      if (!db) return { id: 'system', name: 'النظام', groups: ['system.admin'] };
      
      const devMode = (root.devModeAuthSwitcher) || (db.omni && db.omni.adminSettings && db.omni.adminSettings.devModeAuthSwitcher) || false;
      const currentId = this._currentUserId || (devMode ? 'system' : '');

      if (!currentId) {
        return {
          id: 'guest',
          name: 'زائر',
          displayName: 'زائر',
          groups: [],
          role: 'guest',
          roleId: 'guest'
        };
      }

      const users = userListFromDb(db);
      const roles = Array.isArray(db.omni?.roles) ? db.omni.roles : [];
      const activeUsers = users.filter(u => u && u.is_active !== false && u.status !== 'inactive');
      const requestedId = currentId === 'system' ? 'system_admin' : currentId;
      const user = activeUsers.find(u => u.id === requestedId) || activeUsers.find(u => u.id === currentId);
      const fallback = activeUsers.find(u => u.id === 'system_admin') || activeUsers.find(u => u.id === 'system');
      const resolved = user || fallback || {
        id: 'system',
        name: 'النظام',
        groups: ['system.admin'],
      };
      const role = roles.find(r => r.id === resolved.roleId || r.id === resolved.role);
      if (!Array.isArray(resolved.groups)) resolved.groups = Array.isArray(role?.groups) ? role.groups.slice() : [];
      if (!resolved.name && resolved.displayName) resolved.name = resolved.displayName;
      if (!resolved.displayName && resolved.name) resolved.displayName = resolved.name;
      if (!resolved.role && resolved.roleId) resolved.role = resolved.roleId;
      return resolved;
    },
    setCurrentUser(userId) {
      this._currentUserId = userId || '';
      if (typeof localStorage !== 'undefined') {
        if (userId) {
          localStorage.setItem('octagon_user_id', userId);
        } else {
          localStorage.removeItem('octagon_user_id');
        }
        localStorage.removeItem('pentagon_user_id');
      }
      console.log(`Auth: User switched to ${userId || 'guest'}`);
    }
  };
  root.OctagonAuth = Auth;
  root.PentagonAuth = Auth;

  function requireAuditRead() {
    if (!root.PermissionService) return;
    const groups = root.PermissionService.resolveGroups();
    const allowed = groups.includes('system.admin')
      || groups.includes('workshop.manager')
      || groups.includes('finance.manager');
    if (!allowed) throw new Error('⚠️ عذراً، لا تمتلك صلاحية [read] على [audit_log]');
  }

  function appendAuditEvent(db, entry = {}) {
    normalizeAuditLog(db);
    const user = Auth.getCurrentUser();
    const event = normalizeAuditEvent({
      id: entry.id,
      event_type: entry.event_type || entry.action,
      record_id: entry.record_id || entry.recordId || entry.entity_id || entry.entityId,
      data: utils.clone(entry.data || entry.payload || {}),
      user_id: entry.user_id || user?.id || 'system',
      user_name: entry.user_name || user?.name || 'النظام',
      timestamp: entry.timestamp || entry.date || utils.now(),
      confidence_score: entry.confidence_score,
      financial_impact_estimated: entry.financial_impact_estimated,
      anomaly_flag: entry.anomaly_flag,
      source: entry.source || entry.page,
    });
    db.audit_log.push(event);
    return event;
  }

  const AuditService = {
    async createEvent(eventType, recordId, data = {}, options = {}) {
      return DB.mutate(db => {
        return appendAuditEvent(db, {
          event_type: eventType,
          record_id: recordId,
          data,
          confidence_score: options.confidence_score,
          financial_impact_estimated: options.financial_impact_estimated,
          anomaly_flag: options.anomaly_flag,
          source: options.source,
        });
      });
    },

    async recordAuditEvent(entry = {}) {
      return DB.mutate(db => {
        return appendAuditEvent(db, entry);
      });
    },

    async getHistory(recordId, options = {}) {
      requireAuditRead();
      const db = await DB.load();
      let events = (db.audit_log || []).filter(event => event.record_id === recordId);
      if (options.type) events = events.filter(event => event.event_type === options.type);
      if (options.since) events = events.filter(event => event.timestamp >= options.since);
      return events.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    },

    async getByType(eventType, options = {}) {
      requireAuditRead();
      const db = await DB.load();
      let events = (db.audit_log || []).filter(event => String(event.event_type || '').startsWith(eventType));
      if (options.dateFrom) events = events.filter(event => event.timestamp >= options.dateFrom);
      if (options.dateTo) events = events.filter(event => event.timestamp <= options.dateTo);
      return events;
    },
  };

  root.AuditService = AuditService;
  root.recordAuditEvent = AuditService.recordAuditEvent.bind(AuditService);
  services.audit = AuditService;
})();
