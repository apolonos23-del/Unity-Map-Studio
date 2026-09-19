import { apiRequest } from "./api-client";
// Live classroom flow — Firestore data model.
//
// Quota: all reads/writes go through quota-guard wrappers. The
// onSnapshot subscriptions here are the highest-risk paths under
// classroom load — keep them tight (only subscribe what is currently
// visible, unsubscribe on unmount). Live board content sync is NOT done
// here; it uses periodic getDoc polling in CanvasStage.
//
// A live session always clones the source draft into a fresh board so
// the personal draft is never overwritten.

import {
  collection,
  doc,
  query,
  serverTimestamp,
  where,
  arrayUnion,
  arrayRemove,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { createProject, type WorkspaceType } from "./projects";
import {
  cAddDoc,
  cGetDoc,
  cGetDocs,
  cOnSnapshot,
  cSetDoc,
  cUpdateDoc,
} from "./quota-guard";

export type LiveSessionStatus = "active" | "paused" | "ending" | "ended";
export type InvitationStatus =
  "pending" | "accepted" | "declined" | "expired" | "cancelled";

export interface LiveSession {
  id: string;
  teacherId: string;
  teacherName: string;
  title: string;
  workspaceType: WorkspaceType;
  status: LiveSessionStatus;
  mainBoardId: string;
  groupRoomIds: string[];
  participantIds: string[];
  /** UIDs allowed to edit. Creator always has edit. Others are view-only unless listed here. */
  editPermissions?: string[];
  /** When set, all participants see this boardId instead of mainBoardId (presentation mode). */
  presentingBoardId?: string | null;
  /** When set, teacher is presenting this workspace room to all. */
  presentingRoomId?: string | null;
  /** When false, students are returned to mainBoard but groupRooms are preserved. */
  groupRoomsActive?: boolean;
  /** Teacher is currently visiting this groupRoomId (triggers student notification). */
  teacherInRoomId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  endedAt?: unknown;
}

export interface GroupRoom {
  id: string;
  sessionId: string;
  name: string;
  boardId: string;
  participantIds: string[];
  createdBy: string;
  createdAt?: unknown;
}

/** Per-student participation record within a group room — lives at
 *  liveSessions/{sid}/groupRooms/{gid}/members/{uid}. Kept even after a
 *  student leaves the group (isCurrentMember: false) so contribution
 *  history survives group switches, and so end-of-session distribution
 *  knows exactly who actually worked on this board. Written by the
 *  student's own browser (self-tracking) — see recordGroupJoin/Leave/
 *  markGroupContribution below. */
export interface GroupMember {
  userId: string;
  displayName: string;
  joinedAt?: unknown;
  leftAt?: unknown | null;
  isCurrentMember: boolean;
  contributed: boolean;
  firstContributionAt?: unknown | null;
}

export interface Invitation {
  id: string;
  sessionId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  status: InvitationStatus;
  createdAt?: unknown;
}

// ---------------------- Sessions ----------------------

export async function createLiveSession(opts: {
  teacherId: string;
  teacherName: string;
  title: string;
  workspaceType: WorkspaceType;
  sourceMapId?: string;
}): Promise<LiveSession> {
  return apiRequest<LiveSession>("create-session", {
    title: opts.title,
    workspaceType: opts.workspaceType,
    kind: "class",
  });
}

export async function endLiveSession(sessionId: string, teacherId: string) {
  const result = await endSessionAndSave(sessionId, teacherId, "");
  if (!result.ended)
    throw new Error("Η τελική αποθήκευση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.");
}

export function subscribeMySessions(
  uid: string,
  cb: (s: LiveSession[]) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "liveSessions"),
    where("participantIds", "array-contains", uid),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<LiveSession, "id"> }>;
    };
    const rows = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => {
      const at =
        (
          a.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      const bt =
        (
          b.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      return bt - at;
    });
    cb(rows);
  });
}

