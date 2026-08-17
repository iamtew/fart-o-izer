(() => {
  'use strict';

  const PARAMETER = 'FartID';
  const VERSION = 1;
  const defaults = { frequency: 58, noise: 0.42, cutoff: 720, decay: 0.62, rate: 4.2, depth: 0.32, gain: 0.48 };
  const ranges = {
    frequency: [35, 110], noise: [0, 1], cutoff: [180, 1800], decay: [0.18, 1.4],
    rate: [1, 12], depth: [0, 1], gain: [0.15, 0.8]
  };
  const keys = { frequency: 'f', noise: 'n', cutoff: 'c', decay: 'd', rate: 'r', depth: 'l', gain: 'g' };
  const controls = {};
  const outputs = {};
  let settings = { ...defaults };
  let audioContext;
  let masterGain;

  const formatters = {
    frequency: value => `${Math.round(value)} Hz`,
    noise: value => `${Math.round(value * 100)}%`,
    cutoff: value => `${Math.round(value)} Hz`,
    decay: value => `${Number(value).toFixed(2)} s`,
    rate: value => `${Number(value).toFixed(1)} Hz`,
    depth: value => `${Math.round(value * 100)}%`,
    gain: value => `${Math.round(value * 100)}%`
  };

  function clamp(value, [minimum, maximum]) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function cleanSettings(candidate) {
    const clean = {};
    Object.keys(ranges).forEach(name => {
      const value = Number(candidate[name]);
      clean[name] = Number.isFinite(value) ? clamp(value, ranges[name]) : defaults[name];
    });
    return clean;
  }

  function encodeSettings() {
    const payload = { v: VERSION };
    Object.keys(keys).forEach(name => { payload[keys[name]] = settings[name]; });
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSettings(encoded) {
    try {
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      if (payload.v !== VERSION) return null;
      const candidate = {};
      Object.keys(keys).forEach(name => { candidate[name] = payload[keys[name]]; });
      return cleanSettings(candidate);
    } catch (error) {
      return null;
    }
  }

  function syncControls() {
    Object.keys(controls).forEach(name => {
      controls[name].value = settings[name];
      outputs[name].textContent = formatters[name](settings[name]);
    });
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAMETER, encodeSettings());
    window.history.replaceState({}, '', url);
  }

  function setStatus(message) {
    document.getElementById('status').textContent = message;
  }

  function togglePanel(open) {
    const panel = document.getElementById('advanced-panel');
    const toggle = document.getElementById('advanced-toggle');
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) document.getElementById('frequency').focus({ preventScroll: true });
  }

  function createAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
    audioContext = new AudioContextClass();
    masterGain = audioContext.createGain();
    masterGain.gain.value = settings.gain;
    masterGain.connect(audioContext.destination);
  }

  function createNoiseBuffer() {
    const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * 1.6), audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }

  function playFart() {
    try {
      if (!audioContext) createAudio();
      if (audioContext.state === 'suspended') audioContext.resume();
      const now = audioContext.currentTime;
      const duration = settings.decay;
      const body = audioContext.createOscillator();
      const bodyGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      const noise = audioContext.createBufferSource();
      const noiseGain = audioContext.createGain();
      const lfo = audioContext.createOscillator();
      const lfoGain = audioContext.createGain();

      body.type = 'sawtooth';
      body.frequency.setValueAtTime(settings.frequency * (0.92 + Math.random() * 0.16), now);
      body.detune.setValueAtTime((Math.random() - 0.5) * 20, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(settings.cutoff, now);
      filter.Q.value = 2.5;
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.7, now + 0.012);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      noise.buffer = createNoiseBuffer();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.noise * 0.48), now + 0.006);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.72);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(settings.rate, now);
      lfoGain.gain.setValueAtTime(settings.depth * 180, now);
      lfo.connect(lfoGain).connect(body.detune);
      body.connect(bodyGain).connect(filter).connect(masterGain);
      noise.connect(noiseGain).connect(filter);
      body.start(now);
      noise.start(now);
      lfo.start(now);
      body.stop(now + duration + 0.04);
      noise.stop(now + duration + 0.04);
      lfo.stop(now + duration + 0.04);
      window.setTimeout(() => [body, bodyGain, filter, noise, noiseGain, lfo, lfoGain].forEach(node => node.disconnect()), (duration + 0.2) * 1000);
      masterGain.gain.setTargetAtTime(settings.gain, now, 0.01);
      setStatus('Fart deployed. Adjust the controls and try again.');
    } catch (error) {
      setStatus(error.message || 'Audio could not be started.');
    }
  }

  function initialize() {
    Object.keys(ranges).forEach(name => {
      controls[name] = document.getElementById(name);
      outputs[name] = document.getElementById(`${name}-value`);
      controls[name].addEventListener('input', event => {
        settings[name] = clamp(Number(event.target.value), ranges[name]);
        outputs[name].textContent = formatters[name](settings[name]);
        updateUrl();
        if (masterGain && name === 'gain') masterGain.gain.setTargetAtTime(settings.gain, audioContext.currentTime, 0.02);
      });
    });

    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That FartID was not recognized; defaults loaded.');
    }
    syncControls();
    document.getElementById('fart-button').addEventListener('click', playFart);
    document.getElementById('advanced-toggle').addEventListener('click', () => togglePanel(true));
    document.getElementById('close-panel').addEventListener('click', () => togglePanel(false));
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
