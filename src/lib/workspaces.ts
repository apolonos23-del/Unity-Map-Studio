// Workspace presets drive which tools the toolbar exposes per workspace.

import { GENOGRAM_TOOLS, type GenogramTool } from "./canvas/genogram";
import type { WorkspaceType } from "./canvas/types";

export type ToolId =
  | GenogramTool
  | "select"
  | "hand"
  | "marquee"
  | "shape.rectangle"
  | "shape.rounded-rectangle"
  | "shape.square"
  | "shape.circle"
  | "shape.oval"
  | "shape.triangle"
  | "shape.diamond"
  | "shape.polygon"
  | "line.straight"
  | "line.dashed"
  | "line.arrow-end"
  | "line.arrow-start"
  | "line.arrow-both"
  | "line.curved"
  | "line.connector"
  | "line.lightning"
  | "text"
  | "sticky"
  | "pencil"
  | "symbol.thunderbolt"
  | "symbol.thunderbolt-bidi"
  | "symbol.loop"
  | "symbol.process-arrow"
  | "symbol.warning"
  | "symbol.flow-step"
  | "frame";

export interface WorkspacePreset {
  id: WorkspaceType;
  label: string;
  allowedTools: ToolId[];
}

const COMMON_TOOLS: ToolId[] = [
  "select",
  "hand",
  "marquee",
  "shape.rectangle",
  "shape.rounded-rectangle",
  "shape.square",
  "shape.circle",
  "shape.oval",
  "shape.triangle",
  "shape.diamond",
  "shape.polygon",
  "line.straight",
  "line.dashed",
  "line.arrow-end",
  "line.arrow-both",
  "line.curved",
  "line.connector",
  "line.lightning",
  "text",
  "sticky",
  "pencil",
  "symbol.thunderbolt",
  "symbol.thunderbolt-bidi",
  "symbol.loop",
  "symbol.process-arrow",
  "symbol.warning",
  "symbol.flow-step",
  "frame",
];

export const WORKSPACES: Record<WorkspaceType, WorkspacePreset> = {
  "case-analysis": {
    id: "case-analysis",
    label: "Ανάλυση Περίπτωσης",
    allowedTools: COMMON_TOOLS,
  },
  "concept-analysis": {
    id: "concept-analysis",
    label: "Εννοιολογική Ανάλυση",
    allowedTools: COMMON_TOOLS,
  },
  "free-drawing": {
    id: "free-drawing",
    label: "Ελεύθερο Σχέδιο",
    allowedTools: COMMON_TOOLS,
  },
  genogram: {
    id: "genogram",
    label: "Γενεόγραμμα",
    allowedTools: [...COMMON_TOOLS, ...GENOGRAM_TOOLS],
  },
};

// Every visible tool now has a working implementation.
export const IMPLEMENTED_TOOLS = new Set<ToolId>([
  ...COMMON_TOOLS,
  ...GENOGRAM_TOOLS,
]);
