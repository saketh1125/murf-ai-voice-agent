import requests
import os

def generate_speech(text: str, api_key: str, output_filename: str = "audio.mp3") -> str:
    """
    Converts text to speech using the Murf AI API and saves it to a file.

    Args:
        text (str): The text to be converted to speech.
        api_key (str): Your Murf AI API key.
        output_filename (str, optional): The name of the output audio file. Defaults to "audio.mp3".

    Returns:
        str: The path to the generated audio file, or None if an error occurred.
    """
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
        response.raise_for_status()  # Raise an exception for bad status codes

        with open(output_filename, "wb") as f:
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    f.write(chunk)
        
        print(f"Audio streaming completed, saved to {output_filename}")
        return output_filename

    except requests.exceptions.RequestException as e:
        print(f"Error during API request: {e}")
        return None

if __name__ == "__main__":
    # This is an example of how to use the generate_speech function.
    # It is recommended to manage your API keys securely, for example, by using environment variables.
    
    # To run this example, set the MURF_API_KEY environment variable:
    # export MURF_API_KEY='your_murf_api_key'
    
    murf_api_key = os.environ.get("MURF_API_KEY")
    
    if not murf_api_key:
        print("ERROR: The MURF_API_KEY environment variable is not set.")
        print("Please set it to your Murf AI API key.")
    else:
        text_to_convert = "Hello! This is a test of the Murf AI text-to-speech functionality."
        audio_file = generate_speech(text_to_convert, murf_api_key, "murf_test_output.mp3")
        
        if audio_file:
            print(f"Successfully generated audio file: {audio_file}")
        else:
            print("Failed to generate audio file.")
