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
    let chatbox, userInput, sendBtn, notifySound, spaceNameHeader, timerDisplay, aiToggleCheckbox, leaveSpaceBtn; 

    // --- State ---
    let currentSpaceId = null;
    let spaceExpiryTime = null;
    let historyPollInterval = null;
    let timerInterval = null;
    let lastMessageCount = 0;
    
    const displayName = localStorage.getItem('luvisa_display_name') || 'A user';

    // --- Form Event Listeners ---
    createSpaceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        createError.textContent = '';
        const name = createSpaceName.value;
        const password = createSpacePassword.value;
        const withAI = document.getElementById('createWithAI').checked;

        try {
            const response = await fetch('/api/together/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    space_name: name, 
                    password: password, 
                    with_ai: withAI 
                })
            });
            const data = await response.json();

            if (response.ok && data.success) {
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
        spaceExpiryTime = new Date(expiresAt * 1000); 

        formsView.style.display = 'none';
        chatView.style.display = 'flex';

        // Find elements *after* view is visible
        chatbox = document.getElementById('chatbox');
        userInput = document.getElementById('userInput');
        sendBtn = document.getElementById('sendBtn');
        notifySound = document.getElementById('notifySound');
        spaceNameHeader = document.getElementById('spaceNameHeader');
        timerDisplay = document.getElementById('timerDisplay');
        aiToggleCheckbox = document.getElementById('aiToggleCheckbox');
        leaveSpaceBtn = document.getElementById('leaveSpaceBtn');
        
        leaveSpaceBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to leave this space?')) {
                window.location.href = 'together.html'; 
            }
        });
        
        aiToggleCheckbox.addEventListener('change', toggleAIState);
        
        spaceNameHeader.textContent = spaceName;

        sendBtn.addEventListener('click', sendMessage);
        userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendMessage();
        });

        startTimers();
        loadChatHistory(); // Load history (and AI state)
        historyPollInterval = setInterval(loadChatHistory, 3000); 
        
        setRandomBackground();
        
        userInput.focus();
    }

    function setRandomBackground() {
        const backgrounds = [ "backgrounds/bg1.jpg", "backgrounds/bg2.jpg", "backgrounds/bg3.jpg", "backgrounds/bg4.jpg", "backgrounds/bg5.jpg","backgrounds/bg6.jpg","backgrounds/bg7.jpg","backgrounds/bg8.jpg","backgrounds/bg10.jpg","backgrounds/bg12.jpg","backgrounds/bg13.jpg","backgrounds/bg14.jpg","backgrounds/bg15.jpg" ];
        const randomBg = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        
        const chatView = document.getElementById('chatView');
        if (chatView) {
            chatView.style.backgroundImage = `url('${randomBg}')`;
        }
    }

    async function toggleAIState() {
        if (!currentSpaceId || !aiToggleCheckbox) return;
        
        const newState = aiToggleCheckbox.checked;
        try {
            await fetch('/api/together/toggle_ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    space_id: currentSpaceId,
                    state: newState
                })
            });
        } catch (err) {
            console.error('Error toggling AI state:', err);
            aiToggleCheckbox.checked = !newState;
        }
    }

    function startTimers() {
        const totalDuration = 5 * 60 * 1000; 
        setTimeout(() => {
            alert('This Together Space will close in 30 seconds!');
        }, totalDuration - 30000);
        setTimeout(() => {
            stopSession('Space expired. Thank you for chatting!');
        }, totalDuration);
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
        window.location.href = 'together.html'; 
    }

    async function loadChatHistory() {
        if (!currentSpaceId || !chatbox) return;

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

            if (aiToggleCheckbox) {
                aiToggleCheckbox.checked = data.ai_active;
            }

            if (data.history.length === lastMessageCount) return;

            chatbox.innerHTML = ''; 
            data.history.forEach(m => {
                const isMe = (m.sender === 'user' && m.sender_name === displayName);
                appendMessage(m.sender, m.message, m.time, m.sender_name, isMe);
            });
            chatbox.scrollTop = chatbox.scrollHeight;
            lastMessageCount = data.history.length;
            
            if (data.history.length > 0 && data.history[data.history.length - 1].sender === 'luvisa') {
                if(notifySound) notifySound.play().catch(e => console.warn("Audio err:", e));
            }

        } catch (err) {
            console.error('History load error:', err);
        }
    }

    // --- THIS FUNCTION IS UPDATED ---
    async function sendMessage() {
        if (!userInput || !currentSpaceId) return; 
        const text = userInput.value.trim();
        if (!text) return;

        // --- THIS IS THE FIX ---
        // Add your message to the UI *immediately*
        appendMessage('user', text, null, displayName, true);
        // --- END OF FIX ---

        userInput.value = '';

        try {
            const response = await fetch(`/api/together/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    space_id: currentSpaceId, 
                    text: text, 
                    sender_name: displayName 
                })
            });

            if (!response.ok) {
                const data = await response.json();
                appendMessage('luvisa', data.message || "Sorry, an error occurred 😥", null, "Luvisa 💗", false);
                return; 
            }
            
            // Call this to fetch the AI's reply and sync with other users
            loadChatHistory(); 
            
        } catch (err) {
            appendMessage('luvisa', "Sorry, connection trouble 😥", null, "Luvisa 💗", false);
            console.error('Send network error:', err);
        }
    }
    // --- END OF UPDATED FUNCTION ---

    function appendMessage(type, text, atTime = null, senderName = "A user", isMe = false) {
        if (!chatbox) return; 
        
        const wrapper = document.createElement('div'); 
        
        if (type === 'luvisa') {
            wrapper.className = 'message luvisa-message'; 
        } else if (isMe) {
            wrapper.className = 'message user-message'; 
        } else {
            wrapper.className = 'message luvisa-message'; 
        }
        
        if (type === 'user' && !isMe) {
             const nameLabel = document.createElement('div');
             nameLabel.className = 'sender-name';
             nameLabel.textContent = senderName;
             wrapper.appendChild(nameLabel); 
        }
        
        const bubble = document.createElement('div'); 
        bubble.className = 'message-bubble';
        
        const msg = document.createElement('div'); 
        msg.className = 'message-text'; 
        msg.textContent = text; 
        
        const timeDiv = document.createElement('div'); 
        timeDiv.className = 'message-time'; 
        timeDiv.textContent = formatTime(atTime);

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
            if (isNaN(dt.getTime())) return atTime;
            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return atTime;
        }
    }

    function showTypingBubble() {
        if (!chatbox) return; 
        
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
