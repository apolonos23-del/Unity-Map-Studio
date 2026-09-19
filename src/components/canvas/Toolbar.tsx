import { useMemo, useState } from "react";
import {
  MousePointer2,
  Hand,
  BoxSelect,
  Square,
  Circle,
  Triangle,
  Diamond,
  Hexagon,
  Minus,
  MoveRight,
  MoveHorizontal,
  Spline,
  GitBranch,
  Type,
  StickyNote,
  Pencil,
  Zap,
  RotateCw,
  AlertTriangle,
  ArrowRight,
  Activity,
  Frame as FrameIcon,
  ChevronDown,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IMPLEMENTED_TOOLS, WORKSPACES, type ToolId } from "@/lib/workspaces";
import type { WorkspaceType } from "@/lib/canvas/types";

interface ToolDef {
  id: ToolId;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
}

interface ToolGroup {
  key: string;
  primary: ToolDef;
  items?: ToolDef[];
}

const GROUPS: ToolGroup[] = [
  {
    key: "genogram",
    primary: { id: "genogram.male", label: "Γενόγραμμα", Icon: GitBranch },
    items: [
      { id: "genogram.male", label: "Άνδρας", Icon: Square },
      { id: "genogram.female", label: "Γυναίκα", Icon: Circle },
      { id: "genogram.unknown", label: "Απροσδιόριστο φύλο", Icon: Diamond },
      { id: "genogram.deceased", label: "Αποβιώσας", Icon: Square },
      { id: "genogram.partner", label: "Σύντροφοι", Icon: Minus },
      { id: "genogram.separated", label: "Χωρισμός", Icon: Minus },
      { id: "genogram.child", label: "Σχέση γονέα–παιδιού", Icon: GitBranch },
    ],
  },
  {
    key: "select",
    primary: {
      id: "select",
      label: "Επιλογή",
      Icon: MousePointer2,
      shortcut: "V",
    },
  },
  {
    key: "hand",
    primary: {
      id: "hand",
      label: "Μετακίνηση καμβά",
      Icon: Hand,
      shortcut: "H",
    },
  },
  {
    key: "marquee",
    primary: { id: "marquee", label: "Πολλαπλή επιλογή", Icon: BoxSelect },
  },
  {
    key: "shapes",
    primary: { id: "shape.rectangle", label: "Σχήματα", Icon: Square },
    items: [
      { id: "shape.rectangle", label: "Ορθογώνιο", Icon: Square },
      {
        id: "shape.rounded-rectangle",
        label: "Στρογγυλεμένο ορθογώνιο",
        Icon: Square,
      },
      { id: "shape.square", label: "Τετράγωνο", Icon: Square },
      { id: "shape.circle", label: "Κύκλος", Icon: Circle },
      { id: "shape.triangle", label: "Τρίγωνο", Icon: Triangle },
      { id: "shape.diamond", label: "Ρόμβος", Icon: Diamond },
      { id: "shape.polygon", label: "Πολύγωνο", Icon: Hexagon },
    ],
  },
  // Γραμμές — standalone graphic lines (no shape attachment required).
  // Dashed stays as a separate creation tool because it actually sets
  // lineKind === "dashed" at make-time, not just a property toggle.
  {
    key: "lines",
    primary: {
      id: "line.straight",
      label: "Γραμμές",
      Icon: Minus,
      shortcut: "L",
    },
    items: [
      { id: "line.straight", label: "Ευθεία", Icon: Minus },
      { id: "line.dashed", label: "Διακεκομμένη", Icon: Minus },
      { id: "line.arrow-end", label: "Βέλος", Icon: MoveRight, shortcut: "A" },
      { id: "line.arrow-both", label: "Διπλό βέλος", Icon: MoveHorizontal },
      { id: "line.curved", label: "Καμπύλη", Icon: Spline },
    ],
  },
  // Σχέσεις — connectors that attach to two shapes by magnets. Bidirectional
  // / curved / orthogonal routing is exposed as Properties-Panel toggles on
  // the selected connector (deliberately not duplicated as separate toolbar
  // buttons — addresses the "looks duplicated" complaint).
  {
    key: "relationships",
    primary: { id: "line.connector", label: "Σχέσεις", Icon: GitBranch },
    items: [
      { id: "line.connector", label: "Σχέση / σύνδεση", Icon: GitBranch },
      { id: "line.lightning", label: "Σχέση έντασης (κεραυνός)", Icon: Zap },
    ],
  },
  {
    key: "text",
    primary: { id: "text", label: "Κείμενο", Icon: Type, shortcut: "T" },
    items: [
      { id: "text", label: "Κείμενο", Icon: Type, shortcut: "T" },
      { id: "sticky", label: "Σημείωση", Icon: StickyNote },
    ],
  },
  { key: "pencil", primary: { id: "pencil", label: "Μολύβι", Icon: Pencil } },
  {
    key: "symbols",
    primary: { id: "symbol.thunderbolt", label: "Σύμβολα", Icon: Zap },
    items: [
      { id: "symbol.thunderbolt", label: "Κεραυνός", Icon: Zap },
      { id: "symbol.loop", label: "Βρόχος", Icon: RotateCw },
      {
        id: "symbol.process-arrow",
        label: "Βέλος διαδικασίας",
        Icon: ArrowRight,
      },
      { id: "symbol.warning", label: "Προειδοποίηση", Icon: AlertTriangle },
    ],
  },
  { key: "frame", primary: { id: "frame", label: "Πλαίσιο", Icon: FrameIcon } },
];

