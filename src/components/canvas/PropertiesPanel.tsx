import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Trash2,
  Copy,
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronsUp,
  ChevronsDown,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Group,
  Ungroup,
  Square,
  Circle,
  Triangle,
  Diamond,
  Hexagon,
  ChevronDown,
  Replace,
  Lock,
  Unlock,
  Paintbrush,
  ClipboardPaste,
} from "lucide-react";
import type {
  CanvasObject,
  ShapeKind,
  FillTextureKind,
  BorderStyle,
  PatternDensity,
  ConnectorObject,
  SymbolObject,
} from "@/lib/canvas/types";
import { SYMBOL_KINDS_WITHOUT_FILL } from "./SymbolGlyph";
import { VoiceField } from "./VoiceField";

export type AlignMode =
  "left" | "right" | "center-h" | "top" | "bottom" | "center-v";

interface Props {
  object: CanvasObject;
  selectionCount?: number;
  onChange: (patch: Partial<CanvasObject>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward?: () => void;
  onSendBackward?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onAlign?: (mode: AlignMode) => void;
  onDistribute?: (axis: "h" | "v") => void;
  onDistributeGap?: (axis: "h" | "v", gapPx: number) => void;
  onResetPositions?: () => void;
  hasPositionSnapshot?: boolean;
  onGroup?: () => void;
  onUngroup?: () => void;
  onLockToggle?: () => void;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  hasStyleClipboard?: boolean;
  /** Breaks the line/connector into draggable segments (bend points) —
   *  needs the object's resolved on-canvas endpoints, which only
   *  CanvasStage has, so this is a dedicated callback rather than a
   *  generic onChange patch. */
  onSegmentPath?: () => void;
}

const SWATCHES = [
  "#FFFFFF",
  "#F1F5F9",
  "#E2E8F0",
  "#94A3B8",
  "#0F172A",
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
];

const STICKY_COLOR_PAIRS: Array<{
  name: string;
  fill: string;
  stroke: string;
  text: string;
}> = [
  { name: "Κίτρινο", fill: "#FEF3C7", stroke: "#F59E0B", text: "#78350F" },
  { name: "Μπλε", fill: "#DBEAFE", stroke: "#3B82F6", text: "#1E3A8A" },
  { name: "Ροζ", fill: "#FCE7F3", stroke: "#EC4899", text: "#831843" },
  { name: "Πράσινο", fill: "#D1FAE5", stroke: "#10B981", text: "#064E3B" },
  { name: "Μοβ", fill: "#EDE9FE", stroke: "#8B5CF6", text: "#4C1D95" },
  { name: "Πορτοκαλί", fill: "#FFEDD5", stroke: "#F97316", text: "#7C2D12" },
  { name: "Κόκκινο", fill: "#FEE2E2", stroke: "#EF4444", text: "#7F1D1D" },
  { name: "Γκρι", fill: "#F1F5F9", stroke: "#64748B", text: "#1E293B" },
];

const SHAPE_KIND_OPTIONS: Array<{
  kind: ShapeKind;
  label: string;
  Icon: typeof Square;
}> = [
  { kind: "rectangle", label: "Ορθογώνιο", Icon: Square },
  { kind: "rounded-rectangle", label: "Στρογγυλεμένο ορθογώνιο", Icon: Square },
  { kind: "square", label: "Τετράγωνο", Icon: Square },
  { kind: "circle", label: "Κύκλος", Icon: Circle },
  { kind: "oval", label: "Οβάλ", Icon: Circle },
  { kind: "triangle", label: "Τρίγωνο", Icon: Triangle },
  { kind: "diamond", label: "Ρόμβος", Icon: Diamond },
  { kind: "polygon", label: "Πολύγωνο", Icon: Hexagon },
];

export function PropertiesPanel({
  object,
  selectionCount = 1,
  onChange,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onAlign,
  onDistribute,
  onDistributeGap,
  onResetPositions,
  hasPositionSnapshot,
  onGroup,
  onUngroup,
  onLockToggle,
  onCopyStyle,
  onPasteStyle,
  hasStyleClipboard,
  onSegmentPath,
}: Props) {
  const [openSection, setOpenSectionState] = useState<string | null>(
    () => globalOpenSection,
  );
  const [gapAxis, setGapAxis] = useState<"h" | "v">("h");
  const [gapValue, setGapValue] = useState<number>(20);
  const setOpenSection = (title: string | null) => {
    globalOpenSection = title;
    setOpenSectionState(title);
  };
  const isLine = object.type === "line";
  const isConnector = object.type === "connector";
  const isRelation = isLine || isConnector;
  const isText = object.type === "text";
  const isFrame = object.type === "frame";
  const isShape = object.type === "shape";
  const isSymbol = object.type === "symbol";
  const isDrawing = object.type === "drawing";
  const showFill = !isRelation && !isDrawing;
  const supportsRotation = !isRelation && !isDrawing;
  const multi = selectionCount > 1;
  const isLocked = !!object.locked;
  const isGrouped = !!object.groupId;

  const notesLabel = isRelation
    ? "Σημειώσεις σχέσης"
    : "Πληροφορίες / Σημειώσεις";
  const notesPlaceholder = isRelation
    ? "Περιγράψτε τη σχέση μεταξύ των αντικειμένων…"
    : "Επεξηγήσεις, κλινικές σημειώσεις, παρατηρήσεις…";

  return (
    <aside
      className="absolute top-4 right-4 w-72 panel-soft p-4 z-20 max-h-[calc(100%-2rem)] overflow-y-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {multi ? `${selectionCount} επιλεγμένα` : "Ιδιότητες"}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDuplicate}
            title="Διπλασιασμός"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onDelete}
            title="Διαγραφή"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!multi && isText && "text" in object && (
        <CollapsibleSection
          title="Περιεχόμενο"
          openSection={openSection}
          onOpenSection={setOpenSection}
        >
          <div className="space-y-2">
            <Label className="text-xs">Κείμενο</Label>
            <VoiceField
              value={(object as { text: string }).text ?? ""}
              onChange={(v) => onChange({ text: v } as Partial<CanvasObject>)}
              ariaLabel="Κείμενο"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{notesLabel}</Label>
            <VoiceField
              value={object.notes ?? ""}
              onChange={(v) => onChange({ notes: v } as Partial<CanvasObject>)}
              placeholder={notesPlaceholder}
              rows={3}
              ariaLabel={notesLabel}
            />
          </div>
        </CollapsibleSection>
      )}

