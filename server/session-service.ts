import { createHash } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { adminDb } from "./admin.js";
import { HttpError, id, string } from "./http.js";
import { accessProject, storedBoard } from "./boards.js";
import { materializeCopy, newProject, workspace } from "./project-service.js";

export function isTeacher(user: DecodedIdToken) {
  return user.role === "teacher" || user.role === "therapist";
}
async function ownedSession(uid: string, sid: string, tx?: Transaction) {
  const ref = adminDb().doc(`liveSessions/${sid}`);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const data = snap.data();
  if (!data || data.teacherId !== uid)
    throw new HttpError(
      403,
      "Δεν έχετε δικαίωμα διαχείρισης αυτής της συνεδρίας.",
    );
  return { ref, data };
}
export async function createSession(
  user: DecodedIdToken,
  input: Record<string, unknown>,
) {
  const share = input.kind === "share";
  if (!share && !isTeacher(user))
    throw new HttpError(403, "Απαιτείται ρόλος εκπαιδευτικού ή θεραπευτή.");
  const uid = user.uid;
  const sid = adminDb().collection("liveSessions").doc();
  const board = share
    ? adminDb().doc(`projects/${id(input.projectId)}`)
    : adminDb().collection("projects").doc();
  const profile = (await adminDb().doc(`users/${uid}`).get()).data();
  const title = string(input.title ?? input.projectTitle, "title");
  const workspaceType = workspace(input.workspaceType);
  await adminDb().runTransaction(async (tx) => {
    const classRef = adminDb().doc("_activeClass/current");
    const activeClass = !share ? (await tx.get(classRef)).data() : null;
    if (activeClass?.sessionId) {
      const other = (
        await tx.get(adminDb().doc(`liveSessions/${activeClass.sessionId}`))
      ).data();
      if (other && other.status !== "ended")
        throw new HttpError(
          409,
          "Υπάρχει ήδη ανοιχτό μάθημα. Ολοκληρώστε το πριν ξεκινήσετε νέο.",
        );
    }
    const existing = await tx.get(
      adminDb().collection("liveSessions").where("teacherId", "==", uid),
    );
    if (existing.docs.some((d) => d.data().status !== "ended"))
      throw new HttpError(
        409,
        "Λήξτε την προηγούμενη συνεδρία πριν δημιουργήσετε νέα.",
      );
    if (share) {
      const project = await accessProject(uid, board.id, true, tx);
      if (project.ownerId !== uid || project.liveSessionId)
        throw new HttpError(
          403,
          "Μπορείτε να διαμοιραστείτε μόνο δικό σας ανεξάρτητο έργο.",
        );
    }
    const data = {
      teacherId: uid,
      teacherName: profile?.displayName ?? "Εκπαιδευτικός",
      title,
      workspaceType,
      kind: share ? "share" : "class",
      publicJoin: !share,
      status: "active",
      mainBoardId: board.id,
      groupRoomIds: [],
      participantIds: [uid],
      editPermissions: [uid],
      groupRoomsActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!share) tx.set(classRef, { sessionId: sid.id, teacherId: uid });
    tx.create(sid, data);
    if (share) tx.update(board, { liveSessionId: sid.id });
    else
      tx.create(board, {
        ...newProject(
          uid,
          `[LIVE] ${title}`.slice(0, 160),
          workspaceType,
          "session_board",
        ),
        liveSessionId: sid.id,
        mode: "live",
      });
  });
  return { id: sid.id, ...(await sid.get()).data() };
}
export async function createGroup(uid: string, input: Record<string, unknown>) {
  const sid = id(input.sessionId);
  const group = adminDb().collection(`liveSessions/${sid}/groupRooms`).doc();
  const board = adminDb().collection("projects").doc();
  const name = string(input.name, "name", 100);
  await adminDb().runTransaction(async (tx) => {
    const { ref, data: session } = await ownedSession(uid, sid, tx);
    if (session.status !== "active" || session.groupRoomIds.length >= 10)
      throw new HttpError(409, "Δεν μπορεί να δημιουργηθεί άλλη ομάδα τώρα.");
    tx.create(board, {
      ...newProject(
        uid,
        `[GROUP] ${name}`,
        workspace(session.workspaceType),
        "session_board",
      ),
      liveSessionId: sid,
      groupRoomId: group.id,
      mode: "live",
    });
    tx.create(group, {
      sessionId: sid,
      name,
      boardId: board.id,
      participantIds: [],
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, {
      groupRoomIds: FieldValue.arrayUnion(group.id),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: group.id, ...(await group.get()).data() };
}
export async function moveGroup(uid: string, input: Record<string, unknown>) {
  const sid = id(input.sessionId);
  const studentId = input.studentId ? id(input.studentId) : uid;
  const roomId = input.roomId === null ? null : id(input.roomId);
  await adminDb().runTransaction(async (tx) => {
    const session = (await tx.get(adminDb().doc(`liveSessions/${sid}`))).data();
    if (
      !session ||
      session.status !== "active" ||
      !session.participantIds.includes(studentId) ||
      (uid !== session.teacherId &&
        (uid !== studentId || session.groupRoomsActive === false))
    )
      throw new HttpError(403, "Δεν επιτρέπεται η αλλαγή ομάδας.");
    const rooms = await tx.get(
      adminDb().collection(`liveSessions/${sid}/groupRooms`),
    );
    if (roomId && !rooms.docs.some((d) => d.id === roomId))
      throw new HttpError(404, "Η ομάδα δεν βρέθηκε.");
    for (const room of rooms.docs) {
      const participants: string[] = room.data().participantIds ?? [];
      const next = participants.filter((u) => u !== studentId);
      if (room.id === roomId) next.push(studentId);
      if (JSON.stringify(next) !== JSON.stringify(participants))
        tx.update(room.ref, { participantIds: next });
    }
  });
  return { ok: true };
}
export async function splitGroups(uid: string, input: Record<string, unknown>) {
  const sid = id(input.sessionId);
  const roomIds = Array.isArray(input.groupRoomIds)
    ? [...new Set(input.groupRoomIds.map((x) => id(x)))]
    : [];
  const students = Array.isArray(input.studentIds)
    ? [...new Set(input.studentIds.map((x) => id(x)))]
    : [];
  if (!roomIds.length) throw new HttpError(400, "Δημιουργήστε πρώτα ομάδες.");
  await adminDb().runTransaction(async (tx) => {
    const { data: session } = await ownedSession(uid, sid, tx);
    if (
      session.status !== "active" ||
      students.some((u) => !session.participantIds.includes(u) || u === uid)
    )
      throw new HttpError(400, "Μη έγκυρη κατανομή μαθητών.");
    const rooms = await tx.get(
      adminDb().collection(`liveSessions/${sid}/groupRooms`),
    );
    if (roomIds.some((g) => !rooms.docs.some((d) => d.id === g)))
      throw new HttpError(400, "Μη έγκυρη ομάδα.");
    for (const room of rooms.docs)
      tx.update(room.ref, {
        participantIds: roomIds.includes(room.id)
          ? students.filter((_, i) => roomIds[i % roomIds.length] === room.id)
          : [],
      });
  });
  return { ok: true };
}
export async function deleteGroup(uid: string, input: Record<string, unknown>) {
  const sid = id(input.sessionId),
    gid = id(input.roomId);
  const ref = adminDb().doc(`liveSessions/${sid}/groupRooms/${gid}`);
  await adminDb().runTransaction(async (tx) => {
    const { ref: sessionRef, data: session } = await ownedSession(uid, sid, tx);
    const room = (await tx.get(ref)).data();
    if (!room) return;
    if ((room.participantIds ?? []).length || session.status === "ending")
      throw new HttpError(
        409,
        "Η ομάδα δεν μπορεί να διαγραφεί όσο χρησιμοποιείται.",
      );
    tx.update(adminDb().doc(`projects/${room.boardId}`), {
      liveSessionId: null,
      groupRoomId: null,
      projectType: "personal",
      mode: "solo",
      status: "archived",
    });
    tx.update(sessionRef, {
      groupRoomIds: FieldValue.arrayRemove(gid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(ref);
  });
  await adminDb().recursiveDelete(ref);
  return { deleted: true };
}

export async function sendInvitation(
  uid: string,
  input: Record<string, unknown>,
) {
  const collab = input.type === "collab_project";
  const target = id(collab ? input.projectId : input.sessionId);
  const toUserId = id(input.toUserId);
  if (uid === toUserId)
    throw new HttpError(400, "Δεν μπορείτε να προσκαλέσετε τον εαυτό σας.");
  let title: unknown;
  if (collab) {
    const project = await accessProject(uid, target);
    if (project.ownerId !== uid || project.projectType !== "collaborative")
      throw new HttpError(403, "Μόνο ο ιδιοκτήτης προσκαλεί συνεργάτες.");
    title = project.title;
  } else {
    const { data } = await ownedSession(uid, target);
    if (!["active", "paused"].includes(data.status))
      throw new HttpError(409, "Η συνεδρία έχει λήξει.");
    title = data.title;
  }
  if (!(await adminDb().doc(`users/${toUserId}`).get()).exists)
    throw new HttpError(404, "Ο χρήστης δεν βρέθηκε.");
  const sender = (await adminDb().doc(`users/${uid}`).get()).data();
  const type = collab
    ? "collab_project"
    : input.type === "lesson_paused"
      ? "lesson_paused"
      : "lesson_start";
  const invId = createHash("sha256")
    .update(`${type}:${target}:${toUserId}`)
    .digest("hex");
  await adminDb()
    .doc(`invitations/${invId}`)
    .set({
      fromUserId: uid,
      fromUserName: sender?.displayName ?? "Χρήστης",
      toUserId,
      type,
      ...(collab
        ? { projectId: target, sessionId: "" }
        : { sessionId: target }),
      title,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
  return { id: invId };
}
export async function respondInvitation(
  uid: string,
  invitationId: string,
  accept: boolean,
) {
  let target: string | null = null;
  await adminDb().runTransaction(async (tx) => {
    const ref = adminDb().doc(`invitations/${invitationId}`);
    const inv = (await tx.get(ref)).data();
    if (!inv || inv.toUserId !== uid)
      throw new HttpError(403, "Η πρόσκληση δεν ανήκει σε εσάς.");
    if (!["pending", "accepted"].includes(inv.status))
      throw new HttpError(409, "Η πρόσκληση δεν είναι πλέον ενεργή.");
    if (!accept) {
      tx.update(ref, { status: "declined" });
      return;
    }
    const collab = inv.type === "collab_project";
    target = id(collab ? inv.projectId : inv.sessionId);
    const destination = adminDb().doc(
      `${collab ? "projects" : "liveSessions"}/${target}`,
    );
    const data = (await tx.get(destination)).data();
    if (!data || (collab ? data.ownerId : data.teacherId) !== inv.fromUserId)
      throw new HttpError(403, "Η πρόσκληση δεν έχει έγκυρο αποστολέα.");
    if (
      collab
        ? data.projectType !== "collaborative" || data.deleting
        : data.status !== "active"
    )
      throw new HttpError(409, "Ο χώρος δεν είναι ενεργός.");
    tx.update(destination, {
      [collab ? "collabParticipantIds" : "participantIds"]:
        FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, { status: "accepted" });
  });
  return { id: target };
}
export async function joinSession(uid: string, sid: string) {
  await adminDb().runTransaction(async (tx) => {
    const ref = adminDb().doc(`liveSessions/${sid}`);
    const session = (await tx.get(ref)).data();
    if (
      !session ||
      session.status !== "active" ||
      (!session.publicJoin && !session.participantIds.includes(uid))
    )
      throw new HttpError(
        403,
        "Χρειάζεται ενεργό ανοικτό μάθημα ή αποδεκτή πρόσκληση.",
      );
    if (
      session.participantIds.length >= 100 &&
      !session.participantIds.includes(uid)
    )
      throw new HttpError(409, "Το μάθημα έχει συμπληρώσει 100 συμμετέχοντες.");
    tx.update(ref, {
      participantIds: FieldValue.arrayUnion(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { id: sid };
}

export async function endSession(uid: string, sid: string) {
  const { ref, data: initial } = await ownedSession(uid, sid);
  if (initial.status === "ended")
    return { ended: true, distributed: 0, failed: [] };
  await ref.update({
    status: "ending",
    updatedAt: FieldValue.serverTimestamp(),
  });
  const rooms = await ref.collection("groupRooms").get();
  const failures: Array<{
    groupId: string;
    groupName: string;
    studentId: string;
    studentName: string;
  }> = [];
  let distributed = 0;
  const sources = [
    {
      id: "main",
      boardId: initial.mainBoardId as string,
      name: "Κεντρικό μάθημα",
      recipients: [{ uid, name: initial.teacherName as string }],
    },
  ];
  for (const room of rooms.docs) {
    const members = await room.ref.collection("members").get();
    sources.push({
      id: room.id,
      boardId: room.data().boardId,
      name: room.data().name,
      recipients: members.docs
        .filter(
          (m) => m.data().contributed && initial.participantIds.includes(m.id),
        )
        .map((m) => ({
          uid: m.id,
          name: m.data().displayName || "Συμμετέχων",
        })),
    });
  }
  const deadline = Date.now() + 30_000;
  for (const source of sources) {
    for (const recipient of source.recipients) {
      try {
        if (Date.now() > deadline)
          throw new HttpError(409, "Συνεχίστε την ολοκλήρωση.");
        const targetId = `livecopy_${sid}_${source.id}_${recipient.uid}`;
        if (!(await adminDb().doc(`projects/${targetId}`).get()).exists) {
          const { state } = await storedBoard(source.boardId);
          await materializeCopy(
            targetId,
            {
              ...newProject(
                recipient.uid,
                `${initial.title} — ${source.name}`.slice(0, 160),
                workspace(initial.workspaceType),
              ),
              sourceSessionId: sid,
              originLabel: `Ζωντανό μάθημα — ${source.name}`,
            },
            state,
          );
        }
        distributed++;
      } catch {
        failures.push({
          groupId: source.id,
          groupName: source.name,
          studentId: recipient.uid,
          studentName: recipient.name,
        });
      }
    }
  }
  if (failures.length) return { ended: false, distributed, failed: failures };
  const batch = adminDb().batch();
  batch.update(ref, {
    status: "ended",
    endedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    editPermissions: [],
    presentingBoardId: null,
    presentingRoomId: null,
    teacherInRoomId: null,
    groupRoomsActive: false,
  });
  if (initial.kind === "share")
    batch.update(adminDb().doc(`projects/${initial.mainBoardId}`), {
      liveSessionId: null,
    });
  await batch.commit();
  return { ended: true, distributed, failed: [] };
}
