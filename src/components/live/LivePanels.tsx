// LivePanels — all live-session UI pieces.
// TeacherSessionPanel: full control (rooms, students, present, end).
// StudentSessionPanel: navigation + limited collab.
// CollapsibleLivePanel: wrapper with open/close toggle.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { subscribePresence, type PresenceMap } from "@/lib/presence";
import { stopBroadcast } from "@/lib/live-broadcast";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  type LiveSession,
  sendInvitation,
  endLiveSession,
  subscribeGroupRooms,
  createGroupRoom,
  removeFromGroup,
  deleteGroupRoom,
  joinGroupRoom,
  autoSplitIntoGroups,
  MAX_GROUP_ROOMS,
  returnAllToMain,
  reactivateGroupRooms,
  teacherEnterRoom,
  setPresentingBoard,
  endSessionAndSave,
  pauseSession,
  notifySessionPaused,
  sendDesignToUser,
  subscribeReceivedDesigns,
  type GroupRoom,
  type ReceivedDesign,
} from "@/lib/live-sessions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Radio,
  Send,
  Users,
  Plus,
  DoorOpen,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
  Crown,
  GraduationCap,
  Shuffle,
  LogOut,
  PauseCircle,
  UserPlus,
  Save,
  MoreHorizontal,
  UserCheck,
  UserX,
  MonitorPlay,
  MonitorOff,
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  AlertTriangle,
  Pencil,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------- Hooks ----------

export function usePresence(): PresenceMap {
  const [map, setMap] = useState<PresenceMap>({});
  useEffect(() => subscribePresence(setMap), []);
  return map;
}

// ---------- OnlineUsersPanel ----------

