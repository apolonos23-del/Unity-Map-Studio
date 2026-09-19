import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";

export function adminApp() {
  const current = getApps()[0];
  if (current) return current;

  const projectId =
    process.env.FIREBASE_PROJECT_ID || "unity-map-studio";

  if (
    process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    process.env.NODE_ENV !== "production"
  ) {
    return initializeApp({
      projectId,
      databaseURL: `http://127.0.0.1:9000?ns=${projectId}`,
    });
  }

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing server Firebase credentials");
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      "https://unity-map-studio-default-rtdb.europe-west1.firebasedatabase.app/",
  });
}

export const adminDb = () => getFirestore(adminApp());
export const adminAuth = () => getAuth(adminApp());
export const adminRtdb = () => getDatabase(adminApp());
