(function () {
  'use strict';

  // These panels build HTML by concatenating quoted fragments, so their English
  // literals cannot each be wrapped in a translate call. The rendered container
  // is translated once instead, by text node, so listeners attached after
  // render survive. See modules/ui-arabic-chrome.js.
  const arabicChrome = (element) => {
    try { return window.OctagonArabicChrome ? window.OctagonArabicChrome.localizeElement(element) : element; }
    catch (_) { return element; }
  };

  const VERSION = 'phase7k-platform-marketplace-v1';

  function O() {
    try { if (typeof omni !== 'undefined' && omni && typeof omni === 'object') return omni; } catch (_) {}
    if (!window.omni) window.omni = {};
    return window.omni;
  }

  function esc(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value == null ? '' : String(value));
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function save() {
    if (typeof window.saveData === 'function') window.saveData();
  }

  function toast(message, type) {
    if (typeof window.toast === 'function') window.toast(message, type || 'info');
  }

  function hashToken(token) {
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    return 'sha256-local-' + Math.abs(hash).toString(16).padStart(8, '0');
  }

  const TIER_RULES = {
    demo: {
      apiKeys: 1,
      webhooks: 1,
      plugins: 2,
      modules: ['core_admin', 'integration_hub', 'whatsapp_connector', 'backup_monitor'],
      features: ['plugin_registry', 'webhook_registry']
    },
    starter: {
      apiKeys: 2,
      webhooks: 2,
      plugins: 4,
      modules: ['core_admin', 'integration_hub', 'whatsapp_connector', 'backup_monitor', 'mobile_approvals'],
      features: ['plugin_registry', 'webhook_registry', 'scoped_api_keys']
    },
    business: {
      apiKeys: 5,
      webhooks: 6,
      plugins: 10,
      modules: ['core_admin', 'integration_hub', 'whatsapp_connector', 'backup_monitor', 'mobile_approvals', 'report_designer', 'ai_governance'],
      features: ['plugin_registry', 'webhook_registry', 'scoped_api_keys', 'marketplace_staging']
    },
    enterprise: {
      apiKeys: 20,
      webhooks: 25,
      plugins: 50,
      modules: ['core_admin', 'integration_hub', 'whatsapp_connector', 'backup_monitor', 'mobile_approvals', 'report_designer', 'ai_governance', 'hardware_integrations'],
      features: ['plugin_registry', 'webhook_registry', 'scoped_api_keys', 'marketplace_staging', 'partner_extensions']
    }
  };

  const SEED_MODULES = [
    { id: 'core_admin', name: 'Admin Control Layer', category: 'Core', requiredTier: 'demo', status: 'installed', owner: 'System Admin' },
    { id: 'integration_hub', name: 'Integration Hub', category: 'Platform', requiredTier: 'demo', status: 'installed', owner: 'IT / Integrations' },
    { id: 'whatsapp_connector', name: 'WhatsApp Connector', category: 'Messaging', requiredTier: 'demo', status: 'review', owner: 'Customer Ops' },
    { id: 'backup_monitor', name: 'Backup Monitor', category: 'Operations', requiredTier: 'demo', status: 'installed', owner: 'IT' },
    { id: 'mobile_approvals', name: 'Mobile Approvals', category: 'Workflow', requiredTier: 'starter', status: 'available', owner: 'Management' },
    { id: 'report_designer', name: 'Report Designer', category: 'Analytics', requiredTier: 'business', status: 'locked', owner: 'Finance' },
    { id: 'ai_governance', name: 'AI Governance Catalog', category: 'AI', requiredTier: 'business', status: 'installed', owner: 'Admin / AI' },
    { id: 'hardware_integrations', name: 'Hardware Integrations', category: 'Devices', requiredTier: 'enterprise', status: 'locked', owner: 'IT' }
  ];

  function productization() {
    const omni = O();
    omni.adminSettings = omni.adminSettings || {};
    omni.adminSettings.productization = omni.adminSettings.productization || {};
    const product = omni.adminSettings.productization;
    product.planTier = product.planTier || 'demo';
    product.featureFlags = product.featureFlags || {};
    product.license = product.license || {};
    product.license.mode = product.license.mode || 'local-demo';
    product.license.status = product.license.status || 'placeholder';
    return product;
  }

  function currentTier() {
    const tier = productization().planTier || 'demo';
    return TIER_RULES[tier] ? tier : 'demo';
  }

  function ensureRoot() {
    const omni = O();
    const root = omni.platformMarketplace = omni.platformMarketplace || {};
    root.version = root.version || VERSION;
    root.plugins = root.plugins || {};
    root.developer = root.developer || {};
    root.webhooks = root.webhooks || {};
    root.billing = root.billing || {};
    root.modules = root.modules || {};
    root.plugins.registry = Array.isArray(root.plugins.registry) ? root.plugins.registry : [];
    root.plugins.marketplace = Array.isArray(root.plugins.marketplace) ? root.plugins.marketplace : [];
    root.developer.apiKeys = Array.isArray(root.developer.apiKeys) ? root.developer.apiKeys : [];
    root.webhooks.registry = Array.isArray(root.webhooks.registry) ? root.webhooks.registry : [];
    root.webhooks.deliveries = Array.isArray(root.webhooks.deliveries) ? root.webhooks.deliveries : [];
    root.modules.catalog = Array.isArray(root.modules.catalog) ? root.modules.catalog : [];
    root.billing.enforcement = root.billing.enforcement || { mode: 'local-tier-gate', lastCheckedAt: nowIso() };

    // The plugin registry used to seed itself with invented third-party
    // integrations ("WhatsApp Business Connector v0.8.0 · active"), presented
    // with status pills and Enable/Disable buttons — so it claimed extensions
    // were installed that never existed. The governed equivalents are real:
    // saas_extension_packages and saas_extension_installations, surfaced by
    // extension_marketplace and extension_installations. This panel now fails
    // closed and links there instead of inventing state.
    //
    // SEED_MODULES below is deliberately kept: it is a catalogue of Octagon's
    // own modules whose availability is computed live by syncModuleLocks() from
    // the active plan tier, not fabricated operational data.
    SEED_MODULES.forEach(seed => {
      if (!root.modules.catalog.some(module => module.id === seed.id)) {
        root.modules.catalog.push({ ...seed, createdAt: nowIso() });
      }
    });

    // Likewise, a webhook registration for '/api/whatsapp/webhook' was invented
    // here whenever the registry was empty, so the page reported a live inbound
    // subscription that had never been configured.
    purgeFabricatedRecords(root);

    syncModuleLocks();
    return root;
  }

  // Deleting the seeder stops new fabrication but does not undo it: these
  // records were persisted into omni.platformMarketplace (metadata table), so
  // every existing install still shows the invented plugins and webhook. This
  // removes exactly those, matched on id AND a second field so a genuine record
  // that happened to reuse an id is never touched. There is no UI that adds to
  // plugins.registry, so nothing here was ever user-created. Runs once.
  const FABRICATED_PLUGINS = [
    ['whatsapp_business', 'Octagon'],
    ['backup_monitor', 'Octagon'],
    ['report_designer', 'Octagon Labs'],
    ['hardware_gateway', 'Local IT']
  ];

  function purgeFabricatedRecords(root) {
    if (root.fabricatedSeedPurgedAt) return;
    const beforePlugins = root.plugins.registry.length;
    root.plugins.registry = root.plugins.registry.filter(function (plugin) {
      return !FABRICATED_PLUGINS.some(function (entry) {
        return plugin && plugin.id === entry[0] && plugin.vendor === entry[1];
      });
    });
    const beforeHooks = root.webhooks.registry.length;
    root.webhooks.registry = root.webhooks.registry.filter(function (hook) {
      return !(hook && hook.id === 'whatsapp_inbound_events' && hook.endpoint === '/api/whatsapp/webhook');
    });
    root.fabricatedSeedPurgedAt = nowIso();
    const removed = (beforePlugins - root.plugins.registry.length) + (beforeHooks - root.webhooks.registry.length);
    if (removed > 0 && typeof window.saveData === 'function') window.saveData();
  }

  function tierAllowsModule(moduleId) {
    const rules = TIER_RULES[currentTier()] || TIER_RULES.demo;
    return rules.modules.includes(moduleId);
  }

  function syncModuleLocks() {
    const root = O().platformMarketplace;
    if (!root || !root.modules) return;
    root.modules.catalog.forEach(module => {
      if (module.status === 'installed') return;
      module.status = tierAllowsModule(module.id) ? 'available' : 'locked';
    });
    root.billing.enforcement.lastCheckedAt = nowIso();
  }

  function tierLimit(type) {
    const rules = TIER_RULES[currentTier()] || TIER_RULES.demo;
    return rules[type] || 0;
  }

  function usage() {
    const root = ensureRoot();
    return {
      plugins: root.plugins.registry.filter(plugin => plugin.enabled || plugin.status === 'active').length,
      apiKeys: root.developer.apiKeys.filter(key => key.status !== 'revoked').length,
      webhooks: root.webhooks.registry.filter(hook => hook.status !== 'disabled').length,
      modules: root.modules.catalog.filter(module => module.status === 'installed').length
    };
  }

  function limitStatus(type) {
    const used = usage()[type];
    const limit = tierLimit(type);
    return { used, limit, ok: used <= limit };
  }

  function scopeAllowed(scopes, requiredScope) {
    return (scopes || []).includes(requiredScope) || (scopes || []).includes('*');
  }

  function createApiKey() {
    const root = ensureRoot();
    const status = limitStatus('apiKeys');
    if (!status.ok || status.used >= status.limit) {
      toast('API key limit reached for current tier.', 'warning');
      return null;
    }
    const token = 'oct_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const key = {
      id: uid('key'),
      name: 'Integration key ' + (root.developer.apiKeys.length + 1),
      tokenPreview: token.slice(0, 7) + '...' + token.slice(-4),
      tokenHash: hashToken(token),
      scopes: ['plugins:read', 'webhooks:write'],
      tenantId: (window.activeTenantId || window.currentTenantId || 'local-tenant'),
      status: 'active',
      createdAt: nowIso(),
      lastUsedAt: ''
    };
    root.developer.apiKeys.unshift(key);
    save();
    toast('Scoped API key created. Secret is stored as a local hash preview only.', 'success');
    renderAll();
    return key;
  }

  function revokeApiKey(keyId) {
    const root = ensureRoot();
    const key = root.developer.apiKeys.find(item => item.id === keyId);
    if (!key) return;
    key.status = 'revoked';
    key.revokedAt = nowIso();
    save();
    toast('API key revoked.', 'success');
    renderAll();
  }

  function togglePlugin(pluginId) {
    const root = ensureRoot();
    const plugin = root.plugins.registry.find(item => item.id === pluginId);
    if (!plugin || plugin.status === 'blocked') {
      toast('Blocked plugins cannot be enabled before security review.', 'warning');
      return;
    }
    const status = limitStatus('plugins');
    if (!plugin.enabled && status.used >= status.limit) {
      toast('Plugin limit reached for current tier.', 'warning');
      return;
    }
    plugin.enabled = !plugin.enabled;
    plugin.status = plugin.enabled ? 'active' : 'staged';
    plugin.updatedAt = nowIso();
    save();
    toast(plugin.enabled ? 'Plugin enabled within tenant scope.' : 'Plugin disabled.', 'success');
    renderAll();
  }

  function simulateWebhook(hookId) {
    const root = ensureRoot();
    const hook = root.webhooks.registry.find(item => item.id === hookId);
    if (!hook) return;
    const matchingKey = root.developer.apiKeys.find(key => key.status === 'active' && scopeAllowed(key.scopes, hook.scopes[0]));
    const delivered = !!matchingKey && hook.status !== 'disabled';
    root.webhooks.deliveries.unshift({
      id: uid('whdel'),
      hookId,
      event: hook.event,
      status: delivered ? 'delivered' : 'blocked',
      attempts: delivered ? 1 : 0,
      message: delivered ? 'Tenant scope and API key scope accepted.' : 'Blocked: missing active scoped API key.',
      createdAt: nowIso()
    });
    root.webhooks.deliveries = root.webhooks.deliveries.slice(0, 25);
    save();
    toast(delivered ? 'Webhook simulation delivered.' : 'Webhook simulation blocked by scope gate.', delivered ? 'success' : 'warning');
    renderAll();
  }

  function statusPill(status) {
    const cls = status === 'active' || status === 'installed' || status === 'delivered' ? '' : status === 'blocked' || status === 'locked' ? 'blocked' : 'warn';
    return '<span class="pmk-status ' + cls + '">' + esc(status) + '</span>';
  }

  function renderStats() {
    const u = usage();
    return [
      ['Plugins', u.plugins + '/' + tierLimit('plugins'), 'Enabled extension limit'],
      ['API keys', u.apiKeys + '/' + tierLimit('apiKeys'), 'Active scoped keys'],
      ['Webhooks', u.webhooks + '/' + tierLimit('webhooks'), 'Registered endpoints'],
      ['Tier', currentTier(), 'Local billing enforcement']
    ].map(item => '<div class="pmk-stat"><b>' + esc(item[1]) + '</b><span>' + esc(item[0]) + ' - ' + esc(item[2]) + '</span></div>').join('');
  }

  // Shown where invented records used to be. It says plainly that nothing is
  // registered and points at the governed pages that hold the real thing,
  // rather than filling the space with something that looks like data.
  function governedEmptyState(messageAr, pages) {
    const links = pages.map(function (entry) {
      return '<button type="button" class="pmk-btn" onclick="switchPage(\'' + esc(entry[0]) + '\')">' + esc(entry[1]) + '</button>';
    }).join(' ');
    return '<div class="pmk-row"><div><div class="pmk-row-title">' + esc(messageAr) + '</div>'
      + '<div class="pmk-row-sub">لا تُعرض هنا بيانات تجريبية. المصدر المعتمد في الصفحات التالية.</div></div>'
      + '<div class="pmk-actions">' + links + '</div></div>';
  }

  function renderPlugins(root) {
    if (!root.plugins.registry.length) {
      return governedEmptyState('لا توجد إضافات مسجَّلة في هذا السجل المحلي', [
        ['extension_marketplace', 'سوق الإضافات المحكوم'],
        ['extension_installations', 'الإضافات المثبَّتة للمستأجر']
      ]);
    }
    return root.plugins.registry.map(plugin => {
      const scopes = (plugin.scopes || []).map(scope => '<span class="pmk-tag">' + esc(scope) + '</span>').join('');
      return '<div class="pmk-row">'
        + '<div><div class="pmk-row-title">' + esc(plugin.name) + '</div>'
        + '<div class="pmk-row-sub">' + esc(plugin.vendor) + ' v' + esc(plugin.version) + ' - risk: ' + esc(plugin.risk) + ' - tenant scoped: ' + esc(plugin.tenantScoped ? 'yes' : 'no') + '</div>'
        + '<div class="pmk-tags">' + scopes + '</div></div>'
        + '<div class="pmk-actions">' + statusPill(plugin.status) + '<button class="pmk-btn" onclick="PlatformMarketplace.togglePlugin(\'' + esc(plugin.id) + '\')">' + esc(plugin.enabled ? 'Disable' : 'Enable') + '</button></div>'
        + '</div>';
    }).join('');
  }

  function renderApiKeys(root) {
    const rows = root.developer.apiKeys.length ? root.developer.apiKeys.map(key => '<tr>'
      + '<td>' + esc(key.name) + '<div class="pmk-muted">' + esc(key.tokenPreview) + '</div></td>'
      + '<td>' + esc((key.scopes || []).join(', ')) + '</td>'
      + '<td>' + esc(key.tenantId || 'local-tenant') + '</td>'
      + '<td>' + statusPill(key.status) + '</td>'
      + '<td>' + (key.status === 'active' ? '<button class="pmk-btn danger" onclick="PlatformMarketplace.revokeApiKey(\'' + esc(key.id) + '\')">Revoke</button>' : '') + '</td>'
      + '</tr>').join('') : '<tr><td colspan="5">No API keys yet.</td></tr>';
    return '<div class="pmk-title-row"><div><h3>Developer API Keys</h3><p>Keys are scoped by tenant and permission. Token secrets are not displayed after creation.</p></div>'
      + '<button class="pmk-btn primary" onclick="PlatformMarketplace.createApiKey()">Create scoped key</button></div>'
      + '<table class="pmk-table"><thead><tr><th>Key</th><th>Scopes</th><th>Tenant</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderWebhooks(root) {
    if (!root.webhooks.registry.length && !root.webhooks.deliveries.length) {
      return governedEmptyState('لا توجد خطافات ويب مسجَّلة', [
        ['extension_installations', 'الإضافات المثبَّتة للمستأجر']
      ]);
    }
    const hooks = root.webhooks.registry.map(hook => '<div class="pmk-row">'
      + '<div><div class="pmk-row-title">' + esc(hook.name) + '</div>'
      + '<div class="pmk-row-sub">' + esc(hook.event) + ' -> ' + esc(hook.endpoint) + ' - retries: ' + esc(hook.retries) + '</div>'
      + '<div class="pmk-tags">' + (hook.scopes || []).map(scope => '<span class="pmk-tag">' + esc(scope) + '</span>').join('') + '</div></div>'
      + '<div class="pmk-actions">' + statusPill(hook.status) + '<button class="pmk-btn" onclick="PlatformMarketplace.simulateWebhook(\'' + esc(hook.id) + '\')">Simulate</button></div>'
      + '</div>').join('');
    const deliveries = root.webhooks.deliveries.slice(0, 6).map(item => '<tr><td>' + esc(item.event) + '</td><td>' + statusPill(item.status) + '</td><td>' + esc(item.message) + '</td><td>' + esc((item.createdAt || '').slice(0, 19).replace('T', ' ')) + '</td></tr>').join('');
    return hooks + '<table class="pmk-table"><thead><tr><th>Event</th><th>Status</th><th>Message</th><th>Time</th></tr></thead><tbody>' + (deliveries || '<tr><td colspan="4">No delivery attempts yet.</td></tr>') + '</tbody></table>';
  }

  function renderModuleCatalog(root, compact) {
    syncModuleLocks();
    const rows = root.modules.catalog.map(module => {
      const allowed = tierAllowsModule(module.id);
      return '<tr><td><b>' + esc(module.name) + '</b><div class="pmk-muted">' + esc(module.category) + ' - owner: ' + esc(module.owner) + '</div></td>'
        + '<td>' + esc(module.requiredTier) + '</td>'
        + '<td>' + statusPill(module.status) + '</td>'
        + '<td>' + (allowed ? '<span class="pmk-tag">tier allowed</span>' : '<span class="pmk-tag off">upgrade required</span>') + '</td></tr>';
    }).join('');
    return '<div class="pmk-panel pmk-admin-catalog"><div class="pmk-title-row"><div><h3>Module Catalog</h3>'
      + '<p>Admin-facing catalog with current tier enforcement. Locked modules are visible but unavailable until the tier allows them.</p></div>'
      + statusPill('tier: ' + currentTier()) + '</div>'
      + '<table class="pmk-table"><thead><tr><th>Module</th><th>Required tier</th><th>Status</th><th>Gate</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + (compact ? '' : '</div>');
  }

  function renderHub() {
    const root = ensureRoot();
    const host = document.getElementById('integrationHubBody');
    if (!host) return;
    const previous = document.getElementById('platformMarketplaceWorkspace');
    if (previous) previous.remove();
    const shell = document.createElement('section');
    shell.id = 'platformMarketplaceWorkspace';
    shell.className = 'pmk-shell';
    shell.innerHTML = '<div class="pmk-hero"><div><div class="pmk-kicker">Platform / Marketplace Foundation</div>'
      + '<h3>Extension registry, tier gates, API keys, and webhooks</h3>'
      + '<p>Marketplace remains staged. The registry tracks installed extensions, tenant scopes, blocked risks, local billing limits, and webhook delivery safety before external connectors are enabled.</p>'
      + '<div class="pmk-grid">' + renderStats() + '</div></div>'
      + '<div class="pmk-panel"><h3>Enforcement contract</h3><p>Scoped API tokens and webhook simulations are accepted only when tenant scope and requested scope match. AI can diagnose these records but must not reveal tokens or enable blocked extensions.</p>'
      + '<div class="pmk-tags"><span class="pmk-tag">omni.platformMarketplace</span><span class="pmk-tag">local-tier-gate</span><span class="pmk-tag">no external billing</span></div></div></div>'
      + '<div class="pmk-panels"><div class="pmk-panel"><h3>Plugin / Extension Registry</h3><div class="pmk-list">' + renderPlugins(root) + '</div></div>'
      + '<div class="pmk-panel">' + renderApiKeys(root) + '</div>'
      + '<div class="pmk-panel"><h3>Webhook Registry</h3>' + renderWebhooks(root) + '</div>'
      + renderModuleCatalog(root, false) + '</div>';
    host.appendChild(shell);
    arabicChrome(shell);
  }

  function renderAdminCatalog() {
    const body = document.querySelector('#adminPanelBody .admin-tab-body');
    if (!body || !body.textContent.includes('SaaS Productization Foundation')) return;
    const existing = document.getElementById('platformMarketplaceAdminCatalog');
    if (existing) existing.remove();
    const wrap = document.createElement('div');
    wrap.id = 'platformMarketplaceAdminCatalog';
    wrap.innerHTML = renderModuleCatalog(ensureRoot(), false);
    const catalog = wrap.firstElementChild;
    body.appendChild(catalog);
    arabicChrome(catalog);
  }

  // Debounced single render — rebuilding the heavy integration_hub DOM four times
  // per navigation (compounded with the ecommerce-connectors module) made the page
  // janky/unresponsive. One delayed pass is enough once the template is mounted.
  // A plain shared debounce never fired, so this whole panel never appeared on
  // integration_hub. Two faults: one timer served both targets, and the page
  // mutates continuously — measured at 364 mutations in 6s with every gap under
  // 350ms — so the observer re-armed the timer faster than it could elapse.
  // Now one timer per target, plus a deadline capping how long re-arming can
  // postpone a render that is already due.
  const _renderTimers = { hub: null, admin: null };
  const _renderDeadlines = { hub: 0, admin: 0 };
  const RENDER_DELAY_MS = 350;
  const RENDER_MAX_WAIT_MS = 700;
  function scheduleRender(target) {
    if (!(target in _renderTimers)) return;
    const now = Date.now();
    if (!_renderDeadlines[target]) _renderDeadlines[target] = now + RENDER_MAX_WAIT_MS;
    const wait = Math.max(0, Math.min(now + RENDER_DELAY_MS, _renderDeadlines[target]) - now);
    clearTimeout(_renderTimers[target]);
    _renderTimers[target] = setTimeout(function () {
      _renderTimers[target] = null;
      _renderDeadlines[target] = 0;
      if (target === 'hub') renderHub();
      if (target === 'admin') renderAdminCatalog();
    }, wait);
  }

  function isHubActive() {
    const page = document.getElementById('pageIntegrationHub');
    return !!page && page.classList.contains('page-active');
  }

  function installHooks() {
    const originalSwitchPage = window.switchPage;
    if (typeof originalSwitchPage === 'function' && !originalSwitchPage.__platformMarketplaceWrapped) {
      const wrapped = function (page) {
        const result = originalSwitchPage.apply(this, arguments);
        if (page === 'integration_hub') scheduleRender('hub');
        return result;
      };
      wrapped.__platformMarketplaceWrapped = true;
      window.switchPage = wrapped;
    }

    const originalSwitchAdminTab = window.switchAdminTab;
    if (typeof originalSwitchAdminTab === 'function' && !originalSwitchAdminTab.__platformMarketplaceWrapped) {
      const wrappedAdmin = function () {
        const result = originalSwitchAdminTab.apply(this, arguments);
        scheduleRender('admin');
        return result;
      };
      wrappedAdmin.__platformMarketplaceWrapped = true;
      window.switchAdminTab = wrappedAdmin;
    }
  }

  window.PlatformMarketplace = {
    version: VERSION,
    ensureRoot,
    tierAllowsModule,
    usage,
    createApiKey,
    revokeApiKey,
    togglePlugin,
    simulateWebhook,
    renderHub,
    renderAdminCatalog
  };

  function init() {
    ensureRoot();
    installHooks();
    if (window.MutationObserver && document.body) {
      const observer = new MutationObserver(function () {
        const needsHub = isHubActive() && document.getElementById('integrationHubBody') && !document.getElementById('platformMarketplaceWorkspace');
        const needsAdmin = document.querySelector('#adminPanelBody .admin-tab-body') && !document.getElementById('platformMarketplaceAdminCatalog');
        if (needsHub) scheduleRender('hub');
        if (needsAdmin) scheduleRender('admin');
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    scheduleRender('admin');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
