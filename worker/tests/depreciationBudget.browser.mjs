// Run against the disposable depreciationBudgetQaServer, never a real D1 API.
// Usage: node <this file> <absolute path to an installed playwright package>
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const { chromium }=require(process.argv[2] || 'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(10000);
  await page.addInitScript(()=>{localStorage.setItem('locale','ja');localStorage.setItem('display_currency','JPY');});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/fs/report');
  await page.getByRole('button',{name:'予算負担を設定・修正'}).waitFor();
  await page.getByRole('button',{name:'予算負担を設定・修正'}).click();
  await page.getByRole('dialog').waitFor();
  const modal=page.getByRole('dialog');
  assert.deepEqual(await modal.locator('input[type=radio]').evaluateAll(inputs=>inputs.map(input=>input.value)),['assigned','special','unallocated']);
  await modal.getByRole('radio',{name:/③/}).check();
  assert.ok((await modal.innerText()).includes('未割当で購入額の予算対象分を一括負担します。'));
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  assert.equal(await modal.getByRole('button',{name:'プレビューした変更を適用',exact:true}).isEnabled(),false);
  await modal.getByRole('checkbox').check();
  const unallocatedResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/preview'));
  await modal.getByRole('button',{name:'変更をプレビュー',exact:true}).click();
  const unallocated=await (await unallocatedResponse).json();
  assert.equal(unallocated.can_apply,true);
  assert.equal(unallocated.changes.length,0);
  await modal.getByRole('radio',{name:/②/}).check();
  await modal.getByLabel(/購入時の負担予算|購入時に負担するカテゴリ/).click();
  await page.getByRole('option',{name:'貯蓄',exact:true}).click();
  await modal.getByLabel(/毎月の振替元予算|月次減価償却の原資カテゴリ/).click();
  await page.getByRole('option',{name:'生活費',exact:true}).click();
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
  const confirm=page.getByRole('dialog',{name:'減価償却の予算変更を適用しますか？',exact:true});
  const applyResponse=page.waitForResponse(response=>response.url().endsWith('/100/budget/apply'));
  await confirm.getByRole('button',{name:'確認',exact:true}).click();
  assert.equal((await applyResponse).status(),200);
  await page.getByRole('dialog',{name:'減価償却の予算処理を修正',exact:true}).waitFor({state:'hidden'});
  const schedules=await (await page.request.get('http://127.0.0.1:5173/api/depreciation')).json();
  assert.equal(schedules[0].budget.method,'assigned');
  assert.equal(schedules[0].budget.reimbursed_amount,40000);
  assert.equal(schedules[0].budget.remaining_amount,260000);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({result:'PASS',checks:['method order','unallocated warning/consent','unset repair','reset decisions','T unchanged','confirmed apply','lifetime progress'],progress:schedules[0].budget,errors}));
} finally { await browser.close(); }
