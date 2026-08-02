import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import http from 'node:http'; import os from 'node:os'; import path from 'node:path';
import { freshInstall, openMigrationDatabase } from '../../database/migration-runner/index.mjs';
import { createPlatformAuthority } from '../../platform-runtime-bridge.mjs';
import { createApiHandler } from '../../platform/api/index.mjs';

test('BUILD-07C/D real Chromium renders scoped service workspaces', async () => {
 const dbPath=path.join(os.tmpdir(),`octagon-b07-browser-${Date.now()}.db`);await freshInstall({dbPath});const dialect=openMigrationDatabase(dbPath),authority=createPlatformAuthority(dialect),ctx={companyId:'default',userId:'browser-user'};
 const contract=authority.serviceEntitlementService.createContract({customerId:'browser-customer',contractNumber:'BROWSER-1',startDate:'2026-01-01',endDate:'2026-12-31',idempotencyKey:'browser-contract'},ctx);
 const provider=authority.electronicSignatureService.provider({name:'sim'},ctx);authority.electronicSignatureService.create({sourceEntity:'service_contract',sourceRecordId:contract.id,sourceContent:'browser snapshot',providerId:provider.id,idempotencyKey:'browser-signature'},ctx);
 const api=createApiHandler({dialect,prefix:'/api/v1',actionExecutor:authority.actionExecutor,resolveContext:()=>({...ctx,tenantId:'default',branchId:'default',actorType:'user',correlationId:'browser-proof'}),authorize:()=>({allowed:true})});
 const routes={ '/service_contracts':'views/service_contracts.html','/entitlements':'views/entitlements.html','/electronic_signatures':'views/electronic_signatures.html' };
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(routes[url.pathname]){res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.resolve(routes[url.pathname])));return;}if(api(req,res,url))return;res.writeHead(404);res.end();});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await (await import('puppeteer')).default.launch({headless:true,args:['--no-sandbox']});try{const base=`http://127.0.0.1:${server.address().port}`;for(const [route,expected] of [['/service_contracts','BROWSER-1'],['/electronic_signatures','service_contract']]){const page=await browser.newPage();await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:10000});await page.waitForFunction(value=>document.body.textContent.includes(value),{timeout:10000},expected);assert.match(await page.content(),new RegExp(expected));await page.close();}}finally{await browser.close();await new Promise(resolve=>server.close(resolve));dialect.close();fs.unlinkSync(dbPath);}
});
