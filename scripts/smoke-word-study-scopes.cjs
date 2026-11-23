const { useLocalLearningFont } = require('./word-book-fonts.cjs');
const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const c = createTestApp({ dictDir: null });
let browser, heldPreview;
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Scope preview did not reach server')), 20000); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  c.app.addHook('onSend', async (request, reply, payload) => {
    if (heldPreview && request.url.endsWith('/book-scope')) { const current = heldPreview; heldPreview = null; current.reached(); await current.gate; }
    return payload;
  });
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const actor = { role: 'parent' }, errors = [];
  browser = await launchBrowser();
  for (const [width, theme] of [[320,'light'],[390,'dark'],[820,'light'],[1024,'dark'],[1180,'light']]) {
    const { childrenService, charactersService: chars, englishWordsService: words, wordBooksService: books, wordStudyService: study } = c.app.services;
    const child = childrenService.createChild({ name: `范围-${width}` }), byLanguage = {};
    for (const lang of ['zh','en']) {
      const a = books.create({child_id:child.id,language:lang,name:'第一本',source:'学校'},actor), b = books.create({child_id:child.id,language:lang,name:'第二本',source:'课外'},actor);
      const entry = lang === 'zh' ? chars.createCharacter({child_id:child.id,char:'长',pinyin:'cháng'}) : words.createWord({child_id:child.id,word:'book',definition_zh:'书',categories:['recognize','write']},actor);
      for (const target of [a,b]) books.add(target.id, lang === 'zh' ? {character_id:entry.id,pinyin_override:target.id === a.id?'chang2':'zhang3'} : {english_word_id:entry.id}, actor);
      byLanguage[lang] = {a,b,entry};
    }
    const context = await browser.newContext({viewport:{width,height:width<500?844:1024},colorScheme:theme,locale:'zh-CN',hasTouch:true,isMobile:true,reducedMotion:'reduce'});
    try {
      const token=c.app.jwt.sign({...actor,epoch:c.app.sessionEpoch()});
      await useLocalLearningFont(context);
      await context.addInitScript(token=>sessionStorage.setItem('taskie_parent_token',token),token);
      const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
      await page.goto(`${base}/parent/word-plans?child=${child.id}`,{waitUntil:'domcontentloaded'});
      for(const lang of ['zh','en']) {
        if(lang==='en') await page.getByRole('tab',{name:/英语单词计划/}).click();
        for(const skill of ['recognize','write']) {
          const title=lang==='zh'?(skill==='write'?'语文字词书写':'语文字词认读'):(skill==='write'?'英语单词默写':'英语单词认读');
          const card=page.locator('article').filter({has:page.getByRole('heading',{name:title,exact:true})});
          await card.getByLabel('未开启',{exact:true}).check();
          for(const label of ['周日','周六']) {const button=card.getByRole('button',{name:label,exact:true});if(await button.getAttribute('aria-pressed')!=='true')await button.click();}
          await card.getByLabel('字词来源范围',{exact:true}).selectOption('books');
          const scope=card.getByRole('region',{name:'学习词本范围',exact:true});
          let release;
          if(width===320&&lang==='zh'&&skill==='recognize') {
            let reached;const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{reached=resolve;});heldPreview={gate,reached};
            await scope.getByLabel('选择词本「第一本」',{exact:true}).check();await bounded(ready);
          } else await scope.getByLabel('选择词本「第一本」',{exact:true}).check();
          try {
            if(skill==='recognize') {
              await scope.getByLabel('选择词本「第二本」',{exact:true}).check();
              await scope.getByRole('button',{name:'提高第 2 本优先级',exact:true}).click();
              if(lang==='zh') await scope.getByText('长：zhǎng（第二本）',{exact:true}).waitFor();
            }
          } finally {release?.();heldPreview=null;}
          if(release) {await page.waitForTimeout(300);assert.equal(await scope.getByText('长：zhǎng（第二本）',{exact:true}).count(),1,'stale preview cannot hide the chosen reading');}
          await page.evaluate(()=>{document.documentElement.style.fontSize='24px';});
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'scope selection fits enlarged text');
          const date=card.getByLabel('开始日期',{exact:true});
          const fit=await date.evaluate(input=>{const a=input.getBoundingClientRect(),b=input.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;});assert.ok(fit,'date remains within its column');
          await page.evaluate(()=>{document.documentElement.style.fontSize='';});
          await card.getByRole('button',{name:`保存${title}计划`,exact:true}).click();
          await card.getByRole('status').filter({hasText:'计划已保存，并按约定生效。'}).waitFor();
          const plan=study.plans(child.id,lang).find(plan=>plan.skill===skill);
          assert.deepEqual(plan.book_ids,skill==='recognize'?[byLanguage[lang].b.id,byLanguage[lang].a.id]:[byLanguage[lang].a.id]);
          const day=study.today(child.id,lang).days.find(day=>day.skill===skill);assert.equal(day.base_total,1);
          if(lang==='zh')assert.equal(day.batches[0].items[0].pinyin,skill==='recognize'?'zhǎng':'cháng');
        }
      }
      await page.goto(`${base}/child/${child.id}/characters`,{waitUntil:'domcontentloaded'});
      const panel=page.getByRole('region',{name:'词本与来源',exact:true});await panel.getByLabel('按词本筛选',{exact:true}).selectOption(byLanguage.zh.a.id);
      await panel.getByRole('button',{name:'编辑词本',exact:true}).click();
      await page.getByRole('dialog',{name:'编辑词本',exact:true}).getByRole('button',{name:'删除词本',exact:true}).click();
      const confirmation=page.getByRole('dialog',{name:'确认操作',exact:true});await confirmation.getByText(/有 2 个学习计划引用本词本/).waitFor();
      await confirmation.getByRole('button',{name:'确认',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
      assert.deepEqual(study.plans(child.id).find(plan=>plan.skill==='write').book_ids,[]);
      await page.goto(`${base}/child/${child.id}/word-study`,{waitUntil:'domcontentloaded'});
      await page.getByText(/所选词本已不可用，等待家长重新配置范围/).waitFor();
      await page.getByText(/当天词本：第二本、第一本/).waitFor();
      console.log(`PASS ${width}/${theme}: four scoped plans, ordered polyphone preview, fixed day, stale preview isolation, deletion impact and paused-empty scope`);
    } finally {await context.close();}
  }
  assert.deepEqual(errors,[]);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await c.app.close();cleanupTestApp(c);c.db.close();});
