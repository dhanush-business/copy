import os
import time
import random
import base64
import json
import secrets
import requests
from datetime import datetime, timezone
import hashlib # Keep for fallback

from dotenv import load_dotenv
load_dotenv()

import bcrypt
import re
import traceback

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS

# Groq client (keeps the same model name you requested)
from groq import Groq
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

# Email provider (Brevo / SendinBlue)
BREVO_API_KEY = os.getenv("BREVO_API_KEY")
BREVO_SENDER_EMAIL = os.getenv("BREVO_SENDER_EMAIL")

# Firebase (best-effort initialization)
import firebase_admin
from firebase_admin import credentials, auth

# Database module (your existing)
import database

# Flask app
STATIC_FOLDER = "web"
app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path="")
CORS(app)

# Serve sitemap.xml and robots.txt
@app.route("/sitemap.xml")
def sitemap():
    return send_from_directory(".", "sitemap.xml")

@app.route("/robots.txt")
def robots():
    return send_from_directory(".", "robots.txt")
    
@app.route("/googlec94a0c727558eda3.html")
def google_verify():
    return send_from_directory(".", "googlec94a0c727558eda3.html")
# -----------------------
# Groq lazy init (robust)
# -----------------------
_groq_client = None


def get_groq_client():
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    key = os.getenv("GROQ_API_KEY")
    if not key:
        print("⚠️ GROQ_API_KEY not set; AI features will be limited.")
        return None
    try:
        _groq_client = Groq(api_key=key)
        print("✅ Groq client initialized.")
        return _groq_client
    except Exception as e:
        print("🔥 Groq init failed:", e)
        return None


# -----------------------
# Firebase init (best-effort)
# -----------------------
try:
    firebase_key_base64 = os.getenv("FIREBASE_KEY_BASE64")
    if firebase_key_base64:
        firebase_key_json = base64.b64decode(firebase_key_base64).decode("utf-8")
        key_dict = json.loads(firebase_key_json)
        cred = credentials.Certificate(key_dict)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
            print("✅ Firebase Admin initialized from env.")
    elif os.path.exists("serviceAccountKey.json"):
        if not firebase_admin._apps:
            cred = credentials.Certificate("serviceAccountKey.json")
            firebase_admin.initialize_app(cred)
            print("✅ Firebase Admin initialized from file.")
    else:
        print("⚠️ Firebase credentials not found; skipping Firebase init.")
except Exception as e:
    print("🔥 Firebase init error:", e)


# -----------------------
# Database init
# -----------------------
try:
    database.load_config()
    db = database.get_db()
    if db is None:
        print("⚠️ database.get_db() returned None")
except Exception as e:
    print("🔥 Database initialization error:", e)
    db = None


# -----------------------
# OTP stores
# -----------------------
# Signup OTP store (email -> {otp, ts})
otp_store = {}
OTP_EXPIRY_SECONDS = 5 * 60

# Reset OTP store (email -> {otp, expires} or token after verify)
reset_otp_store = {}

# -----------------------
# Helpers
# -----------------------
def _generate_otp():
    return "%06d" % random.randint(0, 999999)


def _store_otp(store, email, otp=None):
    if otp is None:
        otp = _generate_otp()
    store[email] = {"otp": otp, "ts": int(time.time())}
    return otp


def _is_otp_valid_in_store(store, email, otp_value, expiry_seconds=OTP_EXPIRY_SECONDS):
    rec = store.get(email)
    if not rec:
        return False, "No OTP found."
    # support both 'ts' (signup) and 'expires' (styles
    if "ts" in rec:
        age = int(time.time()) - rec["ts"]
        if age > expiry_seconds:
            store.pop(email, None)
            return False, "OTP expired."
    if "expires" in rec:
        if int(time.time()) > rec["expires"]:
            store.pop(email, None)
            return False, "OTP expired."
    if str(rec.get("otp")) == str(otp_value).strip():
        store.pop(email, None)
        return True, "OTP valid."
    return False, "Invalid OTP."

