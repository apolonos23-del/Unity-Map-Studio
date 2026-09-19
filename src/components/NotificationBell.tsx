// Notification bell — aggregates "someone sent you a design" and
// "you have a pending invitation" into one place, with a red unread-count
// badge. Opening the bell marks everything currently shown as seen
// (clears the badge); it does NOT resolve/delete the underlying items —
// those still need their normal accept/decline/save actions.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Mail, UserPlus, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  subscribeReceivedDesigns,
  subscribeMyInvitations,
  respondToInvitation,
  deleteInvitation,
  type ReceivedDesign,
  type Invitation,
} from "@/lib/live-sessions";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { toast } from "sonner";

function lastSeenKey(uid: string) {
  return `ums:notif_last_seen:${uid}`;
}
function getLastSeen(uid: string): number {
  try {
    return Number(localStorage.getItem(lastSeenKey(uid)) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function setLastSeen(uid: string, ms: number) {
  try {
    localStorage.setItem(lastSeenKey(uid), String(ms));
  } catch {
    /* */
  }
}

type NotifItem =
  | { kind: "design"; ts: number; data: ReceivedDesign }
  | { kind: "invitation"; ts: number; data: Invitation };

function toMs(ts: unknown): number {
  return (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<ReceivedDesign[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeenState] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLastSeenState(getLastSeen(user.uid));
    const u1 = subscribeReceivedDesigns(user.uid, setDesigns);
    const u2 = subscribeMyInvitations(user.uid, setInvitations);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  const items: NotifItem[] = useMemo(() => {
    const out: NotifItem[] = [
      ...designs.map((d) => ({
        kind: "design" as const,
        ts: toMs(d.createdAt),
        data: d,
      })),
      ...invitations.map((i) => ({
        kind: "invitation" as const,
        ts: toMs(i.createdAt),
        data: i,
      })),
    ];
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [designs, invitations]);

  const unreadCount = items.filter((it) => it.ts > lastSeen).length;

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          const now = Date.now();
          setLastSeen(user.uid, now);
          setLastSeenState(now);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative h-9 w-9 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          title="Ειδοποιήσεις"
        >
          <Bell className="h-4.5 w-4.5 text-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 max-h-[70vh] overflow-y-auto"
      >
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-sm font-medium">Ειδοποιήσεις</p>
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            Καμία ειδοποίηση προς το παρόν.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => {
              const id = it.data.id;
              const isNew = it.ts > 0 && it.ts > lastSeen - 1;
              if (it.kind === "design") {
                const d = it.data;
                const dt = it.ts > 0 ? new Date(it.ts) : null;
                const dateLabel = dt
                  ? `${dt.toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${dt.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" })}`
                  : null;
                return (
                  <button
                    key={`d_${id}`}
                    onClick={() => {
                      setOpen(false);
                      navigate({ to: "/lobby", search: { tab: "received" } });
                    }}
                    className="w-full text-left px-3 py-2.5 flex items-start gap-2.5 hover:bg-muted transition-colors"
                  >
                    <Mail className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-medium">{d.fromUserName}</span>{" "}
                        σας έστειλε το σχέδιο{" "}
                        <span className="font-medium">"{d.title}"</span>
                      </p>
                      {dateLabel && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {dateLabel}
                        </p>
                      )}
                    </div>
                  </button>
                );
              }
              const inv = it.data;
              const type = (inv as unknown as { type?: string }).type;
              const title =
                (inv as unknown as { title?: string }).title ??
                inv.fromUserName;
              const label =
                type === "lesson_start"
                  ? `Το μάθημα "${title}" ξεκίνησε`
                  : type === "collab_project"
                    ? `Πρόσκληση συνεργασίας: "${title}"`
                    : `Πρόσκληση από ${inv.fromUserName}`;
              return (
                <div
                  key={`i_${id}`}
                  className="px-3 py-2.5 flex items-start gap-2.5"
                >
                  <UserPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">{label}</p>
                    <div className="flex gap-2 mt-1.5">
                      <button
                        disabled={busyId === id}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                        onClick={async () => {
                          setBusyId(id);
                          try {
                            const targetId = await respondToInvitation(
                              id,
                              true,
                              user.uid,
                            );
                            deleteInvitation(id).catch(() => {});
                            setOpen(false);
                            if (type === "lesson_start" && targetId) {
                              navigate({
                                to: "/live/$sessionId",
                                params: { sessionId: targetId },
                              });
                            } else if (type === "collab_project" && targetId) {
                              navigate({
                                to: "/project/$projectId",
                                params: { projectId: targetId },
                              });
                            } else {
                              navigate({ to: "/lobby" });
                            }
                          } catch (e) {
                            console.error("Accept invitation failed:", e);
                            toast.error("Αποτυχία αποδοχής");
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        {busyId === id ? (
                          <Loader2 className="h-3 w-3 animate-spin inline" />
                        ) : (
                          "Αποδοχή"
                        )}
                      </button>
                      <button
                        disabled={busyId === id}
                        className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                        onClick={async () => {
                          setBusyId(id);
                          try {
                            await respondToInvitation(id, false, user.uid);
                            deleteInvitation(id).catch(() => {});
                          } catch {
                            /* */
                          } finally {
                            setBusyId(null);
                          }
                        }}
                      >
                        Απόρριψη
                      </button>
                    </div>
                  </div>
                  {isNew && (
                    <span className="h-2 w-2 rounded-full bg-red-500 mt-1 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
