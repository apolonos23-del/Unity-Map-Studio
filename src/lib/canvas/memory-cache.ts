// memory-cache.ts — in-memory CanvasState cache per mapId.
// Survives tab switches (component unmount/remount) within the same page session.
// Cleared only on page reload/close (intentional — this is a short-lived safety net,
// not persistent storage; the server is the source of truth).

import type { CanvasState } from "./types";

const cache = new Map<string, CanvasState>();

export const memoryCache = {
  get(mapId: string): CanvasState | null {
    return cache.get(mapId) ?? null;
  },
  set(mapId: string, state: CanvasState): void {
    cache.set(mapId, state);
  },
  delete(mapId: string): void {
    cache.delete(mapId);
  },
  has(mapId: string): boolean {
    return cache.has(mapId);
  },
  clear(): void {
    cache.clear();
  },
};
