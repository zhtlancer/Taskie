const assert = require('node:assert/strict');

async function within(promise) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Timed out waiting for held read')),15000);})]); }
  finally {clearTimeout(timer);}
}
async function holdOnce(page, pattern, failure) {
  let release, started, finished;
  const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;}),done=new Promise(resolve=>{finished=resolve;});
  const handler=async route=>{
    try {
      const response=await route.fetch();started();await gate;
      if(failure)await route.fulfill({status:503,json:{error:failure}});
      else await route.fulfill({response});
    } catch {} finally {finished();}
  };
  await page.route(pattern,handler,{times:1});
  return {began,release,done,close:async()=>{release();await page.unroute(pattern,handler);}};
}

async function checkWordStudyStates({browser,base,api,parentToken,openContext,errors}) {
  for(const [width,theme] of [[390,'light'],[820,'dark']]) {
    const child=await api('POST','/children',{name:`学习读取${width}`});
    await api('POST','/english-words',{child_id:child.id,word:'stateword',definition_zh:'状态验收'});
    await api('POST','/characters',{child_id:child.id,char:'山',pinyin:'shān'});
    for(const lang of ['zh','en'])await api('PUT',`/children/${child.id}/word-study${lang==='en'?'/en':''}/plans/recognize`,{days_of_week:[0,1,2,3,4,5,6],new_target:1,review_target:1,categories:[]});
    const {context,page}=await openContext(browser,base,width,theme,parentToken,child,'parent',errors);
    try {
      let failBook=true;
      const bookPattern=`**/api/english-words?child_id=${child.id}`;
      await page.route(bookPattern,route=>failBook?route.fulfill({status:503,json:{error:'词本首次读取失败'}}):route.continue());
      await page.goto(`${base}/child/${child.id}/characters?lang=en`,{waitUntil:'domcontentloaded'});
      await page.getByRole('alert').getByText('英语单词本未能读取',{exact:true}).waitFor();
      assert.match(await page.locator('[data-english-summary]').textContent(),/共 — 词/);
      assert.equal(await page.locator('[data-english-empty]').count(),0);
      failBook=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();
      const card=page.locator('[data-english-word-card="stateword"]');await card.waitFor();
      const bookHold=await holdOnce(page,bookPattern,'词本更新失败');
      try {
        await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await within(bookHold.began);
        await page.locator('[data-english-refresh]').getByText('正在更新英语单词本，当前显示上次读取的数据。',{exact:true}).waitFor();
        await card.waitFor();bookHold.release();await within(bookHold.done);
        await page.locator('[data-english-refresh]').getByText(/更新未成功/).waitFor();await card.waitFor();
      } finally {await bookHold.close();}
      await page.locator('[data-english-refresh]').getByRole('button',{name:'重新读取',exact:true}).click();
      await page.locator('[data-english-refresh]').waitFor({state:'detached'});
      await page.unroute(bookPattern);

      for(const lang of ['en','zh']) {
        const overviewPattern=url=>url.pathname===`/api/children/${child.id}/word-study`;
        const historyPattern=url=>url.pathname===`/api/children/${child.id}/word-study/history`;
        let overviewFailed=true,historyFailed=true,overviewReads=0;
        const overviewHandler=route=>{overviewReads++;return overviewFailed?route.fulfill({status:503,json:{error:'今日清单暂不可用'}}):route.continue();};
        const historyHandler=route=>historyFailed?route.fulfill({status:503,json:{error:'学习记录暂不可用'}}):route.continue();
        await page.route(overviewPattern,overviewHandler);await page.route(historyPattern,historyHandler);
        await page.goto(`${base}/child/${child.id}/word-study?language=${lang}`,{waitUntil:'domcontentloaded'});
        await page.getByRole('alert').getByText('学习清单未能读取',{exact:true}).waitFor();
        assert.equal(await page.locator('[data-study-empty]').count(),0);
        await page.locator('[data-study-history]').getByText('学习记录暂不可用',{exact:true}).waitFor();
        overviewFailed=false;
        await page.locator('[data-page-state="error"]').getByRole('button',{name:'重新读取',exact:true}).click();
        const day=page.locator('[data-study-day-skill="recognize"]');await day.waitFor();
        assert.equal(await day.getByRole('button',{name:/开始 \/ 继续学习/}).isEnabled(),true,'history failure must not block practice');
        const before=overviewReads;historyFailed=false;
        await page.getByRole('button',{name:'重新读取记录',exact:true}).click();
        await page.locator('[data-study-history]').getByText('最近学习记录',{exact:true}).waitFor();
        assert.equal(overviewReads,before,'history retry must not reload or regenerate the overview');
        const overviewHold=await holdOnce(page,overviewPattern,'学习清单更新失败');
        try {
          await page.getByRole('button',{name:'刷新安排',exact:true}).click();await within(overviewHold.began);
          await page.locator('[data-study-refresh]').getByText('正在更新学习清单，当前显示上次读取的数据。',{exact:true}).waitFor();
          await day.waitFor();overviewHold.release();await within(overviewHold.done);
          await page.locator('[data-study-refresh]').getByText(/更新未成功/).waitFor();await day.waitFor();
        } finally {await overviewHold.close();}
        await page.getByRole('button',{name:'重新读取清单',exact:true}).click();
        await page.locator('[data-study-refresh]').waitFor({state:'detached'});

        // A restore supersedes an older accepted response without leaking its history or loading lock.
        const historyHold=await holdOnce(page,historyPattern);
        try {
          await page.getByRole('button',{name:'刷新安排',exact:true}).click();await within(historyHold.began);
          await day.waitFor();
          await page.evaluate(()=>window.dispatchEvent(new Event('taskie:data-restored')));
          await day.waitFor();historyHold.release();await within(historyHold.done);
          await page.locator('[data-study-history]').getByText('最近学习记录',{exact:true}).waitFor();
          assert.equal(await page.locator('[data-study-history] [role="status"]').count(),0);
        } finally {await historyHold.close();}
        await page.unroute(overviewPattern,overviewHandler);await page.unroute(historyPattern,historyHandler);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      }

      // A child switch clears known data synchronously and rejects the delayed old overview.
      const emptyChild=await api('POST','/children',{name:`空清单${width}`});
      const oldPattern=url=>url.pathname===`/api/children/${child.id}/word-study`;
      const oldRead=await holdOnce(page,oldPattern);
      try {
        await page.getByRole('button',{name:'刷新安排',exact:true}).click();await within(oldRead.began);
        await page.evaluate(path=>document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(path),`/child/${emptyChild.id}/word-study?language=zh`);
        await page.locator('[data-study-empty]').waitFor();
        oldRead.release();await within(oldRead.done);
        assert.equal(await page.locator('[data-study-day-skill]').count(),0);
        await page.locator('[data-study-history]').getByText('暂无学习记录。',{exact:true}).waitFor();
      } finally {await oldRead.close();}

      let failPlan=true,failTaxonomy=true;
      const planPattern=url=>url.pathname===`/api/children/${child.id}/word-study`;
      const taxPattern=`**/api/english-words/taxonomy?child_id=${child.id}`;
      await page.route(planPattern,route=>failPlan?route.fulfill({status:503,json:{error:'计划读取暂不可用'}}):route.continue());
      await page.route(taxPattern,route=>failTaxonomy?route.fulfill({status:503,json:{error:'教材范围暂不可用'}}):route.continue());
      await page.goto(`${base}/parent/word-plans?child=${child.id}`,{waitUntil:'domcontentloaded'});
      await page.getByRole('alert').getByText('学习计划未能读取',{exact:true}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'语文字词认读',exact:true}).count(),0,'failed plan reads must not show default forms as saved plans');
      failPlan=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();
      await page.getByRole('heading',{name:'语文字词认读',exact:true}).waitFor();
      await page.getByRole('tab',{name:/英语单词计划/}).click();
      await page.getByRole('alert').getByText('教材范围暂不可用',{exact:true}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'英语单词认读',exact:true}).count(),0);
      failTaxonomy=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();
      const plan=page.locator('article').filter({has:page.getByRole('heading',{name:'英语单词认读',exact:true})});
      assert.equal(await plan.getByLabel('每日新学目标',{exact:true}).inputValue(),'1','retry must recover the saved parent target');
      await page.unroute(planPattern);await page.unroute(taxPattern);
      console.log(`PASS learning states ${width}/${theme}: first-read failures, no false empty, retained refresh, independent history retry, restore isolation and Chinese/English compatibility`);
    } finally {await context.close();}
  }
}
module.exports=checkWordStudyStates;