export function OnlineUsersPanel({
  forSessionId,
  onInvite,
}: {
  forSessionId?: string;
  onInvite?: (uid: string, displayName: string) => void;
}) {
  const { user, profile } = useAuth();
  const presence = usePresence();
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";

  const others = useMemo(
    () =>
      Object.entries(presence)
        .filter(([uid, p]) => uid !== user?.uid && p.state === "online")
        .sort(([, a], [, b]) =>
          (a.displayName || "").localeCompare(b.displayName || ""),
        ),
    [presence, user?.uid],
  );

  return (
    <Card className="panel-soft p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" /> Συνδεδεμένοι
        </h3>
        <Badge variant="secondary">{others.length}</Badge>
      </div>
      {others.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Κανείς άλλος δεν είναι online.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {others.map(([uid, p]) => (
            <li
              key={uid}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full bg-[color:var(--success)] shrink-0" />
                <span className="text-sm truncate">
                  {p.displayName || uid.slice(0, 6)}
                </span>
              </div>
              {onInvite && forSessionId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs shrink-0"
                  onClick={() =>
                    onInvite(uid, p.displayName || uid.slice(0, 6))
                  }
                >
                  <Send className="h-3 w-3" /> Πρόσκληση
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- CollapsibleLivePanel ----------

export function CollapsibleLivePanel({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="relative flex shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="absolute -left-5 top-1/2 -translate-y-1/2 z-20 flex h-10 w-5 items-center justify-center rounded-l-md border border-border bg-surface shadow-sm hover:bg-muted transition-colors"
        title={open ? "Κλείσιμο πάνελ" : "Άνοιγμα πάνελ"}
      >
        {open ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="w-72 border-l border-border bg-surface overflow-y-auto p-3 flex flex-col gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------- GroupRoomsPanel — teacher-managed teams inside a live session ----------
// These teams live only inside this one session (liveSessions/{id}/groupRooms)
// and are meant for short-lived breakout collaboration, e.g. mirroring Zoom
// breakout rooms. Both teacher and students can see who is in each team;
// students can also join a team on their own without waiting for the teacher.

export function GroupRoomsPanel({
  session,
  isTeacher,
  onOpenGroup,
}: {
  session: LiveSession;
  isTeacher: boolean;
  /** Teacher-only: opens a group's board as a tab so they can check in on
   *  it. Students don't need this — their canvas already shows their own
   *  group's board automatically the moment they join. */
  onOpenGroup?: (roomId: string, boardId: string, name: string) => void;
}) {
  const { user, profile } = useAuth();
  const presence = usePresence();
  const [groups, setGroups] = useState<GroupRoom[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [quickCount, setQuickCount] = useState(2);
  const [quickBusy, setQuickBusy] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [addingUid, setAddingUid] = useState<string | null>(null);

  useEffect(() => subscribeGroupRooms(session.id, setGroups), [session.id]);

  const nameFor = (uid: string) =>
    presence[uid]?.displayName ?? uid.slice(0, 6);
  const studentIds = session.participantIds.filter(
    (id) => id !== session.teacherId,
  );
  const myGroup = groups.find((g) =>
    g.participantIds.includes(user?.uid ?? ""),
  );

  const handleCreate = async () => {
    if (!user || !newName.trim() || groups.length >= MAX_GROUP_ROOMS) return;
    setCreating(true);
    try {
      await createGroupRoom({
        sessionId: session.id,
        teacherId: user.uid,
        name: newName.trim(),
        workspaceType: session.workspaceType,
      });
      setNewName("");
      toast.success("Η ομάδα δημιουργήθηκε");
    } catch {
      toast.error("Αποτυχία δημιουργίας ομάδας");
    } finally {
      setCreating(false);
    }
  };

  const handleAutoSplit = async () => {
    if (groups.length === 0) {
      toast.info("Δημιουργήστε πρώτα τουλάχιστον μία ομάδα.");
      return;
    }
    if (studentIds.length === 0) {
      toast.info("Δεν υπάρχουν μαθητές στη συνεδρία ακόμη.");
      return;
    }
    setSplitting(true);
    try {
      await autoSplitIntoGroups(
        session.id,
        groups.map((g) => g.id),
        studentIds,
      );
      toast.success(`Οι μαθητές μοιράστηκαν σε ${groups.length} ομάδες`);
    } catch {
      toast.error("Αποτυχία αυτόματου διαχωρισμού");
    } finally {
      setSplitting(false);
    }
  };

  // One-click flow: teacher just picks how many EMPTY groups they want (up
  // to MAX_GROUP_ROOMS) and this creates them, auto-named. Splitting
  // students into them is a deliberately separate step (either the
  // "Αυτόματος διαχωρισμός" button below, or manual assignment per group).
  const handleQuickCreate = async () => {
    if (!user) return;
    const room = MAX_GROUP_ROOMS - groups.length;
    if (room <= 0) {
      toast.info(`Έχετε ήδη ${MAX_GROUP_ROOMS} ομάδες — το μέγιστο.`);
      return;
    }
    const toCreate = Math.min(quickCount, room);
    setQuickBusy(true);
    try {
      const existingNumbers = new Set(
        groups
          .map((g) => Number(g.name.match(/^Ομάδα (\d+)$/)?.[1]))
          .filter((n) => !Number.isNaN(n)),
      );
      let next = 1;
      for (let i = 0; i < toCreate; i++) {
        while (existingNumbers.has(next)) next++;
        await createGroupRoom({
          sessionId: session.id,
          teacherId: user.uid,
          name: `Ομάδα ${next}`,
          workspaceType: session.workspaceType,
        });
        existingNumbers.add(next);
      }
      toast.success(
        `Δημιουργήθηκαν ${toCreate} ${toCreate === 1 ? "ομάδα" : "ομάδες"}`,
      );
    } catch {
      toast.error("Αποτυχία δημιουργίας ομάδων");
    } finally {
      setQuickBusy(false);
    }
  };

  const handleJoin = async (group: GroupRoom) => {
    if (!user) return;
    try {
      await joinGroupRoom(session.id, group.id, user.uid);
      // Students: no tab to open — their canvas shows their group's board
      // automatically. Teachers joining (rare, but harmless) can still
      // jump straight to it if a handler was given.
      onOpenGroup?.(group.id, group.boardId, `👥 ${group.name}`);
    } catch {
      toast.error("Αποτυχία εισόδου στην ομάδα");
    }
  };

  const handleDelete = async (group: GroupRoom) => {
    if (!confirm(`Διαγραφή της ομάδας «${group.name}»;`)) return;
    try {
      await deleteGroupRoom(session.id, group.id);
    } catch {
      toast.error("Αποτυχία διαγραφής");
    }
  };

  // Teacher-driven manual assignment: online students not already in any
  // group, shown when a group is expanded so the teacher can add them
  // one by one. Once added, they disappear from every group's list here.
  const groupedStudentIds = new Set(groups.flatMap((g) => g.participantIds));
  const unassignedOnlineStudentIds = studentIds.filter(
    (uid) => presence[uid]?.state === "online" && !groupedStudentIds.has(uid),
  );

  const handleManualAdd = async (group: GroupRoom, uid: string) => {
    setAddingUid(uid);
    try {
      await joinGroupRoom(session.id, group.id, uid);
    } catch {
      toast.error("Αποτυχία προσθήκης");
    } finally {
      setAddingUid(null);
    }
  };

  return (
    <Card className="panel-soft p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ομάδες Συνεργασίας ({groups.length}/{MAX_GROUP_ROOMS})
        </h3>
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {isTeacher && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-2 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground">
            Δημιουργία πολλών ομάδων μαζί
          </p>
          <div className="flex items-center gap-1.5">
            <select
              value={quickCount}
              onChange={(e) => setQuickCount(Number(e.target.value))}
              className="h-7 text-xs flex-1 rounded-md border border-input bg-background px-2"
            >
              {Array.from({ length: MAX_GROUP_ROOMS }, (_, i) => i + 1).map(
                (n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "ομάδα" : "ομάδες"}
                  </option>
                ),
              )}
            </select>
            <Button
              size="sm"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={handleQuickCreate}
              disabled={quickBusy || groups.length >= MAX_GROUP_ROOMS}
            >
              <Plus className="h-3.5 w-3.5" />
              {quickBusy ? "…" : "Δημιουργία"}
            </Button>
          </div>
        </div>
      )}

      {isTeacher && (
        <div className="flex gap-1.5">
          <Input
            placeholder="π.χ. Ομάδα Α"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="h-7 text-xs flex-1"
            disabled={groups.length >= MAX_GROUP_ROOMS}
          />
          <Button
            size="sm"
            className="h-7 text-xs gap-1 shrink-0"
            onClick={handleCreate}
            disabled={
              creating || !newName.trim() || groups.length >= MAX_GROUP_ROOMS
            }
          >
            <Plus className="h-3.5 w-3.5" /> Νέα
          </Button>
        </div>
      )}

      {isTeacher && groups.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1.5"
          onClick={handleAutoSplit}
          disabled={splitting}
        >
          <Shuffle className="h-3.5 w-3.5" />
          {splitting ? "Διαχωρισμός…" : "Αυτόματος διαχωρισμός μαθητών"}
        </Button>
      )}

      {!isTeacher && (
        <p className="text-[10px] text-muted-foreground">
          Διαλέξτε μια ομάδα και μπείτε — δεν χρειάζεται να σας βάλει ο
          καθηγητής.
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-1">
          Δεν υπάρχουν ομάδες ακόμη.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {groups.map((group) => {
            const iAmIn = group.participantIds.includes(user?.uid ?? "");
            return (
              <li
                key={group.id}
                className={cn(
                  "rounded-lg border p-2 text-xs",
                  iAmIn ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{group.name}</span>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {group.participantIds.length}
                    </Badge>
                    {isTeacher && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 shrink-0"
                        title="Χειροκίνητη προσθήκη μαθητών"
                        onClick={() =>
                          setExpandedGroupId((cur) =>
                            cur === group.id ? null : group.id,
                          )
                        }
                      >
                        {expandedGroupId === group.id ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                    {isTeacher ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() =>
                          onOpenGroup?.(
                            group.id,
                            group.boardId,
                            `👥 ${group.name}`,
                          )
                        }
                      >
                        Άνοιγμα
                      </Button>
                    ) : iAmIn ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-destructive"
                        onClick={() =>
                          removeFromGroup(
                            session.id,
                            group.id,
                            user!.uid,
                          ).catch(() => {})
                        }
                      >
                        Έξοδος
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={() => handleJoin(group)}
                      >
                        Είσοδος
                      </Button>
                    )}
                    {isTeacher && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 w-5 p-0 text-destructive"
                        onClick={() => handleDelete(group)}
                        title="Διαγραφή ομάδας"
                      >
                        <LogOut className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                {group.participantIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {group.participantIds.map((uid) => (
                      <span
                        key={uid}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-muted text-muted-foreground"
                      >
                        {nameFor(uid)}
                        {isTeacher && (
                          <button
                            className="hover:text-destructive"
                            onClick={() =>
                              removeFromGroup(session.id, group.id, uid).catch(
                                () => {},
                              )
                            }
                            title="Αφαίρεση από την ομάδα"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {isTeacher && expandedGroupId === group.id && (
                  <div className="mt-1.5 pt-1.5 border-t border-border/60 space-y-1">
                    <p className="text-[10px] text-muted-foreground">
                      Online μαθητές χωρίς ομάδα:
                    </p>
                    {unassignedOnlineStudentIds.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground italic">
                        Κανείς διαθέσιμος αυτή τη στιγμή.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {unassignedOnlineStudentIds.map((uid) => (
                          <li key={uid} className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)] shrink-0" />
                            <span className="text-xs flex-1 truncate">
                              {nameFor(uid)}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-5 px-1.5 text-[10px] gap-1"
                              disabled={addingUid === uid}
                              onClick={() => handleManualAdd(group, uid)}
                            >
                              <Plus className="h-3 w-3" /> Προσθήκη
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!isTeacher && myGroup && (
        <p className="text-[10px] text-primary font-medium">
          Βρίσκεστε στην ομάδα «{myGroup.name}»
        </p>
      )}
    </Card>
  );
}

// ---------- TeacherSessionPanel ----------

export function TeacherSessionPanel({
  session,
  onOpenRoom,
  beforeTransition,
}: {
  session: LiveSession;
  onOpenRoom?: (roomId: string, boardId: string, name: string) => void;
  beforeTransition?: () => Promise<void>;
}) {
  const { user, profile } = useAuth();
  const presence = usePresence();
  const [busy, setBusy] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [endChoiceOpen, setEndChoiceOpen] = useState(false);

  if (!user || user.uid !== session.teacherId) return null;

  const studentIds = session.participantIds.filter(
    (id) => id !== session.teacherId,
  );

  const invite = async (uid: string, displayName: string) => {
    if (!profile) return;
    try {
      await sendInvitation({
        sessionId: session.id,
        fromUserId: user.uid,
        fromUserName: profile.displayName,
        toUserId: uid,
      });
      toast.success(`Πρόσκληση στάλθηκε σε ${displayName}`);
    } catch {
      toast.error("Αποτυχία πρόσκλησης");
    }
  };

  const inviteAll = async () => {
    if (!profile) return;
    const online = Object.entries(presence).filter(
      ([uid, p]) =>
        uid !== user.uid &&
        p.state === "online" &&
        !session.participantIds.includes(uid),
    );
    if (online.length === 0) {
      toast.info("Κανένας online για πρόσκληση.");
      return;
    }
    setBusy(true);
    try {
      await Promise.all(
        online.map(([uid]) =>
          sendInvitation({
            sessionId: session.id,
            fromUserId: user.uid,
            fromUserName: profile.displayName,
            toUserId: uid,
          }),
        ),
      );
      toast.success(`Προσκλήσεις σε ${online.length} χρήστες`);
    } catch {
      toast.error("Αποτυχία μαζικής πρόσκλησης");
    } finally {
      setBusy(false);
    }
  };

  const bringAllBack = async () => {
    await returnAllToMain(session.id);
    toast.success("Όλοι επέστρεψαν στο Ζωντανό Μάθημα");
  };

  const handlePause = async () => {
    setPausing(true);
    try {
      await beforeTransition?.();
      await pauseSession(session.id);
      stopBroadcast();
      await notifySessionPaused(session, session.teacherName).catch(() => {});
      toast.success(
        "Το μάθημα μπήκε σε παύση — μπορείτε να συνεχίσετε αργότερα από το ίδιο κουμπί.",
      );
      setEndChoiceOpen(false);
    } catch {
      toast.error("Αποτυχία παύσης");
    } finally {
      setPausing(false);
    }
  };

  const handleEndSession = async () => {
    setEndingSession(true);
    try {
      await beforeTransition?.();
      const { ended, distributed, failed } = await endSessionAndSave(
        session.id,
        user.uid,
        profile?.displayName ?? "Καθηγητής",
      );
      if (!ended) {
        toast.error(
          `Αποτυχία αποθήκευσης για ${failed.length} μαθητή/ές. Το μάθημα ΔΕΝ έκλεισε — πατήστε ξανά "Οριστική Λήξη" για επανάληψη.`,
          {
            description: failed
              .map((f) => `${f.groupName} → ${f.studentName}`)
              .join(", "),
            duration: 10000,
          },
        );
        return;
      }
      toast.success(
        distributed > 0
          ? `Το μάθημα έληξε οριστικά. ${distributed} σχέδια μοιράστηκαν στους μαθητές.`
          : "Το μάθημα έληξε οριστικά.",
      );
      stopBroadcast();
      setEndChoiceOpen(false);
    } catch (e) {
      toast.error("Αποτυχία αποθήκευσης. Το μάθημα ΔΕΝ έκλεισε.");
    } finally {
      setEndingSession(false);
    }
  };

  const sendDesign = async (uid: string, displayName: string) => {
    if (!profile) return;
    try {
      await sendDesignToUser({
        fromUserId: user.uid,
        fromUserName: profile.displayName,
        toUserId: uid,
        sourceProjectId: session.mainBoardId,
        sourceTitle: session.title,
      });
      toast.success(`Στάλθηκε στον/στην ${displayName}`);
    } catch {
      toast.error("Αποτυχία αποστολής");
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Crown className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Πάνελ Καθηγητή</span>
        {session.presentingBoardId && (
          <>
            <Badge
              variant="default"
              className="text-[10px] h-4 px-1 ml-auto animate-pulse"
            >
              ΜΕΤΑΦΟΡΑ
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] text-destructive"
              title="Επιστροφή στο ζωντανό μάθημα — έκτακτο κουμπί, δουλεύει ακόμα κι αν η ομάδα διαγράφηκε"
              onClick={() =>
                setPresentingBoard(session.id, null).catch(() => {})
              }
            >
              Διακοπή
            </Button>
          </>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={inviteAll}
          disabled={busy}
        >
          <UserPlus className="h-3.5 w-3.5" /> Πρόσκληση Όλων
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={bringAllBack}
          disabled={busy}
        >
          <ArrowLeftToLine className="h-3.5 w-3.5" /> Φέρε Όλους Πίσω
        </Button>
      </div>

      {/* Students */}
      <Card className="panel-soft p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Μαθητές ({studentIds.length})
        </h3>
        {studentIds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Κανένας μαθητής δεν έχει μπει ακόμη.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {studentIds.map((uid) => {
              const name = presence[uid]?.displayName ?? uid.slice(0, 6);
              const online = presence[uid]?.state === "online";
              const hasEdit = (session.editPermissions ?? []).includes(uid);
              return (
                <li key={uid} className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${online ? "bg-[color:var(--success)]" : "bg-muted-foreground/40"}`}
                  />
                  <span className="text-sm flex-1 truncate">{name}</span>
                  {/* Edit permission badge */}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${hasEdit ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {hasEdit ? "✏️ Επεξ." : "👁 Θέαση"}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {hasEdit ? (
                        <DropdownMenuItem
                          onClick={async () => {
                            const { setEditPermission } =
                              await import("@/lib/live-sessions");
                            await setEditPermission(session.id, uid, false);
                            toast.success(
                              `Αφαιρέθηκε η άδεια επεξεργασίας από ${name}`,
                            );
                          }}
                        >
                          <UserX className="h-4 w-4 mr-2" /> Αφαίρεσε άδεια
                          επεξεργασίας
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={async () => {
                            const { setEditPermission } =
                              await import("@/lib/live-sessions");
                            await setEditPermission(session.id, uid, true);
                            toast.success(
                              `Δόθηκε άδεια επεξεργασίας σε ${name}`,
                            );
                          }}
                        >
                          <UserCheck className="h-4 w-4 mr-2" /> Δώσε άδεια
                          επεξεργασίας
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => invite(uid, name)}>
                        <Send className="h-4 w-4 mr-2" /> Αποστολή Πρόσκλησης
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => sendDesign(uid, name)}>
                        <Send className="h-4 w-4 mr-2" /> Στείλε το Σχέδιο
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* End session */}
      {session.status === "active" && (
        <Dialog open={endChoiceOpen} onOpenChange={setEndChoiceOpen}>
          <Button
            variant="destructive"
            className="w-full gap-2"
            onClick={() => setEndChoiceOpen(true)}
          >
            <LogOut className="h-4 w-4" />
            Λήξη Ζωντανού Μαθήματος
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Τι θέλετε να κάνετε;</DialogTitle>
              <DialogDescription>
                Μπορείτε να βάλετε το μάθημα σε παύση (θα το ξαναβρείτε ακριβώς
                όπως το αφήσατε, ίδιες ομάδες, ίδιος πίνακας), ή να το λήξετε
                οριστικά (αποθηκεύονται όλα τα σχέδια και το μάθημα κλείνει για
                πάντα).
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                className="w-full gap-2 justify-start"
                onClick={handlePause}
                disabled={pausing || endingSession}
              >
                {pausing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PauseCircle className="h-4 w-4" />
                )}
                {pausing ? "Παύση…" : "Παύση Μαθήματος"}
              </Button>
              <Button
                variant="destructive"
                className="w-full gap-2 justify-start"
                onClick={handleEndSession}
                disabled={pausing || endingSession}
              >
                {endingSession ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                {endingSession ? "Αποθήκευση και Λήξη…" : "Οριστική Λήξη"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ---------- StudentSessionPanel ----------

export function StudentSessionPanel({
  session,
  currentTabLabel,
}: {
  session: LiveSession;
  currentBoardId?: string;
  onGoToMain?: () => void;
  onGoToRoom?: (roomId: string, boardId: string, name: string) => void;
  currentTabLabel?: string;
}) {
  const { user, profile } = useAuth();
  const presence = usePresence();

  if (!user) return null;

  const allParticipants = [
    session.teacherId,
    ...session.participantIds.filter((id) => id !== session.teacherId),
  ];
  const isBeingPresented =
    !!session.presentingBoardId || !!session.presentingRoomId;
  const hasEdit = (session.editPermissions ?? []).includes(user.uid);

  const sendDesign = async (uid: string, displayName: string) => {
    if (!profile) return;
    try {
      await sendDesignToUser({
        fromUserId: user.uid,
        fromUserName: profile.displayName,
        toUserId: uid,
        sourceProjectId: session.mainBoardId,
        sourceTitle: session.title,
      });
      toast.success(`Στάλθηκε στον/στην ${displayName}`);
    } catch {
      toast.error("Αποτυχία αποστολής");
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <GraduationCap className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold truncate">{session.title}</span>
      </div>

      {/* WHERE AM I — clear location indicator */}
      <Card className="panel-soft p-3 space-y-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Βρίσκεστε τώρα
        </h3>
        <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2">
          <Radio className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm font-medium text-primary truncate">
            {currentTabLabel ?? "Ζωντανό Μάθημα"}
          </span>
        </div>
        {/* Edit permission badge */}
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium ${hasEdit ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}
        >
          {hasEdit ? (
            <>
              <Pencil className="h-3.5 w-3.5" /> Έχετε άδεια επεξεργασίας
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" /> Προβολή μόνο
            </>
          )}
        </div>
        {!hasEdit && (
          <p className="text-[10px] text-muted-foreground">
            Μόνο ο καθηγητής μπορεί να σας δώσει άδεια επεξεργασίας.
          </p>
        )}
      </Card>

      {/* Live-lesson-transferred notification */}
      {isBeingPresented && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
          <MonitorPlay className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs text-primary font-medium">
            Το ζωντανό μάθημα μεταφέρθηκε σε ομάδα
          </span>
        </div>
      )}

      {/* Session participants */}
      <Card className="panel-soft p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Συμμετέχοντες ({allParticipants.length})
        </h3>
        <ul className="space-y-1.5">
          {allParticipants.map((uid) => {
            const name = presence[uid]?.displayName ?? uid.slice(0, 6);
            const online = presence[uid]?.state === "online";
            const isTeacherUid = uid === session.teacherId;
            const isMe = uid === user.uid;
            const theirEdit = (session.editPermissions ?? []).includes(uid);
            return (
              <li key={uid} className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${online ? "bg-[color:var(--success)]" : "bg-muted-foreground/40"}`}
                />
                <span
                  className={`text-sm flex-1 truncate ${isMe ? "font-medium" : ""}`}
                >
                  {name}
                  {isMe && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      (εσείς)
                    </span>
                  )}
                </span>
                {isTeacherUid && (
                  <Crown className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                {!isTeacherUid && theirEdit && (
                  <Pencil className="h-3 w-3 text-primary shrink-0" />
                )}
                {!isMe && !isTeacherUid && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 shrink-0"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => sendDesign(uid, name)}>
                        <Send className="h-4 w-4 mr-2" /> Στείλε Σχέδιο
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

// ---------- CreatorSessionPanel (student who created collab) ----------

export function CreatorSessionPanel({ session }: { session: LiveSession }) {
  const { user, profile } = useAuth();
  const presence = usePresence();
  const [rooms, setRooms] = useState<GroupRoom[]>([]);
  useEffect(() => subscribeGroupRooms(session.id, setRooms), [session.id]);
  if (!user) return null;

  const participantIds = session.participantIds.filter((id) => id !== user.uid);

  const invite = async (uid: string, displayName: string) => {
    if (!profile) return;
    try {
      await sendInvitation({
        sessionId: session.id,
        fromUserId: user.uid,
        fromUserName: profile.displayName,
        toUserId: uid,
      });
      toast.success(`Πρόσκληση στάλθηκε σε ${displayName}`);
    } catch {
      toast.error("Αποτυχία πρόσκλησης");
    }
  };

  const endIt = async () => {
    if (!confirm("Να ολοκληρωθεί η συνεργασία;")) return;
    try {
      await endLiveSession(session.id, user.uid);
      toast.success("Η συνεργασία ολοκληρώθηκε");
    } catch {
      toast.error("Αποτυχία ολοκλήρωσης");
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 pb-1 border-b border-border">
        <Users className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Συνεργασία</span>
      </div>
      <OnlineUsersPanel forSessionId={session.id} onInvite={invite} />
      <Card className="panel-soft p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Συμμετέχοντες ({participantIds.length})
        </h3>
        {participantIds.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Κανένας δεν έχει μπει ακόμη.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {participantIds.map((uid) => {
              const name = presence[uid]?.displayName ?? uid.slice(0, 6);
              const online = presence[uid]?.state === "online";
              return (
                <li key={uid} className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full shrink-0 ${online ? "bg-[color:var(--success)]" : "bg-muted-foreground/40"}`}
                  />
                  <span className="text-sm truncate">{name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {session.status === "active" && (
        <Button variant="destructive" className="w-full gap-2" onClick={endIt}>
          <LogOut className="h-4 w-4" /> Λήξη Συνεργασίας
        </Button>
      )}
    </>
  );
}
