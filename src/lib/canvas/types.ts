// Canvas object model. Common fields on every object so storage, selection,
// transforms and undo/redo work uniformly. Each object type adds its own.

export const SCHEMA_VERSION = 1;

export type WorkspaceType =
  "case-analysis" | "concept-analysis" | "free-drawing" | "genogram";

export type ProjectMode = "solo" | "live" | "collaborativeFinal";

export type SaveStatus =
  "idle" | "dirty" | "saving" | "saved" | "error" | "offline";

export interface BaseObject {
  id: string;
  type: ObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  textColor?: string;
  opacity?: number;
  zIndex: number;
  locked?: boolean;
  groupId?: string | null;
  /** Free-form notes / info attached to ANY object (shape, line, frame, etc).
   *  Not rendered on the canvas; shown in Properties → Πληροφορίες / Σημειώσεις. */
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ObjectType =
  "shape" | "line" | "connector" | "text" | "symbol" | "frame" | "drawing";

export type MagnetSide =
  | "top"
  | "right"
  | "bottom"
  | "left"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type ConnectorRouteType =
  "straight" | "curved" | "orthogonal" | "zigzag";

/** Relationship coefficient ("Συντελεστής επίδρασης").
 *  Integer in the range -5..+5. 0 = ουδέτερο. */
export type RelationshipValue = number;

export type ShapeKind =
  | "rectangle"
  | "rounded-rectangle"
  | "square"
  | "circle"
  | "oval"
  | "triangle"
  | "diamond"
  | "polygon";

export type FillTextureKind =
  | "none"
  | "diagonal"
  | "horizontal"
  | "vertical"
  | "cross"
  | "dots"
  | "grid"
  | "wave";

export type PatternDensity = "sparse" | "medium" | "dense";

export type BorderStyle = "solid" | "dashed" | "dotted" | "dash-dot" | "none";

export interface ShapeObject extends BaseObject {
  type: "shape";
  shapeKind: ShapeKind;
  text?: string;
  /** Rich (partially-formatted) HTML version of `text` — lets the user
   *  select a few words and bold/italic/color just those, instead of the
   *  whole label. When present, rendering uses this instead of plain
   *  `text` + the flat bold/italic/textColor fields (those remain as the
   *  starting defaults for brand-new text). */
  richText?: string;
  fontSize?: number;
  borderRadius?: number;
  bold?: boolean;
  italic?: boolean;
  textTransform?: "none" | "uppercase" | "capitalize";
  /** Fill opacity (0–100), independent of the shape's overall opacity. */
  /** Set by the "Σημείωση" (sticky note) tool — lets the properties panel
   *  offer a curated fill+border color-pair palette instead of separate
   *  pickers, so picking one color coordinates both automatically. */
  isSticky?: boolean;
  fillOpacity?: number;
  fillTexture?: FillTextureKind;
  /** Independent color for the texture pattern lines/dots — defaults to
   *  the border color if not set, but can be different. */
  fillTextureColor?: string;
  /** Only meaningful when fillTexture !== "none". */
  fillTextureDensity?: PatternDensity;
  /** Independent of fillOpacity — lets the texture pattern be lighter/darker
   *  than the base fill color underneath it. */
  fillTextureOpacity?: number;
  borderStyle?: BorderStyle;
  /** Only meaningful when borderStyle is dashed/dotted/dash-dot. */
  borderDashDensity?: PatternDensity;
  /** Border opacity (0–100), independent of fill/overall opacity. */
  borderOpacity?: number;
}

/** Optional bend points (Stage 6) for poly-line / poly-connector rendering.
 *  Empty/undefined = original two-point behavior. Fully backward-compatible. */
export type BendPoints = Array<{ x: number; y: number }>;

export interface TextObject extends BaseObject {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  alignment?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase" | "capitalize";
}

export type LineKind = "straight" | "dashed" | "curved" | "connector";

export interface LineObject extends BaseObject {
  type: "line";
  lineKind: LineKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  label?: string;
  /** Text color for the label — independent of the line's own stroke color. */
  labelColor?: string;
  /** Rich (partially-formatted) HTML version of `label`. */
  labelRichText?: string;
  /** Standalone lines can also carry a relationship value. */
  relationshipValue?: RelationshipValue;
  /** Stage 6: optional bend points between start and end. */
  bendPoints?: BendPoints;
  /** Stage 6.1: optional explicit control point for `curved` lines.
   *  When undefined, the renderer falls back to its default perpendicular bow. */
  curveControl?: { x: number; y: number };
}

export type SymbolKind =
  | "thunderbolt"
  | "thunderbolt-bidi"
  | "loop"
  | "process-arrow"
  | "warning"
  | "flow-step";

export interface SymbolObject extends BaseObject {
  type: "symbol";
  symbolKind: SymbolKind;
  color?: string;
}

export interface FrameObject extends BaseObject {
  type: "frame";
  title?: string;
  /** Defaults to "solid" — was always hard-coded dashed before. */
  borderStyle?: BorderStyle;
}

export interface DrawingObject extends BaseObject {
  type: "drawing";
  points: Array<{ x: number; y: number }>;
}

/** Connector: a relationship line that stays attached to two shapes by magnets.
 *  Endpoints are derived from the source/target objects at render time, so the
 *  connector automatically reroutes when either shape moves or resizes. */
export interface ConnectorObject extends BaseObject {
  type: "connector";
  sourceObjectId: string;
  targetObjectId: string;
  sourceMagnet: MagnetSide;
  targetMagnet: MagnetSide;
  /** Routing style. Falls back to curved? boolean for legacy data. */
  routeType?: ConnectorRouteType;
  /** Reserved for future obstacle-aware routing (Phase 3+). */
  avoidObstacles?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  dashed?: boolean;
  /** Combinable with dashed — genuinely independent toggles, not a radio
   *  group. Only shown/used in "Έντασης" quality mode. */
  dotted?: boolean;
  wavy?: boolean;
  /** "Κάθετες" — short perpendicular tick marks along the line (genogram
   *  "cutoff relationship" convention). */
  tickMarks?: boolean;
  /** Only meaningful when dashed and/or dotted is on. */
  dashDensity?: "sparse" | "dense";
  /** @deprecated use routeType === "curved". Kept for legacy projects. */
  curved?: boolean;
  label?: string;
  /** Text color for the label — independent of the connector's own stroke color. */
  labelColor?: string;
  /** Rich (partially-formatted) HTML version of `label`. */
  labelRichText?: string;
  labelStyle?: {
    italic?: boolean;
    bold?: boolean;
    underline?: boolean;
    fontSize?: number;
    textTransform?: "none" | "uppercase" | "capitalize";
  };
  relationshipValue?: RelationshipValue;
  /** Stage 6: optional bend points between source and target. */
  bendPoints?: BendPoints;
  /** Stage 6: render style. "line" (default) or "lightning" jagged stroke. */
  connectorStyle?: "line" | "lightning";
  /** Controls zig-zag density for lightning style: 1 (sparse) to 10 (dense). Default 4. */
  lightningIntensity?: number;
  /** Stage 6.1: when true, the user has manually placed an endpoint and the
   *  auto-recompute on shape move/resize must NOT override sourceMagnet /
   *  targetMagnet for this connector. Cleared via "Αυτόματη επιλογή σημείου". */
  magnetLocked?: boolean;
  /** Stage 6.1: explicit control point for `routeType === "curved"` connectors
   *  with no bendPoints. When undefined, the renderer falls back to its
   *  default perpendicular bow. */
  curveControl?: { x: number; y: number };
}

export type CanvasObject =
  | ShapeObject
  | TextObject
  | LineObject
  | ConnectorObject
  | SymbolObject
  | FrameObject
  | DrawingObject;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  objects: CanvasObject[];
  viewport: Viewport;
  settings: Record<string, unknown>;
}

export const emptyCanvasState = (): CanvasState => ({
  objects: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
});
