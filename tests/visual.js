import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
mkdirSync('test-results',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.TEST_URL||'http://localhost:3001';
for(const width of [360,375,390,412,1440]){
 await page.setViewportSize({width,height:width>1000?1080:844});
 for(const route of ['/','/usdt','/exchange','/track','/help','/admin']){
  await page.goto(base+route);await page.waitForTimeout(650);
  if(route==='/')await page.getByRole('heading',{name:'حوالاتك المالية ببساطة.'}).waitFor();
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.document<=dimensions.viewport,`${route} overflows at ${width}: ${JSON.stringify(dimensions)}`);
  await page.screenshot({path:`test-results/${width}-${route==='/'?'home':route.slice(1)}.png`,fullPage:true});
 }
}
await page.setViewportSize({width:390,height:844});
await page.goto(base+'/exchange');await page.getByLabel('المبلغ',{exact:true}).fill('100');
await page.getByText('1,250,000',{exact:false}).waitFor();
await page.getByRole('button',{name:'ليرة سورية إلى دولار',exact:true}).click();
await page.getByLabel('المبلغ',{exact:true}).fill('1250000');
await page.getByRole('button',{name:'متابعة',exact:true}).isDisabled().then(disabled=>assert.ok(disabled));
await page.goto(base+'/track');await page.getByPlaceholder('#MRD-…').fill('MRD-NOT-FOUND');await page.getByRole('button',{name:'تتبع الطلب',exact:true}).click();await page.getByRole('alert').waitFor();
assert.deepEqual(errors,[]);
console.log('Visual checks passed: 30 pages, 360 / 375 / 390 / 412 / 1440 px; calculations and missing-order feedback.');
await browser.close();
