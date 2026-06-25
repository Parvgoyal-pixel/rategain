import axios from "axios";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import { auth } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, GithubAuthProvider, signInWithCustomToken, signOut, onAuthStateChanged } from "firebase/auth";

axios.defaults.withCredentials = true;

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
const OTHER_APP_URL = process.env.REACT_APP_OTHER_APP_URL || "http://localhost:3001";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [authError, setAuthError] = useState("");
  const isLoggingOut = useRef(false);

  useEffect(() => {
    let unsubscribe = null;

    const setupAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      const redirectUri = urlParams.get('redirect');
      const ssoCheck = urlParams.get('sso_check');

      const ssoToken = urlParams.get('sso_token');

      if (action === 'logout') {
        isLoggingOut.current = true;
        try {
          await signOut(auth);
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
          const res = await axios.post(`${BACKEND_URL}/verify-sso-token`, { sso_token: ssoToken });
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
                const res = await axios.post(`${BACKEND_URL}/generate-sso-token`, { idToken });
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

  const handleLoginGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleLoginGithub = async () => {
    try {
      const provider = new GithubAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleLogout = async () => {
    isLoggingOut.current = true;
    try {
      await signOut(auth);
      setUser(null);
      window.location.href = `${OTHER_APP_URL}?action=logout&redirect=${window.location.origin}`;
    } catch (error) {
      console.log("Logout failed", error);
    }
  };

  const handleGoToAppB = async () => {
    setIsRedirecting(true);
    if (user && auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const res = await axios.post(`${BACKEND_URL}/generate-sso-token`, { idToken });
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
            <h1>Welcome to App A 👋</h1>
            <p>Sign in to your account</p>
            
            {authError && <div className="error-message">{authError}</div>}
            
            <button className="login-btn outline-btn" onClick={handleLoginGoogle} style={{ marginBottom: "10px" }}>
              Continue with Google
            </button>
            <button className="login-btn outline-btn" onClick={handleLoginGithub}>
              Continue with GitHub
            </button>

            <button 
              className="login-btn" 
              onClick={handleGoToAppB} 
              disabled={isRedirecting}
              style={{ marginTop: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc", opacity: isRedirecting ? 0.6 : 1, cursor: isRedirecting ? "not-allowed" : "pointer" }}
            >
              {isRedirecting ? "Redirecting securely..." : "Go to App B"}
            </button>
          </div>
        ) : (
          <div className="user-info">
            <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
            <h1 className="welcome">Hi, {user.name}! 👋</h1>
            <p className="email">{user.email}</p>
            <p><strong>Role:</strong> {user.role}</p>
            <p>You have successfully logged into App A.</p>
            <button 
              className="login-btn" 
              onClick={handleGoToAppB} 
              disabled={isRedirecting}
              style={{ marginBottom: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc", opacity: isRedirecting ? 0.6 : 1, cursor: isRedirecting ? "not-allowed" : "pointer" }}
            >
              {isRedirecting ? "Redirecting securely..." : "Go to App B"}
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
