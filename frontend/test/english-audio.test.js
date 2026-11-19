import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audioClips, learningPhonetic } from '../src/utils/englishAudio.js';
import { sensesFromEntry } from '../src/utils/englishSenses.js';

test('saved audio uses internal content URLs and the selected sense phonetic', () => {
  const ref = { dict_id: 'oald8', file: 'record_n_gb.wav', sha256: 'a'.repeat(64), accent: 'uk', phonetic: 'noun-sound' };
  const word = { primary_sense_id: 'verb', senses: [{id:'noun',audio_refs:[ref]}, {id:'verb',audio_refs:[{...ref,phonetic:'verb-sound'}]}] };
  assert.equal(learningPhonetic(word), 'verb-sound');
  assert.equal(audioClips([ref])[0].url, `/api/dictionary/audio/oald8/record_n_gb.wav?sha256=${ref.sha256}`);
  assert.equal(audioClips([ref])[0].label, '英音');
  const cloned = sensesFromEntry(word); cloned[0].audio_refs[0].phonetic = 'edited';
  assert.equal(word.senses[0].audio_refs[0].phonetic, 'noun-sound');
});

test('stopping playback settles its promise, cancels downloads and ignores stale playback errors', async t => {
  const previousAudio = globalThis.Audio;
  const elements = [];
  globalThis.Audio = class { constructor() { elements.push(this); } pause() {} play() { return Promise.resolve(); } };
  let cancelSignal;
  globalThis.__taskieAudioApi = { fetchDictionaryAudioBlob: async (url, signal) => {
    if (url === '/changed') throw '原学习发音已不可用';
    if (url === '/delayed') return new Promise((resolve, reject) => {
      cancelSignal = signal; signal.addEventListener('abort', () => reject(new Error('cancelled')));
    });
    return new Blob(['sound']);
  } };
  const source = readFileSync(new URL('../src/utils/dictionaryAudio.js', import.meta.url), 'utf8')
    .replace("import api from '../api/client';", 'const api = globalThis.__taskieAudioApi;');
  const audio = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  t.after(() => { audio.clearDictionaryAudioCache(); globalThis.Audio = previousAudio; delete globalThis.__taskieAudioApi; });
  const playing = audio.playDictionaryAudio('/saved');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(elements.length, 1);
  audio.stopDictionaryAudio();
  assert.deepEqual(await playing, { aborted: true });
  assert.equal(elements[0].onerror, null);
  const downloading = audio.playDictionaryAudio('/delayed');
  audio.stopDictionaryAudio();
  assert.equal(cancelSignal.aborted, true);
  assert.deepEqual(await downloading, { aborted: true });
  await assert.rejects(audio.playDictionaryAudio('/changed'), /原学习发音已不可用/);
});
