(() => {
  'use strict';

  // app.js owns application state and the interface. Audio implementation is
  // kept in flatulence_factory.js and is accessed through its small API.
  const PARAMETER = 'FartID';
  const VERSION = 1;
  const defaults = {
    frequency: 58, noise: 0.42, cutoff: 720, decay: 0.62, rate: 4.2, depth: 0.32, gain: 0.48,
    cheekClapz: false, cheekClapzSpeed: 8, sphincterShift: 0
  };
  const ranges = {
    frequency: [35, 110], noise: [0, 1], cutoff: [180, 1800], decay: [0.18, 1.4],
    rate: [1, 12], depth: [0, 1], gain: [0.15, 0.8],
    cheekClapzSpeed: [2, 24], sphincterShift: [-1, 1]
  };
  const keys = {
    frequency: 'f', noise: 'n', cutoff: 'c', decay: 'd', rate: 'r', depth: 'l', gain: 'g',
    cheekClapz: 'z', cheekClapzSpeed: 's', sphincterShift: 'p'
  };
  const controls = {};
  const outputs = {};
  let settings = { ...defaults };
  const RECORDING_MAX_MS = 60000;
  const SILENCE_STOP_MS = 1000;
  const recording = {
    active: false, countingDown: false, starting: false, stopRequested: false, sawSignal: false,
    silenceStarted: 0, maxTimer: null, rmsTimer: null, countdownTimer: null, lastBlobURL: null, filename: '', stopping: false
  };
  let lastBlob;

  const formatters = {
    frequency: value => `${Math.round(value)} Hz`,
    noise: value => `${Math.round(value * 100)}%`,
    cutoff: value => `${Math.round(value)} Hz`,
    decay: value => `${Number(value).toFixed(2)} s`,
    rate: value => `${Number(value).toFixed(1)} Hz`,
    depth: value => `${Math.round(value * 100)}%`,
    gain: value => `${Math.round(value * 100)}%`,
    cheekClapzSpeed: value => `${Number(value).toFixed(1)} Hz`,
    sphincterShift: value => {
      if (Math.abs(value) < 0.02) return 'neutral';
      const label = value < 0 ? 'dive' : 'whistle';
      return `${label} ${Math.round(Math.abs(value) * 100)}%`;
    }
  };

  // Keep slider values inside the same bounds used by the HTML controls and
  // by settings restored from a shared URL.
  function clamp(value, [minimum, maximum]) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function cleanSettings(candidate) {
    const clean = {};
    Object.keys(ranges).forEach(name => {
      const value = Number(candidate[name]);
      clean[name] = Number.isFinite(value) ? clamp(value, ranges[name]) : defaults[name];
    });
    clean.cheekClapz = candidate.cheekClapz === true || candidate.cheekClapz === 1 || candidate.cheekClapz === '1';
    return clean;
  }

  // Compact keys and base64url keep the shareable FartID short and URL-safe.
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

  // Reflect the current settings in both the range inputs and their labels.
  function syncControls() {
    Object.keys(controls).forEach(name => {
      controls[name].value = settings[name];
      outputs[name].textContent = formatters[name](settings[name]);
    });
    const cheekClapz = document.getElementById('cheekClapz');
    cheekClapz.checked = settings.cheekClapz;
    document.getElementById('cheekClapzSpeed').disabled = !settings.cheekClapz;
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAMETER, encodeSettings());
    window.history.replaceState({}, '', url);
  }

  async function copyShareUrl() {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PARAMETER, encodeSettings());
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl.toString());
      } else {
        const copyTarget = document.createElement('textarea');
        copyTarget.value = shareUrl.toString();
        copyTarget.setAttribute('readonly', '');
        copyTarget.style.position = 'fixed';
        copyTarget.style.opacity = '0';
        document.body.appendChild(copyTarget);
        copyTarget.select();
        if (!document.execCommand('copy')) throw new Error('Clipboard access was denied.');
        copyTarget.remove();
      }
      setStatus('Share link copied to the clipboard.');
    } catch (error) {
      setStatus('Could not copy the share link.');
    }
  }

  function resetSettings(flatulenceFactory) {
    settings = { ...defaults };
    syncControls();
    updateUrl();
    flatulenceFactory.setGain(settings.gain);
    setStatus('Settings reset to factory defaults.');
  }

  let lungeSide = 'right';

  function triggerLunge() {
    const mascot = document.getElementById('fart-mascot');
    mascot.classList.remove('lunge-left', 'lunge-right');
    void mascot.offsetWidth; // force reflow so the animation restarts if clicked mid-cycle
    mascot.classList.add(lungeSide === 'right' ? 'lunge-right' : 'lunge-left');
    lungeSide = lungeSide === 'right' ? 'left' : 'right';
  }

  function triggerRipple() {
    const ripple = document.getElementById('fart-ripple');
    ripple.classList.remove('is-active');
    void ripple.offsetWidth; // force reflow so the animation restarts if clicked mid-cycle
    ripple.classList.add('is-active');
  }

  function setStatus(message) {
    document.getElementById('status').textContent = message;
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
    if (open) document.getElementById('frequency').focus({ preventScroll: true });
  }

  // The UI reports success or failure; the factory is responsible only for
  // creating and scheduling audio.
  function playFart(flatulenceFactory) {
    try {
      flatulenceFactory.play(settings);
      setStatus('Fart deployed. Adjust the controls and try again.');
    } catch (error) {
      setStatus(error.message || 'Audio could not be started.');
    }
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
    return `Furious_Flatulence-${timestamp}.wav`;
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

  async function stopRecording(flatulenceFactory, reason) {
    if (!recording.active || recording.stopping) return;
    recording.active = false;
    recording.stopping = true;
    clearRecordingTimers();
    updateRecordingButton();
    try {
      const result = await flatulenceFactory.stopCapture();
      if (!recording.sawSignal || !result.samples.length) {
        showRecordingSection(0, 'countdown');
        setStatus(reason === 'manual' ? 'No sound was captured.' : 'No fart signal was captured.');
        return;
      }
      lastBlob = encodeWav(result.samples, result.sampleRate);
      recording.filename = createRecordingFilename();
      if (recording.lastBlobURL) URL.revokeObjectURL(recording.lastBlobURL);
      recording.lastBlobURL = URL.createObjectURL(lastBlob);
      const link = document.getElementById('recording-download');
      link.href = recording.lastBlobURL;
      link.download = recording.filename;
      link.click();
      showRecordingSection(result.samples.length / result.sampleRate);
      setStatus('Fart recording ready to download again.');
    } catch (error) {
      setStatus(error.message || 'The recording could not be saved.');
      showRecordingSection(0, 'countdown');
    } finally {
      recording.stopping = false;
    }
  }

  async function startRecording(flatulenceFactory) {
    if (recording.stopping) {
      setStatus('Finishing the previous recording. Try again in a moment.');
      return;
    }
    // Record doubles as stop: cancel countdown, or end an active/starting session.
    if (recording.active || recording.countingDown) {
      recording.stopRequested = true;
      if (recording.countingDown) {
        recording.countingDown = false;
        clearRecordingTimers();
        updateRecordingButton();
        setStatus('Recording cancelled.');
      } else if (!recording.starting) {
        await stopRecording(flatulenceFactory, 'manual');
      }
      // While startCapture is in flight, stopRequested is honored when it resolves.
      return;
    }
    recording.countingDown = true;
    recording.stopRequested = false;
    updateRecordingButton();
    showRecordingSection(0, 'countdown');
    setStatus('Recording starts in 2 seconds.');
    recording.countdownTimer = window.setTimeout(() => beginRecording(flatulenceFactory), 2000);
  }

  async function beginRecording(flatulenceFactory) {
    recording.countingDown = false;
    recording.active = true;
    recording.starting = true;
    recording.sawSignal = false;
    recording.silenceStarted = 0;
    updateRecordingButton();
    showRecordingSection(0, 'active');
    try {
      await flatulenceFactory.startCapture(settings.gain);
      // Clear starting before the stop check so a mid-start Record press cannot
      // race past stopRequested and leave capture running without a stop path.
      recording.starting = false;
      if (recording.stopRequested) {
        await stopRecording(flatulenceFactory, 'manual');
        return;
      }
      recording.maxTimer = window.setTimeout(() => stopRecording(flatulenceFactory, 'maximum'), RECORDING_MAX_MS);
      recording.rmsTimer = window.setInterval(() => {
        const rms = flatulenceFactory.getRMS();
        if (rms >= 0.01) {
          recording.sawSignal = true;
          recording.silenceStarted = 0;
        } else if (recording.sawSignal) {
          if (!recording.silenceStarted) recording.silenceStarted = Date.now();
          if (Date.now() - recording.silenceStarted >= SILENCE_STOP_MS) stopRecording(flatulenceFactory, 'silence');
        }
      }, 50);
      setStatus('Recording armed. Press FART to capture the evidence.');
    } catch (error) {
      clearRecordingTimers();
      await flatulenceFactory.stopCapture().catch(() => {});
      recording.active = false;
      recording.starting = false;
      updateRecordingButton();
      showRecordingSection(0, 'countdown');
      setStatus(error.message || 'WAV recording could not be started.');
    }
  }

  function initialize() {
    // Factory creation is inexpensive and does not start audio. The audio
    // context itself is still created lazily on the first FART press.
    const flatulenceFactory = window.createFlatulenceFactory();
    Object.keys(ranges).forEach(name => {
      controls[name] = document.getElementById(name);
      outputs[name] = document.getElementById(`${name}-value`);
      controls[name].addEventListener('input', event => {
        settings[name] = clamp(Number(event.target.value), ranges[name]);
        outputs[name].textContent = formatters[name](settings[name]);
        updateUrl();
        if (name === 'gain') flatulenceFactory.setGain(settings.gain);
      });
    });

    const cheekClapz = document.getElementById('cheekClapz');
    cheekClapz.addEventListener('change', event => {
      settings.cheekClapz = event.target.checked;
      document.getElementById('cheekClapzSpeed').disabled = !settings.cheekClapz;
      updateUrl();
    });

    // Restore shared settings before the controls are synchronized.
    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That FartID was not recognized; defaults loaded.');
    }
    syncControls();
    document.getElementById('fart-button').addEventListener('click', () => {
      triggerLunge();
      triggerRipple();
      playFart(flatulenceFactory);
    });
    document.getElementById('record-button').addEventListener('click', () => startRecording(flatulenceFactory));
    document.getElementById('share-button').addEventListener('click', copyShareUrl);
    document.getElementById('advanced-toggle').addEventListener('click', () => togglePanel(true));
    document.getElementById('reset-settings').addEventListener('click', () => resetSettings(flatulenceFactory));
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

  // Deferred scripts normally run before DOMContentLoaded, but initialize
  // immediately when this file is loaded after that event has already fired.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
