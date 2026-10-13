import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock browser globals (window, localStorage, AudioContext, CustomEvent)
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.events = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'setValueAtTime', val, time });
  }
  linearRampToValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'linearRampToValueAtTime', val, time });
  }
  exponentialRampToValueAtTime(val, time) {
    this.value = val;
    this.events.push({ type: 'exponentialRampToValueAtTime', val, time });
  }
}

class MockAudioNode {
  constructor(context) {
    this.context = context;
    this.connectedTo = [];
  }
  connect(dest) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect() {
    this.connectedTo = [];
  }
}

class MockGainNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.gain = new MockAudioParam(1);
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.started = false;
    this.stopped = false;
    this.startTime = null;
    this.stopTime = null;
  }
  start(time) {
    this.started = true;
    this.startTime = time;
  }
  stop(time) {
    this.stopped = true;
    this.stopTime = time;
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.buffer = null;
    this.started = false;
  }
  start(time) {
    this.started = true;
  }
  stop(time) {
    this.stopped = true;
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(context) {
    super(context);
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.Q = new MockAudioParam(1);
  }
}

class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(channel) {
    return this.data;
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0.5;
    this.sampleRate = 44100;
    this.destination = new MockAudioNode(this);
    this.createdOscillators = [];
    this.createdGains = [];
    this.createdBufferSources = [];
    this.createdFilters = [];
  }
  createGain() {
    const node = new MockGainNode(this);
    this.createdGains.push(node);
    return node;
  }
  createOscillator() {
    const node = new MockOscillatorNode(this);
    this.createdOscillators.push(node);
    return node;
  }
  createBufferSource() {
    const node = new MockAudioBufferSourceNode(this);
    this.createdBufferSources.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new MockBiquadFilterNode(this);
    this.createdFilters.push(node);
    return node;
  }
  createBuffer(channels, length, sampleRate) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  async resume() {
    this.state = 'running';
  }
}

class MockCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const mockStorage = new MockLocalStorage();
const dispatchedEvents = [];

globalThis.localStorage = mockStorage;
globalThis.AudioContext = MockAudioContext;
globalThis.CustomEvent = MockCustomEvent;
globalThis.window = {
  AudioContext: MockAudioContext,
  addEventListener(evt, fn) {},
  removeEventListener(evt, fn) {},
  dispatchEvent(evt) {
    dispatchedEvents.push(evt);
  }
};

// Import module after global mocks
const soundModule = await import('../src/utils/sound.js');
const {
  SOUND_STORAGE_KEY,
  isMuted,
  setMuted,
  toggleMute,
  getAudioContext,
  resumeAudioContext,
  playTaskComplete,
  playTaskUncomplete,
  playAllDone,
  playBadgeUnlocked,
  playClick,
  playCameraShutter,
  playStarAdded
} = soundModule;

