import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCc42-PKvwntTg9N4geDVAwfOti7jWIVgU",
  authDomain: "unity-map-studio-v2.firebaseapp.com",
  projectId: "unity-map-studio-v2",
  storageBucket: "unity-map-studio-v2.firebasestorage.app",
  messagingSenderId: "511352977479",
  appId: "1:511352977479:web:c6f89800578f5006349962",
  // Realtime Database lives in the europe-west1 region, which uses the
  // ".<region>.firebasedatabase.app" URL format (NOT the legacy
  // ".firebaseio.com" host — that only applies to us-central1). Without this
  // URL the presence system silently fails (see auth-context try/catch).
  databaseURL:
    "https://unity-map-studio-v2-default-rtdb.europe-west1.firebasedatabase.app",
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _rtdb: Database | null = null;
let _storage: FirebaseStorage | null = null;

export function getFirebase() {
  if (typeof window === "undefined") {
    throw new Error("Firebase can only be used in the browser.");
  }
  if (!_app) {
    _app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return _app;
}

export function auth(): Auth {
  if (!_auth) _auth = getAuth(getFirebase());
  return _auth;
}
export function db(): Firestore {
  if (!_db) _db = getFirestore(getFirebase());
  return _db;
}
export function rtdb(): Database {
  if (!_rtdb) _rtdb = getDatabase(getFirebase());
  return _rtdb;
}
export function storage(): FirebaseStorage {
  if (!_storage) _storage = getStorage(getFirebase());
  return _storage;
}
