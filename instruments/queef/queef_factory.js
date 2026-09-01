/*
 * The melodic voice engine for the Queef instrument.
 * Brighter, higher, and more tonal than the Flatulence Factory — triangle body,
 * pink noise, bandpass filter (cutoff + Q), vibrato LFO, and a slow phrase drift LFO.
 *
 * Signal chain (per press):
 *   body osc (selectable waveform) ──► bodyGain ──┐
 *   shimmer osc (sine)           ──► shimmerGain ┴─► bandpass filter ──► [optional gate] ──► masterGain
 *   noise buf ───────────► noiseGain ───┘
 *   vibrato LFO ──► vibratoGain ──► body.detune
 *   phrase LFO  ──► phraseGain  ──► body.frequency (slow melodic drift)
 *
 * Persistent output path:
 *   masterGain ──► analyser ──► speakers
 *   analyser ──► pcm-capture worklet ──► silent sink (recording tap only)
 *
 * Flow: queef.js creates the factory during mount(), then calls start() when
 * the user presses QUEEF and stop() on release. Lazy AudioContext on first start.
 *
 * Exported API (returned by createQueefFactory):
 *   start(settings)       — build and play a held voice
 *   stop()                — release fade and tear down the active voice
 *   play(settings)        — one-shot start + auto-stop after decay
 *   setGain(gain)         — live master volume from the UI slider
 *   startCapture(gain)    — arm the worklet tap for WAV recording
 *   getRMS()              — current output level (silence detection)
 *   stopCapture()         — flush captured frames and return PCM data
 */
