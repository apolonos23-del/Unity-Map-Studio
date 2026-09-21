import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin.js";
import {
  accessProject,
  storedBoard,
  uploadState,
  retirePayload,
  withBoardLock,
  downloadState,
} from "./boards.js";
import { HttpError, string, id } from "./http.js";
import type { CanvasState } from "../src/lib/canvas/types.js";

const workspaceTypes = [
  "case-analysis",
  "concept-analysis",
  "free-drawing",
  "genogram",
];
export function workspace(value: unknown) {
  const result = value ?? "free-drawing";
  if (typeof result !== "string" || !workspaceTypes.includes(result))
    throw new HttpError(400, "Μη έγκυρος χώρος εργασίας.");
  return result;
}
export function newProject(
  ownerId: string,
  title: string,
  workspaceType: string,
  projectType = "personal",
) {
  return {
    ownerId,
    title: string(title, "title"),
    workspaceType: workspace(workspaceType),
    projectType,
    status: "draft",
    mode: "solo",
    sourceMapId: null,
    liveSessionId: null,
    viewOnly: false,
    ...(projectType === "collaborative"
      ? { collabParticipantIds: [ownerId] }
      : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}
export async function createProject(
  uid: string,
  input: Record<string, unknown>,
) {
  const type = input.projectType ?? "personal";
  if (type !== "personal" && type !== "collaborative")
    throw new HttpError(400, "Μη έγκυρος τύπος έργου.");
  const ref = adminDb().collection("projects").doc();
  await ref.create(
    newProject(
      uid,
      string(input.title, "title"),
      workspace(input.workspaceType),
      type,
    ),
  );
  return { id: ref.id };
}
/** Each copy owns an independent immutable file. Retrying deterministic copies never overwrites edits. */
export async function materializeCopy(
  targetId: string,
  data: Record<string, unknown>,
  state: CanvasState | null,
) {
  return withBoardLock(targetId, async () => {
    const ref = adminDb().doc(`projects/${targetId}`);
    if ((await ref.get()).exists) return targetId;
    const uploaded = state ? await uploadState(state) : null;
    try {
      const batch = adminDb().batch();
      batch.create(ref, {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (uploaded) {
        batch.create(ref.collection("snapshots").doc("current"), {
          ...uploaded,
          revision: 1,
          schemaVersion: 1,
          savedAt: FieldValue.serverTimestamp(),
        });
        batch.set(adminDb().doc(`_managedPayloads/${targetId}`), {
          payloadRef: uploaded.payloadRef,
        });
      }
      await batch.commit();
    } catch (e) {
      if (uploaded) await retirePayload(uploaded.payloadRef);
      throw e;
    }
    return targetId;
  });
}
export async function copyProject(uid: string, input: Record<string, unknown>) {
  const sourceId = id(input.sourceProjectId);
  const source = await accessProject(uid, sourceId);
  const { state } = await storedBoard(sourceId);
  const targetId = adminDb().collection("projects").doc().id;
  const title =
    typeof input.title === "string"
      ? string(input.title, "title")
      : `Αντίγραφο — ${source.title}`;
  const data = {
    ...newProject(uid, title.slice(0, 160), workspace(source.workspaceType)),
    status: "saved",
    viewOnly: !!source.viewOnly,
    sourceMapId: sourceId,
  };
  return { id: await materializeCopy(targetId, data, state) };
}
export async function sendDesign(uid: string, input: Record<string, unknown>) {
  const sourceId = id(input.sourceProjectId);
  const toUserId = id(input.toUserId);
  if (toUserId === uid)
    throw new HttpError(400, "Ο παραλήπτης πρέπει να είναι άλλος χρήστης.");
  const source = await accessProject(uid, sourceId);
  const recipient = await adminDb().doc(`users/${toUserId}`).get();
  if (!recipient.exists) throw new HttpError(404, "Ο παραλήπτης δεν βρέθηκε.");
  const sender = (await adminDb().doc(`users/${uid}`).get()).data();
  const { state } = await storedBoard(sourceId);
  const uploaded = state ? await uploadState(state) : null;
  try {
    const ref = adminDb().collection("receivedDesigns").doc();
    await ref.create({
      fromUserId: uid,
      fromUserName: sender?.displayName ?? "Χρήστης",
      toUserId,
      sourceProjectId: sourceId,
      title: source.title,
      workspaceType: workspace(source.workspaceType),
      permission:
        source.viewOnly || input.permission === "view" ? "view" : "edit",
      payloadRef: uploaded?.payloadRef ?? null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id };
  } catch (e) {
    if (uploaded) await retirePayload(uploaded.payloadRef);
    throw e;
  }
}
export async function acceptDesign(uid: string, designId: string) {
  const ref = adminDb().doc(`receivedDesigns/${designId}`);
  const data = (await ref.get()).data();
  if (!data || data.toUserId !== uid)
    throw new HttpError(403, "Δεν έχετε πρόσβαση σε αυτό το σχέδιο.");
  const targetId = `received_${designId}_${uid}`;
  if (data.status === "saved") return { id: data.copyId ?? targetId };
  // Legacy records did not freeze payloads at send time; access is confined to the server.
  let state: CanvasState | null;
  if (data.payloadRef) state = await downloadState(data.payloadRef);
  else if ("payloadRef" in data) state = null;
  else {
    const source = await accessProject(data.fromUserId, data.sourceProjectId);
    if (source.ownerId !== data.fromUserId)
      throw new HttpError(403, "Το παλιό σχέδιο πρέπει να αποσταλεί ξανά.");
    state = (await storedBoard(data.sourceProjectId)).state;
  }
  await materializeCopy(
    targetId,
    {
      ...newProject(
        uid,
        `${data.title} (από ${data.fromUserName})`.slice(0, 160),
        workspace(data.workspaceType),
      ),
      status: "saved",
      viewOnly: data.permission === "view",
    },
    state,
  );
  await ref.update({ status: "saved", copyId: targetId });
  // Keep only a pointer to the recipient-owned copy after acceptance.
  if (data.payloadRef) {
    await ref.update({ payloadRef: null });
    await retirePayload(data.payloadRef);
  }
  return { id: targetId };
}
export async function deleteProject(uid: string, mapId: string) {
  const ref = adminDb().doc(`projects/${mapId}`);
  const existing = (await ref.get()).data();
  if (!existing) return { deleted: true };
  if (existing.ownerId !== uid)
    throw new HttpError(403, "Μόνο ο ιδιοκτήτης μπορεί να διαγράψει το έργο.");
  if (existing.liveSessionId) {
    const session = (
      await adminDb().doc(`liveSessions/${existing.liveSessionId}`).get()
    ).data();
    if (session && session.status !== "ended")
      throw new HttpError(409, "Λήξτε πρώτα τη ζωντανή συνεδρία.");
  }
  return withBoardLock(mapId, async () => {
    await ref.update({ deleting: true });
    const snapshot = (
      await ref.collection("snapshots").doc("current").get()
    ).data();
    const managed = (
      await adminDb().doc(`_managedPayloads/${mapId}`).get()
    ).data();
    if (managed?.payloadRef) await retirePayload(managed.payloadRef);
    // Legacy refs are not blindly removed: another legacy copy may share them.
    await adminDb().recursiveDelete(ref);
    await adminDb().doc(`_managedPayloads/${mapId}`).delete();
    return { deleted: true };
  });
}
