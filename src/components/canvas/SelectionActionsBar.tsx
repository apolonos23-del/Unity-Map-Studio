// SelectionActionsBar — floating bar shown whenever 1+ objects are
// selected on a canvas. Two actions:
//   1. "Νέο σχέδιο" — always available: extracts the selection into a
//      brand-new personal project and opens it (as a tab, wherever the
//      calling page's tab system lives).
//   2. "Ζωντανό μάθημα" — only shown when the caller supplies at least one
//      send target (an active session's main board, and/or — for
//      teachers — any of its groups). Inserts a copy of the selection
//      into the chosen board; the original selection is untouched.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilePlus2, Radio, Loader2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { CanvasObject } from "@/lib/canvas/types";

export interface SendTarget {
  id: string;
  /** Board's mapId to insert into. */
  mapId: string;
  label: string;
}

interface Props {
  selectedObjects: CanvasObject[];
  onCreateNewProject: (objects: CanvasObject[]) => Promise<void>;
  sendTargets?: SendTarget[];
  onSendTo?: (target: SendTarget, objects: CanvasObject[]) => Promise<void>;
}

export function SelectionActionsBar({
  selectedObjects,
  onCreateNewProject,
  sendTargets,
  onSendTo,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  if (selectedObjects.length === 0) return null;

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreateNewProject(selectedObjects);
    } catch {
      toast.error("Αποτυχία δημιουργίας νέου σχεδίου");
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async (target: SendTarget) => {
    if (!onSendTo) return;
    setSendingTo(target.id);
    try {
      await onSendTo(target, selectedObjects);
      toast.success(`Στάλθηκε στο «${target.label}»`);
    } catch {
      toast.error("Αποτυχία αποστολής");
    } finally {
      setSendingTo(null);
    }
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full border border-border bg-surface shadow-lg px-2 py-1.5">
      <span className="text-[11px] text-muted-foreground px-2 whitespace-nowrap">
        {selectedObjects.length} επιλεγμένα
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 text-xs"
        onClick={handleCreate}
        disabled={creating}
      >
        {creating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <FilePlus2 className="h-3.5 w-3.5" />
        )}
        Νέο σχέδιο
      </Button>
      {sendTargets && sendTargets.length > 0 && onSendTo && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-xs"
              disabled={sendingTo !== null}
            >
              {sendingTo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Radio className="h-3.5 w-3.5" />
              )}
              Ζωντανό μάθημα
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            <DropdownMenuLabel className="text-[11px]">
              Αποστολή σε…
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sendTargets.map((t) => (
              <DropdownMenuItem key={t.id} onClick={() => handleSend(t)}>
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
