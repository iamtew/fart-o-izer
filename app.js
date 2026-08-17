(() => {
  'use strict';

  // app.js owns application state and the interface. Audio implementation is
  // kept in flatulence_factory.js and is accessed through its small API.
  const PARAMETER = 'FartID';
  const VERSION = 1;
  const defaults = { frequency: 58, noise: 0.42, cutoff: 720, decay: 0.62, rate: 4.2, depth: 0.32, gain: 0.48 };
  const ranges = {
    frequency: [35, 110], noise: [0, 1], cutoff: [180, 1800], decay: [0.18, 1.4],
    rate: [1, 12], depth: [0, 1], gain: [0.15, 0.8]
  };
  const keys = { frequency: 'f', noise: 'n', cutoff: 'c', decay: 'd', rate: 'r', depth: 'l', gain: 'g' };
  const controls = {};
  const outputs = {};
  let settings = { ...defaults };

  const formatters = {
    frequency: value => `${Math.round(value)} Hz`,
    noise: value => `${Math.round(value * 100)}%`,
    cutoff: value => `${Math.round(value)} Hz`,
    decay: value => `${Number(value).toFixed(2)} s`,
    rate: value => `${Number(value).toFixed(1)} Hz`,
    depth: value => `${Math.round(value * 100)}%`,
    gain: value => `${Math.round(value * 100)}%`
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

  function setStatus(message) {
    document.getElementById('status').textContent = message;
  }

  function togglePanel(open) {
    const panel = document.getElementById('advanced-panel');
    const toggle = document.getElementById('advanced-toggle');
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
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

    // Restore shared settings before the controls are synchronized.
    const encoded = new URLSearchParams(window.location.search).get(PARAMETER);
    if (encoded) {
      const decoded = decodeSettings(encoded);
      if (decoded) settings = decoded;
      else setStatus('That FartID was not recognized; defaults loaded.');
    }
    syncControls();
    document.getElementById('fart-button').addEventListener('click', () => playFart(flatulenceFactory));
    document.getElementById('share-button').addEventListener('click', copyShareUrl);
    document.getElementById('advanced-toggle').addEventListener('click', () => togglePanel(true));
    document.getElementById('reset-settings').addEventListener('click', () => resetSettings(flatulenceFactory));
    document.getElementById('panel-share-button').addEventListener('click', copyShareUrl);
    document.getElementById('close-panel').addEventListener('click', () => togglePanel(false));
  }

  // Wait for the deferred scripts and document markup before binding controls.
  document.addEventListener('DOMContentLoaded', initialize);
})();
