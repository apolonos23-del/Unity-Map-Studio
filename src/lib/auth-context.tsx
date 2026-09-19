import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp } from "firebase/firestore";
import { apiRequest } from "./api-client";
import { auth, db } from "./firebase";
import { cGetDoc, cSetDoc } from "./quota-guard";
import { startPresence, stopPresence } from "./presence";

export type UserRole = "student" | "teacher" | "therapist";
export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  workspace?: string;
  createdAt?: unknown;
  lastSeen?: unknown;
}
interface AuthCtx {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  retryInitialization: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
    role: UserRole,
    accessCode?: string,
  ) => Promise<void>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  changeDisplayName: (name: string) => Promise<void>;
  claimRole: (
    role: Exclude<UserRole, "student">,
    accessCode: string,
  ) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);
const PENDING_ROLE_KEY = "ums:pending-role";

export function roleFromClaims(claims: Record<string, unknown>): UserRole {
  const role = claims.role;
  return role === "teacher" || role === "therapist" || role === "student"
    ? role
    : "student";
}
export function pendingRole(): Exclude<UserRole, "student"> | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(PENDING_ROLE_KEY);
  return value === "teacher" || value === "therapist" ? value : null;
}
async function readProfile(u: User): Promise<UserProfile> {
  const role = roleFromClaims((await u.getIdTokenResult()).claims);
  const ref = doc(db(), "users", u.uid);
  const snap = await cGetDoc(ref);
  const stored = snap.exists() ? (snap.data() as Partial<UserProfile>) : {};
  const profile: UserProfile = {
    ...stored,
    uid: u.uid,
    displayName:
      stored.displayName ||
      u.displayName ||
      u.email?.split("@")[0] ||
      "Χρήστης",
    email: u.email || stored.email || "",
    role,
  };
  await cSetDoc(
    ref,
    snap.exists()
      ? { role, lastSeen: serverTimestamp() }
      : {
          ...profile,
          createdAt: serverTimestamp(),
          lastSeen: serverTimestamp(),
        },
    { merge: true },
  );
  return profile;
}
function clearUserCaches() {
  if (typeof localStorage !== "undefined") {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("ums:")) localStorage.removeItem(key);
    }
  }
  if (typeof sessionStorage !== "undefined")
    sessionStorage.removeItem(PENDING_ROLE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialization = useRef(0);
  const initialize = useCallback(async (u: User | null) => {
    const generation = ++initialization.current;
    setProfile(null);
    setLoading(true);
    setError(null);
    setUser(u);
    if (!u) {
      stopPresence();
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const next = await readProfile(u);
      if (generation !== initialization.current) return;
      setProfile(next);
      try {
        startPresence(next);
      } catch (e) {
        console.warn("presence start failed", e);
      }
    } catch (e) {
      if (generation !== initialization.current) return;
      stopPresence();
      setProfile(null);
      setError(e instanceof Error ? e.message : "Could not load your account.");
    } finally {
      if (generation === initialization.current) setLoading(false);
    }
  }, []);
  useEffect(
    () =>
      onAuthStateChanged(auth(), (u) => {
        void initialize(u);
      }),
    [initialize],
  );
  const retryInitialization = useCallback(
    async () => initialize(auth().currentUser),
    [initialize],
  );
  const claimRole: AuthCtx["claimRole"] = async (role, accessCode) => {
    const result = await apiRequest<{ role: UserRole }>("claim-role", {
      role,
      accessCode,
    });
    if (result.role !== role)
      throw new Error("The requested role was not granted.");
    const current = auth().currentUser;
    if (!current) throw new Error("Authentication required");
    await current.getIdToken(true);
    sessionStorage.removeItem(PENDING_ROLE_KEY);
    await initialize(current);
  };
  const signUp: AuthCtx["signUp"] = async (
    email,
    password,
    displayName,
    role,
    accessCode,
  ) => {
    const credential = await createUserWithEmailAndPassword(
      auth(),
      email,
      password,
    );
    await updateProfile(credential.user, { displayName });
    await cSetDoc(
      doc(db(), "users", credential.user.uid),
      {
        uid: credential.user.uid,
        displayName,
        email,
        role: "student",
        createdAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
      },
      { merge: true },
    );
    if (role !== "student") {
      sessionStorage.setItem(PENDING_ROLE_KEY, role);
      await claimRole(role, accessCode?.trim() || "");
    } else await initialize(credential.user);
  };
  const signOut = async () => {
    stopPresence();
    const [{ clearTabs }, { memoryCache }] = await Promise.all([
      import("@/lib/tab-store"),
      import("@/lib/canvas/memory-cache"),
    ]);
    clearTabs();
    memoryCache.clear();
    clearUserCaches();
    await fbSignOut(auth());
  };
  const changeDisplayName = async (name: string) => {
    const current = auth().currentUser;
    if (!current) throw new Error("Authentication required");
    const displayName = name.trim();
    if (!displayName) throw new Error("Display name is required.");
    await updateProfile(current, { displayName });
    await cSetDoc(
      doc(db(), "users", current.uid),
      { displayName },
      { merge: true },
    );
    setProfile((value) => (value ? { ...value, displayName } : value));
  };
  const deleteAccount = async (password: string) => {
    const current = auth().currentUser;
    if (!current?.email) throw new Error("Authentication required");
    await reauthenticateWithCredential(
      current,
      EmailAuthProvider.credential(current.email, password),
    );
    await apiRequest<{ deleted: boolean }>("delete-account");
    await signOut();
    setUser(null);
    setProfile(null);
  };
  const value: AuthCtx = {
    user,
    profile,
    loading,
    error,
    retryInitialization,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(auth(), email, password);
    },
    signUp,
    signOut,
    sendPasswordReset: async (email) => {
      await sendPasswordResetEmail(auth(), email);
    },
    changeDisplayName,
    claimRole,
    deleteAccount,
  };
  return (
    <Ctx.Provider value={value}>
      {error && user ? (
        <div className="min-h-screen flex items-center justify-center p-6 bg-background">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-xl font-semibold">
              Δεν ήταν δυνατή η φόρτωση του λογαριασμού
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <div className="flex justify-center gap-3">
              <button
                className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                onClick={() => void retryInitialization()}
              >
                Δοκιμή ξανά
              </button>
              <button
                className="rounded-md border px-4 py-2"
                onClick={() => void signOut()}
              >
                Αποσύνδεση
              </button>
            </div>
          </div>
        </div>
      ) : (
        children
      )}
    </Ctx.Provider>
  );
}
export function useAuth() {
  const context = useContext(Ctx);
  if (!context) throw new Error("useAuth must be inside AuthProvider");
  return context;
}
