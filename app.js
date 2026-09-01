/*
 * Lab shell controller for the FART-O-IZER 6000.
 * Front-of-house for the whole atmospheric sound lab — not any one instrument.
 *
 * Owns shared lab chrome: status line, advanced panel open/close, WAV recording
 * orchestration, instrument picker, and instrument mounting. Each instrument plugs
 * in through a small API: mount, unmount, getAudio, share, reset, getGain.
 *
 * Boot flow:
 *   initialize()
 *     → resolveInitialInstrument() from URL
 *     → switchInstrument(id) → mount active instrument
 *     → wire Record, Share, Controls, picker, and panel handlers
 *
 * Runtime flow:
 *   Instrument pick → switchInstrument(id)
 *   Record          → countdown → capture tap on activeInstrument.getAudio()
 *   Share           → activeInstrument.share()
 *   Reset           → activeInstrument.reset()
 *   Controls open   → activeInstrument.onPanelOpen() (if provided)
 *
 * The lab stays open late. Instruments come and go. The recording booth is shared.
 */
(() => {
  'use strict';

  const DEFAULT_INSTRUMENT = 'fart';
  const instruments = {
    fart: () => window.FartInstrument,
    queef: () => window.QueefInstrument
  };
  let activeInstrument = null;
  let activeInstrumentId = DEFAULT_INSTRUMENT;

  const RECORDING_MAX_MS = 60000;
  const SILENCE_STOP_MS = 1000;
  const recording = {
    active: false, countingDown: false, starting: false, stopRequested: false, sawSignal: false,
    silenceStarted: 0, maxTimer: null, rmsTimer: null, countdownTimer: null, lastBlobURL: null, filename: '', stopping: false
  };
  let lastBlob;

  function setStatus(message) {
    document.getElementById('status').textContent = message;
  }

  function resolveInitialInstrument() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('QueefID')) return 'queef';
    if (params.get('FartID')) return 'fart';
    const instrument = params.get('instrument');
    if (instrument && instruments[instrument]) return instrument;
    return DEFAULT_INSTRUMENT;
  }

  function updateInstrumentChrome() {
    const shareButton = document.getElementById('share-button');
    const shareNote = document.getElementById('share-note');
    const recordingTitle = document.getElementById('recording-title');
    const recordingSection = document.getElementById('recording-section');
    const recordingExplainer = document.getElementById('recording-explainer');
    const closeRecording = document.getElementById('close-recording');

    shareButton.title = `Copy shareable ${activeInstrument.shareParameter} URL`;
    shareNote.innerHTML = `Your controls are encoded into the page URL as <strong>${activeInstrument.shareParameter}</strong>.`;
    recordingTitle.textContent = activeInstrument.recordingTitle;
    recordingSection.setAttribute('aria-label', activeInstrument.recordingTitle);
    closeRecording.setAttribute('aria-label', `Close ${activeInstrument.recordingTitle.toLowerCase()}`);
    closeRecording.title = `Close ${activeInstrument.recordingTitle.toLowerCase()}`;
    recordingExplainer.textContent = `Recording stops after 1 second of silence once a ${activeInstrument.displayName.toLowerCase()} signal is detected, or automatically at the 60 second hard limit.`;
  }

  function updateInstrumentPicker() {
    document.querySelectorAll('[data-instrument-id]').forEach(button => {
      const selected = button.dataset.instrumentId === activeInstrumentId;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-selected', selected);
    });
  }

  function updateInstrumentUrl(id) {
    const url = new URL(window.location.href);
    if (id === DEFAULT_INSTRUMENT) url.searchParams.delete('instrument');
    else url.searchParams.set('instrument', id);
    window.history.replaceState({}, '', url);
  }

  async function cancelRecordingForSwitch() {
    if (recording.stopping) return;
    if (recording.countingDown) {
      recording.countingDown = false;
      recording.stopRequested = false;
      clearRecordingTimers();
      updateRecordingButton();
      return;
    }
    if (recording.active && activeInstrument) {
      recording.stopRequested = true;
      if (!recording.starting) await stopRecording(activeInstrument.getAudio(), 'manual', true);
    }
  }

  async function switchInstrument(id) {
    if (!instruments[id] || id === activeInstrumentId) return;
    await cancelRecordingForSwitch();
    togglePanel(false);

    if (activeInstrument && activeInstrument.unmount) activeInstrument.unmount();

    activeInstrumentId = id;
    activeInstrument = instruments[id]();
    document.getElementById('instrument-stage').dataset.instrument = id;
    document.querySelector('.console').dataset.instrument = id;
    document.body.dataset.instrument = id;

    activeInstrument.mount({ setStatus });
    updateInstrumentChrome();
    updateInstrumentPicker();
    updateInstrumentUrl(id);
    setStatus('Audio is waiting for your first press.');
  }

  function togglePanel(open) {
    const panel = document.getElementById('advanced-panel');
    const backdrop = document.getElementById('panel-backdrop');
    const toggle = document.getElementById('advanced-toggle');
    panel.hidden = !open;
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('panel-open', open);
    panel.style.top = '';
    if (open && activeInstrument.onPanelOpen) activeInstrument.onPanelOpen();
  }

  function writeString(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  }

  function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(44 + index * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function createRecordingFilename(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const timestamp = [
      date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()),
      pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())
    ].join('');
    const instrument = activeInstrument.displayName || 'Recording';
    return `${instrument}_Fart-O-Izer_${timestamp}.wav`;
  }

  function clearRecordingTimers() {
    window.clearTimeout(recording.maxTimer);
    window.clearInterval(recording.rmsTimer);
    window.clearTimeout(recording.countdownTimer);
    recording.maxTimer = null;
    recording.rmsTimer = null;
    recording.countdownTimer = null;
  }

  function updateRecordingButton() {
    const button = document.getElementById('record-button');
    const icon = button.querySelector('.record-icon');
    const label = button.querySelector('.record-label');
    button.setAttribute('aria-pressed', String(recording.active || recording.countingDown));
    button.classList.toggle('is-recording', recording.active || recording.countingDown);
    button.classList.toggle('is-counting-down', recording.countingDown);
    icon.textContent = recording.active ? '●' : '○';
    label.textContent = recording.countingDown ? 'Get ready...' : (recording.active ? 'Stop recording' : 'Record');
  }

  function showRecordingSection(duration, state = 'complete') {
    const section = document.getElementById('recording-section');
    const line = document.getElementById('recording-line');
    const durationLabel = document.getElementById('recording-duration');
    const link = document.getElementById('recording-download');
    line.className = `recording-line recording-line-${state}`;
    if (state === 'countdown') {
      link.textContent = 'no data';
      link.removeAttribute('href');
      durationLabel.textContent = '';
    } else if (state === 'active') {
      link.textContent = 'Recording gorgeous gas....';
      link.removeAttribute('href');
      durationLabel.textContent = '';
    } else {
      link.textContent = 'Re-download WAV';
      link.href = recording.lastBlobURL;
      link.download = recording.filename;
      durationLabel.textContent = `${duration.toFixed(1)}s`;
    }
    section.hidden = false;
    section.classList.remove('is-collapsed');
    document.getElementById('recording-collapse').setAttribute('aria-expanded', 'true');
  }

  async function stopRecording(audio, reason, silent = false) {
    if (!recording.active || recording.stopping) return;
    recording.active = false;
    recording.stopping = true;
    clearRecordingTimers();
    updateRecordingButton();
    try {
      const result = await audio.stopCapture();
      if (!recording.sawSignal || !result.samples.length) {
        if (!silent) showRecordingSection(0, 'countdown');
        if (!silent) {
          setStatus(reason === 'manual' ? 'No sound was captured.' : `No ${activeInstrument.displayName.toLowerCase()} signal was captured.`);
        }
        return;
      }
      if (silent) return;
      lastBlob = encodeWav(result.samples, result.sampleRate);
      recording.filename = createRecordingFilename();
      if (recording.lastBlobURL) URL.revokeObjectURL(recording.lastBlobURL);
      recording.lastBlobURL = URL.createObjectURL(lastBlob);
      const link = document.getElementById('recording-download');
      link.href = recording.lastBlobURL;
      link.download = recording.filename;
      link.click();
      showRecordingSection(result.samples.length / result.sampleRate);
      setStatus(`${activeInstrument.recordingTitle} ready to download again.`);
    } catch (error) {
      if (!silent) {
        setStatus(error.message || 'The recording could not be saved.');
        showRecordingSection(0, 'countdown');
      }
    } finally {
      recording.stopping = false;
    }
  }

  async function startRecording() {
    const audio = activeInstrument.getAudio();
    if (recording.stopping) {
      setStatus('Finishing the previous recording. Try again in a moment.');
      return;
    }
    if (recording.active || recording.countingDown) {
      recording.stopRequested = true;
      if (recording.countingDown) {
        recording.countingDown = false;
        clearRecordingTimers();
        updateRecordingButton();
        setStatus('Recording cancelled.');
      } else if (!recording.starting) {
        await stopRecording(audio, 'manual');
      }
      return;
    }
    recording.countingDown = true;
    recording.stopRequested = false;
    updateRecordingButton();
    showRecordingSection(0, 'countdown');
    setStatus('Recording starts in 2 seconds.');
    recording.countdownTimer = window.setTimeout(() => beginRecording(), 2000);
  }

  async function beginRecording() {
    const audio = activeInstrument.getAudio();
    recording.countingDown = false;
    recording.active = true;
    recording.starting = true;
    recording.sawSignal = false;
    recording.silenceStarted = 0;
    updateRecordingButton();
    showRecordingSection(0, 'active');
    try {
      await audio.startCapture(activeInstrument.getGain());
      recording.starting = false;
      if (recording.stopRequested) {
        await stopRecording(audio, 'manual');
        return;
      }
      recording.maxTimer = window.setTimeout(() => stopRecording(audio, 'maximum'), RECORDING_MAX_MS);
      recording.rmsTimer = window.setInterval(() => {
        const rms = audio.getRMS();
        if (rms >= 0.01) {
          recording.sawSignal = true;
          recording.silenceStarted = 0;
        } else if (recording.sawSignal) {
          if (!recording.silenceStarted) recording.silenceStarted = Date.now();
          if (Date.now() - recording.silenceStarted >= SILENCE_STOP_MS) stopRecording(audio, 'silence');
        }
      }, 50);
      setStatus(`Recording armed. Press ${activeInstrument.playActionLabel} to capture the evidence.`);
    } catch (error) {
      clearRecordingTimers();
      await audio.stopCapture().catch(() => {});
      recording.active = false;
      recording.starting = false;
      updateRecordingButton();
      showRecordingSection(0, 'countdown');
      setStatus(error.message || 'WAV recording could not be started.');
    }
  }

  function initialize() {
    activeInstrumentId = resolveInitialInstrument();
    activeInstrument = instruments[activeInstrumentId]();
    document.getElementById('instrument-stage').dataset.instrument = activeInstrumentId;
    document.querySelector('.console').dataset.instrument = activeInstrumentId;
    document.body.dataset.instrument = activeInstrumentId;
    activeInstrument.mount({ setStatus });
    updateInstrumentChrome();
    updateInstrumentPicker();

    document.querySelectorAll('[data-instrument-id]').forEach(button => {
      button.addEventListener('click', () => switchInstrument(button.dataset.instrumentId));
    });
    document.getElementById('record-button').addEventListener('click', startRecording);
    document.getElementById('share-button').addEventListener('click', () => activeInstrument.share());
    document.getElementById('advanced-toggle').addEventListener('click', () => togglePanel(true));
    document.getElementById('reset-settings').addEventListener('click', () => activeInstrument.reset());
    document.getElementById('close-panel').addEventListener('click', () => togglePanel(false));
    document.getElementById('panel-backdrop').addEventListener('click', () => togglePanel(false));
    document.getElementById('recording-collapse').addEventListener('click', () => {
      const section = document.getElementById('recording-section');
      const expanded = section.classList.toggle('is-collapsed') === false;
      document.getElementById('recording-collapse').setAttribute('aria-expanded', String(expanded));
    });
    document.getElementById('close-recording').addEventListener('click', () => {
      document.getElementById('recording-section').hidden = true;
    });
    window.addEventListener('beforeunload', () => {
      if (recording.lastBlobURL) URL.revokeObjectURL(recording.lastBlobURL);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
