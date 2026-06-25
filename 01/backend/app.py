from flask import Flask, request, jsonify, session, redirect, url_for
from urllib.parse import urlparse
from flask_cors import CORS
from flask_session import Session

import mysql.connector
from mysql.connector import Error


import os
import json
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

app = Flask(__name__)
app.secret_key = "CHANGE_THIS_TO_RANDOM_SECRET"

allowed_domains_env = os.environ.get("ALLOWED_DOMAINS")
if allowed_domains_env:
    ALLOWED_DOMAINS = [d.strip() for d in allowed_domains_env.split(",")]
    CORS_ORIGINS = [f"https://{d}" for d in ALLOWED_DOMAINS] + ["http://localhost:3000", "http://localhost:3001"]
else:
    ALLOWED_DOMAINS = ["localhost:3000", "localhost:3001", "127.0.0.1:3000", "127.0.0.1:3001"]
    CORS_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]

CORS(app, supports_credentials=True, origins=CORS_ORIGINS)
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
    pass

# Clerk handles multi-domain SSO, so we no longer need complex cross-domain cookies!

DB_CONFIG = {
    'host': os.environ.get('DB_HOST', 'localhost'),
    'user': os.environ.get('DB_USER', 'root'),
    'password': os.environ.get('DB_PASSWORD', ''),
    'port': int(os.environ.get('DB_PORT', 23221)),
    'ssl_disabled': False
}
DB_NAME = os.environ.get('DB_NAME', 'usersDB')

def get_db_connection():
    """Establishes and returns a connection to MySQL."""
    config = DB_CONFIG.copy()
    config['database'] = DB_NAME
    conn = mysql.connector.connect(**config)
    return conn

def init_db():
    print("Initializing database schema...")
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
    conn.database = DB_NAME
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NULL,
            role VARCHAR(50) DEFAULT 'Admin',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sso_tokens (
            token VARCHAR(255) PRIMARY KEY,
            uid VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    conn.commit()
    
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'Admin'")
        conn.commit()
    except Error:
        pass
        
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL")
        conn.commit()
    except Error:
        pass
        
    cursor.close()
    conn.close()
    print("Database schema initialized!")

# Run initialization exactly once when the server starts
try:
    init_db()
except Exception as e:
    print(f"Warning: Database initialization failed: {e}")


@app.route("/")
def home():
    return jsonify({"status": "App A Backend is running properly!"})

@app.route("/user")
def user():
    user_data = session.get("user")
    if user_data:
        email = user_data.get("email")
        name = user_data.get("name", "")
        role = "Admin"
        
        conn = None
        try:
            conn = get_db_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
            existing = cursor.fetchone()
            
            if not existing:
                cursor.execute("INSERT INTO users (name, email, role) VALUES (%s, %s, %s)", (name, email, role))
                conn.commit()
            else:
                role = existing.get("role", "Admin") or "Admin"
            cursor.close()
        except Error as e:
            print(f"Database error in /user: {e}")
        finally:
            if conn and conn.is_connected():
                conn.close()

        user_data["role"] = role
        return jsonify({"user": user_data})
    return jsonify({"error": "Not logged in"}), 401

@app.route("/logout")
def logout():
    session.pop("user", None)
    return jsonify({"message": "Logged out successfully"})

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
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
        existing = cursor.fetchone()
        
        if not existing:
            cursor.execute("INSERT INTO users (name, email, role) VALUES (%s, %s, %s)", (name, email, 'Admin'))
            conn.commit()
            role = 'Admin'
        else:
            role = existing.get("role", "Admin") or "Admin"
            
        cursor.close()
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

import uuid

@app.route("/generate-sso-token", methods=["POST"])
def generate_sso_token():
    data = request.json
    id_token = data.get("idToken")
    if not id_token:
        return jsonify({"error": "Missing token"}), 400
    
    try:
        decoded_token = firebase_auth.verify_id_token(id_token)
        uid = decoded_token.get("uid")
        
        sso_token = str(uuid.uuid4())
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("INSERT INTO sso_tokens (token, uid) VALUES (%s, %s)", (sso_token, uid))
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({"sso_token": sso_token})
    except Exception as e:
        return jsonify({"error": str(e)}), 401

@app.route("/verify-sso-token", methods=["POST"])
def verify_sso_token():
    data = request.json
    sso_token = data.get("sso_token")
    if not sso_token:
        return jsonify({"error": "Missing sso_token"}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM sso_tokens WHERE token = %s", (sso_token,))
    token_row = cursor.fetchone()
    
    if token_row:
        uid = token_row["uid"]
        cursor.execute("DELETE FROM sso_tokens WHERE token = %s", (sso_token,))
        conn.commit()
        cursor.close()
        conn.close()
        
        custom_token = firebase_auth.create_custom_token(uid)
        token_str = custom_token.decode("utf-8") if isinstance(custom_token, bytes) else custom_token
        return jsonify({"firebase_token": token_str})
    else:
        cursor.close()
        conn.close()
        return jsonify({"error": "Invalid or expired token"}), 401

if __name__ == "__main__":
    app.run(debug=True)