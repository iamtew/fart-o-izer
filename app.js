/*
 * UI controller for the FART-O-IZER 6000.
 * Front-of-house operations: buttons, sliders, and socially unacceptable sharing.
 *
 * Owns application state, DOM wiring, visual feedback, URL sharing (FartID),
 * and WAV recording orchestration. All audio synthesis lives in
 * flatulence_factory.js; this file talks to it only through the small factory
 * API (start, stop, setGain, startCapture, getRMS, stopCapture).
 *
 * Boot flow:
 *   initialize()
 *     → createFlatulenceFactory()
 *     → wire range inputs and buttons
 *     → decode ?FartID= from the URL (if present) into settings
 *     → syncControls() to reflect settings in the DOM
 *     → attach FART hold/release, record, share, and panel handlers
 *
 * Runtime flow:
 *   Slider change → update settings + URL + (gain) live audio
 *   FART press    → beginHold → factory.start(settings) + mascot/ripple
 *   FART release  → endHold   → factory.stop() + mascot return
 *   Record        → countdown → capture tap → auto-stop on silence/max → WAV download
 *
 * Remember: he who smelt it, dealt it — but he who shared the FartID, shared it.
 */
(() => {
  'use strict';

  // --- Settings model (the recipe card for each toot) ---
  // defaults/ranges mirror the HTML range inputs. keys maps each setting to a
  // single-letter key in the shareable FartID payload — compact, like pocket air.
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

  // --- Recording state (the black box flight recorder for gas) ---
  const RECORDING_MAX_MS = 60000;
  const SILENCE_STOP_MS = 1000;
  const recording = {
    active: false, countingDown: false, starting: false, stopRequested: false, sawSignal: false,
    silenceStarted: 0, maxTimer: null, rmsTimer: null, countdownTimer: null, lastBlobURL: null, filename: '', stopping: false
  };
  let lastBlob;

  // Labels beside sliders — so users know exactly how offensive they're being.
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

  // Clamp values — even creativity has a ceiling (and a floor).
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

  // --- FartID sharing (send your masterpiece to innocent bystanders) ---
  // Compact keys and base64url — short enough to slip into a group chat unnoticed. Almost.
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

  // --- UI sync (make the knobs match the crime) ---
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

  // --- Mascot and ripple (McButtface does the heavy lifting) ---
  // Alternates left/right lunges — switch cheeks, switch sides, switch allegiances.
  let lungeSide = 'right';

  function clearMascotAnimation(mascot) {
    mascot.classList.remove('lunge-out-left', 'lunge-out-right', 'jiggle-left', 'jiggle-right');
    mascot.style.transform = '';
  }

  function beginMascotHold() {
    const mascot = document.getElementById('fart-mascot');
    clearMascotAnimation(mascot);
    void mascot.offsetWidth; // reflow — restart animation, don't stall mid-lunge
    const side = lungeSide;
    lungeSide = lungeSide === 'right' ? 'left' : 'right';
    const outClass = side === 'right' ? 'lunge-out-right' : 'lunge-out-left';
    const jiggleClass = side === 'right' ? 'jiggle-right' : 'jiggle-left';
    mascot.classList.add(outClass);
    mascot.addEventListener('animationend', function onLungeOut(event) {
      if (event.target !== mascot) return;
      if (!event.animationName.startsWith('fart-lunge-out-')) return;
      if (!isHolding) return;
      mascot.classList.remove(outClass);
      mascot.classList.add(jiggleClass);
    }, { once: true });
  }

  // Return McButtface to center — the walk of shame, animated smoothly.
  function endMascotHold() {
    const mascot = document.getElementById('fart-mascot');
    const matrix = new DOMMatrix(getComputedStyle(mascot).transform);
    const { m41: x, m42: y } = matrix;
    clearMascotAnimation(mascot);
    if (x === 0 && y === 0) return;
    mascot.style.transform = `translate(${x}px, ${y}px)`;
    mascot.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: 'translate(0, 0)' }
    ], { duration: 260, easing: 'ease-in' }).onfinish = () => {
      mascot.style.transform = '';
    };
  }

  function triggerRipple() {
    const ripple = document.getElementById('fart-ripple');
    ripple.classList.remove('is-active');
    void ripple.offsetWidth; // reflow — every press deserves a fresh shockwave
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

  // --- FART press-and-hold (commit when ready, release when brave) ---
  let isHolding = false;
  let activePointerId = null;

  function beginHold(flatulenceFactory, fartButton, pointerId = null) {
    if (isHolding) return;
    isHolding = true;
    activePointerId = pointerId;
    fartButton.classList.add('is-held');
    triggerRipple();
    beginMascotHold();
    try {
      flatulenceFactory.start(settings);
      setStatus('Hold for a long one…');
    } catch (error) {
      isHolding = false;
      activePointerId = null;
      fartButton.classList.remove('is-held');
      endMascotHold();
      setStatus(error.message || 'Audio could not be started.');
    }
  }

  // Ignore stray pointerup — wrong finger, wrong cheek, wrong life choice.
  function endHold(flatulenceFactory, fartButton, pointerId = null) {
    if (!isHolding) return;
    if (pointerId !== null && activePointerId !== null && pointerId !== activePointerId) return;
    isHolding = false;
    activePointerId = null;
    fartButton.classList.remove('is-held');
    endMascotHold();
    flatulenceFactory.stop();
    setStatus('Fart deployed. Adjust the controls and try again.');
  }

  // --- WAV export (bottling the atmosphere for posterity) ---
  function writeString(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  }

  // Hand-rolled RIFF writer — no npm, no dependencies, no dignity either.
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

  // Record button: start, stop, or chicken out during the countdown.
  async function startRecording(flatulenceFactory) {
    if (recording.stopping) {
      setStatus('Finishing the previous recording. Try again in a moment.');
      return;
    }
    // Record doubles as stop — same button, different levels of regret.
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
      // Race guard — don't leave the recorder running with no way to pull the chain.
      recording.starting = false;
      if (recording.stopRequested) {
        await stopRecording(flatulenceFactory, 'manual');
        return;
      }
      recording.maxTimer = window.setTimeout(() => stopRecording(flatulenceFactory, 'maximum'), RECORDING_MAX_MS);
      // Poll RMS — auto-stop when the room has aired out (1s of silence).
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

  // --- Initialization (open the stall, wire the throne) ---
  function initialize() {
    // Factory is cheap to create; actual audio waits for the first brave press.
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

    // Restore shared FartID — inherit someone else's gas legacy.
    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That FartID was not recognized; defaults loaded.');
    }
    syncControls();
    const fartButton = document.getElementById('fart-button');
    // Pointer capture — hold stays engaged even if you scurry off the button.
    fartButton.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      fartButton.setPointerCapture(event.pointerId);
      beginHold(flatulenceFactory, fartButton, event.pointerId);
    });
    fartButton.addEventListener('pointerup', event => {
      if (fartButton.hasPointerCapture(event.pointerId)) fartButton.releasePointerCapture(event.pointerId);
      endHold(flatulenceFactory, fartButton, event.pointerId);
    });
    fartButton.addEventListener('pointercancel', event => endHold(flatulenceFactory, fartButton, event.pointerId));
    fartButton.addEventListener('lostpointercapture', event => endHold(flatulenceFactory, fartButton, event.pointerId));
    fartButton.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      beginHold(flatulenceFactory, fartButton);
    });
    fartButton.addEventListener('keyup', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      endHold(flatulenceFactory, fartButton);
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

  // DOM ready check — don't leave users waiting with unpressed potential.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
