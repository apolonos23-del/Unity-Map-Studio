// GlobalTabBar — persistent tab bar shown at the top of any canvas view.
// Lives outside individual routes so tabs survive navigation.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { tabStore, useTabStore } from "@/lib/tab-store";
import { CanvasTabs } from "./CanvasTabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, FileText, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { subscribeMyProjects, type Project } from "@/lib/projects";
import { useEffect } from "react";

interface Props {
  /** Current route mapId — used to auto-activate the right tab */
  currentMapId?: string;
  onTabSwitch?: (mapId: string, tabKind: string) => void;
}

export function GlobalTabBar({ currentMapId, onTabSwitch }: Props) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { tabs, activeId } = useTabStore();
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  // Auto-activate tab matching current route
  useEffect(() => {
    if (!currentMapId) return;
    const match = tabs.find((t) => t.mapId === currentMapId);
    if (match && match.id !== activeId) {
      tabStore.setActive(match.id);
    }
  }, [currentMapId, tabs, activeId]);

  // Load projects for picker
  useEffect(() => {
    if (!pickerOpen || !user) return;
    return subscribeMyProjects(user.uid, setProjects);
  }, [pickerOpen, user]);

  const handleSwitch = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tabStore.setActive(tabId);
    onTabSwitch?.(tab.mapId, tab.kind);
    // Navigate to the tab's route
    if (tab.kind === "live" && tab.sessionId) {
      navigate({
        to: "/live/$sessionId",
        params: { sessionId: tab.sessionId },
      });
    } else {
      navigate({ to: "/project/$projectId", params: { projectId: tab.mapId } });
    }
  };

  const handleClose = (tabId: string) => {
    tabStore.closeTab(tabId);
    // If closing active tab, navigate to new active
    const remaining = tabStore.getTabs();
    if (remaining.length > 0) {
      const newActive = tabStore.getActive();
      const newTab = remaining.find((t) => t.id === newActive);
      if (newTab) handleSwitch(newActive);
    } else {
      // No tabs left at all — don't leave the just-closed project's page
      // sitting open with nothing to switch back to.
      navigate({ to: "/lobby" });
    }
  };

  const createPersonal = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { createProject } = await import("@/lib/projects");
      const newId = await createProject(user.uid, "Νέο σχέδιο", "personal");
      const tabId = `personal-${newId}`;
      tabStore.openTab({
        id: tabId,
        mapId: newId,
        label: "Νέο σχέδιο",
        kind: "personal",
        closeable: true,
      });
      navigate({ to: "/project/$projectId", params: { projectId: newId } });
    } catch {
      toast.error("Αποτυχία δημιουργίας σχεδίου");
    } finally {
      setBusy(false);
    }
  };

  const openFromProjects = (project: Project) => {
    const tabId = `project-${project.id}`;
    tabStore.openTab({
      id: tabId,
      mapId: project.id,
      label: project.title ?? "Σχέδιο",
      kind: "personal",
      closeable: true,
    });
    setPickerOpen(false);
    navigate({ to: "/project/$projectId", params: { projectId: project.id } });
  };

  if (tabs.length === 0) return null;

  return (
    <>
      <div className="flex items-center border-b border-border bg-surface shrink-0">
        <CanvasTabs
          tabs={tabs}
          activeId={activeId}
          onSwitch={handleSwitch}
          onClose={handleClose}
          showNew={false}
        />
        {/* + button with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 shrink-0 rounded-none border-l border-border"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={createPersonal}>
              <FileText className="h-4 w-4 mr-2" /> Νέο προσωπικό σχέδιο
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPickerOpen(true)}>
              <FolderOpen className="h-4 w-4 mr-2" /> Άνοιγμα από τα Έργα μου
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Project picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Τα Έργα μου</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-1 py-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Δεν υπάρχουν αποθηκευμένα έργα.
              </p>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openFromProjects(p)}
                  className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate">
                    {p.title ?? "Χωρίς τίτλο"}
                  </span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
