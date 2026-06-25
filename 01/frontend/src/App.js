import axios from "axios";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import { auth } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, GithubAuthProvider, signInWithCustomToken, signOut, onAuthStateChanged } from "firebase/auth";

axios.defaults.withCredentials = true;

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
const OTHER_APP_URL = process.env.REACT_APP_OTHER_APP_URL || "http://localhost:3001";
const OTHER_BACKEND_URL = process.env.REACT_APP_OTHER_BACKEND_URL || "http://localhost:5001";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const isLoggingOut = useRef(false);

  useEffect(() => {
    let unsubscribe = null;

    const setupAuth = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const action = urlParams.get('action');
      const redirectUri = urlParams.get('redirect');

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
        return; // Stop execution, we are either redirecting or done
      }

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
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
          if (isLoggingOut.current) {
            setLoading(false);
            return;
          }
          try {
            const res = await axios.get(`${OTHER_BACKEND_URL}/sso-check-ajax`, { withCredentials: true });
            if (res.data.token) {
              await signInWithCustomToken(auth, res.data.token);
            } else {
              setLoading(false);
            }
          } catch(e) {
            setLoading(false);
          }
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
      await axios.get(`${BACKEND_URL}/logout`);
      setUser(null);
      // Redirect to App B to sync logout there
      window.location.href = `${OTHER_APP_URL}?action=logout&redirect=${window.location.origin}`;
    } catch (error) {
      console.log("Logout failed", error);
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
              onClick={() => window.location.href = OTHER_APP_URL} 
              style={{ marginTop: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc" }}
            >
              Go to App B
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
              onClick={() => window.location.href = OTHER_APP_URL} 
              style={{ marginBottom: "15px", backgroundColor: "#f0f0f0", color: "#333", border: "1px solid #ccc" }}
            >
              Go to App B
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