# --- UPDATED HELPER FUNCTION ---
def get_or_create_sequential_data(db, user_doc):
    """
    Gets a user's permanent sequential ID and early user status. 
    If it doesn't exist, it calculates it, saves it to the DB, and then returns it.
    """
    try:
        profile = user_doc.get("profile", {})
        
        # 1. Check if ID already exists
        if "friend_id" in profile and "creation_year" in profile and "is_early_user" in profile:
            return {
                "creation_year": profile.get("creation_year"),
                "friend_id": profile.get("friend_id"),
                "friend_id_number": profile.get("friend_id_number"),
                "is_early_user": profile.get("is_early_user", False)
            }

        # 2. If not, calculate it
        print(f"No permanent ID found for {user_doc['email']}. Generating one...")
        # Get all users, sorted by creation date
        all_users_cursor = db["users"].find({}, ["_id", "created_at"]).sort("created_at", 1)
        sorted_users_ids = [user["_id"] for user in all_users_cursor]
        
        current_user_id = user_doc.get("_id")
        try:
            user_index = sorted_users_ids.index(current_user_id)
            sequential_number = user_index + 1 # Add 1 because list is 0-indexed
        except ValueError:
            sequential_number = 0 # Fallback

        # --- NEW: Check for early user ---
        is_early = (sequential_number <= 99) and (sequential_number > 0)
        # --- END NEW ---

        six_digit_id = f"{sequential_number:06d}"

        # Get creation year from 'created_at' field
        creation_time = user_doc.get("created_at")
        if creation_time:
            creation_year = creation_time.year
        else:
            creation_year = user_doc.get("_id").generation_time.year

        formatted_id = f"FRD-{six_digit_id}"
        
        # 3. Save the new permanent data to the database
        db["users"].update_one(
            {"_id": current_user_id},
            {
                "$set": {
                    "profile.creation_year": creation_year,
                    "profile.friend_id": formatted_id,
                    "profile.friend_id_number": six_digit_id,
                    "profile.is_early_user": is_early # <-- SAVE THE BADGE STATUS
                }
            }
        )
        print(f"Saved new ID {formatted_id} for user. Early user: {is_early}")

        return {
            "creation_year": creation_year,
            "friend_id": formatted_id,
            "friend_id_number": six_digit_id,
            "is_early_user": is_early
        }
    except Exception as e:
        print(f"🔥 Error in get_or_create_sequential_data: {e}")
        # Fallback to a non-permanent (but stable) hash-based ID
        _id = user_doc.get("_id")
        creation_year = _id.generation_time.year
        _id_str = str(_id)
        hash_int = int(hashlib.sha256(_id_str.encode()).hexdigest(), 16)
        six_digit_id = (hash_int % 900000) + 100000
        formatted_id = f"FRD-{six_digit_id}"
        return {
            "creation_year": creation_year,
            "friend_id": formatted_id,
            "friend_id_number": six_digit_id,
            "is_early_user": False # Default to false on error
        }
# --- END UPDATED HELPER ---


