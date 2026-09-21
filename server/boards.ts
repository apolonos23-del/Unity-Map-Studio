import { randomUUID } from "node:crypto";
import {
  FieldValue,
  type DocumentData,
  type Transaction,
  type WriteBatch,
} from "firebase-admin/firestore";
import { adminDb } from "./admin.js";
import { HttpError } from "./http.js";
import {
  projectAccess,
  type ProjectData,
  type SessionData,
} from "./access-policy.js";
import { threeWayMerge } from "../src/lib/canvas/live-merge.js";
import { emptyCanvasState, type CanvasObject, type CanvasState } from "../src/lib/canvas/types.js";

const FIREBASE_PAYLOAD_PREFIX = "fs_";
const MAX_BATCH_WRITES = 425;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
  return clone(state);
}

function boardObjects(mapId: string) {
  return adminDb().collection(`projects/${mapId}/boardObjects`);
}
function boardMeta(mapId: string) {
  return adminDb().doc(`projects/${mapId}/boardMeta/state`);
}
function payloadMeta(ref: string) {
  return adminDb().doc(`_boardPayloads/${ref}`);
}
function payloadObjects(ref: string) {
  return payloadMeta(ref).collection("objects");
}

async function commitOperations(
  operations: Array<(batch: WriteBatch) => void>,
) {
  for (let offset = 0; offset < operations.length; offset += MAX_BATCH_WRITES) {
    const batch = adminDb().batch();
    for (const operation of operations.slice(offset, offset + MAX_BATCH_WRITES))
      operation(batch);
    await batch.commit();
  }
}

async function writeCanonicalBoard(
  mapId: string,
  state: CanvasState,
  options?: { revision?: number; savedBy?: string | null },
) {
  const clean = validateState(state);
  const [existing, currentMeta] = await Promise.all([
    boardObjects(mapId).get(),
    boardMeta(mapId).get(),
  ]);
  const nextIds = new Set(clean.objects.map((object) => object.id));
  const operations: Array<(batch: WriteBatch) => void> = [];

  for (const object of clean.objects) {
    const ref = boardObjects(mapId).doc(object.id);
    const data = clone(object) as unknown as DocumentData;
    operations.push((batch) => batch.set(ref, data));
  }
  for (const document of existing.docs) {
    if (!nextIds.has(document.id))
      operations.push((batch) => batch.delete(document.ref));
  }

  const currentRevision = Number(currentMeta.data()?.revision ?? 0);
  const revision = options?.revision ?? currentRevision + 1;
  operations.push((batch) =>
    batch.set(
      boardMeta(mapId),
      {
        settings: clone(clean.settings),
        schemaVersion: 2,
        revision,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: options?.savedBy ?? null,
      },
      { merge: true },
    ),
  );
  await commitOperations(operations);
  return revision;
}

async function readCanonicalBoard(mapId: string): Promise<{
  state: CanvasState | null;
  revision: number;
  savedAt: number;
}> {
  const [objectsSnap, metaSnap] = await Promise.all([
    boardObjects(mapId).get(),
    boardMeta(mapId).get(),
  ]);
  if (objectsSnap.empty && !metaSnap.exists) {
    return { state: null, revision: 0, savedAt: 0 };
  }
  const objects = objectsSnap.docs
    .map((document) => document.data() as CanvasObject)
    .sort((a, b) => a.zIndex - b.zIndex);
  const meta = metaSnap.data() ?? {};
  return {
    state: validateState({
      objects,
      viewport: { x: 0, y: 0, zoom: 1 },
      settings:
        meta.settings && typeof meta.settings === "object" ? meta.settings : {},
    }),
    revision: Number(meta.revision ?? 0),
    savedAt: meta.updatedAt?.toMillis?.() ?? 0,
  };
}

function legacyStorageConfig() {
  const base = (
    process.env.BOARD_STORAGE_API_URL ||
    "https://demo.unityenergetics.org/unity-map-api"
  ).replace(/\/$/, "");
  const token = process.env.BOARD_STORAGE_TOKEN;
  if (!token) return null;
  return { base, token };
}

