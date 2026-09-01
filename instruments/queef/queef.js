/*
 * The Queef instrument for the FART-O-IZER 6000 lab.
 * A brighter, more melodic cousin of Fart — higher pitch, softer texture,
 * vibrato and phrase drift. Owns play surface, settings, QueefID sharing,
 * and wiring to the Queef Factory audio engine.
 *
 * Boot flow (called by app.js):
 *   QueefInstrument.mount(shellApi)
 *     → inject stage + control markup
 *     → createQueefFactory()
 *     → wire controls, decode ?QueefID=, attach QUEEF hold/release
 *
 * Runtime flow:
 *   Slider change  → update settings + URL + (gain) live audio
 *   Waveform pick  → update settings + URL (applies on next hold)
 *   QUEEF press    → beginHold → factory.start(settings) + mascot/ripple
 *   QUEEF release → endHold   → factory.stop() + mascot return
 *   Share button  → shell calls share() → copy ?instrument=queef&QueefID= URL
 */
(() => {
  'use strict';

  const ID = 'queef';
  const DISPLAY_NAME = 'Queef';
  const PARAMETER = 'QueefID';
  const PLAY_ACTION_LABEL = 'QUEEF';
  const RECORDING_TITLE = 'Queef Recording';
  const VERSION = 1;
  const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'];
  const defaults = {
    frequency: 220, noise: 0.18, cutoff: 1600, resonance: 3.8, decay: 0.55, rate: 6.5, depth: 0.38,
    phraseRate: 0.65, phraseDepth: 0.42, gain: 0.5, waveform: 'triangle',
    flutterGate: false, flutterGateSpeed: 6, pitchGlide: 0.15
  };
  const ranges = {
    frequency: [140, 380], noise: [0, 1], cutoff: [800, 3200], resonance: [0.5, 12], decay: [0.15, 1.2],
    rate: [4, 10], depth: [0, 1], phraseRate: [0.3, 1.2], phraseDepth: [0, 1],
    gain: [0.15, 0.8], flutterGateSpeed: [2, 18], pitchGlide: [-1, 1]
  };
  const keys = {
    frequency: 'f', noise: 'n', cutoff: 'c', resonance: 'q', decay: 'd', rate: 'r', depth: 'l',
    phraseRate: 'a', phraseDepth: 'b', gain: 'g', waveform: 'w',
    flutterGate: 'z', flutterGateSpeed: 's', pitchGlide: 'p'
  };
  const controls = {};
  const outputs = {};
  let settings = { ...defaults };
  let queefFactory;
  let setStatus = () => {};
  let mountAbort = null;

  const formatters = {
    frequency: value => `${Math.round(value)} Hz`,
    noise: value => `${Math.round(value * 100)}%`,
    cutoff: value => `${Math.round(value)} Hz`,
    resonance: value => Number(value).toFixed(1),
    decay: value => `${Number(value).toFixed(2)} s`,
    rate: value => `${Number(value).toFixed(1)} Hz`,
    depth: value => `${Math.round(value * 100)}%`,
    phraseRate: value => `${Number(value).toFixed(2)} Hz`,
    phraseDepth: value => `${Math.round(value * 100)}%`,
    gain: value => `${Math.round(value * 100)}%`,
    flutterGateSpeed: value => `${Number(value).toFixed(1)} Hz`,
    pitchGlide: value => {
      if (Math.abs(value) < 0.02) return 'neutral';
      const label = value < 0 ? 'dip' : 'rise';
      return `${label} ${Math.round(Math.abs(value) * 100)}%`;
    }
  };

  function clamp(value, [minimum, maximum]) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function cleanSettings(candidate) {
    const clean = {};
    Object.keys(ranges).forEach(name => {
      const value = Number(candidate[name]);
      clean[name] = Number.isFinite(value) ? clamp(value, ranges[name]) : defaults[name];
    });
    clean.flutterGate = candidate.flutterGate === true || candidate.flutterGate === 1 || candidate.flutterGate === '1';
    clean.waveform = WAVEFORMS.includes(candidate.waveform) ? candidate.waveform : defaults.waveform;
    return clean;
  }

  function renderStage() {
    return `
      <div class="console-copy">
        <p class="section-label" id="action-title">Ready when you are</p>
        <p class="hint">Press and hold for a melodic tone.</p>
      </div>
      <button class="queef-button" id="queef-button" type="button" aria-label="Press and hold to play queef sound">
        <span class="button-ring" aria-hidden="true"></span>
        <span class="button-ripple" id="queef-ripple" aria-hidden="true"></span>
        <img class="queef-mascot" id="queef-mascot" src="img/QueenQueef.png" alt="" aria-hidden="true">
      </button>
    `;
  }

  function renderControls() {
    return `
      <label class="control" for="frequency">
        <span class="control-heading"><span>Brightness</span><output id="frequency-value" for="frequency"></output></span>
        <span class="control-description">Oscillator frequency</span>
        <input id="frequency" type="range" min="140" max="380" step="1" value="220">
      </label>
      <div class="control control-waveform">
        <span class="control-heading"><span>Waveform</span></span>
        <span class="control-description">Body oscillator shape</span>
        <div class="waveform-picker" role="radiogroup" aria-label="Waveform">
          <button class="waveform-picker-button" type="button" role="radio" data-waveform="sine" aria-checked="false">Sine</button>
          <button class="waveform-picker-button is-selected" type="button" role="radio" data-waveform="triangle" aria-checked="true">Triangle</button>
          <button class="waveform-picker-button" type="button" role="radio" data-waveform="sawtooth" aria-checked="false">Saw</button>
          <button class="waveform-picker-button" type="button" role="radio" data-waveform="square" aria-checked="false">Square</button>
        </div>
      </div>
      <label class="control" for="noise">
        <span class="control-heading"><span>Pink noise</span><output id="noise-value" for="noise"></output></span>
        <span class="control-description">Soft airy texture blend</span>
        <input id="noise" type="range" min="0" max="1" step="0.01" value="0.18">
      </label>
      <label class="control" for="cutoff">
        <span class="control-heading"><span>Filter cutoff</span><output id="cutoff-value" for="cutoff"></output></span>
        <span class="control-description">Bandpass filter cutoff frequency</span>
        <input id="cutoff" type="range" min="800" max="3200" step="10" value="1600">
      </label>
      <label class="control" for="resonance">
        <span class="control-heading"><span>Resonance</span><output id="resonance-value" for="resonance"></output></span>
        <span class="control-description">Bandpass filter sharpness (Q)</span>
        <input id="resonance" type="range" min="0.5" max="12" step="0.1" value="3.8">
      </label>
      <label class="control" for="decay">
        <span class="control-heading"><span>Release</span><output id="decay-value" for="decay"></output></span>
        <span class="control-description">Envelope release time</span>
        <input id="decay" type="range" min="0.15" max="1.2" step="0.01" value="0.55">
      </label>
      <label class="control" for="rate">
        <span class="control-heading"><span>Vibrato rate</span><output id="rate-value" for="rate"></output></span>
        <span class="control-description">Pitch vibrato speed</span>
        <input id="rate" type="range" min="4" max="10" step="0.1" value="6.5">
      </label>
      <label class="control" for="depth">
        <span class="control-heading"><span>Vibrato depth</span><output id="depth-value" for="depth"></output></span>
        <span class="control-description">Pitch vibrato amount</span>
        <input id="depth" type="range" min="0" max="1" step="0.01" value="0.38">
      </label>
      <label class="control" for="phraseRate">
        <span class="control-heading"><span>Phrase rate</span><output id="phraseRate-value" for="phraseRate"></output></span>
        <span class="control-description">Slow melodic drift speed</span>
        <input id="phraseRate" type="range" min="0.3" max="1.2" step="0.01" value="0.65">
      </label>
      <label class="control" for="phraseDepth">
        <span class="control-heading"><span>Phrase depth</span><output id="phraseDepth-value" for="phraseDepth"></output></span>
        <span class="control-description">Slow melodic drift amount</span>
        <input id="phraseDepth" type="range" min="0" max="1" step="0.01" value="0.42">
      </label>
      <label class="control" for="gain">
        <span class="control-heading"><span>Master gain</span><output id="gain-value" for="gain"></output></span>
        <span class="control-description">Master output gain</span>
        <input id="gain" type="range" min="0.15" max="0.8" step="0.01" value="0.5">
      </label>
      <div class="control control-effect">
        <span class="control-heading">
          <label class="control-toggle" for="flutterGate">
            <input id="flutterGate" type="checkbox">
            <span>Flutter Gate</span>
          </label>
          <output id="flutterGateSpeed-value" for="flutterGateSpeed"></output>
        </span>
        <span class="control-description">Soft tremolo gate · gate rate</span>
        <input id="flutterGateSpeed" type="range" min="2" max="18" step="0.5" value="6" aria-label="Gate rate">
      </div>
      <label class="control control-effect" for="pitchGlide">
        <span class="control-heading"><span>Pitch Glide</span><output id="pitchGlide-value" for="pitchGlide"></output></span>
        <span class="control-description">Pitch sweep (frequency glide)</span>
        <input id="pitchGlide" class="bipolar" type="range" min="-1" max="1" step="0.01" value="0.15">
      </label>
    `;
  }

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

  function syncWaveformPicker() {
    document.querySelectorAll('.waveform-picker-button').forEach(button => {
      const selected = button.dataset.waveform === settings.waveform;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
  }

  function syncControls() {
    Object.keys(controls).forEach(name => {
      controls[name].value = settings[name];
      outputs[name].textContent = formatters[name](settings[name]);
    });
    const flutterGate = document.getElementById('flutterGate');
    if (flutterGate) {
      flutterGate.checked = settings.flutterGate;
      document.getElementById('flutterGateSpeed').disabled = !settings.flutterGate;
    }
    syncWaveformPicker();
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('instrument', ID);
    url.searchParams.set(PARAMETER, encodeSettings());
    window.history.replaceState({}, '', url);
  }

  async function share() {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('instrument', ID);
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

  function reset() {
    settings = { ...defaults };
    syncControls();
    updateUrl();
    queefFactory.setGain(settings.gain);
    setStatus('Settings reset to factory defaults.');
  }

  function getGain() {
    return settings.gain;
  }

  function getSettings() {
    return { ...settings };
  }

  let lungeSide = 'right';
  let isHolding = false;
  let activePointerId = null;

  function clearMascotAnimation(mascot) {
    mascot.classList.remove('lunge-out-left', 'lunge-out-right', 'jiggle-left', 'jiggle-right');
    mascot.style.transform = '';
  }

  function beginMascotHold() {
    const mascot = document.getElementById('queef-mascot');
    clearMascotAnimation(mascot);
    void mascot.offsetWidth;
    const side = lungeSide;
    lungeSide = lungeSide === 'right' ? 'left' : 'right';
    const outClass = side === 'right' ? 'lunge-out-right' : 'lunge-out-left';
    const jiggleClass = side === 'right' ? 'jiggle-right' : 'jiggle-left';
    mascot.classList.add(outClass);
    mascot.addEventListener('animationend', function onLungeOut(event) {
      if (event.target !== mascot) return;
      if (!event.animationName.startsWith('queef-lunge-out-')) return;
      if (!isHolding) return;
      mascot.classList.remove(outClass);
      mascot.classList.add(jiggleClass);
    }, { once: true });
  }

  function endMascotHold() {
    const mascot = document.getElementById('queef-mascot');
    if (!mascot) return;
    const matrix = new DOMMatrix(getComputedStyle(mascot).transform);
    const { m41: x, m42: y } = matrix;
    clearMascotAnimation(mascot);
    if (x === 0 && y === 0) return;
    mascot.style.transform = `translate(${x}px, ${y}px)`;
    mascot.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: 'translate(0, 0)' }
    ], { duration: 300, easing: 'ease-in' }).onfinish = () => {
      mascot.style.transform = '';
    };
  }

  function triggerRipple() {
    const ripple = document.getElementById('queef-ripple');
    ripple.classList.remove('is-active');
    void ripple.offsetWidth;
    ripple.classList.add('is-active');
  }

  function beginHold(queefButton, pointerId = null) {
    if (isHolding) return;
    isHolding = true;
    activePointerId = pointerId;
    queefButton.classList.add('is-held');
    triggerRipple();
    beginMascotHold();
    try {
      queefFactory.start(settings);
      setStatus('Hold for a melodic tone…');
    } catch (error) {
      isHolding = false;
      activePointerId = null;
      queefButton.classList.remove('is-held');
      endMascotHold();
      setStatus(error.message || 'Audio could not be started.');
    }
  }

  function endHold(queefButton, pointerId = null) {
    if (!isHolding) return;
    if (pointerId !== null && activePointerId !== null && pointerId !== activePointerId) return;
    isHolding = false;
    activePointerId = null;
    queefButton.classList.remove('is-held');
    endMascotHold();
    queefFactory.stop();
    setStatus('Queef deployed. Adjust the controls and try again.');
  }

  function onPanelOpen() {
    document.getElementById('frequency').focus({ preventScroll: true });
  }

  function mount(shellApi) {
    setStatus = shellApi.setStatus;
    mountAbort = new AbortController();
    const { signal } = mountAbort;

    document.getElementById('instrument-stage').innerHTML = renderStage();
    document.getElementById('instrument-controls').innerHTML = renderControls();

    queefFactory = window.createQueefFactory();
    Object.keys(controls).forEach(name => { delete controls[name]; delete outputs[name]; });

    Object.keys(ranges).forEach(name => {
      controls[name] = document.getElementById(name);
      outputs[name] = document.getElementById(`${name}-value`);
      controls[name].addEventListener('input', event => {
        settings[name] = clamp(Number(event.target.value), ranges[name]);
        outputs[name].textContent = formatters[name](settings[name]);
        updateUrl();
        if (name === 'gain') queefFactory.setGain(settings.gain);
      }, { signal });
    });

    const flutterGate = document.getElementById('flutterGate');
    flutterGate.addEventListener('change', event => {
      settings.flutterGate = event.target.checked;
      document.getElementById('flutterGateSpeed').disabled = !settings.flutterGate;
      updateUrl();
    }, { signal });

    document.querySelectorAll('.waveform-picker-button').forEach(button => {
      button.addEventListener('click', () => {
        const waveform = button.dataset.waveform;
        if (!WAVEFORMS.includes(waveform) || settings.waveform === waveform) return;
        settings.waveform = waveform;
        syncWaveformPicker();
        updateUrl();
      }, { signal });
    });

    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That QueefID was not recognized; defaults loaded.');
    }
    syncControls();

    const queefButton = document.getElementById('queef-button');
    queefButton.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      queefButton.setPointerCapture(event.pointerId);
      beginHold(queefButton, event.pointerId);
    }, { signal });
    queefButton.addEventListener('pointerup', event => {
      if (queefButton.hasPointerCapture(event.pointerId)) queefButton.releasePointerCapture(event.pointerId);
      endHold(queefButton, event.pointerId);
    }, { signal });
    queefButton.addEventListener('pointercancel', event => endHold(queefButton, event.pointerId), { signal });
    queefButton.addEventListener('lostpointercapture', event => endHold(queefButton, event.pointerId), { signal });
    queefButton.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      beginHold(queefButton);
    }, { signal });
    queefButton.addEventListener('keyup', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      endHold(queefButton);
    }, { signal });
  }

  function unmount() {
    if (isHolding && queefFactory) queefFactory.stop();
    isHolding = false;
    activePointerId = null;
    if (mountAbort) {
      mountAbort.abort();
      mountAbort = null;
    }
    Object.keys(controls).forEach(name => { delete controls[name]; delete outputs[name]; });
    document.getElementById('instrument-stage').innerHTML = '';
    document.getElementById('instrument-controls').innerHTML = '';
  }

  function getAudio() {
    return queefFactory;
  }

  window.QueefInstrument = {
    id: ID,
    displayName: DISPLAY_NAME,
    playActionLabel: PLAY_ACTION_LABEL,
    shareParameter: PARAMETER,
    recordingTitle: RECORDING_TITLE,
    mount,
    unmount,
    getAudio,
    share,
    reset,
    getGain,
    getSettings,
    onPanelOpen
  };
})();
