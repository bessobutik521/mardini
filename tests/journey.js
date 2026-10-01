import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
mkdirSync('test-results',{recursive:true});
const dir=mkdtempSync(path.resolve('test-results-journey-'));
const password=randomBytes(20).toString('hex');
const env={...process.env,DATA_DIR:dir,PORT:'3197',ADMIN_USERNAME:'journey-admin',ADMIN_PASSWORD:password,NODE_ENV:'test'};
const setup=spawnSync(process.execPath,['server/create-admin.js'],{env,encoding:'utf8'});assert.equal(setup.status,0,setup.stderr);
const server=spawn(process.execPath,['server/index.js'],{env,stdio:'pipe'});
let browser;
try{
 for(let i=0;i<80;i++){try{await fetch('http://localhost:3197/api/config');break;}catch{await new Promise(r=>setTimeout(r,150));}}
 browser=await chromium.launch({channel:'msedge'});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3197/admin');
 await page.getByLabel('اسم المستخدم').fill('journey-admin');await page.getByLabel('كلمة المرور').fill(password);await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();
 await page.getByRole('button',{name:'الشبكات والعناوين',exact:true}).click();
 const wallet=page.locator('form').filter({has:page.getByRole('heading',{name:'شام كاش · دولار',exact:true})});
 await wallet.getByLabel('رقم / حساب الاستقبال').fill('TEST-OFFICE-USD');await wallet.getByRole('button',{name:'حفظ التغييرات'}).click();await page.getByRole('status').waitFor();
 const network=page.locator('form').filter({has:page.getByRole('heading',{name:'TRC20',exact:true})});
 await network.getByLabel('عنوان الإيداع').fill('TEST-TRC20-DEPOSIT');await network.getByLabel('مفعلة',{exact:true}).check();await network.getByRole('button',{name:'حفظ التغييرات'}).click();await page.waitForTimeout(300);
  await page.getByRole('button',{name:'العمولات',exact:true}).click();await page.getByRole('heading',{name:'إضافة شريحة جديدة'}).waitFor();
 const tierForm=page.locator('form').filter({has:page.getByRole('heading',{name:'شريحة عمولة',exact:true})}).first();
 await tierForm.getByLabel('نوع العمولة').selectOption('fixed');
 await tierForm.getByLabel('العمولة الثابتة (دولار / USDT)').fill('2.5');
 await tierForm.getByRole('button',{name:'حفظ التغييرات'}).click();await page.getByRole('status').waitFor();
 await page.reload();await page.getByRole('button',{name:'العمولات',exact:true}).click();
 assert.equal(await tierForm.getByLabel('نوع العمولة').inputValue(),'fixed');
 assert.equal(await tierForm.getByLabel('العمولة الثابتة (دولار / USDT)').inputValue(),'2.5');
 await page.screenshot({path:'test-results/admin-tiers-desktop.png',fullPage:true});
 const customer=await browser.newPage({viewport:{width:390,height:844}});customer.on('pageerror',e=>errors.push(e.message));
 await customer.goto('http://localhost:3197/usdt');await customer.getByLabel('المبلغ',{exact:true}).fill('100');await customer.getByPlaceholder('رقم الحساب').fill('TEST-CUSTOMER');await customer.getByRole('button',{name:'متابعة',exact:true}).click();await customer.getByRole('heading',{name:'تم إنشاء طلبك بنجاح'}).waitFor();
  const id=new URL(customer.url()).pathname.split('/')[2];
 await customer.getByText('2.5 USDT (عمولة ثابتة)',{exact:true}).waitFor();
 await customer.locator('.order-total').getByText('97.5',{exact:false}).waitFor();
 for(const width of [360,375,390,412]){await customer.setViewportSize({width,height:844});assert.ok(await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await customer.screenshot({path:`test-results/${width}-order-created.png`,fullPage:true});}
 await customer.getByLabel('رقم التحويل TXID').fill('TEST-TXID-12345678');await customer.getByRole('button',{name:'إرسال إثبات الدفع',exact:true}).click();await customer.locator('.status').getByText('تم إرسال إثبات الدفع',{exact:true}).waitFor();
 await page.reload();await page.getByRole('button',{name:'الطلبات',exact:true}).click();await page.locator('.order-list-row').first().click();await page.getByLabel('حالة الطلب').selectOption('مكتملة');await page.getByLabel('ملاحظة داخلية').fill('INTERNAL ONLY');await page.getByRole('button',{name:'حفظ التغييرات'}).click();await page.getByRole('status').waitFor();
 await page.screenshot({path:'test-results/admin-order-desktop.png',fullPage:true});
 for(const width of [360,375,390,412]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/${width}-admin-order.png`,fullPage:true});}
 await customer.goto('http://localhost:3197/track');await customer.getByPlaceholder('#MRD-…').fill(id);await customer.getByRole('button',{name:'تتبع الطلب',exact:true}).click();await customer.locator('.status').getByText('مكتملة',{exact:true}).waitFor();assert.ok(!(await customer.locator('body').innerText()).includes('INTERNAL ONLY'));
 await customer.screenshot({path:'test-results/order-completed.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Full browser journey passed: admin configuration, USDT order, proof, manual completion, public tracking and responsive admin/order pages.');
}finally{await browser?.close();server.kill();await new Promise(r=>setTimeout(r,400));rmSync(dir,{recursive:true,force:true});}