/** The teacher's own session, active OR paused (but not ended) — used by
 *  LiveClassButton so a refreshed/reconnected teacher sees "re-enter" (which
 *  auto-resumes on arrival) instead of being offered a brand new session
 *  while their old one sits paused and orphaned. */
export function subscribeTeacherSession(
  teacherId: string,
  cb: (s: LiveSession | null) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "liveSessions"),
    where("teacherId", "==", teacherId),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<LiveSession, "id"> }>;
    };
    const rows = qs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.status === "active" || s.status === "paused");
    rows.sort((a, b) => {
      const at =
        (
          a.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      const bt =
        (
          b.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      return bt - at;
    });
    cb(rows[0] ?? null);
  });
}

// ── Single-button live class entry point ────────────────────────────
// This app models one classroom at a time: there is no roster/cohort
// binding a given student to a given teacher, so "the live lesson" is
// simply whichever liveSession is currently active. Used by
// LiveClassButton (replaces the old browsable "live lessons" list).
export function subscribeActiveSession(
  cb: (s: LiveSession | null) => void,
): Unsubscribe {
  const uid = auth().currentUser?.uid;

  // Firestore rules only allow a signed-in user to read liveSessions where
  // they are the teacher or already present in participantIds. Querying all
  // active sessions causes Firestore to reject the whole listener with
  // permission-denied because security rules are not post-query filters.
  //
  // Every teacher is inserted into participantIds when the session is
  // created, so one participantIds array-contains query safely covers both
  // teachers and students without loosening the Firestore rules.
  if (!uid) {
    cb(null);
    return () => {};
  }

  const q = query(
    collection(db(), "liveSessions"),
    where("participantIds", "array-contains", uid),
  );

  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<LiveSession, "id"> }>;
    };

    const rows = qs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.status === "active");

    rows.sort((a, b) => {
      const at =
        (
          a.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      const bt =
        (
          b.updatedAt as { toMillis?: () => number } | undefined
        )?.toMillis?.() ?? 0;
      return bt - at;
    });

    cb(rows[0] ?? null);
  });
}

/** Adds a student straight into an already-active session's participant
 *  list — no invitation round-trip. Only meant to be called once the
 *  LiveClassButton has confirmed (via presence) that the teacher is
 *  actually in the room. */
export async function joinLiveSessionDirect(
  sessionId: string,
  uid: string,
): Promise<void> {
  await apiRequest("join-session", { sessionId });
}

export function subscribeSession(
  sessionId: string,
  cb: (s: LiveSession | null) => void,
): Unsubscribe {
  return cOnSnapshot(doc(db(), "liveSessions", sessionId), (snap) => {
    const ds = snap as unknown as {
      exists: () => boolean;
      id: string;
      data: () => Omit<LiveSession, "id">;
    };
    cb(ds.exists() ? { id: ds.id, ...ds.data() } : null);
  });
}

// ---------------------- Group rooms ----------------------

export async function createGroupRoom(opts: {
  sessionId: string;
  teacherId: string;
  name: string;
  workspaceType: WorkspaceType;
}): Promise<GroupRoom> {
  return apiRequest<GroupRoom>("create-group", {
    sessionId: opts.sessionId,
    name: opts.name,
  });
}

