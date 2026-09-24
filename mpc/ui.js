import {
  PADS, MIX_PARAMS, STEPS, TICKS, PAGE_BARS, NOTE_LO, NOTE_HI, NOTE_NAMES, rt, strips, meterSamples
} from './const.js';
import {
  clamp, knobAngle, mixTip, defaultMix, noteAt, inScale, isBlack, noteName,
  nextPatternName, emptyDrums, resizePattern, songLengthBars, clipBars, clipFits,
  placeNote, moveNote, removeNoteAt
} from './model.js';
import {
  save, currentPattern, selectedTrack, patternTicks, trackNotes, viewBars, pageCount
} from './persist.js';
import {
  applyMix, applyAllMix, destroyStrip, createStrip, hitPad, beginKeyHold,
  endLivePointer, audition, gridSpan, paintPlayhead
} from './audio.js';

let mixTipTimer = 0;

export function paintKnob(input) {
  const knob = input.closest('.knob');
  if (!knob) return;
  const spec = MIX_PARAMS.find(row => row[0] === input.dataset.param);
  if (!spec) return;
  knob.style.setProperty('--ang', knobAngle(Number(input.value), spec[2], spec[3]) + 'deg');
}

export function showMixTip(input) {
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
export function iconEl(name) {
  const node = document.createElement('i');
  node.className = 'fa-solid ' + name;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

export function setPlayUi() {
  const node = document.getElementById('play-button');
  node.replaceChildren(iconEl(rt.playing ? 'fa-stop' : 'fa-play'));
  node.setAttribute('aria-pressed', rt.playing ? 'true' : 'false');
  node.setAttribute('aria-label', rt.playing ? 'Stop' : 'Play');
}

export function setRecUi() {
  const node = document.getElementById('rec-button');
  node.setAttribute('aria-pressed', rt.recording ? 'true' : 'false');
}

export function syncPlayMode() {
  if (!rt.state.arrangement.length) rt.state.playSong = false;
  document.querySelectorAll('[data-mode]').forEach(tab => {
    const song = tab.dataset.mode === 'song';
    tab.disabled = song && !rt.state.arrangement.length;
    const on = song ? rt.state.playSong : !rt.state.playSong;
    tab.classList.toggle('is-selected', on);
    tab.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function applySeqShare() {
  const share = clamp(rt.state.seqShare, 0.18, 0.7, 0.33);
  const mpc = document.querySelector('.mpc');
  mpc.style.setProperty('--seq-grow', String(share));
  mpc.style.setProperty('--edit-grow', String(1 - share));
  const split = document.getElementById('seq-split');
  split.setAttribute('aria-valuemin', '18');
  split.setAttribute('aria-valuemax', '70');
  split.setAttribute('aria-valuenow', String(Math.round(share * 100)));
}

export function applySeqFold() {
  const mpc = document.querySelector('.mpc');
  mpc.classList.toggle('is-seq-folded', rt.seqFolded);
  const btn = document.getElementById('seq-fold');
  btn.setAttribute('aria-expanded', rt.seqFolded ? 'false' : 'true');
  btn.setAttribute('aria-label', rt.seqFolded ? 'Unfold sequencer' : 'Fold sequencer');
  const icon = btn.querySelector('i');
  if (icon) icon.className = rt.seqFolded ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
}

export function syncKeyScale() {
  const root = document.querySelector('[data-lock="root"]');
  const mode = document.querySelector('[data-lock="mode"]');
  if (root) root.value = String(rt.state.root);
  if (mode) mode.value = rt.state.mode;
}

export function setMainMenuOpen(open) {
  const menu = document.getElementById('main-menu');
  const btn = document.getElementById('main-menu-button');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function patternColor(id) {
  const index = Math.max(0, rt.state.patterns.findIndex(item => item.id === id));
  return PADS[index % PADS.length].color;
}

export function trackColor(type) {
  return type === 'fart' ? '#e39a4a' : '#9dcc7a';
}
export function button(className, attrs, text) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  Object.keys(attrs).forEach(key => node.setAttribute(key, attrs[key]));
  if (text) node.textContent = text;
  return node;
}

export function iconButton(className, attrs, iconName) {
  const node = button(className, attrs);
  node.append(iconEl(iconName));
  return node;
}

export function selectPattern(id, refresh) {
  if (!rt.state.patterns.some(item => item.id === id)) return;
  const same = rt.state.patternId === id;
  rt.state.patternId = id;
  save();
  if (refresh === false) {
    renderBank();
    document.querySelectorAll('.tl-clip').forEach((node, index) => {
      node.classList.toggle('is-selected', rt.state.arrangement[index] && rt.state.arrangement[index].patternId === id);
    });
    return;
  }
  if (same) return;
  rt.patternPage = 0;
  showView(currentViewName());
}

export function addPattern() {
  const id = 'p' + rt.state.nextPattern;
  rt.state.nextPattern += 1;
  const notes = {};
  rt.state.tracks.forEach(track => { notes[track.id] = []; });
  rt.state.patterns.push({
    id,
    name: nextPatternName(rt.state.patterns),
    bars: 1,
    drums: emptyDrums(1),
    notes
  });
  selectPattern(id);
}

export function copyPattern() {
  const id = 'p' + rt.state.nextPattern;
  rt.state.nextPattern += 1;
  const clone = structuredClone(currentPattern());
  clone.id = id;
  clone.name = nextPatternName(rt.state.patterns);
  rt.state.patterns.push(clone);
  selectPattern(id);
}

export function resizeCurrentPattern(bars) {
  const pattern = currentPattern();
  const next = resizePattern(pattern, bars);
  if (next === pattern) return;
  const index = rt.state.patterns.findIndex(item => item.id === pattern.id);
  rt.state.patterns[index] = next;
  save();
  showView(currentViewName());
}

export function deleteCurrentPattern() {
  if (rt.state.patterns.length < 2) return;
  const id = rt.state.patternId;
  rt.state.patterns = rt.state.patterns.filter(item => item.id !== id);
  rt.state.arrangement = rt.state.arrangement.filter(clip => clip.patternId !== id);
  rt.state.patternId = rt.state.patterns[0].id;
  save();
  showView(currentViewName());
}

export function renderBank() {
  const root = document.getElementById('pattern-bank');
  const row = document.createElement('div');
  row.className = 'pattern-row';
  rt.state.patterns.forEach(pattern => {
    const chip = button(
      'chip' + (pattern.id === rt.state.patternId ? ' is-selected' : ''),
      { 'data-pattern': pattern.id, title: pattern.name + ' · ' + pattern.bars + ' bar · double-click to rename' },
      pattern.name
    );
    chip.style.setProperty('--pad', patternColor(pattern.id));
    row.append(chip);
  });
  const copy = iconButton('icon-button', { 'data-pattern-copy': '1', 'aria-label': 'Copy pattern', title: 'Copy pattern' }, 'fa-copy');
  const add = iconButton('icon-button', { 'data-pattern-add': '1', 'aria-label': 'Add pattern', title: 'Add pattern' }, 'fa-plus');
  const mid = document.createElement('div');
  mid.className = 'pattern-mid';
  mid.append(row, copy, add);
  const del = iconButton('icon-button', { 'data-pattern-del': '1', 'aria-label': 'Delete pattern', title: 'Delete pattern' }, 'fa-trash');
  del.disabled = rt.state.patterns.length < 2;
  del.classList.add('pattern-reset');
  root.replaceChildren(mid, del);
}

export function startRename(id) {
  const pattern = rt.state.patterns.find(item => item.id === id);
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

export function loopEndBar() {
  return rt.state.loopEnd || songLengthBars(rt.state.arrangement, rt.state.patterns, rt.state.loopEnd);
}

export function renderTimeline() {
  const root = document.getElementById('timeline');
  const tools = document.createElement('div');
  tools.className = 'tl-tools';
  tools.append(
    iconButton('icon-button', { 'data-zoom': 'out', 'aria-label': 'Zoom out', title: 'Zoom out' }, 'fa-magnifying-glass-minus'),
    iconButton('icon-button', { 'data-zoom': 'in', 'aria-label': 'Zoom in', title: 'Zoom in' }, 'fa-magnifying-glass-plus')
  );
  const scroll = document.createElement('div');
  scroll.className = 'tl-scroll';
  const needed = songLengthBars(rt.state.arrangement, rt.state.patterns, rt.state.loopEnd);
  const host = document.getElementById('timeline');
  const fill = host && host.clientWidth ? Math.ceil(host.clientWidth / rt.state.pxPerBar) : 0;
  const bars = Math.max(needed, fill, 4);
  const inner = document.createElement('div');
  inner.className = 'tl-inner';
  inner.style.width = bars * rt.state.pxPerBar + 'px';
  const ruler = document.createElement('div');
  ruler.className = 'tl-ruler';
  for (let bar = 0; bar < bars; bar += 1) {
    for (let six = 0; six < 16; six += 1) {
      const tick = document.createElement('span');
      tick.className = 'tl-tick' + (six === 0 ? ' is-bar' : six % 4 === 0 ? ' is-beat' : ' is-16');
      tick.style.left = (bar + six / 16) * rt.state.pxPerBar + 'px';
      if (six === 0) tick.textContent = String(bar + 1);
      ruler.append(tick);
    }
  }
  const loop = document.createElement('div');
  loop.className = 'tl-loop';
  const loopStart = rt.state.loopStart;
  const loopEnd = loopEndBar();
  loop.style.left = loopStart * rt.state.pxPerBar + 'px';
  loop.style.width = Math.max(1, loopEnd - loopStart) * rt.state.pxPerBar + 'px';
  const hStart = button('tl-handle', { 'data-loop': 'start', 'aria-label': 'Loop start' });
  const hEnd = button('tl-handle', { 'data-loop': 'end', 'aria-label': 'Loop end' });
  loop.append(hStart, hEnd);
  ruler.append(loop);
  const lane = document.createElement('div');
  lane.className = 'tl-lane';
  rt.state.arrangement.forEach((clip, index) => {
    const pattern = rt.state.patterns.find(item => item.id === clip.patternId);
    if (!pattern) return;
    const node = document.createElement('div');
    node.className = 'tl-clip' + (clip.patternId === rt.state.patternId ? ' is-selected' : '');
    node.dataset.clip = String(index);
    node.style.left = clip.startBar * rt.state.pxPerBar + 'px';
    node.style.width = clipBars(clip, rt.state.patterns) * rt.state.pxPerBar + 'px';
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

export function clearCurrentPattern() {
  const pattern = currentPattern();
  pattern.drums = emptyDrums(pattern.bars);
  Object.keys(pattern.notes).forEach(id => { pattern.notes[id] = []; });
  save();
  showView(currentViewName());
}

export function handleBarMeter(event) {
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
    rt.patternPage += Number(page.dataset.page);
    viewBars();
    showView(currentViewName());
    return true;
  }
  const slot = event.target.closest('[data-bar-page]');
  if (slot) {
    rt.patternPage = Number(slot.dataset.barPage);
    viewBars();
    showView(currentViewName());
    return true;
  }
  const viewBtn = event.target.closest('button[data-view]');
  if (viewBtn) {
    showView(viewBtn.dataset.view);
    return true;
  }
  return false;
}

export function currentViewName() {
  const panel = document.querySelector('.mpc-view:not([hidden])');
  return (panel && panel.dataset.viewPanel) || 'drums';
}

export function renderBarMeter(view) {
  const wrap = document.createElement('div');
  wrap.className = 'bar-meter';
  const views = document.createElement('div');
  views.className = 'bar-meter-views';
  const kit = document.createElement('select');
  kit.className = 'kit-view' + (view === 'drums' ? ' is-selected' : '');
  kit.dataset.view = 'drums';
  kit.setAttribute('aria-label', 'Drum kit');
  ['808', '909'].forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    kit.append(opt);
  });
  kit.value = rt.state.kit;
  const piano = button('text-button' + (view === 'piano' ? ' is-selected' : ''), {
    'data-view': 'piano',
    role: 'tab',
    'aria-selected': view === 'piano' ? 'true' : 'false'
  }, 'Piano');
  views.append(kit, piano);
  const pattern = currentPattern();
  const pages = pageCount();
  const prev = iconButton('icon-button', { 'data-page': '-1', 'aria-label': 'Previous bars', title: 'Previous bars' }, 'fa-chevron-left');
  prev.disabled = pages < 2 || rt.patternPage <= 0;
  const slots = document.createElement('div');
  slots.className = 'bar-slots';
  slots.setAttribute('aria-label', pattern.bars + (pattern.bars === 1 ? ' bar' : ' bars'));
  for (let i = 0; i < pattern.bars; i += 1) {
    const page = Math.floor(i / PAGE_BARS);
    slots.append(button(
      'bar-slot' + (page === rt.patternPage ? ' is-on' : ''),
      { 'data-bar-page': String(page), 'aria-label': 'Bar ' + (i + 1), 'aria-current': page === rt.patternPage ? 'true' : 'false' },
      String(i + 1)
    ));
  }
  const next = iconButton('icon-button', { 'data-page': '1', 'aria-label': 'Next bars', title: 'Next bars' }, 'fa-chevron-right');
  next.disabled = pages < 2 || rt.patternPage >= pages - 1;
  const len = document.createElement('span');
  len.className = 'bar-len';
  len.textContent = pattern.bars + (pattern.bars === 1 ? ' bar' : ' bars');
  const grow = iconButton('icon-button', { 'data-pattern-grow': '1', 'aria-label': 'Double length', title: 'Double length' }, 'fa-plus');
  grow.disabled = pattern.bars >= 8;
  const half = iconButton('icon-button', { 'data-pattern-half': '1', 'aria-label': 'Halve length', title: 'Halve length' }, 'fa-minus');
  half.disabled = pattern.bars <= 1;
  const main = document.createElement('div');
  main.className = 'bar-meter-main';
  main.append(prev, slots, next, len, half, grow);
  const clear = iconButton('icon-button', { 'data-clear-pattern': '1', 'aria-label': 'Clear pattern', title: 'Clear pattern' }, 'fa-eraser');
  const end = document.createElement('div');
  end.className = 'bar-meter-end';
  if (view === 'piano') {
    end.append(button('text-button', {
      'data-grid': '1',
      'aria-pressed': rt.state.grid === 32 ? 'true' : 'false',
      'aria-label': '32-step grid'
    }, 'x2'));
  }
  end.append(clear);
  wrap.append(views, main, end);
  return wrap;
}

export function renderDrums() {
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
  root.replaceChildren(renderBarMeter('drums'), drums);
  paintPlayhead();
}

export function paintCell(cell, notes, span) {
  const start = Number(cell.dataset.step);
  const note = noteAt(notes, start, Number(cell.dataset.pitch), span);
  const on = !!note;
  cell.classList.toggle('is-on', on);
  cell.classList.toggle('is-head', on && start <= note.step);
  cell.classList.toggle('is-tail', on && start + span >= note.step + note.length);
  cell.setAttribute('aria-pressed', on ? 'true' : 'false');
}

export function paintRoll(track) {
  const span = gridSpan();
  document.querySelectorAll('#piano-roll .cell').forEach(cell => paintCell(cell, trackNotes(track), span));
}

export function renderPiano() {
  const root = document.getElementById('view-piano');
  const bar = document.createElement('div');
  bar.className = 'piano-bar';
  bar.append(button('text-button', { 'data-add': 'fart' }, 'Add Fart'), button('text-button', { 'data-add': 'queef' }, 'Add Queef'));
  const chips = document.createElement('div');
  chips.className = 'track-chips';
  rt.state.tracks.forEach(track => {
    const chip = button('chip' + (track.id === rt.state.selectedTrack ? ' is-selected' : ''), { 'data-select': track.id }, track.name);
    chip.style.setProperty('--pad', trackColor(track.type));
    chips.append(chip);
  });
  const remove = button('text-button', { 'data-remove': '1' }, 'Remove');
  remove.disabled = !rt.state.selectedTrack;
  bar.append(chips, remove);

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
    roll.style.setProperty('--cols', String(rt.state.grid * viewBars().count));
    const color = trackColor(track.type);
    const notes = trackNotes(track);
    const view = viewBars();
    const tick0 = view.start * TICKS;
    const ticksMax = tick0 + view.count * TICKS;
    for (let midi = NOTE_HI; midi >= NOTE_LO; midi -= 1) {
      if (!inScale(midi, rt.state.root, rt.state.mode)) continue;
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
    if (!inScale(midi, rt.state.root, rt.state.mode)) continue;
    keys.append(button('key' + (isBlack(midi) ? ' is-black' : ''), { 'data-key': String(midi) }, NOTE_NAMES[midi % 12]));
  }
  root.replaceChildren(bar, renderBarMeter('piano'), wrap, keys);
  paintPlayhead();
}

export function stopMeters() {
  window.cancelAnimationFrame(rt.meterRaf);
  rt.meterRaf = 0;
}

export function tickMeters() {
  rt.meterRaf = window.requestAnimationFrame(tickMeters);
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

export function renderMixer() {
  stopMeters();
  const root = document.getElementById('view-mixer');
  const row = document.createElement('div');
  row.className = 'mixer-row';
  const channels = document.createElement('div');
  channels.className = 'mixer-channels';
  const addStrip = (id, name, color, ink, master) => {
    if (!rt.state.mix[id]) rt.state.mix[id] = defaultMix();
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
      input.value = String(rt.state.mix[id][param]);
      input.dataset.strip = id;
      input.dataset.param = param;
      input.setAttribute('aria-label', name + ' ' + label);
      if (param === 'level') {
        const ms = document.createElement('div');
        ms.className = 'strip-ms';
        ms.append(
          button('', {
            'data-mute': id,
            'aria-pressed': rt.state.mix[id].mute ? 'true' : 'false',
            'aria-label': name + ' mute'
          }, 'M'),
          button('', {
            'data-solo': id,
            'aria-pressed': rt.state.mix[id].solo ? 'true' : 'false',
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
  rt.state.tracks.forEach(track => channels.append(addStrip(track.id, track.name, trackColor(track.type), '#1c140c', false)));
  row.append(channels, addStrip('master', 'Master', '#f4efe6', '#1c1a17', true));
  root.replaceChildren(renderBarMeter('mixer'), row);
  tickMeters();
}

export function showView(name) {
  stopMeters();
  const tip = document.querySelector('.mix-tip');
  if (tip) tip.hidden = true;
  if (name === 'drums' || name === 'piano') rt.lastEditView = name;
  document.querySelectorAll('[data-view]').forEach(tab => {
    const on = tab.dataset.view === name;
    tab.classList.toggle('is-selected', on);
    if (tab.getAttribute('role') === 'tab') tab.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const mixBtn = document.getElementById('mixer-button');
  if (mixBtn) mixBtn.setAttribute('aria-pressed', name === 'mixer' ? 'true' : 'false');
  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    panel.hidden = panel.dataset.viewPanel !== name;
  });
  if (name === 'drums') renderDrums();
  if (name === 'piano') renderPiano();
  if (name === 'mixer') renderMixer();
  document.querySelector('.mpc').classList.toggle('is-mixer', name === 'mixer');
  renderBank();
  renderTimeline();
  syncPlayMode();
}

export function syncKit() {
  document.querySelectorAll('.kit-view').forEach(sel => { sel.value = rt.state.kit; });
}

export function addTrack(type) {
  let id = 't' + rt.state.nextId;
  rt.state.nextId += 1;
  while (rt.state.tracks.some(track => track.id === id)) {
    id = 't' + rt.state.nextId;
    rt.state.nextId += 1;
  }
  const count = rt.state.tracks.filter(track => track.type === type).length + 1;
  rt.state.tracks.push({
    id,
    type,
    name: (type === 'fart' ? 'Fart ' : 'Queef ') + count
  });
  rt.state.patterns.forEach(pattern => { pattern.notes[id] = []; });
  rt.state.mix[id] = defaultMix();
  rt.state.selectedTrack = id;
  if (rt.ctx) {
    const master = strips.get('master');
    if (master) createStrip(id, master.input);
  }
  save();
  renderPiano();
}

export function removeSelected() {
  const track = selectedTrack();
  if (!track) return;
  rt.state.tracks = rt.state.tracks.filter(item => item.id !== track.id);
  delete rt.state.mix[track.id];
  rt.state.patterns.forEach(pattern => { delete pattern.notes[track.id]; });
  destroyStrip(track.id);
  rt.state.selectedTrack = rt.state.tracks.length ? rt.state.tracks[0].id : null;
  save();
  renderPiano();
}
