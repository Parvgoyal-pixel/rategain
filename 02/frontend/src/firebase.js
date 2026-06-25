import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCDeEaZmMWS0A0TcHj7-mjtPQ5Z0UelVV8",
  authDomain: "rategain-d3708.firebaseapp.com",
  projectId: "rategain-d3708",
  storageBucket: "rategain-d3708.firebasestorage.app",
  messagingSenderId: "1003234330581",
  appId: "1:1003234330581:web:e2877faeeaf71867cb1f5c",
  measurementId: "G-34VQJGEEPZ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
