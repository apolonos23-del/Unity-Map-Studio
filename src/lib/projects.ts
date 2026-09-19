import { apiRequest } from "./api-client";
// Cost annotations per call:
//   createProject:        3 writes (project + initial snapshot + owner member doc)
//   subscribeMyProjects:  N reads on initial + 1 per change delivered.
//                         onSnapshot is a known quota risk; see quota-guard.ts.
//   getProject:           1 read
//   updateProjectStatus / renameProject: 1 write
//   listProjectsWhere:    N reads (one per matched doc, min 1)

import {
  collection,
  doc,
  query,
  where,
  serverTimestamp,
  arrayUnion,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  cAddDoc,
  cDeleteDoc,
  cGetDoc,
  cGetDocs,
  cOnSnapshot,
  cSetDoc,
  cUpdateDoc,
} from "./quota-guard";
import { mapStore } from "./canvas/storage";

export type ProjectStatus = "draft" | "saved" | "active_collab" | "archived";

export type ProjectType = "personal" | "collaborative" | "session_board";

export type ProjectMode = "solo" | "live" | "collaborativeFinal";

export type WorkspaceType =
  "case-analysis" | "concept-analysis" | "free-drawing" | "genogram";

export interface Project {
  id: string;
  ownerId: string;
  workspace?: string;
  workspaceType?: WorkspaceType;
  mode?: ProjectMode;
  sourceMapId?: string | null;
  liveSessionId?: string | null;
  /** Stage 6: optional folder reference. null/absent = "Χωρίς φάκελο". */
  folderId?: string | null;
  title: string;
  status: ProjectStatus;
  projectType: ProjectType;
  thumbnail?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  /** Anyone in this list can co-edit the project live, exactly like a
   *  group's members — set for projectType "collaborative" only. See
   *  startCollabProject / joinCollabProject / subscribeCollabParticipants. */
  collabParticipantIds?: string[];
  /** Set true once finalizeCollabProjectIfEmpty has distributed personal
   *  copies to everyone — the lobby's "Συνεργατικό live" button ignores
   *  any project with this set. */
  collabFinalized?: boolean;
  /** Human-readable origin, e.g. a live session or group's name.
   *  Shown under the project title in the library so people can tell where
   *  an auto-saved draft came from. Absent for normal, manually-created projects. */
  originLabel?: string;
  /** Set on a project received via "Αποστολή σχεδίου σε" with "Προβολή"
   *  permission — the recipient's own copy, but locked to read-only. */
  viewOnly?: boolean;
  /** When this copy was auto-saved (e.g. on leaving a room). Distinct from
   *  createdAt/updatedAt which track the underlying project doc lifecycle. */
  savedAt?: unknown;
}

export async function createProject(
  ownerId: string,
  title: string,
  projectType: ProjectType = "personal",
  workspaceType: WorkspaceType = "free-drawing",
): Promise<string> {
  const result = await apiRequest<{ id: string }>("create-project", {
    title,
    projectType,
    workspaceType,
  });
  return result.id;
}

export async function createProjectFromObjects(
  ownerId: string,
  title: string,
  objects: import("./canvas/types").CanvasObject[],
  workspaceType: WorkspaceType = "free-drawing",
): Promise<string> {
  const { regenerateAndOffsetObjects } =
    await import("./canvas/insert-into-board");
  const left = objects.length ? Math.min(...objects.map((o) => o.x)) : 0;
  const top = objects.length ? Math.min(...objects.map((o) => o.y)) : 0;
  const projectId = await createProject(
    ownerId,
    title,
    "personal",
    workspaceType,
  );
  try {
    await mapStore.save(projectId, {
      objects: regenerateAndOffsetObjects(objects, 120 - left, 120 - top),
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
    });
  } catch (error) {
    await deleteProject(projectId).catch(() => {});
    throw error;
  }
  return projectId;
}