export function subscribeGroupRooms(
  sessionId: string,
  cb: (rooms: GroupRoom[]) => void,
): Unsubscribe {
  return cOnSnapshot(
    collection(db(), "liveSessions", sessionId, "groupRooms"),
    (snap) => {
      const qs = snap as unknown as {
        docs: Array<{ id: string; data: () => Omit<GroupRoom, "id"> }>;
      };
      cb(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
  );
}

export async function assignToGroup(
  sessionId: string,
  roomId: string,
  studentId: string,
) {
  await apiRequest("move-group", { sessionId, roomId, studentId });
}

export async function removeFromGroup(
  sessionId: string,
  roomId: string,
  studentId: string,
) {
  await apiRequest("move-group", { sessionId, roomId: null, studentId });
}

export const MAX_GROUP_ROOMS = 10;

export async function deleteGroupRoom(sessionId: string, roomId: string) {
  await apiRequest("delete-group", { sessionId, roomId });
}

export async function recordGroupJoin(
  sessionId: string,
  groupId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  const ref = doc(
    db(),
    "liveSessions",
    sessionId,
    "groupRooms",
    groupId,
    "members",
    userId,
  );
  const existing = await cGetDoc(ref);
  if (existing.exists()) {
    await cUpdateDoc(ref, { isCurrentMember: true, leftAt: null, displayName });
  } else {
    await cSetDoc(ref, {
      userId,
      displayName,
      joinedAt: serverTimestamp(),
      leftAt: null,
      isCurrentMember: true,
      contributed: false,
      firstContributionAt: null,
    });
  }
}

/** Called by a student's own browser when they stop being a current
 *  member of a group (left themselves, reassigned elsewhere, or removed
 *  by the teacher). Keeps the record — just flips isCurrentMember off —
 *  so contribution history survives for end-of-session distribution. */
export async function recordGroupLeave(
  sessionId: string,
  groupId: string,
  userId: string,
): Promise<void> {
  const ref = doc(
    db(),
    "liveSessions",
    sessionId,
    "groupRooms",
    groupId,
    "members",
    userId,
  );
  await cUpdateDoc(ref, {
    isCurrentMember: false,
    leftAt: serverTimestamp(),
  }).catch(() => {});
}

/** Marks a student as having made at least one real edit on their
 *  group's board. Called once client-side on first genuine change (see
 *  the group-tab save-status wiring in live.$sessionId.tsx) — the
 *  one-time guard lives there, this just needs to be safe to call. */
export async function markGroupContribution(
  sessionId: string,
  groupId: string,
  userId: string,
): Promise<void> {
  const ref = doc(
    db(),
    "liveSessions",
    sessionId,
    "groupRooms",
    groupId,
    "members",
    userId,
  );
  await cSetDoc(
    ref,
    { contributed: true, firstContributionAt: serverTimestamp() },
    { merge: true },
  ).catch(() => {});
}

export function subscribeGroupMembers(
  sessionId: string,
  groupId: string,
  cb: (members: GroupMember[]) => void,
): Unsubscribe {
  return cOnSnapshot(
    collection(
      db(),
      "liveSessions",
      sessionId,
      "groupRooms",
      groupId,
      "members",
    ),
    (snap) => {
      const qs = snap as unknown as {
        docs: Array<{ data: () => GroupMember }>;
      };
      cb(qs.docs.map((d) => d.data()));
    },
  );
}

export async function joinGroupRoom(
  sessionId: string,
  roomId: string,
  studentId: string,
) {
  await apiRequest("move-group", { sessionId, roomId, studentId });
}

export async function autoSplitIntoGroups(
  sessionId: string,
  groupRoomIds: string[],
  studentIds: string[],
) {
  await apiRequest("split-groups", { sessionId, groupRoomIds, studentIds });
}

export async function sendInvitation(opts: {
  sessionId: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
}): Promise<string> {
  return (
    await apiRequest<{ id: string }>("send-invitation", {
      sessionId: opts.sessionId,
      toUserId: opts.toUserId,
    })
  ).id;
}

export function subscribeMyInvitations(
  uid: string,
  cb: (inv: Invitation[]) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "invitations"),
    where("toUserId", "==", uid),
    where("status", "==", "pending"),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<Invitation, "id"> }>;
    };
    cb(qs.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function respondToInvitation(
  invitationId: string,
  accept: boolean,
  uid: string,
): Promise<string | null> {
  return (
    await apiRequest<{ id: string | null }>("respond-invitation", {
      invitationId,
      accept,
    })
  ).id;
}

export async function sendCollabProjectInvitation(opts: {
  projectId: string;
  projectTitle: string;
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
}): Promise<string> {
  return (
    await apiRequest<{ id: string }>("send-invitation", {
      projectId: opts.projectId,
      toUserId: opts.toUserId,
      type: "collab_project",
    })
  ).id;
}

export async function shareProject(opts: {
  ownerId: string;
  ownerName: string;
  projectId: string;
  projectTitle: string;
  workspaceType: WorkspaceType;
}): Promise<LiveSession> {
  return apiRequest<LiveSession>("create-session", { ...opts, kind: "share" });
}

export async function endProjectShare(sessionId: string, ownerId: string) {
  const result = await endSessionAndSave(sessionId, ownerId, "");
  if (!result.ended) throw new Error("Η αποθήκευση δεν ολοκληρώθηκε.");
}

export function subscribeProjectSession(
  projectId: string,
  cb: (session: LiveSession | null) => void,
) {
  const q = query(
    collection(db(), "liveSessions"),
    where("mainBoardId", "==", projectId),
    where("participantIds", "array-contains", auth().currentUser?.uid ?? ""),
    where("status", "==", "active"),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as import("firebase/firestore").QuerySnapshot;
    if (qs.empty) {
      cb(null);
      return;
    }
    const d = qs.docs[0];
    cb({ id: d.id, ...(d.data() as Omit<LiveSession, "id">) });
  });
}

