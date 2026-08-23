/*
 * The Fart instrument for the FART-O-IZER 6000 lab.
 * (The original sin — now packaged for polite multi-instrument society.)
 *
 * Owns the FART play surface, McButtface mascot theatrics, settings model,
 * FartID URL sharing, and wiring to the Flatulence Factory. The lab shell in
 * app.js mounts this instrument and talks to it through a small plug-in API:
 * mount, getAudio, share, reset, getGain, onPanelOpen.
 *
 * Boot flow (called by app.js):
 *   FartInstrument.mount(shellApi)
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
  // defaults/ranges mirror the HTML range inputs. keys maps each setting to a
  // single-letter key in the shareable FartID payload — compact, like pocket air.
  const ID = 'fart';
  const DISPLAY_NAME = 'Fart';
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
  let flatulenceFactory;
  let setStatus = () => {};

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

  async function share() {
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

  // --- Mascot and ripple (McButtface does the heavy lifting) ---
  // Alternates left/right lunges — switch cheeks, switch sides, switch allegiances.
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

  // --- FART press-and-hold (commit when ready, release when brave) ---
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

  // Ignore stray pointerup — wrong finger, wrong cheek, wrong life choice.
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

  // --- Mount (plug the Fart into the lab shell) ---
  function mount(shellApi) {
    setStatus = shellApi.setStatus;
    flatulenceFactory = window.createFlatulenceFactory();

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
      beginHold(fartButton, event.pointerId);
    });
    fartButton.addEventListener('pointerup', event => {
      if (fartButton.hasPointerCapture(event.pointerId)) fartButton.releasePointerCapture(event.pointerId);
      endHold(fartButton, event.pointerId);
    });
    fartButton.addEventListener('pointercancel', event => endHold(fartButton, event.pointerId));
    fartButton.addEventListener('lostpointercapture', event => endHold(fartButton, event.pointerId));
    fartButton.addEventListener('keydown', event => {
      if (event.repeat) return;
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      beginHold(fartButton);
    });
    fartButton.addEventListener('keyup', event => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      event.preventDefault();
      endHold(fartButton);
    });
  }

  function getAudio() {
    return flatulenceFactory;
  }

  window.FartInstrument = {
    id: ID,
    displayName: DISPLAY_NAME,
    mount,
    getAudio,
    share,
    reset,
    getGain,
    getSettings,
    onPanelOpen
  };
})();
