(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Integration Hub — governed section upgrade (FP-2G).
  //
  // The existing integration_hub page (WhatsApp/email/webhooks/service
  // health, rendered by legacy modules) stays exactly as it is. This module
  // UPGRADES it by appending one governed section reading the canonical
  // control-plane resources (SSO integrations, API keys, background jobs).
  // No plaintext secrets: the api-keys resource exposes prefixes only.
  // ---------------------------------------------------------------------

  const SECTION_ID = 'integrationHubGovernedSection';

  function kit() { return root.OctagonPageKit; }

  async function apiQuery(resource) {
    const res = await fetch(`/api/v1/control-plane/${resource}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.data || [];
  }

  function renderSection({ integrations, apiKeys, jobs }) {
    const k = kit();
    if (!k) return '';
    return `
      <div class="mt-8 border-t border-slate-200 pt-6" dir="rtl">
        ${k.renderHeader({
          title: 'التكاملات المحكومة',
          subtitle: 'مزودو الدخول الموحد، مفاتيح API (بادئات فقط)، والمهام الخلفية — من سطح التحكم المرجعي',
          actionsHtml: '',
        })}
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          <div>
            <h3 class="text-sm font-semibold text-slate-600 mb-2">مزودو الدخول الموحد (${integrations.length})</h3>
            ${k.renderTable({
              columns: [
                { key: 'name', title: 'المزود', render: row => k.esc(row.name) },
                { key: 'kind', title: 'النوع', render: row => k.bidi(row.kind) },
                { key: 'status', title: 'الحالة', render: row => k.renderStatusBadge(row.status, row.status === 'active' ? 'active' : 'inactive') },
              ],
              rows: integrations,
              emptyTitle: 'لا يوجد مزودون',
            })}
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-600 mb-2">مفاتيح API (${apiKeys.length})</h3>
            ${k.renderTable({
              columns: [
                { key: 'label', title: 'الوصف', render: row => k.esc(row.label || '—') },
                { key: 'prefix', title: 'البادئة', render: row => k.bidi(row.prefix) },
                { key: 'status', title: 'الحالة', render: row => k.renderStatusBadge(row.revoked_at ? 'ملغى' : 'نشط', row.revoked_at ? 'inactive' : 'active') },
              ],
              rows: apiKeys,
              emptyTitle: 'لا توجد مفاتيح',
            })}
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-600 mb-2">المهام الخلفية (${jobs.length})</h3>
            ${k.renderTable({
              columns: [
                { key: 'name', title: 'المهمة', render: row => k.esc(row.name) },
                { key: 'enabled', title: 'الحالة', render: row => k.renderStatusBadge(row.enabled ? 'مفعّلة' : 'معطّلة', row.enabled ? 'active' : 'inactive') },
              ],
              rows: jobs,
              emptyTitle: 'لا توجد مهام',
            })}
          </div>
        </div>
      </div>
    `;
  }

  async function appendGovernedSection() {
    const host = document.getElementById('integrationHubBody');
    if (!host || document.getElementById(SECTION_ID)) return;
    const holder = document.createElement('div');
    holder.id = SECTION_ID;
    try {
      const [integrations, apiKeys, jobs] = await Promise.all([
        apiQuery('integrations'),
        apiQuery('api-keys'),
        apiQuery('jobs'),
      ]);
      holder.innerHTML = renderSection({ integrations, apiKeys, jobs });
      host.appendChild(holder);
    } catch (err) {
      // The legacy hub must never break because the governed section failed —
      // render the failure inside the section instead of swallowing it.
      // textContent (not innerHTML) keeps any error text injection-safe.
      const wrapper = document.createElement('div');
      wrapper.className = 'mt-8 border-t border-slate-200 pt-6 text-sm text-rose-600';
      wrapper.dir = 'rtl';
      wrapper.textContent = `تعذر تحميل التكاملات المحكومة: ${String(err.message || err)}`;
      holder.appendChild(wrapper);
      host.appendChild(holder);
    }
  }

  // The legacy hub is activated through the classic switchPage path, so wrap
  // it: after the original activation settles, append our section once.
  const original = root.switchPage;
  if (typeof original === 'function' && !root.__fpcIntegrationHubWrapped) {
    root.switchPage = function (page) {
      const result = original.apply(this, arguments);
      if (page === 'integration_hub') {
        const attempt = () => {
          if (document.getElementById('integrationHubBody')) appendGovernedSection();
          else setTimeout(attempt, 150);
        };
        attempt();
      }
      return result;
    };
    root.__fpcIntegrationHubWrapped = true;
  }
})(typeof window !== 'undefined' ? window : globalThis);
