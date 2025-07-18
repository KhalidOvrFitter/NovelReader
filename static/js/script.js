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
    const themeSelect = document.getElementById('theme-select');
    const largeTextModeCheckbox = document.getElementById('large-text-mode');

    let subtitles = [];
    let currentWordIndex = -1;

    // --- Chunking & Queueing State ---
    let audioQueue = [];
    let currentChunkIndex = -1;
    // const CHUNK_SIZE_WORDS = 120; // No longer used for paragraph chunking
    const BUFFER_AHEAD = 2; // Pre-fetch 2 chunks ahead
    const SHORT_PARAGRAPH_WORD_THRESHOLD = 10;
    const SHORT_PARAGRAPH_CHAR_THRESHOLD = 50;

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

    function chunkText(fullTextContent, targetWordCount) { // targetWordCount is no longer used but kept for signature compatibility
        const chunks = [];
        if (!fullTextContent || fullTextContent.trim() === '') {
            return chunks;
        }

        // Create a list of all words in the full text to correctly map start/end word indices
        const allWordsInFullText = fullTextContent.split(/\s+/).filter(word => word.length > 0);
        let globalWordOffset = 0; // Tracks the word index in allWordsInFullText

        // Split text into paragraphs. Handles Windows and Unix line endings, and multiple blank lines.
        const paragraphs = fullTextContent.split(/\r?\n\s*\r?\n*/).map(p => p.trim()).filter(p => p.length > 0);

        if (paragraphs.length === 0) {
            return chunks;
        }

        let currentChunkParagraphs = [];
        let paragraphIndex = 0;

        while (paragraphIndex < paragraphs.length) {
            let currentParagraph = paragraphs[paragraphIndex].trim();
            currentChunkParagraphs.push(currentParagraph);

            // Use single newline as paragraph separator for TTS text
            const currentCombinedText = currentChunkParagraphs.join('\n');
            const wordsInCombinedText = currentCombinedText.split(/\s+/).filter(w => w.length > 0);
            const isShort = wordsInCombinedText.length < SHORT_PARAGRAPH_WORD_THRESHOLD || currentCombinedText.length < SHORT_PARAGRAPH_CHAR_THRESHOLD;

            // If it's short AND there's a next paragraph to merge with, continue accumulating
            if (isShort && (paragraphIndex + 1 < paragraphs.length)) {
                paragraphIndex++;
                continue;
            }

            // Finalize the chunk
            const chunkTextContent = currentCombinedText;
            const numWordsInChunk = wordsInCombinedText.length;

            chunks.push({
                text: chunkTextContent,
                startWord: globalWordOffset,
                endWord: globalWordOffset + numWordsInChunk - 1,
            });

            globalWordOffset += numWordsInChunk;
            currentChunkParagraphs = []; // Reset for the next chunk
            paragraphIndex++;
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
        const textChunks = chunkText(text); // CHUNK_SIZE_WORDS argument removed
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
        highlightCurrentWord(audioPlayer.currentTime);
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
        
        // Split text into segments that preserve whitespace
        const segments = text.split(/(\s+)/);
        let wordIndex = 0;
        
        segments.forEach(segment => {
            if (segment.match(/^\s+$/)) {
                // This is a whitespace segment - preserve it
                if (segment.includes('\n')) {
                    // Contains line breaks - split and add <br> elements
                    const lines = segment.split('\n');
                    for (let i = 0; i < lines.length - 1; i++) {
                        if (lines[i]) {
                            // Add any spaces before the newline
                            textDisplay.appendChild(document.createTextNode(lines[i]));
                        }
                        textDisplay.appendChild(document.createElement('br'));
                    }
                    // Add any trailing spaces after the last newline
                    if (lines[lines.length - 1]) {
                        textDisplay.appendChild(document.createTextNode(lines[lines.length - 1]));
                    }
                } else {
                    // Just spaces/tabs - add as text node
                    textDisplay.appendChild(document.createTextNode(segment));
                }
            } else if (segment.trim()) {
                // This is a word - create span for highlighting
                const span = document.createElement('span');
                span.textContent = segment;
                span.classList.add('word');
                span.dataset.wordIndex = wordIndex;
                textDisplay.appendChild(span);
                wordIndex++;
            }
        });
    }

    async function fetchAndParseSubtitles(url, wordOffset = 0) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Subtitle fetch failed: ${response.status}`);
            const srtContent = await response.text();
            subtitles = parseSRT(srtContent, wordOffset);
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
        return subs;
    }

    function timeToSeconds(timeStr) {
        // SRT format uses comma for milliseconds: 00:00:01,750
        const [hms, ms] = timeStr.split(',');
        const [h, m, s] = hms.split(':').map(Number);
        return (h * 3600) + (m * 60) + s + (parseInt(ms, 10) / 1000);
    }

    function highlightCurrentWord(currentTime) {
        const activeSubtitle = subtitles.find(sub => currentTime >= sub.start && currentTime <= sub.end);

        if (activeSubtitle && activeSubtitle.wordIndex !== currentWordIndex) {
            // Remove highlight from the previous word
            if (currentWordIndex !== -1) {
                const prevWordEl = document.querySelector(`span[data-word-index='${currentWordIndex}']`);
                if (prevWordEl) {
                    prevWordEl.classList.remove('highlight');
                }
            }

            // Highlight the new word
            const newWordIndex = activeSubtitle.wordIndex;
            const currentWordEl = document.querySelector(`span[data-word-index='${newWordIndex}']`);
            if (currentWordEl) {
                currentWordEl.classList.add('highlight');
                scrollToWord(currentWordEl);
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

    // --- Large Text Mode ---
    largeTextModeCheckbox.addEventListener('change', () => {
        if (largeTextModeCheckbox.checked) {
            document.body.classList.add('large-text-mode');
            textInput.style.display = 'none'; // Ensure it's hidden
        } else {
            document.body.classList.remove('large-text-mode');
            textInput.style.display = ''; // Restore default display
        }
        // Persist setting
        localStorage.setItem('largeTextMode', largeTextModeCheckbox.checked);
    });

    // Load saved large text mode setting
    const savedLargeTextMode = localStorage.getItem('largeTextMode');
    if (savedLargeTextMode === 'true') {
        largeTextModeCheckbox.checked = true;
        document.body.classList.add('large-text-mode');
        textInput.style.display = 'none';
    }
    
    // --- Theme Switching ---
    // Load saved theme from localStorage if available
    const savedTheme = localStorage.getItem('novelReaderTheme');
    if (savedTheme) {
        themeSelect.value = savedTheme;
        if (savedTheme === 'monochrome') {
            document.body.classList.add('theme-monochrome');
        }
    }
    
    // Handle theme changes
    themeSelect.addEventListener('change', () => {
        const selectedTheme = themeSelect.value;
        
        if (selectedTheme === 'monochrome') {
            document.body.classList.add('theme-monochrome');
        } else {
            document.body.classList.remove('theme-monochrome');
        }
        
        // Save theme preference to localStorage
        localStorage.setItem('novelReaderTheme', selectedTheme);
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
