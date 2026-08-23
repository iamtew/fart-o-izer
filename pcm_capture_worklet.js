/*
 * PCM capture worklet for WAV recording.
 * The stool pigeon of the audio graph — listens in and snitches to the main thread.
 *
 * Runs on the audio rendering thread (not the main thread). Loaded by
 * flatulence_factory.startCapture() via audioWorklet.addModule(). The factory
 * inserts this processor after the analyser so it receives the same mixed
 * output the user hears, without re-routing the live playback path.
 *
 * Flow:
 *   1. Factory creates AudioWorkletNode('pcm-capture') and connects analyser → worklet → silent sink.
 *   2. Each render quantum, process() copies mono samples and posts them to the main thread.
 *   3. Main thread accumulates frames in captureFrames[].
 *   4. On stopCapture(), factory posts 'stop'; this processor replies { type: 'stopped' }
 *      and the factory concatenates all frames into one Float32Array for WAV encoding.
 *
 * The processor name 'pcm-capture' must match the string passed to AudioWorkletNode
 * in flatulence_factory.js. Mismatch and you get silence — the saddest fart of all.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.active = false;
        // Handshake — "we're done here, flush the toilet and close the case."
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  // Called once per audio block (~128 samples). The night shift never sleeps.
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.active && channel && channel.length) {
      // slice() — copy before the engine reuses the buffer (don't sniff stale samples).
      this.port.postMessage({ type: 'samples', samples: channel.slice() });
    }
    // return true — keep this worklet on the bowl, so to speak.
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
