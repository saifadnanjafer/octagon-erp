// platform/domains/iraq_localization/index.mjs — ActionExecutor for Iraq Localization & Tax Foundation.

import * as iqService from './service.mjs';

export function registerIraqLocalizationActions(actionRegistry) {
  actionRegistry.register('iraq_localization:create-tax-rule', async (context, payload) => {
    context.checkPermission('iraq.tax.manage');
    return iqService.createTaxRule(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('iraq_localization:get-governorates', async (context) => {
    return iqService.getGovernorates(context.db);
  });

  actionRegistry.register('iraq_localization:file-tax-declaration', async (context, payload) => {
    context.checkPermission('iraq.tax.file');
    return iqService.fileTaxDeclaration(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('iraq_localization:record-cbi-rate', async (context, payload) => {
    context.checkPermission('iraq.fx.manage');
    return iqService.recordCBIRate(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });

  actionRegistry.register('iraq_localization:configure-bilingual-template', async (context, payload) => {
    context.checkPermission('iraq.template.manage');
    return iqService.configureBilingualTemplate(context.db, {
      ...payload,
      company_id: context.companyId
    });
  });
}
