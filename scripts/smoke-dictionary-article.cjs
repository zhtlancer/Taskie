// Build first. Real server, isolated database, generated raster images and authenticated browser fetches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeImageFixture } = require('../backend/test/dictionary-image-fixture');

async function checkDictionaryArticle({ browser, base, api, parentToken, openContext, errors, dictionaryService: dictionary }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-article-browser-'));
  const keys = ['dictDir', 'cacheDir', 'indexPath', 'audioCacheDir'];
  const previous = Object.fromEntries(keys.map(key=>[key,dictionary[key]]));
  await dictionary.buildPromise;
  dictionary.releaseIndex();
  Object.assign(dictionary,{dictDir:path.join(root,'dicts'),cacheDir:path.join(root,'cache'),indexPath:path.join(root,'cache/index.sqlite'),audioCacheDir:path.join(root,'cache/audio')});
  const { image } = await writeImageFixture(dictionary.dictDir);
  try {
    for (const width of [320,390,820,1024]) for (const theme of ['light','dark']) {
      const child=await api('POST','/children',{name:`原文图片${width}${theme}`});
      await api('POST','/english-words',{child_id:child.id,word:'picture',definition_zh:'课堂中的图片'});
      await api('POST','/english-words',{child_id:child.id,word:'longword',definition_zh:'长文本布局'});
      const {context,page}=await openContext(browser,base,width,theme,parentToken,child,'parent',errors);
      let release=()=>{};
      try {
        await context.addInitScript(()=>{
          window.__imageBlobs=new Set();
          const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
          URL.createObjectURL=value=>{const url=create(value);window.__imageBlobs.add(url);return url;};
          URL.revokeObjectURL=url=>{window.__imageBlobs.delete(url);return revoke(url);};
        });
        let mode='fail', imageRequests=0, started, finished;
        let gate;
        await page.route('**/api/dictionary/image/**',async route=>{
          imageRequests++;
          assert.match(route.request().headers().authorization,/^Bearer /,'images must use the authenticated client');
          if (!new URL(route.request().url()).pathname.endsWith('/table.png')) return route.continue();
          if (mode==='fail') return route.fulfill({status:503,json:{error:'图片暂不可用，可重试'}});
          if (mode==='decode') return route.fulfill({status:200,contentType:'image/png',body:Buffer.from('broken image')});
          if (mode==='hold') {
            started();await gate;
            try { await route.fulfill({status:200,contentType:'image/png',body:image}); } catch {} finally { finished(); }
            return;
          }
          return route.continue();
        });
        await page.goto(`${base}/child/${child.id}/characters?lang=en`,{waitUntil:'domcontentloaded'});
        await page.locator('[data-english-word-card="picture"]').click();
        const detail=page.getByRole('dialog',{name:'picture',exact:true});
        await detail.getByText('课堂中的图片',{exact:true}).waitFor();
        assert.equal(imageRequests,0,'images must not load before the original article is opened');
        await detail.getByRole('button',{name:/查看完整原词典/}).click();
        const article=page.getByRole('dialog',{name:'原词典 · picture',exact:true});
        const tableBox=()=>article.locator('[data-dictionary-image][data-resource*="/table.png?"]');
        await tableBox().scrollIntoViewIfNeeded();
        await tableBox().getByText('图片暂不可用，可重试',{exact:true}).waitFor();
        mode='ready';await tableBox().getByRole('button',{name:'重试图片',exact:true}).click();
        await tableBox().locator('img').waitFor({state:'visible'});
        assert.equal(await tableBox().locator('img').evaluate(img=>img.complete && img.naturalWidth===900),true);
        assert.equal(await tableBox().locator('img').evaluate(img=>getComputedStyle(img).backgroundColor),'rgb(255, 255, 255)');
        assert.equal(await tableBox().locator('img').evaluate(img=>getComputedStyle(img).filter),'none');
        const oldUrl=await tableBox().locator('img').getAttribute('src');
        const missing=article.locator('[data-resource*="/missing.jpg?"]');
        await missing.scrollIntoViewIfNeeded();await missing.getByText('词典图片不存在',{exact:true}).waitFor();
        await article.getByText(/a dictionary illustration/).waitFor();
        const invalid=article.locator('[data-resource*="/invalid.jpg?"]');
        await invalid.scrollIntoViewIfNeeded();await invalid.getByText(/格式无效/).waitFor();
        const controls=await article.locator('button').evaluateAll(buttons=>buttons.filter(button=>button.getClientRects().length).map(button=>({text:button.textContent.trim(),width:button.getBoundingClientRect().width,height:button.getBoundingClientRect().height})));
        assert.deepEqual(controls.filter(control=>control.width<43.9||control.height<43.9),[],'all article buttons and internal links must be at least 44px');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if (process.env.SCREENSHOT_DIR && (width===390&&theme==='light'||width===820&&theme==='dark')) {
          fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
          await tableBox().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`dictionary-article-${width}-${theme}.png`)});
        }
        await article.getByRole('button',{name:'next',exact:true}).click();
        const next=page.getByRole('dialog',{name:'原词典 · next',exact:true});
        await next.locator('[data-resource*="/other.jpg?"] img').waitFor({state:'visible'});
        assert.equal(await page.evaluate(url=>window.__imageBlobs.has(url),oldUrl),false,'navigating must release the old image object URL');
        await next.getByRole('button',{name:'← 返回 picture',exact:true}).click();
        await tableBox().locator('img').waitFor({state:'visible'});
        mode='decode';await article.getByRole('button',{name:'重新读取原词典',exact:true}).click();
        await tableBox().scrollIntoViewIfNeeded();await tableBox().getByText('词典图片无法显示，可以重试',{exact:true}).waitFor();
        mode='ready';await tableBox().getByRole('button',{name:'重试图片',exact:true}).click();
        await tableBox().locator('img').waitFor({state:'visible'});

        // A held successful image response must not restore an image after an internal jump.
        mode='hold';gate=new Promise(resolve=>{release=resolve;});
        const began=new Promise(resolve=>{started=resolve;}),done=new Promise(resolve=>{finished=resolve;});
        await article.getByRole('button',{name:'重新读取原词典',exact:true}).click();
        await tableBox().scrollIntoViewIfNeeded();await began;
        await article.getByRole('button',{name:'next',exact:true}).click();
        await next.getByText(/a different article/).waitFor();
        release();await done;
        await next.locator('img').waitFor({state:'visible'});
        assert.equal(await page.locator('[data-resource*="/table.png?"]').count(),0);
        assert.equal(await page.evaluate(()=>window.__imageBlobs.size),1);
        await next.getByRole('button',{name:'关闭',exact:true}).last().click();
        assert.equal(await page.evaluate(()=>window.__imageBlobs.size),0);
        await detail.getByRole('button',{name:'关闭',exact:true}).last().click();

        mode='ready';await page.locator('[data-english-word-card="longword"]').click();
        const longDetail=page.getByRole('dialog',{name:'longword',exact:true});
        await longDetail.getByRole('button',{name:/查看完整原词典/}).click();
        const longArticle=page.getByRole('dialog',{name:'原词典 · longword',exact:true});
        await longArticle.locator('[data-dictionary-image]').scrollIntoViewIfNeeded();
        await longArticle.locator('img').waitFor({state:'visible'});
        const longLink=await longArticle.getByRole('button',{name:'longword'.repeat(10),exact:true}).boundingBox();
        assert.ok(longLink.width>=44&&longLink.height>=44&&longLink.x+longLink.width<=width);
        assert.equal(await longArticle.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await longArticle.getByRole('button',{name:'关闭',exact:true}).last().click();
        await longDetail.getByRole('button',{name:'关闭',exact:true}).last().click();

        await page.getByRole('button',{name:/批量导入/}).click();
        const batch=page.getByRole('dialog',{name:'批量导入英语单词',exact:true});
        await batch.getByPlaceholder(/apple/).fill(`${'longword'.repeat(10)}\t很长的单词`);
        await batch.getByRole('button',{name:'不查词，手工预览',exact:true}).click();
        const checkbox=batch.getByRole('checkbox',{name:'longword'.repeat(10),exact:true});
        await checkbox.waitFor();
        const target=await checkbox.locator('..').boundingBox();assert.ok(target.height>=44&&target.width>=44);
        await checkbox.uncheck();assert.equal(await checkbox.isChecked(),false);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await batch.getByRole('button',{name:'取消',exact:true}).click();
        console.log(`PASS article ${width}/${theme}: authenticated PNG/JPEG decoding, fallback/retry, links >=44px, original colours, navigation cancellation/revocation and batch touch target`);
      } finally { release();await context.close(); }
    }
  } finally {
    await dictionary.buildPromise?.catch(()=>{});dictionary.releaseIndex();Object.assign(dictionary,previous);fs.rmSync(root,{recursive:true,force:true});
  }
}
module.exports=checkDictionaryArticle;