      {!multi && isShape && "text" in object && (
        <CollapsibleSection
          title="Περιεχόμενο"
          openSection={openSection}
          onOpenSection={setOpenSection}
        >
          <div className="space-y-2">
            <Label className="text-xs">Ετικέτα</Label>
            <VoiceField
              singleLine
              value={(object as { text?: string }).text ?? ""}
              onChange={(v) => onChange({ text: v } as Partial<CanvasObject>)}
              placeholder="Προαιρετικό"
              ariaLabel="Ετικέτα σχήματος"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Σημειώσεις</Label>
            <VoiceField
              value={object.notes ?? ""}
              onChange={(v) => onChange({ notes: v } as Partial<CanvasObject>)}
              placeholder="Πρόσθετες πληροφορίες, δεν εμφανίζονται στον χάρτη…"
              rows={3}
              ariaLabel="Σημειώσεις σχήματος"
            />
          </div>
        </CollapsibleSection>
      )}

      {!multi && isShape && "shapeKind" in object && (
        <CollapsibleSection
          title="Μορφή σχήματος"
          defaultOpen={false}
          openSection={openSection}
          onOpenSection={setOpenSection}
        >
          <p className="text-[10px] text-muted-foreground -mt-1">
            Η μορφοποίηση (χρώμα, μέγεθος, κείμενο) διατηρείται.
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {SHAPE_KIND_OPTIONS.map(({ kind, label, Icon }) => {
              const active =
                (object as { shapeKind: ShapeKind }).shapeKind === kind;
              return (
                <button
                  key={kind}
                  title={label}
                  onClick={() =>
                    !active &&
                    onChange({ shapeKind: kind } as Partial<CanvasObject>)
                  }
                  className={`flex items-center justify-center h-9 rounded-md border transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {!multi && isFrame && (
        <>
          <CollapsibleSection
            title="Περιεχόμενο"
            openSection={openSection}
            onOpenSection={setOpenSection}
          >
            <div className="space-y-2">
              <Label className="text-xs">Τίτλος πλαισίου</Label>
              <VoiceField
                singleLine
                value={(object as { title?: string }).title ?? ""}
                onChange={(v) =>
                  onChange({ title: v } as Partial<CanvasObject>)
                }
                placeholder="π.χ. Ομάδα Α"
                ariaLabel="Τίτλος πλαισίου"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{notesLabel}</Label>
              <VoiceField
                value={object.notes ?? ""}
                onChange={(v) =>
                  onChange({ notes: v } as Partial<CanvasObject>)
                }
                placeholder={notesPlaceholder}
                rows={3}
                ariaLabel={notesLabel}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="Περίγραμμα"
            defaultOpen={false}
            openSection={openSection}
            onOpenSection={setOpenSection}
          >
            {(() => {
              const fo = object as CanvasObject & {
                borderStyle?: BorderStyle;
                stroke?: string;
                strokeWidth?: number;
              };
              const fStyle = fo.borderStyle ?? "solid";
              return (
                <>
                  <SwatchRow
                    label="Χρώμα φόντου"
                    value={fo.fill ?? "#FFFFFF"}
                    onChange={(c) =>
                      onChange({ fill: c } as Partial<CanvasObject>)
                    }
                  />
                  <SwatchRow
                    label="Χρώμα περιγράμματος"
                    value={fo.stroke ?? "#94A3B8"}
                    onChange={(c) =>
                      onChange({ stroke: c } as Partial<CanvasObject>)
                    }
                  />
                  <div>
                    <Label className="text-xs mb-1.5 block">
                      Τύπος περιγράμματος
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {BORDER_STYLE_OPTIONS.map((b) => (
                        <button
                          key={b.kind}
                          onClick={() =>
                            onChange({
                              borderStyle: b.kind,
                            } as Partial<CanvasObject>)
                          }
                          className={`h-8 rounded-md border text-[11px] transition-colors ${
                            fStyle === b.kind
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SliderRow
                    label="Πάχος περιγράμματος"
                    value={fo.strokeWidth ?? 1.5}
                    min={0}
                    max={12}
                    step={0.5}
                    onChange={(v) =>
                      onChange({ strokeWidth: v } as Partial<CanvasObject>)
                    }
                  />
                  <SliderRow
                    label="Αδιαφάνεια"
                    value={Math.round((object.opacity ?? 1) * 100)}
                    min={10}
                    max={100}
                    step={5}
                    onChange={(v) => onChange({ opacity: v / 100 })}
                  />
                </>
              );
            })()}
          </CollapsibleSection>
        </>
      )}

      {!multi && isRelation && (
        <>
          <CollapsibleSection
            title="Περιεχόμενο"
            openSection={openSection}
            onOpenSection={setOpenSection}
          >
            <div className="space-y-2">
              <Label className="text-xs">Ετικέτα σχέσης</Label>
              <VoiceField
                singleLine
                value={(object as { label?: string }).label ?? ""}
                onChange={(v) =>
                  onChange({ label: v } as Partial<CanvasObject>)
                }
                placeholder="π.χ. προκαλεί"
                ariaLabel="Ετικέτα σχέσης"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">{notesLabel}</Label>
              <VoiceField
                value={object.notes ?? ""}
                onChange={(v) =>
                  onChange({ notes: v } as Partial<CanvasObject>)
                }
                placeholder={notesPlaceholder}
                rows={3}
                ariaLabel={notesLabel}
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Κατεύθυνση συσχέτισης"
            defaultOpen={false}
            openSection={openSection}
            onOpenSection={setOpenSection}
          >
            <div className="grid grid-cols-2 gap-1.5">
              <ToggleBtn
                active={!!(object as { arrowStart?: boolean }).arrowStart}
                onClick={() =>
                  onChange({
                    arrowStart: !(object as { arrowStart?: boolean })
                      .arrowStart,
                  } as Partial<CanvasObject>)
                }
              >
                Βέλος αρχής
              </ToggleBtn>
              <ToggleBtn
                active={!!(object as { arrowEnd?: boolean }).arrowEnd}
                onClick={() =>
                  onChange({
                    arrowEnd: !(object as { arrowEnd?: boolean }).arrowEnd,
                  } as Partial<CanvasObject>)
                }
              >
                Βέλος τέλους
              </ToggleBtn>
              {/* Plain lines (not connectors) have no separate "Ποιότητα"
                  section with its own dashed toggle, so they keep a basic
                  one here. Connectors get the richer version below instead,
                  once they're in Έντασης mode. */}
              {!isConnector && (
                <ToggleBtn
                  active={!!(object as { dashed?: boolean }).dashed}
                  onClick={() =>
                    onChange({
                      dashed: !(object as { dashed?: boolean }).dashed,
                    } as Partial<CanvasObject>)
                  }
                >
                  Διακεκομμένη
                </ToggleBtn>
              )}
            </div>
          </CollapsibleSection>

          {/* Ποιότητα σχέσης — connectors only */}
          {isConnector &&
            (() => {
              const co = object as ConnectorObject;
              const cs = co.connectorStyle ?? "line";
              const isIntensity = cs === "lightning";
              const intensity = co.lightningIntensity ?? 4;
              const hasDashLike = !!co.dashed || !!co.dotted;
              return (
                <CollapsibleSection
                  title="Ποιότητα σχέσης"
                  defaultOpen={false}
                  openSection={openSection}
                  onOpenSection={setOpenSection}
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    <ToggleBtn
                      active={cs === "line"}
                      onClick={() =>
                        onChange({
                          connectorStyle: "line",
                        } as Partial<CanvasObject>)
                      }
                    >
                      Απλή
                    </ToggleBtn>
                    <ToggleBtn
                      active={isIntensity}
                      onClick={() =>
                        onChange({
                          connectorStyle: "lightning",
                        } as Partial<CanvasObject>)
                      }
                    >
                      Έντασης
                    </ToggleBtn>
                  </div>

                  {isIntensity && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">Βαθμός έντασης</Label>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {intensity}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          Αραιό
                        </span>
                        <input
                          type="range"
                          min={1}
                          max={10}
                          step={1}
                          value={intensity}
                          onChange={(e) =>
                            onChange({
                              lightningIntensity: Number(e.target.value),
                            } as Partial<CanvasObject>)
                          }
                          className="flex-1 h-1.5 accent-primary cursor-pointer"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Πυκνό
                        </span>
                      </div>
                    </div>
                  )}

                  {(() => {
                    return (
                      <div className="pt-2 border-t border-border">
                        <Label className="text-xs mb-1.5 block">
                          Επιπλέον Χαρακτηριστικά Ποιότητας
                        </Label>
                        <p className="text-[10px] text-muted-foreground mb-1.5">
                          Μπορούν να συνδυαστούν ταυτόχρονα.
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 mb-2">
                          <ToggleBtn
                            active={!!co.dashed}
                            onClick={() =>
                              onChange({
                                dashed: !co.dashed,
                              } as Partial<CanvasObject>)
                            }
                          >
                            Διακεκομμένη
                          </ToggleBtn>
                          <ToggleBtn
                            active={!!co.dotted}
                            onClick={() =>
                              onChange({
                                dotted: !co.dotted,
                              } as Partial<CanvasObject>)
                            }
                          >
                            Κουκκίδες
                          </ToggleBtn>
                          <ToggleBtn
                            active={!!co.wavy}
                            onClick={() =>
                              onChange({
                                wavy: !co.wavy,
                              } as Partial<CanvasObject>)
                            }
                          >
                            Κυματιστές
                          </ToggleBtn>
                          <ToggleBtn
                            active={!!co.tickMarks}
                            onClick={() =>
                              onChange({
                                tickMarks: !co.tickMarks,
                              } as Partial<CanvasObject>)
                            }
                          >
                            Κάθετες
                          </ToggleBtn>
                        </div>
                        {hasDashLike && (
                          <div className="grid grid-cols-2 gap-1.5 mb-2">
                            <ToggleBtn
                              active={(co.dashDensity ?? "sparse") === "sparse"}
                              onClick={() =>
                                onChange({
                                  dashDensity: "sparse",
                                } as Partial<CanvasObject>)
                              }
                            >
                              Αραιό
                            </ToggleBtn>
                            <ToggleBtn
                              active={co.dashDensity === "dense"}
                              onClick={() =>
                                onChange({
                                  dashDensity: "dense",
                                } as Partial<CanvasObject>)
                              }
                            >
                              Πυκνό
                            </ToggleBtn>
                          </div>
                        )}
                        <SliderRow
                          label="Πάχος γραμμής"
                          value={co.strokeWidth ?? 2}
                          min={0}
                          max={12}
                          step={0.5}
                          onChange={(v) =>
                            onChange({
                              strokeWidth: v,
                            } as Partial<CanvasObject>)
                          }
                        />
                        <SwatchRow
                          label="Χρώμα (εφαρμόζεται και στα βέλη)"
                          value={co.stroke ?? "#0F172A"}
                          onChange={(c) =>
                            onChange({ stroke: c } as Partial<CanvasObject>)
                          }
                        />
                        <SliderRow
                          label="Διαφάνεια"
                          value={Math.round((co.opacity ?? 1) * 100)}
                          min={10}
                          max={100}
                          step={5}
                          onChange={(v) =>
                            onChange({
                              opacity: v / 100,
                            } as Partial<CanvasObject>)
                          }
                        />
                      </div>
                    );
                  })()}
                </CollapsibleSection>
              );
            })()}

          {/* Stage 6.1: clear an explicit curve control back to the default bow. */}
          {(() => {
            const cc = (object as { curveControl?: { x: number; y: number } })
              .curveControl;
            if (!cc) return null;
            return (
              <div className="mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() =>
                    onChange({
                      curveControl: undefined,
                    } as unknown as Partial<CanvasObject>)
                  }
                >
                  Επαναφορά καμπύλης
                </Button>
              </div>
            );
          })()}
          {/* Relationship value -5..+5 */}
          {(() => {
            const cur =
              (object as { relationshipValue?: number }).relationshipValue ?? 0;
            const label =
              cur > 0 ? `+${cur}` : cur < 0 ? `−${Math.abs(cur)}` : "0";
            const color =
              cur > 0
                ? "text-green-600"
                : cur < 0
                  ? "text-red-600"
                  : "text-muted-foreground";
            return (
              <CollapsibleSection
                title="Συντελεστής επίδρασης"
                defaultOpen={false}
                openSection={openSection}
                onOpenSection={setOpenSection}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs">Συντελεστής επίδρασης</Label>
                  <span
                    className={`text-xs font-semibold tabular-nums ${color}`}
                  >
                    {label}
                  </span>
                </div>
                <Slider
                  value={[cur]}
                  min={-5}
                  max={5}
                  step={1}
                  onValueChange={([v]) =>
                    onChange({ relationshipValue: v } as Partial<CanvasObject>)
                  }
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>−5</span>
                  <span>0</span>
                  <span>+5</span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Θετικό = ενίσχυση · 0 = ουδέτερο · Αρνητικό = αντίθεση
                </p>
              </CollapsibleSection>
            );
          })()}
          {/* Path editing — lines and connectors alike. Two ways to
              hand-shape the line instead of picking from a preset list:
              a smooth curve-control point, or breaking it into draggable
              segments. */}
          {isRelation &&
            (() => {
              const co = object as ConnectorObject;
              const lo = object as unknown as {
                lineKind?: string;
                bendPoints?: Array<unknown>;
              };
              const isCurvedNow = isConnector
                ? co.routeType === "curved" || (!co.routeType && co.curved)
                : lo.lineKind === "curved";
              const hasSegments = (lo.bendPoints?.length ?? 0) > 0;
              return (
                <div className="mb-3 space-y-1.5">
                  <Label className="text-xs mb-1.5 block">
                    Επεξεργασία διαδρομής
                  </Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      variant={isCurvedNow ? "default" : "outline"}
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() =>
                        isConnector
                          ? isCurvedNow
                            ? onChange({
                                routeType: "straight",
                                curved: false,
                                curveControl: undefined,
                              } as unknown as Partial<CanvasObject>)
                            : onChange({
                                routeType: "curved",
                                curved: true,
                                bendPoints: [],
                              } as unknown as Partial<CanvasObject>)
                          : isCurvedNow
                            ? onChange({
                                lineKind: "straight",
                                curveControl: undefined,
                              } as unknown as Partial<CanvasObject>)
                            : onChange({
                                lineKind: "curved",
                                bendPoints: [],
                              } as unknown as Partial<CanvasObject>)
                      }
                    >
                      <Replace className="h-3.5 w-3.5" />
                      Καμπυλωτή
                    </Button>
                    <Button
                      variant={hasSegments ? "default" : "outline"}
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() =>
                        hasSegments
                          ? onChange({
                              bendPoints: [],
                            } as unknown as Partial<CanvasObject>)
                          : onSegmentPath?.()
                      }
                    >
                      <Replace className="h-3.5 w-3.5" />
                      Κομμάτια
                    </Button>
                  </div>
                  {isCurvedNow && (
                    <p className="text-[10px] text-muted-foreground">
                      Πιάσε το σημείο πάνω στη γραμμή και σύρε το για να την
                      κυρτώσεις.
                    </p>
                  )}
                  {hasSegments && (
                    <p className="text-[10px] text-muted-foreground">
                      Η γραμμή έσπασε σε κομμάτια — πιάσε κάθε σημείο και
                      μετακίνησέ το ξεχωριστά.
                    </p>
                  )}
                </div>
              );
            })()}
        </>
      )}

      {!isShape && !isFrame && !isSymbol && !isDrawing && showFill && (
        <SwatchRow
          label="Γέμισμα"
          value={object.fill ?? "#FFFFFF"}
          onChange={(c) => onChange({ fill: c })}
        />
      )}

      {(isSymbol || isDrawing) && (
        <CollapsibleSection
          title="Περιεχόμενο"
          openSection={openSection}
          onOpenSection={setOpenSection}
        >
          <div className="space-y-2">
            <Label className="text-xs">{notesLabel}</Label>
            <VoiceField
              value={object.notes ?? ""}
              onChange={(v) => onChange({ notes: v } as Partial<CanvasObject>)}
              placeholder={notesPlaceholder}
              rows={3}
              ariaLabel={notesLabel}
            />
          </div>
        </CollapsibleSection>
      )}
      {(isSymbol || isDrawing) && (
        <CollapsibleSection
          title="Στυλ"
          defaultOpen={false}
          openSection={openSection}
          onOpenSection={setOpenSection}
        >
          {isSymbol &&
            !SYMBOL_KINDS_WITHOUT_FILL.has(
              (object as SymbolObject).symbolKind,
            ) && (
              <SwatchRow
                label="Γέμισμα"
                value={object.fill ?? "#FEF3C7"}
                onChange={(c) => onChange({ fill: c } as Partial<CanvasObject>)}
              />
            )}
          <SwatchRow
            label={isDrawing ? "Χρώμα μολυβιού" : "Χρώμα"}
            value={object.stroke ?? "#0F172A"}
            onChange={(c) =>
              onChange({
                stroke: c,
                ...(isSymbol ? { color: c } : {}),
              } as Partial<CanvasObject>)
            }
          />
          <SliderRow
            label="Πάχος γραμμής"
            value={object.strokeWidth ?? 1}
            min={0}
            max={12}
            step={1}
            onChange={(v) => onChange({ strokeWidth: v })}
          />
          <SliderRow
            label="Αδιαφάνεια"
            value={Math.round((object.opacity ?? 1) * 100)}
            min={10}
            max={100}
            step={5}
            onChange={(v) => onChange({ opacity: v / 100 })}
          />
        </CollapsibleSection>
      )}

      {!isShape && !isConnector && !isFrame && !isSymbol && !isDrawing && (
        <SwatchRow
          label={isRelation ? "Χρώμα γραμμής" : "Περίγραμμα"}
          value={object.stroke ?? "#0F172A"}
          onChange={(c) => onChange({ stroke: c } as Partial<CanvasObject>)}
        />
      )}

      {!isShape && !isConnector && !isFrame && !isSymbol && !isDrawing && (
        <SliderRow
          label={isRelation ? "Πάχος γραμμής" : "Πάχος περιγράμματος"}
          value={object.strokeWidth ?? 1}
          min={0}
          max={12}
          step={1}
          onChange={(v) => onChange({ strokeWidth: v })}
        />
      )}
      {!isShape && !isConnector && !isFrame && !isSymbol && !isDrawing && (
        <SliderRow
          label="Αδιαφάνεια"
          value={Math.round((object.opacity ?? 1) * 100)}
          min={10}
          max={100}
          step={5}
          onChange={(v) => onChange({ opacity: v / 100 })}
        />
      )}

      {!multi &&
        isShape &&
        (() => {
          const so = object as CanvasObject & {
            fill?: string;
            stroke?: string;
            strokeWidth?: number;
            opacity?: number;
            fillOpacity?: number;
            fillTexture?: FillTextureKind;
            fillTextureColor?: string;
            fillTextureDensity?: PatternDensity;
            fillTextureOpacity?: number;
            borderStyle?: BorderStyle;
            borderDashDensity?: PatternDensity;
            borderOpacity?: number;
            width: number;
            height: number;
            isSticky?: boolean;
          };
          const hasTexture = (so.fillTexture ?? "none") !== "none";
          const borderStyle = so.borderStyle ?? "solid";
          const hasDashDensity =
            borderStyle === "dashed" ||
            borderStyle === "dotted" ||
            borderStyle === "dash-dot";
          const maxBorder = Math.max(so.width, so.height) > 300 ? 24 : 12;
          return (
            <>
              <CollapsibleSection
                title="Γέμισμα"
                defaultOpen={false}
                openSection={openSection}
                onOpenSection={setOpenSection}
              >
                {so.isSticky && (
                  <div>
                    <Label className="text-xs mb-1.5 block">
                      Χρώμα σημείωσης
                    </Label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {STICKY_COLOR_PAIRS.map((p) => (
                        <button
                          key={p.name}
                          title={p.name}
                          onClick={() =>
                            onChange({
                              fill: p.fill,
                              stroke: p.stroke,
                              textColor: p.text,
                            } as Partial<CanvasObject>)
                          }
                          className={`h-9 rounded-md border-2 transition-colors ${
                            so.fill === p.fill
                              ? "border-primary"
                              : "border-transparent"
                          }`}
                          style={{
                            backgroundColor: p.fill,
                            boxShadow: `inset 0 0 0 2px ${p.stroke}`,
                          }}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      Το περίγραμμα ταιριάζει αυτόματα με το χρώμα.
                    </p>
                  </div>
                )}
                <SwatchRow
                  label="Χρώμα γεμίσματος"
                  value={so.fill ?? "#FFFFFF"}
                  onChange={(c) => onChange({ fill: c })}
                />
                <SliderRow
                  label="Διαφάνεια χρώματος"
                  value={so.fillOpacity ?? 100}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) =>
                    onChange({ fillOpacity: v } as Partial<CanvasObject>)
                  }
                />
                <div>
                  <Label className="text-xs mb-1.5 block">Υφή γεμίσματος</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TEXTURE_OPTIONS.map((t) => (
                      <button
                        key={t.kind}
                        onClick={() =>
                          onChange({
                            fillTexture: t.kind,
                          } as Partial<CanvasObject>)
                        }
                        className={`h-8 rounded-md border text-[11px] transition-colors ${
                          (so.fillTexture ?? "none") === t.kind
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                {hasTexture && (
                  <SwatchRow
                    label="Χρώμα υφής"
                    value={so.fillTextureColor ?? so.stroke ?? "#0F172A"}
                    onChange={(c) =>
                      onChange({ fillTextureColor: c } as Partial<CanvasObject>)
                    }
                  />
                )}
                {hasTexture && (
                  <div>
                    <Label className="text-xs mb-1.5 block">
                      Πυκνότητα υφής
                    </Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {DENSITY_OPTIONS.map((d) => (
                        <button
                          key={d.kind}
                          onClick={() =>
                            onChange({
                              fillTextureDensity: d.kind,
                            } as Partial<CanvasObject>)
                          }
                          className={`h-8 rounded-md border text-[11px] transition-colors ${
                            (so.fillTextureDensity ?? "medium") === d.kind
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {hasTexture && (
                  <SliderRow
                    label="Διαφάνεια υφής"
                    value={so.fillTextureOpacity ?? 100}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(v) =>
                      onChange({
                        fillTextureOpacity: v,
                      } as Partial<CanvasObject>)
                    }
                  />
                )}
              </CollapsibleSection>

              <CollapsibleSection
                title="Περίγραμμα"
                defaultOpen={false}
                openSection={openSection}
                onOpenSection={setOpenSection}
              >
                <SwatchRow
                  label="Χρώμα περιγράμματος"
                  value={so.stroke ?? "#0F172A"}
                  onChange={(c) => onChange({ stroke: c })}
                />
                <div>
                  <Label className="text-xs mb-1.5 block">
                    Τύπος περιγράμματος
                  </Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BORDER_STYLE_OPTIONS.map((b) => (
                      <button
                        key={b.kind}
                        onClick={() =>
                          onChange({
                            borderStyle: b.kind,
                          } as Partial<CanvasObject>)
                        }
                        className={`h-8 rounded-md border text-[11px] transition-colors ${
                          borderStyle === b.kind
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted text-muted-foreground"
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
                {hasDashDensity && (
                  <div>
                    <Label className="text-xs mb-1.5 block">
                      Πυκνότητα διακεκομμένου
                    </Label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {DENSITY_OPTIONS.map((d) => (
                        <button
                          key={d.kind}
                          onClick={() =>
                            onChange({
                              borderDashDensity: d.kind,
                            } as Partial<CanvasObject>)
                          }
                          className={`h-8 rounded-md border text-[11px] transition-colors ${
                            (so.borderDashDensity ?? "medium") === d.kind
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <SliderRow
                  label="Πάχος περιγράμματος"
                  value={Math.min(so.strokeWidth ?? 1, maxBorder)}
                  min={0}
                  max={maxBorder}
                  step={0.5}
                  onChange={(v) =>
                    onChange({ strokeWidth: v } as Partial<CanvasObject>)
                  }
                />
                <SliderRow
                  label="Διαφάνεια περιγράμματος"
                  value={so.borderOpacity ?? 100}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(v) =>
                    onChange({ borderOpacity: v } as Partial<CanvasObject>)
                  }
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Συνολική εμφάνιση"
                defaultOpen={false}
                openSection={openSection}
                onOpenSection={setOpenSection}
              >
                <SliderRow
                  label="Συνολική διαφάνεια σχήματος"
                  value={Math.round((so.opacity ?? 1) * 100)}
                  min={10}
                  max={100}
                  step={5}
                  onChange={(v) =>
                    onChange({ opacity: v / 100 } as Partial<CanvasObject>)
                  }
                />
              </CollapsibleSection>
            </>
          );
        })()}

      {(isText || isShape) && "fontSize" in object && (
        <SliderRow
          label="Μέγεθος κειμένου"
          value={(object as { fontSize?: number }).fontSize ?? 14}
          min={10}
          max={72}
          step={1}
          onChange={(v) => onChange({ fontSize: v } as Partial<CanvasObject>)}
        />
      )}
      {/* Layering */}
      <div className="grid grid-cols-4 gap-1 mt-3">
        <IconBtn title="Μπροστά (ένα επίπεδο)" onClick={onBringForward}>
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn title="Στο μπροστινό μέρος (Ctrl+])" onClick={onBringToFront}>
          <ChevronsUp className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn title="Πίσω (ένα επίπεδο)" onClick={onSendBackward}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn title="Στο πίσω μέρος (Ctrl+[)" onClick={onSendToBack}>
          <ChevronsDown className="h-3.5 w-3.5" />
        </IconBtn>
      </div>

      {/* Group / lock / style clipboard */}
      <div className="grid grid-cols-4 gap-1 mt-2">
        {multi && (
          <IconBtn title="Ομαδοποίηση (Ctrl+G)" onClick={onGroup}>
            <Group className="h-3.5 w-3.5" />
          </IconBtn>
        )}
        {isGrouped && (
          <IconBtn title="Κατάργηση ομάδας (Ctrl+Shift+G)" onClick={onUngroup}>
            <Ungroup className="h-3.5 w-3.5" />
          </IconBtn>
        )}
        <IconBtn
          title={isLocked ? "Ξεκλείδωμα (Ctrl+L)" : "Κλείδωμα (Ctrl+L)"}
          onClick={onLockToggle}
          active={isLocked}
        >
          {isLocked ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Unlock className="h-3.5 w-3.5" />
          )}
        </IconBtn>
        <IconBtn title="Αντιγραφή στυλ (Ctrl+Alt+C)" onClick={onCopyStyle}>
          <Paintbrush className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          title="Επικόλληση στυλ (Ctrl+Alt+V)"
          onClick={onPasteStyle}
          disabled={!hasStyleClipboard}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
        </IconBtn>
      </div>

      {/* Alignment + distribute — only shown when multi-selected */}
      {multi && onAlign && (
        <div className="mt-3 pt-3 border-t border-border">
          <Label className="text-xs mb-2 block">Στοίχιση</Label>
          <div className="grid grid-cols-6 gap-1">
            <AlignBtn title="Αριστερά" onClick={() => onAlign("left")}>
              <AlignStartHorizontal className="h-3.5 w-3.5" />
            </AlignBtn>
            <AlignBtn title="Κέντρο (Ο)" onClick={() => onAlign("center-h")}>
              <AlignCenterHorizontal className="h-3.5 w-3.5" />
            </AlignBtn>
            <AlignBtn title="Δεξιά" onClick={() => onAlign("right")}>
              <AlignEndHorizontal className="h-3.5 w-3.5" />
            </AlignBtn>
            <AlignBtn title="Πάνω" onClick={() => onAlign("top")}>
              <AlignStartVertical className="h-3.5 w-3.5" />
            </AlignBtn>
            <AlignBtn title="Κέντρο (Κ)" onClick={() => onAlign("center-v")}>
              <AlignCenterVertical className="h-3.5 w-3.5" />
            </AlignBtn>
            <AlignBtn title="Κάτω" onClick={() => onAlign("bottom")}>
              <AlignEndVertical className="h-3.5 w-3.5" />
            </AlignBtn>
          </div>
          {onDistribute && selectionCount >= 3 && (
            <>
              <Label className="text-xs mt-3 mb-2 block">Κατανομή</Label>
              <div className="grid grid-cols-2 gap-1">
                <AlignBtn title="Οριζόντια" onClick={() => onDistribute("h")}>
                  <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
                </AlignBtn>
                <AlignBtn title="Κάθετα" onClick={() => onDistribute("v")}>
                  <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
                </AlignBtn>
              </div>
            </>
          )}
          {onDistributeGap && selectionCount >= 2 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">Απόσταση μεταξύ τους</Label>
                <div className="flex rounded-md border border-border overflow-hidden">
                  <button
                    className={`px-1.5 py-0.5 text-[10px] ${gapAxis === "h" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    onClick={() => setGapAxis("h")}
                  >
                    Οριζ.
                  </button>
                  <button
                    className={`px-1.5 py-0.5 text-[10px] ${gapAxis === "v" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                    onClick={() => setGapAxis("v")}
                  >
                    Καθ.
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={-20}
                  max={200}
                  step={1}
                  value={gapValue}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setGapValue(v);
                    onDistributeGap(gapAxis, v);
                  }}
                  className="flex-1 h-1.5 accent-primary cursor-pointer"
                />
                <span className="text-xs tabular-nums w-9 text-center text-muted-foreground">
                  {gapValue}px
                </span>
              </div>
            </div>
          )}
          {hasPositionSnapshot && onResetPositions && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs mt-3"
              onClick={onResetPositions}
            >
              Επαναφορά αρχικής θέσης
            </Button>
          )}
        </div>
      )}

      {!multi && (
        <div className="mt-4 pt-3 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() =>
              onChange({
                fill: undefined,
                stroke: undefined,
                strokeWidth: undefined,
                opacity: undefined,
                color: undefined,
                textColor: undefined,
                bold: undefined,
                italic: undefined,
                textTransform: undefined,
                fillOpacity: undefined,
                fillTexture: undefined,
                fillTextureColor: undefined,
                fillTextureDensity: undefined,
                fillTextureOpacity: undefined,
                borderStyle: undefined,
                borderDashDensity: undefined,
                borderOpacity: undefined,
                dashed: undefined,
                dotted: undefined,
                wavy: undefined,
                tickMarks: undefined,
                dashDensity: undefined,
                connectorStyle: undefined,
                lightningIntensity: undefined,
                labelColor: undefined,
                labelStyle: undefined,
                labelRichText: undefined,
                richText: undefined,
                routeType: undefined,
                curved: undefined,
                curveControl: undefined,
                bendPoints: undefined,
                lineKind: "straight",
              } as unknown as Partial<CanvasObject>)
            }
          >
            Επαναφορά μορφοποίησης
          </Button>
        </div>
      )}
    </aside>
  );
}

function AlignBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-8 rounded-md border border-border bg-background hover:bg-muted flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function IconBtn({
  title,
  onClick,
  children,
  active,
  disabled,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`h-8 rounded-md border flex items-center justify-center transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border hover:bg-muted"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 rounded-md border text-xs px-2 flex items-center justify-center ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

// Accordion: only one section open at a time. Persisted at module level
// (not component state) so it survives the panel fully unmounting when
// nothing is selected (deselect → reselect shouldn't reset it).
let globalOpenSection: string | null = "Περιεχόμενο";

function CollapsibleSection({
  title,
  defaultOpen = true,
  openSection,
  onOpenSection,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  openSection: string | null;
  onOpenSection: (title: string | null) => void;
  children: React.ReactNode;
}) {
  const isOpen = openSection === title;
  return (
    <details
      className="group mb-3 border border-border rounded-lg overflow-hidden"
      open={isOpen}
    >
      <summary
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none bg-muted/50 hover:bg-muted text-xs font-semibold uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden"
        onClick={(e) => {
          // Fully React-controlled — prevent the native toggle entirely.
          // Letting the browser toggle natively (and reacting via
          // onToggle) caused a feedback loop: opening a new section
          // programmatically closes the old one, which ALSO fires its
          // own native toggle event, which was overwriting the just-set
          // "new section is open" state back to null — closing everything.
          e.preventDefault();
          onOpenSection(isOpen ? null : title);
        }}
      >
        {title}
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="p-3 space-y-3">{children}</div>
    </details>
  );
}

const TEXTURE_OPTIONS: Array<{ kind: FillTextureKind; label: string }> = [
  { kind: "none", label: "Χωρίς υφή" },
  { kind: "diagonal", label: "Διαγώνιες" },
  { kind: "horizontal", label: "Οριζόντιες" },
  { kind: "vertical", label: "Κάθετες" },
  { kind: "cross", label: "Διασταυρούμενες" },
  { kind: "dots", label: "Κουκκίδες" },
  { kind: "grid", label: "Πλέγμα" },
  { kind: "wave", label: "Κυματιστές" },
];

const BORDER_STYLE_OPTIONS: Array<{ kind: BorderStyle; label: string }> = [
  { kind: "solid", label: "Συνεχές" },
  { kind: "dashed", label: "Διακεκομμένο" },
  { kind: "dotted", label: "Κουκκίδες" },
  { kind: "dash-dot", label: "Παύλα–τελεία" },
  { kind: "none", label: "Χωρίς περίγραμμα" },
];

const DENSITY_OPTIONS: Array<{ kind: PatternDensity; label: string }> = [
  { kind: "sparse", label: "Αραιή" },
  { kind: "medium", label: "Μέτρια" },
  { kind: "dense", label: "Πυκνή" },
];

function SwatchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="mb-3">
      <Label className="text-xs mb-1.5 block">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-md border ${value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-primary ring-offset-1" : "border-border"}`}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-6 rounded-md border border-border bg-transparent cursor-pointer"
          aria-label="Προσαρμοσμένο χρώμα"
        />
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <Label className="text-xs">{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
