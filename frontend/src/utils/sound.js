/**
 * Web Audio API 原生波形合成音效模块
 * 专为小学生日常作业任务管理系统设计
 * - 0 外部音频文件依赖，体积 0KB
 * - 纯 Oscillator / GainNode / BiquadFilter 物理建模合成
 * - 针对 iPadOS / iOS Safari 触摸手势解锁与唤醒优化
 * - 支持 localStorage 持久化静音配置
 */

export const SOUND_STORAGE_KEY = 'app_sound_muted';

let isMutedState = false;

// 1. 初始化静音状态
if (typeof localStorage !== 'undefined') {
  try {
    isMutedState = localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
  } catch (e) {
    isMutedState = false;
  }
}

/**
 * 查询当前全局静音状态
 * @returns {boolean}
 */
export function isMuted() {
  if (typeof localStorage !== 'undefined') {
    try {
      isMutedState = localStorage.getItem(SOUND_STORAGE_KEY) === 'true';
    } catch (e) {
      // ignore
    }
  }
  return isMutedState;
}

/**
 * 设置全局静音状态并持久化
 * @param {boolean} val
 */
export function setMuted(val) {
  isMutedState = Boolean(val);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, isMutedState ? 'true' : 'false');
    } catch (e) {
      // ignore
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('app_sound_muted_changed', { detail: { muted: isMutedState } })
    );
  }
}

/**
 * 切换静音状态。若切换为开启状态，触发轻微提示音试听反馈。
 * @returns {boolean} 新的静音状态
 */
export function toggleMute() {
  const next = !isMuted();
  setMuted(next);
  if (!next) {
    // 切换到开启状态时，播放轻微提示音试听
    playClick();
  }
  return next;
}

// 2. Web Audio AudioContext 单例管理
let audioCtx = null;

export function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  return audioCtx;
}

export function resumeAudioContext() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// 3. iPadOS / iOS Safari 用户手势解锁
let isUnlocked = false;

export function initAudioUnlock() {
  if (typeof window === 'undefined' || isUnlocked) return;

  const unlock = () => {
    resumeAudioContext();
    isUnlocked = true;
    ['touchstart', 'touchend', 'click', 'keydown'].forEach((evt) => {
      window.removeEventListener(evt, unlock, { capture: true });
    });
  };

  ['touchstart', 'touchend', 'click', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, unlock, { capture: true, passive: true });
  });
}

// 自动尝试初始化解锁监听
if (typeof window !== 'undefined') {
  initAudioUnlock();
}

/**
 * 发声前置检查：静音或不支持时返回 null，并自动恢复 suspended 状态
 */
function preparePlay() {
  if (isMuted()) return null;
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

/**
 * 1. 任务打卡完成音
 * 经典童趣金币/叮声，双频上升 C6 (1046.5Hz) -> E6 (1318.5Hz)
 */
export function playTaskComplete() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const masterGain = ctx.createGain();
  masterGain.connect(ctx.destination);

  // 主振荡器：柔和正弦波
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sine';

  osc.frequency.setValueAtTime(1046.50, now); // C6
  osc.frequency.setValueAtTime(1318.51, now + 0.08); // 跳跃至 E6

  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.28, now + 0.008);
  oscGain.gain.setValueAtTime(0.28, now + 0.08);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

  osc.connect(oscGain);
  oscGain.connect(masterGain);

  // 泛音泛闪：三角波微弱泛光（C7 -> E7）强化金币清脆质感
  const shimmerOsc = ctx.createOscillator();
  const shimmerGain = ctx.createGain();
  shimmerOsc.type = 'triangle';
  shimmerOsc.frequency.setValueAtTime(2093.00, now);
  shimmerOsc.frequency.setValueAtTime(2637.02, now + 0.08);

  shimmerGain.gain.setValueAtTime(0, now);
  shimmerGain.gain.linearRampToValueAtTime(0.08, now + 0.01);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

  shimmerOsc.connect(shimmerGain);
  shimmerGain.connect(masterGain);

  osc.start(now);
  shimmerOsc.start(now);
  osc.stop(now + 0.40);
  shimmerOsc.stop(now + 0.40);
}

/**
 * 2. 取消打卡音
 * 低音柔和提示（370Hz -> 220Hz 柔和下潜）
 */
export function playTaskUncomplete() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(370, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.20);
}

/**
 * 3. 当天全勤全部完成音
 * 大三和弦琶音 fanfare 胜利奏鸣（C5 -> E5 -> G5 -> C6 和弦共鸣）
 */
