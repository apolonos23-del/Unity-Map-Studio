import { timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminRtdb } from "../server/admin";
import {
  authenticate,
  body,
  id,
  privateResponse,
  rateLimit,
  sendError,
  string,
  HttpError,
  type ApiRequest,
  type ApiResponse,
} from "../server/http";
import {
  createProject,
  copyProject,
  deleteProject,
  sendDesign,
  acceptDesign,
} from "../server/project-service";
import {
  createSession,
  createGroup,
  moveGroup,
  splitGroups,
  deleteGroup,
  sendInvitation,
  respondInvitation,
  joinSession,
  endSession,
  isTeacher,
} from "../server/session-service";
import { aiSettings, aiComplete } from "../server/ai-service";
import { retirePayload } from "../server/boards";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  privateResponse(res);
  try {
    if (req.method !== "POST")
      throw new HttpError(405, "Η μέθοδος δεν υποστηρίζεται.");
    const user = await authenticate(req);
    const input = body(req),
      action = string(input.action, "action");
    await rateLimit(
      user.uid,
      action,
      action === "claim-role" ? 5 : action === "ai-complete" ? 10 : 90,
    );
    let result: unknown;
    switch (action) {
      case "create-project":
        result = await createProject(user.uid, input);
        break;
      case "copy-project":
        result = await copyProject(user.uid, input);
        break;
      case "delete-project":
        result = await deleteProject(user.uid, id(input.projectId));
        break;
      case "send-design":
        result = await sendDesign(user.uid, input);
        break;
      case "accept-design":
        result = await acceptDesign(user.uid, id(input.designId));
        break;
      case "create-session":
        result = await createSession(user, input);
        break;
      case "create-group":
        result = await createGroup(user.uid, input);
        break;
      case "move-group":
        result = await moveGroup(user.uid, input);
        break;
      case "split-groups":
        result = await splitGroups(user.uid, input);
        break;
      case "delete-group":
        result = await deleteGroup(user.uid, input);
        break;
      case "send-invitation":
        result = await sendInvitation(user.uid, input);
        break;
      case "respond-invitation":
        result = await respondInvitation(
          user.uid,
          id(input.invitationId),
          input.accept === true,
        );
        break;
      case "join-session":
        result = await joinSession(user.uid, id(input.sessionId));
        break;
      case "end-session":
        result = await endSession(user.uid, id(input.sessionId));
        break;
      case "ai-settings":
      case "save-ai-settings":
      case "ai-complete": {
        if (!isTeacher(user))
          throw new HttpError(
            403,
            "Η λειτουργία AI είναι διαθέσιμη σε εκπαιδευτικούς και θεραπευτές.",
          );
        result =
          action === "ai-complete"
            ? await aiComplete(user.uid, input)
            : await aiSettings(
                user.uid,
                action === "save-ai-settings" ? input : undefined,
              );
        break;
      }
      case "claim-role": {
        if (!["teacher", "therapist"].includes(String(input.role)))
          throw new HttpError(400, "Μη έγκυρος ρόλος.");
        const expected =
          input.role === "therapist"
            ? process.env.THERAPIST_SIGNUP_CODE
            : process.env.TEACHER_SIGNUP_CODE;
        const supplied = string(input.accessCode, "accessCode", 256);
        if (!expected || expected.length < 16)
          throw new HttpError(
            503,
            "Ο διαχειριστής πρέπει να ρυθμίσει τον κωδικό εγγραφής αυτού του ρόλου.",
          );
        if (
          Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
          !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
        )
          throw new HttpError(403, "Ο κωδικός ρόλου δεν είναι έγκυρος.");
        const account = await adminAuth().getUser(user.uid);
        await adminAuth().setCustomUserClaims(user.uid, {
          ...account.customClaims,
          role: input.role,
        });
        await adminDb()
          .doc(`users/${user.uid}`)
          .set({ role: input.role }, { merge: true });
        result = { role: input.role };
        break;
      }
      case "find-user": {
        const email = string(input.email, "email", 254).toLowerCase();
        const account = await adminAuth()
          .getUserByEmail(email)
          .catch(() => null);
        result = account
          ? {
              user: {
                uid: account.uid,
                displayName: account.displayName || email.split("@")[0],
              },
            }
          : { user: null };
        break;
      }
      case "delete-account": {
        if (Date.now() / 1000 - user.auth_time > 300)
          throw new HttpError(401, "Επιβεβαιώστε ξανά τον κωδικό σας.");
        const sessions = await adminDb()
          .collection("liveSessions")
          .where("teacherId", "==", user.uid)
          .get();
        if (sessions.docs.some((d) => d.data().status !== "ended"))
          throw new HttpError(409, "Λήξτε πρώτα τις ζωντανές συνεδρίες σας.");
        const projects = await adminDb()
          .collection("projects")
          .where("ownerId", "==", user.uid)
          .get();
        for (const project of projects.docs)
          await deleteProject(user.uid, project.id);
        for (const session of sessions.docs)
          await adminDb().recursiveDelete(session.ref);
        const folders = await adminDb()
          .collection("folders")
          .where("ownerId", "==", user.uid)
          .get();
        for (const folder of folders.docs) await folder.ref.delete();
        for (const collection of ["invitations", "receivedDesigns"]) {
          for (const field of ["fromUserId", "toUserId"]) {
            const docs = await adminDb()
              .collection(collection)
              .where(field, "==", user.uid)
              .get();
            for (const doc of docs.docs) {
              if (doc.data().payloadRef)
                await retirePayload(doc.data().payloadRef);
              await doc.ref.delete();
            }
          }
        }
        const collaborations = await adminDb()
          .collection("projects")
          .where("collabParticipantIds", "array-contains", user.uid)
          .get();
        for (const project of collaborations.docs)
          await project.ref.update({
            collabParticipantIds: FieldValue.arrayRemove(user.uid),
          });
        await adminRtdb().ref(`presence/${user.uid}`).remove();
        await adminDb().recursiveDelete(adminDb().doc(`users/${user.uid}`));
        await adminAuth().deleteUser(user.uid);
        result = { deleted: true };
        break;
      }
      default:
        throw new HttpError(400, "Άγνωστη ενέργεια.");
    }
    res.status(200).json(result);
  } catch (error) {
    sendError(res, error);
  }
}
