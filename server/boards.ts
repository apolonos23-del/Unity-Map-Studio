import { randomUUID } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { adminDb, adminRtdb } from "./admin.js";
import { HttpError } from "./http.js";
import {
  projectAccess,
  type ProjectData,
  type SessionData,
} from "./access-policy.js";
import { threeWayMerge } from "../src/lib/canvas/live-merge.js";
import { emptyCanvasState, type CanvasState } from "../src/lib/canvas/types.js";

const COLLAB_DIAG_VERSION = "2026-09-21.1";
function boardDiag(event: string, details: Record<string, unknown> = {}) {
  console.info("[COLLAB_DIAG]", {
    version: COLLAB_DIAG_VERSION,
    event,
    at: Date.now(),
    ...details,
  });
}
const uidTag = (uid: string) => uid.slice(-6);


export function validateState(value: unknown): CanvasState {
  if (!value || typeof value !== "object")
    throw new HttpError(400, "Μη έγκυρα δεδομένα σχεδίου.");
  const state = value as CanvasState;
  const finite = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e8;
  if (
    !Array.isArray(state.objects) ||
    state.objects.length > 5000 ||
    !state.viewport ||
    !finite(state.viewport.x) ||
    !finite(state.viewport.y) ||
    !finite(state.viewport.zoom) ||
    state.viewport.zoom <= 0 ||
    !state.settings ||
    typeof state.settings !== "object" ||
    Array.isArray(state.settings)
  )
    throw new HttpError(400, "Μη έγκυρη δομή σχεδίου.");
  const ids = new Set<string>();
  for (const o of state.objects) {
    if (
      !o ||
      typeof o.id !== "string" ||
      !o.id ||
      o.id.length > 180 ||
      ids.has(o.id) ||
      ![
        "shape",
        "line",
        "connector",
        "text",
        "symbol",
        "frame",
        "drawing",
      ].includes(o.type) ||
      ![o.x, o.y, o.width, o.height].every(finite)
    )
      throw new HttpError(400, "Μη έγκυρο αντικείμενο σχεδίου.");
    ids.add(o.id);
  }
  if (Buffer.byteLength(JSON.stringify(state)) > 1_600_000)
    throw new HttpError(
      413,
      "Το σχέδιο υπερβαίνει το όριο των 1,6 MB. Χωρίστε το σε περισσότερα έργα.",
    );
  return state;
}
function storageConfig() {
  const base = (
    process.env.BOARD_STORAGE_API_URL ||
    "https://demo.unityenergetics.org/unity-map-api"
  ).replace(/\/$/, "");
  const token = process.env.BOARD_STORAGE_TOKEN;
  if (!token)
    throw new HttpError(503, "Δεν έχει ρυθμιστεί η υπηρεσία αποθήκευσης.");
  if (
    !base.startsWith("https://") &&
    !(
      process.env.NODE_ENV !== "production" &&
      /^http:\/\/127\.0\.0\.1:\d+$/.test(base)
    )
  )
    throw new HttpError(503, "Η υπηρεσία αποθήκευσης απαιτεί HTTPS.");
  return { base, token };
}
async function external(path: string, method = "GET", data?: unknown) {
  const { base, token } = storageConfig();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(
      502,
      "Δεν είναι δυνατή η σύνδεση με τον server αρχείων.",
    );
  }
  if (method === "DELETE" && response.status === 404) return {};
  if (!response.ok)
    throw new HttpError(
      502,
      `Ο server αρχείων απέρριψε την ενέργεια (HTTP ${response.status}).`,
    );
  if (method === "DELETE") return {};
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== "object")
    throw new HttpError(502, "Μη έγκυρη απάντηση από τον server αρχείων.");
  return result as Record<string, unknown>;
}
export async function uploadState(state: CanvasState) {
  validateState(state);
  const payload = {
    ...state,
    nodes: state.objects.filter(
      (o) => !["line", "connector", "drawing"].includes(o.type),
    ),
    edges: state.objects.filter((o) => ["line", "connector"].includes(o.type)),
    drawings: state.objects.filter((o) => o.type === "drawing"),
  };
  const data = await external("/payloads", "POST", { payload });
  if (
    data.success !== true ||
    typeof data.payloadRef !== "string" ||
    !/^[a-zA-Z0-9_.-]+$/.test(data.payloadRef) ||
    typeof data.payloadUrl !== "string"
  )
    throw new HttpError(
      502,
      "Η αποθήκευση δεν επιβεβαιώθηκε από τον server αρχείων.",
    );
  return {
    payloadRef: data.payloadRef as string,
    payloadUrl: data.payloadUrl as string,
    size:
      typeof data.size === "number"
        ? data.size
        : Buffer.byteLength(JSON.stringify(payload)),
  };
}
export async function downloadState(ref: string): Promise<CanvasState> {
  const data = await external(`/payloads/${encodeURIComponent(ref)}`);
  const raw = (data.payload ?? data) as Record<string, unknown>;
  const objects = Array.isArray(raw.objects)
    ? raw.objects
    : Array.isArray(raw.nodes)
      ? [
          ...raw.nodes,
          ...(Array.isArray(raw.edges) ? raw.edges : []),
          ...(Array.isArray(raw.drawings) ? raw.drawings : []),
        ]
      : null;
  return validateState({
    objects,
    viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 },
    settings: raw.settings ?? {},
  });
}
export async function retirePayload(ref: string | undefined) {
  if (!ref) return;
  const garbage = adminDb()
    .collection("_payloadGarbage")
    .doc(Buffer.from(ref).toString("base64url"));
  await garbage.set({
    payloadRef: ref,
    createdAt: FieldValue.serverTimestamp(),
  });
  // Grace period protects readers that already fetched the previous pointer.
}
export async function cleanupPayloads() {
  const queue = await adminDb()
    .collection("_payloadGarbage")
    .where("createdAt", "<", new Date(Date.now() - 3_600_000))
    .limit(500)
    .get();
  const results = await Promise.allSettled(
    queue.docs.map(async (item) => {
      await external(
        `/payloads/${encodeURIComponent(item.data().payloadRef)}`,
        "DELETE",
      );
      await item.ref.delete();
    }),
  );
  return {
    removed: results.filter((r) => r.status === "fulfilled").length,
    attempted: queue.size,
  };
}
export async function accessProject(
  uid: string,
  mapId: string,
  write = false,
  tx?: Transaction,
) {
  const get = (path: string) =>
    tx ? tx.get(adminDb().doc(path)) : adminDb().doc(path).get();
  const snap = await get(`projects/${mapId}`);
  if (!snap.exists) throw new HttpError(404, "Το έργο δεν βρέθηκε.");
  const project = snap.data() as ProjectData;
  let session: SessionData | undefined;
  let group: { participantIds: string[] } | undefined;
  if (project.liveSessionId) {
    session = (await get(`liveSessions/${project.liveSessionId}`)).data() as
      SessionData | undefined;
    if (project.groupRoomId)
      group = (
        await get(
          `liveSessions/${project.liveSessionId}/groupRooms/${project.groupRoomId}`,
        )
      ).data() as typeof group;
  }
  const access = projectAccess(uid, project, session, group);
  if (!(write ? access.write : access.read))
    throw new HttpError(403, "Δεν έχετε δικαίωμα για αυτή την ενέργεια.");
  return project;
}
export async function storedBoard(mapId: string) {
  const data = (
    await adminDb().doc(`projects/${mapId}/snapshots/current`).get()
  ).data();
  let state: CanvasState | null = null;
  if (data?.payloadRef) state = await downloadState(data.payloadRef);
  else if (data?.payload) state = validateState(data.payload);
  return {
    state,
    revision: Number(data?.revision ?? 0),
    savedAt: data?.savedAt?.toMillis?.() ?? 0,
    payloadRef: data?.payloadRef as string | undefined,
  };
}
export async function loadBoard(uid: string, mapId: string) {
  boardDiag("SERVER_LOAD_START", { mapId, uid: uidTag(uid) });
  await accessProject(uid, mapId);
  const { state, revision, savedAt } = await storedBoard(mapId);
  boardDiag("SERVER_LOAD_OK", {
    mapId,
    uid: uidTag(uid),
    revision,
    objects: state?.objects.length ?? 0,
    hasState: !!state,
  });
  return { state, revision, savedAt };
}
/** Fencing token protects commits when a slow request outlives its distributed lock. */
export async function withBoardLock<T>(
  mapId: string,
  operation: (fence: string) => Promise<T>,
): Promise<T> {
  const ref = adminDb().doc(`_boardLocks/${mapId}`);
  const fence = randomUUID();
  await adminDb().runTransaction(async (tx: Transaction) => {
    const current = (await tx.get(ref)).data();
    if (current?.until > Date.now())
      throw new HttpError(
        409,
        "Μία αποθήκευση βρίσκεται σε εξέλιξη. Δοκιμάστε ξανά.",
      );
    tx.set(ref, { fence, until: Date.now() + 55_000 });
  });
  try {
    return await operation(fence);
  } finally {
    await adminDb().runTransaction(async (tx: Transaction) => {
      if ((await tx.get(ref)).data()?.fence === fence) tx.delete(ref);
    });
  }
}
export async function saveBoard(
  uid: string,
  mapId: string,
  state: CanvasState,
  baseState?: CanvasState | null,
  baseRevision?: number,
) {
  boardDiag("SERVER_SAVE_START", {
    mapId,
    uid: uidTag(uid),
    baseRevision: baseRevision ?? null,
    objects: state.objects.length,
  });
  validateState(state);
  if (baseState) validateState(baseState);
  await accessProject(uid, mapId, true);
  return withBoardLock(mapId, async (fence) => {
    const previous = await storedBoard(mapId);
    const nextRevision = previous.revision + 1;
    boardDiag("SERVER_SAVE_BASE", {
      mapId,
      uid: uidTag(uid),
      previousRevision: previous.revision,
      nextRevision,
      previousObjects: previous.state?.objects.length ?? 0,
      suppliedBaseRevision: baseRevision ?? null,
      hasBaseState: baseState != null,
    });
    if (
      baseState == null &&
      previous.state &&
      baseRevision !== previous.revision
    )
      throw new HttpError(
        409,
        "Το σχέδιο άλλαξε. Φορτώστε την τελευταία έκδοση πριν αποθηκεύσετε.",
      );
    const next = baseState
      ? threeWayMerge(baseState, state, previous.state ?? emptyCanvasState())
      : state;
    validateState(next);
    const uploaded = await uploadState(next);
    boardDiag("STORAGE_UPLOAD_OK", {
      mapId,
      uid: uidTag(uid),
      nextRevision,
      size: uploaded.size,
      objects: next.objects.length,
    });
    const registry = adminDb().doc(`_managedPayloads/${mapId}`);
    let oldManaged: string | undefined;
    try {
      await adminDb().runTransaction(async (tx: Transaction) => {
        await accessProject(uid, mapId, true, tx);
        const lock = (
          await tx.get(adminDb().doc(`_boardLocks/${mapId}`))
        ).data();
        oldManaged = (await tx.get(registry)).data()?.payloadRef;
        if (lock?.fence !== fence || lock.until < Date.now())
          throw new HttpError(409, "Η αποθήκευση χρειάζεται επανάληψη.");
        tx.set(adminDb().doc(`projects/${mapId}/snapshots/current`), {
          ...uploaded,
          payloadSize: uploaded.size,
          revision: nextRevision,
          schemaVersion: 1,
          savedAt: FieldValue.serverTimestamp(),
          savedBy: uid,
        });
        tx.set(registry, { payloadRef: uploaded.payloadRef });
      });
    } catch (error) {
      boardDiag("FIRESTORE_COMMIT_FAIL", {
        mapId,
        uid: uidTag(uid),
        nextRevision,
        message: error instanceof Error ? error.message : String(error),
      });
      await retirePayload(uploaded.payloadRef);
      throw error;
    }
    boardDiag("FIRESTORE_COMMIT_OK", {
      mapId,
      uid: uidTag(uid),
      revision: nextRevision,
      objects: next.objects.length,
    });
    // Only this version's registered refs can be deleted; legacy copies may share a pointer.
    if (oldManaged && oldManaged !== uploaded.payloadRef)
      await retirePayload(oldManaged);

    // Publish only lightweight revision metadata. Connected collaborators
    // immediately fetch the protected payload through /api/board-payload.
    // A failed signal must never turn a successful board save into an error;
    // clients also keep a polling fallback.
    const signalSavedAt = Date.now();
    try {
      await adminRtdb().ref(`boardSync/${mapId}`).set({
        revision: nextRevision,
        savedAt: signalSavedAt,
      });
      boardDiag("RTDB_SIGNAL_OK", { mapId, revision: nextRevision });
    } catch (error) {
      boardDiag("RTDB_SIGNAL_FAIL", {
        mapId,
        revision: nextRevision,
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn("Board sync signal publish failed", error);
    }

    return {
      success: true,
      ...uploaded,
      state: next,
      revision: nextRevision,
      savedAt: signalSavedAt,
    };
  });
}
