import axios from "axios";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import { auth } from "./firebase";
import { signInWithCustomToken, signOut, onAuthStateChanged } from "firebase/auth";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";

axios.defaults.withCredentials = true;

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
const OTHER_APP_URL = process.env.REACT_APP_OTHER_APP_URL || "http://localhost:3001";
const CLERK_PUB_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUB_KEY) {
  console.warn("Missing REACT_APP_CLERK_PUBLISHABLE_KEY");
}

function SyncFirebase() {
  const { getToken } = useAuth();
  
  useEffect(() => {
    const sync = async () => {
      try {
        const token = await getToken({ template: "integration_firebase" });
        if (token) {
          await signInWithCustomToken(auth, token);
        }
      } catch (err) {
        console.error("Firebase sync error:", err);
      }
    };
    sync();
  }, [getToken]);

  return null;
}

function AppContent() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
        return; 
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
          // If Firebase is logged out but Clerk is logged in, we need to clear backend session just in case
          try { await axios.get(`${BACKEND_URL}/logout`); } catch(e) {}
          setLoading(false);
        }
      });
    };

    setupAuth();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="App">
        <div className="container"><p>Loading...</p></div>
      </div>
    );
  }

  return (
    <div className="App">
      <div className="container">
        <SignedOut>
          <div className="auth-card" style={{ padding: 0, boxShadow: 'none', background: 'transparent' }}>
             <SignIn routing="hash" />
          </div>
        </SignedOut>
        
        <SignedIn>
          <SyncFirebase />
          {!user ? (
            <div className="auth-card" style={{ padding: 0, boxShadow: 'none', background: 'transparent' }}>
               <p>Syncing session...</p>
            </div>
          ) : (
            <div className="user-info">
              <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
                <UserButton afterSignOutUrl="/" />
              </div>
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
            </div>
          )}
        </SignedIn>
      </div>
    </div>
  );
}

function App() {
  if (!CLERK_PUB_KEY) {
    return (
      <div className="App">
        <div className="container">
          <h2>Missing Clerk Key</h2>
          <p>Please add REACT_APP_CLERK_PUBLISHABLE_KEY to your .env file.</p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={CLERK_PUB_KEY}>
      <AppContent />
    </ClerkProvider>
  );
}

export default App;
