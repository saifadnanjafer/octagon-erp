(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Reusable Original-Shell Collaboration Panel Component
  //
  // Renders Chatter Messages, Followers, Record Activities, Field History,
  // Immutable Snapshots, and Lineage for any host record surface.
  // ---------------------------------------------------------------------

  function client() { return root.CanonicalClient || null; }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  class OctagonCollaborationPanel {
    constructor(container, { entity, recordId, readPermission = null }) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.entity = entity;
      this.recordId = recordId;
      this.readPermission = readPermission;
      this.tab = 'messages';
      this.messages = [];
      this.followers = [];
      this.activities = [];
      this.history = [];
      this.snapshots = [];
      this.lineage = [];
      this.loading = false;
      this.error = null;
    }

    async init() {
      if (!this.container) return;
      this.renderSkeleton();
      await this.refresh();
    }

    async refresh() {
      const c = client();
      if (!c) {
        this.error = 'العميل غير متوفر';
        this.render();
        return;
      }
      this.loading = true;
      this.error = null;
      this.render();

      try {
        if (this.tab === 'messages') {
          const res = await c.query('/collaboration/messages', { entity: this.entity, record_id: this.recordId });
          this.messages = res?.data || [];
        } else if (this.tab === 'followers') {
          const res = await c.query('/collaboration/followers', { entity: this.entity, record_id: this.recordId });
          this.followers = res?.data || [];
        } else if (this.tab === 'activities') {
          const res = await c.query('/collaboration/activities', { entity: this.entity, record_id: this.recordId });
          this.activities = res?.data || [];
        } else if (this.tab === 'history') {
          const res = await c.query('/collaboration/history', { entity: this.entity, record_id: this.recordId });
          this.history = res?.data || [];
        } else if (this.tab === 'snapshots') {
          const res = await c.query('/collaboration/snapshots', { entity: this.entity, record_id: this.recordId });
          this.snapshots = res?.data || [];
        } else if (this.tab === 'lineage') {
          const res = await c.query('/collaboration/lineage', { entity: this.entity, record_id: this.recordId });
          this.lineage = res?.data || [];
        }
      } catch (err) {
        this.error = err.message || 'خطأ في تحميل البيانات';
      } finally {
        this.loading = false;
        this.render();
      }
    }

    setTab(t) {
      this.tab = t;
      this.refresh();
    }

    async postMessage(bodyText) {
      const c = client();
      if (!c || !bodyText.trim()) return;
      try {
        await c.action('collaboration:message_post', {
          entity: this.entity,
          record_id: this.recordId,
          body: bodyText,
        });
        await this.refresh();
      } catch (err) {
        alert(err.message || 'فشل نشر الرسالة');
      }
    }

    async follow() {
      const c = client();
      if (!c) return;
      try {
        await c.action('collaboration:record_follow', { entity: this.entity, record_id: this.recordId });
        await this.refresh();
      } catch (err) {
        alert(err.message || 'فشل المتابعة');
      }
    }

    async unfollow() {
      const c = client();
      if (!c) return;
      try {
        await c.action('collaboration:record_unfollow', { entity: this.entity, record_id: this.recordId });
        await this.refresh();
      } catch (err) {
        alert(err.message || 'فشل إلغاء المتابعة');
      }
    }

    async createActivity(summaryAr, kind = 'todo', dueAt = null) {
      const c = client();
      if (!c || !summaryAr.trim()) return;
      try {
        await c.action('collaboration:activity_create', {
          entity: this.entity,
          record_id: this.recordId,
          kind,
          summary_ar: summaryAr,
          due_at: dueAt,
        });
        await this.refresh();
      } catch (err) {
        alert(err.message || 'فشل إنشاء النشاط');
      }
    }

    async completeActivity(activityId) {
      const c = client();
      if (!c) return;
      try {
        await c.action('collaboration:activity_complete', { activity_id: activityId });
        await this.refresh();
      } catch (err) {
        alert(err.message || 'فشل إكمال النشاط');
      }
    }

    renderSkeleton() {
      if (!this.container) return;
      this.container.innerHTML = `<div class="p-4 border rounded bg-white shadow-sm dark:bg-gray-800">
        <div class="animate-pulse space-y-3">
          <div class="h-4 bg-gray-200 rounded w-1/4"></div>
          <div class="h-8 bg-gray-100 rounded"></div>
        </div>
      </div>`;
    }

    render() {
      if (!this.container) return;

      const tabs = [
        { id: 'messages', label: 'المحادثات', icon: 'fa-comments' },
        { id: 'followers', label: 'المتابعون', icon: 'fa-users' },
        { id: 'activities', label: 'الأنشطة', icon: 'fa-tasks' },
        { id: 'history', label: 'التغييرات', icon: 'fa-history' },
        { id: 'snapshots', label: 'اللقطات', icon: 'fa-camera' },
        { id: 'lineage', label: 'التسلسل', icon: 'fa-project-diagram' },
      ];

      let tabNavHtml = '<div class="flex border-b mb-3 overflow-x-auto gap-1 text-sm font-medium">';
      for (const t of tabs) {
        const active = this.tab === t.id ? 'border-blue-600 text-blue-600 font-bold border-b-2' : 'text-gray-500 hover:text-gray-700';
        tabNavHtml += `<button type="button" class="py-2 px-3 focus:outline-none ${active}" data-tab="${t.id}">
          <i class="fas ${t.icon} mr-1"></i> ${t.label}
        </button>`;
      }
      tabNavHtml += '</div>';

      let bodyHtml = '';
      if (this.loading) {
        bodyHtml = `<div class="p-4 text-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i> جاري التحميل...</div>`;
      } else if (this.error) {
        bodyHtml = `<div class="p-3 bg-red-50 text-red-600 border border-red-200 rounded text-sm"><i class="fas fa-exclamation-circle mr-1"></i> ${escapeHtml(this.error)}</div>`;
      } else if (this.tab === 'messages') {
        bodyHtml = this.renderMessagesTab();
      } else if (this.tab === 'followers') {
        bodyHtml = this.renderFollowersTab();
      } else if (this.tab === 'activities') {
        bodyHtml = this.renderActivitiesTab();
      } else if (this.tab === 'history') {
        bodyHtml = this.renderHistoryTab();
      } else if (this.tab === 'snapshots') {
        bodyHtml = this.renderSnapshotsTab();
      } else if (this.tab === 'lineage') {
        bodyHtml = this.renderLineageTab();
      }

      this.container.innerHTML = `<div class="collaboration-panel border rounded-lg p-4 bg-white shadow-sm dark:bg-gray-800 text-right" dir="rtl">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-base font-semibold text-gray-800 dark:text-gray-100"><i class="fas fa-comments text-blue-500 ml-2"></i>مركز التعاون والأنشطة</h4>
          <span class="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded border">${escapeHtml(this.entity)} #${escapeHtml(this.recordId)}</span>
        </div>
        ${tabNavHtml}
        ${bodyHtml}
      </div>`;

      // Bind events
      this.container.querySelectorAll('[data-tab]').forEach((btn) => {
        btn.addEventListener('click', (e) => this.setTab(btn.getAttribute('data-tab')));
      });

      const postBtn = this.container.querySelector('#collabPostBtn');
      if (postBtn) {
        postBtn.addEventListener('click', () => {
          const txt = this.container.querySelector('#collabMsgInput')?.value || '';
          this.postMessage(txt);
        });
      }

      const followBtn = this.container.querySelector('#collabFollowBtn');
      if (followBtn) followBtn.addEventListener('click', () => this.follow());

      const unfollowBtn = this.container.querySelector('#collabUnfollowBtn');
      if (unfollowBtn) unfollowBtn.addEventListener('click', () => this.unfollow());

      const actBtn = this.container.querySelector('#collabCreateActBtn');
      if (actBtn) {
        actBtn.addEventListener('click', () => {
          const summary = this.container.querySelector('#collabActSummary')?.value || '';
          const kind = this.container.querySelector('#collabActKind')?.value || 'todo';
          this.createActivity(summary, kind);
        });
      }

      this.container.querySelectorAll('[data-complete-act]').forEach((btn) => {
        btn.addEventListener('click', () => this.completeActivity(btn.getAttribute('data-complete-act')));
      });
    }

    renderMessagesTab() {
      let list = '';
      if (!this.messages.length) {
        list = `<p class="text-xs text-gray-400 py-3 text-center">لا توجد رسائل سابقة</p>`;
      } else {
        list = '<div class="space-y-2 mb-3 max-h-64 overflow-y-auto pl-1">';
        for (const m of this.messages) {
          list += `<div class="p-2 border-r-2 border-blue-400 bg-gray-50 rounded text-xs">
            <div class="flex justify-between text-gray-500 mb-1">
              <span class="font-medium text-gray-700">${escapeHtml(m.authorId)}</span>
              <span>${escapeHtml(m.createdAt ? m.createdAt.slice(0, 16).replace('T', ' ') : '')}</span>
            </div>
            <p class="text-gray-800 font-sans leading-relaxed">${escapeHtml(m.body)}</p>
          </div>`;
        }
        list += '</div>';
      }

      return `${list}
      <div class="mt-2 pt-2 border-t">
        <textarea id="collabMsgInput" class="w-full p-2 border rounded text-xs focus:ring-1 focus:ring-blue-500" rows="2" placeholder="اكتب ملاحظة أو رسالة في المحادثة..."></textarea>
        <div class="flex justify-end mt-1">
          <button type="button" id="collabPostBtn" class="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"><i class="fas fa-paper-plane ml-1"></i>نشر</button>
        </div>
      </div>`;
    }

    renderFollowersTab() {
      let list = '';
      if (!this.followers.length) {
        list = `<p class="text-xs text-gray-400 py-3 text-center">لا يوجد متابعون حالياً</p>`;
      } else {
        list = '<div class="divide-y max-h-48 overflow-y-auto mb-3">';
        for (const f of this.followers) {
          list += `<div class="py-1.5 flex justify-between items-center text-xs">
            <span class="font-medium text-gray-700"><i class="fas fa-user-circle text-gray-400 ml-1"></i>${escapeHtml(f.userId)}</span>
            <span class="text-gray-400 text-[10px]">${f.muted ? 'مكتوم' : 'نشط'}</span>
          </div>`;
        }
        list += '</div>';
      }

      return `<div class="flex gap-2 mb-3">
        <button type="button" id="collabFollowBtn" class="px-2.5 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"><i class="fas fa-user-plus ml-1"></i>متابعة السجل</button>
        <button type="button" id="collabUnfollowBtn" class="px-2.5 py-1 bg-gray-200 text-gray-700 rounded text-xs hover:bg-gray-300"><i class="fas fa-user-minus ml-1"></i>إلغاء المتابعة</button>
      </div>
      ${list}`;
    }

    renderActivitiesTab() {
      let list = '';
      if (!this.activities.length) {
        list = `<p class="text-xs text-gray-400 py-3 text-center">لا توجد أنشطة مسندة على هذا السجل</p>`;
      } else {
        list = '<div class="space-y-2 mb-3 max-h-56 overflow-y-auto">';
        for (const a of this.activities) {
          const isDone = a.status === 'done';
          list += `<div class="p-2 border rounded ${isDone ? 'bg-gray-100 opacity-75' : 'bg-yellow-50 border-yellow-200'} text-xs flex justify-between items-center">
            <div>
              <span class="font-bold text-gray-800">${escapeHtml(a.summaryAr)}</span>
              <div class="text-[10px] text-gray-500">نوع: ${escapeHtml(a.kind)} | مكلف: ${escapeHtml(a.assigneeId || 'الكل')}</div>
            </div>
            ${!isDone ? `<button type="button" data-complete-act="${escapeHtml(a.id)}" class="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px]">إكمال</button>` : `<span class="text-green-600 font-bold text-[10px]">مكتمل</span>`}
          </div>`;
        }
        list += '</div>';
      }

      return `${list}
      <div class="mt-2 pt-2 border-t text-xs">
        <div class="font-medium mb-1">إضافة نشاط جديد:</div>
        <div class="flex gap-2 mb-2">
          <input type="text" id="collabActSummary" class="flex-1 p-1 border rounded" placeholder="ملخص النشاط المطلوب..." />
          <select id="collabActKind" class="p-1 border rounded">
            <option value="todo">مهمة</option>
            <option value="call">اتصال</option>
            <option value="meeting">اجتماع</option>
          </select>
        </div>
        <button type="button" id="collabCreateActBtn" class="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium"><i class="fas fa-plus ml-1"></i>إضافة نشاط</button>
      </div>`;
    }

    renderHistoryTab() {
      if (!this.history.length) {
        return `<p class="text-xs text-gray-400 py-3 text-center">لا يوجد سجل تغييرات للحقول المتبعة</p>`;
      }
      let html = '<div class="space-y-1.5 max-h-64 overflow-y-auto text-xs">';
      for (const h of this.history) {
        html += `<div class="p-1.5 border-b flex justify-between items-center">
          <div>
            <span class="font-medium text-gray-700">${escapeHtml(h.field)}</span>: 
            <span class="text-red-500 line-through">${escapeHtml(h.old_value || 'لاشيء')}</span> &rarr; 
            <span class="text-green-600 font-semibold">${escapeHtml(h.new_value || 'لاشيء')}</span>
          </div>
          <span class="text-[10px] text-gray-400">${escapeHtml(h.actor_id)} (${escapeHtml(h.occurred_at ? h.occurred_at.slice(0, 16) : '')})</span>
        </div>`;
      }
      return html + '</div>';
    }

    renderSnapshotsTab() {
      if (!this.snapshots.length) {
        return `<p class="text-xs text-gray-400 py-3 text-center">لا توجد لقطات موثقة لهذا السجل</p>`;
      }
      let html = '<div class="space-y-2 max-h-64 overflow-y-auto text-xs">';
      for (const s of this.snapshots) {
        html += `<div class="p-2 border rounded bg-gray-50 flex justify-between items-center">
          <div>
            <div class="font-bold text-gray-800">سبب اللقطة: ${escapeHtml(s.reason)}</div>
            <div class="text-[10px] text-gray-500">إصدار السجل: v${escapeHtml(s.recordVersion)} | التوثيق: ${escapeHtml(s.takenAt ? s.takenAt.slice(0, 16) : '')}</div>
          </div>
          <span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-mono text-[10px]">مُصانة غير قابلة للتغيير</span>
        </div>`;
      }
      return html + '</div>';
    }

    renderLineageTab() {
      if (!this.lineage.length) {
        return `<p class="text-xs text-gray-400 py-3 text-center">لا توجد روابط تسلسل موثقة لهذا السجل</p>`;
      }
      let html = '<div class="space-y-2 max-h-64 overflow-y-auto text-xs">';
      for (const l of this.lineage) {
        html += `<div class="p-2 border rounded bg-blue-50/50 flex justify-between items-center">
          <div>
            <span class="font-semibold text-blue-800">${escapeHtml(l.relation)}</span>: ${escapeHtml(l.related_entity)} #${escapeHtml(l.related_record_id)}
            ${l.reason ? `<div class="text-[10px] text-gray-500">السبب: ${escapeHtml(l.reason)}</div>` : ''}
          </div>
        </div>`;
      }
      return html + '</div>';
    }
  }

  root.OctagonCollaborationPanel = OctagonCollaborationPanel;
})(typeof window !== 'undefined' ? window : globalThis);
