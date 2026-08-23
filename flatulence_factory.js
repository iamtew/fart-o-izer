/*
 * The brain of the FART-O-IZER 6000: the Flatulence Factory.
 * (Where raw settings go in and questionable life choices come out.)
 *
 * This module turns the numeric settings from app.js into a Web Audio graph.
 * It combines a low sawtooth oscillator for body, filtered white noise for
 * texture, envelope ramps for a natural start and fade, and an LFO that moves
 * the oscillator pitch. Optional Cheek Clapz gating chops the output into a
 * stutter, and Sphincter Shift sweeps pitch down or up based on a bipolar
 * control. The graph is connected to one master gain node so the UI can change
 * overall volume without knowing anything about Web Audio internals.
 *
 * Signal chain (per press):
 *   body osc ──► bodyGain ──┐
 *   noise buf ─► noiseGain ─┴─► lowpass filter ──► [optional gate] ──► masterGain
 *   LFO ──► lfoGain ──► body.detune (pitch wobble)
 *
 * Persistent output path:
 *   masterGain ──► analyser ──► speakers
 *   analyser ──► pcm-capture worklet ──► silent sink (recording tap only)
 *
 * Flow: app.js creates the factory during page setup, then calls start() when
 * the user presses FART and stop() on release. The first start lazily creates
 * the browser audio context; each press builds its own graph, sustains while
 * held, fades on release, and disconnects nodes shortly afterward.
 *
 * Exported API (returned by createFlatulenceFactory):
 *   start(settings)       — build and play a held voice
 *   stop()                — release fade and tear down the active voice
 *   play(settings)        — one-shot start + auto-stop after decay
 *   setGain(gain)         — live master volume from the UI slider
 *   startCapture(gain)    — arm the worklet tap for WAV recording
 *   getRMS()              — current output level (silence detection)
 *   stopCapture()         — flush captured frames and return PCM data
 *
 * No plunger required for maintenance. May void warranties in elevators.
 */