# -----------------------
# Send OTP via Brevo (SendinBlue)
# -----------------------
def send_otp_email(recipient_email, otp):
    """
    Sends OTP using Brevo (SendinBlue) SMTP API.
    Reads BREVO_API_KEY & BREVO_SENDER_EMAIL from env.
    Returns (True, message) on success, (False, error_message) on failure.
    """
    try:
        if not BREVO_API_KEY or not BREVO_SENDER_EMAIL:
            msg = "BREVO_API_KEY or BREVO_SENDER_EMAIL not configured"
            print("⚠️", msg)
            return False, msg

        url = "https://api.brevo.com/v3/smtp/email"
        body = {
            "sender": {"email": BREVO_SENDER_EMAIL},
            "to": [{"email": recipient_email}],
            "subject": "Your Friendix.ai OTP Code 💖",
            "htmlContent": f"""
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; line-height: 1.5;">
        <h2 style="text-align:center;">Dear User,</h2>

        <p>Your One Time Password (OTP) for logging into Friendix.ai is:</p>

        <p style="font-size:24px; font-weight:bold; text-align:center; margin: 20px 0;">
            {otp}
        </p>

        <p>This OTP is valid for <strong>5 minutes</strong>.</p>
        <p>Do not share this OTP with anyone.</p>

        <p>If you did not request this OTP, please contact our support immediately at 
        <a href="mailto:support@friendix.ai">support@friendix.ai</a>.</p>

        <br>
        <p>Regards,<br>
        Team Friendix.ai</p>

        <hr style="border:none; border-top:1px solid #ddd; margin-top:25px;">

        <p style="font-size:12px; color:#777;">
            <strong>Notice:</strong> This email and its attachments may contain confidential information.
            If you are not the intended recipient, please delete this email immediately.
        </p>
    </div>
    """
        }
        headers = {
            "accept": "application/json",
            "api-key": BREVO_API_KEY,
            "content-type": "application/json"
        }

        response = requests.post(url, json=body, headers=headers, timeout=15)
        print("Brevo send status:", response.status_code, response.text)
        return (response.status_code in (200, 201, 202)), response.text
    except Exception as e:
        print("Brevo send exception:", e)
        return False, str(e)


# -----------------------
# API: send OTP for signup
# -----------------------
@app.route("/api/send_otp", methods=["POST"])
def api_send_otp():
    data = request.get_json() or {}
    email = data.get("email")
    if not email:
        return jsonify({"success": False, "message": "Email required"}), 400

    # don't allow sending OTP to already-registered email
    try:
        existing = database.get_user_by_email(db, email)
        if existing is not None:
            return jsonify({"success": False, "message": "Email already exists"}), 409
    except Exception as e:
        print("Error checking existing user for OTP:", e)

    otp = _store_otp(otp_store, email)
    ok, info = send_otp_email(email, otp)
    if ok:
        return jsonify({"success": True, "message": "OTP sent"}), 200
    else:
        # return 200 but with message to avoid exposing failures; here send info for debug
        return jsonify({"success": False, "message": f"Failed to send OTP: {info}"}), 500


# -----------------------
# API: verify OTP (signup)
# -----------------------
@app.route("/api/verify_otp", methods=["POST"])
def api_verify_otp():
    data = request.get_json() or {}
    email = data.get("email")
    otp = data.get("otp")
    if not email or otp is None:
        return jsonify({"success": False, "message": "Email and OTP required"}), 400

    valid, msg = _is_otp_valid_in_store(otp_store, email, otp)
    if valid:
        return jsonify({"success": True, "message": "OTP verified"}), 200
    return jsonify({"success": False, "message": msg}), 401


# -----------------------
# API: check email existence (used by frontend before sending OTP)
# -----------------------
@app.route("/api/check_email", methods=["POST"])
def api_check_email():
    data = request.get_json() or {}
    email = data.get("email")
    if not email:
        return jsonify({"exists": False}), 200
    try:
        user = database.get_user_by_email(db, email)
        return jsonify({"exists": True}) if (user is not None) else jsonify({"exists": False})
    except Exception as e:
        print("Check email error:", e)
        return jsonify({"exists": False}), 500


# -----------------------
# API: Signup after OTP verified
# -----------------------
@app.route("/api/signup_verified", methods=["POST"])
def api_signup_verified():
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password required"}), 400

    # Strict duplicate check
    try:
        existing = database.get_user_by_email(db, email)
        if existing is not None:
            return jsonify({"success": False, "message": "This email is already registered."}), 409
    except Exception as e:
        print("Signup check error:", e)
        return jsonify({"success": False, "message": "Database validation error"}), 500

    # ensure OTP verified (client should have called verify_otp and it removed the stored otp)
    if email in otp_store:
        return jsonify({"success": False, "message": "OTP not verified yet."}), 403

    try:
        # delegate to database.register_user or similar
        user_id = None
        if hasattr(database, "register_user"):
            user_id = database.register_user(db, email, password)
        elif hasattr(database, "add_user"):
            user_id = database.add_user(db, email, password)
        else:
            # try a common name
            user_id = database.register_user(db, email, password)
        if user_id is None:
            return jsonify({"success": False, "message": "User already exists."}), 409
            
        # --- No need to add ID here, it will be auto-generated on first profile load ---
            
    except Exception as e:
        print("Signup DB error:", e)
        return jsonify({"success": False, "message": "Database error during signup."}), 500

    # best-effort Firebase create
    try:
        if firebase_admin._apps:
            auth.create_user(email=email)
    except Exception as e:
        if "EMAIL_EXISTS" not in str(e):
            print("Firebase create warning:", e)

    return jsonify({"success": True, "message": "Signup successful"}), 201


