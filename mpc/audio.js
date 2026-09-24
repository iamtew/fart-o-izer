import {
  PADS, TOMS, LOOKAHEAD_MS, HORIZON, TICKS, PAGE_BARS, rt, strips, due, padPointers
} from './const.js';
import {
  filterFreqs, gainAmp, stripAudible, songHit, nextSongTick, tickSeconds,
  drumStepFromTick, heldNoteLength, snapTick, placeNote
} from './model.js';
import {
  save, currentPattern, usingSong, selectedTrack, patternTicks, trackNotes, pageCount
} from './persist.js';
import {
  setPlayUi, setRecUi, syncPlayMode, paintRoll,
  currentViewName, renderDrums, renderPiano, renderMixer, renderBank
} from './ui.js';

export function ensureAudio() {
  if (rt.ctx) return rt.ctx.state === 'running' ? Promise.resolve() : rt.ctx.resume();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
  rt.ctx = new AudioContextClass();
  const length = rt.ctx.sampleRate;
  rt.noiseBuffer = rt.ctx.createBuffer(1, length, rt.ctx.sampleRate);
  const data = rt.noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const masterIn = createStrip('master', rt.ctx.destination);
  PADS.forEach(pad => createStrip(pad.id, masterIn));
  rt.state.tracks.forEach(track => createStrip(track.id, masterIn));
  return rt.ctx.state === 'running' ? Promise.resolve() : rt.ctx.resume();
}

export function createStrip(id, destination) {
  const input = rt.ctx.createGain();
  const high = rt.ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 6500;
  const mid = rt.ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1100;
  mid.Q.value = 0.8;
  const low = rt.ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 180;
  const lpf = rt.ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.Q.value = 0.7;
  const hpf = rt.ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.Q.value = 0.7;
  const pan = rt.ctx.createStereoPanner();
  const level = rt.ctx.createGain();
  const analyser = rt.ctx.createAnalyser();
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

export function destroyStrip(id) {
  const strip = strips.get(id);
  if (!strip) return;
  strip.analyser.disconnect();
  strip.level.disconnect();
  strips.delete(id);
}

export function applyMix(id) {
  const strip = strips.get(id);
  const mix = rt.state.mix[id];
  if (!strip || !mix || !rt.ctx) return;
  const t = rt.ctx.currentTime;
  const freqs = filterFreqs(mix.filter);
  strip.input.gain.setTargetAtTime(gainAmp(mix.gain), t, 0.01);
  strip.high.gain.setTargetAtTime(mix.high, t, 0.01);
  strip.mid.gain.setTargetAtTime(mix.mid, t, 0.01);
  strip.low.gain.setTargetAtTime(mix.low, t, 0.01);
  strip.lpf.frequency.setTargetAtTime(freqs.lpf, t, 0.01);
  strip.hpf.frequency.setTargetAtTime(freqs.hpf, t, 0.01);
  strip.pan.pan.setTargetAtTime(mix.pan, t, 0.01);
  strip.level.gain.setTargetAtTime(stripAudible(id, rt.state.mix) ? mix.level : 0, t, 0.01);
}

export function applyAllMix() {
  Object.keys(rt.state.mix).forEach(applyMix);
}

export function decayAmp(peak, decay, when) {
  const gain = rt.ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.003 + decay);
  return gain;
}

export function noteAmp(peak, dur, when) {
  const gain = rt.ctx.createGain();
  const attack = Math.min(0.015, dur * 0.25);
  const release = Math.min(0.08, dur * 0.35);
  const hold = Math.max(attack, dur - release);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + attack);
  gain.gain.setValueAtTime(peak, when + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(hold + 0.01, dur));
  return gain;
}

export function triggerKick(when, dest) {
  const punch = rt.state.kit === '909';
  const decay = punch ? 0.28 : 0.55;
  const osc = rt.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(punch ? 210 : 145, when);
  osc.frequency.exponentialRampToValueAtTime(punch ? 52 : 40, when + (punch ? 0.06 : 0.14));
  const amp = decayAmp(punch ? 0.85 : 0.75, decay, when);
  osc.connect(amp);
  amp.connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.05);
  if (!punch) return;
  const click = rt.ctx.createOscillator();
  click.type = 'square';
  click.frequency.setValueAtTime(1400, when);
  const clickAmp = decayAmp(0.18, 0.018, when);
  const hp = rt.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800;
  click.connect(hp);
  hp.connect(clickAmp);
  clickAmp.connect(dest);
  click.start(when);
  click.stop(when + 0.05);
}

