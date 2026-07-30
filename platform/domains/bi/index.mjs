// platform/domains/bi/index.mjs — ActionExecutor for Business Intelligence Module.

import * as biService from './service.mjs';

export function registerBIActions(actionRegistry) {
  actionRegistry.register('bi:create-dashboard', async (context, payload) => {
    context.checkPermission('bi.dashboard.create');
    return biService.createDashboard(context.db, {
      ...payload,
      company_id: context.companyId,
      owner_id: context.userId
    });
  });

  actionRegistry.register('bi:add-widget', async (context, payload) => {
    context.checkPermission('bi.dashboard.manage');
    return biService.addWidget(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('bi:define-kpi', async (context, payload) => {
    context.checkPermission('bi.kpi.manage');
    return biService.defineKPI(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('bi:record-kpi-snapshot', async (context, payload) => {
    context.checkPermission('bi.kpi.manage');
    return biService.recordKPISnapshot(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('bi:schedule-report', async (context, payload) => {
    context.checkPermission('bi.report.schedule');
    return biService.scheduleReport(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });
}
