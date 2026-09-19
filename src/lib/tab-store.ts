// tab-store.ts — global persistent tab state for the duration of the browser session.
// Survives navigation (Lobby ↔ Live ↔ Project) but clears on browser close / logout.
//
// Each "tab" represents an open board: Live session, Workspace Room, Personal project.
// The + button adds new tabs. Closing a tab removes it from the store.

import { type CanvasTab } from "@/components/canvas/CanvasTabs";

const KEY = "ums:tabs:v1";
const ACTIVE_KEY = "ums:tabs:active:v1";

function read(): CanvasTab[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CanvasTab[]) : [];
  } catch {
    return [];
  }
}

function write(tabs: CanvasTab[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    /**/
  }
}

function readActive(): string {
  try {
    return sessionStorage.getItem(ACTIVE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeActive(id: string) {
  try {
    sessionStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /**/
  }
}

export function clearTabs() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    /**/
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

// useSyncExternalStore requires getSnapshot() to return a REFERENTIALLY
// STABLE value when nothing has changed — otherwise React assumes the store
// is always changing and re-renders forever (this was causing "Maximum
// update depth exceeded" / React error #185 on every page that mounts
// GlobalTabBar, i.e. every project and every live session). Cache the
// snapshot and only recompute it right when a mutation actually happens.
let cachedSnapshot: { tabs: CanvasTab[]; activeId: string } =
  typeof window !== "undefined"
    ? { tabs: read(), activeId: readActive() }
    : { tabs: [], activeId: "" };
const EMPTY_SNAPSHOT = { tabs: [] as CanvasTab[], activeId: "" };

function recomputeSnapshot() {
  cachedSnapshot = { tabs: read(), activeId: readActive() };
}

function notify() {
  recomputeSnapshot();
  listeners.forEach((l) => l());
}

export const tabStore = {
  getTabs: read,
  getActive: readActive,

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Add or activate a tab. Returns the tab id. */
  openTab(tab: CanvasTab): string {
    const tabs = read();
    const existing = tabs.find((t) => t.mapId === tab.mapId);
    if (existing) {
      writeActive(existing.id);
      notify();
      return existing.id;
    }
    const next = [...tabs, tab];
    write(next);
    writeActive(tab.id);
    notify();
    return tab.id;
  },

  closeTab(tabId: string) {
    const tabs = read().filter((t) => t.id !== tabId);
    write(tabs);
    // If closed tab was active, switch to last tab
    if (readActive() === tabId && tabs.length > 0) {
      writeActive(tabs[tabs.length - 1].id);
    }
    notify();
  },

  setActive(tabId: string) {
    writeActive(tabId);
    notify();
  },

  updateTab(tabId: string, patch: Partial<CanvasTab>) {
    const tabs = read().map((t) => (t.id === tabId ? { ...t, ...patch } : t));
    write(tabs);
    notify();
  },
};

// ── React hook ──────────────────────────────────────────────────────
import { useEffect, useSyncExternalStore } from "react";

export function useTabStore() {
  return useSyncExternalStore(
    tabStore.subscribe.bind(tabStore),
    () => cachedSnapshot,
    () => EMPTY_SNAPSHOT,
  );
}
