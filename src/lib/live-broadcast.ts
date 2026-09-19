// live-broadcast.ts
// The single, unambiguous "is a class live right now" signal — lives in
// the Realtime Database (not Firestore), same pattern as presence.ts and
// for the same reason: RTDB's onDisconnect() lets the SERVER clear this
// automatically the instant a teacher's connection drops (browser closed,
// crashed, lost network), with zero reliance on any client-side cleanup
// code ever running. There is exactly one node — it either exists (a
// class is live) or it doesn't. Nothing to compare, nothing to guess.
//
// This deliberately does NOT replace liveSessions/groupRooms in Firestore
// — those remain the durable source of truth for lesson/board/group data.
// This is purely the real-time "is it live right now" flag layered on top.

import {
  onValue,
  onDisconnect,
  ref,
  remove,
  serverTimestamp as rtdbServerTimestamp,
  set,
} from "firebase/database";
import { rtdb } from "./firebase";

export interface LiveBroadcast {
  sessionId: string;
  teacherId: string;
  teacherName: string;
  title: string;
  startedAt: number;
}

const PATH = "liveClass/current";

let stopOnDisconnectWatch: (() => void) | null = null;

/** Call the moment a teacher actually enters their live session route.
 *  Sets the broadcast AND arranges for the server to clear it automatically
 *  if this browser disconnects without calling stopBroadcast() first. */
export function startBroadcast(info: {
  sessionId: string;
  teacherId: string;
  teacherName: string;
  title: string;
}) {
  const r = ref(rtdb(), PATH);
  const connectedRef = ref(rtdb(), ".info/connected");
  stopOnDisconnectWatch?.();
  stopOnDisconnectWatch = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return;
    onDisconnect(r)
      .remove()
      .then(() => {
        set(r, { ...info, startedAt: rtdbServerTimestamp() });
      })
      .catch(() => {});
  });
}

/** Call on explicit pause/end/leave — clears the broadcast immediately
 *  instead of waiting for a disconnect. Safe to call even if this browser
 *  isn't the one currently broadcasting (e.g. called defensively). */
export function stopBroadcast() {
  stopOnDisconnectWatch?.();
  stopOnDisconnectWatch = null;
  remove(ref(rtdb(), PATH)).catch(() => {});
}

/** Real-time subscription — fires with the current broadcast, or null
 *  when nothing is live. This is the ONLY thing LiveClassButton and the
 *  app-wide notification listener need to check. */
export function subscribeLiveBroadcast(
  cb: (b: LiveBroadcast | null) => void,
): () => void {
  const r = ref(rtdb(), PATH);
  return onValue(r, (snap) => cb((snap.val() as LiveBroadcast) ?? null));
}
