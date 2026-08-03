(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  if (!root) return;

  async function executeAction(actionId, payload) {
    const api = root.Build10Api;
    const ctx = api ? api.getContext() : {};
    const url = `/api/v1/action/${actionId}`;
    const headers = {
      'content-type': 'application/json',
      'x-company': ctx.companyId,
      'x-warehouse': ctx.warehouseId,
      'x-branch': ctx.branchId,
      'x-user': ctx.userId
    };

    const body = {
      idempotency_key: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...payload
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
      }
      return data.data;
    } catch (err) {
      throw err;
    }
  }

  function openActionModal(actionId, defaultValues = {}, onSuccess = null) {
    const formsModule = root.Build10Forms;
    const formDef = formsModule ? formsModule.getForm(actionId) : null;
    const isRtl = document.documentElement.dir === 'rtl';

    let overlay = document.getElementById('b10-action-dialog-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'b10-action-dialog-overlay';
      overlay.className = 'b10-dialog-overlay';
      document.body.appendChild(overlay);
    }

    const title = formDef ? (isRtl ? formDef.titleAr : formDef.titleEn) : actionId;
    const fieldsHtml = (formDef?.fields || []).map(f => {
      const val = defaultValues[f.name] !== undefined ? defaultValues[f.name] : (f.default || '');
      const label = isRtl ? f.labelAr : f.labelEn;
      if (f.type === 'select') {
        const opts = (f.options || []).map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
        return `<div class="b10-form-group"><label>${label}</label><select name="${f.name}">${opts}</select></div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="b10-form-group"><label>${label}</label><textarea name="${f.name}">${val}</textarea></div>`;
      }
      return `<div class="b10-form-group"><label>${label}</label><input type="${f.type || 'text'}" name="${f.name}" value="${val}" ${f.required ? 'required' : ''}></div>`;
    }).join('');

    overlay.innerHTML = `
      <div class="b10-dialog-card" id="build10ActionDialog">
        <div class="b10-dialog-header">
          <h3>${title}</h3>
          <button type="button" class="b10-dialog-close" onclick="document.getElementById('b10-action-dialog-overlay').style.display='none'">&times;</button>
        </div>
        <form id="b10-action-form">
          <div class="b10-dialog-body">
            ${fieldsHtml || `<p style="color:#94a3b8;">${isRtl ? 'تأكيد تنفيذ الإجراء' : 'Confirm action execution'}: <code>${actionId}</code></p>`}
            <div id="b10-action-error" class="b10-dialog-error" style="display:none;color:#f87171;margin-top:0.5rem;"></div>
          </div>
          <div class="b10-dialog-footer">
            <button type="button" class="b10-btn b10-btn-secondary" onclick="document.getElementById('b10-action-dialog-overlay').style.display='none'">${isRtl ? 'إلغاء' : 'Cancel'}</button>
            <button type="submit" class="b10-btn b10-btn-primary" data-action="${actionId}">${isRtl ? 'تنفيذ الإجراء' : 'Execute Action'}</button>
          </div>
        </form>
      </div>
    `;

    overlay.style.display = 'flex';

    const form = document.getElementById('b10-action-form');
    form.onsubmit = async (evt) => {
      evt.preventDefault();
      const errBox = document.getElementById('b10-action-error');
      errBox.style.display = 'none';
      const formData = new FormData(form);
      const payload = {};
      for (const [k, v] of formData.entries()) {
        payload[k] = v;
      }

      try {
        await executeAction(actionId, payload);
        overlay.style.display = 'none';
        if (typeof onSuccess === 'function') onSuccess();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    };
  }

  root.Build10Actions = {
    executeAction,
    openActionModal
  };
})();
