// Build first. Real APIs, isolated data and browser storage for refunds and offline form recovery.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'taskie-refunds-drafts-'));
const db=getDb(':memory:');db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app=buildApp({db,logger:false,deviceAuth:false,backupIntervalHours:0,uploadDir:path.join(dir,'uploads'),backupDir:path.join(dir,'backups'),authorizedTokensFile:path.join(dir,'tokens'),clientDistDir:path.resolve(__dirname,'../frontend/dist')});
let browser;const errors=[];
const pass=message=>console.log('PASS',message);
async function screenshot(page,name){if(process.env.SMOKE_SCREENSHOT_DIR){fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.SMOKE_SCREENSHOT_DIR,name+'.png')});}}
async function main(){
 await app.ready();const base=await app.listen({host:'127.0.0.1',port:smokePort()});browser=await chromium.launch(launchOptions());
 for(const width of [390,820,1180])for(const theme of ['light','dark']){
  const child=app.services.childrenService.createChild({name:`草稿${width}${theme}`}),other=app.services.childrenService.createChild({name:`另一个${width}${theme}`});
  const {tasksService:tasks,redemptionsService:rewards}=app.services;
  const earned=tasks.createAdhocTask(child.id,{title:'获得积分',subject:'数学',points:100});tasks.completeDailyTask(earned.id);
  const item=rewards.createItem({title:`活动${width}${theme}`,cost:40});const redemption=rewards.requestRedemption(child.id,item.id);rewards.resolveRedemption(redemption.id,'approved');
  const parentToken=app.jwt.sign({role:'parent',epoch:app.sessionEpoch()});
  const childToken=id=>app.jwt.sign({role:'child',child_id:id,epoch:app.sessionEpoch()});
  const context=await browser.newContext({viewport:{width,height:width===390?844:width===820?1180:820},colorScheme:theme,serviceWorkers:'block',timezoneId:'Pacific/Honolulu'});
  try{
   await context.addInitScript(({token,child,theme})=>{if(!sessionStorage.getItem('draft_test_role')){sessionStorage.setItem('taskie_parent_token',token);sessionStorage.setItem('current_child',JSON.stringify(child));}localStorage.setItem('taskie_theme',theme);localStorage.setItem('app_sound_muted','true');},{token:parentToken,child,theme});
   const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const goto=route=>page.goto(base+route,{waitUntil:'networkidle'});
   const asRole=async(role,record)=>{await page.evaluate(({role,token,child})=>{sessionStorage.removeItem('taskie_parent_token');sessionStorage.removeItem('taskie_child_token');sessionStorage.setItem(`taskie_${role}_token`,token);sessionStorage.setItem('draft_test_role',role);sessionStorage.setItem('current_child',JSON.stringify(child));},{role,token:role==='parent'?parentToken:childToken(record.id),child:record});};
   await goto('/parent/rewards');
   const row=page.locator('[data-redemption-record]').filter({hasText:item.title});
   await row.getByRole('button',{name:'撤销兑换并退分',exact:true}).click();
   let dialog=page.getByRole('dialog',{name:'撤销兑换并退分',exact:true});
   await dialog.getByLabel('撤销原因').fill('活动取消，退回原积分');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await row.getByRole('button',{name:'撤销兑换并退分',exact:true}).click();dialog=page.getByRole('dialog',{name:'撤销兑换并退分',exact:true});
   await dialog.getByRole('button',{name:'恢复草稿'}).click();assert.equal(await dialog.getByLabel('撤销原因').inputValue(),'活动取消，退回原积分');
   await screenshot(page,`refund-${width}-${theme}`);
   let loseRefund=true;
   const refundRoute=async route=>{if(loseRefund){loseRefund=false;await route.fetch();await route.abort();}else await route.continue();};
   await page.route(`**/api/redemptions/${redemption.id}/refund`,refundRoute);
   await dialog.getByRole('button',{name:'确认撤销并退分',exact:true}).click();await dialog.getByRole('button',{name:'按原内容重试'}).waitFor();
   assert.equal(await dialog.getByLabel('撤销原因').isDisabled(),true);
   assert.equal(app.services.rewardsService.getAvailablePoints(child.id),100);
   await dialog.getByRole('button',{name:'按原内容重试'}).click();await dialog.waitFor({state:'hidden'});await page.unroute(`**/api/redemptions/${redemption.id}/refund`,refundRoute);
   await row.getByText('已撤销退分',{exact:true}).waitFor();assert.equal(app.services.rewardsService.getAvailablePoints(child.id),100);
   pass(`${width}/${theme}: refund draft recovers; lost response retries without double credit`);
   await asRole('child',child);await goto(`/child/${child.id}/rewards`);await page.getByText('已撤销退分',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'撤销兑换并退分',exact:true}).count(),0);
   pass(`${width}/${theme}: child sees refund history and restored balance without parent action`);
   await goto(`/child/${child.id}/mistakes`);await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog',{name:'✍️ 添加纯文字错题记录',exact:true});
   await dialog.getByLabel('题目内容与错误原因描述').fill('弱网错题唯一记录');await dialog.getByLabel('选择学科').selectOption('英语');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog',{name:'✍️ 添加纯文字错题记录',exact:true});
   await dialog.getByRole('button',{name:'恢复草稿'}).click();assert.equal(await dialog.getByLabel('选择学科').inputValue(),'英语');
   let loseMistake=true;const mistakeBodies=[];
   const mistakeRoute=async route=>{if(route.request().method()!=='POST')return route.continue();mistakeBodies.push(route.request().postDataJSON());if(loseMistake){loseMistake=false;await route.fetch();await route.abort();}else await route.continue();};
   await page.route('**/api/mistakes',mistakeRoute);await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.getByRole('button',{name:'按原内容重试'}).waitFor();
   await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog',{name:'✍️ 添加纯文字错题记录',exact:true});
   await dialog.getByRole('button',{name:'恢复草稿'}).click();await dialog.getByRole('button',{name:'按原内容重试'}).click();await dialog.waitFor({state:'hidden'});await page.unroute('**/api/mistakes',mistakeRoute);
   assert.equal(mistakeBodies.length,2);assert.deepEqual(mistakeBodies[0],mistakeBodies[1]);assert.equal(db.prepare('SELECT COUNT(*) n FROM mistake_records WHERE child_id = ? AND description = ?').get(child.id,'弱网错题唯一记录').n,1);
   pass(`${width}/${theme}: mistake text and subject survive reload; uncertain creation replays original id`);
   await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('题目内容与错误原因描述').fill('只属于这个孩子的草稿');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await asRole('child',other);await goto(`/child/${other.id}/mistakes`);await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('button',{name:'恢复草稿'}).count(),0);assert.equal(await dialog.getByLabel('题目内容与错误原因描述').inputValue(),'');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await asRole('child',child);await goto(`/child/${child.id}/mistakes`);await page.getByRole('button',{name:'文字录入',exact:false}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'恢复草稿'}).waitFor();await dialog.getByRole('button',{name:'丢弃已存草稿'}).click();await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   pass(`${width}/${theme}: switching children isolates drafts and returning to the same identity recovers them`);
   await asRole('parent',child);await goto('/parent/dashboard');let card=page.locator(`[data-child-summary="${child.id}"]`);
   await card.getByRole('button',{name:'➕ 添加',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('任务名称').fill('临时任务草稿');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await page.reload({waitUntil:'networkidle'});card=page.locator(`[data-child-summary="${child.id}"]`);await card.getByRole('button',{name:'➕ 添加',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'恢复草稿'}).click();assert.equal(await dialog.getByLabel('任务名称').inputValue(),'临时任务草稿');
   await page.evaluate(()=>{window.originalDraftSetter=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(this===localStorage&&key.startsWith('taskie_form_draft_v1:'))throw new Error('storage full');return window.originalDraftSetter.call(this,key,value);};});
   let creates=0;const countCreate=route=>{if(route.request().method()==='POST')creates++;return route.continue();};await page.route(`**/api/children/${child.id}/adhoc-tasks`,countCreate);
   await dialog.getByRole('button',{name:'确认添加',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'本次尚未提交'}).waitFor();assert.equal(creates,0);
   await page.evaluate(()=>{Storage.prototype.setItem=window.originalDraftSetter;delete window.originalDraftSetter;});await dialog.getByLabel('任务名称').fill('存储恢复后的新内容');await dialog.getByRole('button',{name:'确认添加',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.unroute(`**/api/children/${child.id}/adhoc-tasks`,countCreate);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM daily_tasks WHERE child_id = ? AND title = '存储恢复后的新内容'").get(child.id).n,1);
   pass(`${width}/${theme}: task draft recovers; storage failure stops HTTP and later sends only current input`);
   await goto(`/child/${child.id}/homework`);await page.getByRole('button',{name:'➕ 记作业',exact:true}).click();dialog=page.getByRole('dialog',{name:'📒 记作业',exact:true});
   await dialog.getByLabel('其他科目').selectOption('数学');await dialog.getByLabel('作业内容',{exact:true}).fill('需要恢复的课程作业');await dialog.getByLabel('截止日期',{exact:true}).fill(shiftDate(getTodayDate(),2));
   await dialog.getByRole('checkbox',{name:/生成打卡任务/}).check();await dialog.getByLabel('奖励积分',{exact:true}).fill('23');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
   await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'➕ 记作业',exact:true}).click();dialog=page.getByRole('dialog',{name:'📒 记作业',exact:true});await dialog.getByRole('button',{name:'恢复草稿'}).click();
   assert.equal(await dialog.getByLabel('作业内容',{exact:true}).inputValue(),'需要恢复的课程作业');assert.equal(await dialog.getByLabel('奖励积分',{exact:true}).inputValue(),'23');
   let loseHomework=true;const homeworkBodies=[];
   const homeworkRoute=async route=>{if(route.request().method()!=='POST')return route.continue();homeworkBodies.push(route.request().postDataJSON());if(loseHomework){loseHomework=false;await route.fetch();await route.abort();}else await route.continue();};
   await page.route(`**/api/children/${child.id}/homework`,homeworkRoute);await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.getByRole('button',{name:'按原内容重试'}).waitFor();await dialog.getByRole('button',{name:'按原内容重试'}).click();await dialog.waitFor({state:'hidden'});await page.unroute(`**/api/children/${child.id}/homework`,homeworkRoute);
   assert.deepEqual(homeworkBodies[0],homeworkBodies[1]);assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_records WHERE child_id = ? AND content = ?').get(child.id,'需要恢复的课程作业').n,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   pass(`${width}/${theme}: homework course, dates and points recover; lost response creates one record and task`);
  }catch(error){await reportBrowserFailure(`Refunds and drafts ${width}/${theme}`,error,context);throw error;}
  finally{await context.close();}
 }
 assert.deepEqual(errors,[]);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try{if(browser)await browser.close();}finally{await app.close();if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});}});