async function legacyExternal(path: string, method = "GET") {
  const config = legacyStorageConfig();
  if (!config)
    throw new HttpError(
      503,
      "Το παλιό σχέδιο δεν έχει ακόμη μεταφερθεί στο Firebase και λείπει το legacy storage token.",
    );
  let response: Response;
  try {
    response = await fetch(`${config.base}${path}`, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "Δεν είναι δυνατή η ανάκτηση παλιού σχεδίου.");
  }
  if (!response.ok)
    throw new HttpError(
      502,
      `Η ανάκτηση παλιού σχεδίου απέτυχε (HTTP ${response.status}).`,
    );
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== "object")
    throw new HttpError(502, "Μη έγκυρη απάντηση παλιού storage.");
  return result as Record<string, unknown>;
}

function unwrapLegacyPayload(value: unknown): Record<string, unknown> {
  let current = value;
  for (let depth = 0; depth < 6; depth++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const record = current as Record<string, unknown>;
    if (Array.isArray(record.objects) || Array.isArray(record.nodes)) return record;
    if (record.payload && typeof record.payload === "object") {
      current = record.payload;
      continue;
    }
    break;
  }
  return (current && typeof current === "object" ? current : {}) as Record<
    string,
    unknown
  >;
}

async function downloadLegacyState(ref: string): Promise<CanvasState> {
  const data = await legacyExternal(`/payloads/${encodeURIComponent(ref)}`);
  const raw = unwrapLegacyPayload(data);
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

/** Firebase-only immutable transfer payload used by copies and sent designs. */
export async function uploadState(state: CanvasState) {
  const clean = validateState(state);
  const ref = `${FIREBASE_PAYLOAD_PREFIX}${randomUUID()}`;
  const operations: Array<(batch: WriteBatch) => void> = [];
  operations.push((batch) =>
    batch.set(payloadMeta(ref), {
      viewport: clone(clean.viewport),
      settings: clone(clean.settings),
      schemaVersion: 2,
      createdAt: FieldValue.serverTimestamp(),
      size: Buffer.byteLength(JSON.stringify(clean)),
    }),
  );
  for (const object of clean.objects) {
    const data = clone(object) as unknown as DocumentData;
    operations.push((batch) => batch.set(payloadObjects(ref).doc(object.id), data));
  }
  await commitOperations(operations);
  return {
    payloadRef: ref,
    payloadUrl: `firebase://${ref}`,
    size: Buffer.byteLength(JSON.stringify(clean)),
  };
}

export async function downloadState(ref: string): Promise<CanvasState> {
  if (!ref.startsWith(FIREBASE_PAYLOAD_PREFIX)) return downloadLegacyState(ref);
  const [metaSnap, objectsSnap] = await Promise.all([
    payloadMeta(ref).get(),
    payloadObjects(ref).get(),
  ]);
  if (!metaSnap.exists)
    throw new HttpError(404, "Το αποθηκευμένο σχέδιο δεν βρέθηκε.");
  const meta = metaSnap.data() ?? {};
  return validateState({
    objects: objectsSnap.docs.map((document) => document.data()),
    viewport: meta.viewport ?? { x: 0, y: 0, zoom: 1 },
    settings: meta.settings ?? {},
  });
}

export async function retirePayload(ref: string | undefined) {
  if (!ref) return;
  if (ref.startsWith(FIREBASE_PAYLOAD_PREFIX)) {
    await adminDb().recursiveDelete(payloadMeta(ref));
    return;
  }
  const garbage = adminDb()
    .collection("_payloadGarbage")
    .doc(Buffer.from(ref).toString("base64url"));
  await garbage.set({
    payloadRef: ref,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function cleanupPayloads() {
  const queue = await adminDb()
    .collection("_payloadGarbage")
    .where("createdAt", "<", new Date(Date.now() - 3_600_000))
    .limit(500)
    .get();
  const config = legacyStorageConfig();
  if (!config) return { removed: 0, attempted: queue.size };
  const results = await Promise.allSettled(
    queue.docs.map(async (item) => {
      const ref = String(item.data().payloadRef ?? "");
      if (!ref) return;
      const response = await fetch(
        `${config.base}/payloads/${encodeURIComponent(ref)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok && response.status !== 404)
        throw new Error(`Legacy payload delete failed: ${response.status}`);
      await item.ref.delete();
    }),
  );
  return {
    removed: results.filter((result) => result.status === "fulfilled").length,
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
      | SessionData
      | undefined;
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

async function migrateLegacyBoardIfNeeded(mapId: string) {
  const canonical = await readCanonicalBoard(mapId);
  if (canonical.state) return canonical;

  const snapshotRef = adminDb().doc(`projects/${mapId}/snapshots/current`);
  const snapshot = await snapshotRef.get();
  const data = snapshot.data();
  let state: CanvasState | null = null;
  if (data?.payloadRef) state = await downloadState(String(data.payloadRef));
  else if (data?.payload) state = validateState(data.payload);
  if (!state) return canonical;

  const revision = Math.max(1, Number(data?.revision ?? 1));
  await writeCanonicalBoard(mapId, state, { revision, savedBy: data?.savedBy ?? null });
  await snapshotRef.set(
    {
      storage: "firestore-board-v2",
      revision,
      schemaVersion: 2,
      savedAt: FieldValue.serverTimestamp(),
      savedBy: data?.savedBy ?? null,
    },
    { merge: false },
  );
  if (data?.payloadRef) {
    await retirePayload(String(data.payloadRef));
    await adminDb().doc(`_managedPayloads/${mapId}`).delete().catch(() => {});
  }
  return readCanonicalBoard(mapId);
}

export async function storedBoard(mapId: string) {
  const board = await migrateLegacyBoardIfNeeded(mapId);
  return {
    state: board.state,
    revision: board.revision,
    savedAt: board.savedAt,
    payloadRef: undefined as string | undefined,
  };
}

export async function loadBoard(uid: string, mapId: string) {
  await accessProject(uid, mapId);
  const { state, revision, savedAt } = await storedBoard(mapId);
  return { state, revision, savedAt };
}

/** One-time bridge for projects created before Firebase board v2. */
export async function prepareBoard(uid: string, mapId: string) {
  await accessProject(uid, mapId);
  const current = await storedBoard(mapId);
  if (!current.state) {
    await writeCanonicalBoard(mapId, emptyCanvasState(), {
      revision: 0,
      savedBy: uid,
    });
  }
  return { ready: true };
}

/** Compatibility lock for old cached clients still calling /api/board-payload. */
export async function withBoardLock<T>(
  mapId: string,
  operation: (fence: string) => Promise<T>,
): Promise<T> {
  const ref = adminDb().doc(`_boardLocks/${mapId}`);
  const fence = randomUUID();
  await adminDb().runTransaction(async (tx: Transaction) => {
    const current = (await tx.get(ref)).data();
    if (current?.until > Date.now())
      throw new HttpError(409, "Μία αποθήκευση βρίσκεται σε εξέλιξη. Δοκιμάστε ξανά.");
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

/** Compatibility endpoint for an old browser bundle during rollout. */
export async function saveBoard(
  uid: string,
  mapId: string,
  state: CanvasState,
  baseState?: CanvasState | null,
  baseRevision?: number,
) {
  validateState(state);
  if (baseState) validateState(baseState);
  await accessProject(uid, mapId, true);
  return withBoardLock(mapId, async () => {
    const previous = await storedBoard(mapId);
    if (baseState == null && previous.state && baseRevision !== previous.revision)
      throw new HttpError(
        409,
        "Το σχέδιο άλλαξε. Φορτώστε την τελευταία έκδοση πριν αποθηκεύσετε.",
      );
    const next = baseState
      ? threeWayMerge(baseState, state, previous.state ?? emptyCanvasState())
      : state;
    const revision = await writeCanonicalBoard(mapId, next, {
      revision: previous.revision + 1,
      savedBy: uid,
    });
    return {
      success: true,
      payloadRef: `firestore-board:${mapId}`,
      payloadUrl: "",
      size: Buffer.byteLength(JSON.stringify(next)),
      state: next,
      revision,
      savedAt: Date.now(),
    };
  });
}
