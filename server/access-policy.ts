/** Shared server authorization policy. Firebase rules mirror the read conditions. */
export interface ProjectData {
  ownerId: string;
  projectType?: string;
  collabParticipantIds?: string[];
  liveSessionId?: string | null;
  groupRoomId?: string | null;
  viewOnly?: boolean;
  deleting?: boolean;
  [key: string]: unknown;
}
export interface SessionData {
  teacherId: string;
  status: string;
  participantIds: string[];
  editPermissions?: string[];
  groupRoomsActive?: boolean;
  [key: string]: unknown;
}
export function projectAccess(
  uid: string,
  project: ProjectData,
  session?: SessionData,
  group?: { participantIds: string[] },
) {
  const owner = uid === project.ownerId;
  const collaborator =
    project.projectType === "collaborative" &&
    !!project.collabParticipantIds?.includes(uid);
  const validSession = !!session && session.teacherId === project.ownerId;
  const peer =
    validSession &&
    (session.teacherId === uid || session.participantIds.includes(uid));
  const read = !project.deleting && (owner || collaborator || peer);
  let write = read && !project.viewOnly && (owner || collaborator);
  if (project.liveSessionId) {
    write =
      read &&
      !project.viewOnly &&
      validSession &&
      session.status === "active" &&
      (owner ||
        (peer &&
          (project.groupRoomId
            ? session.groupRoomsActive !== false &&
              !!group?.participantIds.includes(uid)
            : !!session.editPermissions?.includes(uid))));
  }
  return { read: !!read, write: !!write };
}
