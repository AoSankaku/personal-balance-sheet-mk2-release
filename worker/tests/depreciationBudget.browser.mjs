// Run against the disposable depreciationBudgetQaServer, never a real D1 API.
// Usage: node <this file> <absolute path to an installed playwright package>
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const require=createRequire(import.meta.url);
const { chromium }=require(process.argv[2] || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
let page;
try {
  page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{localStorage.setItem('locale','ja');localStorage.setItem('display_currency','JPY');});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:5173';
  const modal=page.getByRole('dialog',{name:'予算分割振替の設定・修正',exact:true});
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    for(const path of ['/fs/budget','/fs/bs']) {
      await page.goto(origin+path);
      await page.getByRole('button',{name:/予算分割振替の設定・修正$/}).first().click();
      await modal.waitFor();
      assert.equal(/[①②③]/.test(await modal.innerText()),false);
      await modal.getByRole('button',{name:'キャンセル',exact:true}).click();
      await modal.waitFor({state:'hidden'});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/fs/report');
  await page.getByRole('heading',{name:'予算分割振替の進捗',exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:/予算分割振替の設定・修正/}).count(),0);
  await page.goto(origin+'/fs/budget');
  await page.getByRole('button',{name:/予算分割振替の設定・修正$/}).first().waitFor();
  await page.getByRole('button',{name:/^要確認:/}).click();
  const taskMenu=page.getByRole('dialog',{name:/要確認/});
  await taskMenu.getByRole('button',{name:/予算分割振替の設定・修正/}).click();
  await modal.waitFor();
  await taskMenu.waitFor({state:'hidden'});
  assert.deepEqual(await modal.locator('input[type=radio]').evaluateAll(inputs=>inputs.map(input=>input.value)),['assigned','special','unallocated']);
  await modal.getByRole('radio',{name:/未割当から支出/}).check();
  assert.match(await modal.innerText(),/購入額.*未割当資金.*一括/);
  assert.match(await modal.innerText(),/毎月の予算振替は行いません/);
  assert.equal(/[①②③]/.test(await modal.innerText()),false);
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  assert.equal(await modal.getByRole('button',{name:'プレビューした変更を適用',exact:true}).isEnabled(),false);
  await modal.getByRole('checkbox').check();
  const unallocatedResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/preview'));
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  const unallocated=await (await unallocatedResponse).json();
  assert.equal(unallocated.can_apply,true);
  assert.equal(unallocated.changes.length,0);
  await modal.getByRole('radio',{name:/割当済み予算から支出/}).check();
  await modal.getByLabel(/購入時の負担予算|購入時に負担するカテゴリ/).click();
  await page.getByRole('option',{name:'貯蓄',exact:true}).click();
  const sourceEditor=modal.getByTestId('depreciation-monthly-source-editor').first();
  for(const [id,ratio] of [[1003,'0'],[1002,'100']]) {
    const control=sourceEditor.getByTestId(`monthly-source-ratio-${id}`);
    const input=control.locator('input');
    await (await input.count()?input:control).fill(ratio);
    await page.keyboard.press('Tab');
  }
  const missingDecisionsResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/preview'));
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  const missing=await (await missingDecisionsResponse).json();
  assert.equal(missing.can_apply,false);
  assert.equal(missing.boundaries.length,2);
  const decisions=modal.getByLabel(/このリセットへの対応/);
  for(let index=0;index<2;index++) {
    await decisions.nth(index).click();
    await page.getByRole('option',{name:/継続/}).click();
  }
  const previewResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/preview'));
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  const preview=await (await previewResponse).json();
  assert.equal(preview.can_apply,true);
  for(const item of preview.timeline) assert.equal(item.before.T,item.after.T);
  // Purchase was fully funded then; a later reset must not create a false shortage warning.
  assert.equal(await modal.getByTestId('depreciation-purchase-negative-warning').count(),0);
  if(process.env.DEPRECIATION_QA_SCREENSHOT) await page.screenshot({path:process.env.DEPRECIATION_QA_SCREENSHOT,fullPage:true});
  await modal.getByRole('button',{name:'プレビューした変更を適用',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'予算分割振替の変更を適用しますか？',exact:true});
  const applyResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/apply'));
  const scheduleRefresh=page.waitForResponse(response=>response.url().endsWith('/api/depreciation')&&response.request().method()==='GET');
  await confirm.getByRole('button',{name:'確認',exact:true}).click();
  assert.equal((await applyResponse).status(),200);
  await scheduleRefresh;
  await page.getByRole('dialog',{name:'予算分割振替の設定・修正',exact:true}).waitFor({state:'hidden'});
  const schedules=await (await page.request.get('http://127.0.0.1:5173/api/depreciation')).json();
  assert.equal(schedules[0].budget.method,'assigned');
  assert.equal(schedules[0].budget.reimbursed_amount,40000);
  assert.equal(schedules[0].budget.remaining_amount,260000);
  await page.getByRole('button',{name:/^要確認:/}).click();
  await taskMenu.waitFor();
  await taskMenu.getByRole('button',{name:/予算分割振替の設定・修正/}).waitFor({state:'hidden'});
  assert.equal(await taskMenu.getByRole('button',{name:/予算分割振替の設定・修正/}).count(),0);
  await page.evaluate(()=>localStorage.setItem('privacy:mode','true'));
  let privateScheduleRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/depreciation')privateScheduleRequests++;});
  await page.goto(origin+'/fs/bs');
  await page.getByText('テスト機器',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:/予算分割振替の設定・修正/}).count(),0);
  assert.equal(privateScheduleRequests,0);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'PASS',checks:['desktop/mobile budget page entrypoint','desktop/mobile balance sheet entrypoint','header task direct entrypoint','read-only report','no instruction numbers','method order','unallocated warning/consent','unset repair','reset decisions','T unchanged','confirmed apply','task cleared','privacy blocks reads/actions','lifetime progress'],progress:schedules[0].budget,errors}));
} catch(error) {
  mkdirSync('.tmp/monthly-sources-qa',{recursive:true});
  if(page) writeFileSync('.tmp/monthly-sources-qa/entrypoints-failure.aria.txt',await page.locator('body').ariaSnapshot());
  throw error;
} finally { await browser.close(); }
