import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { ClientOnly } from "@/lib/client-only";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  subscribeMyProjects,
  createProject,
  renameProject,
  deleteProject,
  duplicateProject,
  type Project,
} from "@/lib/projects";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  moveProjectToFolder,
  subscribeMyFolders,
  type Folder,
} from "@/lib/folders";
import {
  FolderOpen,
  Folder as FolderIcon,
  Plus,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy as CopyIcon,
  Move,
  FolderPlus,
  Users,
  User,
  Radio,
  Check,
  Mail,
} from "lucide-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  acceptReceivedDesign,
  sendCollabProjectInvitation,
  subscribeReceivedDesigns,
  type ReceivedDesign,
} from "@/lib/live-sessions";
import { startCollabProject, subscribeMyCollabProjects } from "@/lib/projects";
import { usePresence } from "@/components/live/LivePanels";
import { LiveClassButton } from "@/components/live/LiveClassButton";
import { CollabLiveButton } from "@/components/live/CollabLiveButton";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { formatDistanceToNow } from "date-fns";
import { el } from "date-fns/locale";

const searchSchema = z.object({
  tab: z
    .enum(["projects", "collab", "received", "archive"])
    .catch("projects")
    .default("projects"),
});

export const Route = createFileRoute("/lobby")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Lobby — Unity Map Studio" }] }),
  component: () => (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <LobbyGate />
    </ClientOnly>
  ),
});

function LobbyGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <AppShell>
      <Lobby />
    </AppShell>
  );
}