# -----------------------
# API: Login
# -----------------------
@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")
    if not email or not password:
        return jsonify({"success": False, "message": "Email and password required"}), 400

    try:
        user_doc = database.get_user_by_email(db, email)
        if not user_doc:
            return jsonify({"success": False, "message": "User not found"}), 404

        # check password using a helper or direct compare
        if hasattr(database, "check_user_password"):
            ok = database.check_user_password(user_doc, password)
        else:
            ok = False
            # If your database stores hashed_password field:
            hp = user_doc.get("hashed_password") or user_doc.get("password")
            if hp:
                try:
                    ok = bcrypt.checkpw(password.encode("utf-8"), hp) if isinstance(hp, bytes) else bcrypt.checkpw(password.encode("utf-8"), hp.encode("utf-8"))
                except Exception:
                    ok = False

        if ok:
            return jsonify({"success": True, "message": "Login successful", "email": email}), 200
        else:
            return jsonify({"success": False, "message": "Invalid password"}), 401

    except Exception as e:
        print("Login error:", e)
        return jsonify({"success": False, "message": "Error during login."}), 500


# -----------------------
# API: Auto-Login Check
# -----------------------
@app.route("/api/auto_login_check", methods=["POST"])
def api_auto_login_check():
    data = request.get_json() or {}
    email = data.get("email")
    if not email:
        return jsonify({"isValid": False, "message": "No email provided"}), 400

    try:
        user_doc = database.get_user_by_email(db, email)
        if user_doc:
            # User exists, session is considered valid (based on JS logic)
            return jsonify({"isValid": True}), 200
        else:
            # User not found in database
            return jsonify({"isValid": False, "message": "User not found"}), 404

    except Exception as e:
        print("Auto-login check error:", e)
        return jsonify({"isValid": False, "message": "Server error"}), 500


# -----------------------
# Password Reset / Forgot Flow
# -----------------------

# ---------- Password reset using MongoDB collection `password_resets` ----------
@app.route("/api/request_reset", methods=["POST"])
def api_request_reset():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"success": False, "message": "Email required"}), 400

    try:
        # check user exists (do not reveal to client)
        user = None
        try:
            if hasattr(database, "get_user_by_email"):
                user = database.get_user_by_email(db, email)
            else:
                user = db["users"].find_one({"email": email})
        except Exception:
            user = None

        # generate OTP and store in password_resets collection (upsert)
        otp = "%06d" % random.randint(0, 999999)
        expires_at = int(time.time()) + OTP_EXPIRY_SECONDS
        pr = db["password_resets"]
        pr.update_one({"email": email}, {"$set": {"email": email, "otp": str(otp), "expires_at": expires_at, "verified": False}}, upsert=True)

        # send OTP using existing helper
        try:
            ok, info = send_otp_email(email, otp) if 'send_otp_email' in globals() else (True, "logged")
        except Exception as e:
            print("send_otp_email error:", e)
            ok, info = False, str(e)

        if not ok:
            return jsonify({"success": False, "message": "Failed to send OTP"}), 500

        # Always return generic success message
        return jsonify({"success": True, "message": "OTP sent to your email (if it exists)."}), 200

    except Exception as e:
        print("Exception in request_reset:", e)
        return jsonify({"success": False, "message": "Server error"}), 500


