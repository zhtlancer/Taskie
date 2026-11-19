// Opt-in local acceptance: build first, then DICT_DIR=/host/dicts npm run test:browser:real-dictionary.
// Real dictionaries stay outside the repository; all business data and indexes are temporary.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');

async function main() {
  const dictDir = process.env.DICT_DIR;
  assert.ok(dictDir && dictDir !== 'off' && fs.statSync(dictDir).isDirectory(), '请显式设置 DICT_DIR 指向真实词典目录');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-real-dictionary-'));
  const db = getDb(':memory:');
  db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
  const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
    uploadDir: path.join(root, 'uploads'), backupDir: path.join(root, 'backups'),
    dictDir, dictCacheDir: path.join(root, 'cache'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
  let browser;
  try {
    await app.ready();
    const started = performance.now();
    const built = await app.services.dictionaryService.rebuildIndex();
    console.log(`INDEX ${Math.round(performance.now() - started)}ms ${JSON.stringify(built.sources)}`);
    assert.deepEqual(built.sources.map(s => s.dict_id).sort(), ['bgl', 'mw11', 'oald8']);
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '1h' });
    const api = async (method, url, payload) => {
      const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
      assert.ok(response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
      return response.json();
    };
    const lookups = new Map();
    for (const word of ['apple', 'book', 'school', 'bank', 'spring', 'May', 'may', 'look after', "don't"]) {
      const lookup = await api('GET', `/dictionary/lookup?word=${encodeURIComponent(word)}`);
      const match = lookup.exact_matches.find(m => m.word === word);
      assert.ok(match && /[\u3400-\u9fff]/u.test(match.definition_zh), `${word}: missing Chinese meaning`);
      assert.ok(match.senses.length > 0 && match.senses.length <= 30, `${word}: missing structured senses`);
      assert.ok(match.senses.every(sense => sense.source.headword === word && sense.source.dict_id && sense.source.name));
      lookups.set(word, match);
    }
    assert.match(lookups.get('bank').definition_zh, /银行/);
    assert.match(lookups.get('bank').definition_zh, /河岸/);
    assert.ok(lookups.get('bank').senses.some(sense => /银行/.test(sense.definition_zh)));
    assert.ok(lookups.get('bank').senses.some(sense => /河岸/.test(sense.definition_zh)));
    assert.ok(lookups.get('bank').senses.some(sense => sense.source.dict_id === 'oald8' && sense.definition_en));
    assert.match(lookups.get('May').definition_zh, /五月/);
    assert.match(lookups.get('may').definition_en, /possible/);
    for (const word of ['record', 'present', 'lead', 'read', 'wind', 'close']) {
      const match = (await api('GET', `/dictionary/lookup?word=${word}`)).exact_matches.find(entry => entry.word === word);
      const groups = match.pronunciations.filter(group => group.dict_id === 'oald8');
      assert.ok(groups.length >= 2, `${word}: expected separate Oxford pronunciation groups`);
      assert.ok(groups.every(group => group.audio_refs.every(ref => ref.headword === word && ref.entry_key === group.id && /^[a-f0-9]{64}$/.test(ref.sha256))));
      for (const sense of match.senses.filter(sense => sense.source.dict_id === 'oald8' && sense.audio_refs.length)) {
        assert.ok(groups.some(group => group.id === sense.audio_refs[0].entry_key), `${word}: meaning must keep its own pronunciation group`);
      }
      if (['record', 'present', 'lead', 'wind', 'close'].includes(word)) {
        assert.ok(new Set(groups.map(group => group.phonetic).filter(Boolean)).size >= 2, `${word}: distinct pronunciation must not be flattened`);
      }
      assert.ok(groups.every(group => group.audio_refs.every(ref => !/z_(?:led|wound)__/i.test(ref.file))), `${word}: inflections are not the headword pronunciation`);
      console.log(`HOMOGRAPH ${word}: ${groups.map(group => `${group.pos} /${group.phonetic}/`).join(' | ')}`);
    }
    const inflection = await api('GET', '/dictionary/lookup?word=apples');
    assert.ok(inflection.suggestions.some(s => s.word === 'apple'));
    assert.equal((await api('GET', '/dictionary/lookup?word=taskiezzzznonword')).exact_matches.length, 0);
    const noAudio = lookups.get('look after');
    console.log(`PHRASE look after: ${noAudio.audio.length} audio clips (missing audio is allowed)`);
    for (const word of ['apple', 'book', 'school']) {
      const match = lookups.get(word);
      assert.ok(match.phonetic_uk && match.phonetic_us, `${word}: missing IPA`);
      for (const [dictId, accent, contentType] of [['oald8', 'uk', 'audio/mpeg'], ['oald8', 'us', 'audio/mpeg'], ['mw11', 'mw', 'audio/wav']]) {
        const clip = match.audio.find(a => a.dict_id === dictId && a.accent === accent);
        assert.ok(clip, `${word}: missing ${dictId}/${accent}`);
        const audio = await app.services.dictionaryService.getAudio(dictId, clip.file);
        assert.equal(audio.contentType, contentType);
        assert.ok(audio.buffer.length > 100);
      }
    }
    const articles = await api('GET', '/dictionary/article?word=apple');
    assert.equal(articles.articles.length, 3);
    const child = await api('POST', '/children', { name: '真实词典验收' });
    const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
    browser = await chromium.launch(launchOptions());
    const context = await browser.newContext({ viewport: { width: 1180, height: 1024 }, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
    await context.addInitScript(({ token, child }) => {
      sessionStorage.setItem('taskie_parent_token', token);
      sessionStorage.setItem('current_child', JSON.stringify(child));
      localStorage.setItem('app_sound_muted', 'true');
      window.__playedDictionaryAudio = [];
      const OriginalAudio = window.Audio;
      window.Audio = function(src) {
        const audio = new OriginalAudio(src);
        audio.addEventListener('ended', () => window.__playedDictionaryAudio.push({ duration: audio.duration, ended: true }));
        return audio;
      };
    }, { token, child });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    const dialog = page.getByRole('dialog', { name: '查词与收录单词', exact: true });
    for (const word of ['book', 'school', 'apple']) {
      await dialog.getByPlaceholder(/输入英文单词或短语/).fill(word);
      await dialog.getByRole('button', { name: /查词/, exact: true }).click();
      await page.waitForFunction(({ input, expected }) => input.value === expected,
        { input: await dialog.getByLabel('英文词条 *', { exact: true }).elementHandle(), expected: word });
      assert.match(await dialog.getByPlaceholder('例如：n. 苹果').inputValue(), /[\u3400-\u9fff]/u);
      for (const label of ['英音', '美音', '朗读']) {
        const before = await page.evaluate(() => window.__playedDictionaryAudio.length);
        const group = dialog.locator('[data-english-pronunciations] > div').filter({ hasText: label === '朗读' ? '韦氏' : '牛津' }).first();
        await group.getByRole('button', { name: `🔊 ${label}`, exact: true }).click();
        await page.waitForFunction(count => window.__playedDictionaryAudio.length > count, before);
        const played = await page.evaluate(() => window.__playedDictionaryAudio.at(-1));
        assert.ok(Number.isFinite(played.duration) && played.duration > 0);
        console.log(`PLAY ${word} ${label} ${played.duration.toFixed(2)}s`);
      }
    }
    await dialog.getByRole('button', { name: /查看完整原词典/ }).click();
    const articleDialog = page.getByRole('dialog', { name: '原词典 · apple', exact: true });
    await articleDialog.getByRole('tab', { name: /全部词典 \(3\)/ }).waitFor();
    await articleDialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    await dialog.getByPlaceholder('例如：n. 苹果').fill('苹果（课堂释义）');
    await dialog.getByRole('button', { name: '加入单词本', exact: true }).click();
    await page.locator('[data-english-word-card="apple"]').waitFor();
    const saved = (await api('GET', `/english-words?child_id=${child.id}`))[0];
    assert.equal(saved.definition_zh, '苹果（课堂释义）');
    await page.goto(`${base}/parent/word-plans?child=${child.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /英语单词计划/ }).click();
    for (const [skill, title] of [['recognize', '英语单词认读'], ['write', '英语单词默写']]) {
      const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await card.getByRole('checkbox', { name: /未开启|已开启/ }).check();
      for (const label of ['周日', '周六']) {
        const button = card.getByRole('button', { name: label, exact: true });
        if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
      }
      await card.getByRole('button', { name: `保存${title}计划`, exact: true }).click();
      await card.getByText(/计划已保存/).waitFor();
      const overview = await api('GET', `/children/${child.id}/word-study?language=en`);
      const day = overview.days.find(d => d.skill === skill);
      assert.equal(day.batches[0].items[0].meaning_zh, '苹果（课堂释义）');
    }
    await page.goto(`${base}/child/${child.id}/word-study?language=en`, { waitUntil: 'domcontentloaded' });
    for (const title of ['英语单词认读', '英语单词默写']) {
      const section = page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await section.getByRole('button', { name: /开始 \/ 继续学习/ }).click();
      const practice = page.getByRole('dialog');
      if (title === '英语单词默写') {
        await practice.getByPlaceholder('在此输入英文拼写…').fill('apple');
        await practice.getByRole('button', { name: '核对拼写', exact: true }).click();
      } else await practice.getByRole('button', { name: '我已回忆，揭晓释义', exact: true }).click();
      await practice.getByText('苹果（课堂释义）', { exact: true }).waitFor();
      await practice.getByRole('button', { name: /^(独立完成|提交：独立拼对)$/ }).click();
      await practice.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
      await section.getByText('基础目标已完成 ✓', { exact: true }).waitFor();
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM word_study_states WHERE english_word_id = ?').get(saved.id).n, 2);
    for (const [width,theme] of [[390,'light'],[820,'dark']]) {
      const imagesContext=await browser.newContext({viewport:{width,height:1024},colorScheme:theme,hasTouch:true,serviceWorkers:'block'});
      try {
        await imagesContext.addInitScript(({token,child,theme})=>{
          sessionStorage.setItem('taskie_parent_token',token);sessionStorage.setItem('current_child',JSON.stringify(child));
          localStorage.setItem('taskie_theme',theme);localStorage.setItem('app_sound_muted','true');
        },{token,child,theme});
        const imagesPage=await imagesContext.newPage();imagesPage.setDefaultTimeout(20000);
        imagesPage.on('pageerror',error=>errors.push(error.message));
        await imagesPage.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        await imagesPage.goto(`${base}/child/${child.id}/characters?lang=en`,{waitUntil:'domcontentloaded'});
        await imagesPage.getByRole('button',{name:/查词 · 收录单词/}).click();
        const lookup=imagesPage.getByRole('dialog',{name:'查词与收录单词',exact:true});
        for (const [word,source] of [['abandon','牛津'],['aardvark','韦氏'],['abacus','韦氏']]) {
          await lookup.getByPlaceholder(/输入英文单词或短语/).fill(word);
          await lookup.getByRole('button',{name:/查词/,exact:true}).click();
          await imagesPage.waitForFunction(({input,word})=>input.value===word,{input:await lookup.getByLabel('英文词条 *',{exact:true}).elementHandle(),word});
          await lookup.getByRole('button',{name:/查看完整原词典/}).click();
          const original=imagesPage.getByRole('dialog',{name:`原词典 · ${word}`,exact:true});
          await original.getByRole('tab',{name:new RegExp(source)}).click();
          const slot=original.locator('[data-dictionary-image]').first();
          await slot.scrollIntoViewIfNeeded();const img=slot.locator('img');await img.waitFor({state:'visible'});
          const dimensions=await img.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,filter:getComputedStyle(img).filter,displayWidth:img.getBoundingClientRect().width}));
          assert.ok(dimensions.width>0&&dimensions.height>0);assert.equal(dimensions.filter,'none');
          assert.ok(dimensions.displayWidth<=width);assert.equal(await imagesPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          console.log(`IMAGE ${width}/${theme} ${word}/${source}: ${dimensions.width}x${dimensions.height}`);
          if(process.env.SCREENSHOT_DIR&&word==='abandon'){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await imagesPage.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`real-article-${width}-${theme}.png`)});}
          await original.getByRole('button',{name:'关闭',exact:true}).last().click();
        }
      } finally {await imagesContext.close();}
    }
    assert.deepEqual(errors, []);
    console.log('PASS real BGL/DSL meanings, Oxford MP3 + Webster PCM playback, lookup-to-collection-to-two-skill study and original dictionary images');
  } finally {
    await browser?.close();
    await app.close();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
