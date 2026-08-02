import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os'; import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createServiceEntitlementService } from '../../platform/service/entitlements.mjs';
import { ElectronicSignatureService } from '../../platform/service/esignatures.mjs';
const dbPath=()=>path.join(os.tmpdir(),`octagon-b07-${Date.now()}-${Math.random()}.db`);
test('service contract coverage, usage idempotency and ordered simulator signatures',async()=>{
 const file=dbPath();await freshInstall({dbPath:file});const db=openMigrationDatabase(file),ctx={companyId:'co-a',userId:'maker'},svc=createServiceEntitlementService(db);
 const c=svc.createContract({customerId:'cust',contractNumber:'SC-1',startDate:'2026-01-01',endDate:'2026-12-31',idempotencyKey:'contract-1'},ctx);
 for(const s of ['validated','submitted','approved','active'])svc.transition(c.id,s,ctx);
 svc.addCoverage(c.id,{productId:'prod'});const p=svc.createPolicy({contractId:c.id,name:'standard',visitLimit:2,responseSlaHours:4},ctx);svc.publishPolicy(p.id,{...ctx,userId:'approver'});
 const d=svc.evaluate({customerId:'cust',serviceDate:'2026-08-02',requestedLabor:2,sourceType:'service_ticket',sourceId:'T-1'},ctx);assert.equal(d.status,'covered');
 const u=svc.consume({decisionId:d.id,idempotencyKey:'usage-1',quantity:1},ctx);assert.equal(svc.consume({decisionId:d.id,idempotencyKey:'usage-1',quantity:1},ctx).id,u.id);
 const sig=new ElectronicSignatureService(db),provider=sig.provider({name:'sim'},ctx),r=sig.create({sourceEntity:'sale_contract',sourceRecordId:c.id,sourceContent:'snapshot',providerId:provider.id,idempotencyKey:'sig-1'},ctx);
 sig.addSigner(r.id,{email:'one@example.test',name:'One',order:1});sig.addSigner(r.id,{email:'two@example.test',name:'Two',order:2});sig.prepare(r.id);sig.send(r.id);sig.view(r.id,'view-1');assert.equal(sig.sign(r.id,1,'sign-1').status,'partially_signed');assert.equal(sig.sign(r.id,2,'sign-2').status,'completed');assert.equal(sig.verify(r.id).valid,true);
});

test('service records and signature evidence are company isolated',async()=>{
 const file=dbPath();await freshInstall({dbPath:file});const db=openMigrationDatabase(file),a={companyId:'co-a',userId:'a'},b={companyId:'co-b',userId:'b'},svc=createServiceEntitlementService(db);
 const c=svc.createContract({customerId:'customer',contractNumber:'SC-A',startDate:'2026-01-01',endDate:'2026-12-31',idempotencyKey:'company-a'},a);
 assert.throws(()=>svc.transition(c.id,'validated',b),{code:'COMPANY_SCOPE_DENIED'});
 const sig=new ElectronicSignatureService(db),provider=sig.provider({name:'sim'},a),r=sig.create({sourceEntity:'service_contract',sourceRecordId:c.id,sourceContent:'immutable',providerId:provider.id,idempotencyKey:'sig-a'},a);
 sig.addSigner(r.id,{email:'one@example.test',name:'One',order:1},a);sig.addSigner(r.id,{email:'two@example.test',name:'Two',order:2},a);sig.prepare(r.id,a);sig.send(r.id,a);
 assert.throws(()=>sig.sign(r.id,2,'second-first',a),{code:'SIGNING_ORDER_REQUIRED'});assert.throws(()=>sig.verify(r.id,b),{code:'COMPANY_SCOPE_DENIED'});
});