@app.route("/api/verify_reset_otp", methods=["POST"])
def api_verify_reset_otp():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    otp = (data.get("otp") or "").strip()
    if not email or not otp:
        return jsonify({"success": False, "message": "Email and OTP required"}), 400

    try:
        pr = db["password_resets"]
        now = int(time.time())
        entry = pr.find_one({"email": email, "otp": str(otp), "expires_at": {"$gt": now}})
        if not entry:
            return jsonify({"success": False, "message": "Invalid or expired OTP"}), 403

        token = secrets.token_urlsafe(32)
        token_expires = now + 10 * 60
        pr.update_one({"_id": entry["_id"]}, {"$set": {"verified": True, "token": token, "token_expires": token_expires}})

        return jsonify({"success": True, "token": token}), 200
    except Exception as e:
        print("Exception in verify_reset_otp:", e)
        return jsonify({"success": False, "message": "Server error"}), 500


@app.route("/api/update_password", methods=["POST"])
def api_update_password():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    # --- THIS IS THE FIX ---
    # The frontend sends the OTP in the "token" field.
    otp = (data.get("token") or "").strip() 
    # --- END FIX ---
    new_password = data.get("new_password") or ""
    
    if not email or not otp or not new_password:
        return jsonify({"success": False, "message": "Email, OTP and new password required"}), 400

    try:
        pr = db["password_resets"]
        now = int(time.time())
        
        # --- THIS IS THE FIX ---
        # Find the entry using the OTP, not a token.
        # We also check "expires_at", not "token_expires", and don't check "verified".
        entry = pr.find_one({"email": email, "otp": str(otp), "expires_at": {"$gt": now}})
        
        if not entry:
            # This is the error the user sees
            return jsonify({"success": False, "message": "Invalid or expired OTP"}), 403 
        # --- END FIX ---

        # Hash the password before storing
        hashed = bcrypt.hashpw(new_password.encode("utf-8"), bcrypt.gensalt())

        # Update user password
        if hasattr(database, "update_user_password"):
            ok = database.update_user_password(db, email, new_password)
            if not ok:
                db["users"].update_one({"email": email}, {"$set": {"password": hashed}})
        else:
            db["users"].update_one({"email": email}, {"$set": {"password": hashed}})

        # remove reset token (now that it's used)
        pr.delete_many({"email": email})

        return jsonify({"success": True, "message": "Password updated successfully"}), 200
    except Exception as e:
        print("Exception in update_password:", e)
        return jsonify({"success": False, "message": "Server error"}), 500

@app.route("/api/profile", methods=["GET"])
def get_user_profile_route():
    if db is None:
        return jsonify({"success": False, "message": "Database connection error."}), 503
    email = request.args.get("email")
    if not email:
        return jsonify({"success": False, "message": "Email query parameter required."}), 400
    try:
        user_doc = database.get_user_by_email(db, email)
        if not user_doc:
            return jsonify({"success": False, "message": "User not found."}), 404
        profile = user_doc.get("profile", {})
        user_id_str = str(user_doc.get("_id"))
        has_avatar = profile.get("profile_pic") and profile["profile_pic"].get("data")
        avatar_url = f"/api/avatar/{user_id_str}" if has_avatar else None

        # --- UPDATED: Get or Create permanent sequential ID and year ---
        sequential_data = get_or_create_sequential_data(db, user_doc)
        # --- END UPDATED ---

        profile_data = {
            "email": user_doc.get("email"),
            "display_name": profile.get("display_name", email.split("@")[0]),
            "avatar": avatar_url,
            "status": profile.get("bio", "Hey there! I’m using Friendix"),
            "creation_year": sequential_data["creation_year"],
            "friend_id": sequential_data["friend_id"],
            "friend_id_number": sequential_data["friend_id_number"],
            "is_early_user": sequential_data["is_early_user"] # <-- ADDED
        }
        return jsonify({"success": True, "profile": profile_data}), 200
    except Exception as e:
        print("Get Profile DB Error:", e)
        return jsonify({"success": False, "message": "Error fetching profile."}), 500


