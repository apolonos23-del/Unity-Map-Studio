// INVARIANT: Every Firestore read/write in this app must go through these
// wrappers — grep for raw firebase/firestore calls outside this file before
// merging any new Firestore code.
/**
 * Firestore quota safety net.
 *
 * IMPORTANT — this is an INTERNAL APPROXIMATION, not the authoritative
 * Firebase billing number. It counts every Firestore read/write this app
 * issues (because all calls go through the wrappers below), but it cannot
 * see traffic from outside this browser session (Firebase Console
 * browsing, other devices, other projects on the same account). It also
 * resets on every page reload — building a true cross-device daily
 * counter would itself cost reads/writes, which would be counterproductive.
 *
 * Free-tier (Spark plan) limits at the time of writing:
 *   50,000 reads/day, 20,000 writes/day, 20,000 deletes/day.
 *
 * Per-session budget math (configurable below):
 *   reads/day / sessions-per-day / users-per-session  =  per-session read budget
 *   e.g. 50_000 / 4 / 15  ≈  833 reads / session / user.
 */

import {
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  type DocumentReference,
  type CollectionReference,
  type Query,
  type DocumentData,
  type DocumentSnapshot,
  type QuerySnapshot,
  type WithFieldValue,
  type UpdateData,
  type SetOptions,
  type Unsubscribe,
  type WriteBatch,
} from "firebase/firestore";

// ── Tunable constants ────────────────────────────────────────────────
export const DAILY_FREE_READS = 50_000;
export const DAILY_FREE_WRITES = 20_000;
export const ASSUMED_SESSIONS_PER_DAY = 4;
export const ASSUMED_USERS_PER_SESSION = 15;
export const WARN_RATIO = 0.6;
export const CRITICAL_RATIO = 0.85;

export const PER_SESSION_READ_BUDGET = Math.floor(
  DAILY_FREE_READS / ASSUMED_SESSIONS_PER_DAY / ASSUMED_USERS_PER_SESSION,
);
export const PER_SESSION_WRITE_BUDGET = Math.floor(
  DAILY_FREE_WRITES / ASSUMED_SESSIONS_PER_DAY / ASSUMED_USERS_PER_SESSION,
);

export type QuotaLevel = "ok" | "warn" | "critical";

// ── State ────────────────────────────────────────────────────────────
let firestoreReads = 0;
let firestoreWrites = 0;
let level: QuotaLevel = "ok";
const listeners = new Set<(s: QuotaSnapshot) => void>();

export interface QuotaSnapshot {
  reads: number;
  writes: number;
  level: QuotaLevel;
  readBudget: number;
  writeBudget: number;
}

export function getQuotaSnapshot(): QuotaSnapshot {
  return {
    reads: firestoreReads,
    writes: firestoreWrites,
    level,
    readBudget: PER_SESSION_READ_BUDGET,
    writeBudget: PER_SESSION_WRITE_BUDGET,
  };
}

export function subscribeQuota(cb: (s: QuotaSnapshot) => void): () => void {
  listeners.add(cb);
  cb(getQuotaSnapshot());
  return () => listeners.delete(cb);
}

export function isCritical(): boolean {
  return level === "critical";
}

function recompute() {
  const rRatio = firestoreReads / PER_SESSION_READ_BUDGET;
  const wRatio = firestoreWrites / PER_SESSION_WRITE_BUDGET;
  const worst = Math.max(rRatio, wRatio);
  const next: QuotaLevel =
    worst >= CRITICAL_RATIO ? "critical" : worst >= WARN_RATIO ? "warn" : "ok";
  if (next !== level) {
    level = next;
  }
  const snap = getQuotaSnapshot();
  listeners.forEach((l) => l(snap));
}

function recordRead(n = 1) {
  firestoreReads += n;
  recompute();
}
function recordWrite(n = 1) {
  firestoreWrites += n;
  recompute();
}

// ── Wrappers ─────────────────────────────────────────────────────────
// All Firestore access in this app MUST go through these wrappers so
// every read/write is counted. Cost-per-call comments document the
// per-action quota impact for downstream features.

/** 1 read */
export async function cGetDoc<T = DocumentData>(
  ref: DocumentReference<T>,
): Promise<DocumentSnapshot<T>> {
  recordRead(1);
  return getDoc(ref);
}

/** N reads where N = number of returned docs (min 1 for empty query) */
export async function cGetDocs<T = DocumentData>(
  q: Query<T> | CollectionReference<T>,
): Promise<QuerySnapshot<T>> {
  const s = await getDocs(q);
  recordRead(Math.max(1, s.size));
  return s;
}

/** 1 write */
export async function cSetDoc<T = DocumentData>(
  ref: DocumentReference<T>,
  data: WithFieldValue<T>,
  options?: SetOptions,
): Promise<void> {
  recordWrite(1);
  if (options) return setDoc(ref, data, options);
  return setDoc(ref, data);
}

/** 1 write, returns the new ref */
export async function cAddDoc<T = DocumentData>(
  ref: CollectionReference<T>,
  data: WithFieldValue<T>,
): Promise<DocumentReference<T>> {
  recordWrite(1);
  return addDoc(ref, data);
}

/** 1 write */
export async function cUpdateDoc(
  ref: DocumentReference<DocumentData>,
  data: UpdateData<DocumentData>,
): Promise<void> {
  recordWrite(1);
  return updateDoc(ref, data);
}

/** 1 delete (counts against the write/delete quota separately on Firebase,
 *  but we lump into writes here for simplicity) */
export async function cDeleteDoc<T = DocumentData>(
  ref: DocumentReference<T>,
): Promise<void> {
  recordWrite(1);
  return deleteDoc(ref);
}

/**
 * onSnapshot is the SINGLE BIGGEST QUOTA RISK because Firestore charges
 * one read per document delivered to every connected client, every time
 * a change is published. Use sparingly. Cost: ≥1 read per delivery, per
 * client. AVOID in classroom-scale features — prefer periodic getDoc
 * polling (see CanvasStage live sync).
 */
export function cOnSnapshot<T = DocumentData>(
  source: DocumentReference<T> | Query<T> | CollectionReference<T>,
  cb: (snap: DocumentSnapshot<T> | QuerySnapshot<T>) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    source as never,
    (snap: unknown) => {
      const s = snap as DocumentSnapshot<T> | QuerySnapshot<T>;
      const size = (s as QuerySnapshot<T>).size;
      recordRead(typeof size === "number" ? Math.max(1, size) : 1);
      cb(s);
    },
    onError,
  );
}

/** Commit an already prepared Firestore batch while accounting for each write. */
export async function cCommitBatch(
  batch: WriteBatch,
  writeCount: number,
): Promise<void> {
  if (writeCount > 0) recordWrite(writeCount);
  await batch.commit();
}
