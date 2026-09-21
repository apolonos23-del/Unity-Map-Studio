import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ZoomIn, ZoomOut, Undo2, Redo2, Maximize2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PropertiesPanel } from "./PropertiesPanel";
import { SymbolGlyph } from "./SymbolGlyph";
import { useCanvasShortcuts } from "@/lib/canvas/shortcuts";
import {
  emptyCanvasState,
  type CanvasObject,
  type CanvasState,
  type ConnectorObject,
  type DrawingObject,
  type FrameObject,
  type LineObject,
  type MagnetSide,
  type ShapeKind,
  type ShapeObject,
  type SymbolKind,
  type SymbolObject,
  type TextObject,
  type FillTextureKind,
  type PatternDensity,
  type BorderStyle,
} from "@/lib/canvas/types";
import { hashCanvasState } from "@/lib/canvas/schema";
import { mapStore } from "@/lib/canvas/storage";
import { memoryCache } from "@/lib/canvas/memory-cache";
import DOMPurify from "dompurify";
import {
  createGenogramObjects,
  type GenogramTool,
} from "@/lib/canvas/genogram";
import {
  hasCanvasChanges,
  mergeSavedLocalChanges,
  removeCanvasObject,
  sameJson,
  upsertCanvasObject,
} from "@/lib/canvas/firebase-board-model";
import {
  buildPolyPoints,
  insertBendPoint,
  lightningPath,
  autoRoutePath,
  moveBendPoint,
  nearestInsertIndex,
  polylinePath,
  removeBendPoint,
  smoothPath,
  sampleQuadraticBezier,
  pointAlong,
  type Rect,
} from "@/lib/canvas/bend-points";
import type { ToolId } from "@/lib/workspaces";
interface Props {
  mapId: string;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  onSaveStatusChange?: (s: "saving" | "saved" | "dirty") => void;
  /** Parent receives a stable handle to trigger save / inject AI objects. */
  onReady?: (api: {
    save: () => Promise<void>;
    appendObjects: (objs: CanvasObject[]) => void;
    /** Replaces the entire board with an imported CanvasState (used by
     *  "Εισαγωγή JSON") — distinct from appendObjects, which merges new
     *  objects onto the existing board. */
    replaceState: (next: CanvasState) => void;
  }) => void;
  /** Enable periodic poll-based remote merge for live/collab boards. */
  liveSync?: boolean;
  /** When true, this client is the board owner and will write micro-save snapshots. */
  liveOwner?: boolean;
  /** When true, all editing is disabled — canvas is view-only. */
  readOnly?: boolean;
  /** When false, debounced save and live sync poll are suppressed (background tab). */
  isActive?: boolean;
  /** Fires whenever the current selection changes, with the actual selected
   *  objects (not just ids — and including any connector whose BOTH
   *  endpoints are in the selection, even though marquee-select itself
   *  deliberately skips connectors since they visually follow their
   *  shapes) — plus whether this selection was made with the marquee
   *  (rubber-band) tool specifically, vs. a plain click. Lets the parent
   *  page show a floating action bar only for deliberate marquee
   *  selections, per the product decision, without CanvasStage needing to
   *  know anything about those destinations. */
  onSelectionChange?: (objects: CanvasObject[], viaMarquee: boolean) => void;
}

const newId = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

// ── factories ────────────────────────────────────────────────────────
function baseObj() {
  return {
    id: newId(),
    zIndex: now(),
    createdAt: now(),
    updatedAt: now(),
    opacity: 1,
  };
}
function makeShape(
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
): ShapeObject {
  return {
    ...baseObj(),
    type: "shape",
    shapeKind: kind,
    x,
    y,
    width: w,
    height: h,
    fill: "#FFFFFF",
    stroke: "#0F172A",
    strokeWidth: 1.5,
    textColor: "#0F172A",
    text: "",
    borderRadius: kind === "rounded-rectangle" ? 12 : undefined,
  };
}
function makeText(x: number, y: number): TextObject {
  return {
    ...baseObj(),
    type: "text",
    text: "Κείμενο",
    x,
    y,
    width: 140,
    height: 28,
    fontSize: 16,
    textColor: "#0F172A",
  };
}
function makeStickyNote(x: number, y: number): ShapeObject {
  return {
    ...baseObj(),
    type: "shape",
    shapeKind: "rounded-rectangle",
    isSticky: true,
    x,
    y,
    width: 160,
    height: 120,
    fill: "#FEF3C7",
    stroke: "#F59E0B",
    strokeWidth: 1,
    textColor: "#78350F",
    text: "Σημείωση",
    borderRadius: 8,
    fontSize: 14,
  };
}
function makeFrame(x: number, y: number, w: number, h: number): FrameObject {
  return {
    ...baseObj(),
    type: "frame",
    x,
    y,
    width: w,
    height: h,
    fill: "transparent",
    stroke: "#94A3B8",
    strokeWidth: 1.5,
    title: "Πλαίσιο",
  };
}
function makeLine(
  kind: "straight" | "dashed" | "curved",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  arrowStart: boolean,
  arrowEnd: boolean,
): LineObject {
  return {
    ...baseObj(),
    type: "line",
    lineKind: kind,
    x1,
    y1,
    x2,
    y2,
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    stroke: "#0F172A",
    strokeWidth: 2,
    arrowStart,
    arrowEnd,
    dashed: kind === "dashed",
  };
}
function makeSymbol(kind: SymbolKind, x: number, y: number): SymbolObject {
  return {
    ...baseObj(),
    type: "symbol",
    symbolKind: kind,
    x,
    y,
    width: 64,
    height: 64,
    stroke: "#0F172A",
    strokeWidth: 2,
    fill: "#FFFFFF",
    color: "#0F172A",
  };
}
function makeDrawing(x: number, y: number, color: string): DrawingObject {
  return {
    ...baseObj(),
    type: "drawing",
    x,
    y,
    width: 1,
    height: 1,
    stroke: color,
    strokeWidth: 2,
    points: [{ x: 0, y: 0 }],
  };
}

// ── shape geometry helpers ────────────────────────────────────────────
function polygonPoints(
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const cx = x + w / 2;
  if (kind === "triangle") return `${cx},${y} ${x + w},${y + h} ${x},${y + h}`;
  if (kind === "diamond")
    return `${cx},${y} ${x + w},${y + h / 2} ${cx},${y + h} ${x},${y + h / 2}`;
  if (kind === "polygon") {
    // regular hexagon inscribed in bounding box
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      pts.push(
        `${cx + (w / 2) * Math.cos(a)},${y + h / 2 + (h / 2) * Math.sin(a)}`,
      );
    }
    return pts.join(" ");
  }
  return "";
}

// ── magnets / connector geometry ─────────────────────────────────────
export function objectBBox(o: CanvasObject): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (o.type === "line") {
    const x = Math.min(o.x1, o.x2),
      y = Math.min(o.y1, o.y2);
    return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }
  return { x: o.x, y: o.y, w: o.width, h: o.height };
}
export function magnetPoint(
  o: CanvasObject,
  side: MagnetSide,
): { x: number; y: number } {
  const b = objectBBox(o);
  // bbox-relative target point
  let bx: number, by: number;
  switch (side) {
    case "top":
      bx = b.x + b.w / 2;
      by = b.y;
      break;
    case "right":
      bx = b.x + b.w;
      by = b.y + b.h / 2;
      break;
    case "bottom":
      bx = b.x + b.w / 2;
      by = b.y + b.h;
      break;
    case "left":
      bx = b.x;
      by = b.y + b.h / 2;
      break;
    case "top-left":
      bx = b.x;
      by = b.y;
      break;
    case "top-right":
      bx = b.x + b.w;
      by = b.y;
      break;
    case "bottom-left":
      bx = b.x;
      by = b.y + b.h;
      break;
    case "bottom-right":
      bx = b.x + b.w;
      by = b.y + b.h;
      break;
  }
  // Project to the actual visible outline of the shape so connectors touch the
  // real border, not just the bounding box.
  const projected = projectToOutline(o, bx, by);
  return projected ?? { x: bx, y: by };
}

/** Project a bbox-edge point onto the real outline of the shape by casting a
 *  ray from the shape center through that point. Returns null for objects whose
 *  outline IS the bbox (rectangles, frames, symbols, text). */
function projectToOutline(
  o: CanvasObject,
  bx: number,
  by: number,
): { x: number; y: number } | null {
  if (o.type !== "shape") return null;
  const b = objectBBox(o);
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  const dx = bx - cx,
    dy = by - cy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: cx, y: cy };
  const kind = o.shapeKind;
  if (kind === "circle" || kind === "oval") {
    const rx = b.w / 2,
      ry = b.h / 2;
    if (rx <= 0 || ry <= 0) return null;
    const s = 1 / Math.hypot(dx / rx, dy / ry);
    return { x: cx + s * dx, y: cy + s * dy };
  }
  if (kind === "triangle" || kind === "diamond" || kind === "polygon") {
    const pts = polygonVertices(kind, b.x, b.y, b.w, b.h);
    return rayPolygonHit(cx, cy, dx, dy, pts);
  }
  if (kind === "rounded-rectangle") {
    const r = Math.min(o.borderRadius ?? 12, b.w / 2, b.h / 2);
    // For mid-side magnets the bbox edge is already on the outline.
    // For corners, pull the point inward along the diagonal so it sits on the arc.
    const onTopBot =
      Math.abs(by - b.y) < 1e-6 || Math.abs(by - (b.y + b.h)) < 1e-6;
    const onLeftRight =
      Math.abs(bx - b.x) < 1e-6 || Math.abs(bx - (b.x + b.w)) < 1e-6;
    if (onTopBot && onLeftRight) {
      // corner: 45° point on the rounded corner arc
      const sx = bx < cx ? 1 : -1;
      const sy = by < cy ? 1 : -1;
      const ax = bx < cx ? b.x + r : b.x + b.w - r;
      const ay = by < cy ? b.y + r : b.y + b.h - r;
      const k = r / Math.SQRT2;
      return { x: ax - sx * k, y: ay - sy * k };
    }
    return { x: bx, y: by };
  }
  return null;
}

function polygonVertices(
  kind: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
): Array<[number, number]> {
  const cx = x + w / 2;
  if (kind === "triangle")
    return [
      [cx, y],
      [x + w, y + h],
      [x, y + h],
    ];
  if (kind === "diamond")
    return [
      [cx, y],
      [x + w, y + h / 2],
      [cx, y + h],
      [x, y + h / 2],
    ];
  if (kind === "polygon") {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      out.push([cx + (w / 2) * Math.cos(a), y + h / 2 + (h / 2) * Math.sin(a)]);
    }
    return out;
  }
  return [];
}

/** Intersect ray (cx,cy) + t*(dx,dy), t>0, with closed polygon edges; return closest hit. */
function rayPolygonHit(
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  pts: Array<[number, number]>,
): { x: number; y: number } | null {
  let bestT = Infinity,
    best: { x: number; y: number } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const ex = x2 - x1,
      ey = y2 - y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((x1 - cx) * ey - (y1 - cy) * ex) / denom;
    const u = ((x1 - cx) * dy - (y1 - cy) * dx) / denom;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < bestT) {
      bestT = t;
      best = { x: cx + t * dx, y: cy + t * dy };
    }
  }
  return best;
}
const MAGNET_SIDES: MagnetSide[] = [
  "top",
  "right",
  "bottom",
  "left",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
/** Pick the magnet pair (source side, target side) that gives the shortest line. */
export function pickMagnetPair(
  source: CanvasObject,
  target: CanvasObject,
): { sourceMagnet: MagnetSide; targetMagnet: MagnetSide } {
  let best = { s: "right" as MagnetSide, t: "left" as MagnetSide, d: Infinity };
  for (const s of MAGNET_SIDES)
    for (const t of MAGNET_SIDES) {
      const p1 = magnetPoint(source, s),
        p2 = magnetPoint(target, t);
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (d < best.d) best = { s, t, d };
    }
  return { sourceMagnet: best.s, targetMagnet: best.t };
}
/** Resolve endpoints of a connector given the current object map. */
export function resolveConnector(
  c: ConnectorObject,
  byId: Map<string, CanvasObject>,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const a = byId.get(c.sourceObjectId),
    b = byId.get(c.targetObjectId);
  if (!a || !b) return null;
  const p1 = magnetPoint(a, c.sourceMagnet);
  const p2 = magnetPoint(b, c.targetMagnet);
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}
function makeConnector(
  sourceId: string,
  targetId: string,
  sm: MagnetSide,
  tm: MagnetSide,
): ConnectorObject {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type: "connector",
    zIndex: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    opacity: 1,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    sourceObjectId: sourceId,
    targetObjectId: targetId,
    sourceMagnet: sm,
    targetMagnet: tm,
    stroke: "#0F172A",
    strokeWidth: 2,
    arrowEnd: true,
    arrowStart: false,
    dashed: false,
    routeType: "straight",
    relationshipValue: 0,
    labelStyle: { italic: true },
  };
}
const CONNECTOR_TARGET_TYPES = new Set(["shape", "frame", "symbol", "text"]);
function isConnectable(o: CanvasObject): boolean {
  return CONNECTOR_TARGET_TYPES.has(o.type);
}

// Effective route type, honouring legacy `curved` boolean.
function effectiveRoute(
  c: ConnectorObject,
): "straight" | "curved" | "orthogonal" | "zigzag" {
  if (c.routeType) return c.routeType;
  return c.curved ? "curved" : "straight";
}

/** Build an SVG path 'd' attribute for a connector given its endpoints + magnets.
 *  Orthogonal/zigzag paths leave the source perpendicular to its side, then turn. */
