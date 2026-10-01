import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { calculate } from '../server/calculation.js';
const directory=mkdtempSync(path.resolve('test-results-db-'));
const password=randomBytes(24).toString('hex');
const env={...process.env,DATA_DIR:directory,PORT:'3198',ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD:password,NODE_ENV:'test'};
let server,cookie,configuration;
async function request(url,body,method=body?'POST':'GET',auth=false){const r=await fetch('http://127.0.0.1:3198/api'+url,{method,headers:{'Content-Type':'application/json',...(auth?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),headers:r.headers};}
before(async()=>{const result=spawnSync(process.execPath,['server/create-admin.js'],{env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);server=spawn(process.execPath,['server/index.js'],{env,stdio:'pipe'});for(let i=0;i<80;i++){try{configuration=(await request('/config')).data;break;}catch{await new Promise(r=>setTimeout(r,150));}}assert.ok(configuration);const login=await request('/admin/login',{username:'test-admin',password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];});
after(async()=>{server?.kill();await new Promise(r=>setTimeout(r,400));rmSync(directory,{recursive:true,force:true});});
test('tier boundaries, fractional amounts, buying with SYP and zero-fee exchange',()=>{
 for(const [amount,percent] of [[10,2],[100,2],[100.01,1.5],[500,1.5],[500.01,1],[1000,1],[1000.01,.5]])assert.equal(calculate({service:'usdt',direction:'sell',balance:'USD',amount},configuration).percent,percent);
 const buy=calculate({service:'usdt',direction:'buy',balance:'SYP',amount:1250000},configuration);assert.equal(buy.finalAmount,98);assert.equal(buy.commission,25000);
 const exchange=calculate({service:'exchange',direction:'syp-usd',amount:1250000},configuration);assert.equal(exchange.finalAmount,100);assert.equal(exchange.commission,0);
 assert.throws(()=>calculate({service:'usdt',direction:'sell',balance:'USD',amount:9},configuration),/الحد الأدنى/);
 assert.throws(()=>calculate({service:'usdt',direction:'sell',balance:'USD',amount:'invalid'},configuration));
});
test('protected admin, hidden internal fields and immutable order snapshots',async()=>{
 assert.equal((await request('/admin/orders')).status,401);
 const admin=(await request('/admin/config',undefined,'GET',true)).data;
 const wallet=admin.wallets.find(w=>w.currency==='USD');
 assert.equal((await request('/admin/wallets/'+wallet.id,{address:'TEST-OFFICE-ACCOUNT'},'PUT',true)).status,200);
 const created=await request('/orders',{service:'exchange',direction:'usd-syp',amount:100,recipient:'TEST-RECIPIENT'});assert.equal(created.status,201);const order=created.data;
 assert.equal(order.final_amount,1250000);assert.equal(order.exchange_rate,12500);assert.equal(order.commission,0);assert.ok(!('internal_note' in order));
 await request('/admin/rate',{rate:15000},'PUT',true);
 await request('/admin/wallets/'+wallet.id,{address:'CHANGED-ACCOUNT'},'PUT',true);
 const old=(await request('/orders/'+order.id)).data;assert.equal(old.exchange_rate,12500);assert.equal(old.deposit_address,'TEST-OFFICE-ACCOUNT');assert.equal(old.final_amount,1250000);
 const newer=(await request('/orders',{service:'exchange',direction:'usd-syp',amount:100,recipient:'TEST-RECIPIENT'})).data;assert.equal(newer.final_amount,1500000);
 const proof=new FormData();proof.append('txid','TESTTXID123456789');let response=await fetch('http://127.0.0.1:3198/api/orders/'+order.id+'/proof',{method:'POST',body:proof});assert.equal(response.status,200);assert.equal((await response.json()).status,'تم إرسال إثبات الدفع');
 await request('/admin/orders/'+order.id,{status:'مكتملة',internal_note:'INTERNAL-SECRET'},'PATCH',true);
 const tracked=(await request('/orders/'+order.id)).data;assert.equal(tracked.status,'مكتملة');assert.ok(!JSON.stringify(tracked).includes('INTERNAL-SECRET'));
 response=await fetch('http://127.0.0.1:3198/api/orders/'+order.id+'/proof',{method:'POST',body:proof});assert.equal(response.status,400);
 const network=admin.networks[0];await request('/admin/networks/'+network.id,{...network,address:'TEST-DEPOSIT-ADDRESS',active:true},'PUT',true);
 const sold=(await request('/orders',{service:'usdt',direction:'sell',amount:100,balance:'USD',network:network.id,recipient:'TEST-RECIPIENT'})).data;assert.equal(sold.commission,2);assert.equal(sold.final_amount,98);
 await request('/admin/tiers/'+admin.tiers[0].id,{...admin.tiers[0],percent:3},'PUT',true);
 assert.equal((await request('/orders/'+sold.id)).data.commission,2);
 assert.equal((await request('/orders',{service:'usdt',direction:'sell',amount:100,balance:'USD',network:network.id,recipient:'TEST-RECIPIENT'})).data.commission,3);
 const badProof=new FormData();badProof.append('proof',new Blob(['<html>bad file</html>'],{type:'image/png'}),'fake.png');assert.equal((await fetch('http://127.0.0.1:3198/api/orders/'+sold.id+'/proof',{method:'POST',body:badProof})).status,400);
 assert.equal((await request('/orders',{service:'usdt',direction:'buy',amount:100,balance:'USD',network:network.id,recipient:'invalid-wallet'})).status,400);
 const badOrigin=await fetch('http://127.0.0.1:3198/api/admin/rate',{method:'PUT',headers:{'Content-Type':'application/json',cookie,Origin:'https://other.example'},body:JSON.stringify({rate:1})});assert.equal(badOrigin.status,403);
});
test('fixed commissions cover both directions and currencies, with safe minimums',()=>{
 const c=structuredClone(configuration);c.tiers[0]={...c.tiers[0],type:'fixed',fixed_amount:2.5,percent:0};
 for(const [direction,balance,amount,commission,finalAmount] of [
  ['sell','USD',100,2.5,97.5],['sell','SYP',100,2.5,1218750],
  ['buy','USD',100,2.5,97.5],['buy','SYP',1250000,31250,97.5],
  ['sell','USD',50,2.5,47.5],
 ]){
  const q=calculate({service:'usdt',direction,balance,amount},c);
  assert.equal(q.commissionType,'fixed');assert.equal(q.fixedAmount,2.5);assert.equal(q.percent,0);
  assert.equal(q.commission,commission);assert.equal(q.finalAmount,finalAmount);
 }
 assert.equal(calculate({service:'usdt',direction:'sell',balance:'USD',amount:100.01},c).percent,1.5);
 c.tiers[0].fixed_amount=10;
 assert.throws(()=>calculate({service:'usdt',direction:'sell',balance:'USD',amount:10},c),/أكبر من العمولة/);
 assert.throws(()=>calculate({service:'usdt',direction:'buy',balance:'SYP',amount:125000},c),/أكبر من العمولة/);
 c.tiers[0].fixed_amount=0;
 assert.equal(calculate({service:'usdt',direction:'sell',balance:'USD',amount:100},c).finalAmount,100);
 assert.equal(calculate({service:'exchange',direction:'usd-syp',amount:100},c).commission,0);
});
test('fixed tier API validation and immutable fixed-fee orders after rate/tier changes',async()=>{
 const c=(await request('/admin/config',undefined,'GET',true)).data;
 const tier={...c.tiers[0],type:'fixed',fixed_amount:2.5};
 assert.equal((await request('/admin/tiers/'+tier.id,tier,'PUT',true)).status,200);
 for(const invalid of [{type:'invalid'},{fixed_amount:-1},{fixed_amount:'bad'},{fixed_amount:0.0000001},{fixed_amount:100}]){
  assert.equal((await request('/admin/tiers/'+tier.id,{...tier,...invalid},'PUT',true)).status,400);
 }
 const network=c.networks.find(n=>n.active);
 const input={service:'usdt',direction:'sell',amount:100,balance:'USD',network:network.id,recipient:'TEST-RECIPIENT'};
 const response=await request('/orders',input);assert.equal(response.status,201);
 const order=response.data;assert.equal(order.commission_type,'fixed');assert.equal(order.commission_fixed_amount,2.5);assert.equal(order.commission_percent,0);assert.equal(order.final_amount,97.5);
 await request('/admin/tiers/'+tier.id,{...tier,fixed_amount:4},'PUT',true);
 await request('/admin/rate',{rate:20000},'PUT',true);
 const old=(await request('/orders/'+order.id)).data;
 assert.equal(old.commission,2.5);assert.equal(old.commission_fixed_amount,2.5);assert.equal(old.final_amount,97.5);assert.equal(old.exchange_rate,order.exchange_rate);
 assert.equal((await request('/orders',input)).data.commission,4);
 assert.equal((await request('/admin/tiers',{minimum:2000,maximum:3000,type:'fixed',fixed_amount:5,active:0},'POST',true)).status,200);
});
