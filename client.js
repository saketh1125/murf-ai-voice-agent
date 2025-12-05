// public/client.js
// Full client that:
//  - captures microphone via AudioWorklet (recorderWorkletProcessor.js -> pcm16 ArrayBuffer)
//  - streams binary audio to server WS
//  - receives assistant audio as either: (A) binary stream between assistant_audio_start/end OR (B) assistant_audio with audioUrl/audioBase64
//  - auto-plays audio (no UI playback dialog), updates transcript text
//
// HTML expected:
//  - <button id="startBtn">Start</button>
//  - <button id="stopBtn">Stop</button>
//  - <div id="status"></div>
//  - <pre id="transcript"></pre>

const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
let ws = null;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');

function log(...args) { console.log('[client]', ...args); }
function setStatus(s) { if (statusEl) statusEl.textContent = s; log('status', s); }

async function ensureWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return ws;

  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    log('WS opened');
    setStatus('connected');
  };

  ws.onclose = (ev) => {
    log('WS closed', ev && ev.code, ev && ev.reason);
    setStatus('disconnected');
    // keep ws variable for reconnect attempts (user can click Start to reconnect)
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
    setStatus('ws error');
  };

  ws.onmessage = (ev) => {
    try { handleServerMessage(ev); } catch (e) { console.error('msg handler failed', e); }
  };

  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) { clearTimeout(t); resolve(ws); }
      else if (ws && ws.readyState !== WebSocket.OPEN) { /* wait on open event */ }
    }, 0);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (e) => reject(e));
  });
}

// ---------- Capture & send audio ----------
let audioContext = null;
let micStream = null;
let workletNode = null;
let isCapturing = false;

async function startCapture() {
  if (isCapturing) return;
  try {
    await ensureWS();
  } catch (e) {
    console.error('cannot open ws', e);
    setStatus('ws failed');
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error('getUserMedia failed', err);
    setStatus('mic permission denied');
    return;
  }

  // create AudioContext (don't force sampleRate; worklet will resample if needed)
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  try {
    // recorderWorkletProcessor.js must be available under public/
    await audioContext.audioWorklet.addModule('recorderWorkletProcessor.js');
  } catch (err) {
    console.error('audioWorklet addModule failed', err);
    setStatus('worklet failed');
    return;
  }

  // create node and hook up mic -> worklet (no destination to avoid echo)
  workletNode = new AudioWorkletNode(audioContext, 'recorder-worklet');
  const src = audioContext.createMediaStreamSource(micStream);
  src.connect(workletNode);

  // receive PCM16 ArrayBuffer(s) from worklet (transferred)
  workletNode.port.onmessage = (ev) => {
    const data = ev.data;
    if (!data) return;

    // one-time info message from worklet (if present)
    if (data.__worklet_info) {
      log('[worklet] info:', data);
      setStatus(`capturing (in:${data.inputRate} target:${data.targetRate}ms:${data.minSendMs})`);
      return;
    }

    if (data.pcm16) {
      // data.pcm16 is an ArrayBuffer (Int16Array.buffer) transferred from the worklet
      // send it raw as binary to the server
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data.pcm16);
        } catch (e) {
          console.error('ws.send binary failed', e);
        }
      } else {
        // if ws not open: try to reconnect and then send (or simply drop)
        console.warn('WS not open; audio chunk dropped');
      }
    }
  };

  isCapturing = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('capturing');
  log('capture started');
}

async function stopCapture() {
  if (!isCapturing) return;
  try {
    // notify server to finalize turn
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'audio_end' })); } catch (e) { console.warn('audio_end send failed', e); }
    }
  } catch (e) { console.warn('send audio_end error', e); }

  // tear down audio nodes & tracks
  try { if (workletNode) { workletNode.disconnect(); workletNode = null; } } catch(e){}
  try { if (audioContext) { await audioContext.close(); audioContext = null; } } catch(e){}
  try { if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; } } catch(e){}

  isCapturing = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('idle');
  log('capture stopped');
}

// ---------- Playback handling ----------
// The server can send binary chunks (between assistant_audio_start/end) or instruct to fetch /audio_proxy (audioUrl)
// We'll support both. No visible controls shown.

let receivingAudio = false;
let audioParts = []; // array of Uint8Array
let audioMime = 'audio/mpeg'; // default

function clearAudioParts() {
  audioParts = [];
  audioMime = 'audio/mpeg';
}

function mergeUint8Arrays(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function playArrayBuffer(ab, mime) {
  // play via blob URL for simplicity (works for MP3/WAV)
  const blob = new Blob([ab], { type: mime || audioMime });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.autoplay = true;
  audio.onended = () => {
    URL.revokeObjectURL(url);
  };
  audio.play().catch(err => { console.error('playback failed', err); });
}

// fallback: decode via AudioContext.decodeAudioData and play via bufferSource (lower-latency start sometimes)
async function playArrayBufferViaAudioContext(ab) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await ac.decodeAudioData(ab.slice(0)); // copy ArrayBuffer
    const src = ac.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ac.destination);
    src.start(0);
    // stop and close context after playback (best-effort)
    src.onended = () => { try { ac.close(); } catch(e){} };
  } catch (err) {
    console.warn('decodeAudioData failed; falling back to blob play', err);
    playArrayBuffer(ab);
  }
}

