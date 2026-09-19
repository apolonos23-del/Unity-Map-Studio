// Stage 6: Personal folders for the project library.
//
// Cost annotations per call:
//   createFolder:       1 write
//   renameFolder:       1 write
//   deleteFolder:       N+1 writes (1 delete + N detach/delete project updates)
//   subscribeMyFolders: N reads on initial + 1 per change delivered.
//   moveProjectToFolder: 1 write
//
// All Firestore access goes through the quota-guard wrappers — no raw
// firebase/firestore calls.

import {
  collection,
  doc,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  cAddDoc,
  cDeleteDoc,
  cGetDocs,
  cOnSnapshot,
  cUpdateDoc,
} from "./quota-guard";
import { mapStore } from "./canvas/storage";

export interface Folder {
  id: string;
  ownerId: string;
  name: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export async function createFolder(
  ownerId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Το όνομα φακέλου είναι κενό.");
  const ref = await cAddDoc(collection(db(), "folders"), {
    ownerId,
    name: trimmed,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameFolder(
  folderId: string,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Το όνομα φακέλου είναι κενό.");
  await cUpdateDoc(doc(db(), "folders", folderId), {
    name: trimmed,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeMyFolders(
  ownerId: string,
  cb: (folders: Folder[]) => void,
): Unsubscribe {
  const q = query(collection(db(), "folders"), where("ownerId", "==", ownerId));
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<Folder, "id"> }>;
    };
    const rows = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => a.name.localeCompare(b.name, "el"));
    cb(rows);
  });
}

export async function moveProjectToFolder(
  projectId: string,
  folderId: string | null,
): Promise<void> {
  await cUpdateDoc(doc(db(), "projects", projectId), {
    folderId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a folder. By default ({ deleteProjects: false }) every project
 * currently inside the folder is *detached* (folderId set to null) — its
 * data is preserved. Only with deleteProjects: true (explicit, gated by a
 * separate confirmation in the UI) are the contained projects also removed.
 */
export async function deleteFolder(
  folderId: string,
  ownerId: string,
  opts: { deleteProjects?: boolean } = {},
): Promise<void> {
  const projectsSnap = await cGetDocs(
    query(
      collection(db(), "projects"),
      where("ownerId", "==", ownerId),
      where("folderId", "==", folderId),
    ),
  );
  const { deleteProject } = await import("./projects");
  for (const d of projectsSnap.docs) {
    if (opts.deleteProjects) {
      await deleteProject(d.id);
    } else {
      await cUpdateDoc(doc(db(), "projects", d.id), {
        folderId: null,
        updatedAt: serverTimestamp(),
      });
    }
  }
  await cDeleteDoc(doc(db(), "folders", folderId));
}

// Re-export for tests / consumers that want mapStore-coupled cleanup.
export { mapStore };
