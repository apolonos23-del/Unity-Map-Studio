import {
  collection,
  doc,
  increment,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type QuerySnapshot,
} from "firebase/firestore";
import { apiRequest } from "../api-client";
import { auth, db } from "../firebase";
import {
  cCommitBatch,
  cGetDoc,
  cGetDocs,
  cOnSnapshot,
} from "../quota-guard";
import {
  diffCanvasState,
  isCanvasObject,
  sanitizeForFirebase,
  validViewport,
} from "./firebase-board-model";
import { emptyCanvasState, type CanvasObject, type CanvasState } from "./types";

const PREFIX = "ums:canvas-recovery:";
const MAX_BATCH_WRITES = 425;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function recoveryKey(mapId: string): string | null {
  const uid = auth().currentUser?.uid;
  return uid ? `${PREFIX}${uid}:${mapId}` : null;
}

interface BaseSnapshot {
  state: CanvasState | null;
  revision: number;
  savedAt: number;
}

export interface BoardPayload {
  state: CanvasState | null;
  revision: number;
  savedAt: number;
}

export interface SavedBoardPayload extends BoardPayload {
  success: true;
  state: CanvasState;
}

export interface BoardSubscriptionHandlers {
  onObjectUpsert: (object: CanvasObject) => void;
  onObjectRemove: (objectId: string) => void;
  onSettings: (settings: Record<string, unknown>, revision: number) => void;
  onError?: (error: Error) => void;
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object") {
    const toMillis = (value as { toMillis?: () => number }).toMillis;
    if (typeof toMillis === "function") return toMillis.call(value);
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function validateObjectDoc(value: unknown, id: string): CanvasObject {
  if (!isCanvasObject(value) || value.id !== id)
    throw new Error(`Μη έγκυρο αντικείμενο Firebase: ${id}`);
  return clone(value);
}

function validSettings(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export class FirestoreMapStore {
  private bases = new Map<string, BaseSnapshot>();
  private queues = new Map<string, Promise<unknown>>();

  private objectCollection(mapId: string) {
    return collection(db(), "projects", mapId, "boardObjects");
  }

  private metaRef(mapId: string) {
    return doc(db(), "projects", mapId, "boardMeta", "state");
  }

  private viewRef(mapId: string, uid: string) {
    return doc(db(), "projects", mapId, "boardViews", uid);
  }

  async loadWithMeta(mapId: string): Promise<BoardPayload> {
    const key = recoveryKey(mapId);
    const uid = auth().currentUser?.uid;
    if (!key || !uid) throw new Error("Authentication required");

    let initialMeta = await cGetDoc(this.metaRef(mapId));
    if (!initialMeta.exists()) {
      try {
        await apiRequest("prepare-board", { projectId: mapId });
        initialMeta = await cGetDoc(this.metaRef(mapId));
      } catch (error) {
        // Legacy migration is best-effort. A browser with a local recovery
        // copy can still restore it directly into Firebase board v2.
        console.warn("Firebase board preparation failed", error);
      }
    }

    const [objectsSnap, viewSnap] = await Promise.all([
      cGetDocs(this.objectCollection(mapId)),
      cGetDoc(this.viewRef(mapId, uid)),
    ]);
    const metaSnap = initialMeta;
    if (recoveryKey(mapId) !== key) throw new Error("Authentication changed");

    const objects = objectsSnap.docs
      .map((snapshot) => validateObjectDoc(snapshot.data(), snapshot.id))
      .sort((a, b) => a.zIndex - b.zIndex);
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    const view = viewSnap.exists() ? viewSnap.data() : {};
    const state: CanvasState = {
      objects,
      settings: validSettings(meta.settings) ? clone(meta.settings) : {},
      viewport: validViewport(view.viewport)
        ? clone(view.viewport)
        : { x: 0, y: 0, zoom: 1 },
    };
    const result: BoardPayload = {
      state,
      revision:
        typeof meta.revision === "number" && Number.isFinite(meta.revision)
          ? meta.revision
          : 0,
      savedAt: timestampMillis(meta.updatedAt),
    };
    this.bases.set(key, { ...result, state: clone(state) });
    return { ...result, state: clone(state) };
  }

  async load(mapId: string): Promise<CanvasState | null> {
    return (await this.loadWithMeta(mapId)).state;
  }

  async loadRecovery(
    mapId: string,
    pendingOnly = false,
  ): Promise<CanvasState | null> {
    const key = recoveryKey(mapId);
    if (!key) return null;
    try {
      const value = window.localStorage.getItem(key);
      if (!value) return null;
      const record = JSON.parse(value);
      if (pendingOnly && !record.dirty) return null;
      return (record.state ?? record) as CanvasState;
    } catch {
      return null;
    }
  }

  save(
    mapId: string,
    state: CanvasState,
    opts?: { inline?: boolean; baseState?: CanvasState },
  ): Promise<SavedBoardPayload> {
    const key = recoveryKey(mapId);
    const uid = auth().currentUser?.uid;
    if (!key || !uid)
      return Promise.reject(new Error("Authentication required"));

    const frozen = sanitizeForFirebase(state);
    const baseSnapshot = this.bases.get(key);
    const base = sanitizeForFirebase(
      opts?.baseState ?? baseSnapshot?.state ?? emptyCanvasState(),
    );
    this.writeRecovery(mapId, frozen);

    const prior = this.queues.get(key) ?? Promise.resolve();
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        if (recoveryKey(mapId) !== key)
          throw new Error("Authentication changed");

        const diff = diffCanvasState(base, frozen);
        const sharedChanged =
          diff.upserts.length > 0 ||
          diff.removals.length > 0 ||
          diff.settingsChanged;
        const operations: Array<
          | { kind: "set"; ref: DocumentReference<DocumentData>; data: DocumentData }
          | { kind: "delete"; ref: DocumentReference<DocumentData> }
        > = [];

        for (const object of diff.upserts) {
          operations.push({
            kind: "set",
            ref: doc(this.objectCollection(mapId), object.id),
            data: sanitizeForFirebase(object) as unknown as DocumentData,
          });
        }
        for (const objectId of diff.removals) {
          operations.push({
            kind: "delete",
            ref: doc(this.objectCollection(mapId), objectId),
          });
        }
        if (sharedChanged) {
          operations.push({
            kind: "set",
            ref: this.metaRef(mapId),
            data: {
              settings: sanitizeForFirebase(frozen.settings),
              schemaVersion: 2,
              revision: increment(1),
              updatedAt: serverTimestamp(),
              updatedBy: uid,
            },
          });
        }
        if (diff.viewportChanged || !baseSnapshot?.state) {
          operations.push({
            kind: "set",
            ref: this.viewRef(mapId, uid),
            data: {
              viewport: sanitizeForFirebase(frozen.viewport),
              updatedAt: serverTimestamp(),
            },
          });
        }

        for (let offset = 0; offset < operations.length; offset += MAX_BATCH_WRITES) {
          const chunk = operations.slice(offset, offset + MAX_BATCH_WRITES);
          const batch = writeBatch(db());
          for (const item of chunk) {
            if (item.kind === "delete") batch.delete(item.ref);
            else batch.set(item.ref, item.data, { merge: item.ref.path.endsWith("/boardMeta/state") });
          }
          await cCommitBatch(batch, chunk.length);
        }

        if (recoveryKey(mapId) !== key)
          throw new Error("Authentication changed");

        const revision =
          (baseSnapshot?.revision ?? 0) + (sharedChanged ? 1 : 0);
        const savedAt = Date.now();
        const canonical = clone(frozen);
        this.bases.set(key, { state: canonical, revision, savedAt });
        if (this.queues.get(key) === operation)
          this.writeRecovery(mapId, canonical, false);
        return {
          success: true as const,
          state: clone(canonical),
          revision,
          savedAt,
        };
      });

    this.queues.set(key, operation);
    void operation
      .finally(() => {
        if (this.queues.get(key) === operation) this.queues.delete(key);
      })
      .catch(() => undefined);
    return operation;
  }

