// platform/domains/human_capital/index.mjs — Human Capital Development Module Registration.

import * as service from './service.mjs';

export const id = 'human_capital';
export const name = 'Human Capital Development';

export function registerActions(actionRegistry) {
  actionRegistry.register('human_capital:create-job-opening', async (ctx, params) => {
    return service.createJobOpening(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:submit-application', async (ctx, params) => {
    return service.submitApplication(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:hire-candidate', async (ctx, params) => {
    return service.hireCandidate(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:create-course', async (ctx, params) => {
    return service.createCourse(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:enroll-employee', async (ctx, params) => {
    return service.enrollEmployeeInCourse(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:record-course-completion', async (ctx, params) => {
    return service.recordCourseCompletion(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:create-leave-type', async (ctx, params) => {
    return service.createLeaveType(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:request-leave', async (ctx, params) => {
    return service.requestLeave(ctx.db, { ...params, company_id: ctx.companyId });
  });

  actionRegistry.register('human_capital:approve-leave', async (ctx, params) => {
    return service.approveLeave(ctx.db, { ...params, company_id: ctx.companyId, approved_by: ctx.userId });
  });
}

export const permissions = [
  'human_capital.manage',
  'recruitment.manage',
  'training.manage',
  'performance.manage',
  'leave.request',
  'leave.approve'
];
