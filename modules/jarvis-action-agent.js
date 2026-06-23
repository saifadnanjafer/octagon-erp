/**
 * OCTAGON OMNISYSTEM - modules/jarvis-action-agent.js
 *
 * DOM-lite Action Agent & Safe Tool Controller:
 * Handles deterministic action mapping, elements highlighting, approval gating,
 * and safety policy execution.
 */
(function () {
  'use strict';

  // `omni` is a bare global in app.js — it is NOT on window. Resolve it safely so the
  // read-only data queries below actually see the live store instead of always failing.
  function getOmni() {
    try { if (typeof omni !== 'undefined' && omni) return omni; } catch (_) {}
    try { if (window.omni) return window.omni; } catch (_) {}
    return null;
  }

  const JARVIS_RISK_LEVELS = {
    READ: 'read',
    NAVIGATION: 'navigation',
    UI_SAFE: 'ui_safe',
    DRAFT: 'draft',
    APPROVAL: 'approval',
    WRITE: 'write',
    DANGEROUS: 'dangerous',
    BLOCKED: 'blocked'
  };

  // Safe action handlers mapped by action ID
  const ACTIONS_REGISTRY = {
    'page.open.inventory': {
      labelAr: 'فتح المخزون',
      labelEn: 'Open Inventory',
      risk: JARVIS_RISK_LEVELS.NAVIGATION,
      run() {
        if (typeof window.switchPage === 'function') {
          window.switchPage('inventory');
          return { ok: true, navigated: 'inventory' };
        }
        return { ok: false };
      }
    },
    'inventory.filter.low_stock': {
      labelAr: 'عرض المواد الناقصة',
      labelEn: 'Show low-stock materials',
      risk: JARVIS_RISK_LEVELS.UI_SAFE,
      run() {
        if (typeof window.switchPage === 'function') window.switchPage('inventory');
        // Trigger low stock filter click
        setTimeout(() => {
          const lowStockBtn = document.querySelector('[data-action="filter-low-stock"]') || 
                            document.querySelector('.filter-low-stock') ||
                            document.querySelector('#filterLowStock');
          if (lowStockBtn) {
            lowStockBtn.click();
          } else {
            console.log('[JarvisActionAgent] Low stock filter button not found, running local state filter');
          }
        }, 300);
        return { ok: true };
      }
    },
    'inventory.create_purchase_request': {
      labelAr: 'تجهيز طلب شراء للمواد الناقصة',
      labelEn: 'Prepare purchase request for low stock',
      risk: JARVIS_RISK_LEVELS.APPROVAL,
      run(params) {
        // Creates a proposal in the Command Center queue
        if (window.JarvisBrain && typeof window.JarvisBrain.queueApproval === 'function') {
          const ok = window.JarvisBrain.queueApproval({
            title: 'طلب شراء مواد ناقصة (تجهيز جارفيس)',
            target: 'inventory',
            risk: 'medium',
            summary: `طلب شراء تلقائي للمواد التي بلغت الحد الأدنى: ${params?.source || 'low_stock_materials'}`,
            actionId: 'propose_inventory_purchase',
            actionType: 'purchase_request',
            payload: { source: 'low_stock_materials', timestamp: new Date().toISOString() }
          });
          return { ok };
        }
        return { ok: false };
      }
    }
  };

  // Blocked actions that are dangerous
  const BLOCKED_PATTERNS = [
    /احذف كل/i, /مسح كل/i, /delete all/i, /reset db/i, /reset database/i,
    /احذف الموظفين/i, /delete employees/i, /حذف الحسابات/i, /delete finance/i
  ];

  // Visual highlights
  let activeHighlightTimer = null;
  let activeBubble = null;

  function collectVisibleJarvisActions() {
    const list = [];
    const elements = document.querySelectorAll('[data-jarvis-action]');
    elements.forEach(el => {
      const id = el.getAttribute('data-jarvis-action');
      const label = el.getAttribute('data-jarvis-label') || el.innerText;
      const risk = el.getAttribute('data-jarvis-risk') || JARVIS_RISK_LEVELS.UI_SAFE;
      list.push({ id, label, risk, selector: `[data-jarvis-action="${id}"]` });
    });
    return list;
  }

  function highlightJarvisTarget(selectorOrElement, stepText) {
    // Clean up previous highlights
    removeHighlights();

    let el = null;
    if (typeof selectorOrElement === 'string') {
      el = document.querySelector(selectorOrElement);
    } else if (selectorOrElement instanceof HTMLElement) {
      el = selectorOrElement;
    }

    if (!el) return;

    // Scroll into view safely if needed
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add glowing pulse border
    el.classList.add('jarvis-action-highlight');

    // Create floating step bubble
    if (stepText) {
      const rect = el.getBoundingClientRect();
      activeBubble = document.createElement('div');
      activeBubble.className = 'jarvis-execution-bubble';
      activeBubble.innerHTML = `<i class="fa-solid fa-spinner"></i> <span>${stepText}</span>`;
      
      // Position bubble above the element
      document.body.appendChild(activeBubble);
      const bubbleHeight = activeBubble.offsetHeight || 38;
      const bubbleWidth = activeBubble.offsetWidth || 150;
      
      activeBubble.style.top = `${rect.top - bubbleHeight - 10}px`;
      activeBubble.style.left = `${rect.left + (rect.width - bubbleWidth) / 2}px`;
    }

    // Auto-remove highlight after 3.5 seconds
    activeHighlightTimer = setTimeout(removeHighlights, 3500);
  }

  function removeHighlights() {
    document.querySelectorAll('.jarvis-action-highlight').forEach(el => {
      el.classList.remove('jarvis-action-highlight');
    });
    if (activeBubble) {
      try { activeBubble.remove(); } catch (_) {}
      activeBubble = null;
    }
    if (activeHighlightTimer) {
      clearTimeout(activeHighlightTimer);
      activeHighlightTimer = null;
    }
  }

  function openJarvisActionPreview(actionPlan) {
    console.log('[JarvisActionAgent] Proposal action plan:', actionPlan);
    // This displays a plan preview inside the assistant chat stream
    // Structure: { intent, steps: [{ type, actionId, risk, label }] }
  }

  // Safety check policy
  function validateActionSafety(actionId, textQuery) {
    // Pattern checks
    if (textQuery) {
      const match = BLOCKED_PATTERNS.some(pat => pat.test(textQuery));
      if (match) return { allowed: false, policy: JARVIS_RISK_LEVELS.BLOCKED, reason: 'إجراء مدمر ومحظور أمنياً.' };
    }

    const registered = ACTIONS_REGISTRY[actionId];
    if (registered) {
      if (registered.risk === JARVIS_RISK_LEVELS.BLOCKED) {
        return { allowed: false, policy: JARVIS_RISK_LEVELS.BLOCKED, reason: 'هذا الإجراء غير مسموح به.' };
      }
      if (registered.risk === JARVIS_RISK_LEVELS.APPROVAL || registered.risk === JARVIS_RISK_LEVELS.WRITE) {
        return { allowed: true, policy: JARVIS_RISK_LEVELS.APPROVAL, reason: 'يتطلب موافقة المدير.' };
      }
    }

    return { allowed: true, policy: JARVIS_RISK_LEVELS.UI_SAFE };
  }

  async function executeJarvisAction(actionId, params) {
    console.log(`[JarvisActionAgent] Executing action: ${actionId}`, params);
    
    // Check if safety policy allows it
    const check = validateActionSafety(actionId);
    if (!check.allowed) {
      console.warn(`[JarvisActionAgent] Blocked execution of ${actionId}: ${check.reason}`);
      return { ok: false, blocked: true, message: check.reason };
    }

    // If it's a registered page navigation or deterministic script action
    const registered = ACTIONS_REGISTRY[actionId];
    if (registered) {
      // Handle visual overlay highlights
      const selector = `[data-jarvis-action="${actionId}"]`;
      highlightJarvisTarget(selector, registered.labelAr);

      // Approval routing
      if (check.policy === JARVIS_RISK_LEVELS.APPROVAL) {
        const result = registered.run(params);
        return { ok: result.ok, policy: JARVIS_RISK_LEVELS.APPROVAL, message: 'أرسلت طلب الموافقة إلى مركز القيادة.' };
      }

      // Execute safely
      const result = registered.run(params);
      return { ok: result.ok, navigated: result.navigated };
    }

    // Dynamic execution: if actionId maps to a page navigation (e.g. page.open.calculator)
    if (actionId.startsWith('page.open.')) {
      const pageKey = actionId.replace('page.open.', '');
      if (typeof window.switchPage === 'function') {
        highlightJarvisTarget(`.sidebar [data-page="${pageKey}"]`, `جاري فتح ${pageKey}...`);
        window.switchPage(pageKey);
        return { ok: true, navigated: pageKey };
      }
    }

    // Dynamic selectors or generic click triggers
    const el = document.querySelector(`[data-jarvis-action="${actionId}"]`);
    if (el) {
      highlightJarvisTarget(el, el.getAttribute('data-jarvis-label') || 'جاري التشغيل...');
      el.click();
      return { ok: true };
    }

    console.warn(`[JarvisActionAgent] No handler or element found for actionId: ${actionId}`);
    return { ok: false, error: 'unknown_action' };
  }

  // Read-only ERP entity query layers
  function jarvisQueryData(query) {
    const o = getOmni();
    if (!o) return { ok: false };
    // Read-only queries mapped to keys
    return { ok: true, data: o };
  }

  function jarvisFindRecords(entity, filters) {
    const o = getOmni();
    if (!o || !o[entity]) return [];
    let list = o[entity];
    if (filters) {
      list = list.filter(item => {
        return Object.keys(filters).every(k => item[k] === filters[k]);
      });
    }
    return list;
  }

  function jarvisGetCurrentPageContext() {
    return {
      currentPage: typeof currentPage !== 'undefined' ? currentPage : 'calculator',
      timestamp: new Date().toISOString()
    };
  }

  function jarvisGetSelectedRecordContext() {
    // Read the active modal or inspector detail
    const inspector = document.getElementById('inspectorPanel');
    if (inspector && !inspector.classList.contains('hidden')) {
      const title = document.getElementById('inspectorTitle')?.innerText;
      return { activeInspector: true, title };
    }
    return { activeInspector: false };
  }

  // Export module globally
  window.JarvisActionAgent = {
    collectVisibleJarvisActions,
    executeJarvisAction,
    highlightJarvisTarget,
    openJarvisActionPreview,
    removeHighlights,
    validateActionSafety,
    jarvisQueryData,
    jarvisFindRecords,
    jarvisGetCurrentPageContext,
    jarvisGetSelectedRecordContext,
    RISK_LEVELS: JARVIS_RISK_LEVELS
  };

})();