function Lobby() {
  const { tab } = Route.useSearch();
  const { profile, user } = useAuth();
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";

  // Auto-expire old sessions (>24h) on lobby load — teachers only
  useEffect(() => {
    if (!isTeacher || !user) return;
    import("@/lib/live-sessions").then(({ autoExpireOldSessions }) => {
      autoExpireOldSessions(user.uid).then((expired) => {
        if (expired.length > 0) {
          toast.info(
            `${expired.length} μάθημα${expired.length > 1 ? "τα" : ""} έκλεισαν αυτόματα μετά από 24 ώρες: ${expired.join(", ")}`,
          );
        }
      });
    });
  }, [isTeacher, user]);

  const meta = tabMeta(tab);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {meta.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{meta.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          {meta.action}
        </div>
      </div>

      <TabContent tab={tab} />
    </div>
  );
}

function tabMeta(tab: string): {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
} {
  switch (tab) {
    case "projects":
      return {
        title: "Τα Έργα μου",
        subtitle: "Πρόχειρα που δεν έχετε αποθηκεύσει οριστικά ακόμα.",
        action: (
          <div className="flex items-center gap-2">
            <NewProjectButton />
            <LiveClassButton />
            <CollabLiveButton />
          </div>
        ),
      };
    case "collab":
      return {
        title: "Συνεργατικά",
        subtitle: "Έργα που μοιράζεστε με άλλους χρήστες.",
      };
    case "archive":
      return {
        title: "Αρχείο",
        subtitle:
          "Σχέδια που έχετε αποθηκεύσει οριστικά, οργανωμένα σε φακέλους.",
        action: <NewFolderButton />,
      };
    case "received":
      return {
        title: "Σχέδια που έλαβα",
        subtitle: "Σχέδια που σας έχουν στείλει άλλοι χρήστες.",
      };
    default:
      return { title: "Τα Έργα μου", subtitle: "" };
  }
}

function TabContent({ tab }: { tab: string }) {
  switch (tab) {
    case "projects":
      return <MyProjectsGrid />;
    case "collab":
      return <CollabProjectsList />;
    case "archive":
      return <ArchivePanel />;
    case "received":
      return <ReceivedDesignsList />;
    default:
      return <MyProjectsGrid />;
  }
}

// ── Project library w/ folders ──────────────────────────────────────

function MyProjectsGrid() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = subscribeMyProjects(user.uid, (p) =>
      setProjects(p.filter((x) => x.status === "draft" || !x.status)),
    );
    return () => u1();
  }, [user]);

  if (projects === null) {
    return <SkeletonGrid />;
  }

  return (
    <div className="space-y-5">
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" />}
          title="Δεν έχετε πρόχειρα αυτή τη στιγμή"
          description="Ό,τι δημιουργείτε ξεκινά εδώ σαν πρόχειρο. Μόλις πατήσετε «Αποθήκευση» μέσα σε ένα σχέδιο, μετακομίζει στο Αρχείο."
          cta={<NewProjectButton />}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} folders={[]} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchivePanel() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = subscribeMyProjects(user.uid, (p) =>
      setProjects(
        p.filter(
          (x) => x.status && x.status !== "draft" && x.status !== "archived",
        ),
      ),
    );
    const u2 = subscribeMyFolders(user.uid, setFolders);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  if (projects === null) {
    return <SkeletonGrid />;
  }

  const unfiled = projects.filter((p) => !p.folderId);
  const countFor = (fid: string) =>
    projects.filter((p) => p.folderId === fid).length;

  // Drilled into one folder — show its projects with a way back.
  if (openFolderId) {
    const folder = folders.find((f) => f.id === openFolderId);
    const inFolder = projects.filter((p) => p.folderId === openFolderId);
    return (
      <div className="space-y-5">
        <button
          onClick={() => setOpenFolderId(null)}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Πίσω στο Αρχείο
        </button>
        <div className="flex items-center gap-2">
          <FolderIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">{folder?.name ?? "Φάκελος"}</h2>
          {folder && (
            <FolderMenu
              folder={folder}
              onAfterDelete={() => setOpenFolderId(null)}
            />
          )}
        </div>
        {inFolder.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Κενός φάκελος"
            description="Δεν έχετε αποθηκεύσει ακόμα κανένα σχέδιο εδώ."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {inFolder.map((p) => (
              <ProjectCard key={p.id} project={p} folders={folders} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Χωρίς φάκελο
        </h2>
        {unfiled.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Τίποτα εδώ — ό,τι αποθηκεύσετε χωρίς να το βάλετε σε φάκελο θα
            εμφανιστεί σε αυτή τη λίστα.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {unfiled.map((p) => (
              <ProjectCard key={p.id} project={p} folders={folders} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Οι Φάκελοι μου
        </h2>
        {folders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Δεν έχετε φακέλους ακόμα — φτιάξτε έναν με το κουμπί «Νέος φάκελος»
            πάνω δεξιά.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setOpenFolderId(f.id)}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted transition-colors text-left"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{f.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {countFor(f.id)} σχέδι{countFor(f.id) === 1 ? "ο" : "α"}
                  </span>
                  <FolderMenu folder={f} onAfterDelete={() => {}} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FolderChip({
  active,
  onClick,
  icon,
  label,
  count,
  menu,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  menu?: React.ReactNode;
}) {
  return (
    <div
      className={`inline-flex items-center rounded-full border text-xs px-1 transition-colors ${
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-background hover:bg-muted"
      }`}
    >
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-2 py-1.5"
      >
        {icon}
        <span className="truncate max-w-[12rem]">{label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {count}
        </span>
      </button>
      {menu && <div className="pr-1">{menu}</div>}
    </div>
  );
}

function FolderMenu({
  folder,
  onAfterDelete,
}: {
  folder: Folder;
  onAfterDelete: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="h-5 w-5 rounded-full hover:bg-muted flex items-center justify-center"
            aria-label="Ενέργειες φακέλου"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-2" />
            Μετονομασία
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Διαγραφή
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameFolderDialog
        folder={folder}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteFolderDialog
        folder={folder}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onAfterDelete}
      />
    </>
  );
}

function RenameFolderDialog({
  folder,
  open,
  onOpenChange,
}: {
  folder: Folder;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(folder.name);
  }, [open, folder.name]);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await renameFolder(folder.id, name);
      toast.success("Ο φάκελος μετονομάστηκε");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία μετονομασίας");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Μετονομασία φακέλου</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="fname">Νέο όνομα</Label>
          <Input
            id="fname"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Άκυρο
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Αποθήκευση
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFolderDialog({
  folder,
  open,
  onOpenChange,
  onDeleted,
}: {
  folder: Folder;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [cascade, setCascade] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setCascade(false);
  }, [open]);
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await deleteFolder(folder.id, user.uid, { deleteProjects: cascade });
      toast.success("Ο φάκελος διαγράφηκε");
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία διαγραφής");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Διαγραφή φακέλου «{folder.name}»</DialogTitle>
          <DialogDescription>
            Από προεπιλογή, τα έργα μέσα στον φάκελο διατηρούνται και
            μετακινούνται στο «Χωρίς φάκελο». Επιλέξτε παρακάτω για να
            διαγραφούν κι αυτά.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 text-sm py-2">
          <Checkbox
            checked={cascade}
            onCheckedChange={(v) => setCascade(v === true)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-destructive">
              Διαγραφή και των έργων μέσα στον φάκελο
            </span>
            <span className="block text-xs text-muted-foreground">
              Μη αναστρέψιμο. Τα έργα δεν θα μπορούν να ανακτηθούν.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Άκυρο
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Διαγραφή φακέλου
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectCard({
  project,
  folders,
}: {
  project: Project;
  folders: Folder[];
}) {
  const ts = (
    project.updatedAt as { toDate?: () => Date } | undefined
  )?.toDate?.();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);

  return (
    <>
      <Card className="panel-soft p-0 overflow-hidden hover:shadow-[var(--shadow-lift)] transition-shadow group relative">
        <Link
          to="/project/$projectId"
          params={{ projectId: project.id }}
          className="block"
        >
          <div className="aspect-[4/3] canvas-dotgrid border-b border-border flex items-center justify-center">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <div className="p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                {project.title}
              </h3>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>
                {ts
                  ? `Ενημερώθηκε ${formatDistanceToNow(ts, { addSuffix: true, locale: el })}`
                  : "Νέο"}
              </span>
            </div>
            {project.originLabel && (
              <p
                className="mt-1 text-[10px] text-muted-foreground truncate"
                title={project.originLabel}
              >
                📥 {project.originLabel}
                {ts &&
                  ` · ${ts.toLocaleDateString("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" })}`}
              </p>
            )}
          </div>
        </Link>
        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-7 w-7 rounded-md bg-background/90 backdrop-blur border border-border hover:bg-muted flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label="Ενέργειες έργου"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem asChild>
                <Link
                  to="/project/$projectId"
                  params={{ projectId: project.id }}
                >
                  <FolderOpen className="h-3.5 w-3.5 mr-2" />
                  Άνοιγμα
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Μετονομασία
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDupOpen(true)}>
                <CopyIcon className="h-3.5 w-3.5 mr-2" />
                Αποθήκευση ως αντίγραφο
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Move className="h-3.5 w-3.5 mr-2" />
                  Μετακίνηση σε φάκελο
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                    Φάκελοι
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => doMove(project.id, null)}
                    disabled={!project.folderId}
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-2" />
                    Χωρίς φάκελο
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {folders.length === 0 ? (
                    <DropdownMenuItem disabled>
                      Δεν υπάρχουν φάκελοι
                    </DropdownMenuItem>
                  ) : (
                    folders.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        onClick={() => doMove(project.id, f.id)}
                        disabled={project.folderId === f.id}
                      >
                        <FolderIcon className="h-3.5 w-3.5 mr-2" />
                        {f.name}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Διαγραφή
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
      <RenameProjectDialog
        project={project}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
      <DuplicateProjectDialog
        project={project}
        open={dupOpen}
        onOpenChange={setDupOpen}
      />
    </>
  );
}

async function doMove(projectId: string, folderId: string | null) {
  try {
    await moveProjectToFolder(projectId, folderId);
    toast.success(
      folderId ? "Μετακινήθηκε στον φάκελο" : "Αφαιρέθηκε από φάκελο",
    );
  } catch (e) {
    console.error(e);
    toast.error("Αποτυχία μετακίνησης");
  }
}

function RenameProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTitle(project.title);
  }, [open, project.title]);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await renameProject(project.id, title);
      toast.success("Το έργο μετονομάστηκε");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία μετονομασίας");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Μετονομασία έργου</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="ptitle">Νέος τίτλος</Label>
          <Input
            id="ptitle"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Άκυρο
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Αποθήκευση
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await deleteProject(project.id);
      toast.success("Το έργο διαγράφηκε");
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία διαγραφής");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Διαγραφή έργου «{project.title}»</DialogTitle>
          <DialogDescription>
            Μη αναστρέψιμη ενέργεια. Το έργο και η αποθηκευμένη του κατάσταση θα
            διαγραφούν.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Άκυρο
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Διαγραφή
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState(`${project.title} (αντίγραφο)`);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTitle(`${project.title} (αντίγραφο)`);
  }, [open, project.title]);
  const submit = async () => {
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      const newId = await duplicateProject(user.uid, project.id, title.trim());
      toast.success("Δημιουργήθηκε αντίγραφο");
      onOpenChange(false);
      navigate({ to: "/project/$projectId", params: { projectId: newId } });
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία δημιουργίας αντιγράφου");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Αποθήκευση ως αντίγραφο</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="dtitle">Τίτλος αντιγράφου</Label>
          <Input
            id="dtitle"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Άκυρο
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Δημιουργία
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewProjectButton() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const presence = usePresence();

  // Step: "pick-mode" | "solo" | "collab"
  const [step, setStep] = useState<"pick-mode" | "solo" | "collab">(
    "pick-mode",
  );
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  // Collab: selected user uids
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reset = () => {
    setStep("pick-mode");
    setTitle("");
    setSelected(new Set());
    setLoading(false);
  };

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) reset();
  };

  // Online users excluding self
  const onlineOthers = Object.entries(presence).filter(
    ([uid, p]) => uid !== user?.uid && p.state === "online",
  );

  const toggleUser = (uid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // Create solo project
  const submitSolo = async () => {
    if (!user || !title.trim()) return;
    setLoading(true);
    try {
      const id = await createProject(user.uid, title.trim());
      toast.success("Το έργο δημιουργήθηκε");
      onOpenChange(false);
      navigate({ to: "/project/$projectId", params: { projectId: id } });
    } catch (e) {
      console.error(e);
      toast.error("Δεν ήταν δυνατή η δημιουργία");
    } finally {
      setLoading(false);
    }
  };

  // Create a lightweight collaborative project and invite selected users.
  // Deliberately does NOT use createLiveSession — that's reserved for
  // teacher-run classroom lessons and enforces "one active session per
  // teacher", which is wrong here: any number of different people should
  // be able to run their own simultaneous ad-hoc collaborations.
  const submitCollab = async () => {
    if (!user || !profile) return;
    const finalTitle = title.trim() || `Συνεργασία — ${profile.displayName}`;
    setLoading(true);
    try {
      const projectId = await createProject(
        user.uid,
        finalTitle,
        "collaborative",
        "free-drawing",
      );
      await startCollabProject(projectId, user.uid);
      await Promise.all(
        Array.from(selected).map((uid) =>
          sendCollabProjectInvitation({
            projectId,
            projectTitle: finalTitle,
            fromUserId: user.uid,
            fromUserName: profile.displayName,
            toUserId: uid,
          }),
        ),
      );
      if (selected.size > 0) {
        toast.success(`Προσκλήσεις στάλθηκαν σε ${selected.size} άτομα`);
      }
      onOpenChange(false);
      navigate({ to: "/project/$projectId", params: { projectId } });
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : "Δεν ήταν δυνατή η δημιουργία";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-1.5" />
          Νέο σχέδιο
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        {/* Step 1: pick mode */}
        {step === "pick-mode" && (
          <>
            <DialogHeader>
              <DialogTitle>Νέο σχέδιο</DialogTitle>
              <DialogDescription>Επιλέξτε τον τύπο σχεδίου</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-4">
              <button
                onClick={() => setStep("solo")}
                className="flex flex-col items-center gap-3 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 p-6 transition-all text-center"
              >
                <User className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold text-sm">Ατομικό σχέδιο</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Μόνο εσείς
                  </p>
                </div>
              </button>
              <button
                onClick={() => setStep("collab")}
                className="flex flex-col items-center gap-3 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 p-6 transition-all text-center"
              >
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-semibold text-sm">Συνεργατικό</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Με άλλους online
                  </p>
                </div>
              </button>
            </div>
          </>
        )}

        {/* Step 2a: solo */}
        {step === "solo" && (
          <>
            <DialogHeader>
              <DialogTitle>Ατομικό σχέδιο</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label htmlFor="solo-title">Τίτλος</Label>
              <Input
                id="solo-title"
                value={title}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                placeholder="π.χ. Κύκλος του νερού"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSolo();
                }}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("pick-mode")}>
                Πίσω
              </Button>
              <Button onClick={submitSolo} disabled={loading || !title.trim()}>
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Δημιουργία
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2b: collab */}
        {step === "collab" && (
          <>
            <DialogHeader>
              <DialogTitle>Συνεργατικό σχέδιο</DialogTitle>
              <DialogDescription>
                Θα δημιουργηθεί ζωντανή συνεδρία και θα σταλούν προσκλήσεις.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="collab-title">Τίτλος</Label>
                <Input
                  id="collab-title"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="π.χ. Ομαδική εργασία (προαιρετικό)"
                />
              </div>

              {/* Online users list */}
              <div>
                <Label className="mb-2 block">
                  Online χρήστες ({onlineOthers.length})
                </Label>
                {onlineOthers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Κανένας άλλος δεν είναι online αυτή τη στιγμή.
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-border p-1">
                    {onlineOthers.map(([uid, p]) => {
                      const isSelected = selected.has(uid);
                      return (
                        <li key={uid}>
                          <button
                            onClick={() => toggleUser(uid)}
                            className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                          >
                            <span className="h-2 w-2 rounded-full bg-[color:var(--success)] shrink-0" />
                            <span className="flex-1 text-sm truncate">
                              {p.displayName || uid.slice(0, 8)}
                            </span>
                            {isSelected && (
                              <Check className="h-4 w-4 shrink-0" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {selected.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  Θα σταλεί πρόσκληση σε {selected.size} άτομο
                  {selected.size !== 1 ? "α" : ""}.
                </p>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep("pick-mode")}>
                Πίσω
              </Button>
              <Button
                onClick={submitCollab}
                disabled={loading}
                className="gap-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                <Radio className="h-4 w-4" />
                {selected.size > 0
                  ? `Έναρξη & Πρόσκληση (${selected.size})`
                  : "Έναρξη συνεργασίας"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewFolderButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!user || !name.trim()) return;
    setBusy(true);
    try {
      await createFolder(user.uid, name);
      toast.success("Ο φάκελος δημιουργήθηκε");
      setOpen(false);
      setName("");
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία δημιουργίας");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus className="h-4 w-4 mr-1.5" />
          Νέος φάκελος
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Νέος φάκελος</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label htmlFor="newf">Όνομα φακέλου</Label>
          <Input
            id="newf"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="π.χ. Τάξη Δ' — Ιστορία"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Άκυρο
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Δημιουργία
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  icon,
  title,
  description,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta?: React.ReactNode;
}) {
  return (
    <Card className="panel-soft p-12 flex flex-col items-center text-center">
      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-4">
        {icon}
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        {description}
      </p>
      {cta && <div className="mt-5">{cta}</div>}
    </Card>
  );
}

function ReceivedDesignsList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<ReceivedDesign[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeReceivedDesigns(user.uid, (d) => {
      setDesigns(d);
      setLoading(false);
    });
  }, [user]);

  const saveToLibrary = async (design: ReceivedDesign) => {
    if (!user) return;
    setSavingId(design.id);
    try {
      const newId = await acceptReceivedDesign(design.id);
      toast.success("Αποθηκεύτηκε στη βιβλιοθήκη σας");
      navigate({ to: "/project/$projectId", params: { projectId: newId } });
    } catch (e) {
      console.error(e);
      toast.error("Αποτυχία αποθήκευσης");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Φόρτωση…
      </div>
    );
  }
  if (designs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Κανένας δεν σας έχει στείλει σχέδιο ακόμη.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {designs.map((d) => (
        <Card key={d.id} className="panel-soft p-4 flex flex-col gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium truncate">{d.title}</p>
              <span
                className={`pill shrink-0 ${d.permission === "view" ? "bg-muted text-muted-foreground" : "bg-[color:var(--success)]/15 text-[color:var(--success)]"}`}
              >
                {d.permission === "view" ? "Μόνο προβολή" : "Επεξεργάσιμο"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Από {d.fromUserName}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              disabled={savingId === d.id}
              onClick={() => saveToLibrary(d)}
            >
              {savingId === d.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5" />
              )}
              Άνοιγμα
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="panel-soft p-0 overflow-hidden">
          <div className="aspect-[4/3] bg-muted animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            <div className="h-3 bg-muted animate-pulse rounded w-1/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Συνεργατικά Σχέδια ──────────────────────────────────────────────
// Source of truth for collaborative projects: liveSessions where the
// signed-in user is a participant. Each session contributes its
// mainBoardId (and any group room boards I'm a member of). We resolve
// each board's Project doc once on mount — no N+1 onSnapshot loop. The
// "owned vs joined" split is derived from session.teacherId === uid.
// Status badge ("Ενεργή" vs "Ολοκληρωμένη") comes from project.mode.
function CollabProjectsList() {
  const { user } = useAuth();
  const [owned, setOwned] = useState<Project[] | null>(null);
  const [joined, setJoined] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    if (!user) return;
    // Owned collaborative projects — same source as "Τα Έργα μου", just
    // filtered down to projectType "collaborative" here.
    const u1 = subscribeMyProjects(user.uid, (p) =>
      setOwned(
        p.filter(
          (x) => x.projectType === "collaborative" && x.status !== "archived",
        ),
      ),
    );
    // Collaborative projects I was INVITED to (not the owner) — the
    // lightweight, unlimited-concurrent model (see projects.ts), nothing
    // to do with liveSessions at all.
    const u2 = subscribeMyCollabProjects(user.uid, (p) =>
      setJoined(p.filter((x) => x.ownerId !== user.uid)),
    );
    const u3 = subscribeMyFolders(user.uid, setFolders);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [user]);

  if (owned === null) return <SkeletonGrid />;
  if (owned.length === 0 && joined.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="Δεν έχετε συνεργατικά έργα"
        description="Δημιουργήστε ένα από 'Νέο σχέδιο → Συνεργατικό', ή θα εμφανιστεί εδώ μόλις κάποιος σας προσκαλέσει."
      />
    );
  }

  return (
    <div className="space-y-8">
      {owned.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Έργα που μοιράζομαι
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {owned.map((p) => (
              <ProjectCard key={p.id} project={p} folders={folders} />
            ))}
          </div>
        </section>
      )}
      {joined.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Έργα στα οποία συμμετέχω
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {joined.map((p) => (
              <ProjectCard key={p.id} project={p} folders={folders} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
