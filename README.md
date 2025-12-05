# murf-ai-voice-agent
Real-time voice medical assistant using AssemblyAI, Groq, and Murf Falcon
Here is the **exact copyable README.md script**, fully polished and ready to paste into your repository — **no modifications needed**.

---

# 🩺 **Murf AI Voice Agent**

**Real-time emergency medical voice assistant built using AssemblyAI, Groq (Llama 3.1), and Murf Falcon TTS**

This project demonstrates a high-speed, low-latency voice interaction pipeline capable of listening, understanding, and responding instantly.
It is specifically designed as an **Emergency Medical Assistant**, providing clear first-aid guidance through natural conversation.

---

## 🚀 Features

### 🔊 Real-Time Voice Interaction

* Live microphone capture using **AudioWorklet**
* 20–40ms PCM16 chunk streaming
* Near-instant STT results via **AssemblyAI Universal Streaming**

### 🤖 Fast AI Reasoning with Groq

* Powered by **Llama-3.1-8B-Instant**
* Customized medical system prompt
* Safety-first, concise instruction generation

### 🎤 Ultra-Fast Murf Falcon TTS

* Natural, responsive voice output
* Uses **Falcon model (en-IN Nikhil voice)**
* REST fallback logic for reliability

### ⚡ Low Latency Pipeline

* Binary streaming for audio
* Interruptible playback (barge-in)
* Direct browser audio fetch for minimal delay

### 🔧 Developer Friendly

* Clean Node.js backend
* Simple WebSocket-based communication
* Full `.env` API key protection

---

## 🧠 Tech Stack

| Component      | Technology                     | Purpose                        |
| -------------- | ------------------------------ | ------------------------------ |
| Speech-to-Text | AssemblyAI Universal Streaming | Converts live voice → text     |
| AI Reasoning   | Groq LLaMA 3.1 8B Instant      | Generates medical guidance     |
| Text-to-Speech | Murf Falcon (Nikhil)           | Converts text → natural speech |
| Backend        | Node.js (Express + WS)         | Handles media + AI pipeline    |
| Frontend       | HTML, JS, AudioWorklet         | Capture, stream, playback      |
| Communication  | WebSockets                     | Real-time data transfer        |

---

## 🛠️ Setup Instructions

### 1️⃣ Clone the Repository

```bash
git clone https://github.com/saketh1125/murf-ai-voice-agent.git
cd murf-ai-voice-agent
```

### 2️⃣ Install Dependencies

```bash
npm install
```

### 3️⃣ Create a `.env` File

```
ASSEMBLYAI_API_KEY=your_assemblyai_key
GROQ_API_KEY=your_groq_key
MURF_API_KEY=your_murf_key
PORT=3000
```

⚠️ `.env` is protected by `.gitignore` and will NOT be uploaded.

### 4️⃣ Start the Server

```bash
node server.js
```

### 5️⃣ Open the Web App

```
http://localhost:3000
```

Speak → Observe live transcription → Hear Falcon TTS response.

---

## 📡 API Documentation

### 1. **AssemblyAI – Universal Streaming STT**

**WebSocket Endpoint**

```
wss://streaming.assemblyai.com/v3/ws?sample_rate=16000
```

**Client sends**

* PCM16 binary buffers (20–40ms)

**Server receives events**

```json
{
  "type": "Turn",
  "text": "hello",
  "is_final": true
}
```

---

### 2. **Groq – LLaMA 3.1 Reasoning**

**REST Endpoint**

```
POST https://api.groq.com/openai/v1/chat/completions
```

**Payload**

```json
{
  "model": "llama-3.1-8b-instant",
  "messages": [
    {"role": "system", "content": "Emergency medical assistant prompt"},
    {"role": "user", "content": "I have a cut on my hand"}
  ]
}
```

**Response**

```json
{
  "choices": [{
    "message": {"content": "Apply pressure to stop bleeding..."}
  }]
}
```

---

### 3. **Murf – Falcon TTS**

**REST Endpoint**

```
POST https://api.murf.ai/v1/speech/generate
```

**Payload**

```json
{
  "text": "Clean the wound...",
  "voiceId": "en-IN-nikhil",
  "style": "Conversational",
  "model": "FALCON",
  "format": "WAV"
}
```

**Response**

```json
{
  "audioFile": "https://murf.ai/....wav"
}
```

Browser fetches and plays the URL instantly.

---

## 🔄 How the Full Pipeline Works

```
User Speaks →
  AudioWorklet captures PCM →
    Browser sends PCM over WebSocket →
      Node server streams to AssemblyAI →
        AssemblyAI returns transcript →
          Server feeds transcript to Groq →
            Groq returns medical response →
              Server sends text to Murf Falcon →
                Murf returns audio file URL →
                  Browser plays assistant speech →
                    User can interrupt anytime (barge-in)
```

Why it's fast:

* Binary PCM streaming
* Extremely fast Groq inference
* Falcon TTS produces immediate first audio
* Minimal buffering pipeline

---

## ⚠️ Medical Disclaimer

This assistant provides **first-aid guidance only** and is **not a medical device**.
For severe injuries or urgent symptoms:

* Call **emergency services immediately**
* Do NOT rely solely on this system
* This project is for educational/demonstration purposes only

The authors are not responsible for medical outcomes.

---

## 🤝 Contribution

We welcome contributions!

### Steps:

```bash
git checkout -b feature-name
git commit -m "Add new feature"
git push origin feature-name
```

Then open a Pull Request.

---

## 📄 License

This project is licensed under the **MIT License**.

---
* A project logo
* A diagram image
* Shields.io badges
* A shorter README version

Just tell me!
