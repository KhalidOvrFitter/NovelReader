document.addEventListener('DOMContentLoaded', () => {
    const voiceSelect = document.getElementById('voice-select');
    const speedControl = document.getElementById('speed-control');
    const speedValue = document.getElementById('speed-value');
    const textInput = document.getElementById('text-input');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stopBtn = document.getElementById('stop-btn');
    const textDisplay = document.getElementById('text-display');
    const textDisplayWrapper = document.getElementById('text-display-wrapper');
    const audioPlayer = document.getElementById('audio-player');
    const statusBar = document.getElementById('status-bar');
    const progressBar = document.getElementById('progress-bar');
    const progressBarWrapper = document.getElementById('progress-bar-wrapper');
    const timeDisplay = document.getElementById('time-display');
    const helpIcon = document.getElementById('help-icon');
    const shortcutsPopup = document.getElementById('shortcuts-popup');

    let subtitles = [];
    let currentWordIndex = -1;

    // --- Helper function to manage button states ---
    function setButtonState(state) {
        switch (state) {
            case 'loading':
                playBtn.disabled = true;
                pauseBtn.disabled = true;
                stopBtn.disabled = true;
                break;
            case 'playing':
                playBtn.disabled = true;
                pauseBtn.disabled = false;
                stopBtn.disabled = false;
                break;
            case 'paused':
                playBtn.disabled = false;
                pauseBtn.disabled = true;
                stopBtn.disabled = false;
                break;
            case 'stopped':
            case 'finished':
            case 'error':
            case 'initial':
                playBtn.disabled = false;
                pauseBtn.disabled = true;
                stopBtn.disabled = true;
                break;
        }
    }

    // Populate voice options
    const voices = [
        // US English
        { name: 'Aria (US, Female)', value: 'en-US-AriaNeural' },
        { name: 'Guy (US, Male)', value: 'en-US-GuyNeural' },
        { name: 'Jenny (US, Female)', value: 'en-US-JennyNeural' },
        { name: 'Eric (US, Male)', value: 'en-US-EricNeural' },
        { name: 'Christopher (US, Male)', value: 'en-US-ChristopherNeural' },
        { name: 'Michelle (US, Female)', value: 'en-US-MichelleNeural' },
        // UK English
        { name: 'Libby (UK, Female)', value: 'en-GB-LibbyNeural' },
        { name: 'Ryan (UK, Male)', value: 'en-GB-RyanNeural' },
        { name: 'Sonia (UK, Female)', value: 'en-GB-SoniaNeural' },
        // Other Accents
        { name: 'Natasha (AU, Female)', value: 'en-AU-NatashaNeural' },
        { name: 'Clara (CA, Female)', value: 'en-CA-ClaraNeural' },
        { name: 'Neerja (IN, Female)', value: 'en-IN-NeerjaNeural' },
    ];

    voices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.value;
        option.textContent = voice.name;
        voiceSelect.appendChild(option);
    });

    speedControl.addEventListener('input', () => {
        speedValue.textContent = `${speedControl.value}x`;
        audioPlayer.playbackRate = speedControl.value;
    });

    playBtn.addEventListener('click', async () => {
        const text = textInput.value.trim();
        if (!text) {
            statusBar.innerHTML = 'STATUS: <span class="error">ERROR</span>. Text cannot be empty.';
            return;
        }

        // If audio is already loaded and just paused, resume playing.
        if (audioPlayer.src && audioPlayer.paused) {
            audioPlayer.play();
            return; // Event listener for 'play' will handle the rest
        }

        // Start the TTS generation process
        statusBar.innerHTML = 'STATUS: GENERATING AUDIO<span class="cursor">...</span>';
        setButtonState('loading');

        try {
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, voice: voiceSelect.value })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            // The 'play' event on the audio player will handle the status update
            audioPlayer.src = data.audio_url;
            audioPlayer.playbackRate = speedControl.value;
            setupTextDisplay(text);
            await fetchAndParseSubtitles(data.subtitle_url);
            audioPlayer.play();

        } catch (error) {
            console.error('Error fetching TTS:', error);
            statusBar.innerHTML = `STATUS: <span class="error">ERROR</span>. ${error.message}`;
            setButtonState('error');
        }
    });

    pauseBtn.addEventListener('click', () => {
        audioPlayer.pause();
    });

    stopBtn.addEventListener('click', () => {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        audioPlayer.src = '';
        resetHighlighting();
        textDisplay.innerHTML = '';
        statusBar.innerHTML = '&nbsp;'; // Clear status
        updateProgress(); // Resets to 0
        setButtonState('stopped');
    });

    audioPlayer.addEventListener('timeupdate', () => {
        updateProgress();
        highlightCurrentWord(audioPlayer.currentTime);
    });

    audioPlayer.addEventListener('play', () => {
        statusBar.innerHTML = 'STATUS: PLAYING';
        setButtonState('playing');
    });

    audioPlayer.addEventListener('pause', () => {
        // This handles both user pause and end-of-track pause
        if (audioPlayer.currentTime < audioPlayer.duration) {
            statusBar.innerHTML = 'STATUS: PAUSED';
            setButtonState('paused');
        } else {
            statusBar.innerHTML = 'STATUS: FINISHED';
            setButtonState('finished');
        }
    });

    audioPlayer.addEventListener('ended', () => {
        resetHighlighting();
        // The 'pause' event listener now handles the final state update
    });

    function setupTextDisplay(text) {
        textDisplay.innerHTML = '';
        const words = text.split(/\s+/);
        words.forEach(word => {
            const span = document.createElement('span');
            span.textContent = word + ' ';
            span.classList.add('word');
            textDisplay.appendChild(span);
        });
    }

    async function fetchAndParseSubtitles(url) {
        try {
            const response = await fetch(url);
            const srtContent = await response.text();
            subtitles = parseSRT(srtContent);
        } catch (error) {
            console.error('Error fetching or parsing subtitles:', error);
        }
    }

    function parseSRT(srtContent) {
        const subs = [];
        const blocks = srtContent.trim().split(/\r?\n\r?\n/);
        blocks.forEach(block => {
            const lines = block.split(/\r?\n/);
            if (lines.length >= 3) {
                const timeLine = lines[1];
                const [startStr, endStr] = timeLine.split(' --> ');
                const text = lines.slice(2).join(' ');
                if (startStr && endStr && text) {
                    const start = timeToSeconds(startStr.replace(',', '.'));
                    const end = timeToSeconds(endStr.replace(',', '.'));
                    subs.push({ start, end, text: text.trim() });
                }
            }
        });
        return subs;
    }

    function timeToSeconds(timeStr) {
        const [hms, ms] = timeStr.split('.');
        const [h, m, s] = hms.split(':').map(Number);
        return (h * 3600) + (m * 60) + s + (parseInt(ms, 10) / 1000);
    }

    function highlightCurrentWord(currentTime) {
        const wordElements = textDisplay.getElementsByClassName('word');
        let newWordIndex = -1;

        for (let i = 0; i < subtitles.length; i++) {
            if (currentTime >= subtitles[i].start && currentTime <= subtitles[i].end) {
                newWordIndex = i;
                break;
            }
        }

        if (newWordIndex !== currentWordIndex) {
            if (currentWordIndex !== -1) {
                wordElements[currentWordIndex].classList.remove('highlight');
            }
            if (newWordIndex !== -1) {
                wordElements[newWordIndex].classList.add('highlight');
                scrollToWord(wordElements[newWordIndex]);
            }
            currentWordIndex = newWordIndex;
        }
    }

    function resetHighlighting() {
        const wordElements = textDisplay.getElementsByClassName('word');
        for (let el of wordElements) {
            el.classList.remove('highlight');
        }
        currentWordIndex = -1;
    }

    setButtonState('initial'); // Set initial button state on load

    progressBarWrapper.addEventListener('click', (e) => {
        if (!audioPlayer.src || !audioPlayer.duration) return;
        const rect = progressBarWrapper.getBoundingClientRect();
        const clickPositionX = e.clientX - rect.left;
        const percentage = clickPositionX / rect.width;
        audioPlayer.currentTime = audioPlayer.duration * percentage;
    });

    function formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

    function updateProgress() {
        if (!audioPlayer.duration) {
            progressBar.style.width = '0%';
            timeDisplay.textContent = '00:00 / 00:00';
            return;
        }
        const percentage = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.style.width = `${percentage}%`;
        timeDisplay.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration)}`;
    }

    // --- Keyboard Shortcuts --- 
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts if user is typing in the text area
        if (e.target === textInput) return;

        // Only trigger if audio is loaded
        if (!audioPlayer.src || !audioPlayer.duration) return;

        switch (e.key) {
            case ' ':
                e.preventDefault(); // Prevent page from scrolling
                if (audioPlayer.paused) {
                    playBtn.click();
                } else {
                    pauseBtn.click();
                }
                break;
            case 'ArrowLeft':
                audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
                break;
            case 'ArrowRight':
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
                break;
            case 'Escape':
                stopBtn.click();
                break;
        }
    });

    // --- Help Icon Logic ---
    helpIcon.addEventListener('mouseenter', () => {
        shortcutsPopup.classList.remove('hidden');
    });

    helpIcon.addEventListener('mouseleave', () => {
        shortcutsPopup.classList.add('hidden');
    });

    function scrollToWord(wordElement) {
        const wrapperRect = textDisplayWrapper.getBoundingClientRect();
        const wordRect = wordElement.getBoundingClientRect();

        const isVisible = (
            wordRect.top >= wrapperRect.top &&
            wordRect.bottom <= wrapperRect.bottom
        );

        if (!isVisible) {
            textDisplayWrapper.scrollTop += (wordRect.top - wrapperRect.top) - (wrapperRect.height / 2) + (wordRect.height / 2);
        }
    }
});