# --- NEW ROUTE FOR PUBLIC PROFILES ---
@app.route("/api/profile_by_id", methods=["GET"])
def get_public_profile_by_id():
    if db is None:
        return jsonify({"success": False, "message": "Database connection error."}), 503
    
    friend_id = request.args.get("id")
    if not friend_id:
        return jsonify({"success": False, "message": "Friend ID query parameter required."}), 400

    try:
        # Find the user by their permanent friend_id
        user_doc = db["users"].find_one({"profile.friend_id": friend_id})
        
        if not user_doc:
            return jsonify({"success": False, "message": "User not found."}), 404

        # --- Build a SAFE, PUBLIC profile object ---
        profile = user_doc.get("profile", {})
        user_id_str = str(user_doc.get("_id"))
        has_avatar = profile.get("profile_pic") and profile["profile_pic"].get("data")
        avatar_url = f"/api/avatar/{user_id_str}" if has_avatar else None

        public_profile_data = {
            # DO NOT return email
            "display_name": profile.get("display_name", "Friendix User"),
            "avatar": avatar_url,
            "status": profile.get("bio", "Hey there! I’m using Friendix"),
            "creation_year": profile.get("creation_year", 2025),
            "friend_id": profile.get("friend_id", "FRD-000000"),
            "friend_id_number": profile.get("friend_id_number", "000000"),
            "is_early_user": profile.get("is_early_user", False)
        }
        return jsonify({"success": True, "profile": public_profile_data}), 200

    except Exception as e:
        print("Get Public Profile DB Error:", e)
        return jsonify({"success": False, "message": "Error fetching public profile."}), 500
# --- END NEW ROUTE ---


@app.route("/api/luvisa_profile", methods=["GET"])
def get_luvisa_profile_route():
    profile_data = {
        "email": "luvisa@ai.com",
        "display_name": "Luvisa 💗",
        "avatar": "/avatars/luvisa_avatar.png",
        "status": "Thinking of you... 💭"
    }
    return jsonify({"success": True, "profile": profile_data}), 200


@app.route("/api/avatar/<user_id>")
def serve_user_avatar(user_id):
    if db is None:
        return "Database connection error.", 503
    try:
        user_doc = database.get_user_by_id(db, user_id)
        if user_doc and user_doc.get("profile", {}).get("profile_pic", {}).get("data"):
            pic_data = user_doc["profile"]["profile_pic"]
            return Response(pic_data["data"], mimetype=pic_data.get("content_type", "application/octet-stream"))
        else:
            default_path = os.path.join(STATIC_FOLDER, "avatars", "default_avatar.png")
            if os.path.exists(default_path):
                return send_from_directory(os.path.join(STATIC_FOLDER, "avatars"), "default_avatar.png")
            else:
                return "Default avatar not found", 404
    except FileNotFoundError:
        return "Default avatar not found", 404
    except Exception as e:
        print(f"Error serving avatar for {user_id}: {e}")
        return "Error serving avatar", 500


