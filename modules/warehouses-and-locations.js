// Warehouses & Locations Client Module
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let warehousesData = [];
  let locationsData = [];

  window.initWarehousesAndLocationsModule = async function () {
    // Warehouses controls
    const whRefreshBtn = document.getElementById('whRefreshBtn');
    const whCreateBtn = document.getElementById('whCreateBtn');
    const whForm = document.getElementById('whWarehouseForm');

    if (whRefreshBtn) whRefreshBtn.onclick = () => loadWarehouses();
    if (whCreateBtn) whCreateBtn.onclick = () => openWhModal();
    if (whForm) whForm.onsubmit = (e) => handleWarehouseSubmit(e);

    // Locations controls
    const locRefreshBtn = document.getElementById('locRefreshBtn');
    const locCreateBtn = document.getElementById('locCreateBtn');
    const locWhFilter = document.getElementById('locWarehouseFilter');
    const locUsageFilter = document.getElementById('locUsageFilter');
    const locForm = document.getElementById('locLocationForm');

    if (locRefreshBtn) locRefreshBtn.onclick = () => loadLocations();
    if (locCreateBtn) locCreateBtn.onclick = () => openLocModal();
    if (locWhFilter) locWhFilter.onchange = () => renderLocations();
    if (locUsageFilter) locUsageFilter.onchange = () => renderLocations();
    if (locForm) locForm.onsubmit = (e) => handleLocationSubmit(e);

    await Promise.all([loadWarehouses(), loadLocations()]);
  };

  async function loadWarehouses() {
    const tbody = document.getElementById('whWarehousesTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل المستودعات...</td></tr>';

    try {
      const client = window.CanonicalClient;
      if (!client) throw new Error('CanonicalClient unavailable');

      const res = await client.get('/api/v1/inventory/warehouses');
      warehousesData = res?.data || [];
      renderWarehouses();
      populateWarehouseDropdowns();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#f87171; padding:20px;">تعذر تحميل المستودعات: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderWarehouses() {
    const tbody = document.getElementById('whWarehousesTableBody');
    if (!tbody) return;

    if (warehousesData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-warehouse" style="font-size:2rem; margin-bottom:10px; display:block;"></i>لا توجد مستودعات مسجلة</td></tr>';
      return;
    }

    tbody.innerHTML = warehousesData.map(w => `
      <tr>
        <td><strong style="font-family:var(--font-en); color:#67e8f9;">${escapeHtml(w.code)}</strong></td>
        <td><span style="font-weight:600; color:#f8fafc;">${escapeHtml(w.name)}</span></td>
        <td>${escapeHtml(w.branch_name || w.branch_id || '-')}</td>
        <td><span class="badge" style="background:rgba(99,102,241,0.2); color:#a5b4fc; padding:4px 8px; border-radius:4px;">${escapeHtml(w.warehouse_type || 'physical')}</span></td>
        <td style="font-size:0.8rem; color:#94a3b8;">${escapeHtml(w.view_location_id || '-')}</td>
        <td style="font-size:0.8rem; color:#94a3b8;">${escapeHtml(w.lot_stock_id || '-')}</td>
        <td>${w.is_default ? '<span class="badge bg-success" style="background:rgba(34,197,94,0.2); color:#4ade80; padding:3px 6px; border-radius:4px;">نعم Default</span>' : 'لا'}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editWarehouse('${escapeHtml(w.id)}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
        </td>
      </tr>
    `).join('');
  }

  function populateWarehouseDropdowns() {
    const locWhFilter = document.getElementById('locWarehouseFilter');
    const locFormWh = document.getElementById('locFormWarehouse');

    if (locWhFilter) {
      locWhFilter.innerHTML = '<option value="">جميع المستودعات All Warehouses</option>' +
        warehousesData.map(w => `<option value="${escapeHtml(w.id)}">[${escapeHtml(w.code)}] ${escapeHtml(w.name)}</option>`).join('');
    }
    if (locFormWh) {
      locFormWh.innerHTML = '<option value="">بدون ربط بمستودع Not linked</option>' +
        warehousesData.map(w => `<option value="${escapeHtml(w.id)}">[${escapeHtml(w.code)}] ${escapeHtml(w.name)}</option>`).join('');
    }
  }

  async function loadLocations() {
    const tbody = document.getElementById('locLocationsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل مواقع المخزون...</td></tr>';

    try {
      const client = window.CanonicalClient;
      if (!client) throw new Error('CanonicalClient unavailable');

      const res = await client.get('/api/v1/inventory/locations');
      locationsData = res?.data || [];
      renderLocations();
      populateLocationParents();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#f87171; padding:20px;">تعذر تحميل المواقع: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderLocations() {
    const tbody = document.getElementById('locLocationsTableBody');
    if (!tbody) return;

    const whId = document.getElementById('locWarehouseFilter')?.value;
    const usageVal = document.getElementById('locUsageFilter')?.value;

    const filtered = locationsData.filter(l => {
      if (whId && l.warehouse_id !== whId) return false;
      if (usageVal && l.usage !== usageVal) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-sitemap" style="font-size:2rem; margin-bottom:10px; display:block;"></i>لا توجد مواقع مخزونية مطابقة للفلتر</td></tr>';
      return;
    }

    const usageColors = {
      internal: 'background:rgba(59,130,246,0.2); color:#60a5fa;',
      view: 'background:rgba(168,85,247,0.2); color:#c084fc;',
      customer: 'background:rgba(34,197,94,0.2); color:#4ade80;',
      supplier: 'background:rgba(245,158,11,0.2); color:#fbbf24;',
      inventory: 'background:rgba(239,68,68,0.2); color:#fca5a5;',
      production: 'background:rgba(14,165,233,0.2); color:#38bdf8;',
      scrap: 'background:rgba(225,29,72,0.2); color:#fda4af;',
      transit: 'background:rgba(107,114,128,0.2); color:#9ca3af;'
    };

    tbody.innerHTML = filtered.map(l => `
      <tr>
        <td style="font-family:var(--font-en); font-weight:600; color:#67e8f9;">${l.complete_path || l.path || l.name}</td>
        <td><strong style="color:#f8fafc;">${l.name}</strong></td>
        <td style="font-size:0.8rem; color:#94a3b8;">${l.parent_name || l.parent_id || '-'}</td>
        <td><span class="badge" style="${usageColors[l.usage] || ''} padding:4px 8px; border-radius:4px;">${l.usage}</span></td>
        <td style="font-size:0.85rem;">${l.capacity || '-'}</td>
        <td><span class="badge bg-success" style="background:rgba(34,197,94,0.2); color:#4ade80; padding:3px 6px; border-radius:4px;">نشط Active</span></td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="editLocation('${l.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
        </td>
      </tr>
    `).join('');
  }

  function populateLocationParents() {
    const parentSelect = document.getElementById('locFormParent');
    if (parentSelect) {
      parentSelect.innerHTML = '<option value="">بدون موقع أب (جذر Root)</option>' +
        locationsData.map(l => `<option value="${l.id}">${l.complete_path || l.path || l.name}</option>`).join('');
    }
  }

  // Modals & Form Actions
  window.openWhModal = function (wh = null) {
    const modal = document.getElementById('whWarehouseModal');
    const form = document.getElementById('whWarehouseForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('whFormId').value = '';

    if (wh) {
      document.getElementById('whModalTitle').innerText = 'تعديل المستودع';
      document.getElementById('whFormId').value = wh.id;
      document.getElementById('whFormName').value = wh.name || '';
      document.getElementById('whFormCode').value = wh.code || '';
      document.getElementById('whFormType').value = wh.warehouse_type || 'physical';
      document.getElementById('whFormIsDefault').checked = !!wh.is_default;
    } else {
      document.getElementById('whModalTitle').innerText = 'إضافة مستودع جديد';
    }
    modal.style.display = 'flex';
  };

  window.closeWhModal = function () {
    const modal = document.getElementById('whWarehouseModal');
    if (modal) modal.style.display = 'none';
  };

  window.editWarehouse = function (id) {
    const wh = warehousesData.find(w => w.id === id);
    if (wh) openWhModal(wh);
  };

  async function handleWarehouseSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('whSaveSubmitBtn');
    if (btn) btn.disabled = true;

    try {
      const client = window.CanonicalClient;
      const id = document.getElementById('whFormId').value;
      const name = document.getElementById('whFormName').value;
      const code = document.getElementById('whFormCode').value;
      const warehouse_type = document.getElementById('whFormType').value;
      const is_default = document.getElementById('whFormIsDefault').checked ? 1 : 0;

      const payload = { name, code, warehouse_type, is_default };
      if (id) {
        payload.id = id;
        await client.post('/api/v1/action/warehouse:update', payload);
      } else {
        await client.post('/api/v1/action/warehouse:create', payload);
      }

      closeWhModal();
      await loadWarehouses();
      await loadLocations();
    } catch (err) {
      alert(`خطأ: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.openLocModal = function (loc = null) {
    const modal = document.getElementById('locLocationModal');
    const form = document.getElementById('locLocationForm');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('locFormId').value = '';

    if (loc) {
      document.getElementById('locModalTitle').innerText = 'تعديل موقع المخزون';
      document.getElementById('locFormId').value = loc.id;
      document.getElementById('locFormName').value = loc.name || '';
      document.getElementById('locFormParent').value = loc.parent_id || '';
      document.getElementById('locFormUsage').value = loc.usage || 'internal';
      document.getElementById('locFormWarehouse').value = loc.warehouse_id || '';
    } else {
      document.getElementById('locModalTitle').innerText = 'إضافة موقع جديد';
    }
    modal.style.display = 'flex';
  };

  window.closeLocModal = function () {
    const modal = document.getElementById('locLocationModal');
    if (modal) modal.style.display = 'none';
  };

  window.editLocation = function (id) {
    const loc = locationsData.find(l => l.id === id);
    if (loc) openLocModal(loc);
  };

  async function handleLocationSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('locSaveSubmitBtn');
    if (btn) btn.disabled = true;

    try {
      const client = window.CanonicalClient;
      const id = document.getElementById('locFormId').value;
      const name = document.getElementById('locFormName').value;
      const parent_id = document.getElementById('locFormParent').value || null;
      const usage = document.getElementById('locFormUsage').value;
      const warehouse_id = document.getElementById('locFormWarehouse').value || null;

      const payload = { name, parent_id, usage, warehouse_id };
      if (id) {
        payload.id = id;
        await client.post('/api/v1/action/stock:location:update', payload);
      } else {
        await client.post('/api/v1/action/stock:location:create', payload);
      }

      closeLocModal();
      await loadLocations();
    } catch (err) {
      alert(`خطأ: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireSwitch() {
    if (window.__wlWrapped || typeof window.switchPage !== 'function') return;
    const orig = window.switchPage;
    window.switchPage = function (page) {
      const res = orig.apply(this, arguments);
      if (page === 'warehouses' || page === 'locations') {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
        const pg = document.getElementById('pageWarehouses');
        if (pg) pg.classList.add('page-active');
        if (typeof window.initWarehousesAndLocationsModule === 'function') {
          window.initWarehousesAndLocationsModule().catch(() => {});
        }
      }
      return res;
    };
    window.__wlWrapped = true;
  }
  wireSwitch();
})();
