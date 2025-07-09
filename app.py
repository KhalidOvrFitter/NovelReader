import asyncio
import os
from flask import Flask, request, jsonify, send_from_directory
import edge_tts
import uuid

app = Flask(__name__, static_folder='static', template_folder='templates')

# Directory to store the generated audio files
AUDIO_DIR = os.path.join(os.path.dirname(__file__), 'audio')
if not os.path.exists(AUDIO_DIR):
    os.makedirs(AUDIO_DIR)

@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')

@app.route('/api/tts', methods=['POST'])
def tts():
    data = request.get_json()
    text = data.get('text')
    voice = data.get('voice', 'en-US-AriaNeural')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    async def _do_tts():
        """The async part of the TTS generation."""
        unique_id = str(uuid.uuid4())
        audio_filename = f'{unique_id}.mp3'
        subtitle_filename = f'{unique_id}.srt'
        audio_filepath = os.path.join(AUDIO_DIR, audio_filename)
        subtitle_filepath = os.path.join(AUDIO_DIR, subtitle_filename)

        communicate = edge_tts.Communicate(text, voice)
        submaker = edge_tts.SubMaker()
        with open(audio_filepath, 'wb') as audio_file:
            async for chunk in communicate.stream():
                if chunk['type'] == 'audio':
                    audio_file.write(chunk['data'])
                elif chunk['type'] == 'WordBoundary':
                    submaker.feed(chunk)

        with open(subtitle_filepath, 'w', encoding='utf-8') as subtitle_file:
            subtitle_file.write(submaker.get_srt())
        
        return audio_filename, subtitle_filename

    try:
        # Run the async function from the synchronous route handler
        audio_filename, subtitle_filename = asyncio.run(_do_tts())
        return jsonify({
            'audio_url': f'/audio/{audio_filename}',
            'subtitle_url': f'/audio/{subtitle_filename}'
        })
    except Exception as e:
        # Log the exception for debugging
        print(f"Error during TTS generation: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/audio/<filename>')
def get_audio(filename):
    return send_from_directory(AUDIO_DIR, filename)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=12000)
