class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.port.onmessage = event => {
      if (event.data === 'stop') {
        this.active = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (this.active && channel && channel.length) {
      this.port.postMessage({ type: 'samples', samples: channel.slice() });
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);