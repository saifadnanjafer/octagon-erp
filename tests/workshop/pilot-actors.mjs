export const PILOT_ACTORS = Object.freeze({
  supervisor: Object.freeze({ id: 'pilot-supervisor', label: 'Supervisor', groups: ['workshop.manager', 'workshop.user'] }),
  planner: Object.freeze({ id: 'pilot-planner', label: 'Planner', groups: ['workshop.manager', 'workshop.user'] }),
  warehouseOperator: Object.freeze({ id: 'pilot-warehouse', label: 'Warehouse Operator', groups: ['workshop.user'] }),
  productionOperator: Object.freeze({ id: 'pilot-production', label: 'Production Operator', groups: ['workshop.user'] }),
  qualityInspector: Object.freeze({ id: 'pilot-quality', label: 'Quality Inspector', groups: ['workshop.user'] }),
  deliveryClerk: Object.freeze({ id: 'pilot-delivery', label: 'Delivery Clerk', groups: ['workshop.user'] }),
  financeUser: Object.freeze({ id: 'pilot-finance', label: 'Finance User', groups: ['finance.user'] }),
});

export const PILOT_ROLE_SEQUENCE = Object.freeze([
  'supervisor', 'planner', 'warehouseOperator', 'productionOperator', 'qualityInspector', 'deliveryClerk', 'financeUser',
]);

export function actorContext(actor, scope = {}) {
  return Object.freeze({
    tenantId: 'default', companyId: 'default', activeCompanyId: 'default', branchId: 'branch-pilot',
    warehouseId: scope.warehouseId || null, userId: actor.id, actorId: actor.id,
    actorType: 'user', sourceChannel: 'workshop-pilot', groups: actor.groups,
  });
}

