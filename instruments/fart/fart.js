/*
 * The Fart instrument for the FART-O-IZER 6000 lab.
 * (The original sin — now packaged for polite multi-instrument society.)
 *
 * Owns the FART play surface, McButtface mascot theatrics, settings model,
 * FartID URL sharing, and wiring to the Flatulence Factory. The lab shell in
 * app.js mounts this instrument and talks to it through a small plug-in API:
 * mount, unmount, getAudio, share, reset, getGain, onPanelOpen.
 *
 * Boot flow (called by app.js):
 *   FartInstrument.mount(shellApi)
 *     → inject stage + control markup
 *     → createFlatulenceFactory()
 *     → wire range inputs inside #instrument-controls
 *     → decode ?FartID= from the URL (if present)
 *     → attach FART hold/release on #fart-button
 *
 * Runtime flow:
 *   Slider change → update settings + URL + (gain) live audio
 *   FART press    → beginHold → factory.start(settings) + mascot/ripple
 *   FART release  → endHold   → factory.stop() + mascot return
 *   Share button  → shell calls share() → copy ?FartID= URL
 *
 * He who smelt it, dealt it — but he who shared the FartID, shared it.
 */
(() => {
  'use strict';

  // --- Settings model (the recipe card for each toot) ---
  const ID = 'fart';
  const DISPLAY_NAME = 'Fart';
  const PARAMETER = 'FartID';
  const PLAY_ACTION_LABEL = 'FART';
  const RECORDING_TITLE = 'Fart Recording';
  const VERSION = 1;
  const defaults = {
    frequency: 58, noise: 0.42, cutoff: 720, resonance: 2.5, decay: 0.62, rate: 4.2, depth: 0.32, gain: 0.48,
    cheekClapz: false, cheekClapzSpeed: 8, sphincterShift: 0
  };
  const ranges = {
    frequency: [35, 110], noise: [0, 1], cutoff: [180, 1800], resonance: [0.5, 12], decay: [0.18, 1.4],
    rate: [1, 12], depth: [0, 1], gain: [0.15, 0.8],
    cheekClapzSpeed: [2, 24], sphincterShift: [-1, 1]
  };
  const keys = {
    frequency: 'f', noise: 'n', cutoff: 'c', resonance: 'q', decay: 'd', rate: 'r', depth: 'l', gain: 'g',
    cheekClapz: 'z', cheekClapzSpeed: 's', sphincterShift: 'p'
  };
  const controls = {};
  const outputs = {};
  let settings = { ...defaults };
  let flatulenceFactory;
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
    gain: value => `${Math.round(value * 100)}%`,
    cheekClapzSpeed: value => `${Number(value).toFixed(1)} Hz`,
    sphincterShift: value => {
      if (Math.abs(value) < 0.02) return 'neutral';
      const label = value < 0 ? 'dive' : 'whistle';
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
    clean.cheekClapz = candidate.cheekClapz === true || candidate.cheekClapz === 1 || candidate.cheekClapz === '1';
    return clean;
  }

  function renderStage() {
    return `
      <div class="console-copy">
        <p class="section-label" id="action-title">Ready when you are</p>
        <p class="hint">Press and hold for a long one.</p>
      </div>
      <button class="fart-button" id="fart-button" type="button" aria-label="Press and hold to play fart sound">
        <span class="button-ring" aria-hidden="true"></span>
        <span class="button-ripple" id="fart-ripple" aria-hidden="true"></span>
        <img class="fart-mascot" id="fart-mascot" src="img/McButtface.png" alt="" aria-hidden="true">
      </button>
    `;
  }

  function renderControls() {
    return `
      <label class="control" for="frequency">
        <span class="control-heading"><span>Bassiness</span><output id="frequency-value" for="frequency"></output></span>
        <span class="control-description">Oscillator frequency</span>
        <input id="frequency" type="range" min="35" max="110" step="1" value="58">
      </label>
      <label class="control" for="noise">
        <span class="control-heading"><span>Splatter</span><output id="noise-value" for="noise"></output></span>
        <span class="control-description">Noise amount</span>
        <input id="noise" type="range" min="0" max="1" step="0.01" value="0.42">
      </label>
      <label class="control" for="cutoff">
        <span class="control-heading"><span>Filter cutoff</span><output id="cutoff-value" for="cutoff"></output></span>
        <span class="control-description">Lowpass filter cutoff frequency</span>
        <input id="cutoff" type="range" min="180" max="1800" step="10" value="720">
      </label>
      <label class="control" for="resonance">
        <span class="control-heading"><span>Resonance</span><output id="resonance-value" for="resonance"></output></span>
        <span class="control-description">Lowpass filter sharpness (Q)</span>
        <input id="resonance" type="range" min="0.5" max="12" step="0.1" value="2.5">
      </label>
      <label class="control" for="decay">
        <span class="control-heading"><span>Release</span><output id="decay-value" for="decay"></output></span>
        <span class="control-description">Envelope release time</span>
        <input id="decay" type="range" min="0.18" max="1.4" step="0.01" value="0.62">
      </label>
      <label class="control" for="rate">
        <span class="control-heading"><span>Rumble rate</span><output id="rate-value" for="rate"></output></span>
        <span class="control-description">LFO rate</span>
        <input id="rate" type="range" min="1" max="12" step="0.1" value="4.2">
      </label>
      <label class="control" for="depth">
        <span class="control-heading"><span>Rumble depth</span><output id="depth-value" for="depth"></output></span>
        <span class="control-description">LFO depth (pitch detune)</span>
        <input id="depth" type="range" min="0" max="1" step="0.01" value="0.32">
      </label>
      <label class="control" for="gain">
        <span class="control-heading"><span>Master gain</span><output id="gain-value" for="gain"></output></span>
        <span class="control-description">Master output gain</span>
        <input id="gain" type="range" min="0.15" max="0.8" step="0.01" value="0.48">
      </label>
      <div class="control control-effect">
        <span class="control-heading">
          <label class="control-toggle" for="cheekClapz">
            <input id="cheekClapz" type="checkbox">
            <span>Cheek Clapz</span>
          </label>
          <output id="cheekClapzSpeed-value" for="cheekClapzSpeed"></output>
        </span>
        <span class="control-description">Output gate stutter · gate rate</span>
        <input id="cheekClapzSpeed" type="range" min="2" max="24" step="0.5" value="8" aria-label="Gate rate">
      </div>
      <label class="control control-effect" for="sphincterShift">
        <span class="control-heading"><span>Sphincter Shift</span><output id="sphincterShift-value" for="sphincterShift"></output></span>
        <span class="control-description">Pitch sweep (frequency glide)</span>
        <input id="sphincterShift" class="bipolar" type="range" min="-1" max="1" step="0.01" value="0">
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

  function syncControls() {
    Object.keys(controls).forEach(name => {
      controls[name].value = settings[name];
      outputs[name].textContent = formatters[name](settings[name]);
    });
    const cheekClapz = document.getElementById('cheekClapz');
    if (cheekClapz) {
      cheekClapz.checked = settings.cheekClapz;
      document.getElementById('cheekClapzSpeed').disabled = !settings.cheekClapz;
    }
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAMETER, encodeSettings());
    window.history.replaceState({}, '', url);
  }

  async function share() {
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set(PARAMETER, encodeSettings());
    shareUrl.searchParams.delete('instrument');
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
    flatulenceFactory.setGain(settings.gain);
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
    const mascot = document.getElementById('fart-mascot');
    clearMascotAnimation(mascot);
    void mascot.offsetWidth;
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

  function endMascotHold() {
    const mascot = document.getElementById('fart-mascot');
    if (!mascot) return;
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
    void ripple.offsetWidth;
    ripple.classList.add('is-active');
  }

  function beginHold(fartButton, pointerId = null) {
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

  function endHold(fartButton, pointerId = null) {
    if (!isHolding) return;
    if (pointerId !== null && activePointerId !== null && pointerId !== activePointerId) return;
    isHolding = false;
    activePointerId = null;
    fartButton.classList.remove('is-held');
    endMascotHold();
    flatulenceFactory.stop();
    setStatus('Fart deployed. Adjust the controls and try again.');
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

    flatulenceFactory = window.createFlatulenceFactory();
    Object.keys(controls).forEach(name => { delete controls[name]; delete outputs[name]; });

    Object.keys(ranges).forEach(name => {
      controls[name] = document.getElementById(name);
      outputs[name] = document.getElementById(`${name}-value`);
      controls[name].addEventListener('input', event => {
        settings[name] = clamp(Number(event.target.value), ranges[name]);
        outputs[name].textContent = formatters[name](settings[name]);
        updateUrl();
        if (name === 'gain') flatulenceFactory.setGain(settings.gain);
      }, { signal });
    });

    const cheekClapz = document.getElementById('cheekClapz');
    cheekClapz.addEventListener('change', event => {
      settings.cheekClapz = event.target.checked;
      document.getElementById('cheekClapzSpeed').disabled = !settings.cheekClapz;
      updateUrl();
    }, { signal });

    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That FartID was not recognized; defaults loaded.');
    }
    syncControls();

    const fartButton = document.getElementById('fart-button');
    fartButton.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      fartButton.setPointerCapture(event.pointerId);
      beginHold(fartButton, event.pointerId);
    }, { signal });
    fartButton.addEventListener('pointerup', event => {
      if (fartButton.hasPointerCapture(event.pointerId)) fartButton.releasePointerCapture(event.pointerId);
      endHold(fartButton, event.pointerId);
    }, { signal });
    fartButton.addEventListener('pointercancel', event => endHold(fartButton, event.pointerId), { signal });
    fartButton.addEventListener('lostpointercapture', event => endHold(fartButton, event.pointerId), { signal });
    fartButton.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      beginHold(fartButton);
    }, { signal });
    fartButton.addEventListener('keyup', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      endHold(fartButton);
    }, { signal });
  }

  function unmount() {
    if (isHolding && flatulenceFactory) flatulenceFactory.stop();
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
    return flatulenceFactory;
  }

  window.FartInstrument = {
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
