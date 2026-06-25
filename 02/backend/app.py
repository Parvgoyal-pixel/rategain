from flask import Flask, request, jsonify, session, redirect, url_for
from urllib.parse import urlparse
from flask_cors import CORS
from flask_session import Session
import sqlite3
import os
import json
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

app = Flask(__name__)
CORS(app, supports_credentials=True)

app.secret_key = "CHANGE_THIS_TO_RANDOM_SECRET"

firebase_creds_json = os.environ.get("FIREBASE_CREDENTIALS")
if firebase_creds_json:
    cred_dict = json.loads(firebase_creds_json)
    cred = credentials.Certificate(cred_dict)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    cred_path = os.path.join(BASE_DIR, "..", "..", "rategain-d3708-firebase-adminsdk-fbsvc-76c80d10de.json")
    cred = credentials.Certificate(os.path.abspath(cred_path))

try:
    firebase_admin.initialize_app(cred)
except ValueError:
    pass # Already initialized
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_COOKIE_NAME"] = "sso_cookie_b"

if os.environ.get("FLASK_ENV") == "production":
    app.config["SESSION_COOKIE_SAMESITE"] = "None"
    app.config["SESSION_COOKIE_SECURE"] = True




Session(app)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, "users.db")

def get_db_connection():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db_connection() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NULL,
                role TEXT DEFAULT 'User'
            )
        ''')
        try:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'User'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT NULL")
        except sqlite3.OperationalError:
            pass
        conn.commit()

init_db()

@app.route("/login-firebase", methods=["POST"])
def login_firebase():
    data = request.json
    id_token = data.get("idToken")
    if not id_token:
        return jsonify({"error": "Missing token"}), 400
        
    try:
        decoded_token = firebase_auth.verify_id_token(id_token)
        uid = decoded_token.get("uid")
        email = decoded_token.get("email")
        name = decoded_token.get("name", email.split('@')[0] if email else "User")
        
        conn = get_db_connection()
        existing = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        
        if not existing:
            conn.execute("INSERT INTO users (name, email, role) VALUES (?, ?, ?)", (name, email, 'User'))
            conn.commit()
            role = 'User'
        else:
            role = existing["role"] if existing["role"] else "User"
            
        conn.close()
        
        session["user"] = {
            "name": name,
            "email": email,
            "role": role,
            "uid": uid
        }
        
        return jsonify({"message": "Logged in successfully", "user": session["user"]})
    except Exception as e:
        print(f"Firebase auth error: {e}")
        return jsonify({"error": "Invalid token"}), 401

@app.route("/sso-check")
def sso_check():
    redirect_url = request.args.get("redirect")
    if not redirect_url:
        return jsonify({"error": "Missing redirect url"}), 400
        
    # Prevent Open Redirect Vulnerability
    allowed_domains_env = os.environ.get("ALLOWED_DOMAINS")
    if allowed_domains_env:
        ALLOWED_DOMAINS = [d.strip() for d in allowed_domains_env.split(",")]
    else:
        ALLOWED_DOMAINS = ["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]
    parsed_url = urlparse(redirect_url)
    if parsed_url.netloc not in ALLOWED_DOMAINS:
        return jsonify({"error": "Unauthorized redirect domain"}), 403
        
    user_data = session.get("user")
    if user_data and "uid" in user_data:
        try:
            custom_token = firebase_auth.create_custom_token(user_data["uid"])
            token_str = custom_token.decode("utf-8") if isinstance(custom_token, bytes) else custom_token
            return redirect(f"{redirect_url}?token={token_str}")
        except Exception as e:
            print(f"Error creating custom token: {e}")
            return redirect(f"{redirect_url}?error=token_generation_failed")
    else:
        return redirect(f"{redirect_url}?error=not_logged_in")

@app.route("/sso-check-ajax")
def sso_check_ajax():
    user_data = session.get("user")
    if user_data and "uid" in user_data:
        try:
            custom_token = firebase_auth.create_custom_token(user_data["uid"])
            token_str = custom_token.decode("utf-8") if isinstance(custom_token, bytes) else custom_token
            return jsonify({"token": token_str})
        except Exception as e:
            print(f"Error creating custom token: {e}")
            return jsonify({"error": "token_generation_failed"}), 500
    else:
        return jsonify({"error": "not_logged_in"}), 401

@app.route("/user")
def user():
    user_data = session.get("user")
    if user_data:
        email = user_data.get("email")
        name = user_data.get("name", "")
        role = "User"
        
        conn = get_db_connection()
        existing = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        
        if not existing:
            conn.execute("INSERT INTO users (name, email, role) VALUES (?, ?, ?)", (name, email, role))
            conn.commit()
        else:
            # existing is a sqlite3.Row, it acts like a dict
            role = existing["role"] if existing["role"] else "User"
        conn.close()

        user_data["role"] = role
        return jsonify({"user": user_data})
    return jsonify({"error": "Not logged in"}), 401

@app.route("/logout")
def logout():
    session.pop("user", None)
    return jsonify({"message": "Logged out successfully"})



if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5001,
        debug=True
    )