import os
from groq import Groq

def get_llm_response(user_prompt: str, api_key: str) -> str:
    """
    Gets a response from the Groq LLM.

    Args:
        user_prompt (str): The prompt to send to the LLM.
        api_key (str): Your Groq API key.

    Returns:
        str: The LLM's response, or None if an error occurred.
    """
    try:
        client = Groq(api_key=api_key)
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": user_prompt,
                }
            ],
            model="llama-3.3-70b-versatile",
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        print(f"An error occurred: {e}")
        return None

if __name__ == "__main__":
    # This is an example of how to use the get_llm_response function.
    # It is recommended to manage your API keys securely, for example, by using environment variables.
    
    # To run this example, set the GROQ_API_KEY environment variable:
    # export GROQ_API_KEY='your_groq_api_key'
    
    groq_api_key = os.environ.get("GROQ_API_KEY")
    
    if not groq_api_key:
        print("ERROR: The GROQ_API_KEY environment variable is not set.")
        print("Please set it to your Groq API key.")
    else:
        prompt = "Explain the importance of low latency LLMs in one sentence."
        print(f"Sending prompt to Groq: '{prompt}'")
        llm_response = get_llm_response(prompt, groq_api_key)
        
        if llm_response:
            print(f"Successfully received response from Groq.")
            print(f"Response: {llm_response}")
        else:
            print("Failed to get response from Groq.")
