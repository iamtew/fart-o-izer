import { SONG_ID, SONG_NAME_MAX, DEFAULT_SONG, MIX_PARAMS, rt } from './const.js';
import {
  selfCheck, clamp, cleanSongName, payloadOf, freshState, decodePayload,
  clipFits, clipBars, noteAt, placeNote, removeNoteAt, moveNote, defaultMix
} from './model.js';
import {
  save, loadLibrary, leaveSong, loadDefault, loadFromLibrary, saveToLibrary,
  deleteFromLibrary, importSongFile, exportSongJson, exportSong, currentPattern,
  setSongStatus, syncSongNameInput, syncLibrarySelect, selectedTrack, trackNotes, patternTicks
} from './persist.js';
import {
  startTransport, stopTransport, armRecord, hitPad, beginKeyHold, endLivePointer,
  applyAllMix, applyMix, gridSpan, audition
} from './audio.js';
import {
  syncKit, syncKeyScale, applySeqShare, applySeqFold, setRecUi, setMainMenuOpen,
  showView, currentViewName, renderPiano, addPattern, copyPattern, resizeCurrentPattern, deleteCurrentPattern,
  selectPattern, startRename, renderTimeline, handleBarMeter, addTrack, removeSelected,
  paintRoll, loopEndBar, syncPlayMode, paintKnob, showMixTip
} from './ui.js';