describe('Web Audio Synthesizer & Sound System', () => {
  beforeEach(() => {
    mockStorage.clear();
    setMuted(false);
    dispatchedEvents.length = 0;
  });

  test('SOUND_STORAGE_KEY matches specification', () => {
    assert.strictEqual(SOUND_STORAGE_KEY, 'app_sound_muted');
  });

  test('Default mute state is false (sound enabled by default)', () => {
    assert.strictEqual(isMuted(), false);
  });

  test('setMuted updates in-memory state and persists to localStorage', () => {
    setMuted(true);
    assert.strictEqual(isMuted(), true);
    assert.strictEqual(mockStorage.getItem('app_sound_muted'), 'true');

    setMuted(false);
    assert.strictEqual(isMuted(), false);
    assert.strictEqual(mockStorage.getItem('app_sound_muted'), 'false');
  });

  test('setMuted broadcasts CustomEvent app_sound_muted_changed', () => {
    setMuted(true);
    assert.strictEqual(dispatchedEvents.length, 1);
    assert.strictEqual(dispatchedEvents[0].type, 'app_sound_muted_changed');
    assert.strictEqual(dispatchedEvents[0].detail.muted, true);
  });

  test('toggleMute flips state and returns new value', () => {
    setMuted(false);
    const result1 = toggleMute();
    assert.strictEqual(result1, true);
    assert.strictEqual(isMuted(), true);

    const result2 = toggleMute();
    assert.strictEqual(result2, false);
    assert.strictEqual(isMuted(), false);
  });

  test('getAudioContext creates singleton and resumeAudioContext resumes suspended state', async () => {
    const ctx = getAudioContext();
    assert.ok(ctx);
    ctx.state = 'suspended';
    resumeAudioContext();
    assert.strictEqual(ctx.state, 'running');
  });

  test('playTaskComplete synthesizes dual frequency ascending C6 -> E6', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playTaskComplete();

    assert.ok(ctx.createdOscillators.length >= 1, 'Should create oscillator');
    const mainOsc = ctx.createdOscillators[0];
    assert.strictEqual(mainOsc.type, 'sine');
    assert.strictEqual(mainOsc.started, true);

    // Verify frequency ramp: C6 (1046.5Hz) -> E6 (1318.51Hz)
    const freqEvents = mainOsc.frequency.events;
    assert.ok(freqEvents.some(e => Math.abs(e.val - 1046.5) < 0.1), 'Starts at C6');
    assert.ok(freqEvents.some(e => Math.abs(e.val - 1318.51) < 0.1), 'Ascends to E6');
  });

  test('playTaskUncomplete synthesizes low gentle tone descending', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playTaskUncomplete();

    assert.ok(ctx.createdOscillators.length >= 1);
    const osc = ctx.createdOscillators[0];
    assert.strictEqual(osc.type, 'sine');
    assert.strictEqual(osc.started, true);

    const freqEvents = osc.frequency.events;
    assert.ok(freqEvents[0].val >= 350, 'Starts in 370Hz range');
    assert.ok(freqEvents.some(e => e.val <= 230), 'Ramps down to low tone');
  });

  test('playAllDone synthesizes major triad fanfare celebration', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playAllDone();

    // Fanfare has multiple notes (arpeggio + chord)
    assert.ok(ctx.createdOscillators.length >= 4, 'Multiple harmonic voices created');
    const freqs = ctx.createdOscillators.map(o => o.frequency.events[0]?.val);
    assert.ok(freqs.some(f => Math.abs(f - 523.25) < 1), 'Includes C5');
    assert.ok(freqs.some(f => Math.abs(f - 659.25) < 1), 'Includes E5');
    assert.ok(freqs.some(f => Math.abs(f - 783.99) < 1), 'Includes G5');
    assert.ok(freqs.some(f => Math.abs(f - 1046.5) < 1), 'Includes C6');
  });

  test('playBadgeUnlocked synthesizes shimmering chime notes', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playBadgeUnlocked();

    assert.ok(ctx.createdOscillators.length >= 4, 'Ascending sparkle chime notes');
    assert.ok(ctx.createdOscillators.every(o => o.started), 'All chime notes started');
  });

  test('playClick synthesizes rapid bubble pop pitch sweep', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playClick();

    assert.strictEqual(ctx.createdOscillators.length, 1);
    const osc = ctx.createdOscillators[0];
    assert.strictEqual(osc.type, 'sine');
    assert.strictEqual(osc.started, true);
    assert.ok(osc.frequency.events.some(e => e.val > 1000), 'Fast upward pop sweep');
  });

  test('playCameraShutter synthesizes double pulse noise buffer and mechanical body', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdBufferSources.length = 0;
    ctx.createdFilters.length = 0;

    playCameraShutter();

    assert.strictEqual(ctx.createdBufferSources.length, 1, 'Noise buffer created');
    assert.strictEqual(ctx.createdFilters.length, 1, 'Bandpass filter created');
    assert.strictEqual(ctx.createdFilters[0].type, 'bandpass');
  });

  test('playStarAdded synthesizes ascending E6 -> B6 chime notes', () => {
    setMuted(false);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;

    playStarAdded();

    assert.strictEqual(ctx.createdOscillators.length, 2, 'Two notes synthesized for star collection');
    const freqs = ctx.createdOscillators.map(o => o.frequency.events[0]?.val);
    assert.ok(freqs.some(f => Math.abs(f - 1318.51) < 1), 'Includes E6');
    assert.ok(freqs.some(f => Math.abs(f - 1975.53) < 1), 'Includes B6');
  });

  test('When isMuted() is true, all play methods are completely silent without errors', () => {
    setMuted(true);
    const ctx = getAudioContext();
    ctx.createdOscillators.length = 0;
    ctx.createdBufferSources.length = 0;

    assert.doesNotThrow(() => {
      playTaskComplete();
      playTaskUncomplete();
      playAllDone();
      playBadgeUnlocked();
      playClick();
      playCameraShutter();
      playStarAdded();
    });

    assert.strictEqual(ctx.createdOscillators.length, 0, 'No sound synthesized when muted');
    assert.strictEqual(ctx.createdBufferSources.length, 0, 'No buffer synthesized when muted');
  });
});
