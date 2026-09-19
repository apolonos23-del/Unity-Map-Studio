// LiveBroadcastListener — mounted once in AppShell.
// Shows a toast to every STUDENT the instant a class goes live, driven by
// the single unambiguous signal in live-broadcast.ts. Unlike the older
// invitation-based "lesson_start" notification (still sent for a
// belt-and-suspenders in-app record, see live-sessions.ts), this doesn't
// depend on the student having been online at the exact moment the
// teacher clicked Start — it fires for anyone who becomes online (or is
// already online) while the broadcast is active, exactly once per
// broadcast instance.
import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useNavigate } from "@tanstack/react-router";
import { subscribeLiveBroadcast } from "@/lib/live-broadcast";
import { joinLiveSessionDirect } from "@/lib/live-sessions";
import { toast } from "sonner";

export function LiveBroadcastListener() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";
  // Tracks which broadcast (by sessionId+startedAt) we've already
  // notified about, so a re-render or reconnect never double-toasts.
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user || isTeacher) return; // teachers don't need to be told they're live
    return subscribeLiveBroadcast((broadcast) => {
      if (!broadcast) return;
      const key = `${broadcast.sessionId}:${broadcast.startedAt}`;
      if (notifiedRef.current === key) return;
      notifiedRef.current = key;

      toast(
        `🔴 Ο/Η ${broadcast.teacherName} ξεκίνησε ζωντανό μάθημα «${broadcast.title}»`,
        {
          duration: 60_000,
          action: {
            label: "Είσοδος",
            onClick: async () => {
              try {
                await joinLiveSessionDirect(broadcast.sessionId, user.uid);
              } catch {
                /* best-effort — still try to navigate */
              }
              navigate({
                to: "/live/$sessionId",
                params: { sessionId: broadcast.sessionId },
              });
            },
          },
        },
      );
    });
  }, [user, isTeacher, navigate]);

  return null;
}
