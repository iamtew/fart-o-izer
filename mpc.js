/*
 * Multi Poop Composer.
 *
 * Patterns (1/2/4/8 bars of 4/4) on their own page: synthesized 808/909 drums,
 * Fart and Queef piano roll, mixer, and a song timeline. The lab's hold-to-play
 * factories stay put — they are monophonic and start at "now", so this file
 * schedules its own voices.
 *
 * Patterns, kit, BPM, mix, and arrangement live in localStorage under fart-o-izer-mpc.
 */
(() => {
  'use strict';

  const STEPS = 16;
  const TICKS = 32;
  const PAGE_BARS = 4;
  const NOTE_LO = 48;
  const NOTE_HI = 71;
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const MINOR = [0, 2, 3, 5, 7, 8, 10];
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

  function tickSeconds(bpm) {
    return 60 / bpm / 8;
  }

  function inScale(midi, root, mode) {
    if (mode === 'chromatic') return true;
    const pc = ((midi % 12) - root + 12) % 12;
    return (mode === 'minor' ? MINOR : MAJOR).includes(pc);
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

  function noteAt(notes, step, pitch, span) {
    const width = span || 1;
    return notes.find(note => note.pitch === pitch && note.step < step + width && step < note.step + note.length) || null;
  }

  function placeNote(notes, step, pitch, length, ticksMax) {
    const cap = ticksMax || TICKS;
    const len = Math.max(1, Math.min(length, cap - step));
    const end = step + len;
    const next = notes.filter(note => note.pitch !== pitch || note.step + note.length <= step || note.step >= end);
    next.push({ step, pitch, length: len });
    return next;
  }

  function removeNoteAt(notes, step, pitch, span) {
    const hit = noteAt(notes, step, pitch, span);
    if (!hit) return notes;
    return notes.filter(note => note !== hit);
  }

  function validNote(note, ticksMax) {
    const cap = ticksMax || TICKS;
    return !!note
      && Number.isInteger(note.step) && note.step >= 0 && note.step < cap
      && Number.isInteger(note.length) && note.length >= 1 && note.step + note.length <= cap
      && Number.isInteger(note.pitch) && note.pitch >= NOTE_LO && note.pitch <= NOTE_HI;
  }

  function asTickNote(note, from16, ticksMax) {
    if (!note) return null;
    const next = {
      step: from16 ? note.step * 2 : note.step,
      length: from16 ? note.length * 2 : note.length,
      pitch: note.pitch
    };
    return validNote(next, ticksMax) ? next : null;
  }

  function snapTick(tick, bars, span) {
    const max = bars * TICKS;
    const step = span || 2;
    if (max < 1) return 0;
    const n = Math.round(Math.max(0, tick) / step) * step;
    return ((n % max) + max) % max;
  }

  function drumStepFromTick(tick, bars) {
    return snapTick(tick, bars, 2) >> 1;
  }

  function heldNoteLength(startTick, playTick, bars, span) {
    const max = bars * TICKS;
    const step = span || 2;
    if (startTick >= max) return step;
    const end = snapTick(playTick, bars, step);
    if (end < startTick) return max - startTick;
    if (end === startTick) return step;
    return Math.min(end - startTick, max - startTick);
  }

  function emptyDrums(bars) {
    const drums = {};
    PADS.forEach(pad => { drums[pad.id] = Array(bars * STEPS).fill(false); });
    return drums;
  }

  function nextPatternName(patterns) {
    if (!patterns.length) return 'PATTERN';
    let max = 0;
    let hasBare = false;
    patterns.forEach(pattern => {
      if (pattern.name === 'PATTERN') hasBare = true;
      const match = /^PATTERN (\d+)$/.exec(pattern.name);
      if (match) max = Math.max(max, Number(match[1]));
    });
    if (!hasBare) return 'PATTERN';
    return 'PATTERN ' + (max + 1);
  }

  function clipBars(clip, patterns) {
    const pattern = patterns.find(item => item.id === clip.patternId);
    return pattern ? pattern.bars * Math.max(1, clip.repeats | 0) : 0;
  }

  function songLengthBars(arrangement, patterns, loopEnd) {
    let end = 4;
    arrangement.forEach(clip => { end = Math.max(end, clip.startBar + clipBars(clip, patterns)); });
    if (loopEnd) end = Math.max(end, loopEnd);
    return Math.max(end, 1);
  }

  function songHit(songTick, arrangement, patterns) {
    const bar = Math.floor(songTick / TICKS);
    const localInBar = ((songTick % TICKS) + TICKS) % TICKS;
    for (let i = 0; i < arrangement.length; i += 1) {
      const clip = arrangement[i];
      const span = clipBars(clip, patterns);
      if (bar < clip.startBar || bar >= clip.startBar + span) continue;
      const pattern = patterns.find(item => item.id === clip.patternId);
      if (!pattern) return null;
      const localBar = (bar - clip.startBar) % pattern.bars;
      return { pattern, localTick: localBar * TICKS + localInBar, clip };
    }
    return null;
  }

  function nextSongTick(tick, arrangement, patterns, loopStart, loopEnd) {
    const endBar = loopEnd || songLengthBars(arrangement, patterns, loopEnd);
    const startBar = Math.max(0, Math.min(loopStart, endBar - 1));
    const startTick = startBar * TICKS;
    const endTick = Math.max(startBar + 1, endBar) * TICKS;
    const next = tick + 1;
    return next >= endTick ? startTick : next;
  }

  function rangesOverlap(a0, a1, b0, b1) {
    return a0 < b1 && b0 < a1;
  }

  function clipFits(arrangement, ignore, startBar, bars, patterns) {
    if (startBar < 0 || bars < 1) return false;
    return arrangement.every((clip, i) => {
      if (i === ignore) return true;
      return !rangesOverlap(startBar, startBar + bars, clip.startBar, clip.startBar + clipBars(clip, patterns));
    });
  }

  function resizePattern(pattern, bars) {
    if (![1, 2, 4, 8].includes(bars) || bars === pattern.bars) return pattern;
    const ticksMax = bars * TICKS;
    const steps = bars * STEPS;
    const next = { id: pattern.id, name: pattern.name, bars, drums: emptyDrums(bars), notes: {} };
    PADS.forEach(pad => {
      const row = pattern.drums[pad.id] || [];
      for (let i = 0; i < Math.min(row.length, steps); i += 1) next.drums[pad.id][i] = !!row[i];
    });
    Object.keys(pattern.notes).forEach(id => {
      next.notes[id] = (pattern.notes[id] || []).map(note => {
        if (note.step >= ticksMax) return null;
        const length = Math.min(note.length, ticksMax - note.step);
        return length >= 1 ? { step: note.step, pitch: note.pitch, length } : null;
      }).filter(Boolean);
    });
    return next;
  }

  function loadPattern(raw, from16, trackIds) {
    const bars = raw && [1, 2, 4, 8].includes(raw.bars) ? raw.bars : 1;
    const ticksMax = bars * TICKS;
    const drums = emptyDrums(bars);
    PADS.forEach(pad => {
      const row = raw && raw.drums && raw.drums[pad.id];
      if (Array.isArray(row) && row.length === bars * STEPS) drums[pad.id] = row.map(Boolean);
    });
    const notes = {};
    trackIds.forEach(id => { notes[id] = []; });
    if (raw && raw.notes && typeof raw.notes === 'object') {
      Object.keys(raw.notes).forEach(id => {
        notes[id] = Array.isArray(raw.notes[id])
          ? raw.notes[id].map(note => asTickNote(note, from16, ticksMax)).filter(Boolean)
          : [];
      });
    }
    return {
      id: String(raw && raw.id ? raw.id : 'p1'),
      name: String(raw && raw.name ? raw.name : 'PATTERN').slice(0, 16),
      bars,
      drums,
      notes
    };
  }

  function freshState() {
    const mix = { master: defaultMix() };
    PADS.forEach(pad => { mix[pad.id] = defaultMix(); });
    const pattern = { id: 'p1', name: 'PATTERN', bars: 1, drums: emptyDrums(1), notes: {} };
    return {
      kit: '808', bpm: 140, tracks: [], mix, nextId: 1, selectedTrack: null,
      grid: 16, root: 0, mode: 'chromatic', ticks: TICKS,
      patterns: [pattern], patternId: 'p1', nextPattern: 2,
      arrangement: [], loopStart: 0, loopEnd: 0, playSong: false, pxPerBar: 48, seqShare: 0.33
    };
  }

  function loadState() {
    const state = freshState();
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw || typeof raw !== 'object') return state;
      if (raw.kit === '909') state.kit = '909';
      state.bpm = clamp(raw.bpm, 40, 240, state.bpm);
      state.grid = raw.grid === 32 ? 32 : 16;
      state.root = Number.isInteger(raw.root) && raw.root >= 0 && raw.root <= 11 ? raw.root : 0;
      state.mode = raw.mode === 'major' || raw.mode === 'minor' ? raw.mode : 'chromatic';
      const from16 = raw.ticks !== TICKS;
      PADS.forEach(pad => {
        state.mix[pad.id] = cleanMix(raw.mix && raw.mix[pad.id]);
      });
      state.mix.master = cleanMix(raw.mix && raw.mix.master);
      if (Array.isArray(raw.tracks)) {
        raw.tracks.forEach(track => {
          if (!track || (track.type !== 'fart' && track.type !== 'queef') || typeof track.id !== 'string') return;
          state.tracks.push({
            id: track.id,
            type: track.type,
            name: String(track.name || track.type).slice(0, 32)
          });
          state.mix[track.id] = cleanMix(raw.mix && raw.mix[track.id]);
        });
      }
      const trackIds = state.tracks.map(track => track.id);
      if (Array.isArray(raw.patterns) && raw.patterns.length) {
        state.patterns = raw.patterns.map(item => loadPattern(item, from16, trackIds));
        state.patternId = state.patterns.some(item => item.id === raw.patternId)
          ? raw.patternId
          : state.patterns[0].id;
        state.nextPattern = Math.max(state.patterns.length + 1, Number(raw.nextPattern) || 1);
      } else {
        const drums = emptyDrums(1);
        PADS.forEach(pad => {
          const row = raw.drums && raw.drums[pad.id];
          if (Array.isArray(row) && row.length === STEPS) drums[pad.id] = row.map(Boolean);
        });
        const notes = {};
        trackIds.forEach(id => { notes[id] = []; });
        raw.tracks && raw.tracks.forEach(track => {
          if (!track || typeof track.id !== 'string') return;
          notes[track.id] = Array.isArray(track.notes)
            ? track.notes.map(note => asTickNote(note, from16, TICKS)).filter(Boolean)
            : [];
        });
        state.patterns = [{ id: 'p1', name: 'PATTERN', bars: 1, drums, notes }];
        state.patternId = 'p1';
        state.nextPattern = 2;
      }
      if (Array.isArray(raw.arrangement)) {
        raw.arrangement.forEach(clip => {
          if (!clip || !state.patterns.some(item => item.id === clip.patternId)) return;
          const startBar = Math.max(0, clip.startBar | 0);
          const repeats = Math.max(1, clip.repeats | 0);
          if (!clipFits(state.arrangement, -1, startBar, clipBars({ patternId: clip.patternId, repeats }, state.patterns), state.patterns)) return;
          state.arrangement.push({ patternId: clip.patternId, startBar, repeats });
        });
      }
      state.loopStart = Math.max(0, raw.loopStart | 0);
      state.loopEnd = Math.max(0, raw.loopEnd | 0);
      state.playSong = !!raw.playSong && state.arrangement.length > 0;
      state.pxPerBar = clamp(raw.pxPerBar, 16, 160, 48);
      state.seqShare = clamp(raw.seqShare, 0.18, 0.7, 0.33);
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
    if (tickSeconds(120) !== 0.0625) throw new Error('MPC tickSeconds(120) expected 0.0625');
    let notes = placeNote([], 2, 60, 3);
    if (!noteAt(notes, 2, 60) || !noteAt(notes, 4, 60) || noteAt(notes, 5, 60)) {
      throw new Error('MPC note paint failed');
    }
    notes = removeNoteAt(notes, 3, 60);
    if (noteAt(notes, 2, 60) || noteAt(notes, 4, 60)) throw new Error('MPC note erase failed');
    notes = placeNote(notes, 0, 60, 1);
    if (!noteAt(notes, 0, 60) || noteAt(notes, 1, 60)) throw new Error('MPC note on/off failed');
    notes = placeNote([], 4, 60, 2);
    notes = placeNote(notes, 4, 60, 6);
    if (!noteAt(notes, 4, 60) || !noteAt(notes, 9, 60) || noteAt(notes, 10, 60)) {
      throw new Error('MPC note stretch failed');
    }
    const migrated = asTickNote({ step: 2, length: 1, pitch: 60 }, true);
    if (!migrated || migrated.step !== 4 || migrated.length !== 2) throw new Error('MPC 16th-to-tick migrate failed');
    if (!inScale(60, 0, 'major') || inScale(61, 0, 'major') || !inScale(61, 0, 'chromatic')) {
      throw new Error('MPC key lock scale failed');
    }
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
    const wrapped = loadPattern({
      id: 'p1', name: 'A', bars: 1,
      drums: { kick: Array(STEPS).fill(false) },
      notes: { t1: [{ step: 0, length: 2, pitch: 60 }] }
    }, false, ['t1']);
    if (wrapped.bars !== 1 || wrapped.notes.t1.length !== 1) throw new Error('MPC pattern wrap failed');
    if (nextPatternName([]) !== 'PATTERN' || nextPatternName([{ name: 'PATTERN' }]) !== 'PATTERN 1') {
      throw new Error('MPC pattern names should be PATTERN, PATTERN 1, …');
    }
    if (nextPatternName([{ name: 'PATTERN' }, { name: 'PATTERN 2' }]) !== 'PATTERN 3') {
      throw new Error('MPC pattern name counter should skip used numbers');
    }
    const grown = resizePattern(wrapped, 2);
    if (grown.bars !== 2 || grown.notes.t1.length !== 1 || grown.drums.kick.length !== STEPS * 2) {
      throw new Error('MPC pattern double should extend with empty bars');
    }
    if (grown.drums.kick.slice(STEPS).some(Boolean)) throw new Error('MPC pattern double should not copy hits');
    const halved = resizePattern(grown, 1);
    if (halved.bars !== 1 || halved.notes.t1.length !== 1 || halved.drums.kick.length !== STEPS) {
      throw new Error('MPC pattern half should keep the first bars');
    }
    grown.notes.t1.push({ step: TICKS, pitch: 60, length: 2 });
    if (resizePattern(grown, 1).notes.t1.some(note => note.step >= TICKS)) {
      throw new Error('MPC pattern half should drop notes past the new length');
    }
    const patterns = [
      { id: 'p1', bars: 1 },
      { id: 'p2', bars: 2 }
    ];
    const arrangement = [{ patternId: 'p2', startBar: 2, repeats: 2 }];
    const hit = songHit(2 * TICKS, arrangement, patterns);
    if (!hit || hit.pattern.id !== 'p2' || hit.localTick !== 0) throw new Error('MPC song tick should map into the clip');
    const wrap = nextSongTick(6 * TICKS - 1, arrangement, patterns, 2, 6);
    if (wrap !== 2 * TICKS) throw new Error('MPC song wrap should return to loop start');
    if (songHit(0, arrangement, patterns)) throw new Error('MPC song gap should be silence');
    if (drumStepFromTick(0, 1) !== 0) throw new Error('MPC live record tick 0 should land on step 0');
    if (drumStepFromTick(1, 1) !== 1) throw new Error('MPC live record should round odd 32nds to the next 16th');
    if (drumStepFromTick(31, 1) !== 0) throw new Error('MPC live record last tick should wrap');
    if (snapTick(1, 1, 1) !== 1 || snapTick(31, 1, 1) !== 31) throw new Error('MPC live record 32nd snap should keep ticks');
    if (heldNoteLength(0, 0, 1, 2) !== 2) throw new Error('MPC held key tap should last one 16th');
    if (heldNoteLength(0, 4, 1, 2) !== 4) throw new Error('MPC held key should stretch to the release tick');
    if (heldNoteLength(30, 0, 1, 2) !== 2) throw new Error('MPC held key should cap at the pattern end');
  }

  const state = loadState();
  let ctx = null;
  let noiseBuffer = null;
  let playing = false;
  let recording = false;
  const padPointers = new Map();
  let timer = 0;
  let nextTime = 0;
  let stepIndex = 0;
  let playhead = -1;
  let drag = null;
  let tlDrag = null;
  let patternPage = 0;
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

  function currentPattern() {
    return state.patterns.find(item => item.id === state.patternId) || state.patterns[0];
  }

  function patternTicks() {
    return currentPattern().bars * TICKS;
  }

  function pageCount() {
    return Math.max(1, Math.ceil(currentPattern().bars / PAGE_BARS));
  }

  function viewBars() {
    patternPage = Math.max(0, Math.min(patternPage, pageCount() - 1));
    const start = patternPage * PAGE_BARS;
    return { start, count: Math.min(PAGE_BARS, currentPattern().bars - start) };
  }

  function trackNotes(track) {
    const pattern = currentPattern();
    if (!pattern.notes[track.id]) pattern.notes[track.id] = [];
    return pattern.notes[track.id];
  }

  function usingSong() {
    return state.playSong && state.arrangement.length > 0;
  }

  function iconEl(name) {
    const node = document.createElement('i');
    node.className = 'fa-solid ' + name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function setPlayUi() {
    const node = document.getElementById('play-button');
    node.replaceChildren(iconEl(playing ? 'fa-stop' : 'fa-play'));
    node.setAttribute('aria-pressed', playing ? 'true' : 'false');
    node.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  }

  function setRecUi() {
    const node = document.getElementById('rec-button');
    node.setAttribute('aria-pressed', recording ? 'true' : 'false');
  }

  function syncPlayMode() {
    if (!state.arrangement.length) state.playSong = false;
    document.querySelectorAll('[data-mode]').forEach(tab => {
      const song = tab.dataset.mode === 'song';
      tab.disabled = song && !state.arrangement.length;
      const on = song ? state.playSong : !state.playSong;
      tab.classList.toggle('is-selected', on);
      tab.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applySeqShare() {
    const share = clamp(state.seqShare, 0.18, 0.7, 0.33);
    const mpc = document.querySelector('.mpc');
    mpc.style.setProperty('--seq-grow', String(share));
    mpc.style.setProperty('--edit-grow', String(1 - share));
    const split = document.getElementById('seq-split');
    split.setAttribute('aria-valuemin', '18');
    split.setAttribute('aria-valuemax', '70');
    split.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  }

  function patternColor(id) {
    const index = Math.max(0, state.patterns.findIndex(item => item.id === id));
    return PADS[index % PADS.length].color;
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
    return { amp, sources: [osc, noise, lfo] };
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
    return { amp, sources: [body, shimmer, vib] };
  }

  function triggerMelodic(type, midi, when, dur, dest) {
    if (!dest) return null;
    const freq = 440 * 2 ** ((midi - 69) / 12);
    if (type === 'queef') return triggerQueef(when, dur, freq, dest);
    return triggerFart(when, dur, freq, dest);
  }

  function releaseVoice(voice) {
    if (!voice || !ctx) return;
    const t = ctx.currentTime;
    try {
      voice.amp.gain.cancelScheduledValues(t);
      voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), t);
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    } catch (err) { /* voice already finished */ }
    voice.sources.forEach(source => {
      try { source.stop(t + 0.1); } catch (err) { /* already stopped */ }
    });
  }

  function audition(midi) {
    const track = selectedTrack();
    if (!track) return;
    const type = track.type;
    const id = track.id;
    ensureAudio().then(() => {
      const strip = strips.get(id);
      triggerMelodic(type, midi, ctx.currentTime + 0.01, 0.28, strip && strip.input);
    });
  }

  function gridSpan() {
    return TICKS / (state.grid === 32 ? 32 : 16);
  }

  function scheduleTick(tick, when) {
    let drums;
    let notesMap;
    let localTick;
    if (usingSong()) {
      const hit = songHit(tick, state.arrangement, state.patterns);
      if (!hit) return;
      drums = hit.pattern.drums;
      notesMap = hit.pattern.notes;
      localTick = hit.localTick;
    } else {
      const pattern = currentPattern();
      drums = pattern.drums;
      notesMap = pattern.notes;
      localTick = tick;
    }
    if ((localTick & 1) === 0) {
      const step = localTick >> 1;
      const open = drums.openhat[step];
      PADS.forEach(pad => {
        if (!drums[pad.id][step]) return;
        if (pad.id === 'hat' && open) return;
        triggerPad(pad.id, when);
      });
    }
    const durTick = tickSeconds(state.bpm);
    state.tracks.forEach(track => {
      const dest = strips.get(track.id);
      if (!dest) return;
      (notesMap[track.id] || []).forEach(note => {
        if (note.step !== localTick) return;
        if (heldLiveNote(track.id, note)) return;
        triggerMelodic(track.type, note.pitch, when, note.length * durTick, dest.input);
      });
    });
  }

  function paintPlayhead() {
    let gridHead = playhead;
    if (usingSong()) {
      const hit = songHit(playhead, state.arrangement, state.patterns);
      gridHead = hit && hit.pattern.id === state.patternId ? hit.localTick : -1;
    }
    if (playing && gridHead >= 0 && pageCount() > 1) {
      const want = Math.floor(Math.floor(gridHead / TICKS) / PAGE_BARS);
      if (want !== patternPage) {
        patternPage = want;
        const tab = document.querySelector('[data-view].is-selected');
        const name = tab ? tab.dataset.view : 'drums';
        if (name === 'drums') renderDrums();
        else if (name === 'piano') renderPiano();
        renderBank();
        return;
      }
    }
    document.querySelectorAll('[data-step]').forEach(cell => {
      const start = Number(cell.dataset.step);
      const span = Number(cell.dataset.span || 1);
      cell.classList.toggle('is-playhead', gridHead >= start && gridHead < start + span);
    });
    const line = document.querySelector('.tl-playhead');
    if (!line) return;
    if (!playing || !usingSong() || playhead < 0) {
      line.hidden = true;
      return;
    }
    line.hidden = false;
    line.style.left = (playhead / TICKS) * state.pxPerBar + 'px';
  }

  function scheduler() {
    if (nextTime < ctx.currentTime - 0.2) nextTime = ctx.currentTime + 0.05;
    const horizon = ctx.currentTime + HORIZON;
    while (nextTime < horizon) {
      scheduleTick(stepIndex, nextTime);
      due.push({ step: stepIndex, when: nextTime });
      nextTime += tickSeconds(state.bpm);
      if (usingSong()) {
        stepIndex = nextSongTick(stepIndex, state.arrangement, state.patterns, state.loopStart, state.loopEnd);
      } else {
        stepIndex = (stepIndex + 1) % patternTicks();
      }
    }
    const now = ctx.currentTime + 0.02;
    let head = playhead;
    for (let i = due.length - 1; i >= 0; i -= 1) {
      if (due[i].when <= now) { head = due[i].step; break; }
    }
    if (due.length > 64) due.splice(0, due.length - 32);
    if (head !== playhead) {
      playhead = head;
      stretchHeldKeys();
      paintPlayhead();
    }
  }

  function startTransport() {
    if (playing) return;
    playing = true;
    setPlayUi();
    ensureAudio().then(() => {
      if (!playing) return;
      stepIndex = usingSong() ? state.loopStart * TICKS : 0;
      playhead = -1;
      due.length = 0;
      nextTime = ctx.currentTime + 0.06;
      timer = window.setInterval(scheduler, LOOKAHEAD_MS);
    });
  }

  function stopTransport() {
    playing = false;
    recording = false;
    window.clearInterval(timer);
    due.length = 0;
    playhead = -1;
    paintPlayhead();
    setPlayUi();
    setRecUi();
  }

  function armRecord() {
    if (state.playSong) {
      state.playSong = false;
      syncPlayMode();
      save();
      if (playing) stopTransport();
    }
    recording = true;
    setRecUi();
    if (!playing) startTransport();
  }

  function paintDrumStep(id, step, on) {
    document.querySelectorAll('#view-drums [data-pad="' + id + '"][data-step="' + (step * 2) + '"]').forEach(cell => {
      cell.classList.toggle('is-on', on);
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function recordPad(id) {
    if (!recording || !playing) return;
    const pattern = currentPattern();
    const row = pattern.drums[id];
    if (!row) return;
    const step = drumStepFromTick(playhead < 0 ? 0 : playhead, pattern.bars);
    row[step] = true;
    paintDrumStep(id, step, true);
    save();
  }

  function hitPad(id) {
    ensureAudio().then(() => triggerPad(id, ctx.currentTime + 0.01));
    recordPad(id);
  }

  function heldLiveNote(trackId, note) {
    for (const hold of padPointers.values()) {
      if (hold.kind === 'key' && hold.recording && hold.trackId === trackId && hold.midi === note.pitch && hold.start === note.step) {
        return true;
      }
    }
    return false;
  }

  function writeHeldNote(hold, length) {
    const track = state.tracks.find(item => item.id === hold.trackId);
    if (!track) return;
    hold.length = length;
    currentPattern().notes[track.id] = placeNote(trackNotes(track), hold.start, hold.midi, length, patternTicks());
    paintRoll(track);
  }

  function stretchHeldKeys() {
    if (!recording || !playing) return;
    const span = gridSpan();
    const bars = currentPattern().bars;
    const tick = playhead < 0 ? 0 : playhead;
    padPointers.forEach(hold => {
      if (hold.kind !== 'key' || !hold.recording) return;
      const length = heldNoteLength(hold.start, tick, bars, span);
      if (length === hold.length) return;
      writeHeldNote(hold, length);
    });
  }

  function beginKeyHold(id, el, midi) {
    if (padPointers.has(id)) return;
    const track = selectedTrack();
    const span = gridSpan();
    const writing = !!(recording && playing && track);
    const start = writing ? snapTick(playhead < 0 ? 0 : playhead, currentPattern().bars, span) : 0;
    const hold = { kind: 'key', el, midi, start, trackId: track && track.id, voice: null, length: span, recording: writing };
    padPointers.set(id, hold);
    el.classList.add('is-down');
    if (writing) writeHeldNote(hold, span);
    if (!track) return;
    ensureAudio().then(() => {
      const live = padPointers.get(id);
      if (!live || live.kind !== 'key') return;
      const strip = strips.get(track.id);
      // ponytail: 60s hold ceiling; releaseVoice cuts it short
      live.voice = triggerMelodic(track.type, midi, ctx.currentTime, 60, strip && strip.input);
    });
  }

  function endLivePointer(id) {
    const hold = padPointers.get(id);
    padPointers.delete(id);
    if (!hold) return;
    if (hold.el) hold.el.classList.remove('is-down');
    if (hold.kind !== 'key') return;
    releaseVoice(hold.voice);
    if (!hold.recording) return;
    const span = gridSpan();
    writeHeldNote(hold, heldNoteLength(hold.start, playhead < 0 ? hold.start : playhead, currentPattern().bars, span));
    save();
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
    state.tracks = next.tracks;
    state.mix = next.mix;
    state.nextId = next.nextId;
    state.selectedTrack = next.selectedTrack;
    state.grid = next.grid;
    state.root = next.root;
    state.mode = next.mode;
    state.ticks = next.ticks;
    state.patterns = next.patterns;
    state.patternId = next.patternId;
    state.nextPattern = next.nextPattern;
    state.arrangement = next.arrangement;
    state.loopStart = next.loopStart;
    state.loopEnd = next.loopEnd;
    state.playSong = next.playSong;
    state.pxPerBar = next.pxPerBar;
    state.seqShare = next.seqShare;
    Object.keys(keep).forEach(applyMix);
    document.getElementById('bpm').value = String(state.bpm);
    syncKit();
    applySeqShare();
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

  function iconButton(className, attrs, iconName) {
    const node = button(className, attrs);
    node.append(iconEl(iconName));
    return node;
  }

  function selectPattern(id, refresh) {
    if (!state.patterns.some(item => item.id === id)) return;
    const same = state.patternId === id;
    state.patternId = id;
    save();
    if (refresh === false) {
      renderBank();
      document.querySelectorAll('.tl-clip').forEach((node, index) => {
        node.classList.toggle('is-selected', state.arrangement[index] && state.arrangement[index].patternId === id);
      });
      return;
    }
    if (same) return;
    patternPage = 0;
    const tab = document.querySelector('[data-view].is-selected');
    showView(tab ? tab.dataset.view : 'drums');
  }

  function addPattern() {
    const id = 'p' + state.nextPattern;
    state.nextPattern += 1;
    const notes = {};
    state.tracks.forEach(track => { notes[track.id] = []; });
    state.patterns.push({
      id,
      name: nextPatternName(state.patterns),
      bars: 1,
      drums: emptyDrums(1),
      notes
    });
    selectPattern(id);
  }

  function resizeCurrentPattern(bars) {
    const pattern = currentPattern();
    const next = resizePattern(pattern, bars);
    if (next === pattern) return;
    const index = state.patterns.findIndex(item => item.id === pattern.id);
    state.patterns[index] = next;
    save();
    const tab = document.querySelector('[data-view].is-selected');
    showView(tab ? tab.dataset.view : 'drums');
  }

  function deleteCurrentPattern() {
    if (state.patterns.length < 2) return;
    const id = state.patternId;
    state.patterns = state.patterns.filter(item => item.id !== id);
    state.arrangement = state.arrangement.filter(clip => clip.patternId !== id);
    state.patternId = state.patterns[0].id;
    save();
    const tab = document.querySelector('[data-view].is-selected');
    showView(tab ? tab.dataset.view : 'drums');
  }

  function renderBank() {
    const root = document.getElementById('pattern-bank');
    const row = document.createElement('div');
    row.className = 'pattern-row';
    state.patterns.forEach(pattern => {
      const chip = button(
        'chip' + (pattern.id === state.patternId ? ' is-selected' : ''),
        { 'data-pattern': pattern.id, title: pattern.name + ' · ' + pattern.bars + ' bar · double-click to rename' },
        pattern.name
      );
      chip.style.setProperty('--pad', patternColor(pattern.id));
      row.append(chip);
    });
    const add = iconButton('icon-button', { 'data-pattern-add': '1', 'aria-label': 'Add pattern', title: 'Add pattern' }, 'fa-plus');
    const mid = document.createElement('div');
    mid.className = 'pattern-mid';
    mid.append(row, add);
    const del = iconButton('icon-button', { 'data-pattern-del': '1', 'aria-label': 'Delete pattern', title: 'Delete pattern' }, 'fa-trash');
    del.disabled = state.patterns.length < 2;
    del.classList.add('pattern-reset');
    root.replaceChildren(mid, del);
  }

  function startRename(id) {
    const pattern = state.patterns.find(item => item.id === id);
    const chip = document.querySelector('[data-pattern="' + id + '"]');
    if (!pattern || !chip || chip.querySelector('.pattern-name')) return;
    const input = document.createElement('input');
    input.className = 'pattern-name';
    input.value = pattern.name;
    input.maxLength = 16;
    input.setAttribute('aria-label', 'Pattern name');
    chip.replaceChildren(input);
    input.focus();
    input.select();
    const commit = () => {
      pattern.name = input.value.trim().slice(0, 16) || pattern.name;
      save();
      renderBank();
      renderTimeline();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') {
        input.value = pattern.name;
        input.blur();
      }
    });
    input.addEventListener('click', event => event.stopPropagation());
  }

  function loopEndBar() {
    return state.loopEnd || songLengthBars(state.arrangement, state.patterns, state.loopEnd);
  }

  function renderTimeline() {
    const root = document.getElementById('timeline');
    const tools = document.createElement('div');
    tools.className = 'tl-tools';
    tools.append(
      iconButton('icon-button', { 'data-zoom': 'out', 'aria-label': 'Zoom out', title: 'Zoom out' }, 'fa-magnifying-glass-minus'),
      iconButton('icon-button', { 'data-zoom': 'in', 'aria-label': 'Zoom in', title: 'Zoom in' }, 'fa-magnifying-glass-plus')
    );
    const scroll = document.createElement('div');
    scroll.className = 'tl-scroll';
    const needed = songLengthBars(state.arrangement, state.patterns, state.loopEnd);
    const host = document.getElementById('timeline');
    const fill = host && host.clientWidth ? Math.ceil(host.clientWidth / state.pxPerBar) : 0;
    const bars = Math.max(needed, fill, 4);
    const inner = document.createElement('div');
    inner.className = 'tl-inner';
    inner.style.width = bars * state.pxPerBar + 'px';
    const ruler = document.createElement('div');
    ruler.className = 'tl-ruler';
    for (let bar = 0; bar < bars; bar += 1) {
      for (let six = 0; six < 16; six += 1) {
        const tick = document.createElement('span');
        tick.className = 'tl-tick' + (six === 0 ? ' is-bar' : six % 4 === 0 ? ' is-beat' : ' is-16');
        tick.style.left = (bar + six / 16) * state.pxPerBar + 'px';
        if (six === 0) tick.textContent = String(bar + 1);
        ruler.append(tick);
      }
    }
    const loop = document.createElement('div');
    loop.className = 'tl-loop';
    const loopStart = state.loopStart;
    const loopEnd = loopEndBar();
    loop.style.left = loopStart * state.pxPerBar + 'px';
    loop.style.width = Math.max(1, loopEnd - loopStart) * state.pxPerBar + 'px';
    const hStart = button('tl-handle', { 'data-loop': 'start', 'aria-label': 'Loop start' });
    const hEnd = button('tl-handle', { 'data-loop': 'end', 'aria-label': 'Loop end' });
    loop.append(hStart, hEnd);
    ruler.append(loop);
    const lane = document.createElement('div');
    lane.className = 'tl-lane';
    state.arrangement.forEach((clip, index) => {
      const pattern = state.patterns.find(item => item.id === clip.patternId);
      if (!pattern) return;
      const node = document.createElement('div');
      node.className = 'tl-clip' + (clip.patternId === state.patternId ? ' is-selected' : '');
      node.dataset.clip = String(index);
      node.style.left = clip.startBar * state.pxPerBar + 'px';
      node.style.width = clipBars(clip, state.patterns) * state.pxPerBar + 'px';
      node.style.background = patternColor(clip.patternId);
      node.textContent = pattern.name + (clip.repeats > 1 ? ' ×' + clip.repeats : '');
      const edge = document.createElement('span');
      edge.className = 'tl-clip-end';
      edge.dataset.clipEnd = String(index);
      node.append(edge);
      lane.append(node);
    });
    const play = document.createElement('div');
    play.className = 'tl-playhead';
    play.hidden = true;
    inner.append(ruler, lane, play);
    scroll.append(inner);
    root.replaceChildren(tools, scroll);
    paintPlayhead();
  }

  function clearCurrentPattern() {
    const pattern = currentPattern();
    pattern.drums = emptyDrums(pattern.bars);
    Object.keys(pattern.notes).forEach(id => { pattern.notes[id] = []; });
    save();
    const tab = document.querySelector('[data-view].is-selected');
    showView(tab ? tab.dataset.view : 'drums');
  }

  function handleBarMeter(event) {
    if (event.target.closest('[data-clear-pattern]')) {
      clearCurrentPattern();
      return true;
    }
    if (event.target.closest('[data-pattern-grow]')) {
      resizeCurrentPattern(currentPattern().bars * 2);
      return true;
    }
    if (event.target.closest('[data-pattern-half]')) {
      resizeCurrentPattern(currentPattern().bars / 2);
      return true;
    }
    const page = event.target.closest('[data-page]');
    if (page) {
      if (page.disabled) return true;
      patternPage += Number(page.dataset.page);
      viewBars();
      const tab = document.querySelector('[data-view].is-selected');
      showView(tab ? tab.dataset.view : 'drums');
      return true;
    }
    const slot = event.target.closest('[data-bar-page]');
    if (slot) {
      patternPage = Number(slot.dataset.barPage);
      viewBars();
      const tab = document.querySelector('[data-view].is-selected');
      showView(tab ? tab.dataset.view : 'drums');
      return true;
    }
    return false;
  }

  function renderBarMeter() {
    const wrap = document.createElement('div');
    wrap.className = 'bar-meter';
    const pattern = currentPattern();
    const pages = pageCount();
    const prev = iconButton('icon-button', { 'data-page': '-1', 'aria-label': 'Previous bars', title: 'Previous bars' }, 'fa-chevron-left');
    prev.disabled = pages < 2 || patternPage <= 0;
    const slots = document.createElement('div');
    slots.className = 'bar-slots';
    slots.setAttribute('aria-label', pattern.bars + (pattern.bars === 1 ? ' bar' : ' bars'));
    for (let i = 0; i < pattern.bars; i += 1) {
      const page = Math.floor(i / PAGE_BARS);
      slots.append(button(
        'bar-slot' + (page === patternPage ? ' is-on' : ''),
        { 'data-bar-page': String(page), 'aria-label': 'Bar ' + (i + 1), 'aria-current': page === patternPage ? 'true' : 'false' },
        String(i + 1)
      ));
    }
    const next = iconButton('icon-button', { 'data-page': '1', 'aria-label': 'Next bars', title: 'Next bars' }, 'fa-chevron-right');
    next.disabled = pages < 2 || patternPage >= pages - 1;
    const len = document.createElement('span');
    len.className = 'bar-len';
    len.textContent = pattern.bars + (pattern.bars === 1 ? ' bar' : ' bars');
    const grow = iconButton('icon-button', { 'data-pattern-grow': '1', 'aria-label': 'Double length', title: 'Double length' }, 'fa-expand');
    grow.disabled = pattern.bars >= 8;
    const half = iconButton('icon-button', { 'data-pattern-half': '1', 'aria-label': 'Halve length', title: 'Halve length' }, 'fa-compress');
    half.disabled = pattern.bars <= 1;
    const main = document.createElement('div');
    main.className = 'bar-meter-main';
    main.append(prev, slots, next, len, grow, half);
    const clear = iconButton('icon-button', { 'data-clear-pattern': '1', 'aria-label': 'Clear pattern', title: 'Clear pattern' }, 'fa-eraser');
    wrap.append(main, clear);
    return wrap;
  }

  function renderDrums() {
    const root = document.getElementById('view-drums');
    const drums = document.createElement('div');
    drums.className = 'drums';
    const rack = document.createElement('div');
    rack.className = 'pad-rack';
    const grid = document.createElement('div');
    grid.className = 'step-grid';
    const view = viewBars();
    PADS.forEach(pad => {
      const padButton = button('pad', { 'data-audition': pad.id }, pad.name);
      padButton.style.setProperty('--pad', pad.color);
      padButton.style.setProperty('--on-ink', pad.ink);
      rack.append(padButton);
      const row = document.createElement('div');
      row.className = 'step-row';
      row.style.gridTemplateColumns = '5.6rem repeat(' + (view.count * STEPS) + ', minmax(1.05rem, 1fr))';
      const label = document.createElement('span');
      label.className = 'step-label';
      label.textContent = pad.name;
      label.style.color = pad.color;
      row.append(label);
      const step0 = view.start * STEPS;
      for (let i = 0; i < view.count * STEPS; i += 1) {
        const step = step0 + i;
        const on = currentPattern().drums[pad.id][step];
        const cell = button(
          'step' + (on ? ' is-on' : '') + (step % STEPS === 0 ? ' is-bar' : '') + (step % 4 === 0 ? ' is-beat' : ''),
          {
          'data-pad': pad.id,
          'data-step': String(step * 2),
          'data-span': '2',
          'aria-pressed': on ? 'true' : 'false',
          'aria-label': pad.name + ' bar ' + (Math.floor(step / STEPS) + 1) + ' step ' + (step % STEPS + 1)
        });
        cell.style.setProperty('--pad', pad.color);
        row.append(cell);
      }
      grid.append(row);
    });
    drums.append(rack, grid);
    root.replaceChildren(renderBarMeter(), drums);
    paintPlayhead();
  }

  function paintCell(cell, notes, span) {
    const start = Number(cell.dataset.step);
    const note = noteAt(notes, start, Number(cell.dataset.pitch), span);
    const on = !!note;
    cell.classList.toggle('is-on', on);
    cell.classList.toggle('is-head', on && start <= note.step);
    cell.classList.toggle('is-tail', on && start + span >= note.step + note.length);
    cell.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function paintRoll(track) {
    const span = gridSpan();
    document.querySelectorAll('#piano-roll .cell').forEach(cell => paintCell(cell, trackNotes(track), span));
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
    const x2 = button('text-button', {
      'data-grid': '1',
      'aria-pressed': state.grid === 32 ? 'true' : 'false',
      'aria-label': '32-step grid'
    }, 'x2');
    const keyLock = document.createElement('label');
    keyLock.className = 'lock-label';
    keyLock.textContent = 'Key';
    const keySel = document.createElement('select');
    keySel.className = 'lock-select';
    keySel.dataset.lock = 'root';
    keySel.setAttribute('aria-label', 'Root');
    NOTE_NAMES.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = name;
      keySel.append(opt);
    });
    keySel.value = String(state.root);
    keyLock.append(keySel);
    const modeLock = document.createElement('label');
    modeLock.className = 'lock-label';
    modeLock.textContent = 'Scale';
    const modeSel = document.createElement('select');
    modeSel.className = 'lock-select';
    modeSel.dataset.lock = 'mode';
    modeSel.setAttribute('aria-label', 'Scale');
    [['chromatic', 'Chromatic'], ['major', 'Major'], ['minor', 'Minor']].forEach(row => {
      const opt = document.createElement('option');
      opt.value = row[0];
      opt.textContent = row[1];
      modeSel.append(opt);
    });
    modeSel.value = state.mode;
    modeLock.append(modeSel);
    bar.append(chips, remove, x2, keyLock, modeLock);

    const wrap = document.createElement('div');
    wrap.className = 'roll-wrap';
    const track = selectedTrack();
    const span = gridSpan();
    if (!track) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = 'Add a Fart or Queef, then paint notes on the roll.';
      wrap.append(empty);
    } else {
      const roll = document.createElement('div');
      roll.className = 'roll';
      roll.id = 'piano-roll';
      roll.style.setProperty('--cols', String(state.grid * viewBars().count));
      const color = trackColor(track.type);
      const notes = trackNotes(track);
      const view = viewBars();
      const tick0 = view.start * TICKS;
      const ticksMax = tick0 + view.count * TICKS;
      for (let midi = NOTE_HI; midi >= NOTE_LO; midi -= 1) {
        if (!inScale(midi, state.root, state.mode)) continue;
        const name = button('note-name' + (isBlack(midi) ? ' is-black' : ''), { 'data-key': String(midi) }, noteName(midi));
        roll.append(name);
        for (let tick = tick0; tick < ticksMax; tick += span) {
          const cell = button(
            'cell' + (isBlack(midi) ? ' is-black' : '') + (tick % TICKS === 0 ? ' is-bar' : '') + (tick % 8 === 0 ? ' is-beat' : ''),
            {
              'data-step': String(tick),
              'data-span': String(span),
              'data-pitch': String(midi),
              'aria-label': noteName(midi) + ' step ' + (tick / span + 1)
            }
          );
          cell.style.setProperty('--pad', color);
          paintCell(cell, notes, span);
          roll.append(cell);
        }
      }
      wrap.append(roll);
    }

    const keys = document.createElement('div');
    keys.className = 'keys';
    keys.setAttribute('aria-label', 'Audition keyboard');
    for (let midi = 60; midi <= 71; midi += 1) {
      if (!inScale(midi, state.root, state.mode)) continue;
      keys.append(button('key' + (isBlack(midi) ? ' is-black' : ''), { 'data-key': String(midi) }, NOTE_NAMES[midi % 12]));
    }
    root.replaceChildren(bar, renderBarMeter(), wrap, keys);
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
    document.querySelector('.mpc').classList.toggle('is-mixer', name === 'mixer');
    if (name !== 'mixer') {
      renderBank();
      renderTimeline();
    }
    syncPlayMode();
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
      name: (type === 'fart' ? 'Fart ' : 'Queef ') + count
    });
    state.patterns.forEach(pattern => { pattern.notes[id] = []; });
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
    state.patterns.forEach(pattern => { delete pattern.notes[track.id]; });
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
    applySeqShare();
    setRecUi();
    showView('drums');

    document.getElementById('play-button').addEventListener('click', () => {
      if (playing) stopTransport();
      else startTransport();
    });
    document.getElementById('rec-button').addEventListener('click', () => {
      if (recording) {
        recording = false;
        setRecUi();
        return;
      }
      armRecord();
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
    const split = document.getElementById('seq-split');
    split.addEventListener('pointerdown', event => {
      if (event.button) return;
      const view = document.querySelector('.mpc-view:not([hidden])');
      const timeline = document.getElementById('timeline');
      const total = view.offsetHeight + timeline.offsetHeight;
      if (!total) return;
      const startY = event.clientY;
      const startH = timeline.offsetHeight;
      try { split.setPointerCapture(event.pointerId); } catch (err) { /* no hardware pointer */ }
      const onMove = ev => {
        state.seqShare = clamp((startH + (startY - ev.clientY)) / total, 0.18, 0.7, state.seqShare);
        applySeqShare();
      };
      const onUp = () => {
        split.removeEventListener('pointermove', onMove);
        split.removeEventListener('pointerup', onUp);
        split.removeEventListener('pointercancel', onUp);
        save();
      };
      split.addEventListener('pointermove', onMove);
      split.addEventListener('pointerup', onUp);
      split.addEventListener('pointercancel', onUp);
    });
    split.addEventListener('keydown', event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      state.seqShare = clamp(state.seqShare + (event.key === 'ArrowUp' ? 0.04 : -0.04), 0.18, 0.7, state.seqShare);
      applySeqShare();
      save();
    });
    document.querySelector('.mode-switch').addEventListener('click', event => {
      const tab = event.target.closest('[data-mode]');
      if (!tab || tab.disabled) return;
      if (tab.dataset.mode === 'song' && !state.arrangement.length) return;
      state.playSong = tab.dataset.mode === 'song';
      syncPlayMode();
      save();
      if (playing) {
        stopTransport();
        startTransport();
      }
    });
    document.getElementById('pattern-bank').addEventListener('click', event => {
      if (event.target.closest('.pattern-name')) return;
      if (event.target.closest('[data-pattern-add]')) { addPattern(); return; }
      if (event.target.closest('[data-pattern-grow]')) { resizeCurrentPattern(currentPattern().bars * 2); return; }
      if (event.target.closest('[data-pattern-half]')) { resizeCurrentPattern(currentPattern().bars / 2); return; }
      if (event.target.closest('[data-pattern-del]')) { deleteCurrentPattern(); return; }
      const chip = event.target.closest('[data-pattern]');
      if (chip) selectPattern(chip.dataset.pattern);
    });
    document.getElementById('pattern-bank').addEventListener('dblclick', event => {
      const chip = event.target.closest('[data-pattern]');
      if (chip) startRename(chip.dataset.pattern);
    });

    const timeline = document.getElementById('timeline');
    function barAt(clientX) {
      const inner = timeline.querySelector('.tl-inner');
      if (!inner) return 0;
      return Math.max(0, Math.floor((clientX - inner.getBoundingClientRect().left) / state.pxPerBar));
    }
    timeline.addEventListener('click', event => {
      const zoom = event.target.closest('[data-zoom]');
      if (!zoom) return;
      state.pxPerBar = clamp(state.pxPerBar + (zoom.dataset.zoom === 'in' ? 12 : -12), 16, 160, state.pxPerBar);
      save();
      renderTimeline();
    });
    timeline.addEventListener('wheel', event => {
      if (!event.target.closest('.tl-scroll')) return;
      event.preventDefault();
      state.pxPerBar = clamp(state.pxPerBar + (event.deltaY < 0 ? 8 : -8), 16, 160, state.pxPerBar);
      save();
      renderTimeline();
    }, { passive: false });
    timeline.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-loop]');
      if (handle) {
        tlDrag = { kind: handle.dataset.loop === 'start' ? 'loopStart' : 'loopEnd', pointerId: event.pointerId };
        timeline.setPointerCapture(event.pointerId);
        return;
      }
      const edge = event.target.closest('[data-clip-end]');
      if (edge) {
        const index = Number(edge.dataset.clipEnd);
        tlDrag = { kind: 'repeat', index, pointerId: event.pointerId };
        timeline.setPointerCapture(event.pointerId);
        return;
      }
      const clip = event.target.closest('[data-clip]');
      if (clip) {
        const index = Number(clip.dataset.clip);
        tlDrag = {
          kind: 'move',
          index,
          pointerId: event.pointerId,
          originBar: state.arrangement[index].startBar,
          grabBar: barAt(event.clientX),
          moved: false
        };
        timeline.setPointerCapture(event.pointerId);
        return;
      }
      if (!event.target.closest('.tl-lane')) return;
      const startBar = barAt(event.clientX);
      const pattern = currentPattern();
      if (!clipFits(state.arrangement, -1, startBar, pattern.bars, state.patterns)) return;
      state.arrangement.push({ patternId: pattern.id, startBar, repeats: 1 });
      state.arrangement.sort((a, b) => a.startBar - b.startBar);
      save();
      syncPlayMode();
      renderTimeline();
    });
    timeline.addEventListener('pointermove', event => {
      if (!tlDrag || event.pointerId !== tlDrag.pointerId) return;
      const bar = barAt(event.clientX);
      if (tlDrag.kind === 'loopStart') {
        state.loopStart = Math.max(0, Math.min(bar, loopEndBar() - 1));
        renderTimeline();
        return;
      }
      if (tlDrag.kind === 'loopEnd') {
        state.loopEnd = Math.max(state.loopStart + 1, bar + 1);
        renderTimeline();
        return;
      }
      if (tlDrag.kind === 'move') {
        const clip = state.arrangement[tlDrag.index];
        const span = clipBars(clip, state.patterns);
        const next = Math.max(0, tlDrag.originBar + (bar - tlDrag.grabBar));
        if (next === clip.startBar) return;
        if (!clipFits(state.arrangement, tlDrag.index, next, span, state.patterns)) return;
        clip.startBar = next;
        tlDrag.moved = true;
        renderTimeline();
        return;
      }
      if (tlDrag.kind === 'repeat') {
        const clip = state.arrangement[tlDrag.index];
        const pattern = state.patterns.find(item => item.id === clip.patternId);
        if (!pattern) return;
        const repeats = Math.max(1, Math.ceil((bar + 1 - clip.startBar) / pattern.bars));
        if (repeats === clip.repeats) return;
        if (!clipFits(state.arrangement, tlDrag.index, clip.startBar, pattern.bars * repeats, state.patterns)) return;
        clip.repeats = repeats;
        renderTimeline();
      }
    });
    const endTl = event => {
      if (!tlDrag || (event && event.pointerId !== tlDrag.pointerId)) return;
      const drag = tlDrag;
      tlDrag = null;
      if (drag.kind === 'move' && !drag.moved) {
        selectPattern(state.arrangement[drag.index].patternId);
        return;
      }
      save();
      syncPlayMode();
      renderTimeline();
    };
    timeline.addEventListener('pointerup', endTl);
    timeline.addEventListener('pointercancel', endTl);

    const drumsView = document.getElementById('view-drums');
    drumsView.addEventListener('pointerdown', event => {
      const pad = event.target.closest('[data-audition]');
      if (!pad || event.button) return;
      event.preventDefault();
      if (padPointers.has(event.pointerId)) return;
      padPointers.set(event.pointerId, { kind: 'pad', el: pad });
      pad.classList.add('is-down');
      hitPad(pad.dataset.audition);
    });
    drumsView.addEventListener('pointerup', event => endLivePointer(event.pointerId));
    drumsView.addEventListener('pointercancel', event => endLivePointer(event.pointerId));
    drumsView.addEventListener('click', event => {
      if (handleBarMeter(event)) return;
      const audition = event.target.closest('[data-audition]');
      if (audition) {
        if (event.detail) return;
        hitPad(audition.dataset.audition);
        return;
      }
      const cell = event.target.closest('[data-pad]');
      if (!cell) return;
      const pad = cell.dataset.pad;
      const step = Number(cell.dataset.step) >> 1;
      const row = currentPattern().drums[pad];
      row[step] = !row[step];
      cell.classList.toggle('is-on', row[step]);
      cell.setAttribute('aria-pressed', row[step] ? 'true' : 'false');
      save();
    });

    const pianoView = document.getElementById('view-piano');
    pianoView.addEventListener('click', event => {
      if (handleBarMeter(event)) return;
      const liveKey = event.target.closest('[data-key]');
      if (liveKey) return;
      const add = event.target.closest('[data-add]');
      if (add) { addTrack(add.dataset.add); return; }
      const select = event.target.closest('[data-select]');
      if (select) {
        state.selectedTrack = select.dataset.select;
        save();
        renderPiano();
        return;
      }
      if (event.target.closest('[data-remove]')) { removeSelected(); return; }
      if (event.target.closest('[data-grid]')) {
        state.grid = state.grid === 32 ? 16 : 32;
        save();
        renderPiano();
      }
    });
    pianoView.addEventListener('change', event => {
      const sel = event.target.closest('[data-lock]');
      if (!sel) return;
      if (sel.dataset.lock === 'root') state.root = clamp(sel.value, 0, 11, state.root) | 0;
      if (sel.dataset.lock === 'mode') {
        state.mode = sel.value === 'major' || sel.value === 'minor' ? sel.value : 'chromatic';
      }
      save();
      renderPiano();
    });
    pianoView.addEventListener('pointerdown', event => {
      const key = event.target.closest('[data-key]');
      if (key) {
        if (event.button) return;
        event.preventDefault();
        beginKeyHold(event.pointerId, key, Number(key.dataset.key));
        try { key.setPointerCapture(event.pointerId); } catch (err) { /* no hardware pointer */ }
        return;
      }
      const cell = event.target.closest('.cell');
      if (!cell) return;
      const track = selectedTrack();
      if (!track) return;
      const step = Number(cell.dataset.step);
      const span = Number(cell.dataset.span || gridSpan());
      const pitch = Number(cell.dataset.pitch);
      const hit = noteAt(trackNotes(track), step, pitch, span);
      if (hit) {
        drag = { pitch, origin: hit.step, length: hit.length, pointerId: event.pointerId, erase: true };
        pianoView.setPointerCapture(event.pointerId);
        return;
      }
      drag = { pitch, origin: step, length: span, pointerId: event.pointerId, erase: false };
      currentPattern().notes[track.id] = placeNote(trackNotes(track), step, pitch, span, patternTicks());
      paintRoll(track);
      audition(pitch);
      pianoView.setPointerCapture(event.pointerId);
    });
    pianoView.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const cell = el && el.closest ? el.closest('.cell') : null;
      if (!cell) return;
      const pitch = Number(cell.dataset.pitch);
      const step = Number(cell.dataset.step);
      const span = Number(cell.dataset.span || gridSpan());
      if (pitch !== drag.pitch || step < drag.origin) return;
      const length = step - drag.origin + span;
      if (length === drag.length) return;
      drag.length = length;
      drag.erase = false;
      const track = selectedTrack();
      currentPattern().notes[track.id] = placeNote(trackNotes(track), drag.origin, pitch, length, patternTicks());
      paintRoll(track);
    });
    const endDrag = event => {
      if (!drag || (event && event.pointerId !== drag.pointerId)) return;
      if (drag.erase) {
        const track = selectedTrack();
        if (track) {
          currentPattern().notes[track.id] = removeNoteAt(trackNotes(track), drag.origin, drag.pitch);
          paintRoll(track);
        }
      }
      drag = null;
      save();
    };
    pianoView.addEventListener('pointerup', event => {
      endLivePointer(event.pointerId);
      endDrag(event);
    });
    pianoView.addEventListener('pointercancel', event => {
      endLivePointer(event.pointerId);
      endDrag(event);
    });
    pianoView.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const key = event.target.closest('[data-key]');
      if (key) {
        if (event.repeat) return;
        event.preventDefault();
        beginKeyHold('kbd-' + key.dataset.key, key, Number(key.dataset.key));
        return;
      }
      const cell = event.target.closest('.cell');
      if (!cell) return;
      event.preventDefault();
      const track = selectedTrack();
      if (!track) return;
      const step = Number(cell.dataset.step);
      const span = Number(cell.dataset.span || gridSpan());
      const pitch = Number(cell.dataset.pitch);
      if (noteAt(trackNotes(track), step, pitch, span)) {
        currentPattern().notes[track.id] = removeNoteAt(trackNotes(track), step, pitch, span);
      } else {
        currentPattern().notes[track.id] = placeNote(trackNotes(track), step, pitch, span, patternTicks());
        audition(pitch);
      }
      save();
      paintRoll(track);
    });
    pianoView.addEventListener('keyup', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const key = event.target.closest('[data-key]');
      if (!key) return;
      event.preventDefault();
      endLivePointer('kbd-' + key.dataset.key);
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
      const knob = event.target.closest('.knob');
      if (!knob) return;
      event.preventDefault();
      const spec = MIX_PARAMS.find(row => row[0] === input.dataset.param);
      if (!spec) return;
      const min = spec[2];
      const max = spec[3];
      const step = spec[4];
      const startY = event.clientY;
      const startVal = Number(input.value);
      const onMove = ev => {
        const next = startVal + ((ev.clientY - startY) / 120) * (max - min);
        const snapped = Math.round(next / step) * step;
        input.value = String(clamp(snapped, min, max, startVal));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const onUp = () => {
        knob.removeEventListener('pointermove', onMove);
        knob.removeEventListener('pointerup', onUp);
        knob.removeEventListener('pointercancel', onUp);
      };
      knob.addEventListener('pointermove', onMove);
      knob.addEventListener('pointerup', onUp);
      knob.addEventListener('pointercancel', onUp);
      try { knob.setPointerCapture(event.pointerId); } catch (err) { /* no hardware pointer */ }
    });
  }

  init();
})();
