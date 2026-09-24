import {
  STEPS, TICKS, NOTE_LO, NOTE_HI, MAJOR, MINOR, PADS, INSTRUMENTS, MIX_PARAMS, NOTE_NAMES,
  LPF_OPEN, LPF_MIN, HPF_OPEN, HPF_MAX, SONG_VERSION, SONG_NAME_MAX,
  POOP_LEFT, POOP_RIGHT, DEFAULT_SONG
} from './const.js';

export function stepSeconds(bpm) {
  return 60 / bpm / 4;
}

export function tickSeconds(bpm) {
  return 60 / bpm / 8;
}

export function inScale(midi, root, mode) {
  if (mode === 'chromatic') return true;
  const pc = ((midi % 12) - root + 12) % 12;
  return (mode === 'minor' ? MINOR : MAJOR).includes(pc);
}

export function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

export function isBlack(midi) {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

export function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function defaultMix() {
  return { gain: 0, high: 0, mid: 0, low: 0, filter: 0, pan: 0, level: 0.8, mute: false, solo: false };
}

export function defaultVoice() {
  return { legato: 0, slide: 0, noise: 0.35, rumble: 0.32 };
}

export function cleanVoice(raw) {
  const voice = defaultVoice();
  if (!raw) return voice;
  voice.legato = raw.legato ? 1 : 0;
  voice.slide = clamp(raw.slide, 0, 1, voice.slide);
  voice.noise = clamp(raw.noise, 0, 1, voice.noise);
  voice.rumble = clamp(raw.rumble, 0, 1, voice.rumble);
  return voice;
}

export function gainAmp(amount) {
  const x = clamp(amount, -1, 1, 0);
  if (x >= 0) return 10 ** x;
  return 1 + x;
}

export function cleanGain(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n === 0.85) return 0;
  return clamp(n, -1, 1, 0);
}

export function filterFreqs(amount) {
  const x = clamp(amount, -1, 1, 0);
  if (x <= 0) {
    return { lpf: LPF_OPEN * Math.pow(LPF_MIN / LPF_OPEN, -x), hpf: HPF_OPEN };
  }
  return { lpf: LPF_OPEN, hpf: HPF_OPEN * Math.pow(HPF_MAX / HPF_OPEN, x) };
}

export function cleanFilter(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n > 1) {
    const hz = Math.min(LPF_OPEN, Math.max(LPF_MIN, n));
    if (hz >= LPF_OPEN - 1) return 0;
    return -(Math.log(hz / LPF_OPEN) / Math.log(LPF_MIN / LPF_OPEN));
  }
  return clamp(n, -1, 1, 0);
}

export function knobAngle(value, min, max) {
  return (value / Math.max(Math.abs(min), Math.abs(max))) * 135;
}

