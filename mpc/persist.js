import {
  STORAGE_KEY, LIBRARY_KEY, DEFAULT_SONG, SONG_ID, SONG_NAME_MAX,
  EXPORT_MAX_S, NOTE_NAMES, TICKS, PAGE_BARS, PADS, rt, strips
} from './const.js';
import {
  hydrateFromRaw, decodePayload, freshState, payloadOf, cleanSongName,
  poopSongName, parseSongText, clamp, clipBars, tickSeconds
} from './model.js';
import {
  ensureAudio, createStrip, destroyStrip, applyAllMix, stopTransport, scheduleTick
} from './audio.js';
import {
  applySeqShare, syncKeyScale, syncKit, showView, currentViewName
} from './ui.js';

export function loadState() {
  try {
    const encoded = new URLSearchParams(window.location.search).get(SONG_ID);
    if (encoded) {
      const decoded = decodePayload(encoded);
      if (decoded) {
        const next = hydrateFromRaw(decoded);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (err) { /* quota: song still plays */ }
        return next;
      }
    }
    return hydrateFromRaw(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch (err) {
    return freshState();
  }
}
export function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rt.state)); } catch (err) { /* quota: pattern still plays */ }
}

export function markClean() {
  rt.snapshot = JSON.stringify(songPayload());
}

export function isDirty() {
  return JSON.stringify(songPayload()) !== rt.snapshot;
}

export function askDialog(id) {
  const dialog = document.getElementById(id);
  dialog.returnValue = 'cancel';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue || 'cancel'), { once: true });
  });
}

export async function confirmDiscard() {
  if (!isDirty()) return 'discard';
  return askDialog('leave-dialog');
}

export async function leaveSong() {
  const choice = await confirmDiscard();
  if (choice === 'cancel') return false;
  if (choice === 'save') {
    saveToLibrary();
    if (isDirty()) return false;
  }
  return true;
}

export function setSongStatus(message) {
  const node = document.getElementById('song-status');
  if (node) node.textContent = message || '';
}

export function syncSongNameInput() {
  const input = document.getElementById('song-name');
  if (input) input.value = rt.state.songName;
}

export function songPayload() {
  return payloadOf(rt.state);
}

export function ensureSongName() {
  const name = cleanSongName(rt.state.songName);
  if (name) {
    if (name !== rt.state.songName) {
      rt.state.songName = name;
      syncSongNameInput();
      save();
    }
    return name;
  }
  rt.state.songName = poopSongName();
  syncSongNameInput();
  save();
  return rt.state.songName;
}

export function wavFilename(name, ext) {
  const safe = name.replace(/[^\w\- ]+/g, '_').trim() || 'song';
  if (ext) return safe + ext;
  return safe + '-' + rt.state.bpm + '-' + NOTE_NAMES[rt.state.root] + '-' + rt.state.mode + '.wav';
}

export function loadLibrary() {
  try {
    const raw = JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(item => item && typeof item.name === 'string' && item.song && typeof item.song === 'object');
  } catch (err) {
    return [];
  }
}

export function writeLibrary(list) {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(list)); } catch (err) { /* quota: working song still plays */ }
}

export function upsertLibrary(payload) {
  const name = cleanSongName(payload && payload.songName);
  if (!name || name.toLowerCase() === 'default') return;
  const list = loadLibrary().filter(item => item.name !== name && item.name.toLowerCase() !== 'default');
  list.push({ name, song: payload });
  list.sort((a, b) => a.name.localeCompare(b.name));
  writeLibrary(list);
}

export function syncLibrarySelect() {
  const select = document.getElementById('song-library');
  if (!select) return;
  const def = document.createElement('option');
  def.value = DEFAULT_SONG;
  def.textContent = 'Default';
  const nodes = [def];
  loadLibrary().forEach(item => {
    if (item.name.toLowerCase() === 'default') return;
    const option = document.createElement('option');
    option.value = item.name;
    option.textContent = item.name;
    nodes.push(option);
  });
  select.replaceChildren(...nodes);
  select.value = rt.loadedFrom;
}

export function saveToLibrary() {
  const name = ensureSongName();
  if (name.toLowerCase() === 'default') {
    setSongStatus('Default is the blank template. Pick another name.');
    return false;
  }
  upsertLibrary(songPayload());
  rt.loadedFrom = name;
  markClean();
  syncLibrarySelect();
  setSongStatus('Saved ' + name + ' in this browser.');
  return true;
}

export function loadDefault() {
  rt.loadedFrom = DEFAULT_SONG;
  adoptState(freshState());
  setSongStatus('Loaded Default.');
}

export function loadFromLibrary(name) {
  if (name === DEFAULT_SONG) {
    loadDefault();
    return;
  }
  const item = loadLibrary().find(entry => entry.name === name);
  if (!item) return;
  rt.loadedFrom = name;
  adoptState(hydrateFromRaw(item.song));
  setSongStatus('Loaded ' + rt.state.songName + '.');
}

export async function deleteFromLibrary() {
  const name = cleanSongName(rt.state.songName);
  if (!name || name.toLowerCase() === 'default') {
    setSongStatus('Default is the blank template.');
    return;
  }
  const list = loadLibrary();
  if (!list.some(item => item.name === name)) {
    setSongStatus(name + ' is not in the library.');
    return;
  }
  if (await askDialog('delete-dialog') !== 'ok') return;
  writeLibrary(list.filter(item => item.name !== name));
  syncLibrarySelect();
  setSongStatus('Removed ' + name + ' from the library.');
}

