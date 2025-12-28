/**
 * Voice AI Pipeline - Frontend Application
 * Handles file upload, API communication, and audio playback
 */

// DOM Elements
const backendUrlInput = document.getElementById('backend-url');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const filePreview = document.getElementById('file-preview');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const removeFileBtn = document.getElementById('remove-file');
const processBtn = document.getElementById('process-btn');
const loadingSection = document.getElementById('loading-section');
const loadingText = document.getElementById('loading-text');
const responseSection = document.getElementById('response-section');
const audioPlayer = document.getElementById('audio-player');
const newRecordingBtn = document.getElementById('new-recording-btn');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');

// Step indicators
const stepStt = document.getElementById('step-stt');
const stepLlm = document.getElementById('step-llm');
const stepTts = document.getElementById('step-tts');

// State
let selectedFile = null;

/**
 * Format file size to human readable string
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Show a section and hide others
 */
function showSection(section) {
    // Hide all dynamic sections
    loadingSection.style.display = 'none';
    responseSection.style.display = 'none';
    errorSection.style.display = 'none';
    
    // Show the requested section
    if (section) {
        section.style.display = 'block';
    }
}

/**
 * Reset the upload state
 */
function resetUpload() {
    selectedFile = null;
    fileInput.value = '';
    filePreview.style.display = 'none';
    uploadZone.style.display = 'block';
    processBtn.disabled = true;
    showSection(null);
}

/**
 * Handle file selection
 */
function handleFileSelect(file) {
    if (!file) return;
    
    // Validate file type
    const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/mp4'];
    const extension = file.name.toLowerCase().split('.').pop();
    const validExtensions = ['wav', 'mp3', 'm4a'];
    
    if (!validTypes.includes(file.type) && !validExtensions.includes(extension)) {
        showError('Invalid file type. Please upload a WAV, MP3 or M4A file.');
        return;
    }
    
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    filePreview.style.display = 'flex';
    uploadZone.style.display = 'none';
    processBtn.disabled = false;
}

/**
 * Show error message
 */
function showError(message) {
    errorMessage.textContent = message;
    showSection(errorSection);
}

/**
 * Update loading step status
 */
function updateStep(step, status) {
    const steps = [stepStt, stepLlm, stepTts];
    steps.forEach(s => {
        s.classList.remove('active', 'completed');
    });
    
    if (step === 'stt') {
        stepStt.classList.add('active');
        loadingText.textContent = 'Transcribing your audio...';
    } else if (step === 'llm') {
        stepStt.classList.add('completed');
        stepLlm.classList.add('active');
        loadingText.textContent = 'Generating AI response...';
    } else if (step === 'tts') {
        stepStt.classList.add('completed');
        stepLlm.classList.add('completed');
        stepTts.classList.add('active');
        loadingText.textContent = 'Creating audio response...';
    } else if (step === 'done') {
        stepStt.classList.add('completed');
        stepLlm.classList.add('completed');
        stepTts.classList.add('completed');
        loadingText.textContent = 'Complete!';
    }
}

/**
 * Process the audio file
 */
async function processAudio() {
    if (!selectedFile) return;
    
    const backendUrl = backendUrlInput.value.trim();
    if (!backendUrl) {
        showError('Please enter the backend URL.');
        return;
    }
    
    // Show loading state
    document.querySelector('.upload-section').style.display = 'none';
    showSection(loadingSection);
    updateStep('stt');
    
    try {
        // Create form data
        const formData = new FormData();
        formData.append('audio_file', selectedFile);
        
        // Simulate step progression (since we can't get real-time updates from the backend)
        const stepTimer1 = setTimeout(() => updateStep('llm'), 3000);
        const stepTimer2 = setTimeout(() => updateStep('tts'), 6000);
        
        // Make API request
        const response = await fetch(`${backendUrl.replace(/\/$/, '')}/process_audio`, {
            method: 'POST',
            body: formData,
            headers: {
                'ngrok-skip-browser-warning': 'true'
            }
        });
        
        // Clear step timers
        clearTimeout(stepTimer1);
        clearTimeout(stepTimer2);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Update to complete
        updateStep('done');
        
        // Wait a moment to show completion
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Get the audio URL
        const audioUrl = `${backendUrl.replace(/\/$/, '')}/${data.response_audio_url}`;
        
        // Show response section
        audioPlayer.src = audioUrl;
        showSection(responseSection);
        
        // Auto-play the audio
        try {
            await audioPlayer.play();
        } catch (e) {
            // Auto-play might be blocked, user can click play manually
            console.log('Auto-play blocked, user can click play manually');
        }
        
    } catch (error) {
        console.error('Error processing audio:', error);
        showError(error.message || 'Failed to process audio. Please check the backend is running and try again.');
        document.querySelector('.upload-section').style.display = 'block';
    }
}

// Event Listeners

// Click to upload
uploadZone.addEventListener('click', () => {
    fileInput.click();
});

// File input change
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
    }
});

// Drag and drop
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

// Remove file
removeFileBtn.addEventListener('click', () => {
    resetUpload();
});

// Process button
processBtn.addEventListener('click', () => {
    processAudio();
});

// New recording button
newRecordingBtn.addEventListener('click', () => {
    document.querySelector('.upload-section').style.display = 'block';
    resetUpload();
});

// Retry button
retryBtn.addEventListener('click', () => {
    document.querySelector('.upload-section').style.display = 'block';
    showSection(null);
});

// Prevent default drag behavior on document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
});

// Initialize
console.log('Voice AI Pipeline frontend loaded successfully!');
