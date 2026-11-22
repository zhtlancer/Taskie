const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeAudioFixture, wav, zip } = require('../backend/test/dictionary-audio-fixture');

module.exports = async function checkEnglishAudio({ browser, base, api, parentToken, openContext, errors, dictionaryService: dictionary, db }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-audio-browser-'));
  const keys = ['dictDir','cacheDir','indexPath','audioCacheDir'];
  const previous = Object.fromEntries(keys.map(key => [key,dictionary[key]]));
  dictionary.releaseIndex();
  Object.assign(dictionary, {dictDir:path.join(root,'dicts'),cacheDir:path.join(root,'cache'),indexPath:path.join(root,'cache/index.sqlite'),audioCacheDir:path.join(root,'cache/audio')});
  try {
    for (const [width, theme] of [[390,'light'],[820,'dark']]) {
      const { media, zipPath } = writeAudioFixture(dictionary.dictDir);
      const match = (await api('GET', '/dictionary/lookup?word=record')).exact_matches[0];
      const child = await api('POST','/children',{name:`学习发音${width}`});
      const word = await api('POST','/english-words',{child_id:child.id,word:'record',senses:match.senses,primary_sense_id:match.senses[0].id});
      for (const skill of ['recognize','write']) await api('PUT',`/children/${child.id}/word-study/en/plans/${skill}`,{days_of_week:[0,1,2,3,4,5,6],new_target:1,review_target:1});
      const days = (await api('GET',`/children/${child.id}/word-study?language=en`)).days;
      const {context,page} = await openContext(browser,base,width,theme,parentToken,child,'parent',errors);
      try {
        await page.route('**/api/dictionary/audio/**', route => route.continue());
        await context.addInitScript(() => { const Native = window.Audio; window.__audioEnded = []; window.Audio = function(src) {
          const audio = new Native(src); audio.addEventListener('ended',()=>window.__audioEnded.push(audio.duration)); return audio;
        }; });
        await page.goto(`${base}/child/${child.id}/characters?lang=en`,{waitUntil:'domcontentloaded'});
        await page.locator('[data-english-word-card="record"]').click();
        const detail = page.getByRole('dialog',{name:'record',exact:true});
        await detail.locator('[data-english-pronunciations]').getByText(/noun.*rekɔːd/).waitFor();
        await detail.getByRole('button',{name:/编辑释义与笔记/}).click();
        await detail.getByRole('button',{name:'设为学习释义',exact:true}).click();
        await detail.getByRole('combobox',{name:'学习发音',exact:true}).waitFor();
        await detail.getByRole('button',{name:'保存修改',exact:true}).click();
        await detail.getByText('学习发音 /rɪˈkɔːd/',{exact:true}).waitFor();
        const updated = (await api('GET',`/english-words/${word.id}`));
        assert.equal(updated.senses.find(s=>s.id===updated.primary_sense_id).audio_refs[0].file,'record_v_gb.wav');
        let lookupRequests = 0, requestedAudio;
        page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/dictionary/lookup')lookupRequests++;if(url.pathname.includes('/dictionary/audio/'))requestedAudio=url;});
        const studyUrl = `${base}/child/${child.id}/word-study?language=en&skill=recognize`;
        await page.goto(studyUrl,{waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:/开始 \/ 继续学习/}).click();
        const practice = page.getByRole('dialog',{name:/认读练习/});
        await practice.getByText('/ˈrekɔːd/',{exact:true}).waitFor();
        await practice.getByRole('button',{name:'🔊 英音',exact:true}).click();
        await page.waitForFunction(()=>window.__audioEnded.length===1);
        assert.equal(requestedAudio.pathname.endsWith('/record_n_gb.wav'),true,'old lists must keep noun audio after switching the live meaning to verb');
        assert.equal(requestedAudio.searchParams.get('sha256'),days[0].batches[0].items[0].audio_refs[0].sha256);
        assert.equal(lookupRequests,0,'opening practice must not re-query by spelling');
        await practice.getByRole('button',{name:'关闭练习',exact:true}).click();
        fs.writeFileSync(zipPath,zip({...media,'record_n_gb.wav':wav(180)}));
        const nextTime = new Date(Date.now()+5000); fs.utimesSync(zipPath,nextTime,nextTime);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:/开始 \/ 继续学习/}).click();
        const rejected = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/record_n_gb.wav') && response.status() === 409);
        await practice.getByRole('button',{name:'🔊 英音',exact:true}).click();
        await rejected;
        await practice.getByText(/原学习发音已不可用/).waitFor();
        assert.equal((await page.evaluate(()=>window.__audioEnded.length)),0);
        const itemId = days.find(day=>day.skill==='recognize').batches[0].items[0].id;
        db.prepare('UPDATE word_study_items SET audio_refs = NULL WHERE id = ?').run(itemId);
        await page.reload({waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:/开始 \/ 继续学习/}).click();
        await practice.getByText(/旧清单未保存发音/).waitFor();
        assert.equal(lookupRequests,0);
        await practice.getByRole('button',{name:'查看当前词典发音（非历史发音）',exact:true}).click();
        await practice.locator('[data-english-pronunciations]').getByText(/noun/).waitFor();
        assert.equal(lookupRequests,1);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        console.log(`PASS ${width}/${theme}: select POS audio, freeze both skill snapshots, real PCM playback, reject changed bytes and explicitly view current audio for legacy lists`);
      } finally { await context.close(); }
    }
  } finally {
    await dictionary.buildPromise?.catch(()=>{}); dictionary.releaseIndex(); Object.assign(dictionary,previous); fs.rmSync(root,{recursive:true,force:true});
  }
};
