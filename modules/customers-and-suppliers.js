// Customers & Suppliers Client Module
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let partiesData = [];

  window.initCustomersAndSuppliersModule = async function () {
    const refreshBtn = document.getElementById('csRefreshBtn');
    const createBtn = document.getElementById('csCreateBtn');
    const searchInput = document.getElementById('csSearchInput');
    const roleFilter = document.getElementById('csRoleFilter');
    const companyTypeFilter = document.getElementById('csCompanyTypeFilter');
    const includeArchived = document.getElementById('csIncludeArchived');
    const form = document.getElementById('csPartyForm');

    if (refreshBtn) refreshBtn.onclick = () => loadData();
    if (createBtn) createBtn.onclick = () => openCsPartyModal();
    if (searchInput) searchInput.oninput = () => renderParties();
    if (roleFilter) roleFilter.onchange = () => renderParties();
    if (companyTypeFilter) companyTypeFilter.onchange = () => renderParties();
    if (includeArchived) includeArchived.onchange = () => loadData();
    if (form) form.onsubmit = (e) => handlePartyFormSubmit(e);

    await loadData();
  };

  async function loadData() {
    const banner = document.getElementById('csStateBanner');
    const tbody = document.getElementById('csPartiesTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل دليل الأطراف التجارية...</td></tr>';

    try {
      const client = window.CanonicalClient;
      if (!client) throw new Error('CanonicalClient unavailable');

      const incArchived = document.getElementById('csIncludeArchived')?.checked ? 'true' : 'false';
      const res = await client.get(`/api/v1/commercial/parties?include_archived=${incArchived}`);

      partiesData = res?.data || [];
      renderParties();
      if (banner) banner.innerHTML = '';
    } catch (err) {
      if (banner) {
        banner.innerHTML = `<div class="alert alert-danger" style="margin-bottom:15px;"><i class="fa-solid fa-triangle-exclamation"></i> خطأ في تحميل البيانات: ${escapeHtml(err.message)}</div>`;
      }
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:#f87171; padding:20px;">تعذر تحميل الأطراف: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderParties() {
    const tbody = document.getElementById('csPartiesTableBody');
    if (!tbody) return;

    const search = (document.getElementById('csSearchInput')?.value || '').toLowerCase().trim();
    const roleVal = document.getElementById('csRoleFilter')?.value;
    const companyTypeVal = document.getElementById('csCompanyTypeFilter')?.value;

    const filtered = partiesData.filter(p => {
      const roles = p.roles || [];
      if (roleVal === 'customer' && !roles.includes('customer')) return false;
      if (roleVal === 'supplier' && !roles.includes('supplier')) return false;
      if (roleVal === 'dual' && (!roles.includes('customer') || !roles.includes('supplier'))) return false;

      if (companyTypeVal === 'company' && !p.is_company) return false;
      if (companyTypeVal === 'individual' && p.is_company) return false;

      if (search) {
        const matchName = (p.name || '').toLowerCase().includes(search) || (p.legal_name || '').toLowerCase().includes(search);
        const matchTax = (p.tax_id || '').toLowerCase().includes(search);
        const matchReg = (p.registration_number || '').toLowerCase().includes(search);
        const matchContact = (p.phone || '').toLowerCase().includes(search) || (p.email || '').toLowerCase().includes(search);
        if (!matchName && !matchTax && !matchReg && !matchContact) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:#94a3b8;"><i class="fa-solid fa-users-slash" style="font-size:2rem; margin-bottom:10px; display:block;"></i>لا توجد أطراف تجارية مطابقة للبحث</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(p => {
      const isArchived = p.status === 'archived';
      const statusBadge = isArchived
        ? '<span class="badge bg-secondary">مؤرشف Archived</span>'
        : '<span class="badge bg-success" style="background:rgba(34,197,94,0.2); color:#4ade80; padding:4px 8px; border-radius:4px;">نشط Active</span>';

      const roles = p.roles || [];
      const roleBadges = roles.map(r => {
        if (r === 'customer') return '<span class="badge" style="background:rgba(59,130,246,0.2); color:#60a5fa; padding:3px 6px; border-radius:4px; margin-left:4px;">عميل</span>';
        if (r === 'supplier') return '<span class="badge" style="background:rgba(168,85,247,0.2); color:#c084fc; padding:3px 6px; border-radius:4px; margin-left:4px;">مورد</span>';
        return `<span class="badge bg-secondary" style="margin-left:4px;">${r}</span>`;
      }).join('');

      return `
        <tr style="${isArchived ? 'opacity:0.6;' : ''}">
          <td><strong style="color:#f8fafc;">${p.name}</strong></td>
          <td>${p.legal_name || '-'}</td>
          <td>${p.is_company ? '<i class="fa-solid fa-building"></i> شركة' : '<i class="fa-solid fa-user"></i> فرد'}</td>
          <td>${roleBadges || '-'}</td>
          <td style="font-family:var(--font-en);">${p.tax_id || '-'}</td>
          <td style="font-family:var(--font-en);">${p.registration_number || '-'}</td>
          <td>
            ${p.phone ? `<div><i class="fa-solid fa-phone" style="font-size:0.75rem;"></i> ${p.phone}</div>` : ''}
            ${p.email ? `<small style="color:#94a3b8;"><i class="fa-solid fa-envelope" style="font-size:0.75rem;"></i> ${p.email}</small>` : ''}
            ${!p.phone && !p.email ? '-' : ''}
          </td>
          <td>${statusBadge}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-secondary" onclick="editCsParty('${p.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>
              ${isArchived
                ? `<button class="btn btn-sm btn-success" onclick="restoreCsParty('${p.id}')" title="استعادة"><i class="fa-solid fa-rotate-left"></i></button>`
                : `<button class="btn btn-sm btn-danger" onclick="archiveCsParty('${p.id}')" title="أرشفة"><i class="fa-solid fa-box-archive"></i></button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.openCsPartyModal = function (party = null) {
    const modal = document.getElementById('csPartyModal');
    const title = document.getElementById('csModalTitle');
    const form = document.getElementById('csPartyForm');
    const errBanner = document.getElementById('csModalErrorBanner');
    if (!modal || !form) return;

    form.reset();
    if (errBanner) errBanner.innerHTML = '';
    document.getElementById('csFormPartyId').value = '';

    if (party) {
      title.innerText = 'تعديل بيانات الطرف التجاري';
      document.getElementById('csFormPartyId').value = party.id;
      document.getElementById('csFormName').value = party.name || '';
      document.getElementById('csFormLegalName').value = party.legal_name || '';
      document.getElementById('csFormIsCompany').value = party.is_company ? '1' : '0';
      document.getElementById('csFormTaxId').value = party.tax_id || '';
      document.getElementById('csFormRegNum').value = party.registration_number || '';
      document.getElementById('csFormPhone').value = party.phone || '';
      document.getElementById('csFormEmail').value = party.email || '';
      document.getElementById('csFormPaymentTerms').value = party.payment_terms || '';
      document.getElementById('csFormCurrency').value = party.currency || 'IQD';

      const roles = party.roles || [];
      document.getElementById('csRoleCustomer').checked = roles.includes('customer');
      document.getElementById('csRoleSupplier').checked = roles.includes('supplier');
    } else {
      title.innerText = 'إضافة طرف تجاري جديد (عميل / مورد)';
      document.getElementById('csRoleCustomer').checked = true;
    }

    modal.style.display = 'flex';
  };

  window.closeCsPartyModal = function () {
    const modal = document.getElementById('csPartyModal');
    if (modal) modal.style.display = 'none';
  };

  window.editCsParty = function (id) {
    const party = partiesData.find(p => p.id === id);
    if (party) openCsPartyModal(party);
  };

  async function handlePartyFormSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('csSaveSubmitBtn');
    const errBanner = document.getElementById('csModalErrorBanner');
    if (btn) btn.disabled = true;
    if (errBanner) errBanner.innerHTML = '';

    try {
      const client = window.CanonicalClient;
      const id = document.getElementById('csFormPartyId').value;
      const name = document.getElementById('csFormName').value;
      const legal_name = document.getElementById('csFormLegalName').value;
      const is_company = document.getElementById('csFormIsCompany').value === '1';
      const tax_id = document.getElementById('csFormTaxId').value;
      const registration_number = document.getElementById('csFormRegNum').value;
      const phone = document.getElementById('csFormPhone').value;
      const email = document.getElementById('csFormEmail').value;
      const payment_terms = document.getElementById('csFormPaymentTerms').value;
      const currency = document.getElementById('csFormCurrency').value;

      const roles = [];
      if (document.getElementById('csRoleCustomer').checked) roles.push('customer');
      if (document.getElementById('csRoleSupplier').checked) roles.push('supplier');

      if (roles.length === 0) {
        throw new Error('يجب اختيار دور واحد على الأقل (عميل أو مورد)');
      }

      const payload = {
        name,
        legal_name,
        is_company,
        tax_id,
        registration_number,
        phone,
        email,
        payment_terms,
        currency,
        roles
      };

      if (id) {
        payload.id = id;
        await client.post('/api/v1/action/party:update', payload);
      } else {
        await client.post('/api/v1/action/party:create', payload);
      }

      closeCsPartyModal();
      await loadData();
    } catch (err) {
      if (errBanner) {
        errBanner.innerHTML = `<div class="alert alert-danger" style="margin-bottom:15px; background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5; padding:10px; border-radius:8px;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</div>`;
      } else {
        alert(`خطأ: ${err.message}`);
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.archiveCsParty = async function (id) {
    if (!confirm('هل أنت تأكد من أرشفة هذا الطرف التجاري؟')) return;
    try {
      await window.CanonicalClient.post('/api/v1/action/party:archive', { id });
      await loadData();
    } catch (err) {
      alert(`فشل الأرشفة: ${err.message}`);
    }
  };

  window.restoreCsParty = async function (id) {
    try {
      await window.CanonicalClient.post('/api/v1/action/party:restore', { id });
      await loadData();
    } catch (err) {
      alert(`فشل الاستعادة: ${err.message}`);
    }
  };

  function wireSwitch() {
    if (window.__csWrapped || typeof window.switchPage !== 'function') return;
    const orig = window.switchPage;
    window.switchPage = function (page) {
      const res = orig.apply(this, arguments);
      if (page === 'parties') {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('page-active'));
        const pg = document.getElementById('pageCustomersAndSuppliers');
        if (pg) pg.classList.add('page-active');
        if (typeof window.initCustomersAndSuppliersModule === 'function') {
          window.initCustomersAndSuppliersModule().catch(() => {});
        }
      }
      return res;
    };
    window.__csWrapped = true;
  }
  wireSwitch();
})();
