// RTDB-based online presence.
// Single source of truth for "who is online right now".
// We write at most: 1 onConnect, 1 onDisconnect, and small periodic heartbeats.
// Path: /presence/{uid} = { state, displayName, role, lastSeen, currentSessionId? }

import {
  onValue,
  onDisconnect,
  ref,
  serverTimestamp as rtdbServerTimestamp,
  set,
  update,
} from "firebase/database";
import { rtdb } from "./firebase";
import type { UserProfile } from "./auth-context";

export interface PresenceEntry {
  state: "online" | "offline";
  displayName: string;
  role: UserProfile["role"];
  lastSeen: number;
  currentSessionId?: string | null;
  /** Which collaborative PROJECT (not liveSession) this user currently has
   *  open, if any — see startCollabProject/joinCollabProject in
   *  projects.ts. Used to detect in real time when everyone has left a
   *  collaboration, so it can auto-finalize (distribute personal copies,
   *  see project.$projectId.tsx). */
  currentCollabProjectId?: string | null;
}

export type PresenceMap = Record<string, PresenceEntry>;

let stopHeartbeat: (() => void) | null = null;
let stopConnected: (() => void) | null = null;
let currentUid: string | null = null;

export function startPresence(profile: UserProfile) {
  if (currentUid === profile.uid) return; // already running
  stopPresence();
  currentUid = profile.uid;
  const r = ref(rtdb(), `presence/${profile.uid}`);
  const connectedRef = ref(rtdb(), ".info/connected");

  stopConnected = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    // Ensure we go offline on disconnect.
    onDisconnect(r)
      .set({
        state: "offline",
        displayName: profile.displayName,
        role: profile.role,
        lastSeen: rtdbServerTimestamp(),
      })
      .then(() => {
        set(r, {
          state: "online",
          displayName: profile.displayName,
          role: profile.role,
          lastSeen: rtdbServerTimestamp(),
        });
      })
      .catch(() => {});
  });

  // Cheap heartbeat every 60s, just updates lastSeen.
  const t = setInterval(() => {
    update(r, { lastSeen: rtdbServerTimestamp() }).catch(() => {});
  }, 60_000);
  stopHeartbeat = () => clearInterval(t);
}

export function stopPresence() {
  if (stopHeartbeat) {
    stopHeartbeat();
    stopHeartbeat = null;
  }
  if (stopConnected) {
    stopConnected();
    stopConnected = null;
  }
  if (currentUid) {
    const r = ref(rtdb(), `presence/${currentUid}`);
    update(r, { state: "offline", lastSeen: rtdbServerTimestamp() }).catch(
      () => {},
    );
  }
  currentUid = null;
}

export function setCurrentSession(sessionId: string | null) {
  if (!currentUid) return;
  update(ref(rtdb(), `presence/${currentUid}`), {
    currentSessionId: sessionId,
  }).catch(() => {});
}

export function setCurrentCollabProject(projectId: string | null) {
  if (!currentUid) return;
  update(ref(rtdb(), `presence/${currentUid}`), {
    currentCollabProjectId: projectId,
  }).catch(() => {});
}

export function subscribePresence(cb: (map: PresenceMap) => void): () => void {
  const r = ref(rtdb(), "presence");
  return onValue(r, (snap) => cb((snap.val() as PresenceMap) ?? {}));
}
