import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getDatabase, type Database } from "firebase/database";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCAweTWa3z0NC1bkp4WfUJcKqVhWXgk3tE",
  authDomain: "unity-map-studio.firebaseapp.com",
  projectId: "unity-map-studio",
  storageBucket: "unity-map-studio.firebasestorage.app",
  messagingSenderId: "98499186574",
  appId: "1:98499186574:web:01f1988ffbf02dcacf5edf",
  databaseURL:
    "https://unity-map-studio-default-rtdb.europe-west1.firebasedatabase.app/",
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