interface Props {
  tool: ToolId;
  setTool: (t: ToolId) => void;
  workspaceType?: WorkspaceType;
}

export function CanvasToolbar({
  tool,
  setTool,
  workspaceType = "free-drawing",
}: Props) {
  // Filter the toolbar by the active workspace preset (Phase 5).
  const allowed = useMemo(
    () => new Set(WORKSPACES[workspaceType].allowedTools),
    [workspaceType],
  );
  const visibleGroups = useMemo(() => {
    return GROUPS.map((g) => {
      if (!g.items) {
        return allowed.has(g.primary.id) ? g : null;
      }
      const items = g.items.filter((it) => allowed.has(it.id));
      if (items.length === 0) return null;
      const primary = allowed.has(g.primary.id) ? g.primary : items[0];
      return { ...g, primary, items };
    }).filter((g): g is ToolGroup => g !== null);
  }, [allowed]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="w-14 border-r border-border bg-surface flex flex-col items-center py-3 gap-1 shrink-0 select-none">
        {visibleGroups.map((g, i, arr) => {
          const next = arr[i + 1];
          // Insert a divider between logical sections (selection→shapes, lines→text, text→pencil…).
          const isBoundary = !!next && sectionOf(g.key) !== sectionOf(next.key);
          return (
            <div key={g.key} className="flex flex-col items-center w-full">
              {g.items && g.items.length > 0 ? (
                <ToolGroupButton group={g} tool={tool} setTool={setTool} />
              ) : (
                <ToolButton
                  def={g.primary}
                  active={tool === g.primary.id}
                  onSelect={setTool}
                />
              )}
              {isBoundary && (
                <div className="h-px w-8 bg-border my-1.5" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

/** Group toolbar buttons by section so dividers adapt to the workspace preset. */
function sectionOf(key: string): string {
  if (key === "select" || key === "hand" || key === "marquee") return "nav";
  if (key === "shapes") return "geometry";
  if (key === "lines" || key === "relationships") return "lines";
  if (key === "text" || key === "pencil") return "content";
  if (key === "symbols") return "symbols";
  if (key === "frame") return "frame";
  return "misc";
}

function ToolButton({
  def,
  active,
  onSelect,
  compact,
}: {
  def: ToolDef;
  active: boolean;
  onSelect: (t: ToolId) => void;
  compact?: boolean;
}) {
  const implemented = IMPLEMENTED_TOOLS.has(def.id);
  const Icon = def.Icon;
  const cls = compact
    ? "h-8 w-full rounded-md flex items-center gap-2 px-2 text-sm"
    : `h-10 w-10 rounded-lg flex items-center justify-center transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`;
  if (!implemented) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button disabled className={`${cls} opacity-40 cursor-not-allowed`}>
            <Icon className="h-4 w-4" />
            {compact && <span className="flex-1 text-left">{def.label}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent side={compact ? "right" : "right"}>
          {def.label} — Σύντομα διαθέσιμο
        </TooltipContent>
      </Tooltip>
    );
  }
  if (compact) {
    return (
      <button
        onClick={() => onSelect(def.id)}
        className={`${cls} ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1 text-left">{def.label}</span>
        {def.shortcut && (
          <span className="text-[10px] text-muted-foreground font-mono">
            {def.shortcut}
          </span>
        )}
      </button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onSelect(def.id)}
          className={cls}
          aria-pressed={active}
          aria-label={def.label}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {def.label}
        {def.shortcut ? ` (${def.shortcut})` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolGroupButton({
  group,
  tool,
  setTool,
}: {
  group: ToolGroup;
  tool: ToolId;
  setTool: (t: ToolId) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = group.items!;
  const activeItem = items.find((it) => it.id === tool) ?? group.primary;
  const Icon = activeItem.Icon;
  const isActive = items.some((it) => it.id === tool);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={`h-10 w-10 rounded-lg flex items-center justify-center relative transition-colors ${
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              aria-pressed={isActive}
              aria-label={group.primary.label}
            >
              <Icon className="h-4 w-4" />
              <ChevronDown className="h-2.5 w-2.5 absolute bottom-1 right-1 opacity-60" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{group.primary.label}</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="start" className="w-56 p-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
          {group.primary.label}
        </div>
        <div className="flex flex-col gap-0.5">
          {items.map((it) => (
            <ToolButton
              key={it.id}
              def={it}
              active={tool === it.id}
              onSelect={(t) => {
                setTool(t);
                setOpen(false);
              }}
              compact
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