export function init() {
  selfCheck();
  const bpm = document.getElementById('bpm');
  bpm.value = String(rt.state.bpm);
  syncKit();
  syncKeyScale();
  rt.seqFolded = window.matchMedia('(max-width: 760px)').matches;
  applySeqShare();
  applySeqFold();
  setRecUi();
  syncSongNameInput();
  const stored = loadLibrary().find(item => item.name === cleanSongName(rt.state.songName));
  rt.snapshot = JSON.stringify(stored ? stored.song : payloadOf(freshState()));
  rt.loadedFrom = stored ? stored.name : DEFAULT_SONG;
  syncLibrarySelect();
  showView('drums');
  const encoded = new URLSearchParams(window.location.search).get(SONG_ID);
  if (encoded) {
    if (decodePayload(encoded)) setSongStatus('SongID URLs are retired. Export JSON instead.');
    else setSongStatus('That SongID was not recognized.');
  }

  document.getElementById('song-name').addEventListener('input', event => {
    rt.state.songName = String(event.target.value).slice(0, SONG_NAME_MAX);
    save();
  });
  document.getElementById('song-library').addEventListener('change', async event => {
    const select = event.target;
    const next = select.value;
    select.value = rt.loadedFrom;
    select.blur();
    if (!(await leaveSong())) return;
    if (next === DEFAULT_SONG) loadDefault();
    else loadFromLibrary(next);
  });
  ['leave-dialog', 'delete-dialog'].forEach(id => {
    const dialog = document.getElementById(id);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close('cancel');
    });
  });
  document.getElementById('save-song').addEventListener('click', saveToLibrary);
  document.getElementById('delete-song').addEventListener('click', deleteFromLibrary);
  document.getElementById('import-song').addEventListener('click', () => {
    document.getElementById('import-song-file').click();
  });
  document.getElementById('import-song-file').addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    importSongFile(file);
  });
  document.getElementById('export-json').addEventListener('click', exportSongJson);
  document.getElementById('export-song').addEventListener('click', exportSong);
  const menuBtn = document.getElementById('main-menu-button');
  const menuWrap = document.querySelector('.main-menu-wrap');
  menuWrap.addEventListener('pointerdown', event => event.stopPropagation());
  menuBtn.addEventListener('click', () => setMainMenuOpen(document.getElementById('main-menu').hidden));
  document.addEventListener('pointerdown', () => {
    if (!document.getElementById('main-menu').hidden) setMainMenuOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setMainMenuOpen(false);
  });
  document.getElementById('play-button').addEventListener('click', () => {
    if (rt.playing) stopTransport();
    else startTransport();
  });
  document.getElementById('rec-button').addEventListener('click', () => {
    if (rt.recording) {
      rt.recording = false;
      setRecUi();
      return;
    }
    armRecord();
  });
  bpm.addEventListener('dblclick', () => {
    rt.state.bpm = 140;
    bpm.value = '140';
    save();
  });
  bpm.addEventListener('input', () => {
    const value = Number(bpm.value);
    if (value >= 40 && value <= 240) {
      rt.state.bpm = value;
      save();
    }
  });
  bpm.addEventListener('change', () => {
    rt.state.bpm = clamp(bpm.value, 40, 240, rt.state.bpm);
    bpm.value = String(rt.state.bpm);
    save();
  });
  document.getElementById('mixer-button').addEventListener('click', () => {
    showView(currentViewName() === 'mixer' ? rt.lastEditView : 'mixer');
  });
  document.querySelector('.mpc').addEventListener('mousedown', event => {
    const kit = event.target.closest('.kit-view');
    if (kit && document.getElementById('view-drums').hidden) showView('drums');
  });
  document.querySelector('.mpc').addEventListener('change', event => {
    const kit = event.target.closest('.kit-view');
    if (!kit) return;
    rt.state.kit = kit.value === '909' ? '909' : '808';
    save();
    syncKit();
  });
  document.querySelector('.mpc-bar').addEventListener('change', event => {
    const sel = event.target.closest('[data-lock]');
    if (!sel) return;
    if (sel.dataset.lock === 'root') rt.state.root = clamp(sel.value, 0, 11, rt.state.root) | 0;
    if (sel.dataset.lock === 'mode') {
      rt.state.mode = sel.value === 'major' || sel.value === 'minor' ? sel.value : 'chromatic';
    }
    save();
    if (!document.getElementById('view-piano').hidden) renderPiano();
  });
  const split = document.getElementById('seq-split');
  document.getElementById('seq-fold').addEventListener('click', event => {
    event.stopPropagation();
    rt.seqFolded = !rt.seqFolded;
    applySeqFold();
  });
  split.addEventListener('pointerdown', event => {
    if (event.button || rt.seqFolded || event.target.closest('.seq-fold')) return;
    const view = document.querySelector('.mpc-view:not([hidden])');
    const timeline = document.getElementById('timeline');
    const total = view.offsetHeight + timeline.offsetHeight;
    if (!total) return;
    const startY = event.clientY;
    const startH = timeline.offsetHeight;
    try { split.setPointerCapture(event.pointerId); } catch (err) { /* no hardware pointer */ }
    const onMove = ev => {
      rt.state.seqShare = clamp((startH + (startY - ev.clientY)) / total, 0.18, 0.7, rt.state.seqShare);
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
    if (rt.seqFolded || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    rt.state.seqShare = clamp(rt.state.seqShare + (event.key === 'ArrowUp' ? 0.04 : -0.04), 0.18, 0.7, rt.state.seqShare);
    applySeqShare();
    save();
  });
  document.querySelector('.mode-switch').addEventListener('click', event => {
    const tab = event.target.closest('[data-mode]');
    if (!tab || tab.disabled) return;
    if (tab.dataset.mode === 'song' && !rt.state.arrangement.length) return;
    rt.state.playSong = tab.dataset.mode === 'song';
    syncPlayMode();
    save();
    if (rt.playing) {
      stopTransport();
      startTransport();
    }
  });
  document.getElementById('pattern-bank').addEventListener('click', event => {
    if (event.target.closest('.pattern-name')) return;
    if (event.target.closest('[data-pattern-copy]')) { copyPattern(); return; }
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
    return Math.max(0, Math.floor((clientX - inner.getBoundingClientRect().left) / rt.state.pxPerBar));
  }
  timeline.addEventListener('click', event => {
    const zoom = event.target.closest('[data-zoom]');
    if (!zoom) return;
    rt.state.pxPerBar = clamp(rt.state.pxPerBar + (zoom.dataset.zoom === 'in' ? 12 : -12), 16, 160, rt.state.pxPerBar);
    save();
    renderTimeline();
  });
  timeline.addEventListener('wheel', event => {
    if (!event.target.closest('.tl-scroll')) return;
    event.preventDefault();
    rt.state.pxPerBar = clamp(rt.state.pxPerBar + (event.deltaY < 0 ? 8 : -8), 16, 160, rt.state.pxPerBar);
    save();
    renderTimeline();
  }, { passive: false });
  timeline.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-loop]');
    if (handle) {
      rt.tlDrag = { kind: handle.dataset.loop === 'start' ? 'loopStart' : 'loopEnd', pointerId: event.pointerId };
      timeline.setPointerCapture(event.pointerId);
      return;
    }
    const edge = event.target.closest('[data-clip-end]');
    if (edge) {
      const index = Number(edge.dataset.clipEnd);
      rt.tlDrag = { kind: 'repeat', index, pointerId: event.pointerId };
      timeline.setPointerCapture(event.pointerId);
      return;
    }
    const clip = event.target.closest('[data-clip]');
    if (clip) {
      const index = Number(clip.dataset.clip);
      rt.tlDrag = {
        kind: 'move',
        index,
        pointerId: event.pointerId,
        originBar: rt.state.arrangement[index].startBar,
        grabBar: barAt(event.clientX),
        moved: false
      };
      timeline.setPointerCapture(event.pointerId);
      return;
    }
    if (!event.target.closest('.tl-lane')) return;
    const startBar = barAt(event.clientX);
    const pattern = currentPattern();
    if (!clipFits(rt.state.arrangement, -1, startBar, pattern.bars, rt.state.patterns)) return;
    rt.state.arrangement.push({ patternId: pattern.id, startBar, repeats: 1 });
    rt.state.arrangement.sort((a, b) => a.startBar - b.startBar);
    save();
    syncPlayMode();
    renderTimeline();
  });
  timeline.addEventListener('pointermove', event => {
    if (!rt.tlDrag || event.pointerId !== rt.tlDrag.pointerId) return;
    const bar = barAt(event.clientX);
    if (rt.tlDrag.kind === 'loopStart') {
      rt.state.loopStart = Math.max(0, Math.min(bar, loopEndBar() - 1));
      renderTimeline();
      return;
    }
    if (rt.tlDrag.kind === 'loopEnd') {
      rt.state.loopEnd = Math.max(rt.state.loopStart + 1, bar + 1);
      renderTimeline();
      return;
    }
    if (rt.tlDrag.kind === 'move') {
      const clip = rt.state.arrangement[rt.tlDrag.index];
      const span = clipBars(clip, rt.state.patterns);
      const next = Math.max(0, rt.tlDrag.originBar + (bar - rt.tlDrag.grabBar));
      if (next === clip.startBar) return;
      if (!clipFits(rt.state.arrangement, rt.tlDrag.index, next, span, rt.state.patterns)) return;
      clip.startBar = next;
      rt.tlDrag.moved = true;
      renderTimeline();
      return;
    }
    if (rt.tlDrag.kind === 'repeat') {
      const clip = rt.state.arrangement[rt.tlDrag.index];
      const pattern = rt.state.patterns.find(item => item.id === clip.patternId);
      if (!pattern) return;
      const repeats = Math.max(1, Math.ceil((bar + 1 - clip.startBar) / pattern.bars));
      if (repeats === clip.repeats) return;
      if (!clipFits(rt.state.arrangement, rt.tlDrag.index, clip.startBar, pattern.bars * repeats, rt.state.patterns)) return;
      clip.repeats = repeats;
      renderTimeline();
    }
  });
  const endTl = event => {
    if (!rt.tlDrag || (event && event.pointerId !== rt.tlDrag.pointerId)) return;
    const drag = rt.tlDrag;
    rt.tlDrag = null;
    if (drag.kind === 'move' && !drag.moved) {
      selectPattern(rt.state.arrangement[drag.index].patternId);
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
      rt.state.selectedTrack = select.dataset.select;
      save();
      renderPiano();
      return;
    }
    if (event.target.closest('[data-remove]')) { removeSelected(); return; }
    if (event.target.closest('[data-grid]')) {
      rt.state.grid = rt.state.grid === 32 ? 16 : 32;
      save();
      renderPiano();
    }
  });
  pianoView.addEventListener('pointerdown', event => {
    const key = event.target.closest('[data-key]');
    if (key) {
      if (event.button) return;
      if (event.pointerType === 'touch') {
        rt.drag = { kind: 'pending-key', pointerId: event.pointerId, x: event.clientX, y: event.clientY, key };
        return;
      }
      event.preventDefault();
      beginKeyHold(event.pointerId, key, Number(key.dataset.key));
      try { key.setPointerCapture(event.pointerId); } catch (err) { /* no hardware pointer */ }
      return;
    }
    const cell = event.target.closest('.cell');
    if (!cell) return;
    if (event.pointerType === 'touch') {
      rt.drag = { kind: 'pending-cell', pointerId: event.pointerId, x: event.clientX, y: event.clientY, cell };
      return;
    }
    beginCellDrag(event, cell);
  });
  const beginCellDrag = (event, cell, capture = true) => {
    const track = selectedTrack();
    if (!track) return;
    const step = Number(cell.dataset.step);
    const span = Number(cell.dataset.span || gridSpan());
    const pitch = Number(cell.dataset.pitch);
    const hit = noteAt(trackNotes(track), step, pitch, span);
    if (hit) {
      rt.drag = {
        kind: 'move',
        pitch: hit.pitch,
        origin: hit.step,
        length: hit.length,
        downStep: step,
        downPitch: pitch,
        origStep: hit.step,
        pointerId: event.pointerId,
        erase: true
      };
      if (capture) pianoView.setPointerCapture(event.pointerId);
      return;
    }
    rt.drag = { kind: 'draw', pitch, origin: step, length: span, pointerId: event.pointerId, erase: false };
    currentPattern().notes[track.id] = placeNote(trackNotes(track), step, pitch, span, patternTicks());
    paintRoll(track);
    audition(pitch);
    if (capture) pianoView.setPointerCapture(event.pointerId);
  };
  pianoView.addEventListener('pointermove', event => {
    if (!rt.drag || event.pointerId !== rt.drag.pointerId) return;
    if (rt.drag.kind === 'pending-cell' || rt.drag.kind === 'pending-key') {
      const dx = event.clientX - rt.drag.x;
      const dy = event.clientY - rt.drag.y;
      if (dx * dx + dy * dy > 144) rt.drag = null;
      return;
    }
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const cell = el && el.closest ? el.closest('.cell') : null;
    if (!cell) return;
    const pitch = Number(cell.dataset.pitch);
    const step = Number(cell.dataset.step);
    const span = Number(cell.dataset.span || gridSpan());
    const track = selectedTrack();
    if (!track) return;
    if (rt.drag.kind === 'move') {
      if (rt.drag.erase && step === rt.drag.downStep && pitch === rt.drag.downPitch) return;
      rt.drag.erase = false;
      const toStep = Math.max(0, rt.drag.origStep + (step - rt.drag.downStep));
      if (toStep === rt.drag.origin && pitch === rt.drag.pitch) return;
      const next = moveNote(trackNotes(track), rt.drag.origin, rt.drag.pitch, toStep, pitch, patternTicks());
      const moved = next[next.length - 1];
      if (!moved) return;
      rt.drag.origin = moved.step;
      rt.drag.pitch = moved.pitch;
      currentPattern().notes[track.id] = next;
      paintRoll(track);
      return;
    }
    if (pitch !== rt.drag.pitch || step < rt.drag.origin) return;
    const length = step - rt.drag.origin + span;
    if (length === rt.drag.length) return;
    rt.drag.length = length;
    rt.drag.erase = false;
    currentPattern().notes[track.id] = placeNote(trackNotes(track), rt.drag.origin, pitch, length, patternTicks());
    paintRoll(track);
  });
  const endDrag = event => {
    if (!rt.drag || (event && event.pointerId !== rt.drag.pointerId)) return;
    if (rt.drag.kind === 'pending-cell') {
      beginCellDrag(event, rt.drag.cell, false);
    }
    if (rt.drag && rt.drag.kind === 'pending-key') {
      const key = rt.drag.key;
      rt.drag = null;
      beginKeyHold(event.pointerId, key, Number(key.dataset.key));
      endLivePointer(event.pointerId);
      return;
    }
    if (rt.drag.erase) {
      const track = selectedTrack();
      if (track) {
        currentPattern().notes[track.id] = removeNoteAt(trackNotes(track), rt.drag.origin, rt.drag.pitch);
        paintRoll(track);
      }
    }
    rt.drag = null;
    save();
  };
  pianoView.addEventListener('pointerup', event => {
    endLivePointer(event.pointerId);
    endDrag(event);
  });
  pianoView.addEventListener('pointercancel', event => {
    endLivePointer(event.pointerId);
    if (rt.drag && event.pointerId === rt.drag.pointerId && (rt.drag.kind === 'pending-cell' || rt.drag.kind === 'pending-key')) {
      rt.drag = null;
      return;
    }
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
    if (handleBarMeter(event)) return;
    const mute = event.target.closest('[data-mute]');
    const solo = event.target.closest('[data-solo]');
    if (!mute && !solo) return;
    const id = (mute || solo).dataset.mute || (mute || solo).dataset.solo;
    const mix = rt.state.mix[id];
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
    rt.state.mix[id][input.dataset.param] = Number(input.value);
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
      rt.state.mix[input.dataset.strip][input.dataset.param] = value;
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
