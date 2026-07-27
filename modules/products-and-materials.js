// Products & Materials Client Module
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let productsData = [];
  let categoriesData = [];
  let uomsData = [];

  window.initProductsAndMaterialsModule = async function () {
    const refreshBtn = document.getElementById('pmRefreshBtn');
    const createBtn = document.getElementById('pmCreateBtn');
    const searchInput = document.getElementById('pmSearchInput');
    const categoryFilter = document.getElementById('pmCategoryFilter');
    const typeFilter = document.getElementById('pmTypeFilter');
    const uomFilter = document.getElementById('pmUomFilter');
    const includeArchived = document.getElementById('pmIncludeArchived');
    const form = document.getElementById('pmProductForm');

    if (refreshBtn) refreshBtn.onclick = () => loadData();
    if (createBtn) createBtn.onclick = () => openPmProductModal();
    if (searchInput) searchInput.oninput = () => renderProducts();
    if (categoryFilter) categoryFilter.onchange = () => renderProducts();
    if (typeFilter) typeFilter.onchange = () => renderProducts();
    if (uomFilter) uomFilter.onchange = () => renderProducts();
    if (includeArchived) includeArchived.onchange = () => loadData();
    if (form) form.onsubmit = (e) => handleProductFormSubmit(e);

    await loadData();
  };

  async function loadData() {
    const banner = document.getElementById('pmStateBanner');
    const tbody = document.getElementById('pmProductsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل المنتجات والمواد...</td></tr>';

    try {
      const client = window.CanonicalClient;
      if (!client) throw new Error('CanonicalClient unavailable');

      const incArchived = document.getElementById('pmIncludeArchived')?.checked ? 'true' : 'false';

      // Load products, categories, uoms in parallel
      const [prodRes, catRes, uomRes] = await Promise.all([
        client.get(`/api/v1/commercial/products?include_archived=${incArchived}`),
        client.get('/api/v1/commercial/product_categories'),
        client.get('/api/v1/commercial/uoms')
      ]);

      productsData = prodRes?.data || [];
      categoriesData = catRes?.data || [];
      uomsData = uomRes?.data || [];

      populateDropdowns();
      renderProducts();
      if (banner) banner.innerHTML = '';
    } catch (err) {
      if (banner) {
        banner.innerHTML = `<div class="alert alert-danger" style="margin-bottom:15px;"><i class="fa-solid fa-triangle-exclamation"></i> خطأ في تحميل البيانات: ${escapeHtml(err.message)}</div>`;
      }
      if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#f87171; padding:20px;">تعذر تحميل المنتجات: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function populateDropdowns() {
    const categoryFilter = document.getElementById('pmCategoryFilter');
    const uomFilter = document.getElementById('pmUomFilter');
    const formCat = document.getElementById('pmFormCategory');
    const formUom = document.getElementById('pmFormUom');
    const formPurUom = document.getElementById('pmFormPurchaseUom');

    if (categoryFilter) {
      categoryFilter.innerHTML = '<option value="">جميع الفئات All Categories</option>' +
        categoriesData.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
    if (uomFilter) {
      uomFilter.innerHTML = '<option value="">جميع وحدات القياس All UOMs</option>' +
        uomsData.map(u => `<option value="${u.id}">${u.name} (${u.symbol || u.name})</option>`).join('');
    }
    if (formCat) {
      formCat.innerHTML = '<option value="">اختر الفئة Select Category...</option>' +
        categoriesData.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
    if (formUom) {
      formUom.innerHTML = '<option value="">اختر وحدة القياس Select UOM...</option>' +
        uomsData.map(u => `<option value="${u.id}">${u.name} (${u.symbol || u.name})</option>`).join('');
    }
    if (formPurUom) {
      formPurUom.innerHTML = '<option value="">نفس الوحدة الأساسية (افتراضي)</option>' +
        uomsData.map(u => `<option value="${u.id}">${u.name} (${u.symbol || u.name})</option>`).join('');
    }
  }

  function renderProducts() {
    const tbody = document.getElementById('pmProductsTableBody');
    if (!tbody) return;

    const search = (document.getElementById('pmSearchInput')?.value || '').toLowerCase().trim();
    const catId = document.getElementById('pmCategoryFilter')?.value;
    const typeVal = document.getElementById('pmTypeFilter')?.value;
    const uomId = document.getElementById('pmUomFilter')?.value;

    const filtered = productsData.filter(p => {
      if (catId && p.category_id !== catId) return false;
      if (typeVal && p.type !== typeVal) return false;
      if (uomId && p.uom_id !== uomId) return false;
      if (search) {
        const matchName = (p.name || '').toLowerCase().includes(search) || (p.name_ar || '').toLowerCase().includes(search);
        const matchSku = (p.sku || p.code || '').toLowerCase().includes(search);
        const matchBarcode = (p.barcode || '').toLowerCase().includes(search);
        if (!matchName && !matchSku && !matchBarcode) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-inbox" style="font-size:2rem; margin-bottom:10px; display:block;"></i>لا توجد منتجات أو مواد مطابقة للبحث</td></tr>';
      return;
    }

    const typeLabels = { storable: 'مخزني Storable', consumable: 'استهلاكي Consumable', service: 'خدمة Service' };

    tbody.innerHTML = filtered.map(p => {
      const isArchived = p.is_active === 0 || p.variant_active === 0;
      const statusBadge = isArchived
        ? '<span class="badge bg-secondary">مؤرشف Archived</span>'
        : '<span class="badge bg-success" style="background:rgba(34,197,94,0.2); color:#4ade80; padding:4px 8px; border-radius:4px;">نشط Active</span>';

      const typeBadge = `<span class="badge" style="background:rgba(99,102,241,0.2); color:#a5b4fc; padding:4px 8px; border-radius:4px;">${typeLabels[p.type] || p.type}</span>`;

      return `
        <tr style="${isArchived ? 'opacity:0.6;' : ''}">
          <td><strong>${p.sku || p.code || '-'}</strong></td>
          <td>${p.barcode || '-'}</td>
          <td>
            <div style="font-weight:600; color:#f8fafc;">${p.name_ar || p.name}</div>
            ${p.name_en && p.name_en !== p.name_ar ? `<small style="color:#94a3b8;">${p.name_en}</small>` : ''}
          </td>
          <td>${p.category_name || '-'}</td>
          <td>${typeBadge}</td>
          <td>${p.uom_name || '-'}</td>
          <td style="font-family:var(--font-en); font-weight:600;">${Number(p.standard_price || 0).toLocaleString()} IQD</td>
          <td style="font-family:var(--font-en); font-weight:600; color:#67e8f9;">0.00</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-secondary" onclick="editPmProduct('${p.id || p.variant_id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
              ${isArchived
                ? `<button class="btn btn-sm btn-success" onclick="restorePmProduct('${p.id}')" title="استعادة"><i class="fa-solid fa-rotate-left"></i></button>`
                : `<button class="btn btn-sm btn-danger" onclick="archivePmProduct('${p.id}')" title="أرشفة"><i class="fa-solid fa-box-archive"></i></button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openPmProductModal = function (product = null) {
    const modal = document.getElementById('pmProductModal');
    const title = document.getElementById('pmModalTitle');
    const form = document.getElementById('pmProductForm');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('pmFormProductId').value = '';

    if (product) {
      title.innerText = 'تعديل بيانات المنتج / المادة';
      document.getElementById('pmFormProductId').value = product.id;
      document.getElementById('pmFormNameAr').value = product.name_ar || product.name || '';
      document.getElementById('pmFormNameEn').value = product.name_en || '';
      document.getElementById('pmFormSku').value = product.sku || product.code || '';
      document.getElementById('pmFormBarcode').value = product.barcode || '';
      document.getElementById('pmFormCategory').value = product.category_id || '';
      document.getElementById('pmFormType').value = product.type || 'storable';
      document.getElementById('pmFormUom').value = product.uom_id || '';
      document.getElementById('pmFormPurchaseUom').value = product.purchase_uom_id || '';
      document.getElementById('pmFormListPrice').value = product.list_price || 0;
      document.getElementById('pmFormStandardPrice').value = product.standard_price || 0;
      document.getElementById('pmFormTracking').value = product.tracking_type || 'none';
      document.getElementById('pmFormDescription').value = product.description || '';
    } else {
      title.innerText = 'إضافة منتج / مادة جديدة';
    }

    modal.style.display = 'flex';
  };

  window.closePmProductModal = function () {
    const modal = document.getElementById('pmProductModal');
    if (modal) modal.style.display = 'none';
  };

  window.editPmProduct = function (id) {
    const prod = productsData.find(p => p.id === id || p.variant_id === id);
    if (prod) openPmProductModal(prod);
  };

  async function handleProductFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('pmSaveSubmitBtn');
    if (btn) btn.disabled = true;

    try {
      const client = window.CanonicalClient;
      const id = document.getElementById('pmFormProductId').value;
      const name_ar = document.getElementById('pmFormNameAr').value;
      const name_en = document.getElementById('pmFormNameEn').value;
      const sku = document.getElementById('pmFormSku').value;
      const barcode = document.getElementById('pmFormBarcode').value;
      const category_id = document.getElementById('pmFormCategory').value;
      const type = document.getElementById('pmFormType').value;
      const uom_id = document.getElementById('pmFormUom').value;
      const purchase_uom_id = document.getElementById('pmFormPurchaseUom').value;
      const list_price = parseFloat(document.getElementById('pmFormListPrice').value || 0);
      const standard_price = parseFloat(document.getElementById('pmFormStandardPrice').value || 0);
      const tracking_type = document.getElementById('pmFormTracking').value;
      const description = document.getElementById('pmFormDescription').value;

      const payload = {
        name: name_ar,
        name_ar,
        name_en,
        code: sku,
        sku,
        barcode,
        category_id,
        type,
        uom_id,
        purchase_uom_id: purchase_uom_id || uom_id,
        list_price,
        standard_price,
        tracking_type,
        description
      };

      if (id) {
        payload.id = id;
        await client.post('/api/v1/action/product:update', payload);
      } else {
        await client.post('/api/v1/action/product:create', payload);
      }

      closePmProductModal();
      await loadData();
    } catch (err) {
      alert(`خطأ في تنفيذ العملية: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.archivePmProduct = async function (id) {
    if (!confirm('هل أنت تأكد من أرشفة هذا المنتج؟')) return;
    try {
      await window.CanonicalClient.post('/api/v1/action/product:archive', { id });
      await loadData();
    } catch (err) {
      alert(`فشل الأرشفة: ${err.message}`);
    }
  };

  window.restorePmProduct = async function (id) {
    try {
      await window.CanonicalClient.post('/api/v1/action/product:restore', { id });
      await loadData();
    } catch (err) {
      alert(`فشل الاستعادة: ${err.message}`);
    }
  };

  function wireSwitch() {
    if (window.__pmWrapped || typeof window.switchPage !== 'function') return;
    const orig = window.switchPage;
    window.switchPage = function (page) {
      const res = orig.apply(this, arguments);
      if (page === 'products') {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
        const pg = document.getElementById('pageProductsAndMaterials');
        if (pg) pg.classList.add('page-active');
        if (typeof window.initProductsAndMaterialsModule === 'function') {
          window.initProductsAndMaterialsModule().catch(() => {});
        }
      }
      return res;
    };
    window.__pmWrapped = true;
  }
  wireSwitch();
})();
