import { auth } from "../firebase";
import {
  loadBoardPayload,
  saveBoardPayload,
  type BoardPayload,
  type SavedBoardPayload,
} from "./payload-api";
import type { CanvasState } from "./types";

const PREFIX = "ums:canvas-recovery:";
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

export class FirestoreMapStore {
  private bases = new Map<string, BaseSnapshot>();
  private queues = new Map<string, Promise<unknown>>();

  async loadWithMeta(mapId: string): Promise<BoardPayload> {
    const key = recoveryKey(mapId);
    if (!key) throw new Error("Authentication required");
    const result = await loadBoardPayload(mapId);
    if (recoveryKey(mapId) !== key) throw new Error("Authentication changed");
    const canonical = result.state ? clone(result.state) : null;
    this.bases.set(key, { ...result, state: canonical });
    return { ...result, state: canonical ? clone(canonical) : null };
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
    _opts?: { inline?: boolean; baseState?: CanvasState },
  ): Promise<SavedBoardPayload> {
    const key = recoveryKey(mapId);
    if (!key) return Promise.reject(new Error("Authentication required"));
    const frozen = clone(state);
    // Capture the base belonging to this local edit, before waiting on a save.
    const base = this.bases.get(key);
    this.writeRecovery(mapId, frozen);
    const prior = this.queues.get(key) ?? Promise.resolve();
    const operation = prior
      .catch(() => undefined)
      .then(async () => {
        if (recoveryKey(mapId) !== key)
          throw new Error("Authentication changed");
        const saved = await saveBoardPayload(
          mapId,
          frozen,
          _opts?.baseState ?? base?.state,
          base?.revision,
        );
        if (recoveryKey(mapId) !== key)
          throw new Error("Authentication changed");
        const canonical = clone(saved.state);
        this.bases.set(key, {
          state: canonical,
          revision: saved.revision,
          savedAt: saved.savedAt,
        });
        if (this.queues.get(key) === operation)
          this.writeRecovery(mapId, canonical, false);
        return { ...saved, state: clone(canonical) };
      });
    this.queues.set(key, operation);
    void operation
      .finally(() => {
        if (this.queues.get(key) === operation) this.queues.delete(key);
      })
      .catch(() => undefined);
    return operation;
  }
  async delete(mapId: string): Promise<void> {
    const key = recoveryKey(mapId);
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* unavailable */
      }
    }
    if (key) {
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
