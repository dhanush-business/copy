// auth.js (updated — safe, minimal fixes)
const BACKEND_URL = ""; // keep empty to use relative paths

document.addEventListener("DOMContentLoaded", () => {
    try { handleAutoLogin(); } catch (e) { console.warn("handleAutoLogin error", e); }

    const togglePass = document.getElementById("togglePass");
    const loginPassField = document.getElementById("loginPass");

    if (togglePass && loginPassField) {
        togglePass.addEventListener("click", () => {
            const isHidden = loginPassField.type === "password";
            loginPassField.type = isHidden ? "text" : "password";
            togglePass.classList.toggle("bx-hide");
            togglePass.classList.toggle("bx-show");
        });
    }

    // --- NEW: Added logic for signup password toggle ---
    const signupTogglePass = document.getElementById("signupTogglePass");
    const signupPassField = document.getElementById("signupPass");

    if (signupTogglePass && signupPassField) {
        signupTogglePass.addEventListener("click", () => {
            const isHidden = signupPassField.type === "password";
            signupPassField.type = isHidden ? "text" : "password";
            signupTogglePass.classList.toggle("bx-hide");
            signupTogglePass.classList.toggle("bx-show");
        });
    }
    // --- END NEW ---

    const loginBtn = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");

    if (loginBtn) loginBtn.addEventListener("click", loginUser);
    if (signupBtn) signupBtn.addEventListener("click", signupUser);

    document.getElementById("loginPass")?.addEventListener("keydown", (e) => {
        if (e.key === 'Enter') loginUser();
    });

    document.getElementById("signupPass")?.addEventListener("keydown", (e) => {
        if (e.key === 'Enter') signupUser();
    });

    setupOtpInputBehavior();
});

// --------------- Forgot Password helpers (safe add) ---------------

async function requestPasswordResetFrom(email, msgElement) {
    const msgEl = msgElement || { textContent: () => {}, style: {} };
    try {
        msgEl.textContent = "Requesting reset OTP...";
        const res = await fetch('/api/request_reset', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ email })
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.success) {
            msgEl.textContent = "If account exists, OTP is sent.";
            return true;
        } else {
            msgEl.textContent = j.message || "Request failed";
            return false;
        }
    } catch (e) {
        msgEl.textContent = "Network error";
        return false;
    }
}

