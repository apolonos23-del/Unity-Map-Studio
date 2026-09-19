// InvitationListener — mounted once in AppShell.
// Shows toast for each pending invitation exactly ONCE per user per session.
// Uses localStorage to track dismissed invitations so they never re-appear.
//
// IMPORTANT: the invitation doc is deleted only AFTER the user actually
// responds (accept/decline), never at display time. Deleting it early
// used to look harmless, but once the recipient legitimately gained
// delete permission on their own invitations, it created a race: by the
// time someone clicked "Αποδοχή" seconds later, the doc was already gone,
// and re-reading a deleted doc under these security rules throws instead
// of just returning exists:false — surfacing as "Αποτυχία αποδοχής"
// every single time. Cleanup now happens strictly after the response.

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeMyInvitations,
  respondToInvitation,
  deleteInvitation,
} from "@/lib/live-sessions";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";

function getDismissedKey(uid: string) {
  return `ums:dismissed_invitations:${uid}`;
}
function getDismissed(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(getDismissedKey(uid));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}
function addDismissed(uid: string, invId: string) {
  try {
    const set = getDismissed(uid);
    set.add(invId);
    // Keep only last 100 to avoid unbounded growth
    const arr = Array.from(set).slice(-100);
    localStorage.setItem(getDismissedKey(uid), JSON.stringify(arr));
  } catch {
    /**/
  }
}

const STALE_MS = 15 * 60 * 1000; // 15 minutes

export function InvitationListener() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    // Load already-dismissed from localStorage on mount
    const dismissed = getDismissed(user.uid);
    dismissed.forEach((id) => shownRef.current.add(id));

    const unsub = subscribeMyInvitations(user.uid, (invites) => {
      for (const inv of invites) {
        // Never show same invitation twice (in-memory + localStorage)
        if (shownRef.current.has(inv.id)) continue;
        shownRef.current.add(inv.id);
        addDismissed(user.uid, inv.id); // persist immediately

        // Stale (e.g. a session that started/paused/invited long ago and
        // was never acted on) — clean it up quietly instead of dumping a
        // wall of irrelevant toasts on the next login.
        const createdMs =
          (
            inv.createdAt as { toMillis?: () => number } | undefined
          )?.toMillis?.() ?? 0;
        if (createdMs > 0 && Date.now() - createdMs > STALE_MS) {
          deleteInvitation(inv.id).catch(() => {});
          continue;
        }

        const type = (inv as { type?: string }).type;
        const lessonTitle =
          (inv as { title?: string }).title ?? inv.fromUserName;
        const isLessonStart = type === "lesson_start";
        const isLessonPaused = type === "lesson_paused";
        const isCollabProject = type === "collab_project";

        if (isLessonPaused) {
          // Informational only, no response needed — safe to clean up now.
          deleteInvitation(inv.id).catch(() => {});
          toast(`⏸ Το μάθημα "${lessonTitle}" διακόπηκε`, { duration: 8_000 });
          continue;
        }

        if (isLessonStart) {
          toast(`🔴 Το μάθημα "${lessonTitle}" ξεκίνησε`, {
            duration: 60_000,
            action: {
              label: "Είσοδος",
              onClick: async () => {
                try {
                  const sid = await respondToInvitation(inv.id, true, user.uid);
                  deleteInvitation(inv.id).catch(() => {});
                  if (sid)
                    navigate({
                      to: "/live/$sessionId",
                      params: { sessionId: sid },
                    });
                  else navigate({ to: "/lobby" });
                } catch {
                  deleteInvitation(inv.id).catch(() => {});
                  navigate({ to: "/lobby" });
                }
              },
            },
          });
          continue;
        }

        if (isCollabProject) {
          toast(`Πρόσκληση για συνεργασία: "${lessonTitle}"`, {
            duration: 60_000,
            action: {
              label: "Αποδοχή",
              onClick: async () => {
                try {
                  const pid = await respondToInvitation(inv.id, true, user.uid);
                  deleteInvitation(inv.id).catch(() => {});
                  if (pid)
                    navigate({
                      to: "/project/$projectId",
                      params: { projectId: pid },
                    });
                } catch (e) {
                  console.error("Accept collab invitation failed:", e);
                  toast.error("Αποτυχία αποδοχής");
                }
              },
            },
            cancel: {
              label: "Άρνηση",
              onClick: async () => {
                await respondToInvitation(inv.id, false, user.uid).catch(
                  () => {},
                );
                deleteInvitation(inv.id).catch(() => {});
              },
            },
          });
          continue;
        }

        // Regular invitation
        toast(`Πρόσκληση από ${inv.fromUserName}`, {
          duration: 60_000,
          action: {
            label: "Αποδοχή",
            onClick: async () => {
              try {
                const sid = await respondToInvitation(inv.id, true, user.uid);
                deleteInvitation(inv.id).catch(() => {});
                if (sid)
                  navigate({
                    to: "/live/$sessionId",
                    params: { sessionId: sid },
                  });
              } catch (e) {
                console.error("Accept invitation failed:", e);
                toast.error("Αποτυχία αποδοχής");
              }
            },
          },
          cancel: {
            label: "Άρνηση",
            onClick: async () => {
              await respondToInvitation(inv.id, false, user.uid).catch(
                () => {},
              );
              deleteInvitation(inv.id).catch(() => {});
            },
          },
        });
      }
    });
    return unsub;
  }, [user, navigate]);

  return null;
}