if(require.main===module)(async()=>{
  const path=require('node:path');
  const {chromium,launchOptions,smokePort}=require('./browser-env.cjs');
  const {createTestApp,cleanupTestApp}=require('../backend/test/helper');
  const ctx=createTestApp({clientDistDir:path.resolve(__dirname,'../frontend/dist'),dictDir:'off'});let browser;
  try {
    await ctx.app.ready();const base=await ctx.app.listen({host:'127.0.0.1',port:smokePort()});
    const parentToken=ctx.app.jwt.sign({role:'parent',epoch:ctx.app.sessionEpoch()});
    const api=async(method,url,payload)=>{const res=await ctx.app.inject({method,url:`/api${url}`,payload});assert.ok(res.statusCode<300,res.body);return res.json();};
    const openContext=async(browser,base,width,theme,token,child,role,errors)=>{
      const context=await browser.newContext({viewport:{width,height:width<500?844:1024},colorScheme:theme,hasTouch:true,serviceWorkers:'block',reducedMotion:'reduce'});
      await context.addInitScript(({token,child,role,theme})=>{sessionStorage.setItem(`taskie_${role}_token`,token);sessionStorage.setItem('current_child',JSON.stringify(child));localStorage.setItem('taskie_theme',theme);localStorage.setItem('app_sound_muted','true');},{token,child,role,theme});
      const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());return {context,page};
    };
    browser=await chromium.launch(launchOptions());const errors=[];
    await checkWordStudyStates({browser,base,api,parentToken,openContext,errors});assert.deepEqual(errors,[]);
  } finally {await browser?.close();await ctx.app.close();cleanupTestApp(ctx);}
})().catch(error=>{console.error(error);process.exitCode=1;});