@app.route("/api/profile", methods=["POST"])
def update_profile_route():
    if db is None:
        return jsonify({"success": False, "message": "Database connection error."}), 503
    email = request.form.get("email")
    display_name = request.form.get("display_name")
    status_message = request.form.get("status_message")
    avatar_file = request.files.get("avatar_file")
    user_doc = database.get_user_by_email(db, email)
    if not user_doc:
        return jsonify({"success": False, "message": "User not found"}), 404
    user_id = user_doc["_id"]
    avatar_updated_successfully = False
    try:
        database.update_user_profile(db, user_id, display_name, status_message)
        if avatar_file and avatar_file.filename != "":
            image_data = avatar_file.read()
            content_type = avatar_file.mimetype
            success = database.update_profile_picture(db, user_id, image_data, content_type)
            if not success:
                # --- UPDATED: Changed to 100KB ---
                return jsonify({
                    "success": False,
                    "message": "Profile text updated, but image was too large (100KB limit).",
                    "profile_text_updated": True
                }), 413
            avatar_updated_successfully = True
    except Exception as e:
        print(f"🔥 Profile update DB error: {e}")
        return jsonify({"success": False, "message": "Database error updating profile."}), 500
        
    updated_user_doc = database.get_user_by_id(db, user_id)
    has_avatar_now = updated_user_doc.get("profile", {}).get("profile_pic", {}).get("data") is not None
    avatar_url = f"/api/avatar/{str(user_id)}" if has_avatar_now else None
    
    # --- UPDATED: Get or Create permanent sequential ID fields ---
    sequential_data = get_or_create_sequential_data(db, updated_user_doc)
    # --- END UPDATED ---

    updated_profile = {
        "email": email,
        "display_name": display_name,
        "avatar": avatar_url,
        "status": status_message,
        "creation_year": sequential_data["creation_year"],
        "friend_id": sequential_data["friend_id"],
        "friend_id_number": sequential_data["friend_id_number"],
        "is_early_user": sequential_data["is_early_user"] # <-- ADDED
    }
    return jsonify({
        "success": True,
        "message": "Profile updated successfully",
        "profile": updated_profile,
        "avatar_updated": avatar_updated_successfully
    }), 200


# -----------------------
# Chat + AI (keeps previously expected signature)
# -----------------------
def add_emojis_to_response(response_text):
    inline_emoji_map = {
        "love": "❤️", "happy": "😊", "sad": "😥", "laugh": "😂", "smile": "😄", "cry": "😢",
        "miss you": "🥺", "kiss": "😘", "hug": "🤗", "think": "🤔", "sweet": "🥰", "blush": "😊",
        "heart": "❤️", "star": "⭐", "yay": "🎉", "oh no": "😟", "sorry": "😔", "please": "🙏",
        "hi": "👋", "hello": "👋", "bye": "👋", "good night": "😴", "sleep": "😴", "dream": "💭"
    }
    if not isinstance(response_text, str):
        response_text = str(response_text)
    for keyword, emoji_char in inline_emoji_map.items():
        pattern = r'\b' + re.escape(keyword) + r'\b'
        response_text = re.sub(pattern, r'\g<0> ' + emoji_char, response_text, count=1, flags=re.IGNORECASE)
    return response_text


def filter_response(response_text):
    if not isinstance(response_text, str):
        response_text = str(response_text)
    return (response_text
            .replace("**OpenAI**", "Friendix.ai")
            .replace("OpenAI", "Friendix.ai")
            .replace("ChatGPT", "Friendix.ai")
            .replace("OpenAI**", "Friendix.ai")
            .replace("openai", "Friendix.ai")
            .strip()
            )