export function exportSongJson() {
  const name = ensureSongName();
  const blob = new Blob([JSON.stringify(songPayload(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, wavFilename(name, '.json'));
  setSongStatus('Exported ' + wavFilename(name, '.json') + '.');
}

export function importSongFile(file) {
  if (!file) return;
  file.text().then(async text => {
    const payload = parseSongText(text);
    if (!payload) {
      setSongStatus('That song file was not recognized.');
      return;
    }
    if (!(await leaveSong())) return;
    adoptState(hydrateFromRaw(payload));
    rt.loadedFrom = ensureSongName();
    upsertLibrary(songPayload());
    markClean();
    syncLibrarySelect();
    setSongStatus('Imported ' + rt.state.songName + '.');
  }).catch(() => {
    setSongStatus('That song file could not be read.');
  });
}

export function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  const lanes = [];
  for (let channel = 0; channel < channels; channel += 1) lanes.push(audioBuffer.getChannelData(channel));
  let offset = 44;
  for (let index = 0; index < length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, lanes[channel][index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function exportSong() {
  const name = ensureSongName();
  const button = document.getElementById('export-song');
  if (button) button.disabled = true;
  setSongStatus('Rendering WAV…');
  const savedPlay = rt.state.playSong;
  let liveCtx = rt.ctx;
  let liveHats = rt.hats;
  let saved = new Map(strips);
  try {
    await ensureAudio();
    liveCtx = rt.ctx;
    liveHats = rt.hats;
    saved = new Map(strips);
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('WAV export is not supported in this browser.');
    const song = rt.state.arrangement.length > 0;
    let bars = currentPattern().bars;
    if (song) {
      bars = 0;
      rt.state.arrangement.forEach(clip => {
        bars = Math.max(bars, clip.startBar + clipBars(clip, rt.state.patterns));
      });
      bars = Math.max(bars, 1);
    }
    const tail = 1;
    let seconds = bars * 4 * (60 / rt.state.bpm) + tail;
    // ponytail: 10 min cap; chunked/offline stream if songs grow past this
    if (seconds > EXPORT_MAX_S) seconds = EXPORT_MAX_S;
    const sampleRate = rt.ctx.sampleRate;
    const frames = Math.max(1, Math.ceil(seconds * sampleRate));
    const offline = new Offline(2, frames, sampleRate);
    strips.clear();
    rt.hats = [];
    rt.ctx = offline;
    const masterIn = createStrip('master', rt.ctx.destination);
    PADS.forEach(pad => createStrip(pad.id, masterIn));
    rt.state.tracks.forEach(track => createStrip(track.id, masterIn));
    rt.state.playSong = song;
    const tickDur = tickSeconds(rt.state.bpm);
    const endTick = Math.min(bars * TICKS, Math.max(1, Math.floor((seconds - tail) / tickDur)));
    for (let tick = 0; tick < endTick; tick += 1) scheduleTick(tick, tick * tickDur);
    const rendered = await offline.startRendering();
    downloadBlob(encodeWav(rendered), wavFilename(name));
    setSongStatus('Exported ' + wavFilename(name) + '.');
  } catch (err) {
    setSongStatus(err.message || 'The song could not be exported.');
  } finally {
    rt.state.playSong = savedPlay;
    rt.ctx = liveCtx;
    strips.clear();
    saved.forEach((strip, id) => strips.set(id, strip));
    rt.hats = liveHats;
    if (button) button.disabled = false;
  }
}
export function selectedTrack() {
  return rt.state.tracks.find(track => track.id === rt.state.selectedTrack) || null;
}

export function currentPattern() {
  return rt.state.patterns.find(item => item.id === rt.state.patternId) || rt.state.patterns[0];
}

export function patternTicks() {
  return currentPattern().bars * TICKS;
}

export function pageCount() {
  return Math.max(1, Math.ceil(currentPattern().bars / PAGE_BARS));
}

export function viewBars() {
  rt.patternPage = Math.max(0, Math.min(rt.patternPage, pageCount() - 1));
  const start = rt.patternPage * PAGE_BARS;
  return { start, count: Math.min(PAGE_BARS, currentPattern().bars - start) };
}

export function trackNotes(track) {
  const pattern = currentPattern();
  if (!pattern.notes[track.id]) pattern.notes[track.id] = [];
  return pattern.notes[track.id];
}

export function usingSong() {
  return rt.state.playSong && rt.state.arrangement.length > 0;
}
export function adoptState(next) {
  stopTransport();
  const keep = { master: true };
  PADS.forEach(pad => { keep[pad.id] = true; });
  (next.tracks || []).forEach(track => { keep[track.id] = true; });
  strips.forEach((_, id) => {
    if (!keep[id]) destroyStrip(id);
  });
  Object.keys(next).forEach(key => { rt.state[key] = next[key]; });
  if (rt.ctx) {
    const master = strips.get('master');
    if (master) {
      PADS.forEach(pad => {
        if (!strips.has(pad.id)) createStrip(pad.id, master.input);
      });
      rt.state.tracks.forEach(track => {
        if (!strips.has(track.id)) createStrip(track.id, master.input);
      });
    }
    applyAllMix();
  }
  const bpm = document.getElementById('bpm');
  if (bpm) bpm.value = String(rt.state.bpm);
  syncSongNameInput();
  syncKeyScale();
  syncKit();
  applySeqShare();
  save();
  showView(currentViewName());
  markClean();
  syncLibrarySelect();
}

rt.state = loadState();