  subscribe(mapId: string, handlers: BoardSubscriptionHandlers): () => void {
    const objectUnsubscribe = cOnSnapshot(
      this.objectCollection(mapId),
      (snapshot) => {
        const querySnapshot = snapshot as QuerySnapshot<DocumentData>;
        for (const change of querySnapshot.docChanges()) {
          if (change.type === "removed") {
            handlers.onObjectRemove(change.doc.id);
            continue;
          }
          try {
            handlers.onObjectUpsert(
              validateObjectDoc(change.doc.data(), change.doc.id),
            );
          } catch (error) {
            handlers.onError?.(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        }
      },
      handlers.onError,
    );

    const metaUnsubscribe = cOnSnapshot(
      this.metaRef(mapId),
      (snapshot) => {
        const documentSnapshot = snapshot as {
          exists: () => boolean;
          data: () => DocumentData;
        };
        if (!documentSnapshot.exists()) {
          handlers.onSettings({}, 0);
          return;
        }
        const data = documentSnapshot.data();
        handlers.onSettings(
          validSettings(data.settings) ? clone(data.settings) : {},
          typeof data.revision === "number" ? data.revision : 0,
        );
      },
      handlers.onError,
    );

    return () => {
      objectUnsubscribe();
      metaUnsubscribe();
    };
  }

  async delete(mapId: string): Promise<void> {
    const key = recoveryKey(mapId);
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* unavailable */
      }
      this.bases.delete(key);
      this.queues.delete(key);
    }
  }

  writeRecovery(mapId: string, state: CanvasState, dirty = true): void {
    const key = recoveryKey(mapId);
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ state, dirty }));
    } catch {
      /* quota/unavailable */
    }
  }
}

export const mapStore = new FirestoreMapStore();
