import type { CanvasObject, LineObject, ShapeObject } from "./types";
export const GENOGRAM_TOOLS = [
  "genogram.male",
  "genogram.female",
  "genogram.unknown",
  "genogram.deceased",
  "genogram.partner",
  "genogram.separated",
  "genogram.child",
] as const;
export type GenogramTool = (typeof GENOGRAM_TOOLS)[number];
export function createGenogramObjects(
  tool: GenogramTool,
  x: number,
  y: number,
): CanvasObject[] {
  const groupId = crypto.randomUUID();
  const base = () => ({
    id: crypto.randomUUID(),
    groupId,
    rotation: 0,
    stroke: "#1f2937",
    strokeWidth: 2,
    fill: "#ffffff",
    zIndex: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): LineObject => ({
    ...base(),
    type: "line",
    lineKind: "straight",
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    x1,
    y1,
    x2,
    y2,
  });
  if (
    [
      "genogram.male",
      "genogram.female",
      "genogram.unknown",
      "genogram.deceased",
    ].includes(tool)
  ) {
    const shape: ShapeObject = {
      ...base(),
      type: "shape",
      shapeKind:
        tool === "genogram.female"
          ? "circle"
          : tool === "genogram.unknown"
            ? "diamond"
            : "square",
      x: x - 30,
      y: y - 30,
      width: 60,
      height: 60,
    };
    return tool === "genogram.deceased"
      ? [
          shape,
          line(x - 30, y - 30, x + 30, y + 30),
          line(x + 30, y - 30, x - 30, y + 30),
        ]
      : [shape];
  }
  const partner = line(x - 60, y, x + 60, y);
  return tool === "genogram.separated"
    ? [partner, line(x - 6, y - 12, x + 6, y + 12)]
    : tool === "genogram.child"
      ? [partner, line(x, y, x, y + 70)]
      : [partner];
}
