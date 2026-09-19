// insert-into-board.ts
// Shared logic for "send these selected objects into another board" —
// used both for inserting a personal draft/selection into a live lesson's
// main board or a specific group's board, and could be reused anywhere
// else objects need to move between boards. Works purely through
// mapStore, so it doesn't matter whether the TARGET board is currently
// open anywhere — the next live poll on that page (if any) will pick up
// the change within a couple of seconds, same as any other remote edit.

import { mapStore } from "./storage";
import { emptyCanvasState, type CanvasObject, type CanvasState } from "./types";

const genId = () => Math.random().toString(36).slice(2, 10);

/** Deep-clones the given objects, gives every one of them a brand new id,
 *  remaps every internal reference (groupId, connector endpoints) to the
 *  new ids, and shifts every x-coordinate by `offsetX` so the inserted
 *  content lands to the right of whatever's already there instead of
 *  stacking directly on top of it. References to objects that were NOT
 *  part of the selection (e.g. a connector copied without one of its
 *  endpoints) are left pointing at their original id — a reasonable,
 *  rare edge case, not actively broken. */
export function regenerateAndOffsetObjects(
  objects: CanvasObject[],
  offsetX: number,
  offsetY = 0,
): CanvasObject[] {
  const idMap = new Map<string, string>();
  objects.forEach((o) => idMap.set(o.id, genId()));
  const remapId = (id: string | null | undefined) =>
    id && idMap.has(id) ? idMap.get(id)! : id;

  return objects.map((original) => {
    const o = JSON.parse(JSON.stringify(original)) as CanvasObject;
    o.id = idMap.get(original.id)!;
    o.x = original.x + offsetX;
    o.y = original.y + offsetY;
    o.groupId = remapId(o.groupId) ?? null;
    o.createdAt = Date.now();
    o.updatedAt = Date.now();

    if (o.type === "line") {
      o.x1 = o.x1 + offsetX;
      o.x2 = o.x2 + offsetX;
      o.y1 = o.y1 + offsetY;
      o.y2 = o.y2 + offsetY;
      if (o.bendPoints)
        o.bendPoints = o.bendPoints.map((p) => ({
          x: p.x + offsetX,
          y: p.y + offsetY,
        }));
      if (o.curveControl)
        o.curveControl = {
          x: o.curveControl.x + offsetX,
          y: o.curveControl.y + offsetY,
        };
    } else if (o.type === "connector") {
      o.sourceObjectId = remapId(o.sourceObjectId) ?? o.sourceObjectId;
      o.targetObjectId = remapId(o.targetObjectId) ?? o.targetObjectId;
      if (o.bendPoints)
        o.bendPoints = o.bendPoints.map((p) => ({
          x: p.x + offsetX,
          y: p.y + offsetY,
        }));
      if (o.curveControl)
        o.curveControl = {
          x: o.curveControl.x + offsetX,
          y: o.curveControl.y + offsetY,
        };
    } else if (o.type === "drawing") {
      o.points = o.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
    }

    return o;
  });
}

/** Loads the target board, computes an offset that places the incoming
 *  objects just to the right of whatever's already on it, and saves the
 *  merged result. Used for "send to live lesson" / "send to group". */
export async function insertObjectsIntoBoard(
  targetMapId: string,
  sourceObjects: CanvasObject[],
): Promise<void> {
  if (sourceObjects.length === 0) return;
  const current = (await mapStore.load(targetMapId)) ?? emptyCanvasState();

  const INSERT_GAP = 240;
  const currentRight =
    current.objects.length > 0
      ? Math.max(...current.objects.map((o) => o.x + o.width))
      : 0;
  const sourceLeft = Math.min(...sourceObjects.map((o) => o.x));
  const offsetX =
    current.objects.length > 0 ? currentRight + INSERT_GAP - sourceLeft : 0;

  const inserted = regenerateAndOffsetObjects(sourceObjects, offsetX);
  const next: CanvasState = {
    ...current,
    objects: [...current.objects, ...inserted],
  };
  await mapStore.save(targetMapId, next, { inline: true });
}
