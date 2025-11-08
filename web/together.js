document.addEventListener('DOMContentLoaded', () => {
    // --- Views ---
    const formsView = document.getElementById('formsView');
    const chatView = document.getElementById('chatView');

    // --- Form Elements ---
    const createSpaceForm = document.getElementById('createSpaceForm');
    const createSpaceName = document.getElementById('createSpaceName');
    const createSpacePassword = document.getElementById('createSpacePassword');
    const createError = document.getElementById('createError');
    
    const joinSpaceForm = document.getElementById('joinSpaceForm');
    const joinSpaceName = document.getElementById('joinSpaceName');
    const joinSpacePassword = document.getElementById('joinSpacePassword');
    const joinError = document.getElementById('joinError');

    // --- Chat Elements ---
    const chatbox = document.getElementById('chatbox');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const notifySound = document.getElementById('notifySound');
    const spaceNameHeader = document.getElementById('spaceNameHeader');
    const timerDisplay = document.getElementById('timerDisplay');

    // --- State ---
    let currentSpaceId = null;
    let spaceExpiryTime = null;
    let historyPollInterval = null;
    let timerInterval = null;
    let lastMessageCount = 0;

    // --- Form Event Listeners ---
    createSpaceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        createError.textContent = '';
        const name = createSpaceName.value;
        const password = createSpacePassword.value;

        try {
            const response = await fetch('/api/together/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ space_name: name, password: password })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                // Success! Start the chat.
                startChatSession(data.space_id, data.expires_at, name);
            } else {
                createError.textContent = data.message || 'Failed to create space.';
            }
        } catch (err) {
            createError.textContent = 'Network error. Please try again.';
        }
    });

    joinSpaceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        joinError.textContent = '';
        const name = joinSpaceName.value;
        const password = joinSpacePassword.value;

        try {
            const response = await fetch('/api/together/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ space_name: name, password: password })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                // Success! Start the chat.
                startChatSession(data.space_id, data.expires_at, name);
            } else {
                joinError.textContent = data.message || 'Failed to join space.';
            }
        } catch (err) {
            joinError.textContent = 'Network error. Please try again.';
        }
    });

    // --- Chat Functions ---
    
    function startChatSession(spaceId, expiresAt, spaceName) {
        currentSpaceId = spaceId;
        spaceExpiryTime = new Date(expiresAt * 1000); // Convert UNIX timestamp to JS Date
        spaceNameHeader.textContent = spaceName;

        // Hide forms, show chat
        formsView.style.display = 'none';
        chatView.style.display = 'flex';

        // Add chat listeners
        sendBtn.addEventListener('click', sendMessage);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        // Start timers and polling
        startTimers();
        loadChatHistory(); // Load history once
        historyPollInterval = setInterval(loadChatHistory, 3000); // Poll every 3 seconds
        
        userInput.focus();
    }

    function startTimers() {
        const totalDuration = 5 * 60 * 1000; // 5 minutes

        // Warning timer (at 30 seconds left)
        setTimeout(() => {
            alert('This Together Space will close in 30 seconds!');
        }, totalDuration - 30000);

        // Final shutdown timer
        setTimeout(() => {
            stopSession('Space expired. Thank you for chatting!');
        }, totalDuration);

        // Countdown display timer
        timerInterval = setInterval(() => {
            const remaining = spaceExpiryTime.getTime() - Date.now();
            if (remaining <= 0) {
                timerDisplay.textContent = 'Closing...';
                return;
            }
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
            timerDisplay.textContent = `Time remaining: ${minutes}:${seconds}`;
        }, 1000);
    }
    
    function stopSession(message) {
        clearInterval(historyPollInterval);
        clearInterval(timerInterval);
        alert(message);
        window.location.href = 'together.html'; // Reload the page
    }

    async function loadChatHistory() {
        if (!currentSpaceId) return;

        try {
            const response = await fetch(`/api/together/history?space_id=${currentSpaceId}`);
            if (!response.ok) {
                if (response.status === 404) {
                    stopSession('This space has expired or was not found.');
                }
                return;
            }
            
            const data = await response.json();
            if (!data.success) return;

            // Only re-render if message count changed
            if (data.history.length === lastMessageCount) return;

            chatbox.innerHTML = ''; // Clear chatbox
            data.history.forEach(m => {
                appendMessage(m.sender === 'user' ? 'user' : 'luvisa', m.message, m.time);
            });
            chatbox.scrollTop = chatbox.scrollHeight;
            lastMessageCount = data.history.length;
            
            // Play sound if new message is from Luvisa
            if (data.history.length > 0 && data.history[data.history.length - 1].sender === 'luvisa') {
                notifySound.play().catch(e => console.warn("Audio err:", e));
            }

        } catch (err) {
            console.error('History load error:', err);
        }
    }

    // --- THIS FUNCTION IS NOW FIXED ---
    async function sendMessage() {
        const text = userInput.value.trim();
        if (!text || !currentSpaceId) return;

        userInput.value = '';
        const typing = showTypingBubble(); // Show typing bubble

        try {
            const response = await fetch(`/api/together/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ space_id: currentSpaceId, text: text })
            });

            // Remove the typing bubble *after* fetch completes
            if (typing?.parentNode) {
                typing.parentNode.removeChild(typing);
            }

            if (!response.ok) {
                // If server had an error, show it
                const data = await response.json();
                appendMessage('luvisa', data.message || "Sorry, an error occurred 😥");
                return; // Stop here
            }
            
            // Success! Immediately trigger a history load
            // The server already processed the message, so the poller will get it
            loadChatHistory();
            
        } catch (err) {
            // Network error
            if (typing?.parentNode) {
                typing.parentNode.removeChild(typing);
            }
            appendMessage('luvisa', "Sorry, connection trouble 😥");
            console.error('Send network error:', err);
        }
    }
    // --- END OF FIXED FUNCTION ---


    // --- Helper Functions (copied from script.js) ---
    function appendMessage(type, text, atTime = null) {
        const wrapper = document.createElement('div'); 
        wrapper.className = `message ${type}-message`;
        
        // In "Together" mode, all user messages are aligned left for simplicity
        if (type === 'user') {
             wrapper.className = `message luvisa-message`; // Use 'luvisa' style for left-align
        }
        
        const bubble = document.createElement('div'); 
        bubble.className = 'message-bubble';
        
        const msg = document.createElement('div'); 
        msg.className = 'message-text'; 
        msg.textContent = text;
        
        const timeDiv = document.createElement('div'); 
        timeDiv.className = 'message-time'; 
        timeDiv.textContent = formatTime(atTime);
        
        // Simple label for who sent it
        if (type === 'user') {
            msg.innerHTML = `<strong>A user:</strong><br>${text}`;
        }

        bubble.appendChild(msg);
        bubble.appendChild(timeDiv);
        wrapper.appendChild(bubble);
        chatbox.appendChild(wrapper);
        return wrapper;
    }

    function formatTime(atTime) {
        if (!atTime) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        try {
            const dateStr = atTime.includes('T') ? atTime : atTime.replace(' ', 'T') + 'Z';
            const dt = new Date(dateStr);
            if (isNaN(dt.getTime())) return atDmy.l.s.time;
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return atTime;
        }
    }

    function showTypingBubble() {
        const wrap = document.createElement('div'); 
        wrap.className = 'message luvisa-message typing-message';
        const bubble = document.createElement('div'); 
        bubble.className = 'message-bubble';
        bubble.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
        wrap.appendChild(bubble); 
        chatbox.appendChild(wrap); 
        chatbox.scrollTop = chatbox.scrollHeight; 
        return wrap;
    }
});
