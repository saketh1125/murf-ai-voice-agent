// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

const {
  ASSEMBLYAI_API_KEY,
  GROQ_API_KEY,
  MURF_API_KEY,
  PORT = 3000,
} = process.env;

if (!ASSEMBLYAI_API_KEY || !GROQ_API_KEY || !MURF_API_KEY) {
  console.error("Set ASSEMBLYAI_API_KEY, GROQ_API_KEY and MURF_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// request logger
app.use((req, res, next) => {
  console.log("[HTTP]", req.method, req.url);
  next();
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// AssemblyAI v3 Universal Streaming endpoint
const ASSEMBLYAI_WS_URL = "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000";

// helper parse
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch(e) { return null; }
}

// ---------------- Murf TTS: try Falcon streaming first, then GEN2 REST fallback ----------------
/**
 * murfTtsFalconThenGen2:
 * - Attempts Falcon streaming endpoints that may return binary audio (arraybuffer).
 * - If Falcon streaming fails or returns no usable binary, falls back to GEN2 REST /v1/speech/generate.
 *
 * Behavior with wsClient:
 * - If Falcon returns audio bytes, server *sends binary* directly to wsClient (so client can play).
 * - If GEN2 returns an audioFile URL, server sends JSON { type: 'assistant_audio', audioUrl: <url> } and client should fetch /audio_proxy?url=<base64>.
 * - If GEN2 returns encoded base64, server sends it in assistant_audio (audioBase64).
 */
async function murfTtsFalconThenGen2(assistantText, wsClient, opts = {}) {
  const voiceId = opts.voiceId || "Nikhil";         // preferred voice per your request
  const format = opts.format || "MP3";              // Murf accepts MP3 or WAV etc.
  const sampleRate = opts.sampleRate || 24000;

  // 1) Try Falcon streaming (arraybuffer) via candidate endpoints
  const falconCandidates = [
    "https://api.murf.ai/v1/speech/stream",
    "https://global.api.murf.ai/v1/speech/stream"
  ];

  const falconPayload = {
    voiceId,
    text: assistantText,
    model: "FALCON",
    format,
    sampleRate,
    channelType: "MONO"
  };

  for (const url of falconCandidates) {
    try {
      console.log("[MURF-FALCON] trying", url);
      const resp = await axios({
        method: "post",
        url,
        headers: {
          "Content-Type": "application/json",
          "api-key": MURF_API_KEY
        },
        data: falconPayload,
        responseType: "arraybuffer",
        timeout: 90000
      });

      // If server responds successfully with bytes, forward them as binary to the client
      if (resp && resp.data && resp.data.byteLength && resp.status >= 200 && resp.status < 300) {
        const bytes = Buffer.from(resp.data);
        console.log("[MURF-FALCON] got bytes:", bytes.length, "from", url);

        // Send a JSON start event then binary audio, then end event
        try { wsClient.send(JSON.stringify({ type: "assistant_audio_start", assistantText, via: "falcon_stream" })); } catch(e){}
        try {
          // Send binary chunk(s). For simplicity send single buffer; client should handle binary audio stream.
          wsClient.send(bytes, { binary: true }, (err) => {
            if (err) console.error("[MURF-FALCON] ws send binary error:", err);
          });
        } catch (e) {
          console.error("[MURF-FALCON] ws send error:", e);
        }
        try { wsClient.send(JSON.stringify({ type: "assistant_audio_end", bytes: bytes.length, via: "falcon_stream" })); } catch(e){}

        return { ok: true, via: "falcon_stream", bytes: bytes.length };
      } else {
        console.warn("[MURF-FALCON] non-bytes response or bad status:", resp && resp.status);
      }
    } catch (err) {
      // log response body/status if available
      const diag = err?.response ? (err.response.status + " " + JSON.stringify(err.response.data)) : err.message;
      console.warn("[MURF-FALCON] attempt failed for", url, ":", diag);
    }
  }

  // 2) Falcon streaming didn't work -> fallback to GEN2 REST /v1/speech/generate
  try {
    console.log("[MURF-GEN2] falling back to GEN2 REST /v1/speech/generate");
    const gen2Url = "https://api.murf.ai/v1/speech/generate";
    const gen2Payload = {
      text: assistantText,
      voiceId,
      modelVersion: "GEN2",
      format,
      sampleRate,
      encodeAsBase64: false // prefer audioFile url if available
    };

    const r = await axios.post(gen2Url, gen2Payload, {
      headers: { "api-key": MURF_API_KEY, "Content-Type": "application/json" },
      timeout: 120000
    });

    const js = r.data || {};
    console.log("[MURF-GEN2] response keys:", Object.keys(js));

    // Prefer audioFile URL
    const audioFile = js.audioFile || js.audio_url || null;
    const audioB64 = js.encodedAudio || js.encodedAudioString || null;

    if (audioFile) {
      // Send proxied URL instruction to client (client should call /audio_proxy?url=<base64>)
      try {
        wsClient.send(JSON.stringify({ type: "assistant_audio", assistantText, audioUrl: audioFile, via: "gen2_rest" }));
      } catch (e) { console.error("[MURF-GEN2] ws send audioUrl error:", e); }
      return { ok: true, via: "gen2_rest_audioFile", audioFile };
    }

    if (audioB64) {
      try {
        wsClient.send(JSON.stringify({ type: "assistant_audio", assistantText, audioBase64: audioB64, via: "gen2_rest_base64" }));
      } catch (e) { console.error("[MURF-GEN2] ws send base64 error:", e); }
      return { ok: true, via: "gen2_rest_base64" };
    }

    return { ok: false, error: "GEN2 returned no audio" };
  } catch (err) {
    const diag = err?.response ? (err.response.status + " " + JSON.stringify(err.response.data)) : err.message;
    console.error("[MURF-GEN2] error:", diag);
    try { wsClient.send(JSON.stringify({ type: "assistant_audio_error", error: diag })); } catch(e){}
    return { ok: false, error: diag };
  }
}

// ---------------- audio proxy endpoint ----------------
app.get('/audio_proxy', async (req, res) => {
  const urlb64 = req.query.url;
  if (!urlb64) return res.status(400).send("Missing url param");
  try {
    const audioUrl = Buffer.from(urlb64, 'base64').toString('utf8');
    console.log("[audio_proxy] proxying", audioUrl);
    const r = await axios.get(audioUrl, { responseType: 'stream', timeout: 120000 });
    res.setHeader('content-type', r.headers['content-type'] || 'application/octet-stream');
    r.data.pipe(res);
  } catch (err) {
    console.error("[audio_proxy] error:", err && (err.message || err));
    res.status(500).send("proxy failed");
  }
});

// ---------------- Groq helper ----------------
async function callGroqForAssistant(transcript) {
  const groqUrl = "https://api.groq.com/openai/v1/chat/completions";
  const systemPrompt = `
You are an Emergency Medical Assistant. Provide concise, prioritized, evidence-based first-aid instructions.
Always:
- Ask to call emergency services immediately for serious injuries.
- Give step-by-step first-aid actions a non-professional can safely perform.
- Warn about risks and recommend seeking professional help.
- Avoid diagnosing or guaranteeing outcomes. Use calm language and clear disclaimers.
Keep responses short and actionable.
  `;
  const payload = {
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: transcript }
    ],
    max_tokens: 256
  };
  const resp = await axios.post(groqUrl, payload, {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    timeout: 30000
  });
  const assistantText = resp?.data?.choices?.[0]?.message?.content || "I could not generate a response. Please call emergency services if needed.";
  return assistantText;
}

// ---------------- WebSocket handling & aggregation for AssemblyAI ----------------
wss.on('connection', (wsClient) => {
  console.log("Browser WebSocket client connected");

  // Create AssemblyAI WS per client
  const assemblyWs = new WebSocket(ASSEMBLYAI_WS_URL, { headers: { Authorization: ASSEMBLYAI_API_KEY } });

  const pendingToAssembly = [];

  function sendToAssembly(item) {
    if (assemblyWs.readyState === WebSocket.OPEN) {
      try { assemblyWs.send(item); }
      catch (e) { console.error("[sendToAssembly] error:", e); }
    } else {
      pendingToAssembly.push(item);
    }
  }

  // aggregator collects small PCM chunks into larger buffers before sending to AssemblyAI
  const agg = { parts: [], len: 0, flushTimer: null, thresholdBytes: 1600, maxFlushMs: 40 };
  function scheduleFlush() {
    if (agg.flushTimer) return;
    agg.flushTimer = setTimeout(flushAgg, agg.maxFlushMs);
  }
  function flushAgg() {
    if (agg.flushTimer) { clearTimeout(agg.flushTimer); agg.flushTimer = null; }
    if (agg.len === 0) return;
    const out = Buffer.concat(agg.parts, agg.len);
    agg.parts = []; agg.len = 0;
    sendToAssembly(out);
  }

  wsClient._meta = { assemblyWs, pendingToAssembly, agg };

  assemblyWs.on('open', () => {
    console.log("[AssemblyAI WS] connected - flushing", pendingToAssembly.length);
    while (pendingToAssembly.length) {
      const p = pendingToAssembly.shift();
      try { assemblyWs.send(p); } catch (e) { console.error("[AssemblyAI WS] flush send error:", e); }
    }
    try { wsClient.send(JSON.stringify({ type: "assembly_ready" })); } catch(e){}
  });

  assemblyWs.on('message', async (msg) => {
    try {
      const text = msg.toString();
      let preview = text;
      try {
        const j = JSON.parse(text);
        const t = j?.message?.text || j?.text || j?.transcript || null;
        preview = JSON.stringify({ type: j.type, text: t ? (typeof t === 'string' && t.length > 200 ? t.slice(0,200)+'...' : t) : undefined });
      } catch(e) {}
      console.log("[AssemblyAI -> server] event preview:", preview);

      // forward raw event to browser
      try { wsClient.send(text); } catch(e) { console.error("forward error:", e); }

      // auto-respond: on Turn final events, call Groq then Murf
      const j = safeJsonParse(text);
      if (j && String(j.type).toLowerCase() === "turn") {
        const spoken = j?.message?.text || j?.text || j?.transcript || null;
        const isFinal = !!(j?.is_final || j?.end_of_turn || (String(j.type).toLowerCase().includes("final")));
        if (spoken && typeof spoken === 'string' && spoken.trim().length > 0 && isFinal) {
          if (!wsClient._respQueue) wsClient._respQueue = Promise.resolve();
          if (!Number.isInteger(wsClient._generationCounter)) wsClient._generationCounter = 0;
          const genAtCreation = wsClient._generationCounter;

          wsClient._respQueue = wsClient._respQueue.then(async () => {
            console.log("[auto] queued handling (gen=", genAtCreation, "):", spoken.slice(0,120));
            try {
              const assistantText = await callGroqForAssistant(spoken);
              console.log("[auto] Groq preview:", assistantText.slice(0,240));
              const murfResult = await murfTtsFalconThenGen2(assistantText, wsClient, { voiceId: "Nikhil", format: "MP3", sampleRate: 24000 });
              if (!murfResult.ok) console.warn("[auto] murf result error:", murfResult);
            } catch (err) {
              console.error("[auto] error handling transcript:", err);
              try { wsClient.send(JSON.stringify({ type: "assistant_audio_error", error: (err && err.message) || String(err) })); } catch(e){}
            }
          }).catch(e => console.error("[auto] queued failure:", e));
        }
      }
    } catch (err) {
      console.error("assemblyWs.on('message') error:", err);
    }
  });

  assemblyWs.on('close', (code, reason) => {
    let rs = "";
    try { rs = reason ? reason.toString() : ""; } catch(e){ rs = "<unprintable>"; }
    console.log("[AssemblyAI WS] closed:", code, rs);
  });

  assemblyWs.on('error', (err) => console.error("[AssemblyAI WS] error:", err && (err.message || err)));

  // handle messages from browser (binary frames or control JSON)
  wsClient.on('message', (data, isBinary) => {
    try {
      if (isBinary || Buffer.isBuffer(data)) {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        agg.parts.push(chunk);
        agg.len += chunk.length;
        if (agg.len >= agg.thresholdBytes) flushAgg();
        else scheduleFlush();
        wsClient._audioBytesSent = (wsClient._audioBytesSent || 0) + chunk.length;
        return;
      }

      const parsed = safeJsonParse(data.toString());
      if (!parsed || !parsed.type) return;

      if (parsed.type === 'audio') {
        if (parsed.audio) {
          const buf = Buffer.from(parsed.audio, 'base64');
          agg.parts.push(buf);
          agg.len += buf.length;
          if (agg.len >= agg.thresholdBytes) flushAgg(); else scheduleFlush();
          wsClient._audioBytesSent = (wsClient._audioBytesSent || 0) + buf.length;
        }
      } else if (parsed.type === 'audio_end') {
        flushAgg();
        const bytes = wsClient._audioBytesSent || 0;
        const ms = (bytes / 32000) * 1000; // approx
        console.log('[server] audio_end, approx duration:', ms.toFixed(1), 'ms (bytes:', bytes, ')');

        if (assemblyWs && assemblyWs.readyState === WebSocket.OPEN) {
          if (ms >= 50) {
            try { assemblyWs.send(JSON.stringify({ type: "sendForceEndpoint" })); console.log('[server] sent sendForceEndpoint'); }
            catch (e) { console.error('[server] sendForceEndpoint failed:', e); }
          } else {
            console.log('[server] NOT sending sendForceEndpoint (<50ms audio), avoiding 3005');
          }
        } else {
          console.log('[server] received audio_end but assemblyWs not open');
        }
        wsClient._audioBytesSent = 0;
      } else if (parsed.type === 'barge_in') {
        wsClient._generationCounter = (wsClient._generationCounter || 0) + 1;
        console.log("[server] barge_in received - generationCounter now", wsClient._generationCounter);
        try { wsClient.send(JSON.stringify({ type: "barge_ack" })); } catch(e){}
      } else {
        console.warn("Unknown client message type:", parsed.type);
      }
    } catch (err) {
      console.error("wsClient.on('message') parse error:", err);
    }
  });

  wsClient.on('close', () => {
    console.log("Browser client disconnected");
    try { if (agg.flushTimer) clearTimeout(agg.flushTimer); } catch(e){}
    try { if (assemblyWs && (assemblyWs.readyState === WebSocket.OPEN || assemblyWs.readyState === WebSocket.CONNECTING)) assemblyWs.close(); } catch(e){}
  });

  wsClient.on('error', (err) => console.error("Browser WS error:", err));
});

// debug POST /respond (call Groq + Murf GEN2 for manual testing)
app.post('/respond', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: "Missing transcript" });
    console.log("[/respond] transcript preview:", transcript.slice(0,200));
    const assistantText = await callGroqForAssistant(transcript);

    // try GEN2 REST to return audioFile (debug)
    try {
      const r = await axios.post("https://api.murf.ai/v1/speech/generate", {
        text: assistantText,
        voiceId: "Nikhil",
        modelVersion: "GEN2",
        format: "MP3",
        encodeAsBase64: false
      }, {
        headers: { "api-key": MURF_API_KEY, "Content-Type": "application/json" },
        timeout: 120000
      });
      return res.json({ assistantText, audioFile: r.data.audioFile || null });
    } catch (err) {
      console.warn("[/respond] murf gen2 rest failed:", err?.response ? (err.response.status + " " + JSON.stringify(err.response.data)) : err.message);
      return res.json({ assistantText, audioFile: null });
    }

  } catch (err) {
    console.error("[/respond] error:", err);
    res.status(500).json({ error: "server error", detail: (err && err.message) || String(err) });
  }
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