if (require.main===module) (async()=>{
  const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
  const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
  const ctx=createTestApp({clientDistDir:path.resolve(__dirname,'../frontend/dist')});
  let browser;
  try {
    await ctx.app.ready();const base=await ctx.app.listen({host:'127.0.0.1',port:smokePort()});
    const parentToken=ctx.app.jwt.sign({role:'parent',epoch:ctx.app.sessionEpoch()});
    const api=async(method,url,payload)=>{
      const res=await ctx.app.inject({method,url:`/api${url}`,payload});assert.ok(res.statusCode<300,`${url}: ${res.body}`);return res.json();
    };
    const openContext=async(browser,base,width,theme,token,child,role,errors)=>{
      const context=await browser.newContext({viewport:{width,height:width<500?844:1024},colorScheme:theme,hasTouch:true,timezoneId:'Asia/Shanghai',serviceWorkers:'block',reducedMotion:'reduce'});
      await context.addInitScript(({token,child,theme,role})=>{
        sessionStorage.setItem(`taskie_${role}_token`,token);sessionStorage.setItem('current_child',JSON.stringify(child));localStorage.setItem('taskie_theme',theme);localStorage.setItem('app_sound_muted','true');
      },{token,child,theme,role});
      const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',err=>errors.push(err.message));
      await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
      return {context,page};
    };
    browser=await chromium.launch(launchOptions());const errors=[];
    await checkDictionaryArticle({browser,base,api,parentToken,openContext,errors,dictionaryService:ctx.app.services.dictionaryService});
    assert.deepEqual(errors,[]);
  } finally { await browser?.close();await ctx.app.close();cleanupTestApp(ctx); }
})().catch(err=>{console.error(err);process.exitCode=1;});
