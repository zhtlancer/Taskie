import api from '../api/client';

const objectUrlCache = new Map();
let activeAudio = null;
let playSerial = 0;
let activeCancel = null;
let fetchController = null;

function cacheBlobUrl(key, blob) {
  if (objectUrlCache.has(key)) return objectUrlCache.get(key);
  if (objectUrlCache.size >= 60) {
    const firstKey = objectUrlCache.keys().next().value;
    const oldUrl = objectUrlCache.get(firstKey);
    objectUrlCache.delete(firstKey);
    try { URL.revokeObjectURL(oldUrl); } catch {}
  }
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(key, url);
  return url;
}

export function stopDictionaryAudio() {
  playSerial++;
  fetchController?.abort();
  fetchController = null;
  stopPlaybackElementOnly();
}

export async function playDictionaryAudio(url) {
  if (!url) throw new Error('暂无发音资源');
  stopDictionaryAudio();
  const seq = playSerial;

  let blobUrl = objectUrlCache.get(url);
  if (!blobUrl) {
    const controller = new AbortController();
    fetchController = controller;
    let blob;
    try { blob = await api.fetchDictionaryAudioBlob(url, controller.signal); }
    catch (err) {
      if (seq !== playSerial) return { aborted: true };
      throw err instanceof Error ? err : new Error(typeof err === 'string' ? err : '发音读取失败');
    }
    finally { if (fetchController === controller) fetchController = null; }
    if (seq !== playSerial) return { aborted: true };
    blobUrl = cacheBlobUrl(url, blob);
  }

  return await new Promise((resolve, reject) => {
    const audio = new Audio(blobUrl);
    activeAudio = audio;
    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      if (activeAudio === audio) { activeAudio = null; activeCancel = null; }
    };
    activeCancel = () => { cleanup(); resolve({ aborted: true }); };
    audio.onended = () => {
      cleanup();
      resolve({ ended: true, duration: audio.duration });
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('音频解码或播放失败'));
    };
    audio.play().catch(err => {
      if (seq !== playSerial) return;
      cleanup();
      reject(new Error(err?.message || '浏览器阻止了音频播放，请再点一次试试'));
    });
  });
}

function stopPlaybackElementOnly() {
  if (activeAudio) {
    try {
      activeAudio.pause();
      activeAudio.currentTime = 0;
    } catch {}
    activeCancel?.();
    activeAudio = null;
  }
}

export function clearDictionaryAudioCache() {
  stopDictionaryAudio();
  for (const url of objectUrlCache.values()) {
    try { URL.revokeObjectURL(url); } catch {}
  }
  objectUrlCache.clear();
}
