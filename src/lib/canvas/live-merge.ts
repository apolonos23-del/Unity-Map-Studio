import type { CanvasObject, CanvasState } from "./types";

const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Three-way field merge. Local explicit changes win conflicts; untouched
 * local fields accept remote changes. Missing keys are meaningful. */
export function mergeObject<T extends object>(base: T, local: T, remote: T): T {
  const result: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    const localChanged =
      own(local, key) !== own(base, key) ||
      !equal(
        (local as Record<string, unknown>)[key],
        (base as Record<string, unknown>)[key],
      );
    const source = localChanged ? local : remote;
    if (own(source, key))
      result[key] = (source as Record<string, unknown>)[key];
  }
  return result as T;
}

/** Pure deterministic merge shared by browser polling and the payload server. */
export function threeWayMerge(
  base: CanvasState,
  local: CanvasState,
  remote: CanvasState,
): CanvasState {
  const baseById = new Map(base.objects.map((item) => [item.id, item]));
  const localById = new Map(local.objects.map((item) => [item.id, item]));
  const remoteById = new Map(remote.objects.map((item) => [item.id, item]));
  const objects: CanvasObject[] = [];
  const ids = [
    ...remote.objects.map((item) => item.id),
    ...local.objects.map((item) => item.id),
  ].filter((id, index, all) => all.indexOf(id) === index);

  for (const id of ids) {
    const original = baseById.get(id);
    const localObject = localById.get(id);
    const remoteObject = remoteById.get(id);
    if (original && (!localObject || !remoteObject)) continue;
    if (localObject && remoteObject) {
      objects.push(
        original
          ? (mergeObject(
              original as unknown as Record<string, unknown>,
              localObject as unknown as Record<string, unknown>,
              remoteObject as unknown as Record<string, unknown>,
            ) as unknown as CanvasObject)
          : localObject,
      );
    } else if (localObject) objects.push(localObject);
    else if (remoteObject) objects.push(remoteObject);
  }

  return {
    objects,
    viewport: mergeObject(base.viewport, local.viewport, remote.viewport),
    settings: mergeObject(base.settings, local.settings, remote.settings),
  };
}
