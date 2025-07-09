# Novel Reader

A simple, browser-based web application that uses Microsoft Edge's Text-to-Speech (TTS) service to read novel chapters or any other text aloud. It features real-time word highlighting and a retro, terminal-style user interface.

## Features

- **Text-to-Speech**: Paste any plain text into the application to have it read aloud.
- **High-Quality Voices**: Leverages the powerful and natural-sounding voices from Microsoft Edge's TTS engine.
- **Playback Controls**: Full control over the audio with "Play," "Pause," and "Stop" buttons.
- **Voice and Speed Options**: Choose from a curated list of voices and adjust the playback speed from 0.5x to 2x.
- **Real-Time Word Highlighting**: The application highlights each word as it is spoken, making it easy to follow along.
- **Auto-Scrolling**: The text view automatically scrolls to keep the currently spoken word visible.
- **Terminal-Style UI**: A fun, retro aesthetic with a dark background, green text, and a monospace font.

## How It Works

The application is built with a simple client-server architecture:

- **Frontend (Client)**: A standard HTML, CSS, and JavaScript single-page application. It captures the user's text and sends it to the backend via a REST API call. When it receives the audio and subtitle files, it handles playback and the word-highlighting logic.

- **Backend (Server)**: A Python server using the **Flask** framework. It exposes a single API endpoint that receives text from the frontend. It then uses the `edge-tts` library to communicate with Microsoft's TTS service, generating both an `.mp3` audio file and an `.srt` subtitle file containing the word timings. The server saves these files and returns their URLs to the frontend.

## How to Run Locally

To run this project on your local machine, follow these steps:

1.  **Prerequisites**: Ensure you have Python 3.7+ installed on your system.

2.  **Create a Virtual Environment**: Open a terminal in the project's root directory and create a Python virtual environment. This keeps the project's dependencies isolated.

    ```bash
    python -m venv venv
    ```

3.  **Activate the Virtual Environment**:

    -   On **Windows**:
        ```bash
        .\venv\Scripts\activate
        ```
    -   On **macOS/Linux**:
        ```bash
        source venv/bin/activate
        ```

4.  **Install Dependencies**: With the virtual environment active, install the required Python packages from the `requirements.txt` file.

    ```bash
    pip install -r requirements.txt
    ```

5.  **Run the Application**: Start the Flask server.

    ```bash
    python app.py
    ```

6.  **View in Browser**: The terminal will show that the server is running. Open your web browser and navigate to:

    [http://127.0.0.1:12000](http://127.0.0.1:12000)

You should now see the Novel Reader application running and ready to use.
