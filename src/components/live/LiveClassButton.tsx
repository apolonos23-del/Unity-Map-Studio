// LiveClassButton — the single entry point for the live classroom.
//
// LIVE detection is now driven entirely by live-broadcast.ts's single
// RTDB signal (see that file for why): the button is never ambiguous
// about "is a class live right now" because there's exactly one thing to
// check, and it's cleared automatically (onDisconnect) if the teacher's
// browser just disappears.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeLiveBroadcast,
  type LiveBroadcast,
} from "@/lib/live-broadcast";
import {
  createLiveSession,
  joinLiveSessionDirect,
  notifyOnlineUsers,
  subscribeTeacherSession,
  type LiveSession,
} from "@/lib/live-sessions";
import { subscribePresence, type PresenceMap } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Radio, Loader2 } from "lucide-react";
import { toast } from "sonner";

function usePresenceMap(): PresenceMap {
  const [map, setMap] = useState<PresenceMap>({});
  useEffect(() => subscribePresence(setMap), []);
  return map;
}

export function useLiveBroadcast(): LiveBroadcast | null {
  const [broadcast, setBroadcast] = useState<LiveBroadcast | null>(null);
  useEffect(() => subscribeLiveBroadcast(setBroadcast), []);
  return broadcast;
}

/** The signed-in teacher's own session (active OR paused). Distinct from
 *  the broadcast: this is about which Firestore session doc to resume,
 *  not about the real-time "is it live" flag. */
function useMyTeacherSession(
  uid: string | undefined,
): LiveSession | null | undefined {
  const [session, setSession] = useState<LiveSession | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!uid) {
      setSession(null);
      return;
    }
    return subscribeTeacherSession(uid, setSession);
  }, [uid]);
  return session;
}

export function LiveClassButton() {
  const { user, profile } = useAuth();
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";
  const broadcast = useLiveBroadcast();

  if (!user || !profile) return null;
  return isTeacher ? (
    <TeacherButton broadcast={broadcast} />
  ) : (
    <StudentButton broadcast={broadcast} />
  );
}

// ── Teacher variant ────────────────────────────────────────────────
function TeacherButton({ broadcast }: { broadcast: LiveBroadcast | null }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const presence = usePresenceMap();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const myActiveSession = useMyTeacherSession(user?.uid);
  const isLive = !!broadcast && broadcast.sessionId === myActiveSession?.id;

  const start = async () => {
    if (!user || !profile || !title.trim()) return;
    setBusy(true);
    try {
      const s = await createLiveSession({
        teacherId: user.uid,
        teacherName: profile.displayName,
        title: title.trim(),
        workspaceType: "free-drawing",
      });
      const onlineUids = Object.entries(presence)
        .filter(([uid, p]) => uid !== user.uid && p.state === "online")
        .map(([uid]) => uid);
      if (onlineUids.length > 0) {
        await notifyOnlineUsers(s, profile.displayName, onlineUids).catch(
          () => {},
        );
      }
      setOpen(false);
      setTitle("");
      navigate({ to: "/live/$sessionId", params: { sessionId: s.id } });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Αποτυχία δημιουργίας μαθήματος";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // A session already exists that this teacher owns — button re-enters it.
  // If it's paused, entering the /live/$sessionId route auto-resumes it.
  if (myActiveSession) {
    return (
      <Button
        size="lg"
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm relative"
        onClick={() =>
          navigate({
            to: "/live/$sessionId",
            params: { sessionId: myActiveSession.id },
          })
        }
      >
        <Radio className="h-4 w-4" />
        Ζωντανό Μάθημα
        {isLive && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        )}
        {myActiveSession.status === "paused" && (
          <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-wide">
            ⏸ Συνέχεια
          </span>
        )}
      </Button>
    );
  }

  // Someone else is broadcasting — don't let a second session start.
  const blockedByOther = !!broadcast;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setTitle("");
      }}
    >
      <Button
        size="lg"
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
        disabled={blockedByOther}
        title={
          blockedByOther ? "Υπάρχει ήδη ενεργό ζωντανό μάθημα." : undefined
        }
        onClick={() => setOpen(true)}
      >
        <Radio className="h-4 w-4" />
        Ζωντανό Μάθημα
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Έναρξη Ζωντανού Μαθήματος</DialogTitle>
          <DialogDescription>
            Μόλις μπείτε μέσα, οι μαθητές θα δουν την ένδειξη LIVE και θα
            ειδοποιηθούν αμέσως.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Τίτλος μαθήματος"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Άκυρο
          </Button>
          <Button onClick={start} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Έναρξη
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Student variant ────────────────────────────────────────────────
function StudentButton({ broadcast }: { broadcast: LiveBroadcast | null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);

  const enabled = !!broadcast;

  const enter = async () => {
    if (!user || !broadcast || !enabled) return;
    setJoining(true);
    try {
      // Idempotent — safe even if already a participant.
      await joinLiveSessionDirect(broadcast.sessionId, user.uid);
      navigate({
        to: "/live/$sessionId",
        params: { sessionId: broadcast.sessionId },
      });
    } catch (e) {
      console.error("Είσοδος στο ζωντανό μάθημα απέτυχε:", e);
      toast.error("Δεν ήταν δυνατή η είσοδος στο μάθημα");
    } finally {
      setJoining(false);
    }
  };

  const helper = broadcast
    ? undefined
    : "Δεν υπάρχει ζωντανό μάθημα αυτή τη στιγμή";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="lg"
        className="gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40 disabled:bg-blue-600"
        disabled={!enabled || joining}
        onClick={enter}
        title={helper}
      >
        {joining ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Radio className="h-4 w-4" />
        )}
        Ζωντανό Μάθημα
        {enabled && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-wide">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        )}
      </Button>
      {helper && (
        <span className="text-[11px] text-muted-foreground">{helper}</span>
      )}
    </div>
  );
}