// ---------- Server message handler ----------
async function handleServerMessage(ev) {
  // binary chunk received from server (expected while receivingAudio === true)
  if (ev.data instanceof ArrayBuffer) {
    if (!receivingAudio) {
      // server sent binary but didn't mark start; accept anyway and push
      receivingAudio = true;
      audioParts = [];
    }
    audioParts.push(new Uint8Array(ev.data));
    return;
  }

  // else JSON control message
  let msg = null;
  try { msg = JSON.parse(ev.data); } catch (e) { msg = null; }

  if (!msg) {
    // not JSON string and not ArrayBuffer -> ignore
    return;
  }

  if (msg.type === 'assembly_ready') {
    log('assembly_ready');
    return;
  }

  // AssemblyAI Turn event (raw pass-through) => update transcript if present
  if (msg.type === 'Turn' || msg.type === 'turn') {
    const t = msg.transcript || msg.message?.text || msg.text || '';
    if (t && transcriptEl) transcriptEl.textContent = t;
    return;
  }

  // Server indicated binary audio stream will start
  if (msg.type === 'assistant_audio_start') {
    receivingAudio = true;
    clearAudioParts();
    if (msg.format && String(msg.format).toLowerCase().includes('wav')) audioMime = 'audio/wav';
    else if (msg.format && String(msg.format).toLowerCase().includes('mp3')) audioMime = 'audio/mpeg';
    else audioMime = 'audio/mpeg';
    log('assistant_audio_start (via)', msg.via || 'unknown');
    return;
  }

  // Server ended binary stream; merge and play
  if (msg.type === 'assistant_audio_end') {
    log('assistant_audio_end; parts:', audioParts.length, 'bytesApprox:', audioParts.reduce((s,a)=>s+a.length,0));
    receivingAudio = false;
    if (audioParts.length > 0) {
      const merged = mergeUint8Arrays(audioParts);
      // prefer AudioContext decode (better start timing) for supported formats
      // try decodeAudioData; fallback to blob
      playArrayBufferViaAudioContext(merged.buffer).catch(() => playArrayBuffer(merged.buffer, audioMime));
      clearAudioParts();
    } else {
      log('assistant_audio_end with no parts');
    }
    // optionally show assistantText in UI
    if (msg.assistantText && transcriptEl) transcriptEl.textContent = msg.assistantText;
    return;
  }

  // Legacy assistant_audio envelope (audioUrl or audioBase64)
  if (msg.type === 'assistant_audio') {
    log('assistant_audio envelope received', msg);

    // update assistant text immediately
    if (msg.assistantText && transcriptEl) transcriptEl.textContent = msg.assistantText;

    // If an audio URL is provided, fetch via server proxy to avoid CORS/presigned mismatch
    if (msg.audioUrl) {
      try {
        const prox = `/audio_proxy?url=${btoa(msg.audioUrl)}`;
        const resp = await fetch(prox);
        if (!resp.ok) throw new Error('proxy fetch failed ' + resp.status);
        const ab = await resp.arrayBuffer();
        // try fast playback via decodeAudioData; fallback to blob
        playArrayBufferViaAudioContext(ab).catch(() => playArrayBuffer(ab, msg.format || 'audio/mpeg'));
      } catch (e) {
        console.error('fetch/proxy audioUrl failed', e);
      }
      return;
    }

    // If base64 is provided, decode and play
    if (msg.audioBase64) {
      try {
        const bstr = atob(msg.audioBase64);
        const u8 = new Uint8Array(bstr.length);
        for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
        const ab = u8.buffer;
        playArrayBufferViaAudioContext(ab).catch(() => playArrayBuffer(ab, msg.format || 'audio/mpeg'));
      } catch (e) {
        console.error('base64 decode/play failed', e);
      }
      return;
    }

    // no playable audio provided — we already showed assistantText above
    return;
  }

  if (msg.type === 'assistant_audio_error') {
    console.warn('assistant_audio_error from server:', msg.error);
    return;
  }

  // fallback: log unexpected server messages
  log('server message:', msg);
}

// ---------- helpers ----------
function enableUIOnLoad() {
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.addEventListener('click', async () => {
      try {
        startBtn.disabled = true;
        await ensureWS();
        await startCapture();
      } catch (err) {
        console.error('start failed', err);
        startBtn.disabled = false;
      }
    });
  }

  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.addEventListener('click', async () => {
      try {
        stopBtn.disabled = true;
        await stopCapture();
      } catch (err) {
        console.error('stop failed', err);
        stopBtn.disabled = false;
      }
    });
  }
}

// Initialize small UI + auto connect WS (so assembly token is ready)
(async function init() {
  enableUIOnLoad();
  try {
    await ensureWS();
  } catch (e) {
    console.warn('initial ws connect failed', e);
  }
})();