(() => {
  'use strict';

  // Safety cap — even the longest bathroom visit eventually ends.
  const MAX_HOLD_SECONDS = 60;
  // Body oscillator mix level; noise handles the splatter separately.
  const BODY_PEAK = 0.7;

  function createFlatulenceFactory() {
    // Private guts — app.js gets the remote control, not the plumbing.
    let audioContext;
    let masterGain;
    let analyserNode;
    let captureNode;
    let captureSink;
    let captureFrames = [];
    let workletModule;
    let activeVoice = null;

    // Browsers demand a user gesture before audio — no farting on page load.
    function createAudio(gain) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      masterGain.gain.value = gain;
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 1024;
      masterGain.connect(analyserNode).connect(audioContext.destination);
    }

    // Fresh random noise every time — like snowflakes, but smellier in concept.
    function createNoiseBuffer(durationSeconds = 1.6) {
      const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * durationSeconds), audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      return buffer;
    }

    // Cheek Clapz: rhythmic gate chops — applause from the back row.
    // Each clap also nudges body.detune for a cheeky percussive smack.
    function scheduleCheekClapz(gate, body, now, end, speed) {
      const period = 1 / speed;
      const attack = Math.min(0.004, period * 0.12);
      const release = Math.min(0.006, period * 0.18);
      const onTime = Math.max(attack + release + 0.008, period * 0.38);
      gate.gain.setValueAtTime(0.0001, now);
      for (let t = now; t < end; t += period) {
        const peak = Math.min(t + attack, end);
        const holdEnd = Math.min(t + onTime - release, end);
        const off = Math.min(t + onTime, end);
        gate.gain.setValueAtTime(0.0001, t);
        gate.gain.linearRampToValueAtTime(1, peak);
        if (holdEnd > peak) gate.gain.setValueAtTime(1, holdEnd);
        if (off > holdEnd) gate.gain.linearRampToValueAtTime(0.0001, off);

        const smack = Math.min(t + 0.018, end);
        body.detune.setValueAtTime(35, t);
        body.detune.linearRampToValueAtTime(0, smack);
      }
    }

    // Exponential fade-out — the dignified retreat after the main event.
    function releaseGain(gainNode, now, releaseSeconds, scale = 1) {
      gainNode.gain.cancelScheduledValues(now);
      const current = Math.max(0.0001, gainNode.gain.value);
      gainNode.gain.setValueAtTime(current, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds * scale);
    }

    // Build a fart voice: inhale courage, sustain shame, release on stop().
    function start(settings) {
      if (activeVoice) return;
      if (!audioContext) createAudio(settings.gain);
      if (audioContext.state === 'suspended') audioContext.resume();

      const now = audioContext.currentTime;
      const releaseSeconds = settings.decay;
      const maxHoldEnd = now + MAX_HOLD_SECONDS;

      // --- Voice nodes (one fresh deposit per button press) ---
      const body = audioContext.createOscillator();
      const bodyGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      const noise = audioContext.createBufferSource();
      const noiseGain = audioContext.createGain();
      const lfo = audioContext.createOscillator();
      const lfoGain = audioContext.createGain();
      const disposable = [body, bodyGain, filter, noise, noiseGain, lfo, lfoGain];
      let gate = null;

      // Body: low rumble with random wobble — no two toots alike.
      body.type = 'sawtooth';
      const startFrequency = settings.frequency * (0.92 + Math.random() * 0.16);
      body.frequency.setValueAtTime(startFrequency, now);
      body.detune.setValueAtTime((Math.random() - 0.5) * 20, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(settings.cutoff, now);
      filter.Q.value = 2.5;
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(BODY_PEAK, now + 0.012);
      bodyGain.gain.setValueAtTime(BODY_PEAK, now + 0.012);

      // Noise: the fizzy top note — think shaken soda, not gentle breeze.
      noise.buffer = createNoiseBuffer(2);
      noise.loop = true;
      const noisePeak = Math.max(0.0001, settings.noise * 0.48);
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(noisePeak, now + 0.006);
      noiseGain.gain.setValueAtTime(noisePeak, now + 0.006);

      // LFO: wobbly pitch — the intestinal roller coaster.
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(settings.rate, now);
      lfoGain.gain.setValueAtTime(settings.depth * 180, now);
      lfo.connect(lfoGain).connect(body.detune);

      // Sphincter Shift: pitch dive (negative) or whistle (positive).
      // The name is anatomically accurate and we are not apologizing.
      const shift = Number(settings.sphincterShift) || 0;
      if (Math.abs(shift) >= 0.02) {
        const intensity = Math.min(1, Math.abs(shift));
        const direction = Math.sign(shift);
        const endFrequency = Math.max(28, Math.min(1400, startFrequency * Math.pow(2, direction * (0.35 + intensity * 1.4))));
        const sweepSeconds = Math.max(0.05, releaseSeconds * (1.02 - intensity * 0.92));
        body.frequency.exponentialRampToValueAtTime(endFrequency, now + sweepSeconds);
      }

      // Merge body and splatter through one filter — unity in flatulence.
      body.connect(bodyGain).connect(filter);
      noise.connect(noiseGain).connect(filter);

      // To master: straight pipe, or Cheek Clapz stutter if you're feeling festive.
      if (settings.cheekClapz) {
        gate = audioContext.createGain();
        scheduleCheekClapz(gate, body, now, maxHoldEnd, Math.max(2, settings.cheekClapzSpeed || 8));
        filter.connect(gate).connect(masterGain);
        disposable.push(gate);
      } else {
        filter.connect(masterGain);
      }

      body.start(now);
      noise.start(now);
      lfo.start(now);

      activeVoice = {
        body, noise, lfo, bodyGain, noiseGain, gate, disposable, releaseSeconds,
        maxHoldTimer: window.setTimeout(() => stop(), MAX_HOLD_SECONDS * 1000)
      };
      masterGain.gain.setTargetAtTime(settings.gain, now, 0.01);
    }

    // Flush the active voice — fade, stop, disconnect. Courtesy flush included.
    function stop() {
      if (!activeVoice) return;

      const voice = activeVoice;
      activeVoice = null;
      window.clearTimeout(voice.maxHoldTimer);

      const now = audioContext.currentTime;
      const release = voice.releaseSeconds;
      const stopAt = now + release + 0.04;

      // Fade everything; noise exits first like the room clearing ahead of you.
      releaseGain(voice.bodyGain, now, release);
      releaseGain(voice.noiseGain, now, release, 0.72);
      if (voice.gate) releaseGain(voice.gate, now, release);

      voice.body.stop(stopAt);
      voice.noise.stop(stopAt);
      voice.lfo.stop(stopAt);

      // Disconnect after fade — wipe the bowl clean for the next visitor.
      window.setTimeout(() => voice.disposable.forEach(node => node.disconnect()), (release + 0.2) * 1000);
    }

    // One-shot for callers who can't be trusted with a hold button.
    function play(settings) {
      start(settings);
      window.setTimeout(() => stop(), settings.decay * 1000);
    }

    function setGain(gain) {
      if (masterGain) masterGain.gain.setTargetAtTime(gain, audioContext.currentTime, 0.02);
    }

    // Arm the evidence collector — what happens in the bathroom stays in the WAV.
    async function startCapture(gain) {
      if (!audioContext) createAudio(gain);
      if (!audioContext.audioWorklet || !window.AudioWorkletNode) {
        throw new Error('WAV recording is not supported in this browser.');
      }
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (!workletModule) workletModule = audioContext.audioWorklet.addModule('pcm_capture_worklet.js');
      try {
        await workletModule;
      } catch (error) {
        workletModule = null;
        throw error;
      }
      captureFrames = [];
      captureNode = new AudioWorkletNode(audioContext, 'pcm-capture');
      // Silent sink: records the deed without blasting the room twice.
      captureSink = audioContext.createGain();
      captureSink.gain.value = 0;
      captureNode.port.onmessage = event => {
        if (event.data.type === 'samples') captureFrames.push(event.data.samples);
      };
      analyserNode.connect(captureNode).connect(captureSink).connect(audioContext.destination);
    }

    // RMS meter — detects when the room has gone suspiciously quiet again.
    function getRMS() {
      if (!analyserNode) return 0;
      const samples = new Float32Array(analyserNode.fftSize);
      analyserNode.getFloatTimeDomainData(samples);
      let squareTotal = 0;
      samples.forEach(sample => { squareTotal += sample * sample; });
      return Math.sqrt(squareTotal / samples.length);
    }

    // Stop capture, stitch frames together — the forensic report is ready.
    function stopCapture() {
      if (!captureNode) return Promise.resolve({ samples: new Float32Array(0), sampleRate: audioContext.sampleRate });
      return new Promise(resolve => {
        const node = captureNode;
        node.port.onmessage = event => {
          if (event.data.type !== 'stopped') return;
          node.disconnect();
          captureSink.disconnect();
          captureNode = null;
          captureSink = null;
          const length = captureFrames.reduce((total, frame) => total + frame.length, 0);
          const samples = new Float32Array(length);
          let offset = 0;
          captureFrames.forEach(frame => { samples.set(frame, offset); offset += frame.length; });
          captureFrames = [];
          resolve({ samples, sampleRate: audioContext.sampleRate });
        };
        node.port.postMessage('stop');
      });
    }

    return { start, stop, play, setGain, startCapture, getRMS, stopCapture };
  }

  window.createFlatulenceFactory = createFlatulenceFactory;
})();
