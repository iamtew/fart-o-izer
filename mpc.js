/*
 * Multi Poop Composer.
 *
 * A 16-step loop on its own page: synthesized 808/909 drums, chromatic Fart and
 * Queef tracks, and a mixer strip per pad and per track. The lab's hold-to-play
 * factories stay put — they are monophonic and start at "now", so this file
 * schedules its own voices.
 *
 * Pattern, kit, BPM, and mix levels live in localStorage under fart-o-izer-mpc.
 */
(() => {
  'use strict';

  const STEPS = 16;
  const NOTE_LO = 48;
  const NOTE_HI = 71;
  const STORAGE_KEY = 'fart-o-izer-mpc';
  const LOOKAHEAD_MS = 25;
  const HORIZON = 0.1;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const PADS = [
    { id: 'kick', name: 'Kick', color: '#e39a4a', ink: '#1c140c' },
    { id: 'snare', name: 'Snare', color: '#9dcc7a', ink: '#14210f' },
    { id: 'clap', name: 'Clap', color: '#f4efe6', ink: '#1c1a17' },
    { id: 'hat', name: 'Closed Hat', color: '#7fbf62', ink: '#14210f' },
    { id: 'openhat', name: 'Open Hat', color: '#c6e2a8', ink: '#14210f' },
    { id: 'tomLow', name: 'Low Tom', color: '#c47a45', ink: '#1c140c' },
    { id: 'tomMid', name: 'Mid Tom', color: '#e0a45a', ink: '#1c140c' },
    { id: 'tomHigh', name: 'High Tom', color: '#f0d3b0', ink: '#1c140c' }
  ];
  const TOMS = { tomLow: 80, tomMid: 120, tomHigh: 180 };
  const MIX_PARAMS = [
    ['gain', 'Gain', -1, 1, 0.01],
    ['high', 'High', -12, 12, 0.1],
    ['mid', 'Mid', -12, 12, 0.1],
    ['low', 'Low', -12, 12, 0.1],
    ['filter', 'Filter', -1, 1, 0.01],
    ['pan', 'Pan', -1, 1, 0.01],
    ['level', 'Level', 0, 1, 0.01]
  ];
  const LPF_OPEN = 18000;
  const LPF_MIN = 200;
  const HPF_OPEN = 20;
  const HPF_MAX = 18000;

  function stepSeconds(bpm) {
    return 60 / bpm / 4;
  }

  function noteName(midi) {
    return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
  }

  function isBlack(midi) {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function defaultMix() {
    return { gain: 0, high: 0, mid: 0, low: 0, filter: 0, pan: 0, level: 0.8, mute: false, solo: false };
  }

  function gainAmp(amount) {
    const x = clamp(amount, -1, 1, 0);
    if (x >= 0) return 10 ** x;
    return 1 + x;
  }

  function cleanGain(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    if (n === 0.85) return 0;
    return clamp(n, -1, 1, 0);
  }

  function filterFreqs(amount) {
    const x = clamp(amount, -1, 1, 0);
    if (x <= 0) {
      return { lpf: LPF_OPEN * Math.pow(LPF_MIN / LPF_OPEN, -x), hpf: HPF_OPEN };
    }
    return { lpf: LPF_OPEN, hpf: HPF_OPEN * Math.pow(HPF_MAX / HPF_OPEN, x) };
  }

  function cleanFilter(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    if (n > 1) {
      const hz = Math.min(LPF_OPEN, Math.max(LPF_MIN, n));
      if (hz >= LPF_OPEN - 1) return 0;
      return -(Math.log(hz / LPF_OPEN) / Math.log(LPF_MIN / LPF_OPEN));
    }
    return clamp(n, -1, 1, 0);
  }

  function knobAngle(value, min, max) {
    return (value / Math.max(Math.abs(min), Math.abs(max))) * 135;
  }

  function paintKnob(input) {
    const knob = input.closest('.knob');
    if (!knob) return;
    const spec = MIX_PARAMS.find(row => row[0] === input.dataset.param);
    if (!spec) return;
    knob.style.setProperty('--ang', knobAngle(Number(input.value), spec[2], spec[3]) + 'deg');
  }

  function mixTip(param, n) {
    if (param === 'high' || param === 'mid' || param === 'low') {
      return (n > 0 ? '+' : '') + Number(n).toFixed(1) + ' dB';
    }
    if (param === 'gain') {
      if (n <= -1) return 'off';
      if (n >= 0) return (n === 0 ? '0' : '+' + Math.round(n * 20)) + ' dB';
      return Math.round((1 + n) * 100) + '%';
    }
    if (param === 'filter') {
      if (!n) return 'off';
      const f = filterFreqs(n);
      return Math.round(n < 0 ? f.lpf : f.hpf) + ' Hz';
    }
    if (param === 'pan') return !n ? 'C' : (n < 0 ? Math.round(-n * 100) + ' L' : Math.round(n * 100) + ' R');
    if (param === 'level') return Math.round(n * 100) + '%';
    return String(n);
  }

  let mixTipTimer = 0;
  function showMixTip(input) {
    const param = input.dataset.param;
    const n = Number(input.value);
    const text = mixTip(param, n);
    input.setAttribute('aria-valuetext', text);
    let tip = document.querySelector('.mix-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'mix-tip';
      tip.setAttribute('aria-hidden', 'true');
      document.querySelector('.mpc').append(tip);
    }
    tip.textContent = text;
    const knob = input.closest('.knob');
    const box = (knob || input.closest('.strip-fader-row')).getBoundingClientRect();
    tip.style.left = Math.round(box.right) + 'px';
    if (knob) {
      tip.style.top = Math.round(box.top + box.height / 2) + 'px';
    } else {
      const min = Number(input.min);
      const max = Number(input.max);
      const t = (n - min) / (max - min || 1);
      tip.style.top = Math.round(box.bottom - t * box.height) + 'px';
    }
    tip.hidden = false;
    window.clearTimeout(mixTipTimer);
    mixTipTimer = window.setTimeout(() => { tip.hidden = true; }, 800);
  }

  function cleanMix(raw) {
    const mix = defaultMix();
    if (!raw) return mix;
    mix.gain = cleanGain(raw.gain);
    mix.high = clamp(raw.high, -12, 12, mix.high);
    mix.mid = clamp(raw.mid, -12, 12, mix.mid);
    mix.low = clamp(raw.low, -12, 12, mix.low);
    mix.filter = cleanFilter(raw.filter);
    mix.pan = clamp(raw.pan, -1, 1, mix.pan);
    mix.level = clamp(raw.level, 0, 1, mix.level);
    mix.mute = !!raw.mute;
    mix.solo = !!raw.solo;
    return mix;
  }

  function anyChannelSolo(mixMap) {
    return Object.keys(mixMap).some(id => id !== 'master' && mixMap[id] && mixMap[id].solo);
  }

  function stripAudible(id, mixMap) {
    const mix = mixMap[id];
    if (!mix || mix.mute) return false;
    if (id === 'master') return true;
    return !anyChannelSolo(mixMap) || !!mix.solo;
  }

  function noteAt(notes, step, pitch) {
    return notes.find(note => note.pitch === pitch && step >= note.step && step < note.step + note.length) || null;
  }

  function placeNote(notes, step, pitch, length) {
    const len = Math.max(1, Math.min(length, STEPS - step));
    const end = step + len;
    const next = notes.filter(note => note.pitch !== pitch || note.step + note.length <= step || note.step >= end);
    next.push({ step, pitch, length: len });
    return next;
  }

  function removeNoteAt(notes, step, pitch) {
    const hit = noteAt(notes, step, pitch);
    if (!hit) return notes;
    return notes.filter(note => note !== hit);
  }

  function validNote(note) {
    return !!note
      && Number.isInteger(note.step) && note.step >= 0 && note.step < STEPS
      && Number.isInteger(note.length) && note.length >= 1 && note.step + note.length <= STEPS
      && Number.isInteger(note.pitch) && note.pitch >= NOTE_LO && note.pitch <= NOTE_HI;
  }

  function freshState() {
    const mix = { master: defaultMix() };
    const drums = {};
    PADS.forEach(pad => {
      drums[pad.id] = Array(STEPS).fill(false);
      mix[pad.id] = defaultMix();
    });
    return { kit: '808', bpm: 140, drums, tracks: [], mix, nextId: 1, selectedTrack: null };
  }

  function loadState() {
    const state = freshState();
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return state;
      if (raw.kit === '909') state.kit = '909';
      state.bpm = clamp(raw.bpm, 40, 240, state.bpm);
      PADS.forEach(pad => {
        const row = raw.drums && raw.drums[pad.id];
        if (Array.isArray(row) && row.length === STEPS) state.drums[pad.id] = row.map(Boolean);
        state.mix[pad.id] = cleanMix(raw.mix && raw.mix[pad.id]);
      });
      state.mix.master = cleanMix(raw.mix && raw.mix.master);
      if (Array.isArray(raw.tracks)) {
        raw.tracks.forEach(track => {
          if (!track || (track.type !== 'fart' && track.type !== 'queef') || typeof track.id !== 'string') return;
          state.tracks.push({
            id: track.id,
            type: track.type,
            name: String(track.name || track.type).slice(0, 32),
            notes: Array.isArray(track.notes) ? track.notes.filter(validNote) : []
          });
          state.mix[track.id] = cleanMix(raw.mix && raw.mix[track.id]);
        });
      }
      state.nextId = Math.max(1, Number(raw.nextId) || 1);
      state.selectedTrack = state.tracks.some(track => track.id === raw.selectedTrack)
        ? raw.selectedTrack
        : (state.tracks[0] ? state.tracks[0].id : null);
    } catch (err) {
      return freshState();
    }
    return state;
  }

  function selfCheck() {
    if (stepSeconds(120) !== 0.125) throw new Error('MPC stepSeconds(120) expected 0.125');
    let notes = placeNote([], 2, 60, 3);
    if (!noteAt(notes, 2, 60) || !noteAt(notes, 4, 60) || noteAt(notes, 5, 60)) {
      throw new Error('MPC note paint failed');
    }
    notes = removeNoteAt(notes, 3, 60);
    if (noteAt(notes, 2, 60) || noteAt(notes, 4, 60)) throw new Error('MPC note erase failed');
    notes = placeNote(notes, 0, 60, 1);
    if (!noteAt(notes, 0, 60) || noteAt(notes, 1, 60)) throw new Error('MPC note on/off failed');
    const mix = defaultMix();
    MIX_PARAMS.forEach(([param]) => {
      if (!(param in mix)) throw new Error('MPC MIX_PARAMS missing defaultMix key ' + param);
    });
    const off = filterFreqs(0);
    if (off.lpf !== LPF_OPEN || off.hpf !== HPF_OPEN) throw new Error('MPC filter off expected open LPF/HPF');
    if (filterFreqs(-1).lpf !== LPF_MIN || filterFreqs(1).hpf !== HPF_MAX) {
      throw new Error('MPC filter extremes expected 200 Hz LPF and 18 kHz HPF');
    }
    if (cleanFilter(18000) !== 0 || cleanFilter(200) !== -1) throw new Error('MPC filter Hz migration failed');
    if (gainAmp(0) !== 1 || gainAmp(1) !== 10 || gainAmp(-1) !== 0) throw new Error('MPC gainAmp expected unity / +20dB / off');
    if (cleanGain(0.85) !== 0) throw new Error('MPC old gain default should become noon');
    if (mixTip('gain', 0) !== '0 dB' || mixTip('filter', 0) !== 'off' || mixTip('level', 0.8) !== '80%') {
      throw new Error('MPC mix tip text mismatch');
    }
    const def = defaultMix();
    if (def.mute || def.solo) throw new Error('MPC mute/solo should default off');
    const soloMap = { kick: { mute: false, solo: true }, snare: { mute: false, solo: false }, master: { mute: false, solo: false } };
    if (!stripAudible('kick', soloMap) || stripAudible('snare', soloMap) || !stripAudible('master', soloMap)) {
      throw new Error('MPC solo should silence other channels, not master');
    }
  }

  const state = loadState();
  let ctx = null;
  let noiseBuffer = null;
  let playing = false;
  let timer = 0;
  let nextTime = 0;
  let stepIndex = 0;
  let playhead = -1;
  let drag = null;
  const strips = new Map();
  const due = [];
  let hats = [];
  let meterRaf = 0;
  const meterSamples = new Float32Array(256);

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* quota: pattern still plays */ }
  }

  function selectedTrack() {
    return state.tracks.find(track => track.id === state.selectedTrack) || null;
  }

  function trackColor(type) {
    return type === 'fart' ? '#e39a4a' : '#9dcc7a';
  }

  function ensureAudio() {
    if (ctx) return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
    ctx = new AudioContextClass();
    const length = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const masterIn = createStrip('master', ctx.destination);
    PADS.forEach(pad => createStrip(pad.id, masterIn));
    state.tracks.forEach(track => createStrip(track.id, masterIn));
    return ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  }

  function createStrip(id, destination) {
    const input = ctx.createGain();
    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6500;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1100;
    mid.Q.value = 0.8;
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 180;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.Q.value = 0.7;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.Q.value = 0.7;
    const pan = ctx.createStereoPanner();
    const level = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    input.connect(high);
    high.connect(mid);
    mid.connect(low);
    low.connect(lpf);
    lpf.connect(hpf);
    hpf.connect(pan);
    pan.connect(level);
    level.connect(destination);
    level.connect(analyser);
    strips.set(id, { input, high, mid, low, lpf, hpf, pan, level, analyser });
    applyMix(id);
    return input;
  }

  function destroyStrip(id) {
    const strip = strips.get(id);
    if (!strip) return;
    strip.analyser.disconnect();
    strip.level.disconnect();
    strips.delete(id);
  }

  function applyMix(id) {
    const strip = strips.get(id);
    const mix = state.mix[id];
    if (!strip || !mix || !ctx) return;
    const t = ctx.currentTime;
    const freqs = filterFreqs(mix.filter);
    strip.input.gain.setTargetAtTime(gainAmp(mix.gain), t, 0.01);
    strip.high.gain.setTargetAtTime(mix.high, t, 0.01);
    strip.mid.gain.setTargetAtTime(mix.mid, t, 0.01);
    strip.low.gain.setTargetAtTime(mix.low, t, 0.01);
    strip.lpf.frequency.setTargetAtTime(freqs.lpf, t, 0.01);
    strip.hpf.frequency.setTargetAtTime(freqs.hpf, t, 0.01);
    strip.pan.pan.setTargetAtTime(mix.pan, t, 0.01);
    strip.level.gain.setTargetAtTime(stripAudible(id, state.mix) ? mix.level : 0, t, 0.01);
  }

  function applyAllMix() {
    Object.keys(state.mix).forEach(applyMix);
  }

  function decayAmp(peak, decay, when) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.003 + decay);
    return gain;
  }

  function noteAmp(peak, dur, when) {
    const gain = ctx.createGain();
    const attack = Math.min(0.015, dur * 0.25);
    const release = Math.min(0.08, dur * 0.35);
    const hold = Math.max(attack, dur - release);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + attack);
    gain.gain.setValueAtTime(peak, when + hold);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(hold + 0.01, dur));
    return gain;
  }

  function triggerKick(when, dest) {
    const punch = state.kit === '909';
    const decay = punch ? 0.28 : 0.55;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(punch ? 210 : 145, when);
    osc.frequency.exponentialRampToValueAtTime(punch ? 52 : 40, when + (punch ? 0.06 : 0.14));
    const amp = decayAmp(punch ? 0.85 : 0.75, decay, when);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(when);
    osc.stop(when + decay + 0.05);
    if (!punch) return;
    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.setValueAtTime(1400, when);
    const clickAmp = decayAmp(0.18, 0.018, when);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    click.connect(hp);
    hp.connect(clickAmp);
    clickAmp.connect(dest);
    click.start(when);
    click.stop(when + 0.05);
  }

  function triggerSnare(when, dest) {
    const punch = state.kit === '909';
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(punch ? 230 : 175, when);
    tone.frequency.exponentialRampToValueAtTime(punch ? 160 : 120, when + 0.06);
    const toneAmp = decayAmp(punch ? 0.35 : 0.22, punch ? 0.12 : 0.18, when);
    tone.connect(toneAmp);
    toneAmp.connect(dest);
    tone.start(when);
    tone.stop(when + 0.3);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = punch ? 1800 : 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = punch ? 3200 : 1800;
    bp.Q.value = 0.6;
    const noiseAmp = decayAmp(punch ? 0.4 : 0.48, punch ? 0.14 : 0.24, when);
    noise.connect(hp);
    hp.connect(bp);
    bp.connect(noiseAmp);
    noiseAmp.connect(dest);
    noise.start(when);
    noise.stop(when + 0.4);
  }

  function triggerClap(when, dest) {
    const punch = state.kit === '909';
    const gaps = punch ? [0, 0.008, 0.016, 0.028] : [0, 0.012, 0.026, 0.046];
    gaps.forEach((offset, index) => {
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = punch ? 1500 : 1050;
      bp.Q.value = 0.9;
      const last = index === gaps.length - 1;
      const amp = decayAmp(last ? 0.5 : 0.22, last ? (punch ? 0.1 : 0.16) : 0.02, when + offset);
      noise.connect(bp);
      bp.connect(amp);
      amp.connect(dest);
      noise.start(when + offset);
      noise.stop(when + offset + 0.25);
    });
  }

  function chokeHats(when) {
    const t = Math.max(when, ctx.currentTime);
    hats.forEach(hat => {
      try {
        hat.amp.gain.cancelScheduledValues(t);
        hat.amp.gain.setValueAtTime(0.0001, t);
      } catch (err) { /* voice already finished */ }
      hat.sources.forEach(source => {
        try { source.stop(t + 0.02); } catch (err) { /* already stopped */ }
      });
    });
    hats = [];
  }

  function triggerHat(when, open, dest) {
    chokeHats(when);
    const punch = state.kit === '909';
    const decay = open ? (punch ? 0.32 : 0.48) : (punch ? 0.035 : 0.055);
    const amp = decayAmp(open ? 0.28 : 0.24, decay, when);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = punch ? 7000 : 5500;
    const sources = [];
    if (punch) {
      [3210, 5402].forEach(freq => {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, when);
        const gain = ctx.createGain();
        gain.gain.value = 0.18;
        osc.connect(gain);
        gain.connect(hp);
        osc.start(when);
        osc.stop(when + decay + 0.05);
        sources.push(osc);
      });
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.connect(hp);
    noise.start(when);
    noise.stop(when + decay + 0.05);
    sources.push(noise);
    hp.connect(amp);
    amp.connect(dest);
    hats.push({ amp, sources });
  }

  function triggerTom(when, id, dest) {
    const punch = state.kit === '909';
    const base = TOMS[id];
    const decay = punch ? 0.2 : 0.38;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * (punch ? 1.5 : 1.35), when);
    osc.frequency.exponentialRampToValueAtTime(base, when + (punch ? 0.05 : 0.1));
    const amp = decayAmp(0.55, decay, when);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(when);
    osc.stop(when + decay + 0.08);
  }

  function triggerPad(id, when) {
    const strip = strips.get(id);
    if (!strip) return;
    const dest = strip.input;
    if (id === 'kick') triggerKick(when, dest);
    else if (id === 'snare') triggerSnare(when, dest);
    else if (id === 'clap') triggerClap(when, dest);
    else if (id === 'hat') triggerHat(when, false, dest);
    else if (id === 'openhat') triggerHat(when, true, dest);
    else triggerTom(when, id, dest);
  }

  function triggerFart(when, dur, freq, dest) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, when);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(5, when);
    lfoGain.gain.setValueAtTime(14, when);
    lfo.connect(lfoGain);
    lfoGain.connect(osc.detune);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(2200, Math.max(320, freq * 5)), when);
    filter.Q.value = 3;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.08, when);
    const amp = noteAmp(0.26, dur, when);
    osc.connect(filter);
    noise.connect(noiseGain);
    noiseGain.connect(filter);
    filter.connect(amp);
    amp.connect(dest);
    const stop = when + dur + 0.02;
    osc.start(when);
    noise.start(when);
    lfo.start(when);
    osc.stop(stop);
    noise.stop(stop);
    lfo.stop(stop);
  }

  function triggerQueef(when, dur, freq, dest) {
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(freq, when);
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(freq * 2, when);
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.setValueAtTime(6, when);
    vibGain.gain.setValueAtTime(8, when);
    vib.connect(vibGain);
    vibGain.connect(body.detune);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(Math.min(2800, freq * 2.2), when);
    filter.Q.value = 4;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.85;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.22;
    const amp = noteAmp(0.32, dur, when);
    body.connect(bodyGain);
    bodyGain.connect(filter);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(filter);
    filter.connect(amp);
    amp.connect(dest);
    const stop = when + dur + 0.02;
    body.start(when);
    shimmer.start(when);
    vib.start(when);
    body.stop(stop);
    shimmer.stop(stop);
    vib.stop(stop);
  }

  function triggerMelodic(type, midi, when, dur, dest) {
    if (!dest) return;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    if (type === 'queef') triggerQueef(when, dur, freq, dest);
    else triggerFart(when, dur, freq, dest);
  }

  function scheduleStep(step, when) {
    const open = state.drums.openhat[step];
    PADS.forEach(pad => {
      if (!state.drums[pad.id][step]) return;
      if (pad.id === 'hat' && open) return;
      triggerPad(pad.id, when);
    });
    const durStep = stepSeconds(state.bpm);
    state.tracks.forEach(track => {
      const dest = strips.get(track.id);
      if (!dest) return;
      track.notes.forEach(note => {
        if (note.step !== step) return;
        triggerMelodic(track.type, note.pitch, when, note.length * durStep, dest.input);
      });
    });
  }

  function paintPlayhead() {
    document.querySelectorAll('[data-step]').forEach(cell => {
      cell.classList.toggle('is-playhead', Number(cell.dataset.step) === playhead);
    });
  }

  function scheduler() {
    if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
    const horizon = ctx.currentTime + HORIZON;
    while (nextTime < horizon) {
      scheduleStep(stepIndex, nextTime);
      due.push({ step: stepIndex, when: nextTime });
      nextTime += stepSeconds(state.bpm);
      stepIndex = (stepIndex + 1) % STEPS;
    }
    const now = ctx.currentTime + 0.02;
    let head = playhead;
    for (let i = due.length - 1; i >= 0; i -= 1) {
      if (due[i].when <= now) { head = due[i].step; break; }
    }
    if (due.length > 32) due.splice(0, due.length - 16);
    if (head !== playhead) {
      playhead = head;
      paintPlayhead();
    }
  }

  function startTransport() {
    if (playing) return;
    playing = true;
    const button = document.getElementById('play-button');
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Stop';
    ensureAudio().then(() => {
      if (!playing) return;
      stepIndex = 0;
      playhead = -1;
      due.length = 0;
      nextTime = ctx.currentTime + 0.06;
      timer = window.setInterval(scheduler, LOOKAHEAD_MS);
    });
  }

  function stopTransport() {
    playing = false;
    window.clearInterval(timer);
    due.length = 0;
    playhead = -1;
    paintPlayhead();
    const button = document.getElementById('play-button');
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Play';
  }

  function resetAll() {
    stopTransport();
    const keep = { master: true };
    PADS.forEach(pad => { keep[pad.id] = true; });
    strips.forEach((_, id) => {
      if (!keep[id]) destroyStrip(id);
    });
    const next = freshState();
    state.kit = next.kit;
    state.bpm = next.bpm;
    state.drums = next.drums;
    state.tracks = next.tracks;
    state.mix = next.mix;
    state.nextId = next.nextId;
    state.selectedTrack = next.selectedTrack;
    Object.keys(keep).forEach(applyMix);
    document.getElementById('bpm').value = String(state.bpm);
    syncKit();
    save();
    const tab = document.querySelector('[data-view].is-selected');
    showView(tab ? tab.dataset.view : 'drums');
  }

  function button(className, attrs, text) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    Object.keys(attrs).forEach(key => node.setAttribute(key, attrs[key]));
    if (text) node.textContent = text;
    return node;
  }

  function renderDrums() {
    const root = document.getElementById('view-drums');
    const drums = document.createElement('div');
    drums.className = 'drums';
    const rack = document.createElement('div');
    rack.className = 'pad-rack';
    const grid = document.createElement('div');
    grid.className = 'step-grid';
    PADS.forEach(pad => {
      const padButton = button('pad', { 'data-audition': pad.id }, pad.name);
      padButton.style.setProperty('--pad', pad.color);
      padButton.style.setProperty('--on-ink', pad.ink);
      rack.append(padButton);
      const row = document.createElement('div');
      row.className = 'step-row';
      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = pad.name;
      label.style.color = pad.color;
      row.append(label);
      for (let step = 0; step < STEPS; step += 1) {
        const on = state.drums[pad.id][step];
        const cell = button('step' + (on ? ' is-on' : '') + (step % 4 === 0 ? ' is-beat' : ''), {
          'data-pad': pad.id,
          'data-step': String(step),
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': pad.name + ' step ' + (step + 1)
        });
        cell.style.setProperty('--pad', pad.color);
        row.append(cell);
      }
      grid.append(row);
    });
    drums.append(rack, grid);
    root.replaceChildren(drums);
    paintPlayhead();
  }

  function paintRoll(track) {
    document.querySelectorAll('#piano-roll .cell').forEach(cell => {
      const on = !!noteAt(track.notes, Number(cell.dataset.step), Number(cell.dataset.pitch));
      cell.classList.toggle('is-on', on);
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderPiano() {
    const root = document.getElementById('view-piano');
    const bar = document.createElement('div');
    bar.className = 'piano-bar';
    bar.append(button('text-button', { 'data-add': 'fart' }, 'Add Fart'), button('text-button', { 'data-add': 'queef' }, 'Add Queef'));
    const chips = document.createElement('div');
    chips.className = 'track-chips';
    state.tracks.forEach(track => {
      const chip = button('chip' + (track.id === state.selectedTrack ? ' is-selected' : ''), { 'data-select': track.id }, track.name);
      chip.style.setProperty('--pad', trackColor(track.type));
      chips.append(chip);
    });
    const remove = button('text-button', { 'data-remove': '1' }, 'Remove');
    remove.disabled = !state.selectedTrack;
    bar.append(chips, remove);

    const wrap = document.createElement('div');
    wrap.className = 'roll-wrap';
    const track = selectedTrack();
    if (!track) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = 'Add a Fart or Queef, then paint notes on the roll.';
      wrap.append(empty);
    } else {
      const roll = document.createElement('div');
      roll.className = 'roll';
      roll.id = 'piano-roll';
      const color = trackColor(track.type);
      for (let midi = NOTE_HI; midi >= NOTE_LO; midi -= 1) {
        const name = document.createElement('span');
        name.className = 'note-name' + (isBlack(midi) ? ' is-black' : '');
        name.textContent = noteName(midi);
        roll.append(name);
        for (let step = 0; step < STEPS; step += 1) {
          const on = !!noteAt(track.notes, step, midi);
          const cell = button(
            'cell' + (on ? ' is-on' : '') + (isBlack(midi) ? ' is-black' : '') + (step % 4 === 0 ? ' is-beat' : ''),
            {
              'data-step': String(step),
              'data-pitch': String(midi),
              'aria-pressed': on ? 'true' : 'false',
              'aria-label': noteName(midi) + ' step ' + (step + 1)
            }
          );
          cell.style.setProperty('--pad', color);
          roll.append(cell);
        }
      }
      wrap.append(roll);
    }

    const keys = document.createElement('div');
    keys.className = 'keys';
    keys.setAttribute('aria-label', 'Audition keyboard');
    for (let midi = 60; midi <= 71; midi += 1) {
      keys.append(button('key' + (isBlack(midi) ? ' is-black' : ''), { 'data-key': String(midi) }, NOTE_NAMES[midi % 12]));
    }
    root.replaceChildren(bar, wrap, keys);
    paintPlayhead();
  }

  function stopMeters() {
    window.cancelAnimationFrame(meterRaf);
    meterRaf = 0;
  }

  function tickMeters() {
    meterRaf = window.requestAnimationFrame(tickMeters);
    document.querySelectorAll('canvas[data-meter]').forEach(canvas => {
      const row = canvas.closest('.strip-fader-row');
      if (!row) return;
      const cw = Math.max(1, Math.round(canvas.clientWidth));
      const ch = Math.max(1, Math.round(row.clientHeight - 6));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const fader = row.querySelector('input');
      if (fader) fader.style.width = row.clientHeight + 'px';
      const draw = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      draw.fillStyle = '#161411';
      draw.fillRect(0, 0, w, h);
      const strip = strips.get(canvas.dataset.meter);
      if (!strip || !strip.analyser) return;
      strip.analyser.getFloatTimeDomainData(meterSamples);
      let square = 0;
      for (let i = 0; i < meterSamples.length; i += 1) square += meterSamples[i] * meterSamples[i];
      const mag = Math.min(1, Math.sqrt(square / meterSamples.length) * 3.2);
      draw.fillStyle = mag > 0.85 ? '#e39a4a' : '#9dcc7a';
      const bar = Math.round(h * mag);
      draw.fillRect(0, h - bar, w, bar);
    });
  }

  function renderMixer() {
    stopMeters();
    const root = document.getElementById('view-mixer');
    const row = document.createElement('div');
    row.className = 'mixer-row';
    const channels = document.createElement('div');
    channels.className = 'mixer-channels';
    const addStrip = (id, name, color, ink, master) => {
      if (!state.mix[id]) state.mix[id] = defaultMix();
      const strip = document.createElement('section');
      strip.className = 'strip' + (master ? ' is-master' : '');
      strip.style.accentColor = color;
      const title = document.createElement('p');
      title.className = 'strip-name';
      title.textContent = name;
      title.style.background = color;
      title.style.color = ink;
      strip.append(title);
      MIX_PARAMS.forEach(([param, label, min, max, step]) => {
        const lab = document.createElement('label');
        lab.className = param === 'level' ? 'strip-fader' : 'strip-param';
        const span = document.createElement('span');
        span.textContent = label;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(state.mix[id][param]);
        input.dataset.strip = id;
        input.dataset.param = param;
        input.setAttribute('aria-label', name + ' ' + label);
        if (param === 'level') {
          const ms = document.createElement('div');
          ms.className = 'strip-ms';
          ms.append(
            button('', {
              'data-mute': id,
              'aria-pressed': state.mix[id].mute ? 'true' : 'false',
              'aria-label': name + ' mute'
            }, 'M'),
            button('', {
              'data-solo': id,
              'aria-pressed': state.mix[id].solo ? 'true' : 'false',
              'aria-label': name + ' solo'
            }, 'S')
          );
          strip.append(ms);
          const rowInner = document.createElement('div');
          rowInner.className = 'strip-fader-row';
          const meter = document.createElement('canvas');
          meter.className = 'strip-meter';
          meter.width = 12;
          meter.height = 104;
          meter.dataset.meter = id;
          meter.setAttribute('aria-hidden', 'true');
          rowInner.append(meter, input);
          lab.append(span, rowInner);
        } else {
          const knob = document.createElement('span');
          knob.className = 'knob';
          knob.append(input);
          lab.append(span, knob);
          paintKnob(input);
        }
        strip.append(lab);
      });
      return strip;
    };
    PADS.forEach(pad => channels.append(addStrip(pad.id, pad.name, pad.color, pad.ink, false)));
    state.tracks.forEach(track => channels.append(addStrip(track.id, track.name, trackColor(track.type), '#1c140c', false)));
    row.append(channels, addStrip('master', 'Master', '#f4efe6', '#1c1a17', true));
    root.replaceChildren(row);
    tickMeters();
  }

  function showView(name) {
    stopMeters();
    const tip = document.querySelector('.mix-tip');
    if (tip) tip.hidden = true;
    document.querySelectorAll('[data-view]').forEach(tab => {
      const on = tab.dataset.view === name;
      tab.classList.toggle('is-selected', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-view-panel]').forEach(panel => {
      panel.hidden = panel.dataset.viewPanel !== name;
    });
    if (name === 'drums') renderDrums();
    if (name === 'piano') renderPiano();
    if (name === 'mixer') renderMixer();
  }

  function syncKit() {
    document.querySelectorAll('[data-kit]').forEach(tab => {
      const on = tab.dataset.kit === state.kit;
      tab.classList.toggle('is-selected', on);
      tab.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function addTrack(type) {
    let id = 't' + state.nextId;
    state.nextId += 1;
    while (state.tracks.some(track => track.id === id)) {
      id = 't' + state.nextId;
      state.nextId += 1;
    }
    const count = state.tracks.filter(track => track.type === type).length + 1;
    state.tracks.push({
      id,
      type,
      name: (type === 'fart' ? 'Fart ' : 'Queef ') + count,
      notes: []
    });
    state.mix[id] = defaultMix();
    state.selectedTrack = id;
    if (ctx) {
      const master = strips.get('master');
      if (master) createStrip(id, master.input);
    }
    save();
    renderPiano();
  }

  function removeSelected() {
    const track = selectedTrack();
    if (!track) return;
    state.tracks = state.tracks.filter(item => item.id !== track.id);
    delete state.mix[track.id];
    destroyStrip(track.id);
    state.selectedTrack = state.tracks.length ? state.tracks[0].id : null;
    save();
    renderPiano();
  }

  function init() {
    selfCheck();
    const bpm = document.getElementById('bpm');
    bpm.value = String(state.bpm);
    syncKit();
    showView('drums');

    document.getElementById('play-button').addEventListener('click', () => {
      if (playing) stopTransport();
      else startTransport();
    });
    document.getElementById('reset-button').addEventListener('click', resetAll);
    bpm.addEventListener('dblclick', () => {
      state.bpm = 140;
      bpm.value = '140';
      save();
    });
    bpm.addEventListener('input', () => {
      const value = Number(bpm.value);
      if (value >= 40 && value <= 240) {
        state.bpm = value;
        save();
      }
    });
    bpm.addEventListener('change', () => {
      state.bpm = clamp(bpm.value, 40, 240, state.bpm);
      bpm.value = String(state.bpm);
      save();
    });
    document.querySelector('.kit-switch').addEventListener('click', event => {
      const tab = event.target.closest('[data-kit]');
      if (!tab) return;
      state.kit = tab.dataset.kit;
      syncKit();
      save();
    });
    document.querySelector('.view-switch').addEventListener('click', event => {
      const tab = event.target.closest('[data-view]');
      if (tab) showView(tab.dataset.view);
    });

    const drumsView = document.getElementById('view-drums');
    drumsView.addEventListener('click', event => {
      const audition = event.target.closest('[data-audition]');
      if (audition) {
        const id = audition.dataset.audition;
        ensureAudio().then(() => triggerPad(id, ctx.currentTime + 0.01));
        return;
      }
      const cell = event.target.closest('[data-pad]');
      if (!cell) return;
      const pad = cell.dataset.pad;
      const step = Number(cell.dataset.step);
      state.drums[pad][step] = !state.drums[pad][step];
      cell.classList.toggle('is-on', state.drums[pad][step]);
      cell.setAttribute('aria-pressed', state.drums[pad][step] ? 'true' : 'false');
      save();
    });

    const pianoView = document.getElementById('view-piano');
    pianoView.addEventListener('click', event => {
      const add = event.target.closest('[data-add]');
      if (add) { addTrack(add.dataset.add); return; }
      const select = event.target.closest('[data-select]');
      if (select) {
        state.selectedTrack = select.dataset.select;
        save();
        renderPiano();
        return;
      }
      if (event.target.closest('[data-remove]')) removeSelected();
    });
    pianoView.addEventListener('pointerdown', event => {
      const key = event.target.closest('[data-key]');
      if (key) {
        const track = selectedTrack();
        if (!track) return;
        const type = track.type;
        const id = track.id;
        const midi = Number(key.dataset.key);
        ensureAudio().then(() => {
          const strip = strips.get(id);
          triggerMelodic(type, midi, ctx.currentTime + 0.01, 0.28, strip && strip.input);
        });
        return;
      }
      const cell = event.target.closest('.cell');
      if (!cell) return;
      const track = selectedTrack();
      if (!track) return;
      const step = Number(cell.dataset.step);
      const pitch = Number(cell.dataset.pitch);
      if (noteAt(track.notes, step, pitch)) {
        track.notes = removeNoteAt(track.notes, step, pitch);
        save();
        paintRoll(track);
        return;
      }
      drag = { pitch, origin: step, length: 1, pointerId: event.pointerId };
      track.notes = placeNote(track.notes, step, pitch, 1);
      paintRoll(track);
      pianoView.setPointerCapture(event.pointerId);
    });
    pianoView.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const cell = hit && hit.closest ? hit.closest('.cell') : null;
      if (!cell) return;
      const pitch = Number(cell.dataset.pitch);
      const step = Number(cell.dataset.step);
      if (pitch !== drag.pitch || step < drag.origin) return;
      const length = step - drag.origin + 1;
      if (length === drag.length) return;
      drag.length = length;
      const track = selectedTrack();
      track.notes = placeNote(track.notes, drag.origin, pitch, length);
      paintRoll(track);
    });
    const endDrag = event => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      drag = null;
      save();
    };
    pianoView.addEventListener('pointerup', endDrag);
    pianoView.addEventListener('pointercancel', endDrag);
    pianoView.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const cell = event.target.closest('.cell');
      if (!cell) return;
      event.preventDefault();
      const track = selectedTrack();
      if (!track) return;
      const step = Number(cell.dataset.step);
      const pitch = Number(cell.dataset.pitch);
      track.notes = noteAt(track.notes, step, pitch)
        ? removeNoteAt(track.notes, step, pitch)
        : placeNote(track.notes, step, pitch, 1);
      save();
      paintRoll(track);
    });

    document.getElementById('view-mixer').addEventListener('click', event => {
      const mute = event.target.closest('[data-mute]');
      const solo = event.target.closest('[data-solo]');
      if (!mute && !solo) return;
      const id = (mute || solo).dataset.mute || (mute || solo).dataset.solo;
      const mix = state.mix[id];
      if (!mix) return;
      if (mute) mix.mute = !mix.mute;
      else mix.solo = !mix.solo;
      save();
      applyAllMix();
      const on = mute ? mix.mute : mix.solo;
      (mute || solo).setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    document.getElementById('view-mixer').addEventListener('input', event => {
      const input = event.target;
      if (!input.dataset || !input.dataset.strip) return;
      const id = input.dataset.strip;
      state.mix[id][input.dataset.param] = Number(input.value);
      paintKnob(input);
      showMixTip(input);
      applyMix(id);
      save();
    });
    let mixDbl = { t: 0, el: null };
    document.getElementById('view-mixer').addEventListener('pointerdown', event => {
      const input = event.target.closest('label')?.querySelector('input[data-strip][data-param]');
      if (!input || event.button) return;
      const now = event.timeStamp;
      if (mixDbl.el === input && now - mixDbl.t < 500) {
        event.preventDefault();
        mixDbl = { t: 0, el: null };
        const value = defaultMix()[input.dataset.param];
        if (value === undefined) return;
        state.mix[input.dataset.strip][input.dataset.param] = value;
        input.value = String(value);
        paintKnob(input);
        showMixTip(input);
        applyMix(input.dataset.strip);
        save();
        return;
      }
      mixDbl = { t: now, el: input };
    });
  }

  init();
})();