export async function setEditPermission(
  sessionId: string,
  uid: string,
  canEdit: boolean,
) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    editPermissions: canEdit ? arrayUnion(uid) : arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
}

// ── Find a user by email (for "Αποστολή σχεδίου σε") ────────────────────
// Any signed-in user can read the users collection (see firestore.rules),
// so this is a plain client-side query — no special backend needed.
export async function findUserByEmail(
  email: string,
): Promise<{ uid: string; displayName: string } | null> {
  return (
    await apiRequest<{ user: { uid: string; displayName: string } | null }>(
      "find-user",
      { email: email.trim().toLowerCase() },
    )
  ).user;
}

export async function sendDesignToUser(opts: {
  fromUserId: string;
  fromUserName: string;
  toUserId: string;
  sourceProjectId: string;
  sourceTitle: string;
  permission?: "view" | "edit";
}): Promise<void> {
  await apiRequest("send-design", {
    toUserId: opts.toUserId,
    sourceProjectId: opts.sourceProjectId,
    permission: opts.permission ?? "edit",
  });
}

export interface ReceivedDesign {
  id: string;
  toUserId: string;
  fromUserId: string;
  fromUserName: string;
  sourceProjectId: string;
  title: string;
  permission?: "view" | "edit";
  status: "pending" | "saved";
  createdAt?: unknown;
}

export function subscribeReceivedDesigns(
  userId: string,
  cb: (designs: ReceivedDesign[]) => void,
) {
  const q = query(
    collection(db(), "receivedDesigns"),
    where("toUserId", "==", userId),
    where("status", "==", "pending"),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as import("firebase/firestore").QuerySnapshot;
    cb(
      qs.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ReceivedDesign, "id">),
      })),
    );
  });
}

export async function acceptReceivedDesign(designId: string): Promise<string> {
  return (await apiRequest<{ id: string }>("accept-design", { designId })).id;
}

export async function returnAllToMain(sessionId: string) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    groupRoomsActive: false,
    teacherInRoomId: null,
    updatedAt: serverTimestamp(),
  });
}

/** Teacher re-activates groupRooms so students return to their rooms. */
export async function reactivateGroupRooms(sessionId: string) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    groupRoomsActive: true,
    updatedAt: serverTimestamp(),
  });
}

/** Teacher enters a specific group room — triggers student notification. */
export async function teacherEnterRoom(
  sessionId: string,
  roomId: string | null,
) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    teacherInRoomId: roomId,
    updatedAt: serverTimestamp(),
  });
}

/** Teacher presents a board to all participants (null = stop presenting). */
export async function setPresentingBoard(
  sessionId: string,
  boardId: string | null,
) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    presentingBoardId: boardId ?? null,
    updatedAt: serverTimestamp(),
  });
}

/** Save all group rooms to participants' lobbies and end the session safely.
 *  Returns { saved: number, failed: string[] } so caller can abort on failure. */
export interface EndSessionFailure {
  groupId: string;
  groupName: string;
  studentId: string;
  studentName: string;
}