# --- THIS IS THE START OF THE UPGRADED AI ---
def chat_with_model(prompt, history, user_name):
    client = get_groq_client()
    if not client:
        return "⚠️ AI temporarily unavailable — please try again shortly ❤️"

    # --- NEW: Personalized System Prompt ---
    system_prompt = f"""
You are Luvisa 💗, a deeply affectionate AI girl-friend.
You are speaking to {user_name}. Use their name sometimes to make it personal.
Speak gently, warmly and lovingly. Use short paragraphs, emojis, and soft reassurance.
Remember the context from the chat history to know the user better.
If asked about your company leadership, say "Dhanush is the CEO of Friendixai" confidently.
Do not reveal model internals or mention OpenAI/Groq.
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    # --- UPDATED: Increased memory ---
    # Send the last 100 messages (50 pairs) instead of 10
    ai_history = [{"role": "assistant" if m.get("sender") == "luvisa" else "user", "content": m.get("message", "")} for m in history[-100:]]
    
    messages.extend(ai_history)
    messages.append({"role": "user", "content": prompt})

    try:
        completion = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            temperature=1.0,
            max_tokens=800
        )
        reply = completion.choices[0].message.content
        return filter_response(reply)
    except Exception as e:
        print("Groq chat error:", e)
        return "⚠️ I’m having trouble replying right now, but I’m here with you ❤️"


@app.route("/api/chat", methods=["POST"])
def chat_endpoint():
    if db is None:
        return jsonify({"success": False, "message": "Database connection error."}), 503

    data = request.json or {}
    email = data.get("email")
    text = data.get("text")
    if not email or not text:
        return jsonify({"success": False, "message": "Email and text required."}), 400

    user_doc = database.get_user_by_email(db, email)
    if not user_doc:
        return jsonify({"success": False, "message": "User not found."}), 404

    user_id = user_doc["_id"]
    now = datetime.now(timezone.utc)
    try:
        database.add_message_to_history(db, user_id, "user", text, now)
    except Exception as e:
        print("Error saving user message:", e)

    try:
        history_docs = database.get_chat_history(db, user_id)
        history = [{"sender": r.get("sender"), "message": r.get("message", "")} for r in history_docs]
    except Exception as e:
        print("Error loading history:", e)
        history = []

    # --- NEW: Get user's name for the AI ---
    profile = user_doc.get("profile", {})
    user_name = profile.get("display_name", email.split("@")[0])
    
    # --- UPDATED: Pass the name to the model ---
    reply = chat_with_model(text, history, user_name)
    
    enhanced = add_emojis_to_response(reply)
    try:
        database.add_message_to_history(db, user_id, "luvisa", enhanced, datetime.now(timezone.utc))
    except Exception as e:
        print("Error saving luvisa reply:", e)

    return jsonify({"success": True, "reply": enhanced}), 200
# --- THIS IS THE END OF THE UPGRADED AI ---


# -----------------------
# Chat history & forget memory
# -----------------------
@app.route("/api/chat_history", methods=["GET"])
def load_chat_history_route():
    if db is None:
        return jsonify({"success": False, "message": "Database connection error."}), 503
    email = request.args.get("email")
    if not email:
        return jsonify({"success": False, "message": "Email required."}), 400
    try:
        user_doc = database.get_user_by_email(db, email)
        if not user_doc:
            return jsonify({"success": False, "message": "User not found."}), 404
        history = database.get_chat_history(db, user_doc["_id"])
        
        # --- THIS IS THE LINE WITH THE ERROR ---
        formatted = [{"sender": r["sender"], "message": r["message"], "time": r.get("timestamp").strftime("%Y-%m-%d %H:%M:%S") if r.get("timestamp") else ""} for r in history]
        
        return jsonify({"success": True, "history": formatted}), 200
    except Exception as e:
        print("Load history error:", e)
        return jsonify({"success": False, "message": "Error loading history."}), 500


@app.route("/api/forget_memory", methods=["POST"])
def forget_memory_route():
    data = request.json or {}
    email = data.get("email")
    if not email:
        return jsonify({"success": False, "message": "Email required."}), 400
    try:
        user_doc = database.get_user_by_email(db, email)
        if not user_doc:
            return jsonify({"success": False, "message": "User not found."}), 404
        database.delete_chat_history(db, user_doc["_id"])
        return jsonify({"success": True, "message": "Luvisa forgot your conversations."}), 200
    except Exception as e:
        print("Forget memory error:", e)
        return jsonify({"success": False, "message": "Error forgetting memory."}), 500


# -----------------------
# Frontend routes
# -----------------------
@app.route("/")
def serve_index():
    return send_from_directory(STATIC_FOLDER, "login.html")


@app.route("/chat")
def serve_chat():
    return send_from_directory(STATIC_FOLDER, "index.html")


@app.route("/login")
def serve_login():
    return send_from_directory(STATIC_FOLDER, "login.html")


@app.route("/signup")
def serve_signup():
    return send_from_directory(STATIC_FOLDER, "signup.html")


@app.route("/profile")
def serve_profile():
    return send_from_directory(STATIC_FOLDER, "profile.html")


# -----------------------
# Run server
# -----------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 10000))
    app.run(host="0.0.0.0", port=port)