export function playAllDone() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [
    { freq: 523.25, time: 0.00, dur: 0.12, type: 'triangle', vol: 0.22 }, // C5
    { freq: 659.25, time: 0.10, dur: 0.12, type: 'triangle', vol: 0.22 }, // E5
    { freq: 783.99, time: 0.20, dur: 0.14, type: 'triangle', vol: 0.24 }, // G5
    // 最终胜利大三和弦齐鸣
    { freq: 1046.50, time: 0.32, dur: 0.55, type: 'triangle', vol: 0.26 }, // C6
    { freq: 1318.51, time: 0.32, dur: 0.55, type: 'sine',     vol: 0.18 }, // E6
    { freq: 1567.98, time: 0.32, dur: 0.55, type: 'sine',     vol: 0.14 }, // G6
    { freq: 2093.00, time: 0.34, dur: 0.50, type: 'sine',     vol: 0.08 }, // C7 闪亮泛音
  ];

  notes.forEach(({ freq, time, dur, type, vol }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now + time);

    gain.gain.setValueAtTime(0, now + time);
    gain.gain.linearRampToValueAtTime(vol, now + time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + time);
    osc.stop(now + time + dur + 0.02);
  });
}

/**
 * 4. 解锁成就徽章音
 * 清脆闪亮 chime 魔法升华音（高音八音盒/木琴琶音）
 */
export function playBadgeUnlocked() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [
    { freq: 880.00,  time: 0.00, dur: 0.25 }, // A5
    { freq: 1046.50, time: 0.07, dur: 0.28 }, // C6
    { freq: 1318.51, time: 0.14, dur: 0.32 }, // E6
    { freq: 1567.98, time: 0.21, dur: 0.38 }, // G6
    { freq: 1975.53, time: 0.28, dur: 0.45 }, // B6
    { freq: 2093.00, time: 0.35, dur: 0.55 }, // C7
  ];

  notes.forEach(({ freq, time, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + time);

    gain.gain.setValueAtTime(0, now + time);
    gain.gain.linearRampToValueAtTime(0.24, now + time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + time);
    osc.stop(now + time + dur + 0.02);
  });
}

/**
 * 5. 轻触交互音
 * 轻微水滴气泡 bubble pop（520Hz -> 1350Hz 极速微滑音）
 */
export function playClick() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(1350, now + 0.038);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.22, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.07);
}

/**
 * 6. 错题拍照裁剪保存音
 * 模拟微弱机械相机快门声（双脉冲白噪声包络 + 带通滤波 + 机械震动微核）
 */
export function playCameraShutter() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const sampleRate = ctx.sampleRate || 44100;
  const duration = 0.12;
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);

  // 双脉冲咔嚓机械快门
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let amp = 0;
    if (t < 0.035) {
      amp = Math.exp(-t * 110);
    } else if (t >= 0.055 && t < 0.11) {
      amp = Math.exp(-(t - 0.055) * 90);
    }
    data[i] = (Math.random() * 2 - 1) * amp;
  }

  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2600, now);
  filter.Q.setValueAtTime(2.5, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.30, now);

  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  // 机械快门机身低频微颤
  const bodyOsc = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  bodyOsc.type = 'sine';
  bodyOsc.frequency.setValueAtTime(180, now);
  bodyOsc.frequency.exponentialRampToValueAtTime(60, now + 0.03);

  bodyGain.gain.setValueAtTime(0.18, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

  bodyOsc.connect(bodyGain);
  bodyGain.connect(ctx.destination);

  noiseSource.start(now);
  bodyOsc.start(now);
  bodyOsc.stop(now + 0.04);
}

/**
 * 7. 加入生字本音效
 * 明亮喜悦的星光叮咚双音（E6 1318.5Hz -> B6 1975.5Hz 泛音升华）
 */
export function playStarAdded() {
  const ctx = preparePlay();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [
    { freq: 1318.51, time: 0.00, dur: 0.18 }, // E6
    { freq: 1975.53, time: 0.08, dur: 0.32 }, // B6
  ];

  notes.forEach(({ freq, time, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + time);

    gain.gain.setValueAtTime(0, now + time);
    gain.gain.linearRampToValueAtTime(0.25, now + time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + time + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + time);
    osc.stop(now + time + dur + 0.02);
  });
}

/**
 * 8. Web Speech API 汉字发音朗读
 * @param {string} text - 单字或词语
 */
export function speakWord(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.85; // 稍慢适合儿童跟读
    utterance.pitch = 1.05;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('[Sound] Web Speech error:', e);
  }
}

export default {
  SOUND_STORAGE_KEY,
  isMuted,
  setMuted,
  toggleMute,
  getAudioContext,
  resumeAudioContext,
  initAudioUnlock,
  playTaskComplete,
  playTaskUncomplete,
  playAllDone,
  playBadgeUnlocked,
  playClick,
  playCameraShutter,
  playStarAdded,
  speakWord,
};