export interface EndSessionResult {
  ended: boolean;
  distributed: number;
  failed: EndSessionFailure[];
}

/** Ends a live session, distributing each group's FINAL board to every
 *  student who actually contributed to it (not just anyone who briefly
 *  joined) as an independent personal copy in their own lobby.
 *
 *  Safe to call more than once (double-click, network retry): copy IDs
 *  are deterministic (`livecopy_{sessionId}_{groupId}_{studentId}`), so
 *  a re-run skips everything that already succeeded and only retries
 *  what previously failed. The session only flips to "ended" once every
 *  contributor's copy exists; until then it sits in "ending" (locked for
 *  editing, but resumable-by-retry) so nothing is ever silently lost. */
export async function endSessionAndSave(
  sessionId: string,
  teacherId: string,
  teacherName: string,
): Promise<EndSessionResult> {
  return apiRequest<EndSessionResult>("end-session", { sessionId });
}

export async function activateAndNotifyAll(
  session: LiveSession,
  fromUserName: string,
): Promise<void> {
  await Promise.all(
    session.participantIds
      .filter((uid) => uid !== session.teacherId)
      .map((toUserId) =>
        sendInvitation({
          sessionId: session.id,
          fromUserId: session.teacherId,
          fromUserName,
          toUserId,
        }),
      ),
  );
}

export async function notifyOnlineUsers(
  session: LiveSession,
  fromUserName: string,
  toUserIds: string[],
): Promise<void> {
  await Promise.all(
    [...new Set(toUserIds)]
      .filter(
        (uid) =>
          uid !== session.teacherId && !session.participantIds.includes(uid),
      )
      .map((toUserId) =>
        sendInvitation({
          sessionId: session.id,
          fromUserId: session.teacherId,
          fromUserName,
          toUserId,
        }),
      ),
  );
}

export async function pauseSession(sessionId: string): Promise<void> {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    status: "paused" as LiveSessionStatus,
    updatedAt: serverTimestamp(),
  });
}

/** Resume a session when teacher reconnects. */
export async function resumeSession(sessionId: string): Promise<void> {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    status: "active" as LiveSessionStatus,
    updatedAt: serverTimestamp(),
  });
}

/** Notify all participants that the session was paused (teacher disconnected). */
export async function notifySessionPaused(
  session: LiveSession,
  teacherName: string,
): Promise<void> {
  await Promise.all(
    session.participantIds
      .filter((uid) => uid !== session.teacherId)
      .map((toUserId) =>
        apiRequest("send-invitation", {
          sessionId: session.id,
          toUserId,
          type: "lesson_paused",
        }),
      ),
  );
}

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function autoExpireOldSessions(
  teacherId: string,
): Promise<string[]> {
  const expired: string[] = [];
  try {
    const snap = await cGetDocs(
      query(
        collection(db(), "liveSessions"),
        where("teacherId", "==", teacherId),
        where("status", "in", ["active", "paused"]),
      ),
    );
    const now = Date.now();
    for (const d of snap.docs) {
      const data = d.data() as LiveSession;
      const createdAt =
        (data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
      if (createdAt > 0 && now - createdAt > SESSION_MAX_AGE_MS) {
        await cUpdateDoc(d.ref, {
          status: "paused" as LiveSessionStatus,
          autoExpiredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        expired.push(data.title);
      }
    }
  } catch (e) {
    console.warn("autoExpireOldSessions failed", e);
  }
  return expired;
}

/** Teacher presents a workspace room to all participants. null = stop. */
export async function setPresentingRoom(
  sessionId: string,
  roomId: string | null,
) {
  await cUpdateDoc(doc(db(), "liveSessions", sessionId), {
    presentingRoomId: roomId ?? null,
    updatedAt: serverTimestamp(),
  });
}

/** Delete an invitation document (used for info-only notifications like lesson_paused). */
export async function deleteInvitation(invitationId: string): Promise<void> {
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(doc(db(), "invitations", invitationId));
}