// ✅ AUTO LOGIN
async function handleAutoLogin() {
    const savedUser = localStorage.getItem("luvisa_user");
    if (!savedUser) {
        setRandomBackground();
        return;
    }

    try {
        const response = await fetch(`${BACKEND_URL}/api/auto_login_check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: savedUser }),
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.isValid) {
            window.location.href = "/chat";
        } else {
            localStorage.removeItem("luvisa_user");
        }
    } catch (err) {
        localStorage.removeItem("luvisa_user");
    }
}

// ✅ Background Randomizer
function setRandomBackground() {
    const backgrounds = [
        "backgrounds/bg2.jpg",
        "backgrounds/bg2.jpg"
    ];
    const selected = backgrounds[Math.floor(Math.random() * backgrounds.length)];
    if (selected) document.body.style.backgroundImage = `url('${selected}')`;
}

// ✅ OTP Modal
function showOtpModal() {
    const otpModal = document.getElementById("otpModal");
    if (!otpModal) return;
    otpModal.classList.remove("hidden");
    const first = document.querySelector(".otp-input-group input");
    if (first) first.focus();
}
function hideOtpModal() {
    const otpModal = document.getElementById("otpModal");
    if (!otpModal) return;
    otpModal.classList.add("hidden");
}

// ✅ OTP Collect
function collectOtp() {
    const inputs = document.querySelectorAll(".otp-input-group input");
    if (!inputs || inputs.length === 0) return "";
    let otp = "";
    inputs.forEach(i => otp += (i.value || ""));
    return otp;
}

// ✅ OTP Input behavior ✅ Auto-move ✅ Auto-submit ✅ Auto-Backspace
function setupOtpInputBehavior() {
    const inputs = document.querySelectorAll(".otp-input-group input");
    if (!inputs || inputs.length === 0) return;

    inputs.forEach((input, index) => {
        input.addEventListener("input", () => {
            // keep only single char
            if (input.value && input.value.length > 1) {
                input.value = input.value.slice(-1);
            }
            if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
            if (index === inputs.length - 1 && input.value && document.getElementById("submitOtpBtn")) {
                document.getElementById("submitOtpBtn").click();
            }
        });

        input.addEventListener("paste", (e) => {
            // support paste for full OTP
            const paste = (e.clipboardData || window.clipboardData).getData('text');
            if (!paste) return;
            const chars = paste.replace(/\s+/g, '').slice(0, inputs.length).split('');
            chars.forEach((c, i) => {
                inputs[i].value = c;
            });
            e.preventDefault();
            if (document.getElementById("submitOtpBtn")) document.getElementById("submitOtpBtn").click();
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        });
    });
}

// ✅ Shake Animation for Wrong OTP
function triggerOtpShake() {
    const box = document.querySelector(".otp-box");
    if (!box) return;
    box.classList.add("shake");
    setTimeout(() => box.classList.remove("shake"), 400);
}

// ======================= SIGNUP =======================
// ✅ SIGNUP — send OTP then show Modal (with duplicate email check)
async function signupUser() {
    const emailEl = document.getElementById("signupEmail");
    const passEl = document.getElementById("signupPass");
    const msg = document.getElementById("signupMsg");
    if (!emailEl || !passEl || !msg) return;

    const email = emailEl.value.trim();
    const password = passEl.value.trim();
    msg.style.color = "#ffdae0";

    if (!email.includes("@") || password.length < 4) {
        msg.textContent = "Enter a valid email & password";
        return;
    }

    msg.textContent = "Checking email...";

    try {
        // Check if email already registered BEFORE OTP
        const checkExisting = await fetch(`${BACKEND_URL}/api/check_email`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ email })
        });

        const existsJson = await checkExisting.json().catch(() => ({}));
        if (checkExisting.ok && existsJson && existsJson.exists) {
            msg.textContent = "Email already registered. Try login.";
            return;
        }

        msg.textContent = "Sending OTP...";

        // Send OTP only if not existing
        const resp = await fetch(`${BACKEND_URL}/api/send_otp`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ email })
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            msg.textContent = data.message || "OTP failed ❌";
            return;
        }

        msg.textContent = "";
        showOtpModal();

        // Bind OTP submit (rebind ensures only one handler)
        const submitBtn = document.getElementById("submitOtpBtn");
        if (submitBtn) {
            submitBtn.onclick = () => {
                verifyOtpSignup(email, password);
            };
        }

    } catch (err) {
        console.error("signupUser error:", err);
        msg.textContent = "Server error. Try again.";
    }
}


// ✅ Verify OTP then finalize signup
async function verifyOtpSignup(email, password) {
    const otp = collectOtp();
    const errorBox = document.getElementById("otpError");
    if (!errorBox) return;

    const resp = await fetch(`${BACKEND_URL}/api/verify_otp`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email, otp })
    }).catch(e => ({ ok: false, status: 0 }));

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
        errorBox.textContent = data.message || "Invalid OTP ❌";
        triggerOtpShake();
        return;
    }

    hideOtpModal();

    // finalize signup
    await fetch(`${BACKEND_URL}/api/signup_verified`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ email, password })
    }).catch(e => {
        console.error("signup_verified error:", e);
    });

    window.location.href = "/login";
}

// ======================= LOGIN =======================
async function loginUser() {
    const emailEl = document.getElementById("loginEmail");
    const passEl = document.getElementById("loginPass");
    const msg = document.getElementById("loginMsg");
    if (!emailEl || !passEl || !msg) return;

    const email = emailEl.value.trim();
    const password = passEl.value.trim();

    if (!email || !password) {
        msg.textContent = "Enter login details";
        msg.style.color = "#ffdae0";
        return;
    }

    try {
        const resp = await fetch(`${BACKEND_URL}/api/login`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ email, password })
        });

        const data = await resp.json().catch(() => ({}));
        msg.textContent = data.message || "";

        if (resp.ok && data.success) {
            localStorage.setItem("luvisa_user", email);
            window.location.href = "/chat";
        }

    } catch (err) {
        console.error("loginUser error:", err);
        msg.textContent = "Server error.";
        msg.style.color = "#ffc2d1";
    }
}
