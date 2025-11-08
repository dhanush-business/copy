// --- Backend URL ---
const BACKEND_URL = ''; // Relative path
const PUBLIC_URL_BASE = window.location.origin; // Uses http://127.0.0.1:10000
// IMPORTANT: For production, change PUBLIC_URL_BASE to 'https://friendix-ai.onrender.com'

// --- Default Avatar Path (Served by Frontend/Vercel) ---
const DEFAULT_AVATAR_STATIC_PATH = "/avatars/default_avatar.png";

// --- Elements ---
const avatarPreview = document.getElementById('avatarPreview');
const avatarUpload = document.getElementById('avatarUpload');
const avatarWrapper = document.getElementById('avatarWrapper');
const displayNameInput = document.getElementById('displayNameInput');
const statusMessageInput = document.getElementById('statusMessageInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelBtn = document.getElementById('cancelBtn');
const saveMessage = document.getElementById('saveMessage');
const shareBtn = document.getElementById('shareBtn');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrWrapper = document.getElementById('qrWrapper'); // The new right-side box

let currentAvatarFile = null; // To hold the selected file object for upload
const MAX_AVATAR_SIZE_KB = 100; // --- INCREASED FROM 50 ---

// ---------- Initialization ----------
window.addEventListener('DOMContentLoaded', async () => {
    initializeProfilePage();
});

/**
 * Checks if we are viewing our own profile (from /chat)
 * or a public profile (from a shared link like /profile.html?id=FRD-XXXXXX)
 */
async function initializeProfilePage() {
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('id');
    const source = params.get('source');

    // --- NEW: QR CODE VIEW ---
    // If the URL has ?source=qr, add a class to the body to hide everything
    if (source === 'qr') {
        document.body.classList.add('qr-view');
    }

    if (urlId) {
        // --- PUBLIC VIEW ---
        // We are viewing someone else's profile.
        // Hide edit controls and load public data.
        if (saveProfileBtn) saveProfileBtn.style.display = 'none';
        if (shareBtn) shareBtn.style.display = 'inline-block'; // Show share button
        if (avatarWrapper) avatarWrapper.style.pointerEvents = 'none';
        if (avatarWrapper.querySelector('.avatar-overlay')) {
            avatarWrapper.querySelector('.avatar-overlay').style.display = 'none';
        }
        if (displayNameInput) displayNameInput.disabled = true;
        if (statusMessageInput) statusMessageInput.disabled = true;
        if (cancelBtn) cancelBtn.textContent = 'Go to Chat'; // Change button text
        
        if (cancelBtn) cancelBtn.addEventListener('click', () => window.location.href = 'chat');
        
        await loadPublicProfile(urlId);

    } else {
        // --- OWNER VIEW ---
        // We are viewing our own profile.
        // Show edit controls and load from localStorage.
        const username = localStorage.getItem('luvisa_user');
        if (!username) {
            window.location.href = 'login.html'; // Not logged in, go to login
            return;
        }

        if (saveProfileBtn) saveProfileBtn.style.display = 'inline-block'; // Show Save
        if (shareBtn) shareBtn.style.display = 'inline-block'; // Show Share
        
        // Setup owner-only listeners
        if (avatarWrapper) avatarWrapper.addEventListener('click', () => avatarUpload.click());
        if (avatarUpload) avatarUpload.addEventListener('change', handleAvatarChange);
        if (saveProfileBtn) saveProfileBtn.addEventListener('click', () => saveProfileChanges(username));
        if (cancelBtn) cancelBtn.addEventListener('click', () => window.location.href = 'chat');
        
        await loadCurrentProfile(username);
    }
}

/**
 * Loads a public profile using a Friend ID
 */
async function loadPublicProfile(friendId) {
    saveMessage.textContent = 'Loading profile...';
    try {
        const response = await fetch(`/api/profile_by_id?id=${encodeURIComponent(friendId)}`);
        const data = await response.json();

        if (response.ok && data.success && data.profile) {
            populateProfileData(data.profile);
            
            // --- UPDATED URL ---
            const publicUrl = `${PUBLIC_URL_BASE}/profile.html?id=${data.profile.friend_id}`;
            const qrUrl = `${PUBLIC_URL_BASE}/profile.html?id=${data.profile.friend_id}&source=qr`;
            
            generateQRCode(qrUrl);
            setupShareButton(publicUrl, data.profile.friend_id);
            saveMessage.textContent = '';
        } else {
             handleProfileError(data.message || 'Could not load profile.');
        }
    } catch (error) {
        handleProfileError('Network error loading profile.');
    }
}


/**
 * Loads the logged-in user's profile using their email
 */
async function loadCurrentProfile(email) {
    saveMessage.textContent = 'Loading profile...';
    try {
        const response = await fetch(`/api/profile?email=${encodeURIComponent(email)}`);
        const data = await response.json();

        if (response.ok && data.success && data.profile) {
            populateProfileData(data.profile);
            
            // --- UPDATED URL ---
            const publicUrl = `${PUBLIC_URL_BASE}/profile.html?id=${data.profile.friend_id}`;
            const qrUrl = `${PUBLIC_URL_BASE}/profile.html?id=${data.profile.friend_id}&source=qr`;
            
            generateQRCode(qrUrl);
            setupShareButton(publicUrl, data.profile.friend_id);
            saveMessage.textContent = '';
        } else {
             handleProfileError(data.message || 'Could not load profile.');
        }
    } catch (error) {
        handleProfileError('Network error loading profile.');
    }
}

/**
 * Fills all the HTML elements with data from a profile object
 */
function populateProfileData(profile) {
    if (displayNameInput) displayNameInput.value = profile.display_name;
    if (statusMessageInput) statusMessageInput.value = profile.status || 'Hey there! I’m using Luvisa 💗';

    if (profile.avatar) {
        avatarPreview.src = profile.avatar;
    } else {
        avatarPreview.src = DEFAULT_AVATAR_STATIC_PATH;
    }

    if (document.getElementById('friendshipYear')) {
        document.getElementById('friendshipYear').textContent = profile.creation_year;
    }
    if (document.getElementById('idCode')) {
        document.getElementById('idCode').textContent = profile.friend_id;
    }
    
    // --- REMOVED barcodeNumber logic ---

    const badge = document.getElementById('earlyUserBadge');
    if (badge && profile.is_early_user) {
        badge.style.display = 'inline-block';
    } else if (badge) {
        badge.style.display = 'none';
    }
}

/**
 * Handles errors during profile loading
 */
function handleProfileError(message) {
    console.error('Failed load profile:', message);
    if (saveMessage) {
        saveMessage.textContent = `Error: ${message}`;
        saveMessage.className = 'save-message error';
    }
    // Set defaults
    if (displayNameInput) displayNameInput.value = 'User Not Found';
    if (statusMessageInput) statusMessageInput.value = '---';
    if (avatarPreview) avatarPreview.src = DEFAULT_AVATAR_STATIC_PATH;
    if (qrWrapper) qrWrapper.style.display = 'none'; // Hide QR code if user not found
}


/**
 * Generates the QR Code
 */
function generateQRCode(qrUrl) {
    if (qrCodeContainer) {
        qrCodeContainer.innerHTML = ''; // Clear old QR code
        try {
            new QRCode(qrCodeContainer, {
                text: qrUrl, // Use the new QR-specific URL
                width: 180,
                height: 180,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        } catch (e) {
            console.error('QR Code generation failed:', e);
            qrCodeContainer.textContent = 'Could not load QR Code.';
        }
    }
}

/**
 * Sets up the Share button functionality
 */
function setupShareButton(publicUrl, friendId) {
    if (!shareBtn) return;
    
    shareBtn.addEventListener('click', async () => {
        try {
            // Try using the modern Web Share API
            if (navigator.share) {
                await navigator.share({
                    title: 'My Friendix ID',
                    text: `Add me on Friendix! My ID is ${friendId}`,
                    url: publicUrl
                });
            } else {
                // Fallback for desktop: Copy to clipboard
                await navigator.clipboard.writeText(publicUrl);
                saveMessage.textContent = 'Profile URL copied to clipboard!';
                saveMessage.className = 'save-message success';
                setTimeout(() => saveMessage.textContent = '', 2000);
            }
        } catch (err) {
            console.error('Share failed:', err);
            saveMessage.textContent = 'Could not share or copy URL.';
            saveMessage.className = 'save-message error';
            setTimeout(() => saveMessage.textContent = '', 2000);
        }
    });
}


// ---------- Handle Avatar Selection ----------
function handleAvatarChange(event) {
    const file = event.target.files[0];
    saveMessage.textContent = ''; // Clear message
    saveMessage.className = 'save-message';

    if (file && file.type.startsWith("image/")) {
        // Frontend size check
        if (file.size > MAX_AVATAR_SIZE_KB * 1024) {
             saveMessage.textContent = `Image too large! Please choose one under ${MAX_AVATAR_SIZE_KB} KB.`;
             saveMessage.className = 'save-message error';
             avatarUpload.value = ''; // Clear the selection
             currentAvatarFile = null;
             return;
        }

        currentAvatarFile = file; // Store the valid file object
        const reader = new FileReader();
        reader.onload = (e) => {
            avatarPreview.src = e.target.result; // Show preview
        };
        reader.readAsDataURL(file);
    } else {
        currentAvatarFile = null;
        if (file) {
            saveMessage.textContent = 'Please select a valid image file.';
            saveMessage.className = 'save-message error';
        }
    }
}

// ---------- Save Profile Changes ----------
async function saveProfileChanges(username) {
    const displayName = displayNameInput.value.trim();
    const statusMessage = statusMessageInput.value.trim();

    if (!displayName) { 
        saveMessage.textContent = 'Display name cannot be empty.';
        saveMessage.className = 'save-message error';
        return; 
    }

    saveProfileBtn.classList.add("loading");
    saveProfileBtn.disabled = true;
    saveMessage.textContent = 'Saving...';
    saveMessage.className = 'save-message'; // This makes it visible

    const formData = new FormData();
    formData.append('email', username);
    formData.append('display_name', displayName);
    formData.append('status_message', statusMessage);
    if (currentAvatarFile) {
        formData.append('avatar_file', currentAvatarFile); // Send the file
    }

    try {
        const response = await fetch(`/api/profile`, { // Relative URL
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (response.ok && data.success) {
            saveMessage.textContent = data.message;
            saveMessage.className = 'save-message success';

            populateProfileData(data.profile); // Re-use the populate function
            
            currentAvatarFile = null; // Reset file state
            avatarUpload.value = ''; // Clear the file input visually
             setTimeout(() => window.location.href = 'chat', 1500); // Go to /chat
        } else {
            if (response.status === 413) {
                 saveMessage.textContent = data.message || `Avatar image is too large (max ${MAX_AVATAR_SIZE_KB} KB).`;
            } else {
                 saveMessage.textContent = `Error: ${data.message || 'Failed to save profile.'}`;
            }
            saveMessage.className = 'save-message error';
        }
    } catch (error) {
        console.error('Save profile network error:', error);
        saveMessage.textContent = 'Network error saving profile.';
        saveMessage.className = 'save-message error';
    } finally {
        saveProfileBtn.classList.remove("loading");
        saveProfileBtn.disabled = false;
    }
}