export async function startCollabProject(
  projectId: string,
  ownerId: string,
): Promise<void> {
  const project = await getProject(projectId);
  if (
    !project ||
    project.ownerId !== ownerId ||
    project.projectType !== "collaborative"
  )
    throw new Error("Μη έγκυρο συνεργατικό έργο.");
}

export function subscribeCollabParticipants(
  projectId: string,
  cb: (uids: string[]) => void,
): Unsubscribe {
  return cOnSnapshot(doc(db(), "projects", projectId), (snap) => {
    const data = (
      snap as { data: () => { collabParticipantIds?: string[] } | undefined }
    ).data();
    cb(data?.collabParticipantIds ?? []);
  });
}

/** Called when a collaborator explicitly clicks "Αποθήκευση στα Έργα μου"
 *  — saves (or re-saves, if clicked again later) an independent personal
 *  copy of the CURRENT board state, owned by just this one participant.
 *  The collaborative project itself is untouched and stays open — nobody
 *  else's access changes, and anyone can keep coming back to it (and
 *  save their own updated copy again) at any time. Deliberately does
 *  NOT touch collabParticipantIds or close anything down. */
export async function saveMyCollabCopy(
  projectId: string,
  uid: string,
): Promise<string> {
  return (
    await apiRequest<{ id: string }>("copy-project", {
      sourceProjectId: projectId,
      collabCopy: true,
    })
  ).id;
}

export function subscribeMyCollabProjects(
  uid: string,
  cb: (projects: Project[]) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "projects"),
    where("projectType", "==", "collaborative"),
    where("collabParticipantIds", "array-contains", uid),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<Project, "id"> }>;
    };
    cb(
      qs.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.projectType === "collaborative" && !p.collabFinalized),
    );
  });
}

export function subscribeMyProjects(
  ownerId: string,
  cb: (projects: Project[]) => void,
): Unsubscribe {
  const q = query(
    collection(db(), "projects"),
    where("ownerId", "==", ownerId),
  );
  return cOnSnapshot(q, (snap) => {
    const qs = snap as unknown as {
      docs: Array<{ id: string; data: () => Omit<Project, "id"> }>;
    };
    const rows = qs.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => {
        if (p.projectType === "session_board") return false;
        if (
          p.projectType === "collaborative" &&
          /^Χώρος \d+/.test(p.title ?? "")
        )
          return false;
        if ((p.title ?? "").startsWith("[LIVE]")) return false;
        return true;
      });
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

export async function getProject(id: string): Promise<Project | null> {
  const snap = await cGetDoc(doc(db(), "projects", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Project, "id">) };
}

export async function updateProjectStatus(id: string, status: ProjectStatus) {
  await cUpdateDoc(doc(db(), "projects", id), {
    status,
    updatedAt: serverTimestamp(),
  });
}

export async function renameProject(id: string, title: string) {
  await cUpdateDoc(doc(db(), "projects", id), {
    title,
    updatedAt: serverTimestamp(),
  });
}

/** Delete through the authenticated server, including nested documents. */
export async function deleteProject(id: string): Promise<void> {
  await apiRequest("delete-project", { projectId: id });
  await mapStore.delete(id);
}

export async function duplicateProject(
  ownerId: string,
  sourceProjectId: string,
  newTitle: string,
  opts?: { viewOnly?: boolean; forcePersonalType?: boolean },
): Promise<string> {
  return (
    await apiRequest<{ id: string }>("copy-project", {
      sourceProjectId,
      title: newTitle,
    })
  ).id;
}

export async function listProjectsWhere(predicate: {
  ownerId?: string;
  status?: ProjectStatus;
  projectType?: ProjectType;
}): Promise<Project[]> {
  const filters = [];
  if (predicate.ownerId)
    filters.push(where("ownerId", "==", predicate.ownerId));
  if (predicate.status) filters.push(where("status", "==", predicate.status));
  if (predicate.projectType)
    filters.push(where("projectType", "==", predicate.projectType));
  const q = query(collection(db(), "projects"), ...filters);
  const snap = await cGetDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Project, "id">),
  }));
}
