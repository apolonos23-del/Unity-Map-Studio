// Save payload — single shape for solo/live/collaborativeFinal boards.
// Versioned so we can migrate when the object model evolves.

import {
  SCHEMA_VERSION,
  type CanvasState,
  type ProjectMode,
  type SaveStatus,
  type WorkspaceType,
} from "./types";

export interface MapPayload {
  mapId: string;
  title: string;
  workspaceType: WorkspaceType;
  mode: ProjectMode;
  ownerUserId: string;
  participantIds: string[];
  sourceMapId: string | null;
  liveSessionId: string | null;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  saveStatus: SaveStatus;
  canvasState: CanvasState;
  metadata: {
    appVersion: string;
    schemaVersion: number;
    lastEditedBy: string | null;
    lastSavedAt: number | null;
  };
}

export const APP_VERSION = "0.2.0";

export function makeMetadata(
  lastEditedBy: string | null = null,
  lastSavedAt: number | null = null,
): MapPayload["metadata"] {
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    lastEditedBy,
    lastSavedAt,
  };
}

// Cheap deterministic hash for dirty-state detection. Not cryptographic.
export function hashCanvasState(s: CanvasState): string {
  const json = JSON.stringify(s);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = (h << 5) - h + json.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}
