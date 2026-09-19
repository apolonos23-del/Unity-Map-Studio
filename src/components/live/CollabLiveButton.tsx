// CollabLiveButton — shown next to LiveClassButton in the lobby.
// Only appears when the current user is a participant of an active
// (non-finalized) collaborative project AND at least one OTHER person is
// currently present on it (real-time presence) — i.e. "you accidentally
// left, but the collaboration is still going". Clicking rejoins it.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { subscribeMyCollabProjects, type Project } from "@/lib/projects";
import { subscribePresence, type PresenceMap } from "@/lib/presence";
import { Button } from "@/components/ui/button";
import { Users2 } from "lucide-react";

export function CollabLiveButton() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [myCollabs, setMyCollabs] = useState<Project[]>([]);
  const [presence, setPresence] = useState<PresenceMap>({});

  useEffect(() => {
    if (!user) return;
    return subscribeMyCollabProjects(user.uid, setMyCollabs);
  }, [user]);
  useEffect(() => subscribePresence(setPresence), []);

  if (!user) return null;

  const liveOne = myCollabs.find((p) =>
    Object.entries(presence).some(
      ([uid, entry]) =>
        uid !== user.uid &&
        entry.state === "online" &&
        entry.currentCollabProjectId === p.id,
    ),
  );
  if (!liveOne) return null;

  return (
    <Button
      size="lg"
      variant="outline"
      className="gap-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 relative"
      onClick={() =>
        navigate({
          to: "/project/$projectId",
          params: { projectId: liveOne.id },
        })
      }
    >
      <Users2 className="h-4 w-4" />
      Συνεργατικό σχέδιο live
      <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-blue-600/10 px-2 py-0.5 text-[10px] font-bold tracking-wide">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
        LIVE
      </span>
    </Button>
  );
}
