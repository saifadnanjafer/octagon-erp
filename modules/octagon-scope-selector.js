/** Shared company/branch/warehouse scope selector for BUILD-09/BUILD-10 workspaces.
 * One markup() + render() pair reused by every page instead of each page building and
 * populating its own inline company/warehouse header, per the "one reusable scope
 * component" requirement - loading / no-access / no-warehouse / populated states are
 * handled here once instead of only ever showing a populated-or-empty select. */
(function scopeSelector(root) {
  'use strict';
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const rtl = () => document.documentElement.dir === 'rtl' || String(document.documentElement.lang).startsWith('ar');

  function markup() {
    return `<div class="b09-scope" data-role="scope-root">
      <span data-role="company"></span>
      <label class="b09-scope-field" data-role="warehouse-field"><span>${rtl() ? 'المستودع' : 'Warehouse'}</span><select data-role="warehouse"></select></label>
      <p class="b09-scope-state" data-role="scope-state" hidden></p>
    </div>`;
  }

  function warehouseLabel(warehouse) {
    return warehouse.code ? `${warehouse.code} · ${warehouse.name || warehouse.id}` : (warehouse.name || warehouse.id);
  }

  /**
   * @param {Element} host - a node containing markup() output (a workspace section)
   * @param {object|null} snapshot - OctagonRuntimeContext.snapshot(), or null before ready
   */
  function render(host, snapshot) {
    if (!host) return;
    const companyNode = host.querySelector('[data-role="company"]');
    const warehouseField = host.querySelector('[data-role="warehouse-field"]');
    const warehouseSelect = host.querySelector('[data-role="warehouse"]');
    const stateNode = host.querySelector('[data-role="scope-state"]');
    if (!companyNode || !warehouseField || !warehouseSelect || !stateNode) return;

    const setState = (state, text) => { stateNode.hidden = false; stateNode.dataset.state = state; stateNode.textContent = text; warehouseField.hidden = true; };

    if (!snapshot || !snapshot.ready) {
      companyNode.textContent = rtl() ? 'الشركة: —' : 'Company: —';
      setState('loading', rtl() ? 'جارٍ تحميل النطاق…' : 'Loading scope…');
      return;
    }
    if (snapshot.error) {
      companyNode.textContent = rtl() ? 'الشركة: —' : 'Company: —';
      setState('error', snapshot.error);
      return;
    }
    if (!snapshot.companyId) {
      companyNode.textContent = rtl() ? 'الشركة: —' : 'Company: —';
      setState('no-access', rtl() ? 'لا تملك صلاحية الوصول إلى أي شركة.' : 'You do not have access to any company.');
      return;
    }
    companyNode.textContent = `${rtl() ? 'الشركة' : 'Company'}: ${snapshot.companyId}`;
    const warehouses = snapshot.availableWarehouses || [];
    if (!warehouses.length) {
      setState('no-warehouse', rtl() ? 'لا يوجد مستودع مُتاح لهذا النطاق.' : 'No warehouse is available for this scope.');
      return;
    }
    stateNode.hidden = true; warehouseField.hidden = false;
    const currentValue = warehouseSelect.value;
    warehouseSelect.innerHTML = `<option value="">${rtl() ? 'اختر مستودعاً' : 'Select warehouse'}</option>` + warehouses.map((warehouse) => `<option value="${escapeHtml(warehouse.id)}">${escapeHtml(warehouseLabel(warehouse))}</option>`).join('');
    warehouseSelect.value = snapshot.warehouseId || currentValue || '';
  }

  root.OctagonScopeSelector = { markup, render };
})(window);
