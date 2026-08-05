'use strict';

export const migration = {
  id: '088_build11_billing_action',
  owner: 'build11_commercial',
  version: '11.0.1',
  parent: '087_build11_commercial_platform',
  dependsOn: ['087_build11_commercial_platform'],
  dialect: ['sqlite'],
  transactionPolicy: 'required',
  rollbackPolicy: 'reversible',
  sourceProvenance: 'BUILD-11 additive registration for governed invoice simulation',
  up(db) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO platform_actions(id,module_id,entity_id,kind,allowed_states,required_permission,required_scope,input_schema,preconditions,transaction_owner,idempotency_policy,sequence_policy,audit_policy,outbox_policy,error_contract,created_at,updated_at)
      VALUES('saas:invoice_simulate','build11_commercial','saas_simulated_invoice','domain','[]','platform:saas:billing:simulate','tenant','{}','[]','platform.build11','required','none','required','required','{}',?,?)
      ON CONFLICT(id) DO UPDATE SET required_permission=excluded.required_permission,updated_at=excluded.updated_at`).run(now, now);
  },
  down(db) { db.prepare("DELETE FROM platform_actions WHERE id='saas:invoice_simulate'").run(); },
};

export default migration;
