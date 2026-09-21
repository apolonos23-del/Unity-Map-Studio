import type { CanvasObject, CanvasState, Viewport } from "./types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface CanvasStateDiff {
  upserts: CanvasObject[];
  removals: string[];
  settingsChanged: boolean;
  viewportChanged: boolean;
}

export function diffCanvasState(
  base: CanvasState,
  next: CanvasState,
): CanvasStateDiff {
  const before = new Map(base.objects.map((object) => [object.id, object]));
  const after = new Map(next.objects.map((object) => [object.id, object]));
  const upserts: CanvasObject[] = [];
  const removals: string[] = [];

  for (const object of next.objects) {
    const previous = before.get(object.id);
    if (!previous || !sameJson(previous, object)) upserts.push(clone(object));
  }
  for (const object of base.objects) {
    if (!after.has(object.id)) removals.push(object.id);
  }

  return {
    upserts,
    removals,
    settingsChanged: !sameJson(base.settings, next.settings),
    viewportChanged: !sameJson(base.viewport, next.viewport),
  };
}

export function hasCanvasChanges(base: CanvasState, next: CanvasState): boolean {
  const diff = diffCanvasState(base, next);
  return (
    diff.upserts.length > 0 ||
    diff.removals.length > 0 ||
    diff.settingsChanged ||
    diff.viewportChanged
  );
}

export function upsertCanvasObject(
  state: CanvasState,
  object: CanvasObject,
): CanvasState {
  const index = state.objects.findIndex((candidate) => candidate.id === object.id);
  if (index >= 0) {
    if (sameJson(state.objects[index], object)) return state;
    const objects = [...state.objects];
    objects[index] = clone(object);
    return { ...state, objects };
  }
  return { ...state, objects: [...state.objects, clone(object)] };
}

export function removeCanvasObject(state: CanvasState, objectId: string): CanvasState {
  if (!state.objects.some((object) => object.id === objectId)) return state;
  return {
    ...state,
    objects: state.objects.filter((object) => object.id !== objectId),
  };
}

export function mergeSavedLocalChanges(
  latestRemote: CanvasState,
  baseAtSave: CanvasState,
  localAtSave: CanvasState,
): CanvasState {
  const diff = diffCanvasState(baseAtSave, localAtSave);
  let next = latestRemote;
  for (const object of diff.upserts) next = upsertCanvasObject(next, object);
  for (const objectId of diff.removals) next = removeCanvasObject(next, objectId);
  if (diff.settingsChanged) next = { ...next, settings: clone(localAtSave.settings) };
  if (diff.viewportChanged) next = { ...next, viewport: clone(localAtSave.viewport) };
  return next;
}

export function validViewport(value: unknown): value is Viewport {
  if (!value || typeof value !== "object") return false;
  const viewport = value as Viewport;
  return (
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0
  );
}

export function isCanvasObject(value: unknown): value is CanvasObject {
  if (!value || typeof value !== "object") return false;
  const object = value as CanvasObject;
  return (
    typeof object.id === "string" &&
    object.id.length > 0 &&
    ["shape", "line", "connector", "text", "symbol", "frame", "drawing"].includes(
      object.type,
    ) &&
    [object.x, object.y, object.width, object.height, object.zIndex].every((number) =>
      Number.isFinite(number),
    )
  );
}

export function sanitizeForFirebase<T>(value: T): T {
  return clone(value);
}
