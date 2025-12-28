import streamlit as st
import requests

st.title("Voice AI Pipeline")

# Input for the ngrok URL
ngrok_url = st.text_input("Enter the ngrok URL of your backend", "http://localhost:8000")

audio_file = st.file_uploader("Upload Audio", type=["wav"])

if audio_file and st.button("Process"):
    with st.spinner("Processing..."):
        try:
            # Add the ngrok-skip-browser-warning header
            headers = {"ngrok-skip-browser-warning": "true"}
            
            process_url = f"{ngrok_url.rstrip('/')}/process_audio"

            response = requests.post(
                process_url,
                files={"audio_file": audio_file},
                headers=headers
            )
            response.raise_for_status()  # Raise an exception for bad status codes
            
            response_data = response.json()
            audio_path = response_data["response_audio_url"]
            
            # Construct the full URL to the audio file
            audio_url = f"{ngrok_url.rstrip('/')}/{audio_path}"
            
            st.audio(audio_url)
            st.success("Processing complete!")

        except requests.exceptions.RequestException as e:
            st.error(f"Error connecting to the backend: {e}")
            #
            # Try to get more details from the response if available
            if e.response is not None:
                st.error(f"Backend response: {e.response.text}")

        except Exception as e:
            st.error(f"An error occurred: {e}")