function connectorPath(
  route: "straight" | "curved" | "orthogonal" | "zigzag",
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  sm: MagnetSide,
  tm: MagnetSide,
  curveControl?: { x: number; y: number },
): string {
  if (route === "straight") return `M ${x1} ${y1} L ${x2} ${y2}`;
  if (route === "curved") {
    let ctrlX: number, ctrlY: number;
    if (curveControl) {
      ctrlX = curveControl.x;
      ctrlY = curveControl.y;
    } else {
      const midX = (x1 + x2) / 2,
        midY = (y1 + y2) / 2;
      const dx = x2 - x1,
        dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.min(60, len * 0.25);
      ctrlX = midX - (dy / len) * off;
      ctrlY = midY + (dx / len) * off;
    }
    return `M ${x1} ${y1} Q ${ctrlX} ${ctrlY} ${x2} ${y2}`;
  }
  // Manhattan/orthogonal & zigzag: pick H-first vs V-first based on source magnet axis.
  const sHoriz = sm === "left" || sm === "right";
  const tHoriz = tm === "left" || tm === "right";
  if (route === "orthogonal") {
    // Single elbow: leave perpendicular to source side.
    if (sHoriz) return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
    return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
  }
  // zigzag: 3-segment "S" — leave source, half-step, arrive target perpendicular.
  if (sHoriz && tHoriz) {
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }
  if (!sHoriz && !tHoriz) {
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
  }
  // mixed: H→V→H or V→H→V
  if (sHoriz) {
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

// Compact palette for the inline (bottom, double-click) text-color toolbar —
// used for shape/text textColor and connector labelColor alike.
const MINI_SWATCHES = [
  "#0F172A",
  "#EF4444",
  "#F59E0B",
  "#22C55E",
  "#3B82F6",
  "#8B5CF6",
  "#FFFFFF",
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Seeds a contentEditable element's innerHTML exactly once (on mount),
 *  then never touches it again — the DOM itself manages content from
 *  then on as the user types/formats, so React never fights it (which
 *  would otherwise reset the cursor position on every keystroke). */
function seedRichTextRef(html: string) {
  return (el: HTMLDivElement | null) => {
    if (el && !el.dataset.seeded) {
      el.innerHTML = html || "";
      el.dataset.seeded = "1";
    }
  };
}

// ── Relationship line style helpers (dashed/dotted/wavy/tick-marks) ────

/** Sine wave that follows the given base path (straight line OR curve
 *  sample points) via arc-length parametrization — used for the
 *  "Κυματιστές" relationship style. */
function wavyPathAlong(basePts: { x: number; y: number }[]): string {
  let total = 0;
  for (let i = 1; i < basePts.length; i++)
    total += Math.hypot(
      basePts[i].x - basePts[i - 1].x,
      basePts[i].y - basePts[i - 1].y,
    );
  const wavelength = 14;
  const amplitude = 4;
  const segments = Math.max(2, Math.round(total / wavelength));
  const first = pointAlong(basePts, 0);
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < segments; i++) {
    const t1 = (i + 0.5) / segments;
    const sign = i % 2 === 0 ? 1 : -1;
    const mid = pointAlong(basePts, t1);
    const end = pointAlong(basePts, (i + 1) / segments);
    d += ` Q ${mid.x + mid.px * amplitude * sign} ${mid.y + mid.py * amplitude * sign} ${end.x} ${end.y}`;
  }
  return d;
}
function wavyPath(x1: number, y1: number, x2: number, y2: number): string {
  return wavyPathAlong([
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]);
}

/** Short perpendicular tick marks evenly spaced along the given base path
 *  — the "Κάθετες" style (genogram "cutoff" relationship convention).
 *  Follows curves via arc-length parametrization, same as wavyPathAlong. */
function tickMarksAlongPoints(basePts: { x: number; y: number }[]): string {
  let total = 0;
  for (let i = 1; i < basePts.length; i++)
    total += Math.hypot(
      basePts[i].x - basePts[i - 1].x,
      basePts[i].y - basePts[i - 1].y,
    );
  const half = 6;
  const count = Math.max(1, Math.min(6, Math.round(total / 30)));
  let d = "";
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const p = pointAlong(basePts, t);
    d += ` M ${p.x - p.px * half} ${p.y - p.py * half} L ${p.x + p.px * half} ${p.y + p.py * half}`;
  }
  return d;
}
function tickMarksAlong(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  return tickMarksAlongPoints([
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ]);
}

/** Combines dashed + dotted into one dasharray when both are on — each
 *  stays independently readable rather than one silently overriding the
 *  other. Density (sparse/dense) scales the gaps. */
function combinedDashArray(
  dashed: boolean,
  dotted: boolean,
  density: "sparse" | "dense" | undefined,
  sw: number,
): string | undefined {
  if (!dashed && !dotted) return undefined;
  const unit = Math.max(1.5, sw);
  const gapMul = density === "sparse" ? 3.5 : density === "dense" ? 1.5 : 2.5;
  if (dashed && dotted)
    return `${unit * 3} ${unit * gapMul} 0.1 ${unit * gapMul}`;
  if (dashed) return `${unit * 3} ${unit * gapMul}`;
  return `0.1 ${unit * gapMul}`; // dotted only
}

export function CanvasStage({
  mapId,
  tool,
  setTool,
  onSaveStatusChange,
  onReady,
  liveSync,
  liveOwner = false,
  readOnly = false,
  isActive = true,
  onSelectionChange,
}: Props) {
  const [state, setState] = useState<CanvasState>(() => emptyCanvasState());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Snapshot of positions right before the first align/distribute action
  // on the current selection — lets "Επαναφορά θέσης" undo just that,
  // without touching unrelated undo history. Cleared whenever the
  // selection itself changes.
  const positionSnapshotRef = useRef<Map<
    string,
    { x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number }
  > | null>(null);
  useEffect(() => {
    positionSnapshotRef.current = null;
  }, [selectedIds]);
  // Id of the text object currently in edit mode (double-click). Null when no edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Shape hovered with select tool — shows magnet hints
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null);
  // Set true right before setSelectedIds() in the marquee-completion
  // handler only — read (and reset) the moment selectedIds itself next
  // changes, so it reflects "was THIS selection made via marquee" without
  // flipping back to false on unrelated re-renders (e.g. a live-sync tick
  // touching state.objects while the same marquee selection is still active).
  const marqueeSelectRef = useRef(false);
  const [selectionViaMarquee, setSelectionViaMarquee] = useState(false);
  useEffect(() => {
    setSelectionViaMarquee(marqueeSelectRef.current);
    marqueeSelectRef.current = false;
  }, [selectedIds]);
  useEffect(() => {
    if (!onSelectionChange) return;
    const selectedSet = new Set(selectedIds);
    const selected = state.objects.filter((o) => selectedSet.has(o.id));
    // Auto-include any connector whose both endpoints are in the
    // selection — marquee deliberately excludes connectors themselves
    // (see the marquee hit-test below), so without this, sending a
    // selection elsewhere would silently drop the relationships between
    // the shapes.
    const idSet = new Set(selected.map((o) => o.id));
    const relatedConnectors = state.objects.filter(
      (o) =>
        !idSet.has(o.id) &&
        o.type === "connector" &&
        idSet.has(o.sourceObjectId) &&
        idSet.has(o.targetObjectId),
    );
    onSelectionChange([...selected, ...relatedConnectors], selectionViaMarquee);
  }, [selectedIds, state.objects, onSelectionChange, selectionViaMarquee]);
  useEffect(() => {
    // Exit edit mode if the editing object is no longer the (only) selection.
    if (
      editingId &&
      (selectedIds.length !== 1 || selectedIds[0] !== editingId)
    ) {
      setEditingId(null);
    }
  }, [selectedIds, editingId]);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [recoveryState, setRecoveryState] = useState<CanvasState | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Connector tool: id of the source shape after first click, awaiting target click.
  const [connectorSource, setConnectorSource] = useState<string | null>(null);
  // Reset pending source whenever the user changes tools.
  useEffect(() => {
    if (tool !== "line.connector" && tool !== "line.lightning")
      setConnectorSource(null);
  }, [tool]);

  const undoRef = useRef<CanvasState[]>([]);
  const redoRef = useRef<CanvasState[]>([]);
  const lastHashRef = useRef<string>("");
  // Always-current state for the imperative save API.
  const stateRef = useRef<CanvasState>(state);
  const remoteBaseRef = useRef<CanvasState>(emptyCanvasState());
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Pointer-down tracking — used by live polling to avoid jitter while the
  // local user is mid-drag/draw. We skip the remote merge for any tick where
  // the user has the mouse/finger down; the next tick will pick it up.
  const pointerDownRef = useRef(false);
  useEffect(() => {
    const dn = () => {
      pointerDownRef.current = true;
    };
    const up = () => {
      pointerDownRef.current = false;
    };
    window.addEventListener("pointerdown", dn);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", dn);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // Hydrate — always prefer a fresh server read. The in-memory cache
  // (memory-cache.ts) is only used as an INSTANT placeholder while that
  // fresh read is in flight (avoids a blank canvas flash on fast tab
  // switches) — it is NEVER treated as the final answer, since it can
  // easily go stale (e.g. save → navigate away → navigate back later,
  // within the same page session, without a reload). This was very
  // likely the actual cause of edits appearing to save successfully but
  // reverting when reopening a project: the stale cached value was
  // shown instead of ever re-checking the server.
  useEffect(() => {
    let alive = true;
    setHydrated(false);
    setLoadError(null);
    setRecoveryState(null);
    setSelectedIds([]);
    setEditingId(null);
    undoRef.current = [];
    redoRef.current = [];
    const hydrate = async () => {
      try {
        const pendingRecovery = await mapStore.loadRecovery(mapId, true);
        const loaded = await mapStore.load(mapId);
        if (!alive) return;
        const serverState = loaded ?? emptyCanvasState();
        const serverIsEmpty =
          serverState.objects.length === 0 &&
          Object.keys(serverState.settings).length === 0;
        const recoveryDiffers =
          !!pendingRecovery &&
          hashCanvasState(pendingRecovery) !== hashCanvasState(serverState);
        const autoRecover =
          recoveryDiffers &&
          serverIsEmpty &&
          !!pendingRecovery &&
          (pendingRecovery.objects.length > 0 ||
            Object.keys(pendingRecovery.settings).length > 0);
        const next = autoRecover ? pendingRecovery : serverState;
        if (recoveryDiffers && !autoRecover && pendingRecovery)
          setRecoveryState(pendingRecovery);
        remoteBaseRef.current = serverState;
        setState(next);
        lastHashRef.current = hashCanvasState(serverState);
        memoryCache.set(mapId, next);
        setHydrated(true);
      } catch (error) {
        if (!alive) return;
        setLoadError(error);
        const status = (error as { status?: number })?.status;
        setRecoveryState(
          status === 401 || status === 403
            ? null
            : await mapStore.loadRecovery(mapId),
        );
      }
    };
    void hydrate();
    return () => {
      alive = false;
    };
  }, [mapId, loadAttempt]);

  // Firebase-backed autosave. We compare against the latest remote baseline,
  // not against a single whole-board hash, so an incoming remote change can
  // never accidentally mark an unrelated local edit as already saved.
  useEffect(() => {
    if (!hydrated || readOnly || !isActive) return;
    const baseAtSchedule = remoteBaseRef.current;
    if (!hasCanvasChanges(baseAtSchedule, state)) return;
    mapStore.writeRecovery(mapId, state);
    onSaveStatusChange?.("dirty");
    const snapshot = state;
    const t = setTimeout(async () => {
      onSaveStatusChange?.("saving");
      try {
        await mapStore.save(mapId, snapshot, { baseState: baseAtSchedule });
        remoteBaseRef.current = mergeSavedLocalChanges(
          remoteBaseRef.current,
          baseAtSchedule,
          snapshot,
        );
        lastHashRef.current = hashCanvasState(remoteBaseRef.current);
        memoryCache.set(mapId, stateRef.current);
        onSaveStatusChange?.("saved");
      } catch (e) {
        console.warn("Canvas autosave failed", e);
        onSaveStatusChange?.("dirty");
      }
    }, liveSync ? 300 : 900);
    return () => clearTimeout(t);
  }, [
    state,
    hydrated,
    mapId,
    onSaveStatusChange,
    liveSync,
    isActive,
    readOnly,
  ]);

  // ── Firebase realtime board subscription ──────────────────────────
  // Firestore emits object-level changes. Remote edits update only the
  // affected object/settings, preserving unrelated unsaved local work.
  useEffect(() => {
    if (!hydrated) return;
    return mapStore.subscribe(mapId, {
      onObjectUpsert: (remoteObject) => {
        const baseBefore = remoteBaseRef.current;
        const baseObject = baseBefore.objects.find(
          (object) => object.id === remoteObject.id,
        );
        if (baseObject && sameJson(baseObject, remoteObject)) return;
        remoteBaseRef.current = upsertCanvasObject(baseBefore, remoteObject);
        setState((current) => {
          const currentObject = current.objects.find(
            (object) => object.id === remoteObject.id,
          );
          const locallyDirty = !sameJson(currentObject, baseObject);
          if (locallyDirty) return current;
          const next = upsertCanvasObject(current, remoteObject);
          memoryCache.set(mapId, next);
          return next;
        });
      },
      onObjectRemove: (objectId) => {
        const baseBefore = remoteBaseRef.current;
        const baseObject = baseBefore.objects.find(
          (object) => object.id === objectId,
        );
        if (!baseObject) return;
        remoteBaseRef.current = removeCanvasObject(baseBefore, objectId);
        setState((current) => {
          const currentObject = current.objects.find(
            (object) => object.id === objectId,
          );
          const locallyDirty = !sameJson(currentObject, baseObject);
          if (locallyDirty) return current;
          const next = removeCanvasObject(current, objectId);
          memoryCache.set(mapId, next);
          return next;
        });
      },
      onSettings: (settings) => {
        const baseBefore = remoteBaseRef.current;
        if (sameJson(baseBefore.settings, settings)) return;
        remoteBaseRef.current = { ...baseBefore, settings };
        setState((current) => {
          if (!sameJson(current.settings, baseBefore.settings)) return current;
          const next = { ...current, settings };
          memoryCache.set(mapId, next);
          return next;
        });
      },
      onError: (error) => console.warn("Firebase board sync failed", error),
    });
  }, [hydrated, mapId]);

  // Expose imperative API to the parent (header Save button, AI panel insert).
  useEffect(() => {
    if (!onReady) return;
    onReady({
      save: async () => {
        if (!hydrated || readOnly) return;
        onSaveStatusChange?.("saving");
        try {
          const snapshot = stateRef.current;
          const baseAtSave = remoteBaseRef.current;
          await mapStore.save(mapId, snapshot, { baseState: baseAtSave });
          remoteBaseRef.current = mergeSavedLocalChanges(
            remoteBaseRef.current,
            baseAtSave,
            snapshot,
          );
          lastHashRef.current = hashCanvasState(remoteBaseRef.current);
          onSaveStatusChange?.("saved");
        } catch (e) {
          onSaveStatusChange?.("dirty");
          throw e; // let the caller (manual Save button) show its own error toast
        }
      },
      appendObjects: (objs: CanvasObject[]) => {
        if (!hydrated || readOnly || !objs.length) return;
        setState((prev) => {
          undoRef.current.push(prev);
          if (undoRef.current.length > 50) undoRef.current.shift();
          redoRef.current = [];
          return { ...prev, objects: [...prev.objects, ...objs] };
        });
      },
      replaceState: (next: CanvasState) => {
        if (!hydrated || readOnly) return;
        setState((prev) => {
          undoRef.current.push(prev);
          if (undoRef.current.length > 50) undoRef.current.shift();
          redoRef.current = [];
          return next;
        });
      },
    });
  }, [mapId, onReady, onSaveStatusChange, liveSync, hydrated, readOnly]);

  const commit = useCallback(
    (next: CanvasState | ((s: CanvasState) => CanvasState)) => {
      if (!hydrated || readOnly) return;
      setState((prev) => {
        undoRef.current.push(prev);
        if (undoRef.current.length > 80) undoRef.current.shift();
        redoRef.current = [];
        const result =
          typeof next === "function"
            ? (next as (s: CanvasState) => CanvasState)(prev)
            : next;
        memoryCache.set(mapId, result);
        return result;
      });
    },
    [mapId, hydrated, readOnly],
  );

  const capturePositionSnapshot = () => {
    if (positionSnapshotRef.current) return;
    const map = new Map<
      string,
      {
        x: number;
        y: number;
        x1?: number;
        y1?: number;
        x2?: number;
        y2?: number;
      }
    >();
    for (const o of state.objects) {
      if (!selectedIds.includes(o.id)) continue;
      if (o.type === "line")
        map.set(o.id, {
          x: o.x,
          y: o.y,
          x1: o.x1,
          y1: o.y1,
          x2: o.x2,
          y2: o.y2,
        });
      else if ("x" in o && "y" in o) map.set(o.id, { x: o.x, y: o.y });
    }
    positionSnapshotRef.current = map;
  };
  const resetPositionSnapshot = useCallback(() => {
    const snap = positionSnapshotRef.current;
    if (!snap || snap.size === 0) return;
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        const p = snap.get(o.id);
        if (!p) return o;
        if (o.type === "line" && p.x1 !== undefined) {
          return {
            ...o,
            x: p.x,
            y: p.y,
            x1: p.x1,
            y1: p.y1!,
            x2: p.x2!,
            y2: p.y2!,
          };
        }
        return { ...o, x: p.x, y: p.y } as CanvasObject;
      }),
    }));
    positionSnapshotRef.current = null;
  }, [commit]);

  // Like commit but does NOT push to undo — used for intermediate drag/move
  // frames so undo doesn't replay every pixel of a drag.
  const setStateLive = useCallback(
    (next: (s: CanvasState) => CanvasState) => {
      setState((prev) => {
        const result = next(prev);
        memoryCache.set(mapId, result);
        return result;
      });
    },
    [mapId, hydrated, readOnly],
  );

  const updateObject = useCallback(
    (id: string, patch: Partial<CanvasObject>) => {
      commit((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.id === id
            ? ({ ...o, ...patch, updatedAt: now() } as CanvasObject)
            : o,
        ),
      }));
    },
    [commit],
  );

  // Auto-resize shape/text height when fontSize changes while editing
  const editingObj = state.objects.find((o) => o.id === editingId);
  const editingFontSize =
    editingObj && (editingObj.type === "shape" || editingObj.type === "text")
      ? ((editingObj as { fontSize?: number }).fontSize ?? 14)
      : null;
  useEffect(() => {
    if (!editingId || editingFontSize === null) return;
    const obj = state.objects.find((o) => o.id === editingId);
    if (!obj || (obj.type !== "shape" && obj.type !== "text") || !obj.text)
      return;
    const pad = 10;
    const div = document.createElement("div");
    div.style.cssText = [
      "position:fixed",
      "visibility:hidden",
      "pointer-events:none",
      `width:${obj.width - pad * 2}px`,
      `font-size:${(obj as { fontSize?: number }).fontSize ?? 14}px`,
      `font-weight:${(obj as { bold?: boolean }).bold ? 700 : 400}`,
      `font-style:${(obj as { italic?: boolean }).italic ? "italic" : "normal"}`,
      "line-height:1.3",
      "word-break:break-word",
      "white-space:pre-wrap",
    ].join(";");
    div.textContent = obj.text;
    document.body.appendChild(div);
    const textH = div.scrollHeight;
    document.body.removeChild(div);
    const minH = textH + pad * 2 + 8;
    if (obj.height !== minH) {
      updateObject(editingId, { height: minH } as Partial<CanvasObject>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editingFontSize]);

  const liveMoveMany = useCallback((ids: string[], dx: number, dy: number) => {
    const set = new Set(ids);
    setState((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        if (!set.has(o.id)) return o;
        // Connectors are derived from their endpoints; they auto-follow shapes and
        // are not directly translatable.
        if (o.type === "connector") return o;
        if (o.type === "line") {
          return {
            ...o,
            x: o.x + dx,
            y: o.y + dy,
            x1: o.x1 + dx,
            y1: o.y1 + dy,
            x2: o.x2 + dx,
            y2: o.y2 + dy,
          };
        }
        return { ...o, x: o.x + dx, y: o.y + dy } as CanvasObject;
      }),
    }));
  }, []);

  const finalizeHistory = useCallback(() => {
    setState((s) => {
      undoRef.current.push(s);
      redoRef.current = [];
      return s;
    });
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    commit((s) => ({ ...s, objects: s.objects.filter((o) => !set.has(o.id)) }));
    setSelectedIds([]);
  }, [commit, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    const newIds: string[] = [];
    commit((s) => {
      // Map old id → new id so duplicated connectors can be re-pointed when both ends were duplicated.
      const idMap = new Map<string, string>();
      s.objects
        .filter((o) => set.has(o.id))
        .forEach((o) => idMap.set(o.id, newId()));
      const copies: CanvasObject[] = s.objects
        .filter((o) => set.has(o.id))
        .map((src) => {
          const id = idMap.get(src.id)!;
          if (src.type === "connector") {
            // Only duplicate if both endpoints were duplicated too; otherwise skip.
            const ns = idMap.get(src.sourceObjectId);
            const nt = idMap.get(src.targetObjectId);
            if (!ns || !nt) return null;
            const copy: ConnectorObject = {
              ...src,
              id,
              zIndex: now(),
              sourceObjectId: ns,
              targetObjectId: nt,
            };
            newIds.push(copy.id);
            return copy;
          }
          const copy = {
            ...src,
            id,
            x: src.x + 16,
            y: src.y + 16,
            zIndex: now(),
          } as CanvasObject;
          if (copy.type === "line") {
            (copy as LineObject).x1 += 16;
            (copy as LineObject).y1 += 16;
            (copy as LineObject).x2 += 16;
            (copy as LineObject).y2 += 16;
          }
          newIds.push(copy.id);
          return copy;
        })
        .filter((x): x is CanvasObject => x !== null);
      return { ...s, objects: [...s.objects, ...copies] };
    });
    setTimeout(() => setSelectedIds(newIds), 0);
  }, [commit, selectedIds]);

  const resizeSelected = useCallback(
    (factor: number) => {
      if (selectedIds.length === 0) return;
      const set = new Set(selectedIds);
      commit((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (!set.has(o.id)) return o;
          if (o.type === "connector") return o;
          return {
            ...o,
            width: Math.max(8, o.width * factor),
            height: Math.max(8, o.height * factor),
          } as CanvasObject;
        }),
      }));
    },
    [commit, selectedIds],
  );

  // ── Phase 4: grouping, layering, lock, copy-style ─────────────────
  // Style clipboard for copy-style / paste-style.
  const styleClipRef = useRef<Partial<CanvasObject> | null>(null);

  const STYLE_KEYS: (keyof CanvasObject)[] = [
    "fill",
    "stroke",
    "strokeWidth",
    "textColor",
    "opacity",
  ] as (keyof CanvasObject)[];

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const lockedIds = selectedIds.filter(
      (id) => state.objects.find((o) => o.id === id)?.locked,
    );
    const unlockedIds = selectedIds.filter((id) => !lockedIds.includes(id));

    if (lockedIds.length > 0 && unlockedIds.length >= 2) {
      // Group everything that isn't locked right away — the locked ones
      // stay out of the group unless the user explicitly chooses to
      // unlock and include them via the toast action below.
      const gid = `g_${newId()}`;
      const set = new Set(unlockedIds);
      commit((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          set.has(o.id)
            ? ({ ...o, groupId: gid, updatedAt: now() } as CanvasObject)
            : o,
        ),
      }));
      toast(
        lockedIds.length === 1
          ? "1 κλειδωμένο στοιχείο δεν μπήκε στην ομάδα."
          : `${lockedIds.length} κλειδωμένα στοιχεία δεν μπήκαν στην ομάδα.`,
        {
          action: {
            label: "Ξεκλείδωμα & προσθήκη",
            onClick: () => {
              const allSet = new Set(selectedIds);
              commit((s) => ({
                ...s,
                objects: s.objects.map((o) =>
                  allSet.has(o.id)
                    ? ({
                        ...o,
                        locked: false,
                        groupId: gid,
                        updatedAt: now(),
                      } as CanvasObject)
                    : o,
                ),
              }));
              setSelectedIds(selectedIds);
            },
          },
        },
      );
      return;
    }
    if (lockedIds.length > 0) {
      // Not enough unlocked items left to form a group on their own.
      toast.error(
        "Τα περισσότερα επιλεγμένα στοιχεία είναι κλειδωμένα — ξεκλειδώστε τα πρώτα.",
      );
      return;
    }
    const gid = `g_${newId()}`;
    const set = new Set(selectedIds);
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) =>
        set.has(o.id)
          ? ({ ...o, groupId: gid, updatedAt: now() } as CanvasObject)
          : o,
      ),
    }));
  }, [commit, selectedIds, state.objects]);

  const ungroupSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) =>
        set.has(o.id)
          ? ({ ...o, groupId: null, updatedAt: now() } as CanvasObject)
          : o,
      ),
    }));
  }, [commit, selectedIds]);

  const bringToFront = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    const top = Math.max(0, ...state.objects.map((o) => o.zIndex));
    commit((s) => ({
      ...s,
      objects: s.objects.map((o, i) =>
        set.has(o.id) ? ({ ...o, zIndex: top + 1 + i } as CanvasObject) : o,
      ),
    }));
  }, [commit, selectedIds, state.objects]);

  const sendToBack = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    const bot = Math.min(0, ...state.objects.map((o) => o.zIndex));
    commit((s) => ({
      ...s,
      objects: s.objects.map((o, i) =>
        set.has(o.id) ? ({ ...o, zIndex: bot - 1 - i } as CanvasObject) : o,
      ),
    }));
  }, [commit, selectedIds, state.objects]);

  const lockToggle = useCallback(() => {
    if (selectedIds.length === 0) return;
    const set = new Set(selectedIds);
    const anyUnlocked = state.objects.some((o) => set.has(o.id) && !o.locked);
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) =>
        set.has(o.id) ? ({ ...o, locked: anyUnlocked } as CanvasObject) : o,
      ),
    }));
  }, [commit, selectedIds, state.objects]);

  const copyStyle = useCallback(() => {
    const o = state.objects.find((x) => selectedIds.includes(x.id));
    if (!o) return;
    const clip: Partial<CanvasObject> = {};
    STYLE_KEYS.forEach((k) => {
      const v = (o as unknown as Record<string, unknown>)[k as string];
      if (v !== undefined) (clip as Record<string, unknown>)[k as string] = v;
    });
    styleClipRef.current = clip;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, state.objects]);

  const pasteStyle = useCallback(() => {
    const clip = styleClipRef.current;
    if (!clip || selectedIds.length === 0) return;
    selectedIds.forEach((id) => updateObject(id, clip));
  }, [selectedIds, updateObject]);

  // Distribute selected objects evenly along an axis.
  const distributeSelected = useCallback(
    (axis: "h" | "v") => {
      if (selectedIds.length < 3) return;
      capturePositionSnapshot();
      commit((s) => {
        const sel = s.objects.filter((o) => selectedIds.includes(o.id));
        const boxes = sel.map((o) => ({ id: o.id, b: bbox(o) }));
        boxes.sort((a, b) => (axis === "h" ? a.b.x - b.b.x : a.b.y - b.b.y));
        const first = boxes[0].b;
        const last = boxes[boxes.length - 1].b;
        const span =
          axis === "h" ? last.x + last.w - first.x : last.y + last.h - first.y;
        const sizes = boxes.reduce(
          (a, c) => a + (axis === "h" ? c.b.w : c.b.h),
          0,
        );
        const gap = (span - sizes) / (boxes.length - 1);
        let cursor = axis === "h" ? first.x : first.y;
        const moves = new Map<string, { dx: number; dy: number }>();
        for (const { id, b } of boxes) {
          if (axis === "h") {
            moves.set(id, { dx: cursor - b.x, dy: 0 });
            cursor += b.w + gap;
          } else {
            moves.set(id, { dx: 0, dy: cursor - b.y });
            cursor += b.h + gap;
          }
        }
        return {
          ...s,
          objects: s.objects.map((o) => {
            const m = moves.get(o.id);
            if (!m) return o;
            if (o.type === "line") {
              return {
                ...o,
                x: o.x + m.dx,
                y: o.y + m.dy,
                x1: o.x1 + m.dx,
                y1: o.y1 + m.dy,
                x2: o.x2 + m.dx,
                y2: o.y2 + m.dy,
              };
            }
            return { ...o, x: o.x + m.dx, y: o.y + m.dy } as CanvasObject;
          }),
        };
      });
    },
    [commit, selectedIds],
  );

  /** Distribute with an EXACT gap value (not "fill the existing span
   *  evenly") — powers the gap slider in the properties panel. Works
   *  from 2 objects since it doesn't need an existing span to divide up. */
  const distributeWithGap = useCallback(
    (axis: "h" | "v", gapPx: number) => {
      if (selectedIds.length < 2) return;
      capturePositionSnapshot();
      commit((s) => {
        const sel = s.objects.filter((o) => selectedIds.includes(o.id));
        const boxes = sel.map((o) => ({ id: o.id, b: bbox(o) }));
        boxes.sort((a, b) => (axis === "h" ? a.b.x - b.b.x : a.b.y - b.b.y));
        let cursor = axis === "h" ? boxes[0].b.x : boxes[0].b.y;
        const moves = new Map<string, { dx: number; dy: number }>();
        for (const { id, b } of boxes) {
          if (axis === "h") {
            moves.set(id, { dx: cursor - b.x, dy: 0 });
            cursor += b.w + gapPx;
          } else {
            moves.set(id, { dx: 0, dy: cursor - b.y });
            cursor += b.h + gapPx;
          }
        }
        return {
          ...s,
          objects: s.objects.map((o) => {
            const m = moves.get(o.id);
            if (!m) return o;
            if (o.type === "line") {
              return {
                ...o,
                x: o.x + m.dx,
                y: o.y + m.dy,
                x1: o.x1 + m.dx,
                y1: o.y1 + m.dy,
                x2: o.x2 + m.dx,
                y2: o.y2 + m.dy,
              };
            }
            return { ...o, x: o.x + m.dx, y: o.y + m.dy } as CanvasObject;
          }),
        };
      });
    },
    [commit, selectedIds],
  );

  // Connector tool: handle a click on an object.
  const handleConnectorClickOnObject = useCallback(
    (id: string) => {
      const target = state.objects.find((o) => o.id === id);
      if (!target || !isConnectable(target)) return;
      if (!connectorSource) {
        setConnectorSource(id);
        return;
      }
      if (connectorSource === id) {
        setConnectorSource(null);
        return;
      }
      const source = state.objects.find((o) => o.id === connectorSource);
      if (!source) {
        setConnectorSource(id);
        return;
      }
      const { sourceMagnet, targetMagnet } = pickMagnetPair(source, target);
      const c = makeConnector(source.id, target.id, sourceMagnet, targetMagnet);
      if (tool === "line.lightning") {
        c.connectorStyle = "lightning";
        c.arrowEnd = false;
      }
      commit((s) => ({ ...s, objects: [...s.objects, c] }));
      setSelectedIds([c.id]);
      setConnectorSource(null);
      setTool("select");
    },
    [commit, connectorSource, setTool, state.objects, tool],
  );

  const undo = useCallback(() => {
    if (!hydrated || readOnly) return;
    const prev = undoRef.current.pop();
    if (!prev) return;
    setState((cur) => {
      redoRef.current.push(cur);
      return prev;
    });
  }, [hydrated, readOnly]);
  const redo = useCallback(() => {
    if (!hydrated || readOnly) return;
    const next = redoRef.current.pop();
    if (!next) return;
    setState((cur) => {
      undoRef.current.push(cur);
      return next;
    });
  }, [hydrated, readOnly]);

  useCanvasShortcuts(
    {
      onDelete: deleteSelected,
      onDuplicate: duplicateSelected,
      onUndo: undo,
      onRedo: redo,
      onResize: resizeSelected,
      onTool: (t) => {
        if (t === "select") setTool("select");
        else if (t === "hand") setTool("hand");
        else if (t === "text") setTool("text");
        else if (t === "line") setTool("line.straight");
        else if (t === "arrow") setTool("line.arrow-end");
      },
      onEscape: () => {
        if (editingId) {
          setEditingId(null);
          return;
        }
        setSelectedIds([]);
        setTool("select");
      },
      onGroup: groupSelected,
      onUngroup: ungroupSelected,
      onBringToFront: bringToFront,
      onSendToBack: sendToBack,
      onCopyStyle: copyStyle,
      onPasteStyle: pasteStyle,
      onLockToggle: lockToggle,
    },
    selectedIds.length > 0,
    isActive && hydrated && !readOnly,
  );

  // ── interaction ─────────────────────────────────────────────────────
  const viewport = state.viewport;
  const screenToWorld = (sx: number, sy: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (sx - rect.left - viewport.x) / viewport.zoom,
      y: (sy - rect.top - viewport.y) / viewport.zoom,
    };
  };

  const dragRef = useRef<
    | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
    | { kind: "move"; ids: string[]; lastX: number; lastY: number }
    | {
        kind: "create-shape";
        tempId: string;
        startX: number;
        startY: number;
        shape: ShapeKind;
      }
    | { kind: "create-line"; tempId: string }
    | { kind: "create-frame"; tempId: string; startX: number; startY: number }
    | {
        kind: "draw";
        tempId: string;
        startX: number;
        startY: number;
        pts: Array<{ x: number; y: number }>;
      }
    | { kind: "marquee"; sx: number; sy: number }
    | {
        kind: "resize";
        id: string;
        sx: number;
        sy: number;
        origW: number;
        origH: number;
      }
    | {
        kind: "rotate";
        id: string;
        cx: number;
        cy: number;
        startAngle: number;
        origRot: number;
        origX1?: number;
        origY1?: number;
        origX2?: number;
        origY2?: number;
      }
    // Stage 6.1: drag a connector endpoint to a different magnet / shape.
    | {
        kind: "endpoint";
        connectorId: string;
        which: "source" | "target";
        origObjectId: string;
        origMagnet: MagnetSide;
      }
    // Stage 6.1: drag the single curve-control handle on a curved line/connector.
    | { kind: "curve-control"; id: string }
    | { kind: "line-ep"; id: string; which: "p1" | "p2" }
    // Stage 6.1: drag an existing bend-point handle.
    | { kind: "bend"; id: string; index: number }
    | null
  >(null);

  // Stage 6.1: live candidate magnet shown while dragging an endpoint handle.
  const [candidateMagnet, setCandidateMagnet] = useState<{
    objectId: string;
    magnet: MagnetSide;
  } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(e.clientX, e.clientY, factor);
    } else {
      setState((s) => ({
        ...s,
        viewport: {
          ...s.viewport,
          x: s.viewport.x - e.deltaX,
          y: s.viewport.y - e.deltaY,
        },
      }));
    }
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    setState((s) => {
      const newZoom = Math.max(0.25, Math.min(4, s.viewport.zoom * factor));
      const rect = containerRef.current!.getBoundingClientRect();
      const px = cx - rect.left,
        py = cy - rect.top;
      const wx = (px - s.viewport.x) / s.viewport.zoom;
      const wy = (py - s.viewport.y) / s.viewport.zoom;
      return {
        ...s,
        viewport: { x: px - wx * newZoom, y: py - wy * newZoom, zoom: newZoom },
      };
    });
  };

  const fit = () =>
    setState((s) => ({ ...s, viewport: { x: 0, y: 0, zoom: 1 } }));

  const shapeKindFromTool = (t: ToolId): ShapeKind | null => {
    if (!t.startsWith("shape.")) return null;
    return t.slice("shape.".length) as ShapeKind;
  };
  const symbolKindFromTool = (t: ToolId): SymbolKind | null => {
    if (!t.startsWith("symbol.")) return null;
    return t.slice("symbol.".length) as SymbolKind;
  };
  const lineConfigFromTool = (
    t: ToolId,
  ): {
    kind: "straight" | "dashed" | "curved";
    arrowStart: boolean;
    arrowEnd: boolean;
  } | null => {
    switch (t) {
      case "line.straight":
        return { kind: "straight", arrowStart: false, arrowEnd: false };
      case "line.dashed":
        return { kind: "dashed", arrowStart: false, arrowEnd: false };
      case "line.arrow-end":
        return { kind: "straight", arrowStart: false, arrowEnd: true };
      case "line.arrow-start":
        return { kind: "straight", arrowStart: true, arrowEnd: false };
      case "line.arrow-both":
        return { kind: "straight", arrowStart: true, arrowEnd: true };
      case "line.curved":
        return { kind: "curved", arrowStart: false, arrowEnd: true };
      // "line.connector" is handled separately via the magnet click-to-link flow.
      default:
        return null;
    }
  };

  const onPointerDownBackground = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = screenToWorld(e.clientX, e.clientY);

    if (tool === "hand") {
      dragRef.current = {
        kind: "pan",
        sx: e.clientX,
        sy: e.clientY,
        ox: viewport.x,
        oy: viewport.y,
      };
      return;
    }
    // Block all editing tools when readOnly
    if (readOnly) {
      if (tool === "select") {
        setSelectedIds([]);
        return;
      }
      return;
    }
    if (tool === "select") {
      setSelectedIds([]);
      return;
    }
    if (tool === "line.connector" || tool === "line.lightning") {
      // Background click during connector flow cancels pending source.
      setConnectorSource(null);
      return;
    }
    if (tool === "marquee") {
      setSelectedIds([]);
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      dragRef.current = { kind: "marquee", sx: p.x, sy: p.y };
      return;
    }
    if (tool.startsWith("genogram.")) {
      const objects = createGenogramObjects(tool as GenogramTool, p.x, p.y);
      commit((s) => ({ ...s, objects: [...s.objects, ...objects] }));
      setSelectedIds(objects.map((o) => o.id));
      setTool("select");
      return;
    }
    if (tool === "text") {
      const o = makeText(p.x, p.y);
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      setEditingId(o.id);
      setTool("select");
      return;
    }
    if (tool === "sticky") {
      const o = makeStickyNote(p.x, p.y);
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      setTool("select");
      return;
    }
    if (tool === "frame") {
      const o = makeFrame(p.x, p.y, 1, 1);
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      dragRef.current = {
        kind: "create-frame",
        tempId: o.id,
        startX: p.x,
        startY: p.y,
      };
      return;
    }
    const sk = shapeKindFromTool(tool);
    if (sk) {
      const o = makeShape(sk, p.x, p.y, 1, 1);
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      dragRef.current = {
        kind: "create-shape",
        tempId: o.id,
        startX: p.x,
        startY: p.y,
        shape: sk,
      };
      return;
    }
    const lc = lineConfigFromTool(tool);
    if (lc) {
      const o = makeLine(
        lc.kind,
        p.x,
        p.y,
        p.x,
        p.y,
        lc.arrowStart,
        lc.arrowEnd,
      );
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      dragRef.current = { kind: "create-line", tempId: o.id };
      return;
    }
    const sy = symbolKindFromTool(tool);
    if (sy) {
      const o = makeSymbol(sy, p.x - 32, p.y - 32);
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      setTool("select");
      return;
    }
    if (tool === "pencil") {
      const o = makeDrawing(p.x, p.y, "#0F172A");
      commit((s) => ({ ...s, objects: [...s.objects, o] }));
      setSelectedIds([o.id]);
      dragRef.current = {
        kind: "draw",
        tempId: o.id,
        startX: p.x,
        startY: p.y,
        pts: [{ x: 0, y: 0 }],
      };
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setStateLive((s) => ({
        ...s,
        viewport: {
          ...s.viewport,
          x: d.ox + (e.clientX - d.sx),
          y: d.oy + (e.clientY - d.sy),
        },
      }));
      return;
    }
    const p = screenToWorld(e.clientX, e.clientY);
    if (d.kind === "move") {
      const dx = (e.clientX - d.lastX) / viewport.zoom;
      const dy = (e.clientY - d.lastY) / viewport.zoom;
      liveMoveMany(d.ids, dx, dy);
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      return;
    }
    if (d.kind === "marquee") {
      const x = Math.min(p.x, d.sx),
        y = Math.min(p.y, d.sy);
      const w = Math.abs(p.x - d.sx),
        h = Math.abs(p.y - d.sy);
      setMarquee({ x, y, w, h });
      return;
    }
    if (d.kind === "create-shape" || d.kind === "create-frame") {
      const w = Math.max(4, Math.abs(p.x - d.startX));
      const h = Math.max(4, Math.abs(p.y - d.startY));
      const x = Math.min(p.x, d.startX);
      const y = Math.min(p.y, d.startY);
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.id === d.tempId
            ? ({ ...o, x, y, width: w, height: h } as CanvasObject)
            : o,
        ),
      }));
      return;
    }
    if (d.kind === "create-line") {
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.tempId || o.type !== "line") return o;
          return {
            ...o,
            x2: p.x,
            y2: p.y,
            x: Math.min(o.x1, p.x),
            y: Math.min(o.y1, p.y),
            width: Math.abs(p.x - o.x1),
            height: Math.abs(p.y - o.y1),
          };
        }),
      }));
      return;
    }
    if (d.kind === "draw") {
      d.pts.push({ x: p.x - d.startX, y: p.y - d.startY });
      const pts = d.pts.slice();
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.tempId || o.type !== "drawing") return o;
          const xs = pts.map((q) => q.x),
            ys = pts.map((q) => q.y);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          return {
            ...o,
            points: pts,
            width: Math.max(1, w),
            height: Math.max(1, h),
          };
        }),
      }));
      return;
    }
    if (d.kind === "resize") {
      const rect = containerRef.current!.getBoundingClientRect();
      const dx = (e.clientX - d.sx) / viewport.zoom;
      const dy = (e.clientY - d.sy) / viewport.zoom;
      void rect;
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.id === d.id
            ? ({
                ...o,
                width: Math.max(8, d.origW + dx),
                height: Math.max(8, d.origH + dy),
              } as CanvasObject)
            : o,
        ),
      }));
      return;
    }
    if (d.kind === "rotate") {
      const rect = containerRef.current!.getBoundingClientRect();
      const px = (e.clientX - rect.left - viewport.x) / viewport.zoom;
      const py = (e.clientY - rect.top - viewport.y) / viewport.zoom;
      const ang = (Math.atan2(py - d.cy, px - d.cx) * 180) / Math.PI;
      const delta = ang - d.startAngle;
      let rot = (d.origRot + delta) % 360;
      if (rot < 0) rot += 360;
      // Snap to 15° if Shift is held
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.id) return o;
          // Lines: rotate original endpoints around midpoint — use stored originals to avoid drift
          if (o.type === "line" && d.origX1 !== undefined) {
            const rad = (rot - d.origRot) * (Math.PI / 180);
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const rx1 =
              d.cx + (d.origX1 - d.cx) * cos - (d.origY1! - d.cy) * sin;
            const ry1 =
              d.cy + (d.origX1 - d.cx) * sin + (d.origY1! - d.cy) * cos;
            const rx2 =
              d.cx + (d.origX2! - d.cx) * cos - (d.origY2! - d.cy) * sin;
            const ry2 =
              d.cy + (d.origX2! - d.cx) * sin + (d.origY2! - d.cy) * cos;
            return { ...o, x1: rx1, y1: ry1, x2: rx2, y2: ry2 } as CanvasObject;
          }
          return { ...o, rotation: rot } as CanvasObject;
        }),
      }));
      return;
    }
    // Stage 6.1: dragging a connector endpoint — find nearest magnet across all
    // connectable shapes and surface it as a visual candidate.
    if (d.kind === "endpoint") {
      const SNAP_RADIUS = 80; // world px
      let best: { objectId: string; magnet: MagnetSide; dist: number } | null =
        null;
      for (const obj of state.objects) {
        if (!isConnectable(obj)) continue;
        if (obj.id === (d.which === "source" ? "" : "")) continue;
        for (const side of MAGNET_SIDES) {
          const mp = magnetPoint(obj, side);
          const dist = Math.hypot(mp.x - p.x, mp.y - p.y);
          if (dist < SNAP_RADIUS && (!best || dist < best.dist)) {
            best = { objectId: obj.id, magnet: side, dist };
          }
        }
      }
      setCandidateMagnet(
        best ? { objectId: best.objectId, magnet: best.magnet } : null,
      );
      return;
    }
    if (d.kind === "curve-control") {
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.id === d.id
            ? ({ ...o, curveControl: { x: p.x, y: p.y } } as CanvasObject)
            : o,
        ),
      }));
      return;
    }
    if (d.kind === "line-ep") {
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.id || o.type !== "line") return o;
          if (d.which === "p1")
            return { ...o, x1: p.x, y1: p.y } as CanvasObject;
          return { ...o, x2: p.x, y2: p.y } as CanvasObject;
        }),
      }));
      return;
    }
    if (d.kind === "bend") {
      setStateLive((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.id) return o;
          if (o.type !== "line" && o.type !== "connector") return o;
          const next = moveBendPoint(o.bendPoints, d.index, { x: p.x, y: p.y });
          return { ...o, bendPoints: next } as CanvasObject;
        }),
      }));
      return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* */
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === "marquee" && marquee) {
      const m = marquee;
      const hits = state.objects
        .filter((o) => {
          if (o.type === "connector") return false; // connectors auto-follow shapes
          const r = bbox(o);
          return (
            r.x < m.x + m.w &&
            r.x + r.w > m.x &&
            r.y < m.y + m.h &&
            r.y + r.h > m.y
          );
        })
        .map((o) => o.id);
      setSelectedIds(hits);
      marqueeSelectRef.current = true;
      setMarquee(null);
      setTool("select");
      return;
    }
    if (d.kind === "create-shape") {
      const created = state.objects.find((o) => o.id === d.tempId);
      // Anything under ~6px means the user just clicked without meaningfully
      // dragging to size it — apply a sensible default instead of leaving
      // a near-invisible sliver they'd have to hunt for to resize.
      if (created && created.width <= 6 && created.height <= 6) {
        const isSquareish = d.shape === "square" || d.shape === "circle";
        const defaultW = isSquareish ? 100 : 120;
        const defaultH = isSquareish ? 100 : 80;
        setState((s) => ({
          ...s,
          objects: s.objects.map((o) =>
            o.id === d.tempId
              ? {
                  ...o,
                  x: d.startX - defaultW / 2,
                  y: d.startY - defaultH / 2,
                  width: defaultW,
                  height: defaultH,
                }
              : o,
          ),
        }));
      }
      finalizeHistory();
      setTool("select");
      return;
    }
    if (
      d.kind === "create-line" ||
      d.kind === "create-frame" ||
      d.kind === "draw"
    ) {
      finalizeHistory();
      setTool("select");
    }
    if (d.kind === "move" || d.kind === "resize" || d.kind === "rotate") {
      // After a transform, recompute nearest magnet pair for every connector
      // touching one of the affected objects, so endpoints "snap" to the closest side.
      const affected = new Set(d.kind === "move" ? d.ids : [d.id]);
      setState((s) => {
        const byId = new Map(s.objects.map((o) => [o.id, o] as const));
        return {
          ...s,
          objects: s.objects.map((o) => {
            if (o.type === "connector") {
              if (
                !affected.has(o.sourceObjectId) &&
                !affected.has(o.targetObjectId)
              )
                return o;
              const src = byId.get(o.sourceObjectId),
                tgt = byId.get(o.targetObjectId);
              if (!src || !tgt) return o;
              const pair = pickMagnetPair(src, tgt);
              return {
                ...o,
                sourceMagnet: pair.sourceMagnet,
                targetMagnet: pair.targetMagnet,
              };
            }
            // Bump updatedAt on whatever was actually dragged, so live-sync
            // merge knows this is a fresh local edit and won't let a poll
            // that lands right after silently revert it back.
            if (affected.has(o.id))
              return { ...o, updatedAt: now() } as CanvasObject;
            return o;
          }),
        };
      });
      finalizeHistory();
    }
    // Stage 6.1: commit / revert endpoint drag.
    if (d.kind === "endpoint") {
      const cand = candidateMagnet;
      setCandidateMagnet(null);
      setState((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (o.id !== d.connectorId || o.type !== "connector") return o;
          // No valid candidate → revert by leaving the connector untouched.
          if (!cand) return o;
          if (d.which === "source") {
            return {
              ...o,
              sourceObjectId: cand.objectId,
              sourceMagnet: cand.magnet,
              magnetLocked: true,
              updatedAt: now(),
            } as CanvasObject;
          }
          return {
            ...o,
            targetObjectId: cand.objectId,
            targetMagnet: cand.magnet,
            magnetLocked: true,
            updatedAt: now(),
          } as CanvasObject;
        }),
      }));
      finalizeHistory();
    }
    if (
      d.kind === "curve-control" ||
      d.kind === "bend" ||
      d.kind === "line-ep"
    ) {
      setState((s) => ({
        ...s,
        objects: s.objects.map((o) =>
          o.id === d.id ? ({ ...o, updatedAt: now() } as CanvasObject) : o,
        ),
      }));
      finalizeHistory();
    }
  };

  const selectedObjects = useMemo(
    () => state.objects.filter((o) => selectedIds.includes(o.id)),
    [state.objects, selectedIds],
  );
  const primarySelected = selectedObjects[0] ?? null;

  // Map for fast lookup of connector endpoints and bbox math.
  const byId = useMemo(() => {
    const m = new Map<string, CanvasObject>();
    state.objects.forEach((o) => m.set(o.id, o));
    return m;
  }, [state.objects]);

  // Show magnet points on connectable shapes while the connector tool is active,
  // and highlight pending source.
  const connectorMode = tool === "line.connector" || tool === "line.lightning";

  const cursor =
    tool === "hand"
      ? "grab"
      : tool === "marquee"
        ? "crosshair"
        : tool === "pencil"
          ? "crosshair"
          : connectorMode
            ? "crosshair"
            : tool.startsWith("shape.") ||
                tool.startsWith("line.") ||
                tool === "text" ||
                tool === "sticky" ||
                tool === "frame" ||
                tool.startsWith("symbol.")
              ? "crosshair"
              : "default";

  const startResize = (
    e: React.PointerEvent,
    id: string,
    origW: number,
    origH: number,
  ) => {
    e.stopPropagation();
    dragRef.current = {
      kind: "resize",
      id,
      sx: e.clientX,
      sy: e.clientY,
      origW,
      origH,
    };
  };
  const startRotate = (
    e: React.PointerEvent,
    id: string,
    cx: number,
    cy: number,
    origRot: number,
    lineEndpoints?: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    e.stopPropagation();
    const rect = containerRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left - viewport.x) / viewport.zoom;
    const py = (e.clientY - rect.top - viewport.y) / viewport.zoom;
    const startAngle = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
    dragRef.current = {
      kind: "rotate",
      id,
      cx,
      cy,
      startAngle,
      origRot,
      ...(lineEndpoints
        ? {
            origX1: lineEndpoints.x1,
            origY1: lineEndpoints.y1,
            origX2: lineEndpoints.x2,
            origY2: lineEndpoints.y2,
          }
        : {}),
    };
  };

  return (
    <div
      className="flex-1 relative canvas-dotgrid overflow-hidden w-full h-full"
      ref={containerRef}
    >
      {hydrated && recoveryState && !readOnly && (
        <div className="absolute top-3 left-3 z-50 rounded-lg border bg-card p-3 shadow flex items-center gap-3 text-sm">
          Υπάρχουν τοπικές αλλαγές που δεν αποθηκεύτηκαν.
          <button
            className="underline"
            onClick={() => {
              commit(recoveryState);
              setRecoveryState(null);
            }}
          >
            Ανάκτηση
          </button>
          <button
            className="underline"
            onClick={() => {
              mapStore.writeRecovery(mapId, state, false);
              setRecoveryState(null);
            }}
          >
            Απόρριψη
          </button>
        </div>
      )}
      {!hydrated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 p-6">
          <div className="max-w-md rounded-xl border bg-card p-5 text-center shadow-lg">
            <div className="font-semibold">
              {loadError
                ? "Δεν ήταν δυνατή η φόρτωση του πίνακα"
                : "Φόρτωση πίνακα…"}
            </div>
            {!!loadError && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Οι αλλαγές είναι κλειδωμένες μέχρι να φορτωθούν με ασφάλεια τα
                  δεδομένα.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    className="rounded-md border px-3 py-2 text-sm"
                    onClick={() => setLoadAttempt((n) => n + 1)}
                  >
                    Επανάληψη
                  </button>
                  {recoveryState && (
                    <button
                      className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                      onClick={() => {
                        remoteBaseRef.current = recoveryState;
                        setState(recoveryState);
                        lastHashRef.current = hashCanvasState(recoveryState);
                        setLoadError(null);
                        setHydrated(true);
                      }}
                    >
                      Άνοιγμα τοπικού αντιγράφου
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <svg
        id="ums-canvas-svg"
        data-map-id={mapId}
        className="absolute inset-0 w-full h-full"
        style={{
          cursor,
          touchAction: "none",
          pointerEvents: hydrated ? "auto" : "none",
        }}
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <defs>
          <marker
            id="ums-arrow-end"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <marker
            id="ums-arrow-start"
            viewBox="0 0 10 10"
            refX="1"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 10 0 L 0 5 L 10 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g
          transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
        >
          {[...state.objects]
            .sort((a, b) => a.zIndex - b.zIndex)
            .map((o) => (
              <ObjectNode
                key={o.id}
                o={o}
                byId={byId}
                selected={selectedIds.includes(o.id)}
                interactive={tool === "select" && !readOnly}
                showRelationshipValues={!!state.settings.showRelationshipValues}
                showInfoBadges={!!state.settings.showInfoBadges}
                showRelationshipLabels={
                  state.settings.showRelationshipLabels !== false
                }
                onSelect={(additive) => {
                  if (connectorMode) {
                    handleConnectorClickOnObject(o.id);
                    return;
                  }
                  if (tool !== "select") return;
                  // Expand group: selecting any member selects every sibling.
                  const groupSiblings = o.groupId
                    ? state.objects
                        .filter((x) => x.groupId === o.groupId)
                        .map((x) => x.id)
                    : [o.id];
                  setSelectedIds((cur) => {
                    if (additive) {
                      const allIn = groupSiblings.every((id) =>
                        cur.includes(id),
                      );
                      return allIn
                        ? cur.filter((id) => !groupSiblings.includes(id))
                        : Array.from(new Set([...cur, ...groupSiblings]));
                    }
                    // Clicking (not shift-clicking) an object that's already
                    // part of a larger multi-selection keeps that whole
                    // selection intact — the user is very likely about to
                    // drag the group together, not pick just this one.
                    if (
                      cur.length > 1 &&
                      groupSiblings.every((id) => cur.includes(id))
                    ) {
                      return cur;
                    }
                    return groupSiblings;
                  });
                }}
                onMoveStart={(e, additive) => {
                  if (readOnly) {
                    e.stopPropagation();
                    return;
                  }
                  if (connectorMode) {
                    e.stopPropagation();
                    return;
                  }
                  if (tool !== "select") return;
                  if (o.type === "connector") {
                    e.stopPropagation();
                    return;
                  } // connectors auto-follow
                  if (o.locked) {
                    e.stopPropagation();
                    return;
                  } // locked objects don't drag
                  const groupSiblings = o.groupId
                    ? state.objects
                        .filter((x) => x.groupId === o.groupId)
                        .map((x) => x.id)
                    : [o.id];
                  let ids: string[];
                  setSelectedIds((cur) => {
                    const targetSet = new Set(groupSiblings);
                    if (groupSiblings.every((id) => cur.includes(id))) {
                      ids = cur;
                      return cur;
                    }
                    if (additive) {
                      ids = Array.from(new Set([...cur, ...groupSiblings]));
                      return ids;
                    }
                    ids = Array.from(targetSet);
                    return ids;
                  });
                  requestAnimationFrame(() => {
                    const cur = selectedIdsRef.current;
                    const list = groupSiblings.every((id) => cur.includes(id))
                      ? cur
                      : Array.from(new Set([...groupSiblings, ...cur]));
                    // Strip locked ids from the drag set so they stay put.
                    const lockedSet = new Set(
                      state.objects.filter((x) => x.locked).map((x) => x.id),
                    );
                    const movable = list.filter((id) => !lockedSet.has(id));
                    dragRef.current = {
                      kind: "move",
                      ids: movable,
                      lastX: e.clientX,
                      lastY: e.clientY,
                    };
                  });
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  e.stopPropagation();
                }}
                onTextEdit={(text, richText) =>
                  updateObject(o.id, {
                    text,
                    richText,
                  } as Partial<CanvasObject>)
                }
                onLabelEdit={(label, richText) =>
                  updateObject(o.id, {
                    label,
                    labelRichText: richText,
                  } as Partial<CanvasObject>)
                }
                editing={editingId === o.id}
                onStartEdit={() => {
                  setSelectedIds([o.id]);
                  setEditingId(o.id);
                }}
                onHoverChange={(h) => setHoverShapeId(h ? o.id : null)}
                onResize={(newH) =>
                  updateObject(o.id, { height: newH } as Partial<CanvasObject>)
                }
                onInfoClick={() => setSelectedIds([o.id])}
                obstacles={state.objects
                  .filter(
                    (obj) =>
                      obj.id !== o.id &&
                      (obj.type === "shape" || obj.type === "frame") &&
                      !obj.locked,
                  )
                  .map((obj) => ({
                    x: obj.x,
                    y: obj.y,
                    w: obj.width,
                    h: obj.height,
                  }))}
              />
            ))}
          {/* Magnet hints while connector tool active */}
          {connectorMode &&
            state.objects.filter(isConnectable).map((o) =>
              MAGNET_SIDES.map((side) => {
                const p = magnetPoint(o, side);
                const isSource = connectorSource === o.id;
                return (
                  <circle
                    key={`${o.id}-${side}`}
                    cx={p.x}
                    cy={p.y}
                    r={5}
                    fill={isSource ? "#3B82F6" : "#FFFFFF"}
                    stroke="#3B82F6"
                    strokeWidth={1.5}
                    style={{ pointerEvents: "none" }}
                  />
                );
              }),
            )}
          {/* Magnet hints on hover in select tool */}
          {!connectorMode &&
            tool === "select" &&
            hoverShapeId &&
            (() => {
              const hovered = state.objects.find(
                (o) => o.id === hoverShapeId && isConnectable(o),
              );
              if (!hovered) return null;
              return MAGNET_SIDES.map((side) => {
                const p = magnetPoint(hovered, side);
                return (
                  <circle
                    key={`hover-${side}`}
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="#FFFFFF"
                    stroke="#94A3B8"
                    strokeWidth={1.5}
                    style={{ pointerEvents: "none", opacity: 0.7 }}
                  />
                );
              });
            })()}
          {/* Pending-source highlight ring */}
          {connectorMode &&
            connectorSource &&
            byId.get(connectorSource) &&
            (() => {
              const o = byId.get(connectorSource)!;
              const b = objectBBox(o);
              return (
                <rect
                  x={b.x - 4}
                  y={b.y - 4}
                  width={b.w + 8}
                  height={b.h + 8}
                  fill="none"
                  stroke="#3B82F6"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          {/* Transform handles (resize + rotate) for single selection of bbox objects.
              Suppressed when the object is locked. */}
          {tool === "select" &&
            selectedIds.length === 1 &&
            primarySelected &&
            !primarySelected.locked &&
            primarySelected.type !== "line" &&
            primarySelected.type !== "connector" &&
            primarySelected.type !== "drawing" &&
            (() => {
              const b = objectBBox(primarySelected);
              const cx = b.x + b.w / 2,
                cy = b.y + b.h / 2;
              const rot = primarySelected.rotation ?? 0;
              const id = primarySelected.id;
              // Place handles in object-rotated frame
              return (
                <g transform={`rotate(${rot} ${cx} ${cy})`}>
                  {/* Resize handle bottom-right */}
                  <rect
                    x={b.x + b.w - 5}
                    y={b.y + b.h - 5}
                    width={10}
                    height={10}
                    fill="#FFFFFF"
                    stroke="#3B82F6"
                    strokeWidth={1.5}
                    style={{ cursor: "nwse-resize" }}
                    onPointerDown={(e) => startResize(e, id, b.w, b.h)}
                  />
                  {/* Rotate handle (top) */}
                  <line
                    x1={cx}
                    y1={b.y}
                    x2={cx}
                    y2={b.y - 22}
                    stroke="#3B82F6"
                    strokeWidth={1}
                    style={{ pointerEvents: "none" }}
                  />
                  <circle
                    cx={cx}
                    cy={b.y - 26}
                    r={6}
                    fill="#FFFFFF"
                    stroke="#3B82F6"
                    strokeWidth={1.5}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => startRotate(e, id, cx, cy, rot)}
                  />
                </g>
              );
            })()}
          {/* Stage 6.1: interactive handles for a single selected line/connector. */}
          {tool === "select" &&
            selectedIds.length === 1 &&
            primarySelected &&
            !primarySelected.locked &&
            (primarySelected.type === "connector" ||
              primarySelected.type === "line") &&
            (() => {
              const o = primarySelected as LineObject | ConnectorObject;
              // Resolve geometry: endpoints + path-shape inputs.
              let x1: number, y1: number, x2: number, y2: number;
              if (o.type === "connector") {
                const ep = resolveConnector(o, byId);
                if (!ep) return null;
                x1 = ep.x1;
                y1 = ep.y1;
                x2 = ep.x2;
                y2 = ep.y2;
              } else {
                x1 = o.x1;
                y1 = o.y1;
                x2 = o.x2;
                y2 = o.y2;
              }
              const bp = o.bendPoints ?? [];
              const isCurved =
                o.type === "connector"
                  ? effectiveRoute(o) === "curved"
                  : o.lineKind === "curved";
              // Default curve control (matches renderer math) so the handle is
              // visible even before the user moves it.
              const dx = x2 - x1,
                dy = y2 - y1;
              const len = Math.hypot(dx, dy) || 1;
              const off = Math.min(60, len * 0.25);
              const midX = (x1 + x2) / 2,
                midY = (y1 + y2) / 2;
              const defCx = midX - (dy / len) * off;
              const defCy = midY + (dx / len) * off;
              const ctrl = o.curveControl ?? { x: defCx, y: defCy };
              // Path 'd' for the dblclick overlay (matches renderer).
              const polyPts = buildPolyPoints(
                { x: x1, y: y1 },
                { x: x2, y: y2 },
                bp,
              );
              const overlayD =
                bp.length > 0
                  ? polylinePath(polyPts)
                  : `M ${x1} ${y1} L ${x2} ${y2}`;

              const insertBendAt = (worldX: number, worldY: number) => {
                const idx = nearestInsertIndex(
                  { x: x1, y: y1 },
                  { x: x2, y: y2 },
                  bp,
                  {
                    x: worldX,
                    y: worldY,
                  },
                );
                commit((s) => ({
                  ...s,
                  objects: s.objects.map((obj) => {
                    if (obj.id !== o.id) return obj;
                    if (obj.type !== "line" && obj.type !== "connector")
                      return obj;
                    return {
                      ...obj,
                      bendPoints: insertBendPoint(obj.bendPoints, idx, {
                        x: worldX,
                        y: worldY,
                      }),
                    } as CanvasObject;
                  }),
                }));
              };
              const removeBendAt = (index: number) => {
                commit((s) => ({
                  ...s,
                  objects: s.objects.map((obj) => {
                    if (obj.id !== o.id) return obj;
                    if (obj.type !== "line" && obj.type !== "connector")
                      return obj;
                    return {
                      ...obj,
                      bendPoints: removeBendPoint(obj.bendPoints, index),
                    } as CanvasObject;
                  }),
                }));
              };

              return (
                <g>
                  {/* Double-click hit overlay for inserting a bend point. */}
                  <path
                    d={overlayD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    style={{ pointerEvents: "stroke", cursor: "copy" }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const p = screenToWorld(e.clientX, e.clientY);
                      insertBendAt(p.x, p.y);
                    }}
                  />
                  {/* Endpoint handles (lines: free drag; connectors: magnet drag). */}
                  {o.type === "line" && (
                    <>
                      {/* p1 handle — larger transparent hit area for touch */}
                      <circle
                        cx={x1}
                        cy={y1}
                        r={20}
                        fill="transparent"
                        style={{ cursor: "move" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(
                            e.pointerId,
                          );
                          dragRef.current = {
                            kind: "line-ep",
                            id: o.id,
                            which: "p1",
                          };
                        }}
                      />
                      <circle
                        cx={x1}
                        cy={y1}
                        r={7}
                        fill="#FFFFFF"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        style={{ pointerEvents: "none" }}
                      />
                      {/* p2 handle */}
                      <circle
                        cx={x2}
                        cy={y2}
                        r={20}
                        fill="transparent"
                        style={{ cursor: "move" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(
                            e.pointerId,
                          );
                          dragRef.current = {
                            kind: "line-ep",
                            id: o.id,
                            which: "p2",
                          };
                        }}
                      />
                      <circle
                        cx={x2}
                        cy={y2}
                        r={7}
                        fill="#FFFFFF"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        style={{ pointerEvents: "none" }}
                      />
                      {/* Rotate handle at midpoint for lines */}
                      {(() => {
                        const mx = (x1 + x2) / 2;
                        const my = (y1 + y2) / 2;
                        const ang = Math.atan2(y2 - y1, x2 - x1);
                        const perpX = -Math.sin(ang) * 26;
                        const perpY = Math.cos(ang) * 26;
                        const hx = mx + perpX;
                        const hy = my + perpY;
                        const rot = (ang * 180) / Math.PI;
                        return (
                          <>
                            <line
                              x1={mx}
                              y1={my}
                              x2={hx}
                              y2={hy}
                              stroke="#3B82F6"
                              strokeWidth={1}
                              style={{ pointerEvents: "none" }}
                            />
                            <circle
                              cx={hx}
                              cy={hy}
                              r={6}
                              fill="#FFFFFF"
                              stroke="#3B82F6"
                              strokeWidth={1.5}
                              style={{ cursor: "grab" }}
                              onPointerDown={(e) =>
                                startRotate(e, o.id, mx, my, rot, {
                                  x1,
                                  y1,
                                  x2,
                                  y2,
                                })
                              }
                            />
                          </>
                        );
                      })()}
                    </>
                  )}
                  {o.type === "connector" && (
                    <>
                      <circle
                        cx={x1}
                        cy={y1}
                        r={7}
                        fill="#FFFFFF"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        style={{ cursor: "move" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(
                            e.pointerId,
                          );
                          dragRef.current = {
                            kind: "endpoint",
                            connectorId: o.id,
                            which: "source",
                            origObjectId: o.sourceObjectId,
                            origMagnet: o.sourceMagnet,
                          };
                        }}
                      />
                      <circle
                        cx={x2}
                        cy={y2}
                        r={7}
                        fill="#FFFFFF"
                        stroke="#3B82F6"
                        strokeWidth={2}
                        style={{ cursor: "move" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(
                            e.pointerId,
                          );
                          dragRef.current = {
                            kind: "endpoint",
                            connectorId: o.id,
                            which: "target",
                            origObjectId: o.targetObjectId,
                            origMagnet: o.targetMagnet,
                          };
                        }}
                      />
                    </>
                  )}
                  {/* Candidate magnet highlight during endpoint drag. */}
                  {candidateMagnet &&
                    (() => {
                      const tgt = byId.get(candidateMagnet.objectId);
                      if (!tgt) return null;
                      const mp = magnetPoint(tgt, candidateMagnet.magnet);
                      return (
                        <circle
                          cx={mp.x}
                          cy={mp.y}
                          r={8}
                          fill="rgba(34,197,94,0.35)"
                          stroke="#16A34A"
                          strokeWidth={2}
                          style={{ pointerEvents: "none" }}
                        />
                      );
                    })()}
                  {/* Curve-control handle: curved AND no bend points. */}
                  {isCurved && bp.length === 0 && (
                    <>
                      <line
                        x1={midX}
                        y1={midY}
                        x2={ctrl.x}
                        y2={ctrl.y}
                        stroke="#3B82F6"
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        style={{ pointerEvents: "none" }}
                      />
                      <circle
                        cx={ctrl.x}
                        cy={ctrl.y}
                        r={6}
                        fill="#3B82F6"
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        style={{ cursor: "move" }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          (e.currentTarget as Element).setPointerCapture(
                            e.pointerId,
                          );
                          dragRef.current = { kind: "curve-control", id: o.id };
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setSelectedIds([o.id]);
                          setEditingId(o.id);
                        }}
                      />
                    </>
                  )}
                  {/* Bend-point handles. */}
                  {bp.map((p, i) => (
                    <rect
                      key={`bend-${i}`}
                      x={p.x - 5}
                      y={p.y - 5}
                      width={10}
                      height={10}
                      fill="#F59E0B"
                      stroke="#FFFFFF"
                      strokeWidth={1.5}
                      style={{ cursor: "move" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture(
                          e.pointerId,
                        );
                        dragRef.current = { kind: "bend", id: o.id, index: i };
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeBendAt(i);
                      }}
                    />
                  ))}
                </g>
              );
            })()}
          {marquee && (
            <rect
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              fill="rgba(59,130,246,0.08)"
              stroke="#3B82F6"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
        </g>
      </svg>

      {/* Text formatting toolbar — shown when editing a shape, text, or connector label */}
      {editingId &&
        primarySelected &&
        (primarySelected.type === "shape" ||
          primarySelected.type === "text" ||
          primarySelected.type === "connector") &&
        (() => {
          const isConn = primarySelected.type === "connector";
          const co = primarySelected as ConnectorObject;
          const so = primarySelected as ShapeObject | TextObject;
          const curFontSize = isConn
            ? (co.labelStyle?.fontSize ?? 11)
            : (so.fontSize ?? 14);
          const curBold = isConn ? !!co.labelStyle?.bold : !!so.bold;
          const curItalic = isConn ? !!co.labelStyle?.italic : !!so.italic;
          const curTransform = isConn
            ? (co.labelStyle?.textTransform ?? "none")
            : (so.textTransform ?? "none");
          const patchLabelStyle = (
            patch: Partial<NonNullable<ConnectorObject["labelStyle"]>>,
          ) =>
            updateObject(editingId, {
              labelStyle: { ...co.labelStyle, ...patch },
            } as Partial<CanvasObject>);

          // If there's an active (non-collapsed) text selection inside the
          // contentEditable being edited, apply formatting to JUST that
          // selection via the browser's own rich-text command instead of
          // toggling the whole label/shape text style. Persists the
          // resulting HTML as richText/labelRichText afterwards.
          const applySelectionOrWhole = (
            execCmd: string,
            value: string | undefined,
            wholeToggle: () => void,
          ) => {
            const sel = window.getSelection();
            const active = document.activeElement as HTMLElement | null;
            const hasSelection =
              sel &&
              !sel.isCollapsed &&
              sel.rangeCount > 0 &&
              active?.isContentEditable;
            if (hasSelection && active) {
              document.execCommand(execCmd, false, value);
              const text = active.textContent ?? "";
              const html = active.innerHTML;
              if (isConn)
                updateObject(editingId, {
                  label: text,
                  labelRichText: html,
                } as Partial<CanvasObject>);
              else
                updateObject(editingId, {
                  text,
                  richText: html,
                } as Partial<CanvasObject>);
            } else {
              wholeToggle();
            }
          };
          // Keeps focus (and the selection) on the contentEditable instead
          // of letting the button steal it, which would collapse the
          // selection before the format command could run.
          const keepFocus = (e: React.MouseEvent) => e.preventDefault();
          return (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-lg border border-border bg-surface shadow-md px-2 py-1"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Font size drag control */}
              <div className="flex items-center gap-1 mr-1">
                <span className="text-[10px] text-muted-foreground select-none">
                  A
                </span>
                <input
                  type="range"
                  min={8}
                  max={72}
                  step={1}
                  value={curFontSize}
                  onChange={(e) =>
                    isConn
                      ? patchLabelStyle({ fontSize: Number(e.target.value) })
                      : updateObject(editingId, {
                          fontSize: Number(e.target.value),
                        } as Partial<CanvasObject>)
                  }
                  className="w-20 h-1.5 accent-primary cursor-pointer"
                  title="Μέγεθος γραμματοσειράς"
                />
                <span className="text-[10px] text-muted-foreground select-none">
                  A
                </span>
                <span className="text-xs tabular-nums w-6 text-center text-muted-foreground">
                  {curFontSize}
                </span>
              </div>
              <div className="w-px h-5 bg-border mx-0.5" />
              <button
                className={`h-7 px-2 rounded text-xs font-medium hover:bg-muted transition-colors ${curBold ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                title="Έντονα (Bold) — επίλεξε κείμενο για μερική μορφοποίηση"
                onMouseDown={keepFocus}
                onClick={() =>
                  applySelectionOrWhole("bold", undefined, () =>
                    isConn
                      ? patchLabelStyle({ bold: !curBold })
                      : updateObject(editingId, {
                          bold: !curBold,
                        } as Partial<CanvasObject>),
                  )
                }
              >
                B
              </button>
              <button
                className={`h-7 px-2 rounded text-xs italic hover:bg-muted transition-colors ${curItalic ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                title="Πλάγια (Italic) — επίλεξε κείμενο για μερική μορφοποίηση"
                onMouseDown={keepFocus}
                onClick={() =>
                  applySelectionOrWhole("italic", undefined, () =>
                    isConn
                      ? patchLabelStyle({ italic: !curItalic })
                      : updateObject(editingId, {
                          italic: !curItalic,
                        } as Partial<CanvasObject>),
                  )
                }
              >
                I
              </button>
              <div className="w-px h-5 bg-border mx-0.5" />
              {/* Text color swatches — moved here from the side panel so it's
                  right next to the text being edited. Only affects the text
                  itself (shape/label color) — never the shape fill/border or
                  the connector's own line+arrow color. */}
              <div className="flex items-center gap-1">
                {MINI_SWATCHES.map((c) => (
                  <button
                    key={c}
                    title={c}
                    onMouseDown={keepFocus}
                    onClick={() =>
                      applySelectionOrWhole("foreColor", c, () =>
                        isConn
                          ? updateObject(editingId, {
                              labelColor: c,
                            } as Partial<CanvasObject>)
                          : updateObject(editingId, {
                              textColor: c,
                            } as Partial<CanvasObject>),
                      )
                    }
                    className="h-5 w-5 rounded-full border border-border shrink-0"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="w-px h-5 bg-border mx-0.5" />
              <button
                className={`h-7 px-2 rounded text-xs hover:bg-muted transition-colors ${curTransform === "capitalize" ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                title="Title Case"
                onClick={() => {
                  const next =
                    curTransform === "capitalize" ? "none" : "capitalize";
                  if (isConn) patchLabelStyle({ textTransform: next });
                  else
                    updateObject(editingId, {
                      textTransform: next,
                    } as Partial<CanvasObject>);
                }}
              >
                Tt
              </button>
              <button
                className={`h-7 px-2 rounded text-xs hover:bg-muted transition-colors ${curTransform === "uppercase" ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                title="ΚΕΦΑΛΑΙΑ (ALL CAPS)"
                onClick={() => {
                  const next =
                    curTransform === "uppercase" ? "none" : "uppercase";
                  if (isConn) patchLabelStyle({ textTransform: next });
                  else
                    updateObject(editingId, {
                      textTransform: next,
                    } as Partial<CanvasObject>);
                }}
              >
                AA
              </button>
            </div>
          );
        })()}

      {primarySelected && (
        <PropertiesPanel
          object={primarySelected}
          selectionCount={selectedIds.length}
          onChange={(patch) =>
            selectedIds.forEach((id) => updateObject(id, patch))
          }
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          onBringForward={() =>
            selectedIds.forEach((id) =>
              updateObject(id, { zIndex: now() } as Partial<CanvasObject>),
            )
          }
          onSendBackward={() => {
            const minZ = Math.min(...state.objects.map((o) => o.zIndex));
            selectedIds.forEach((id) =>
              updateObject(id, { zIndex: minZ - 1 } as Partial<CanvasObject>),
            );
          }}
          onBringToFront={bringToFront}
          onSendToBack={sendToBack}
          onAlign={(mode) => alignSelected(mode)}
          onDistribute={distributeSelected}
          onDistributeGap={distributeWithGap}
          onResetPositions={resetPositionSnapshot}
          hasPositionSnapshot={
            !!positionSnapshotRef.current &&
            positionSnapshotRef.current.size > 0
          }
          onGroup={groupSelected}
          onUngroup={ungroupSelected}
          onLockToggle={lockToggle}
          onCopyStyle={copyStyle}
          onPasteStyle={pasteStyle}
          hasStyleClipboard={!!styleClipRef.current}
          onSegmentPath={() => {
            const obj = primarySelected;
            if (!obj) return;
            if (obj.type === "connector") {
              const ep = resolveConnector(obj, byId);
              if (!ep) return;
              const { x1, y1, x2, y2 } = ep;
              updateObject(obj.id, {
                routeType: "straight",
                curved: false,
                bendPoints: [
                  { x: x1 + (x2 - x1) / 3, y: y1 + (y2 - y1) / 3 },
                  { x: x1 + ((x2 - x1) * 2) / 3, y: y1 + ((y2 - y1) * 2) / 3 },
                ],
              } as Partial<CanvasObject>);
            } else if (obj.type === "line") {
              updateObject(obj.id, {
                lineKind: "straight",
                bendPoints: [
                  {
                    x: obj.x1 + (obj.x2 - obj.x1) / 3,
                    y: obj.y1 + (obj.y2 - obj.y1) / 3,
                  },
                  {
                    x: obj.x1 + ((obj.x2 - obj.x1) * 2) / 3,
                    y: obj.y1 + ((obj.y2 - obj.y1) * 2) / 3,
                  },
                ],
              } as Partial<CanvasObject>);
            }
          }}
        />
      )}

      <div className="absolute bottom-4 right-4 flex items-center gap-1 panel-soft px-1 py-1 z-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() =>
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.1)
          }
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="text-xs font-medium tabular-nums w-12 text-center">
          {Math.round(viewport.zoom * 100)}%
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() =>
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.1)
          }
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fit}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute bottom-4 left-4 flex items-center gap-1 panel-soft px-1 py-1 z-10">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          variant={state.settings.showRelationshipValues ? "default" : "ghost"}
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() =>
            commit((s) => ({
              ...s,
              settings: {
                ...s.settings,
                showRelationshipValues: !s.settings.showRelationshipValues,
              },
            }))
          }
          title="Εμφάνιση συντελεστών επίδρασης"
        >
          ±1 / 0
        </Button>
        <Button
          variant={state.settings.showInfoBadges ? "default" : "ghost"}
          size="icon"
          className="h-8 w-8"
          onClick={() =>
            commit((s) => ({
              ...s,
              settings: {
                ...s.settings,
                showInfoBadges: !s.settings.showInfoBadges,
              },
            }))
          }
          title="Εμφάνιση σημειώσεων (i)"
        >
          <span className="text-xs font-bold italic">i</span>
        </Button>
        <Button
          variant={
            state.settings.showRelationshipLabels !== false
              ? "default"
              : "ghost"
          }
          size="icon"
          className="h-8 w-8"
          onClick={() =>
            commit((s) => ({
              ...s,
              settings: {
                ...s.settings,
                showRelationshipLabels:
                  s.settings.showRelationshipLabels === false ? true : false,
              },
            }))
          }
          title="Εμφάνιση ετικετών σχέσεων"
        >
          <Tag className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  // ── helpers that need closure access ───────────────────────────────
  function alignSelected(
    mode: "left" | "right" | "center-h" | "top" | "bottom" | "center-v",
  ) {
    if (selectedIds.length < 2) return;
    capturePositionSnapshot();
    const sel = state.objects.filter((o) => selectedIds.includes(o.id));
    const boxes = sel.map((o) => ({ id: o.id, ...bbox(o) }));
    const minX = Math.min(...boxes.map((b) => b.x));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const midX = (minX + maxX) / 2,
      midY = (minY + maxY) / 2;
    commit((s) => ({
      ...s,
      objects: s.objects.map((o) => {
        const b = boxes.find((x) => x.id === o.id);
        if (!b) return o;
        let dx = 0,
          dy = 0;
        if (mode === "left") dx = minX - b.x;
        if (mode === "right") dx = maxX - (b.x + b.w);
        if (mode === "center-h") dx = midX - (b.x + b.w / 2);
        if (mode === "top") dy = minY - b.y;
        if (mode === "bottom") dy = maxY - (b.y + b.h);
        if (mode === "center-v") dy = midY - (b.y + b.h / 2);
        if (o.type === "line") {
          return {
            ...o,
            x: o.x + dx,
            y: o.y + dy,
            x1: o.x1 + dx,
            y1: o.y1 + dy,
            x2: o.x2 + dx,
            y2: o.y2 + dy,
          };
        }
        return { ...o, x: o.x + dx, y: o.y + dy } as CanvasObject;
      }),
    }));
  }
}

// Track latest selectedIds outside renders (for drag closures).
const selectedIdsRef: { current: string[] } = { current: [] };

function bbox(o: CanvasObject) {
  if (o.type === "line") {
    const x = Math.min(o.x1, o.x2),
      y = Math.min(o.y1, o.y2);
    return { x, y, w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
  }
  if (o.type === "connector") {
    // Connectors have no intrinsic bbox; they derive from endpoints at render.
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  return { x: o.x, y: o.y, w: o.width, h: o.height };
}

/** Returns true if the object has notes worth showing via the ⓘ badge.
 *  Label and relationshipValue are already visible on the canvas directly. */
function hasInfo(o: CanvasObject): boolean {
  return !!o.notes?.trim();
}

/** Small ⓘ badge rendered in SVG at top-right of an object. */
// Shared canvas 2D context for accurate text measurement (word-wrap line
// counting) — much more reliable than a fixed avg-character-width guess,
// which badly undersized the info-badge tooltip box for longer text.
let __measureCtx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!__measureCtx) {
    const c = document.createElement("canvas");
    __measureCtx = c.getContext("2d");
  }
  return __measureCtx;
}
/** Wraps `text` into lines that fit within `maxWidth` at the given font
 *  size, matching the same word-wrap behavior as the CSS the tooltip's
 *  actual <div> uses. */
function wrapTextToLines(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const ctx = measureCtx();
  if (!ctx) return [text];
  ctx.font = `${fontSize}px sans-serif`;
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      out.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(test).width > maxWidth) {
        out.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) out.push(current);
  }
  return out.length ? out : [""];
}

/** Picks black or white text for readable contrast against any badge
 *  background color — needed since the info-badge now matches the
 *  shape's own color, which can be very light (white, pale sticky-note
 *  colors, etc.) where a fixed white "i" becomes invisible. */
function contrastTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  // Perceived luminance (ITU-R BT.601)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1E293B" : "#FFFFFF";
}

function InfoBadge({
  x,
  y,
  notes,
  label,
  relationshipValue,
  color,
}: {
  x: number;
  y: number;
  notes?: string;
  label?: string;
  relationshipValue?: number;
  /** Matches the badge to the object's own color instead of a fixed blue. */
  color?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const badgeColor = color ?? "#3B82F6";

  // Build tooltip lines
  const lines: string[] = [];
  if (notes?.trim()) lines.push(notes.trim());
  if (label?.trim()) lines.push(`Label: ${label.trim()}`);
  if (relationshipValue !== undefined && relationshipValue !== 0)
    lines.push(`Τιμή: ${relationshipValue > 0 ? "+" : ""}${relationshipValue}`);

  const TOOLTIP_W = 220;
  const TOOLTIP_PAD = 8;
  const LINE_H = 15;
  const FONT_SIZE = 11;
  const innerW = TOOLTIP_W - TOOLTIP_PAD * 2;
  const wrappedLineCount = lines.reduce(
    (sum, line) =>
      sum + Math.max(1, wrapTextToLines(line, innerW, FONT_SIZE).length),
    0,
  );
  const tooltipH = wrappedLineCount * LINE_H + TOOLTIP_PAD * 2;
  // Position tooltip to the right of the badge; clamp handled by SVG overflow
  const tooltipX = 20;
  const tooltipY = -tooltipH / 2 + 8;

  return (
    <g
      transform={`translate(${x - 15} ${y + 5})`}
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {/* Badge circle — thin border keeps it visible even against a
          near-white canvas background, regardless of the fill color. */}
      <circle
        cx={8}
        cy={8}
        r={8}
        fill={badgeColor}
        stroke="rgba(0,0,0,0.25)"
        strokeWidth={1}
        opacity={open ? 0.95 : 0.85}
      />
      <text
        x={8}
        y={8}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={700}
        fill={contrastTextColor(badgeColor)}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        i
      </text>

      {/* Tooltip bubble */}
      {open && (
        <g
          transform={`translate(${tooltipX} ${tooltipY})`}
          style={{ pointerEvents: "none" }}
        >
          {/* Shadow */}
          <rect
            x={1}
            y={1}
            width={TOOLTIP_W}
            height={tooltipH}
            rx={6}
            fill="rgba(0,0,0,0.12)"
          />
          {/* Background */}
          <rect
            x={0}
            y={0}
            width={TOOLTIP_W}
            height={tooltipH}
            rx={6}
            fill="#FFFFFF"
            stroke="#E2E8F0"
            strokeWidth={1}
          />
          {/* Caret */}
          <polygon
            points={`0,${tooltipH / 2 - 6} -8,${tooltipH / 2} 0,${tooltipH / 2 + 6}`}
            fill="#FFFFFF"
            stroke="#E2E8F0"
            strokeWidth={1}
          />
          {/* Full, wrapped text — nothing truncated */}
          <foreignObject x={0} y={0} width={TOOLTIP_W} height={tooltipH}>
            <div
              style={{
                padding: `${TOOLTIP_PAD}px`,
                fontSize: 11,
                lineHeight: `${LINE_H}px`,
                color: "#1E293B",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                userSelect: "none",
              }}
            >
              {lines.join("\n")}
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
}

// ── object renderer ─────────────────────────────────────────────────
function ObjectNode({
  o,
  byId,
  selected,
  interactive,
  showRelationshipValues,
  showInfoBadges,
  showRelationshipLabels,
  onSelect,
  onMoveStart,
  onTextEdit,
  onLabelEdit,
  editing,
  onStartEdit,
  onHoverChange,
  onResize,
  onInfoClick,
  obstacles = [],
}: {
  o: CanvasObject;
  byId: Map<string, CanvasObject>;
  selected: boolean;
  interactive: boolean;
  showRelationshipValues?: boolean;
  showInfoBadges?: boolean;
  showRelationshipLabels?: boolean;
  onSelect: (additive: boolean) => void;
  onMoveStart: (e: React.PointerEvent, additive: boolean) => void;
  onTextEdit: (text: string, richText?: string) => void;
  /** Separate from onTextEdit — lines/connectors store their editable
   *  text in `label`/`labelRichText`, not `text`/`richText`. */
  onLabelEdit?: (label: string, richText?: string) => void;
  editing?: boolean;
  onStartEdit?: () => void;
  onHoverChange?: (hovered: boolean) => void;
  onResize?: (newHeight: number) => void;
  onInfoClick?: () => void;
  obstacles?: Rect[];
}) {
  // keep selectedIdsRef updated whenever a node renders selected
  if (selected && !selectedIdsRef.current.includes(o.id)) {
    selectedIdsRef.current = [...selectedIdsRef.current, o.id];
  }
  if (!selected && selectedIdsRef.current.includes(o.id)) {
    selectedIdsRef.current = selectedIdsRef.current.filter((id) => id !== o.id);
  }

  // Rotation: applied as group transform around object center.
  let rotTransform: string | undefined;
  if (o.type !== "line" && o.type !== "connector" && (o.rotation ?? 0) !== 0) {
    const b = { x: o.x, y: o.y, w: o.width, h: o.height };
    rotTransform = `rotate(${o.rotation} ${b.x + b.w / 2} ${b.y + b.h / 2})`;
  }

  const common = {
    opacity: o.opacity ?? 1,
    transform: rotTransform,
    onPointerDown: (e: React.PointerEvent) => {
      const additive = e.shiftKey;
      onSelect(additive);
      onMoveStart(e, additive);
    },
    onPointerEnter: () => onHoverChange?.(true),
    onPointerLeave: () => onHoverChange?.(false),
    style: { cursor: interactive ? "move" : "default" } as React.CSSProperties,
  };

  if (o.type === "shape") {
    const fill = o.fill ?? "#FFFFFF";
    const stroke = o.stroke ?? "#0F172A";
    const sw = o.strokeWidth ?? 1;
    const pad = 10; // inner padding so text never touches the border
    return (
      <g
        {...common}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit?.();
        }}
      >
        {renderShape(o, fill, stroke, sw)}
        {/* Blue outline when in text-edit mode */}
        {editing && (
          <rect
            x={o.x}
            y={o.y}
            width={o.width}
            height={o.height}
            fill="none"
            stroke="#3B82F6"
            strokeWidth={2}
            strokeDasharray="4 3"
            rx={4}
            style={{ pointerEvents: "none" }}
          />
        )}
        {/* Text rendered inside foreignObject so it wraps within shape bounds */}
        <foreignObject
          x={o.x + pad}
          y={o.y + pad}
          width={Math.max(10, o.width - pad * 2)}
          height={Math.max(10, o.height - pad * 2)}
          style={{ pointerEvents: "none" }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              color: o.textColor ?? "#0F172A",
              fontSize: o.fontSize ?? 14,
              fontWeight: o.bold ? 700 : 400,
              fontStyle: o.italic ? "italic" : "normal",
              textTransform:
                (o.textTransform as React.CSSProperties["textTransform"]) ??
                "none",
              textAlign: "center",
              wordBreak: "normal",
              overflowWrap: "normal",
              whiteSpace: "pre-wrap",
              lineHeight: 1.3,
              userSelect: "none",
              pointerEvents: "none",
            }}
            {...(o.richText
              ? {
                  dangerouslySetInnerHTML: {
                    __html: DOMPurify.sanitize(o.richText, {
                      USE_PROFILES: { html: true },
                    }),
                  },
                }
              : { children: o.text })}
          />
        </foreignObject>
        {editing && (
          <foreignObject
            x={o.x + pad}
            y={o.y + pad}
            width={Math.max(10, o.width - pad * 2)}
            height={Math.max(10, o.height - pad * 2)}
          >
            <div
              key={o.id}
              ref={seedRichTextRef(o.richText ?? escapeHtml(o.text ?? ""))}
              contentEditable
              suppressContentEditableWarning
              autoFocus
              onBlur={(e) =>
                onTextEdit(
                  e.currentTarget.textContent ?? "",
                  e.currentTarget.innerHTML,
                )
              }
              onPointerDown={(e) => e.stopPropagation()}
              onInput={(e) => {
                // Auto-resize shape height to fit text
                const el = e.currentTarget;
                const scrollH = el.scrollHeight;
                const availH = o.height - pad * 2;
                if (scrollH > availH) {
                  const newH = scrollH + pad * 2 + 4;
                  onTextEdit(el.textContent ?? "", el.innerHTML);
                  onResize?.(newH);
                }
              }}
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                outline: "1px dashed #3B82F6",
                color: o.textColor ?? "#0F172A",
                fontSize: o.fontSize ?? 14,
                fontWeight: o.bold ? 700 : 400,
                fontStyle: o.italic ? "italic" : "normal",
                textTransform:
                  (o.textTransform as React.CSSProperties["textTransform"]) ??
                  "none",
                textAlign: "center",
                wordBreak: "normal",
                overflowWrap: "normal",
                whiteSpace: "pre-wrap",
                lineHeight: 1.3,
                cursor: "text",
                background: "transparent",
              }}
            />
          </foreignObject>
        )}
        {selected && <SelectionRect {...bbox(o)} />}
        {showInfoBadges && hasInfo(o) && onInfoClick && (
          <InfoBadge x={o.x + o.width} y={o.y} notes={o.notes} color={o.fill} />
        )}
      </g>
    );
  }
  if (o.type === "frame") {
    const fBorderStyle = o.borderStyle ?? "solid";
    const fSw = o.strokeWidth ?? 1.5;
    const fDash =
      fBorderStyle === "dashed"
        ? "6 4"
        : fBorderStyle === "dotted"
          ? `0.1 ${fSw * 2.5}`
          : fBorderStyle === "dash-dot"
            ? `${fSw * 3} ${fSw * 2.5} 0.1 ${fSw * 2.5}`
            : undefined;
    return (
      <g {...common}>
        <rect
          x={o.x}
          y={o.y}
          width={o.width}
          height={o.height}
          fill={o.fill ?? "transparent"}
          stroke={fBorderStyle === "none" ? "none" : (o.stroke ?? "#94A3B8")}
          strokeWidth={fSw}
          strokeDasharray={fDash}
          strokeLinecap={fBorderStyle === "dotted" ? "round" : undefined}
          rx={6}
        />
        {o.title && (
          <text
            x={o.x + 8}
            y={o.y - 6}
            fill="#475569"
            fontSize={12}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {o.title}
          </text>
        )}
        {selected && <SelectionRect {...bbox(o)} />}
      </g>
    );
  }
  if (o.type === "text") {
    const w = Math.max(80, o.width),
      h = Math.max(28, o.height);
    return (
      <g
        {...common}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit?.();
        }}
      >
        <foreignObject x={o.x} y={o.y} width={w} height={h}>
          {editing ? (
            <div
              key={o.id}
              ref={seedRichTextRef(
                (o as unknown as { richText?: string }).richText ??
                  escapeHtml(o.text ?? ""),
              )}
              contentEditable
              suppressContentEditableWarning
              autoFocus
              onBlur={(e) =>
                onTextEdit(
                  e.currentTarget.textContent ?? "",
                  e.currentTarget.innerHTML,
                )
              }
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                color: o.textColor ?? "#0F172A",
                fontSize: o.fontSize,
                fontWeight: o.bold ? 700 : 400,
                fontStyle: o.italic ? "italic" : "normal",
                textTransform:
                  (o.textTransform as React.CSSProperties["textTransform"]) ??
                  "none",
                lineHeight: 1.3,
                outline: "1px dashed #3B82F6",
                padding: 2,
                minWidth: 40,
                whiteSpace: "pre-wrap",
                wordBreak: "normal",
                overflowWrap: "normal",
                cursor: "text",
                userSelect: "text",
                pointerEvents: "auto",
              }}
            />
          ) : (
            <div
              style={{
                color: o.textColor ?? "#0F172A",
                fontSize: o.fontSize,
                fontWeight: o.bold ? 700 : 400,
                fontStyle: o.italic ? "italic" : "normal",
                textTransform:
                  (o.textTransform as React.CSSProperties["textTransform"]) ??
                  "none",
                lineHeight: 1.3,
                outline: "none",
                padding: 2,
                minWidth: 40,
                whiteSpace: "pre-wrap",
                wordBreak: "normal",
                overflowWrap: "normal",
                cursor: interactive ? "move" : "default",
                userSelect: "none",
                pointerEvents: "none",
              }}
              {...((o as unknown as { richText?: string }).richText
                ? {
                    dangerouslySetInnerHTML: {
                      __html: DOMPurify.sanitize(
                        (o as unknown as { richText?: string })
                          .richText as string,
                        { USE_PROFILES: { html: true } },
                      ),
                    },
                  }
                : { children: o.text })}
            />
          )}
        </foreignObject>
        {selected && <SelectionRect x={o.x} y={o.y} w={w} h={h} />}
      </g>
    );
  }
  if (o.type === "line") {
    const isCurved = o.lineKind === "curved";
    const midX = (o.x1 + o.x2) / 2;
    const midY = (o.y1 + o.y2) / 2;
    const dx = o.x2 - o.x1,
      dy = o.y2 - o.y1;
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.min(60, len * 0.25);
    const defCtrlX = midX - (dy / len) * off;
    const defCtrlY = midY + (dx / len) * off;
    // Stage 6.1: honour explicit curveControl when present.
    const ctrlX = o.curveControl?.x ?? defCtrlX;
    const ctrlY = o.curveControl?.y ?? defCtrlY;
    const dash = o.dashed || o.lineKind === "dashed" ? "6 4" : undefined;
    // Stage 6.1: render through bend points when any exist (mirrors connector).
    const polyD =
      o.bendPoints && o.bendPoints.length > 0
        ? isCurved
          ? smoothPath(
              buildPolyPoints(
                { x: o.x1, y: o.y1 },
                { x: o.x2, y: o.y2 },
                o.bendPoints,
              ),
            )
          : polylinePath(
              buildPolyPoints(
                { x: o.x1, y: o.y1 },
                { x: o.x2, y: o.y2 },
                o.bendPoints,
              ),
            )
        : null;
    // Where the label/info-badge sit — follows the actual path.
    let labelX = midX,
      labelY = midY;
    if (o.bendPoints && o.bendPoints.length > 0) {
      const pts = buildPolyPoints(
        { x: o.x1, y: o.y1 },
        { x: o.x2, y: o.y2 },
        o.bendPoints,
      );
      const midIdx = Math.floor(pts.length / 2);
      labelX = pts[midIdx].x;
      labelY = pts[midIdx].y;
    } else if (isCurved) {
      labelX = (o.x1 + 2 * ctrlX + o.x2) / 4;
      labelY = (o.y1 + 2 * ctrlY + o.y2) / 4;
    }
    return (
      <g {...common} color={o.stroke ?? "#0F172A"}>
        {(o.arrowEnd || o.arrowStart) && (
          <defs>
            {o.arrowEnd && (
              <marker
                id={`arrow-end-${o.id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={o.stroke ?? "#0F172A"} />
              </marker>
            )}
            {o.arrowStart && (
              <marker
                id={`arrow-start-${o.id}`}
                viewBox="0 0 10 10"
                refX="1"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 10 0 L 0 5 L 10 10 z" fill={o.stroke ?? "#0F172A"} />
              </marker>
            )}
          </defs>
        )}
        {polyD ? (
          <path
            d={polyD}
            fill="none"
            stroke={o.stroke ?? "#0F172A"}
            strokeWidth={o.strokeWidth ?? 2}
            strokeDasharray={dash}
            markerEnd={o.arrowEnd ? `url(#arrow-end-${o.id})` : undefined}
            markerStart={o.arrowStart ? `url(#arrow-start-${o.id})` : undefined}
          />
        ) : isCurved ? (
          <path
            d={`M ${o.x1} ${o.y1} Q ${ctrlX} ${ctrlY} ${o.x2} ${o.y2}`}
            fill="none"
            stroke={o.stroke ?? "#0F172A"}
            strokeWidth={o.strokeWidth ?? 2}
            strokeDasharray={dash}
            markerEnd={o.arrowEnd ? `url(#arrow-end-${o.id})` : undefined}
            markerStart={o.arrowStart ? `url(#arrow-start-${o.id})` : undefined}
          />
        ) : (
          <line
            x1={o.x1}
            y1={o.y1}
            x2={o.x2}
            y2={o.y2}
            stroke={o.stroke ?? "#0F172A"}
            strokeWidth={o.strokeWidth ?? 2}
            strokeDasharray={dash}
            markerEnd={o.arrowEnd ? `url(#arrow-end-${o.id})` : undefined}
            markerStart={o.arrowStart ? `url(#arrow-start-${o.id})` : undefined}
          />
        )}
        {/* invisible hit area */}
        {polyD ? (
          <path d={polyD} fill="none" stroke="transparent" strokeWidth={14} />
        ) : (
          <line
            x1={o.x1}
            y1={o.y1}
            x2={o.x2}
            y2={o.y2}
            stroke="transparent"
            strokeWidth={14}
          />
        )}
        {showRelationshipLabels &&
          o.label &&
          (() => {
            // Angle of the line in degrees
            const angle =
              (Math.atan2(o.y2 - o.y1, o.x2 - o.x1) * 180) / Math.PI;
            // Keep text readable — flip if line goes right-to-left
            const rot = angle > 90 || angle < -90 ? angle + 180 : angle;
            return (
              <g
                transform={`translate(${labelX} ${labelY})`}
                style={{ pointerEvents: "none" }}
              >
                <g transform={`rotate(${rot})`}>
                  <rect
                    x={-(o.label.length * 3.5 + 4)}
                    y={-17}
                    width={o.label.length * 7 + 8}
                    height={14}
                    rx={3}
                    fill="white"
                    fillOpacity={0.85}
                  />
                  <text
                    x={0}
                    y={-6}
                    textAnchor="middle"
                    fill={o.labelColor ?? o.stroke ?? "#0F172A"}
                    fontSize={11}
                    fontStyle="italic"
                    style={{ userSelect: "none" }}
                  >
                    {o.label}
                  </text>
                </g>
              </g>
            );
          })()}
        {showRelationshipValues && o.relationshipValue !== undefined && (
          <RelationshipValueBadge
            x={midX}
            y={midY + 12}
            value={o.relationshipValue}
          />
        )}
        {selected && (
          <>
            <circle cx={o.x1} cy={o.y1} r={4} fill="#3B82F6" />
            <circle cx={o.x2} cy={o.y2} r={4} fill="#3B82F6" />
          </>
        )}
        {showInfoBadges && hasInfo(o) && onInfoClick && (
          <InfoBadge
            x={labelX + 6}
            y={labelY - 6}
            notes={o.notes}
            label={o.label}
            relationshipValue={o.relationshipValue}
            color={o.stroke}
          />
        )}
      </g>
    );
  }
  if (o.type === "connector") {
    // Endpoints are derived from source/target objects → auto-reroute on move/resize.
    const ep = resolveConnector(o, byId);
    if (!ep) return null;
    const { x1, y1, x2, y2 } = ep;
    const midX = (x1 + x2) / 2,
      midY = (y1 + y2) / 2;
    const stroke = o.stroke ?? "#0F172A";
    const sw = o.strokeWidth ?? 2;
    const dash = combinedDashArray(!!o.dashed, !!o.dotted, o.dashDensity, sw);
    const strokeLinecapC: "round" | undefined = o.dotted ? "round" : undefined;
    const route = effectiveRoute(o);
    const intensity = o.lightningIntensity ?? 4;
    const polyPts = buildPolyPoints(
      { x: x1, y: y1 },
      { x: x2, y: y2 },
      o.bendPoints,
    );
    // Where the label/info-badge sit — follows the ACTUAL path, not just
    // the straight-line midpoint between endpoints (which would leave the
    // label floating off to the side once the line is curved or broken
    // into segments).
    let labelX = midX,
      labelY = midY;
    if (o.bendPoints && o.bendPoints.length > 0) {
      const midIdx = Math.floor(polyPts.length / 2);
      labelX = polyPts[midIdx].x;
      labelY = polyPts[midIdx].y;
    } else if (route === "curved") {
      let ctrlX: number, ctrlY: number;
      if (o.curveControl) {
        ctrlX = o.curveControl.x;
        ctrlY = o.curveControl.y;
      } else {
        const dx = x2 - x1,
          dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const off = Math.min(60, len * 0.25);
        ctrlX = midX - (dy / len) * off;
        ctrlY = midY + (dx / len) * off;
      }
      // Point at t=0.5 on the quadratic bezier through (x1,y1) ctrl (x2,y2).
      labelX = (x1 + 2 * ctrlX + x2) / 4;
      labelY = (y1 + 2 * ctrlY + y2) / 4;
    }
    const bezierLen = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bezierOff = Math.min(60, bezierLen * 0.25);
    const defaultCtrlX = midX - ((y2 - y1) / bezierLen) * bezierOff;
    const defaultCtrlY = midY + ((x2 - x1) / bezierLen) * bezierOff;
    // Base path for style overlays (wavy / tick marks) — follows the
    // actual curve when curved, not just the straight line between the
    // two endpoints.
    const stylePathPts =
      route === "curved"
        ? sampleQuadraticBezier(
            x1,
            y1,
            o.curveControl?.x ?? defaultCtrlX,
            o.curveControl?.y ?? defaultCtrlY,
            x2,
            y2,
            16,
          )
        : [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ];
    const d = o.wavy
      ? wavyPathAlong(stylePathPts)
      : o.connectorStyle === "lightning"
        ? route === "zigzag"
          ? autoRoutePath(x1, y1, x2, y2, obstacles) // auto-route then lightning overlay not applicable; use auto path directly
          : route === "curved"
            ? lightningPath(
                sampleQuadraticBezier(
                  x1,
                  y1,
                  o.curveControl?.x ?? defaultCtrlX,
                  o.curveControl?.y ?? defaultCtrlY,
                  x2,
                  y2,
                  8,
                ),
                intensity,
              )
            : lightningPath(polyPts, intensity)
        : o.bendPoints && o.bendPoints.length > 0
          ? route === "curved"
            ? smoothPath(polyPts)
            : polylinePath(polyPts)
          : route === "zigzag"
            ? autoRoutePath(x1, y1, x2, y2, obstacles)
            : connectorPath(
                route,
                x1,
                y1,
                x2,
                y2,
                o.sourceMagnet,
                o.targetMagnet,
                o.curveControl,
              );
    const ls = o.labelStyle ?? { italic: true };
    const arrowEndId = `arrow-end-${o.id}`;
    const arrowStartId = `arrow-start-${o.id}`;
    return (
      <g
        {...common}
        color={stroke}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartEdit?.();
        }}
      >
        {(o.arrowEnd || o.arrowStart) && (
          <defs>
            {o.arrowEnd && (
              <marker
                id={arrowEndId}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
              </marker>
            )}
            {o.arrowStart && (
              <marker
                id={arrowStartId}
                viewBox="0 0 10 10"
                refX="1"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 10 0 L 0 5 L 10 10 z" fill={stroke} />
              </marker>
            )}
          </defs>
        )}
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash}
          strokeLinecap={strokeLinecapC}
          markerEnd={o.arrowEnd ? `url(#${arrowEndId})` : undefined}
          markerStart={o.arrowStart ? `url(#${arrowStartId})` : undefined}
        />
        {o.tickMarks && (
          <path
            d={tickMarksAlongPoints(stylePathPts)}
            fill="none"
            stroke={stroke}
            strokeWidth={Math.max(1, sw * 0.75)}
            style={{ pointerEvents: "none" }}
          />
        )}
        {/* hit area (wider, transparent) */}
        <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
        {editing ? (
          <foreignObject
            x={labelX - 70}
            y={labelY - (ls.fontSize ?? 11) - 6}
            width={140}
            height={(ls.fontSize ?? 11) + 6}
          >
            <div
              key={o.id}
              ref={seedRichTextRef(
                o.labelRichText ?? escapeHtml(o.label ?? ""),
              )}
              contentEditable
              suppressContentEditableWarning
              autoFocus
              onBlur={(e) =>
                onLabelEdit?.(
                  e.currentTarget.textContent ?? "",
                  e.currentTarget.innerHTML,
                )
              }
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
              style={{
                width: "100%",
                minHeight: "100%",
                background: "white",
                border: "1.5px solid #3B82F6",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: ls.fontSize ?? 11,
                fontStyle: ls.italic ? "italic" : "normal",
                fontWeight: ls.bold ? 700 : 400,
                textTransform: ls.textTransform ?? "none",
                color: o.labelColor ?? stroke,
                textAlign: "center",
                outline: "none",
              }}
            />
          </foreignObject>
        ) : (
          showRelationshipLabels &&
          o.label &&
          (() => {
            const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
            const rot = angle > 90 || angle < -90 ? angle + 180 : angle;
            const fs = ls.fontSize ?? 11;
            const boxW = o.label.length * fs * 0.64 + 8;
            const boxH = fs + 3;
            return (
              <g
                transform={`translate(${labelX} ${labelY})`}
                style={{ pointerEvents: "none" }}
              >
                <g transform={`rotate(${rot})`}>
                  <rect
                    x={-boxW / 2}
                    y={-boxH - 3}
                    width={boxW}
                    height={boxH}
                    rx={3}
                    fill="white"
                    fillOpacity={0.85}
                  />
                  <foreignObject
                    x={-boxW / 2}
                    y={-boxH - 3}
                    width={boxW}
                    height={boxH}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: fs,
                        fontStyle: ls.italic ? "italic" : "normal",
                        fontWeight: ls.bold ? 700 : 400,
                        textDecoration: ls.underline ? "underline" : undefined,
                        textTransform:
                          (ls.textTransform as React.CSSProperties["textTransform"]) ??
                          "none",
                        color: o.labelColor ?? stroke,
                        userSelect: "none",
                        whiteSpace: "nowrap",
                      }}
                      {...(o.labelRichText
                        ? {
                            dangerouslySetInnerHTML: {
                              __html: DOMPurify.sanitize(o.labelRichText, {
                                USE_PROFILES: { html: true },
                              }),
                            },
                          }
                        : { children: o.label })}
                    />
                  </foreignObject>
                </g>
              </g>
            );
          })()
        )}
        {showRelationshipValues && o.relationshipValue !== undefined && (
          <RelationshipValueBadge
            x={midX}
            y={midY + 12}
            value={o.relationshipValue}
          />
        )}
        {selected && (
          <>
            <circle cx={x1} cy={y1} r={4} fill="#3B82F6" />
            <circle cx={x2} cy={y2} r={4} fill="#3B82F6" />
          </>
        )}
        {showInfoBadges && hasInfo(o) && onInfoClick && (
          <InfoBadge
            x={labelX + 6}
            y={labelY - 6}
            notes={o.notes}
            label={o.label}
            relationshipValue={o.relationshipValue}
            color={stroke}
          />
        )}
      </g>
    );
  }
  if (o.type === "symbol") {
    return (
      <g {...common}>
        <SymbolGlyph o={o} />
        {selected && <SelectionRect {...bbox(o)} />}
      </g>
    );
  }
  if (o.type === "drawing") {
    const d = o.points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${o.x + p.x} ${o.y + p.y}`)
      .join(" ");
    return (
      <g {...common}>
        <path
          d={d}
          fill="none"
          stroke={o.stroke ?? "#0F172A"}
          strokeWidth={o.strokeWidth ?? 2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* hit area */}
        <path d={d} fill="none" stroke="transparent" strokeWidth={16} />
        {selected && <SelectionRect {...bbox(o)} />}
      </g>
    );
  }
  return null;
}

/** Tile size (userSpaceOnUse) for each density — smaller tile = denser pattern. */
function densityTile(density: PatternDensity | undefined): number {
  return density === "sparse" ? 16 : density === "dense" ? 6 : 10; // "medium" default
}

/** One reusable SVG <pattern> def per texture kind. Rendered inline right
 *  before the shape that uses it — SVG pattern ids just need to be unique
 *  document-wide, they don't need to live in one central <defs>. */
function TexturePatternDef({
  id,
  kind,
  density,
  color,
  opacity,
}: {
  id: string;
  kind: FillTextureKind;
  density: PatternDensity | undefined;
  color: string;
  opacity: number;
}) {
  const tile = densityTile(density);
  const common = {
    stroke: color,
    strokeOpacity: opacity,
    fill: "none" as const,
  };
  let content: React.ReactNode;
  if (kind === "horizontal") {
    content = <line x1={0} y1={tile / 2} x2={tile} y2={tile / 2} {...common} />;
  } else if (kind === "vertical") {
    content = <line x1={tile / 2} y1={0} x2={tile / 2} y2={tile} {...common} />;
  } else if (kind === "diagonal") {
    content = (
      <g>
        <line x1={0} y1={tile} x2={tile} y2={0} {...common} />
        <line
          x1={-tile / 2}
          y1={tile / 2}
          x2={tile / 2}
          y2={-tile / 2}
          {...common}
        />
        <line
          x1={tile / 2}
          y1={tile * 1.5}
          x2={tile * 1.5}
          y2={tile / 2}
          {...common}
        />
      </g>
    );
  } else if (kind === "cross") {
    content = (
      <g>
        <line x1={0} y1={tile} x2={tile} y2={0} {...common} />
        <line x1={0} y1={0} x2={tile} y2={tile} {...common} />
      </g>
    );
  } else if (kind === "grid") {
    content = (
      <g>
        <line x1={0} y1={0} x2={tile} y2={0} {...common} />
        <line x1={0} y1={0} x2={0} y2={tile} {...common} />
      </g>
    );
  } else if (kind === "dots") {
    content = (
      <circle
        cx={tile / 2}
        cy={tile / 2}
        r={Math.max(0.8, tile / 8)}
        fill={color}
        fillOpacity={opacity}
      />
    );
  } else if (kind === "wave") {
    const h = tile / 2;
    content = (
      <path
        d={`M0,${h} Q${tile / 4},0 ${tile / 2},${h} T${tile},${h}`}
        stroke={color}
        strokeOpacity={opacity}
        fill="none"
      />
    );
  } else {
    content = null;
  }
  return (
    <defs>
      <pattern id={id} width={tile} height={tile} patternUnits="userSpaceOnUse">
        {content}
      </pattern>
    </defs>
  );
}

function borderDashArray(
  style: BorderStyle | undefined,
  density: PatternDensity | undefined,
  sw: number,
): string | undefined {
  if (!style || style === "solid" || style === "none") return undefined;
  const unit = Math.max(1.5, sw);
  const gapMul = density === "sparse" ? 3.5 : density === "dense" ? 1.5 : 2.5; // medium default
  if (style === "dashed") return `${unit * 3} ${unit * gapMul}`;
  if (style === "dotted") return `0.1 ${unit * gapMul}`;
  if (style === "dash-dot")
    return `${unit * 3} ${unit * gapMul} 0.1 ${unit * gapMul}`;
  return undefined;
}

/** Regular shapes cap border thickness at 12px; shapes larger than ~300px
 *  on their longest side get more headroom (up to 24px) so a thick border
 *  doesn't look proportionally tiny on them. Used by the Properties panel
 *  slider bound, not by rendering itself (rendering just uses whatever
 *  strokeWidth is already stored). */
export function maxBorderWidthFor(o: {
  width: number;
  height: number;
}): number {
  return Math.max(o.width, o.height) > 300 ? 24 : 12;
}

function renderShape(o: ShapeObject, fill: string, stroke: string, sw: number) {
  const { x, y, width: w, height: h, shapeKind } = o;
  const r = o.borderRadius ?? 0;
  const fillOpacity = (o.fillOpacity ?? 100) / 100;
  const borderOpacity = (o.borderOpacity ?? 100) / 100;
  const borderStyle = o.borderStyle ?? "solid";
  const strokeDasharray = borderDashArray(borderStyle, o.borderDashDensity, sw);
  const strokeColor = borderStyle === "none" ? "none" : stroke;
  const strokeLinecap: "round" | undefined =
    borderStyle === "dotted" || borderStyle === "dash-dot"
      ? "round"
      : undefined;
  const hasTexture = (o.fillTexture ?? "none") !== "none";
  const patternId = `texture-${o.id}`;

  const baseProps = {
    fill,
    fillOpacity,
    stroke: strokeColor,
    strokeOpacity: borderOpacity,
    strokeWidth: sw,
    strokeDasharray,
    strokeLinecap,
  };
  const textureProps = hasTexture
    ? { fill: `url(#${patternId})`, stroke: "none" as const }
    : null;

  const textureDefs = hasTexture ? (
    <TexturePatternDef
      id={patternId}
      kind={o.fillTexture as FillTextureKind}
      density={o.fillTextureDensity}
      color={o.fillTextureColor ?? stroke}
      opacity={(o.fillTextureOpacity ?? 100) / 100}
    />
  ) : null;

  if (shapeKind === "circle" || shapeKind === "oval") {
    const geo = { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
    return (
      <>
        {textureDefs}
        <ellipse {...geo} {...baseProps} />
        {textureProps && <ellipse {...geo} {...textureProps} />}
      </>
    );
  }
  if (
    shapeKind === "triangle" ||
    shapeKind === "diamond" ||
    shapeKind === "polygon"
  ) {
    const points = polygonPoints(shapeKind, x, y, w, h);
    return (
      <>
        {textureDefs}
        <polygon points={points} {...baseProps} strokeLinejoin="round" />
        {textureProps && <polygon points={points} {...textureProps} />}
      </>
    );
  }
  // rectangle / rounded-rectangle / square
  return (
    <>
      {textureDefs}
      <rect x={x} y={y} width={w} height={h} rx={r} {...baseProps} />
      {textureProps && (
        <rect x={x} y={y} width={w} height={h} rx={r} {...textureProps} />
      )}
    </>
  );
}

function SelectionRect({
  x,
  y,
  w,
  h,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return (
    <rect
      x={x - 2}
      y={y - 2}
      width={w + 4}
      height={h + 4}
      fill="none"
      stroke="#3B82F6"
      strokeWidth={1}
      strokeDasharray="4 4"
      style={{ pointerEvents: "none" }}
    />
  );
}

/** Pill rendered near the midpoint of a relationship to show its coefficient.
 *  Supports the full -5..+5 range; width adapts to the label. */
function RelationshipValueBadge({
  x,
  y,
  value,
}: {
  x: number;
  y: number;
  value: number;
}) {
  const v = Math.round(value);
  const text = v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0";
  const fill = v > 0 ? "#16A34A" : v < 0 ? "#DC2626" : "#64748B";
  const w = Math.max(24, 12 + text.length * 7);
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={x - w / 2}
        y={y - 8}
        width={w}
        height={16}
        rx={8}
        fill="#FFFFFF"
        stroke={fill}
        strokeWidth={1.25}
      />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        fill={fill}
      >
        {text}
      </text>
    </g>
  );
}
