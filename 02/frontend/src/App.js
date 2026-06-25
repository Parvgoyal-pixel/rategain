import axios from "axios";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import { auth } from "./firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithCustomToken, signOut, onAuthStateChanged, updateProfile } from "firebase/auth";

axios.defaults.withCredentials = true;

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
const OTHER_APP_URL = process.env.REACT_APP_OTHER_APP_URL || "http://localhost:3000";
const OTHER_BACKEND_URL = process.env.REACT_APP_OTHER_BACKEND_URL || "http://localhost:5000";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [authError, setAuthError] = useState("");
  const isLoggingOut = useRef(false);

  useEffect(() => {
    let unsubscribe = null;

    const setupAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      const redirectUri = urlParams.get('redirect');
      const ssoToken = urlParams.get('sso_token');

      const ssoCheck = urlParams.get('sso_check');

      if (action === 'logout') {
        isLoggingOut.current = true;
        try {
          await signOut(auth);
          await axios.get(`${BACKEND_URL}/logout`);
        } catch (err) {
          console.error("Logout sync failed", err);
        }
        if (redirectUri) {
          window.location.href = redirectUri;
        } else {
          window.history.replaceState({}, document.title, window.location.pathname);
          setLoading(false);
        }
        return; 
      }

      if (ssoToken && ssoToken !== "none") {
        try {
          const res = await axios.post(`${OTHER_BACKEND_URL}/verify-sso-token`, { sso_token: ssoToken });
          await signInWithCustomToken(auth, res.data.firebase_token);
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch(e) {
          console.error("SSO Token Verification Failed:", e);
        }
      } else if (ssoToken === "none") {
        sessionStorage.setItem("has_checked_sso", "true");
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          if (ssoCheck && redirectUri) {
             try {
                const idToken = await firebaseUser.getIdToken();
                const res = await axios.post(`${OTHER_BACKEND_URL}/generate-sso-token`, { idToken });
                window.location.href = `${redirectUri}?sso_token=${res.data.sso_token}`;
                return;
             } catch(e) {
                console.error(e);
             }
          }

          try {
            const idToken = await firebaseUser.getIdToken();
            const res = await axios.post(`${BACKEND_URL}/login-firebase`, { idToken });
            setUser(res.data.user);
          } catch (error) {
            console.error("Backend login failed:", error);
            setUser(null);
          }
          setLoading(false);
        } else {
          setUser(null);
          
          if (ssoCheck && redirectUri) {
             window.location.href = `${redirectUri}?sso_token=none`;
             return;
          }

          if (isLoggingOut.current) {
            setLoading(false);
            return;
          }
          
          if (!ssoToken && !sessionStorage.getItem("has_checked_sso")) {
             sessionStorage.setItem("has_checked_sso", "true");
             window.location.href = `${OTHER_APP_URL}?sso_check=true&redirect=${window.location.href}`;
             return;
          }

          setLoading(false);
        }
      });
    };

    setupAuth();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleLocalAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const encryptedPassword = btoa(password); 
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, encryptedPassword);
        await updateProfile(userCredential.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, encryptedPassword);
      }
    } catch (err) {
      setAuthError(err.message || "An error occurred");
    }
  };

  const handleLogout = async () => {
    isLoggingOut.current = true;
    try {
      await signOut(auth);
      await axios.get(`${BACKEND_URL}/logout`);
      setUser(null);
      window.location.href = `${OTHER_APP_URL}?action=logout&redirect=${window.location.origin}`;
    } catch (error) {
      console.log("Logout failed", error);
    }
  };

  const handleGoToAppA = async () => {
    if (user && auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await axios.post(`${OTHER_BACKEND_URL}/generate-sso-token`, { idToken });
        window.location.href = `${OTHER_APP_URL}?sso_token=${res.data.sso_token}`;
      } catch(e) {
        window.location.href = OTHER_APP_URL;
      }
    } else {
      window.location.href = OTHER_APP_URL;
    }
  };

  if (loading) {
    return (
      <div className="App">
        <div className="container">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="container">
        {!user ? (
          <div className="auth-card">
            <h1>{isRegistering ? "Create an Account" : "Welcome to App B 👋"}</h1>
            <p>{isRegistering ? "Sign up to get started" : "Sign in to your account"}</p>
            
            {authError && <div className={authError.includes("successful") ? "success-message" : "error-message"}>{authError}</div>}
            
            <form onSubmit={handleLocalAuth} className="auth-form">
              {isRegistering && (
                <input 
                  type="text" 
                  placeholder="Full Name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  required 
                />
              )}
              <input 
                type="email" 
                placeholder="Email Address" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
              />
              <input 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
              />
              <button type="submit" className="login-btn primary-btn">
                {isRegistering ? "Register" : "Sign In"}
              </button>
            </form>
            
            <div className="toggle-auth">
              {isRegistering ? (
                <p>Already have an account? <span onClick={() => setIsRegistering(false)}>Sign In</span></p>
              ) : (
                <p>Don't have an account? <span onClick={() => setIsRegistering(true)}>Register</span></p>
              )}
            </div>

            <button 
              className="login-btn" 
              onClick={handleGoToAppA} 
              style={{ marginTop: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc" }}
            >
              Go to App A
            </button>
          </div>
        ) : (
          <div className="user-info">
            <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
            <h1 className="welcome">Hi, {user.name}! 👋</h1>
            <p className="email">{user.email}</p>
            <p><strong>Role:</strong> {user.role}</p>
            <p>You have successfully logged into App B.</p>
            <button 
              className="login-btn" 
              onClick={handleGoToAppA} 
              style={{ marginBottom: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc" }}
            >
              Go to App A
            </button>
            <button className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