(() => {
  'use strict';

  const MAX_HOLD_SECONDS = 60;
  const SHIMMER_PEAK = 0.3;
  const VALID_WAVEFORMS = new Set(['sine', 'triangle', 'sawtooth', 'square']);
  // Per-shape peaks — sine is quietest; square/saw carry more harmonic weight.
  const WAVEFORM_PEAKS = {
    sine: 0.92,
    triangle: 0.8,
    sawtooth: 0.72,
    square: 0.66
  };

  function createQueefFactory() {
    let audioContext;
    let masterGain;
    let analyserNode;
    let captureNode;
    let captureSink;
    let captureFrames = [];
    let workletModule;
    let activeVoice = null;

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

    // Paul Kellet's economical pink-noise filter — softer roll-off than white noise.
    function createNoiseBuffer(durationSeconds = 1.6) {
      const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * durationSeconds), audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[index] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
      }
      return buffer;
    }

    // Flutter Gate: softer tremolo than Cheek Clapz — gentle rhythmic breathing.
    function scheduleFlutterGate(gate, now, end, speed) {
      const period = 1 / speed;
      const attack = Math.min(0.008, period * 0.18);
      const release = Math.min(0.012, period * 0.22);
      const onTime = Math.max(attack + release + 0.012, period * 0.52);
      gate.gain.setValueAtTime(0.0001, now);
      for (let t = now; t < end; t += period) {
        const peak = Math.min(t + attack, end);
        const holdEnd = Math.min(t + onTime - release, end);
        const off = Math.min(t + onTime, end);
        gate.gain.setValueAtTime(0.0001, t);
        gate.gain.linearRampToValueAtTime(0.85, peak);
        if (holdEnd > peak) gate.gain.setValueAtTime(0.85, holdEnd);
        if (off > holdEnd) gate.gain.linearRampToValueAtTime(0.0001, off);
      }
    }

    function releaseGain(gainNode, now, releaseSeconds, scale = 1) {
      gainNode.gain.cancelScheduledValues(now);
      const current = Math.max(0.0001, gainNode.gain.value);
      gainNode.gain.setValueAtTime(current, now);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds * scale);
    }

    function start(settings) {
      if (activeVoice) return;
      if (!audioContext) createAudio(settings.gain);
      if (audioContext.state === 'suspended') audioContext.resume();

      const now = audioContext.currentTime;
      const releaseSeconds = settings.decay;
      const maxHoldEnd = now + MAX_HOLD_SECONDS;

      const body = audioContext.createOscillator();
      const shimmer = audioContext.createOscillator();
      const bodyGain = audioContext.createGain();
      const shimmerGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      const noise = audioContext.createBufferSource();
      const noiseGain = audioContext.createGain();
      const vibratoLfo = audioContext.createOscillator();
      const vibratoGain = audioContext.createGain();
      const phraseLfo = audioContext.createOscillator();
      const phraseGain = audioContext.createGain();
      const disposable = [body, shimmer, bodyGain, shimmerGain, filter, noise, noiseGain, vibratoLfo, vibratoGain, phraseLfo, phraseGain];
      let gate = null;

      // Body: selectable waveform with micro-variation between holds.
      const waveform = VALID_WAVEFORMS.has(settings.waveform) ? settings.waveform : 'triangle';
      const bodyPeak = WAVEFORM_PEAKS[waveform];
      body.type = waveform;
      const startFrequency = settings.frequency * (0.94 + Math.random() * 0.12);
      body.frequency.setValueAtTime(startFrequency, now);
      const microSteps = 3 + Math.floor(Math.random() * 3);
      for (let step = 1; step <= microSteps; step += 1) {
        const stepTime = now + (step / microSteps) * Math.min(0.35, releaseSeconds * 0.4);
        const detuneCents = (Math.random() - 0.5) * 18;
        body.detune.setValueAtTime(detuneCents, stepTime);
      }

      // Shimmer: quiet sine layer one octave up for air and brightness.
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(startFrequency * 2, now);
      shimmer.detune.setValueAtTime((Math.random() - 0.5) * 12, now);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(settings.cutoff, now);
      filter.Q.value = settings.resonance ?? 3.8;

      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(bodyPeak, now + 0.014);
      bodyGain.gain.setValueAtTime(bodyPeak, now + 0.014);

      shimmerGain.gain.setValueAtTime(0.0001, now);
      shimmerGain.gain.exponentialRampToValueAtTime(SHIMMER_PEAK, now + 0.018);
      shimmerGain.gain.setValueAtTime(SHIMMER_PEAK, now + 0.018);

      noise.buffer = createNoiseBuffer(2);
      noise.loop = true;
      const noisePeak = Math.max(0.0001, settings.noise * 0.36);
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(noisePeak, now + 0.008);
      noiseGain.gain.setValueAtTime(noisePeak, now + 0.008);

      // Vibrato LFO: musical pitch wobble on detune.
      vibratoLfo.type = 'sine';
      vibratoLfo.frequency.setValueAtTime(settings.rate, now);
      vibratoGain.gain.setValueAtTime(settings.depth * 95, now);
      vibratoLfo.connect(vibratoGain).connect(body.detune);

      // Phrase LFO: slow frequency drift for melodic movement.
      phraseLfo.type = 'sine';
      phraseLfo.frequency.setValueAtTime(settings.phraseRate, now);
      phraseGain.gain.setValueAtTime(settings.phraseDepth * startFrequency * 0.08, now);
      phraseLfo.connect(phraseGain).connect(body.frequency);

      // Pitch Glide: bipolar sweep — biased upward for whistle tones.
      const shift = Number(settings.pitchGlide) || 0;
      if (Math.abs(shift) >= 0.02) {
        const intensity = Math.min(1, Math.abs(shift));
        const direction = Math.sign(shift);
        const upwardBias = direction >= 0 ? 1.15 : 1;
        const endFrequency = Math.max(80, Math.min(2200, startFrequency * Math.pow(2, direction * (0.28 + intensity * 1.1) * upwardBias)));
        const sweepSeconds = Math.max(0.06, releaseSeconds * (1.05 - intensity * 0.85));
        body.frequency.exponentialRampToValueAtTime(endFrequency, now + sweepSeconds);
        shimmer.frequency.exponentialRampToValueAtTime(endFrequency * 2, now + sweepSeconds);
      }

      body.connect(bodyGain).connect(filter);
      shimmer.connect(shimmerGain).connect(filter);
      noise.connect(noiseGain).connect(filter);

      if (settings.flutterGate) {
        gate = audioContext.createGain();
        scheduleFlutterGate(gate, now, maxHoldEnd, Math.max(2, settings.flutterGateSpeed || 6));
        filter.connect(gate).connect(masterGain);
        disposable.push(gate);
      } else {
        filter.connect(masterGain);
      }

      body.start(now);
      shimmer.start(now);
      noise.start(now);
      vibratoLfo.start(now);
      phraseLfo.start(now);

      activeVoice = {
        body, shimmer, noise, vibratoLfo, phraseLfo, bodyGain, shimmerGain, noiseGain, gate, disposable, releaseSeconds,
        maxHoldTimer: window.setTimeout(() => stop(), MAX_HOLD_SECONDS * 1000)
      };
      masterGain.gain.setTargetAtTime(settings.gain, now, 0.01);
    }

    function stop() {
      if (!activeVoice) return;

      const voice = activeVoice;
      activeVoice = null;
      window.clearTimeout(voice.maxHoldTimer);

      const now = audioContext.currentTime;
      const release = voice.releaseSeconds;
      const stopAt = now + release + 0.04;

      releaseGain(voice.bodyGain, now, release);
      releaseGain(voice.shimmerGain, now, release, 0.85);
      releaseGain(voice.noiseGain, now, release, 0.65);
      if (voice.gate) releaseGain(voice.gate, now, release);

      voice.body.stop(stopAt);
      voice.shimmer.stop(stopAt);
      voice.noise.stop(stopAt);
      voice.vibratoLfo.stop(stopAt);
      voice.phraseLfo.stop(stopAt);

      window.setTimeout(() => voice.disposable.forEach(node => node.disconnect()), (release + 0.2) * 1000);
    }

    function play(settings) {
      start(settings);
      window.setTimeout(() => stop(), settings.decay * 1000);
    }

    function setGain(gain) {
      if (masterGain) masterGain.gain.setTargetAtTime(gain, audioContext.currentTime, 0.02);
    }

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
      captureSink = audioContext.createGain();
      captureSink.gain.value = 0;
      captureNode.port.onmessage = event => {
        if (event.data.type === 'samples') captureFrames.push(event.data.samples);
      };
      analyserNode.connect(captureNode).connect(captureSink).connect(audioContext.destination);
    }

    function getRMS() {
      if (!analyserNode) return 0;
      const samples = new Float32Array(analyserNode.fftSize);
      analyserNode.getFloatTimeDomainData(samples);
      let squareTotal = 0;
      samples.forEach(sample => { squareTotal += sample * sample; });
      return Math.sqrt(squareTotal / samples.length);
    }

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

  window.createQueefFactory = createQueefFactory;
})();
