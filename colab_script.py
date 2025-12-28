# colab_script.py

# Step 1: Install all the necessary packages
!pip install streamlit requests pyarrow pandas assemblyai groq fastapi uvicorn python-multipart pyngrok nest_asyncio

# Step 2: Set up API keys and ngrok authtoken using Colab secrets
from google.colab import userdata
import os

api_keys = {
    "ASSEMBLYAI_API_KEY": "YOUR_ASSEMBLYAI_API_KEY",
    "GROQ_API_KEY": "YOUR_GROQ_API_KEY",
    "MURF_API_KEY": "YOUR_MURF_AI_KEY"
}

for key, default_value in api_keys.items():
    secret_value = userdata.get(key)
    if secret_value and isinstance(secret_value, str):
        os.environ[key] = secret_value
    else:
        print(f"WARNING: Could not find secret for {key}. Using default placeholder.")
        os.environ[key] = default_value

NGROK_AUTHTOKEN = userdata.get('NGROK_AUTHTOKEN')
if not NGROK_AUTHTOKEN or not isinstance(NGROK_AUTHTOKEN, str):
    print("ERROR: NGROK_AUTHTOKEN not found or is not a string. Please set it in Colab secrets.")
    NGROK_AUTHTOKEN = "YOUR_NGROK_AUTHTOKEN" # Fallback to a placeholder

# Step 3: Import all necessary libraries
import streamlit as st
import requests
import os
import shutil
import threading
import uvicorn
import nest_asyncio
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pyngrok import ngrok
import assemblyai as aai
from groq import Groq

# Step 4: Define the core functions for STT, LLM, and TTS

# from stt.py
def transcribe_audio(audio_file_path: str, api_key: str) -> str:
    try:
        aai.settings.api_key = api_key
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(audio_file_path)

        if transcript.status == aai.TranscriptStatus.error:
            print(f"Error during transcription: {transcript.error}")
            return None
        else:
            return transcript.text
    except Exception as e:
        print(f"An error occurred in transcribe_audio: {e}")
        return None

# from llm.py
def get_llm_response(user_prompt: str, api_key: str) -> str:
    try:
        client = Groq(api_key=api_key)
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "user", "content": user_prompt}
            ],
            model="llama3-8b-8192",
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"An error occurred in get_llm_response: {e}")
        return None

# from tts.py
def generate_speech(text: str, api_key: str, output_filename: str = "audio.mp3") -> str:
    url = "https://global.api.murf.ai/v1/speech/stream"
    headers = {
        "api-key": api_key,
        "Content-Type": "application/json"
    }
    data = {
       "voice_id": "en-US-matthew",
       "text": text,
       "pitch": 23,
       "multi_native_locale": "en-US",
       "model": "FALCON",
       "format": "MP3",
       "sampleRate": 24000,
       "channelType": "MONO"
    }
    try:
        response = requests.post(url, headers=headers, json=data, stream=True)
        response.raise_for_status()
        with open(output_filename, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    f.write(chunk)
        return output_filename
    except requests.exceptions.RequestException as e:
        print(f"Error during API request in generate_speech: {e}")
        return None

# Step 5: Define the FastAPI Backend
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create a directory to store generated audio files
if not os.path.exists("generated_audio"):
    os.makedirs("generated_audio")

@app.post("/process_audio")
async def process_audio_endpoint(audio_file: UploadFile = File(...)):
    try:
        temp_audio_path = f"temp_{audio_file.filename}"
        with open(temp_audio_path, "wb") as buffer:
            shutil.copyfileobj(audio_file.file, buffer)

        transcribed_text = transcribe_audio(temp_audio_path, os.environ["ASSEMBLYAI_API_KEY"])
        if not transcribed_text:
            raise HTTPException(status_code=500, detail="Failed to transcribe audio.")

        llm_response = get_llm_response(transcribed_text, os.environ["GROQ_API_KEY"])
        if not llm_response:
            raise HTTPException(status_code=500, detail="Failed to get response from LLM.")

        output_audio_filename = f"generated_audio/response_{os.path.basename(audio_file.filename)}.mp3"
        generated_audio_path = generate_speech(llm_response, os.environ["MURF_API_KEY"], output_audio_filename)
        if not generated_audio_path:
            raise HTTPException(status_code=500, detail="Failed to generate speech.")

        os.remove(temp_audio_path)
        return {"response_audio_url": generated_audio_path}
    except Exception as e:
        print(f"An error occurred in process_audio_endpoint: {e}")
        raise HTTPException(status_code=500, detail="An internal server error occurred.")

@app.get("/generated_audio/{filename}")
async def get_audio_file(filename: str):
    file_path = f"generated_audio/{filename}"
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="File not found.")

# Step 6: Define the Streamlit Frontend in a separate file for running
streamlit_code = """
import streamlit as st
import requests
import os

st.title("Voice AI Pipeline")

ngrok_url = st.text_input("Enter the ngrok URL of your backend", "")

audio_file = st.file_uploader("Upload Audio", type=["wav"])

if audio_file and st.button("Process"):
    if not ngrok_url:
        st.error("Please enter the ngrok URL of your backend.")
    else:
        with st.spinner("Processing..."):
            try:
                headers = {"ngrok-skip-browser-warning": "true"}
                process_url = f"{ngrok_url.rstrip('/')}/process_audio"
                
                response = requests.post(
                    process_url,
                    files={"audio_file": audio_file},
                    headers=headers
                )
                response.raise_for_status()
                
                response_data = response.json()
                audio_path = response_data["response_audio_url"]
                
                audio_url = f"{ngrok_url.rstrip('/')}/{audio_path}"
                
                st.audio(audio_url)
                st.success("Processing complete!")

            except requests.exceptions.RequestException as e:
                st.error(f"Error connecting to the backend: {e}")
                if e.response is not None:
                    st.error(f"Backend response: {e.response.text}")
            except Exception as e:
                st.error(f"An error occurred: {e}")
"""

with open("streamlit_app.py", "w") as f:
    f.write(streamlit_code)


# Step 7: Run the FastAPI server and Streamlit app
def run_fastapi():
    nest_asyncio.apply()
    uvicorn.run(app, host="0.0.0.0", port=8000)

# Start the FastAPI server in a background thread
thread = threading.Thread(target=run_fastapi)
thread.daemon = True
thread.start()

# Set up ngrok
ngrok.set_auth_token(NGROK_AUTHTOKEN)
public_url = ngrok.connect(8000)
print(f"FastAPI backend is running at: {public_url}")

# Run the Streamlit app
!streamlit run streamlit_app.py