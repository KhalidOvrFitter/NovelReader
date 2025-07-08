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

    // --- Chunking & Queueing State ---
    let audioQueue = [];
    let currentChunkIndex = -1;
    const CHUNK_SIZE_WORDS = 120; // Target ~120 words per chunk
    const BUFFER_AHEAD = 2; // Pre-fetch 2 chunks ahead

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

    function chunkText(text, targetWordCount) {
        const words = text.split(/\s+/);
        const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
        const chunks = [];
        let currentChunkSentences = [];
        let wordCount = 0;
        let startWordIndex = 0;

        for (const sentence of sentences) {
            const sentenceWordCount = sentence.split(/\s+/).length;
            if (wordCount + sentenceWordCount > targetWordCount && currentChunkSentences.length > 0) {
                chunks.push({
                    text: currentChunkSentences.join(' '),
                    startWord: startWordIndex,
                    endWord: startWordIndex + wordCount -1,
                });
                currentChunkSentences = [];
                startWordIndex += wordCount;
                wordCount = 0;
            }
            currentChunkSentences.push(sentence);
            wordCount += sentenceWordCount;
        }

        if (currentChunkSentences.length > 0) {
            chunks.push({
                text: currentChunkSentences.join(' '),
                startWord: startWordIndex,
                endWord: words.length - 1,
            });
        }
        return chunks;
    }

    async function fetchChunkData(chunkText) {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunkText, voice: voiceSelect.value })
        });
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json(); // { audio_url, subtitle_url }
    }

    async function bufferAhead() {
        for (let i = 1; i <= BUFFER_AHEAD; i++) {
            const nextIndex = currentChunkIndex + i;
            if (nextIndex < audioQueue.length && audioQueue[nextIndex].status === 'pending') {
                audioQueue[nextIndex].status = 'buffering';
                console.log(`Buffering chunk ${nextIndex}...`);
                // Fetch in the background, don't wait for it.
                fetchChunkData(audioQueue[nextIndex].text)
                    .then(data => {
                        if (nextIndex >= audioQueue.length) return; // Queue was reset

                        const chunk = audioQueue[nextIndex];
                        chunk.audioUrl = data.audio_url;
                        chunk.subtitleUrl = data.subtitle_url;

                        // Now, get the duration
                        const tempAudio = new Audio();
                        tempAudio.src = chunk.audioUrl;
                        tempAudio.addEventListener('loadedmetadata', () => {
                            if (nextIndex >= audioQueue.length) return; // Check again in case of race condition
                            chunk.duration = tempAudio.duration;
                            chunk.status = 'ready';
                            console.log(`Chunk ${nextIndex} is ready with duration: ${chunk.duration}s.`);
                        });
                    })
                    .catch(error => {
                        console.error(`Failed to buffer chunk ${nextIndex}:`, error);
                        if (nextIndex < audioQueue.length) {
                            audioQueue[nextIndex].status = 'error';
                        }
                    });
            }
        }
    }

    async function playChunk(index, seekTime = null) {
        resetHighlighting(); // Reset state for the new chunk.
        if (index >= audioQueue.length) {
            statusBar.textContent = 'STATUS: FINISHED';
            setButtonState('stopped');
            currentChunkIndex = -1;
            audioQueue = [];
            return;
        }

        currentChunkIndex = index;
        const chunk = audioQueue[index];

        // If chunk is still buffering, wait a bit.
        if (chunk.status === 'buffering') {
            statusBar.innerHTML = `STATUS: WAITING FOR BUFFER (CHUNK ${index + 1}/${audioQueue.length})`;
            setTimeout(() => playChunk(index), 500); // Retry in 500ms
            return;
        }

        // Scroll to and highlight the current chunk
        focusOnChunk(index);
        statusBar.innerHTML = `STATUS: GENERATING AUDIO (CHUNK ${index + 1}/${audioQueue.length})<span class="cursor">...</span>`;
        setButtonState('loading');

        try {
            // Fetch audio if we don't have it already (e.g., if buffering failed or didn't happen)
            if (chunk.status !== 'ready') {
                const data = await fetchChunkData(chunk.text);
                chunk.audioUrl = data.audio_url;
                chunk.subtitleUrl = data.subtitle_url;
                chunk.status = 'ready';
            }

            audioPlayer.src = chunk.audioUrl;
            audioPlayer.playbackRate = speedControl.value;
            await fetchAndParseSubtitles(chunk.subtitleUrl, chunk.startWord);

            const startPlayback = () => {
                if (seekTime !== null) {
                    audioPlayer.currentTime = seekTime;
                }
                audioPlayer.play();
            };

            // If the audio is ready, play. Otherwise, wait for the 'canplay' event.
            if (audioPlayer.readyState >= 3) {
                startPlayback();
            } else {
                audioPlayer.addEventListener('canplay', startPlayback, { once: true });
            }

            // Pre-fetch the next chunks
            bufferAhead();

        } catch (error) {
            console.error(`Error processing chunk ${index}:`, error);
            statusBar.innerHTML = `STATUS: <span class="error">ERROR</span> on chunk ${index + 1}. ${error.message}`;
            setButtonState('stopped');
        }
    }

    playBtn.addEventListener('click', async () => {
        // Handle resume from pause within a chunk
        if (audioPlayer.src && audioPlayer.paused) {
            audioPlayer.play();
            return;
        }

        // If a playback is already active, do nothing. Let stop/pause handle it.
        if (currentChunkIndex !== -1) return;

        const text = textInput.value.trim();
        if (!text) {
            statusBar.innerHTML = 'STATUS: <span class="error">ERROR</span>. Text cannot be empty.';
            return;
        }

        // --- Start new playback with chunking ---
        setupTextDisplay(text); // Display the full text once
        const textChunks = chunkText(text, CHUNK_SIZE_WORDS);
        audioQueue = textChunks.map(chunkData => ({
            ...chunkData,
            status: 'pending', // pending, buffering, ready, error
            audioUrl: null,
            subtitleUrl: null,
            duration: null // We will fetch this
        }));
        
        if (audioQueue.length > 0) {
            playChunk(0);
        }
    });

    pauseBtn.addEventListener('click', () => {
        audioPlayer.pause();
    });

    stopBtn.addEventListener('click', () => {
        audioPlayer.pause();
        audioPlayer.currentTime = 0;
        audioPlayer.src = '';
        subtitles = [];
        currentWordIndex = -1;
        // --- Reset Queue ---
        audioQueue = [];
        currentChunkIndex = -1;
        // Stop any ongoing fetches (more complex, handled later)
        
        setupTextDisplay(textInput.value.trim()); // Reset to full text
        setButtonState('stopped');
        statusBar.textContent = 'STATUS: STOPPED';
    });

    audioPlayer.addEventListener('ended', () => {
        if (currentChunkIndex > -1 && currentChunkIndex < audioQueue.length - 1) {
            console.log(`Chunk ${currentChunkIndex} ended. Playing next chunk.`);
            playChunk(currentChunkIndex + 1);
        } else if (currentChunkIndex > -1 && currentChunkIndex === audioQueue.length - 1) {
            // This was the last chunk
            console.log('Finished all chunks.');
            statusBar.textContent = 'STATUS: FINISHED';
            setButtonState('stopped');
            currentChunkIndex = -1;
            audioQueue = [];
        }
    });

    function calculateOverallProgress() {
        if (audioQueue.length === 0 || currentChunkIndex < 0) {
            return { elapsed: 0, total: 0 };
        }

        let elapsed = 0;
        let total = 0;

        for (let i = 0; i < audioQueue.length; i++) {
            const chunk = audioQueue[i];
            if (chunk.duration) {
                total += chunk.duration;
                if (i < currentChunkIndex) {
                    elapsed += chunk.duration;
                }
            }
        }

        if (audioQueue[currentChunkIndex] && audioQueue[currentChunkIndex].duration) {
            elapsed += audioPlayer.currentTime;
        }

        return { elapsed, total };
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

    audioPlayer.addEventListener('timeupdate', () => {
        updateProgress();
        if (subtitles.length > 0) {
            highlightCurrentWord(audioPlayer.currentTime);
        }
    });

    progressBarWrapper.addEventListener('click', (e) => {
        const totalKnownDuration = audioQueue.reduce((acc, chunk) => acc + (chunk.duration || 0), 0);
        if (totalKnownDuration === 0) return;

        const rect = progressBarWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const percent = x / width;
        const targetGlobalTime = percent * totalKnownDuration;

        let cumulativeDuration = 0;
        let targetChunkIndex = -1;
        let seekTimeInChunk = 0;

        for (let i = 0; i < audioQueue.length; i++) {
            const chunk = audioQueue[i];
            if (chunk.duration) {
                if (cumulativeDuration + chunk.duration >= targetGlobalTime) {
                    targetChunkIndex = i;
                    seekTimeInChunk = targetGlobalTime - cumulativeDuration;
                    break;
                }
                cumulativeDuration += chunk.duration;
            }
        }

        if (targetChunkIndex !== -1) {
            console.log(`Seeking to chunk ${targetChunkIndex} at time ${seekTimeInChunk.toFixed(2)}s`);
            audioPlayer.pause();
            playChunk(targetChunkIndex, seekTimeInChunk);
        }
    });

    function formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }

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

    function setupTextDisplay(text) {
        textDisplay.innerHTML = '';
        const words = text.split(/\s+/);
        words.forEach((word, index) => {
            const span = document.createElement('span');
            span.textContent = word + ' ';
            span.classList.add('word');
            span.dataset.wordIndex = index;
            textDisplay.appendChild(span);
        });
    }

    async function fetchAndParseSubtitles(url, wordOffset = 0) {
        try {
            console.log(`Fetching subtitles from: ${url} with wordOffset: ${wordOffset}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Subtitle fetch failed: ${response.status}`);
            const srtContent = await response.text();
            console.log(`Subtitle content (first 200 chars):`, srtContent.substring(0, 200));
            subtitles = parseSRT(srtContent, wordOffset);
            console.log(`Parsed ${subtitles.length} subtitle entries:`, subtitles.slice(0, 5));
        } catch (error) {
            console.error(error);
            subtitles = [];
        }
    }

    function parseSRT(srtContent, wordOffset = 0) {
        const lines = srtContent.trim().split(/\r?\n/);
        const subs = [];
        let wordCounter = 0;
        for (let i = 0; i < lines.length; i += 4) {
            if (lines[i] && lines[i+1] && lines[i+2]) {
                const time = lines[i+1].split(' --> ');
                const start = timeToSeconds(time[0]);
                const end = timeToSeconds(time[1]);
                const text = lines[i+2];
                subs.push({ start, end, text, wordIndex: wordOffset + wordCounter });
                wordCounter++;
            }
        }
        console.log(`parseSRT: Created ${subs.length} subtitle entries with wordOffset ${wordOffset}`);
        if (subs.length > 0) {
            console.log(`First few subtitles with timing:`, subs.slice(0, 3));
        }
        return subs;
    }

    function timeToSeconds(timeStr) {
        // SRT format uses comma for milliseconds: 00:00:01,750
        const [hms, ms] = timeStr.split(',');
        const [h, m, s] = hms.split(':').map(Number);
        return (h * 3600) + (m * 60) + s + (parseInt(ms, 10) / 1000);
    }

    function highlightCurrentWord(currentTime) {
        console.log(`Highlighting at time: ${currentTime.toFixed(2)}s, subtitles count: ${subtitles.length}`);
        
        const activeSubtitle = subtitles.find(sub => currentTime >= sub.start && currentTime <= sub.end);

        if (activeSubtitle) {
            console.log(`Found active subtitle:`, activeSubtitle);
            
            if (activeSubtitle.wordIndex !== currentWordIndex) {
                // Remove highlight from the previous word
                if (currentWordIndex !== -1) {
                    const prevWordEl = document.querySelector(`span[data-word-index='${currentWordIndex}']`);
                    if (prevWordEl) {
                        prevWordEl.classList.remove('highlight');
                        console.log(`Removed highlight from word ${currentWordIndex}`);
                    }
                }

                // Highlight the new word
                const newWordIndex = activeSubtitle.wordIndex;
                const currentWordEl = document.querySelector(`span[data-word-index='${newWordIndex}']`);
                if (currentWordEl) {
                    currentWordEl.classList.add('highlight');
                    console.log(`Added highlight to word ${newWordIndex}: "${currentWordEl.textContent.trim()}"`);
                } else {
                    console.log(`Could not find word element for index ${newWordIndex}`);
                }
                currentWordIndex = newWordIndex;
            }
        } else {
            console.log(`No active subtitle found for time ${currentTime.toFixed(2)}s`);
        }
    }

    function resetHighlighting() {
        const wordElements = textDisplay.getElementsByClassName('word');
        for (let el of wordElements) {
            el.classList.remove('highlight');
        }
        currentWordIndex = -1;
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
                highlightCurrentWord(audioPlayer.currentTime);
                break;
            case 'ArrowRight':
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
                highlightCurrentWord(audioPlayer.currentTime);
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

    function focusOnChunk(index) {
        const chunk = audioQueue[index];
        if (!chunk) return;

        // Clean slate: remove all previous chunk and word highlights
        document.querySelectorAll('.word').forEach(el => {
            el.classList.remove('chunk-highlight');
            el.classList.remove('highlight');
        });

        // Add highlight to words in the new chunk
        for (let i = chunk.startWord; i <= chunk.endWord; i++) {
            const wordEl = document.querySelector(`span[data-word-index='${i}']`);
            if (wordEl) {
                wordEl.classList.add('chunk-highlight');
            }
        }

        // Scroll the first word of the chunk into view
        const firstWordEl = document.querySelector(`span[data-word-index='${chunk.startWord}']`);
        if (firstWordEl) {
            scrollToWord(firstWordEl);
        }
    }

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
