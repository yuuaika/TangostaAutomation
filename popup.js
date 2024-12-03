document.addEventListener('DOMContentLoaded', function() {
    const apiKeyInput = document.getElementById('apiKey');
    const saveButton = document.getElementById('saveButton');
    const startButton = document.getElementById('startButton');
    const statusDiv = document.getElementById('status');
    const questionCountSpan = document.getElementById('questionCount');

    // Load saved API key and question count when popup opens
    chrome.storage.sync.get(['openaiApiKey', 'questionCount'], function(result) {
        if (result.openaiApiKey) {
            apiKeyInput.value = result.openaiApiKey;
            startButton.disabled = false;
            showStatus('API key is set', 'success');
        }
        
        // Update question count display
        questionCountSpan.textContent = result.questionCount || 0;
    });

    // Save API key when button is clicked
    saveButton.addEventListener('click', function() {
        const apiKey = apiKeyInput.value.trim();
        
        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }

        if (!apiKey.startsWith('sk-')) {
            showStatus('Invalid API key format. Key should start with "sk-"', 'error');
            return;
        }

        chrome.storage.sync.set({
            openaiApiKey: apiKey
        }, function() {
            showStatus('API key saved successfully!', 'success');
            startButton.disabled = false;
        });
    });

    // Handle start button click
    startButton.addEventListener('click', function() {
        // Send message to content script
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {command: "start_answering"});
            showStatus('Started answering questions!', 'success');
        });
    });

    // Add listener for question count updates
    chrome.storage.onChanged.addListener(function(changes, namespace) {
        if (changes.questionCount) {
            questionCountSpan.textContent = changes.questionCount.newValue;
        }
    });

    function showStatus(message, type) {
        statusDiv.textContent = message;
        statusDiv.className = `status ${type}`;
        
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
});