export function mixTip(param, n) {
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
export function cleanMix(raw) {
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

export function anyChannelSolo(mixMap) {
  return Object.keys(mixMap).some(id => id !== 'master' && mixMap[id] && mixMap[id].solo);
}

export function stripAudible(id, mixMap) {
  const mix = mixMap[id];
  if (!mix || mix.mute) return false;
  if (id === 'master') return true;
  return !anyChannelSolo(mixMap) || !!mix.solo;
}

export function noteAt(notes, step, pitch, span) {
  const width = span || 1;
  return notes.find(note => note.pitch === pitch && note.step < step + width && step < note.step + note.length) || null;
}

export function placeNote(notes, step, pitch, length, ticksMax) {
  const cap = ticksMax || TICKS;
  const len = Math.max(1, Math.min(length, cap - step));
  const end = step + len;
  const next = notes.filter(note => note.pitch !== pitch || note.step + note.length <= step || note.step >= end);
  next.push({ step, pitch, length: len });
  return next;
}

export function removeNoteAt(notes, step, pitch, span) {
  const hit = noteAt(notes, step, pitch, span);
  if (!hit) return notes;
  return notes.filter(note => note !== hit);
}

export function moveNote(notes, fromStep, fromPitch, toStep, toPitch, ticksMax) {
  const hit = noteAt(notes, fromStep, fromPitch);
  if (!hit) return notes;
  return placeNote(notes.filter(note => note !== hit), toStep, toPitch, hit.length, ticksMax);
}

export function validNote(note, ticksMax) {
  const cap = ticksMax || TICKS;
  return !!note
    && Number.isInteger(note.step) && note.step >= 0 && note.step < cap
    && Number.isInteger(note.length) && note.length >= 1 && note.step + note.length <= cap
    && Number.isInteger(note.pitch) && note.pitch >= NOTE_LO && note.pitch <= NOTE_HI;
}

export function asTickNote(note, from16, ticksMax) {
  if (!note) return null;
  const next = {
    step: from16 ? note.step * 2 : note.step,
    length: from16 ? note.length * 2 : note.length,
    pitch: note.pitch
  };
  return validNote(next, ticksMax) ? next : null;
}

export function snapTick(tick, bars, span) {
  const max = bars * TICKS;
  const step = span || 2;
  if (max < 1) return 0;
  const n = Math.round(Math.max(0, tick) / step) * step;
  return ((n % max) + max) % max;
}

export function drumStepFromTick(tick, bars) {
  return snapTick(tick, bars, 2) >> 1;
}

export function heldNoteLength(startTick, playTick, bars, span) {
  const max = bars * TICKS;
  const step = span || 2;
  if (startTick >= max) return step;
  const end = snapTick(playTick, bars, step);
  if (end < startTick) return max - startTick;
  if (end === startTick) return step;
  return Math.min(end - startTick, max - startTick);
}

export function emptyDrums(bars) {
  const drums = {};
  PADS.forEach(pad => { drums[pad.id] = Array(bars * STEPS).fill(false); });
  return drums;
}

export function nextPatternName(patterns) {
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

export function clipBars(clip, patterns) {
  const pattern = patterns.find(item => item.id === clip.patternId);
  return pattern ? pattern.bars * Math.max(1, clip.repeats | 0) : 0;
}

export function songLengthBars(arrangement, patterns, loopEnd) {
  let end = 4;
  arrangement.forEach(clip => { end = Math.max(end, clip.startBar + clipBars(clip, patterns)); });
  if (loopEnd) end = Math.max(end, loopEnd);
  return Math.max(end, 1);
}

export function songHit(songTick, arrangement, patterns) {
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

export function nextSongTick(tick, arrangement, patterns, loopStart, loopEnd) {
  const endBar = loopEnd || songLengthBars(arrangement, patterns, loopEnd);
  const startBar = Math.max(0, Math.min(loopStart, endBar - 1));
  const startTick = startBar * TICKS;
  const endTick = Math.max(startBar + 1, endBar) * TICKS;
  const next = tick + 1;
  return next >= endTick ? startTick : next;
}

export function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

export function clipFits(arrangement, ignore, startBar, bars, patterns) {
  if (startBar < 0 || bars < 1) return false;
  return arrangement.every((clip, i) => {
    if (i === ignore) return true;
    return !rangesOverlap(startBar, startBar + bars, clip.startBar, clip.startBar + clipBars(clip, patterns));
  });
}

export function resizePattern(pattern, bars) {
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

export function loadPattern(raw, from16, trackIds) {
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

export function freshState() {
  const mix = { master: defaultMix() };
  PADS.forEach(pad => { mix[pad.id] = defaultMix(); });
  const pattern = { id: 'p1', name: 'PATTERN', bars: 1, drums: emptyDrums(1), notes: {} };
  return {
    kit: '808', bpm: 140, tracks: [], mix, nextId: 1, selectedTrack: null,
    grid: 16, root: 5, mode: 'major', ticks: TICKS,
    patterns: [pattern], patternId: 'p1', nextPattern: 2,
    arrangement: [], loopStart: 0, loopEnd: 0, playSong: false, pxPerBar: 48, seqShare: 0.33, sideShare: 0.28,
    songName: ''
  };
}

export function cleanSongName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, SONG_NAME_MAX);
}

export function poopSongName() {
  const left = POOP_LEFT[Math.floor(Math.random() * POOP_LEFT.length)];
  const right = POOP_RIGHT[Math.floor(Math.random() * POOP_RIGHT.length)];
  return left + ' ' + right;
}

export function encodePayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePayload(encoded) {
  try {
    const normalized = String(encoded).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || payload.v !== SONG_VERSION) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

export function parseSongText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    const payload = JSON.parse(trimmed);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  } catch (err) { /* old SongID blob */ }
  return decodePayload(trimmed);
}

export function hydrateFromRaw(raw) {
  const state = freshState();
  if (!raw || typeof raw !== 'object') return state;
  try {
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
        if (!track || !INSTRUMENTS.some(item => item.id === track.type) || typeof track.id !== 'string') return;
        state.tracks.push({
          id: track.id,
          type: track.type,
          name: String(track.name || track.type).slice(0, 32),
          voice: cleanVoice(track.voice)
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
    state.sideShare = clamp(raw.sideShare, 0.12, 1, 0.28);
    state.nextId = Math.max(1, Number(raw.nextId) || 1);
    state.selectedTrack = state.tracks.some(track => track.id === raw.selectedTrack)
      ? raw.selectedTrack
      : (state.tracks[0] ? state.tracks[0].id : null);
    state.songName = cleanSongName(raw.songName);
  } catch (err) {
    return freshState();
  }
  return state;
}
export function payloadOf(s) {
  return {
    v: SONG_VERSION,
    songName: s.songName,
    kit: s.kit,
    bpm: s.bpm,
    grid: s.grid,
    root: s.root,
    mode: s.mode,
    tracks: s.tracks,
    mix: s.mix,
    patterns: s.patterns,
    arrangement: s.arrangement,
    loopStart: s.loopStart,
    loopEnd: s.loopEnd,
    nextId: s.nextId,
    nextPattern: s.nextPattern,
    patternId: s.patternId
  };
}
export function selfCheck() {
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
  notes = moveNote(placeNote([], 2, 60, 3), 2, 60, 8, 64);
  if (!noteAt(notes, 8, 64) || !noteAt(notes, 10, 64) || noteAt(notes, 2, 60) || notes[0].length !== 3) {
    throw new Error('MPC note move failed');
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
  const voice = defaultVoice();
  if (cleanVoice({ legato: 2, slide: 3, noise: -1, rumble: 0.5 }).legato !== 1) {
    throw new Error('MPC voice legato should coerce to 0/1');
  }
  if (voice.slide !== 0 || voice.noise < 0 || voice.noise > 1) throw new Error('MPC defaultVoice out of range');
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
  const named = poopSongName();
  if (!named || named === cleanSongName('') || named.indexOf(' ') < 0) {
    throw new Error('MPC poop song names should be two words');
  }
  const json = '{"v":1,"songName":"Wet Honk","bpm":120,"kit":"909"}';
  const parsed = parseSongText(json);
  if (!parsed || parsed.songName !== 'Wet Honk' || parsed.bpm !== 120) {
    throw new Error('MPC song JSON parse failed');
  }
  if (parseSongText('not-a-song')) throw new Error('MPC song JSON should reject junk');
  if (hydrateFromRaw({ v: SONG_VERSION, songName: '  Thunderous Poot  ', bpm: 99 }).songName !== 'Thunderous Poot') {
    throw new Error('MPC should keep song names from JSON');
  }
  const encoded = encodePayload({ v: SONG_VERSION, songName: 'Silent Toot', bpm: 90, kit: '808' });
  const fromId = parseSongText(encoded);
  if (!fromId || fromId.songName !== 'Silent Toot') throw new Error('MPC should still read old SongID text');
  if (payloadOf(freshState()).mode !== 'major' || payloadOf(freshState()).root !== 5) {
    throw new Error('MPC blank template should be F major');
  }
  if (DEFAULT_SONG === 'Default') throw new Error('MPC Default option value should be reserved');
}
