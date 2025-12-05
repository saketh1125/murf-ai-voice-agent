// public/recorderWorkletProcessor.js
// Debug-friendly recorder worklet:
//  - buffers render quanta until >= 100 ms (by default) then sends PCM16 ArrayBuffer
//  - posts a one-time info message containing sampleRate and config
//  - uses simple linear resample to 16k if needed

class RecorderWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Desired target sample rate for AssemblyAI
    this.targetRate = 16000;

    // input sample rate of AudioContext (provided by host)
    this.inputRate = sampleRate;

    // Minimum chunk duration to send (ms) — increase to avoid AssemblyAI input violations
    this.minSendMs = 100; // <- increased to 100ms to be safe
    this.minSendSamples = Math.ceil(this.inputRate * (this.minSendMs / 1000));

    // internal Float32 buffer
    this.buffer = new Float32Array(0);

    // Post one-time info so main thread can verify settings
    this.port.postMessage({
      __worklet_info: true,
      inputRate: this.inputRate,
      targetRate: this.targetRate,
      minSendMs: this.minSendMs,
      minSendSamples: this.minSendSamples
    });
  }

  appendToBuffer(inFloat32) {
    if (this.buffer.length === 0) {
      this.buffer = new Float32Array(inFloat32);
      return;
    }
    const newBuf = new Float32Array(this.buffer.length + inFloat32.length);
    newBuf.set(this.buffer, 0);
    newBuf.set(inFloat32, this.buffer.length);
    this.buffer = newBuf;
  }

  // simple linear resample from inputRate -> targetRate
  resampleToTarget(inputFloat32) {
    if (this.inputRate === this.targetRate) {
      return inputFloat32;
    }
    const ratio = this.inputRate / this.targetRate;
    const outLen = Math.floor(inputFloat32.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, inputFloat32.length - 1);
      const frac = pos - i0;
      out[i] = (1 - frac) * inputFloat32[i0] + frac * inputFloat32[i1];
    }
    return out;
  }

  floatTo16BitPCM(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      let s = Math.max(-1, Math.min(1, float32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  process(inputs /*, outputs, params */) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    // assume mono, take channel 0
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    // append current block
    this.appendToBuffer(channelData);

    // If buffer has enough samples, slice into one or more chunks of minSendSamples
    while (this.buffer.length >= this.minSendSamples) {
      const take = this.buffer.subarray(0, this.minSendSamples);
      const remain = this.buffer.subarray(this.minSendSamples);
      this.buffer = new Float32Array(remain.length);
      this.buffer.set(remain);

      // resample to target rate (16000)
      const resampled = this.resampleToTarget(take);

      // convert to PCM16
      const pcm16 = this.floatTo16BitPCM(resampled);

      // post the ArrayBuffer (transfer for zero-copy)
      this.port.postMessage({ pcm16: pcm16.buffer }, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor('recorder-worklet', RecorderWorkletProcessor);