export function triggerSnare(when, dest) {
  const punch = rt.state.kit === '909';
  const tone = rt.ctx.createOscillator();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(punch ? 230 : 175, when);
  tone.frequency.exponentialRampToValueAtTime(punch ? 160 : 120, when + 0.06);
  const toneAmp = decayAmp(punch ? 0.35 : 0.22, punch ? 0.12 : 0.18, when);
  tone.connect(toneAmp);
  toneAmp.connect(dest);
  tone.start(when);
  tone.stop(when + 0.3);
  const noise = rt.ctx.createBufferSource();
  noise.buffer = rt.noiseBuffer;
  const hp = rt.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = punch ? 1800 : 900;
  const bp = rt.ctx.createBiquadFilter();
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

export function triggerClap(when, dest) {
  const punch = rt.state.kit === '909';
  const gaps = punch ? [0, 0.008, 0.016, 0.028] : [0, 0.012, 0.026, 0.046];
  gaps.forEach((offset, index) => {
    const noise = rt.ctx.createBufferSource();
    noise.buffer = rt.noiseBuffer;
    const bp = rt.ctx.createBiquadFilter();
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

export function chokeHats(when) {
  const t = Math.max(when, rt.ctx.currentTime);
  rt.hats.forEach(hat => {
    try {
      hat.amp.gain.cancelScheduledValues(t);
      hat.amp.gain.setValueAtTime(0.0001, t);
    } catch (err) { /* voice already finished */ }
    hat.sources.forEach(source => {
      try { source.stop(t + 0.02); } catch (err) { /* already stopped */ }
    });
  });
  rt.hats = [];
}

export function triggerHat(when, open, dest) {
  chokeHats(when);
  const punch = rt.state.kit === '909';
  const decay = open ? (punch ? 0.32 : 0.48) : (punch ? 0.035 : 0.055);
  const amp = decayAmp(open ? 0.28 : 0.24, decay, when);
  const hp = rt.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = punch ? 7000 : 5500;
  const sources = [];
  if (punch) {
    [3210, 5402].forEach(freq => {
      const osc = rt.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, when);
      const gain = rt.ctx.createGain();
      gain.gain.value = 0.18;
      osc.connect(gain);
      gain.connect(hp);
      osc.start(when);
      osc.stop(when + decay + 0.05);
      sources.push(osc);
    });
  }
  const noise = rt.ctx.createBufferSource();
  noise.buffer = rt.noiseBuffer;
  noise.connect(hp);
  noise.start(when);
  noise.stop(when + decay + 0.05);
  sources.push(noise);
  hp.connect(amp);
  amp.connect(dest);
  rt.hats.push({ amp, sources });
}

export function triggerTom(when, id, dest) {
  const punch = rt.state.kit === '909';
  const base = TOMS[id];
  const decay = punch ? 0.2 : 0.38;
  const osc = rt.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(base * (punch ? 1.5 : 1.35), when);
  osc.frequency.exponentialRampToValueAtTime(base, when + (punch ? 0.05 : 0.1));
  const amp = decayAmp(0.55, decay, when);
  osc.connect(amp);
  amp.connect(dest);
  osc.start(when);
  osc.stop(when + decay + 0.08);
}

export function triggerPad(id, when) {
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

export function triggerFart(when, dur, freq, dest) {
  const osc = rt.ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, when);
  const lfo = rt.ctx.createOscillator();
  const lfoGain = rt.ctx.createGain();
  lfo.frequency.setValueAtTime(5, when);
  lfoGain.gain.setValueAtTime(14, when);
  lfo.connect(lfoGain);
  lfoGain.connect(osc.detune);
  const filter = rt.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(Math.min(2200, Math.max(320, freq * 5)), when);
  filter.Q.value = 3;
  const noise = rt.ctx.createBufferSource();
  noise.buffer = rt.noiseBuffer;
  noise.loop = true;
  const noiseGain = rt.ctx.createGain();
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

export function triggerQueef(when, dur, freq, dest) {
  const body = rt.ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(freq, when);
  const shimmer = rt.ctx.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.setValueAtTime(freq * 2, when);
  const vib = rt.ctx.createOscillator();
  const vibGain = rt.ctx.createGain();
  vib.frequency.setValueAtTime(6, when);
  vibGain.gain.setValueAtTime(8, when);
  vib.connect(vibGain);
  vibGain.connect(body.detune);
  const filter = rt.ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(Math.min(2800, freq * 2.2), when);
  filter.Q.value = 4;
  const bodyGain = rt.ctx.createGain();
  bodyGain.gain.value = 0.85;
  const shimmerGain = rt.ctx.createGain();
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

export function triggerMelodic(type, midi, when, dur, dest) {
  if (!dest) return null;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  if (type === 'queef') return triggerQueef(when, dur, freq, dest);
  return triggerFart(when, dur, freq, dest);
}

export function releaseVoice(voice) {
  if (!voice || !rt.ctx) return;
  const t = rt.ctx.currentTime;
  try {
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), t);
    voice.amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  } catch (err) { /* voice already finished */ }
  voice.sources.forEach(source => {
    try { source.stop(t + 0.1); } catch (err) { /* already stopped */ }
  });
}

export function audition(midi) {
  const track = selectedTrack();
  if (!track) return;
  const type = track.type;
  const id = track.id;
  ensureAudio().then(() => {
    const strip = strips.get(id);
    triggerMelodic(type, midi, rt.ctx.currentTime + 0.01, 0.28, strip && strip.input);
  });
}

export function gridSpan() {
  return TICKS / (rt.state.grid === 32 ? 32 : 16);
}

export function scheduleTick(tick, when) {
  let drums;
  let notesMap;
  let localTick;
  if (usingSong()) {
    const hit = songHit(tick, rt.state.arrangement, rt.state.patterns);
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
  const durTick = tickSeconds(rt.state.bpm);
  rt.state.tracks.forEach(track => {
    const dest = strips.get(track.id);
    if (!dest) return;
    (notesMap[track.id] || []).forEach(note => {
      if (note.step !== localTick) return;
      if (heldLiveNote(track.id, note)) return;
      triggerMelodic(track.type, note.pitch, when, note.length * durTick, dest.input);
    });
  });
}

export function paintPlayhead() {
  let gridHead = rt.playhead;
  if (usingSong()) {
    const hit = songHit(rt.playhead, rt.state.arrangement, rt.state.patterns);
    gridHead = hit && hit.pattern.id === rt.state.patternId ? hit.localTick : -1;
  }
  if (rt.playing && gridHead >= 0 && pageCount() > 1) {
    const want = Math.floor(Math.floor(gridHead / TICKS) / PAGE_BARS);
    if (want !== rt.patternPage) {
      rt.patternPage = want;
      const name = currentViewName();
      if (name === 'drums') renderDrums();
      else if (name === 'piano') renderPiano();
      else if (name === 'mixer') renderMixer();
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
  if (!rt.playing || !usingSong() || rt.playhead < 0) {
    line.hidden = true;
    return;
  }
  line.hidden = false;
  line.style.left = (rt.playhead / TICKS) * rt.state.pxPerBar + 'px';
}

export function scheduler() {
  if (rt.nextTime < rt.ctx.currentTime - 0.2) rt.nextTime = rt.ctx.currentTime + 0.05;
  const horizon = rt.ctx.currentTime + HORIZON;
  while (rt.nextTime < horizon) {
    scheduleTick(rt.stepIndex, rt.nextTime);
    due.push({ step: rt.stepIndex, when: rt.nextTime });
    rt.nextTime += tickSeconds(rt.state.bpm);
    if (usingSong()) {
      rt.stepIndex = nextSongTick(rt.stepIndex, rt.state.arrangement, rt.state.patterns, rt.state.loopStart, rt.state.loopEnd);
    } else {
      rt.stepIndex = (rt.stepIndex + 1) % patternTicks();
    }
  }
  const now = rt.ctx.currentTime + 0.02;
  let head = rt.playhead;
  for (let i = due.length - 1; i >= 0; i -= 1) {
    if (due[i].when <= now) { head = due[i].step; break; }
  }
  if (due.length > 64) due.splice(0, due.length - 32);
  if (head !== rt.playhead) {
    rt.playhead = head;
    stretchHeldKeys();
    paintPlayhead();
  }
}

export function startTransport() {
  if (rt.playing) return;
  rt.playing = true;
  setPlayUi();
  ensureAudio().then(() => {
    if (!rt.playing) return;
    rt.stepIndex = usingSong() ? rt.state.loopStart * TICKS : 0;
    rt.playhead = -1;
    due.length = 0;
    rt.nextTime = rt.ctx.currentTime + 0.06;
    rt.timer = window.setInterval(scheduler, LOOKAHEAD_MS);
  });
}

export function stopTransport() {
  rt.playing = false;
  rt.recording = false;
  window.clearInterval(rt.timer);
  due.length = 0;
  rt.playhead = -1;
  paintPlayhead();
  setPlayUi();
  setRecUi();
}

export function armRecord() {
  if (rt.state.playSong) {
    rt.state.playSong = false;
    syncPlayMode();
    save();
    if (rt.playing) stopTransport();
  }
  rt.recording = true;
  setRecUi();
  if (!rt.playing) startTransport();
}

export function paintDrumStep(id, step, on) {
  document.querySelectorAll('#view-drums [data-pad="' + id + '"][data-step="' + (step * 2) + '"]').forEach(cell => {
    cell.classList.toggle('is-on', on);
    cell.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function recordPad(id) {
  if (!rt.recording || !rt.playing) return;
  const pattern = currentPattern();
  const row = pattern.drums[id];
  if (!row) return;
  const step = drumStepFromTick(rt.playhead < 0 ? 0 : rt.playhead, pattern.bars);
  row[step] = true;
  paintDrumStep(id, step, true);
  save();
}

export function hitPad(id) {
  ensureAudio().then(() => triggerPad(id, rt.ctx.currentTime + 0.01));
  recordPad(id);
}

export function heldLiveNote(trackId, note) {
  for (const hold of padPointers.values()) {
    if (hold.kind === 'key' && hold.recording && hold.trackId === trackId && hold.midi === note.pitch && hold.start === note.step) {
      return true;
    }
  }
  return false;
}

export function writeHeldNote(hold, length) {
  const track = rt.state.tracks.find(item => item.id === hold.trackId);
  if (!track) return;
  hold.length = length;
  currentPattern().notes[track.id] = placeNote(trackNotes(track), hold.start, hold.midi, length, patternTicks());
  paintRoll(track);
}

export function stretchHeldKeys() {
  if (!rt.recording || !rt.playing) return;
  const span = gridSpan();
  const bars = currentPattern().bars;
  const tick = rt.playhead < 0 ? 0 : rt.playhead;
  padPointers.forEach(hold => {
    if (hold.kind !== 'key' || !hold.recording) return;
    const length = heldNoteLength(hold.start, tick, bars, span);
    if (length === hold.length) return;
    writeHeldNote(hold, length);
  });
}

export function beginKeyHold(id, el, midi) {
  if (padPointers.has(id)) return;
  const track = selectedTrack();
  const span = gridSpan();
  const writing = !!(rt.recording && rt.playing && track);
  const start = writing ? snapTick(rt.playhead < 0 ? 0 : rt.playhead, currentPattern().bars, span) : 0;
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
    live.voice = triggerMelodic(track.type, midi, rt.ctx.currentTime, 60, strip && strip.input);
  });
}

export function endLivePointer(id) {
  const hold = padPointers.get(id);
  padPointers.delete(id);
  if (!hold) return;
  if (hold.el) hold.el.classList.remove('is-down');
  if (hold.kind !== 'key') return;
  releaseVoice(hold.voice);
  if (!hold.recording) return;
  const span = gridSpan();
  writeHeldNote(hold, heldNoteLength(hold.start, rt.playhead < 0 ? hold.start : rt.playhead, currentPattern().bars, span));
  save();
}
