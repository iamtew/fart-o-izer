/*
 * Shell-owned metronome clicks for the record count-in.
 * DAW-style ticks for 4-3-2-1 — never routed through instrument capture.
 *
 * Owns a lazy AudioContext separate from instrument factories so countdown
 * clicks play to speakers only and cannot leak into the PCM capture tap.
 *
 * Boot flow:
 *   index.html loads this before app.js → window.CountdownClicks is ready.
 *
 * Runtime flow:
 *   app.js startCountdown() → beginSession()
 *   each beat            → play({ accent: false })
 *   final GO beat        → play({ accent: true })
 *   cancel / clear timers → invalidate() (bumps session; stale play() calls no-op)
 *
 * Signal chain (per click):
 *   oscillator ──► gain envelope ──► audioContext.destination
 *
 * Exported API:
 *   beginSession()  — start a new count-in session (returns session id)
 *   invalidate()    — cancel pending session (count-in aborted)
 *   play({ accent }) — schedule one short tick; accent = higher/louder GO beat
 */
(() => {
  'use strict';

  const REGULAR = { frequency: 1200, peakGain: 0.3, decay: 0.035 };
  const ACCENT = { frequency: 1800, peakGain: 0.5, decay: 0.055 };
  const ATTACK = 0.003;

  let audioContext;
  let session = 0;

  function ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function beginSession() {
    session += 1;
    return session;
  }

  function invalidate() {
    session += 1;
  }

  function play({ accent = false } = {}) {
    const context = ensureContext();
    if (!context) return;
    const activeSession = session;
    const profile = accent ? ACCENT : REGULAR;
    const start = context.currentTime;
    const peak = start + ATTACK;
    const end = start + profile.decay;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(profile.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(profile.peakGain, peak);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => {
      if (activeSession !== session) return;
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(end + 0.01);
  }

  window.CountdownClicks = { beginSession, invalidate, play };
})();
