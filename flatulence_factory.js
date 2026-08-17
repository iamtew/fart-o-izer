/*
 * The brain of the FART-O-IZER 6000: the Flatulence Factory.
 *
 * This module turns the numeric settings from app.js into a short-lived Web
 * Audio graph. It combines a low sawtooth oscillator for body, filtered white
 * noise for texture, envelope ramps for a natural start and fade, and an LFO
 * that moves the oscillator pitch. The graph is connected to one master gain
 * node so the UI can change overall volume without knowing anything about
 * Web Audio internals.
 *
 * Flow: app.js creates the factory during page setup, then passes the current
 * settings to play() after a user presses FART. The first play lazily creates
 * the browser audio context, each play schedules its own graph, and finished
 * nodes are disconnected shortly afterward. setGain() is a small live-update
 * bridge for the Master gain slider.
 */
(() => {
  'use strict';

  function createFlatulenceFactory() {
    // These stay private so the application layer cannot accidentally build
    // or modify the audio graph directly.
    let audioContext;
    let masterGain;
    let analyserNode;
    let captureNode;
    let captureSink;
    let captureFrames = [];
    let workletModule;

    // Browsers require audio startup to happen in response to a user gesture;
    // creating the context lazily from play() satisfies that requirement.
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

    // A fresh noise buffer gives every fart its own unrepeatable texture.
    function createNoiseBuffer() {
      const buffer = audioContext.createBuffer(1, Math.ceil(audioContext.sampleRate * 1.6), audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
      return buffer;
    }

    // Build and schedule one complete fart. Settings are supplied by app.js;
    // this function deliberately has no knowledge of the DOM or URL state.
    function play(settings) {
      if (!audioContext) createAudio(settings.gain);
      if (audioContext.state === 'suspended') audioContext.resume();
      const now = audioContext.currentTime;
      const duration = settings.decay;
      const body = audioContext.createOscillator();
      const bodyGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();
      const noise = audioContext.createBufferSource();
      const noiseGain = audioContext.createGain();
      const lfo = audioContext.createOscillator();
      const lfoGain = audioContext.createGain();

      // The body is the tonal low end, shaped by its gain envelope and filter.
      body.type = 'sawtooth';
      body.frequency.setValueAtTime(settings.frequency * (0.92 + Math.random() * 0.16), now);
      body.detune.setValueAtTime((Math.random() - 0.5) * 20, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(settings.cutoff, now);
      filter.Q.value = 2.5;
      bodyGain.gain.setValueAtTime(0.0001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.7, now + 0.012);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      // Noise supplies the airy, splattery part of the sound and fades sooner.
      noise.buffer = createNoiseBuffer();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.noise * 0.48), now + 0.006);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.72);

      // The LFO adds the slow pitch wobble that makes the body feel unstable.
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(settings.rate, now);
      lfoGain.gain.setValueAtTime(settings.depth * 180, now);
      lfo.connect(lfoGain).connect(body.detune);
      body.connect(bodyGain).connect(filter).connect(masterGain);
      noise.connect(noiseGain).connect(filter);
      body.start(now);
      noise.start(now);
      lfo.start(now);
      body.stop(now + duration + 0.04);
      noise.stop(now + duration + 0.04);
      lfo.stop(now + duration + 0.04);

      // Disconnect nodes after playback so repeated presses do not leave
      // finished graphs attached to the audio context.
      window.setTimeout(() => [body, bodyGain, filter, noise, noiseGain, lfo, lfoGain].forEach(node => node.disconnect()), (duration + 0.2) * 1000);
      masterGain.gain.setTargetAtTime(settings.gain, now, 0.01);
    }

    // Gain changes before the first play are picked up by createAudio(); later
    // changes are applied smoothly to the already-running master node.
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

    return { play, setGain, startCapture, getRMS, stopCapture };
  }

  window.createFlatulenceFactory = createFlatulenceFactory;
})();
