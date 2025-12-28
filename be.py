from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
from dotenv import load_dotenv
from stt import transcribe_audio
from llm import get_llm_response
from tts import generate_speech

# Load environment variables from .env file (override system env vars)
load_dotenv(override=True)

# Load API keys from environment variables
ASSEMBLYAI_API_KEY = os.environ.get("ASSEMBLYAI_API_KEY")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
MURF_API_KEY = os.environ.get("MURF_API_KEY")

# Check if all API keys are set
if not all([ASSEMBLYAI_API_KEY, GROQ_API_KEY, MURF_API_KEY]):
    raise Exception("One or more API keys are not set. Please set ASSEMBLYAI_API_KEY, GROQ_API_KEY, and MURF_API_KEY environment variables.")

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

# Create a directory to store generated audio files
if not os.path.exists("generated_audio"):
    os.makedirs("generated_audio")

@app.post("/process_audio")
async def process_audio(audio_file: UploadFile = File(...)):
    try:
        # Save the uploaded audio file temporarily
        temp_audio_path = f"temp_{audio_file.filename}"
        with open(temp_audio_path, "wb") as buffer:
            shutil.copyfileobj(audio_file.file, buffer)

        # 1. Speech to Text
        transcribed_text = transcribe_audio(temp_audio_path, ASSEMBLYAI_API_KEY)
        if not transcribed_text:
            raise HTTPException(status_code=500, detail="Failed to transcribe audio.")

        # 2. LLM Processing
        llm_response = get_llm_response(transcribed_text, GROQ_API_KEY)
        if not llm_response:
            raise HTTPException(status_code=500, detail="Failed to get response from LLM.")

        # 3. Text to Speech
        output_audio_filename = f"generated_audio/response_{audio_file.filename}.mp3"
        generated_audio_path = generate_speech(llm_response, MURF_API_KEY, output_audio_filename)
        if not generated_audio_path:
            raise HTTPException(status_code=500, detail="Failed to generate speech.")

        # Clean up the temporary audio file
        os.remove(temp_audio_path)

        # Return the path to the generated audio file
        return {"response_audio_url": generated_audio_path}

    except Exception as e:
        # Log the error for debugging
        print(f"An error occurred: {e}")
        raise HTTPException(status_code=500, detail="An internal server error occurred.")

# Endpoint to serve the generated audio files
@app.get("/generated_audio/{filename}")
async def get_audio_file(filename: str):
    file_path = f"generated_audio/{filename}"
    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="File not found.")

if __name__ == "__main__":
    import uvicorn
    print("Starting FastAPI server...")
    print("API Keys loaded successfully.")
    print("Navigate to http://localhost:8000/docs for API documentation.")
    uvicorn.run(app, host="0.0.0.0", port=8000)
