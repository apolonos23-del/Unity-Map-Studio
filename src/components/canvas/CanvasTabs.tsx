// CanvasTabs — browser-like tab bar above the canvas.
// Each tab holds a mapId + label + optional icon.
// Switching tabs is instant (state kept in memory, no reload).

import { useState } from "react";
import { Plus, X, Radio, Users, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabKind = "live" | "collab" | "personal";

export interface CanvasTab {
  id: string;
  mapId: string;
  label: string;
  kind: TabKind;
  closeable?: boolean;
  sessionId?: string; // for live tabs — used by GlobalTabBar to navigate
}

interface Props {
  tabs: CanvasTab[];
  activeId: string;
  onSwitch: (tabId: string) => void;
  onClose?: (tabId: string) => void;
  onNew?: () => void;
  showNew?: boolean;
}

const ICONS: Record<TabKind, React.ReactNode> = {
  live: <Radio className="h-3 w-3 text-[color:var(--success)]" />,
  collab: <Users className="h-3 w-3 text-primary" />,
  personal: <FileText className="h-3 w-3 text-muted-foreground" />,
};

export function CanvasTabs({
  tabs,
  activeId,
  onSwitch,
  onClose,
  onNew,
  showNew = true,
}: Props) {
  return (
    <div className="flex items-center h-9 border-b border-border bg-surface shrink-0 overflow-x-auto overflow-y-hidden">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 h-full text-xs font-medium border-r border-border shrink-0 transition-colors max-w-[180px]",
              active
                ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {ICONS[tab.kind]}
            <span className="truncate">{tab.label}</span>
            {tab.closeable && onClose && (
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="ml-1 rounded hover:bg-muted p-0.5 shrink-0"
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </button>
        );
      })}
      {showNew && onNew && (
        <button
          onClick={onNew}
          className="flex items-center justify-center w-8 h-full shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Νέο σχέδιο"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
