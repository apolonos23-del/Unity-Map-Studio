// Stage 6: Pure geometry helpers for bend points on lines & connectors.
// Extracted so they can be unit-tested without a DOM/canvas environment.

import type { BendPoints } from "./types";

export interface Point {
  x: number;
  y: number;
}

/** Build the full ordered point list for a poly-line: [start, ...bend, end]. */
export function buildPolyPoints(
  start: Point,
  end: Point,
  bend?: BendPoints,
): Point[] {
  const mid =
    bend && bend.length > 0 ? bend.map((p) => ({ x: p.x, y: p.y })) : [];
  return [start, ...mid, end];
}

/** Build an SVG path 'd' attribute from a polyline (straight segments). */
export function polylinePath(points: Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return (
    `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
  );
}

/** Build an SVG path 'd' attribute that smooths through every point with
 *  quadratic curves through midpoints. Falls back to a straight line for
 *  fewer than 3 points. */
export function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return polylinePath(points);
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const cp = rest[i];
    const next = rest[i + 1];
    const midX = (cp.x + next.x) / 2;
    const midY = (cp.y + next.y) / 2;
    d += ` Q ${cp.x} ${cp.y} ${midX} ${midY}`;
  }
  const last = rest[rest.length - 1];
  d += ` T ${last.x} ${last.y}`;
  return d;
}

/** Build a jagged "lightning" SVG path between two points, routed through
 *  optional bend points. Adds zig-zag deflections perpendicular to each
 *  segment so the result reads as a lightning bolt.
 *  @param intensity 1 (sparse) to 10 (dense). Default 4. Controls how many
 *  zig-zags appear per 100px of line length — stays constant when line grows. */
/** Samples N+1 evenly-spaced points along a quadratic bezier curve — used
 *  to give the "lightning" (Έντασης) zigzag style a curved base path
 *  instead of only ever being able to zigzag a straight line. */
export function sampleQuadraticBezier(
  x1: number,
  y1: number,
  ctrlX: number,
  ctrlY: number,
  x2: number,
  y2: number,
  n = 6,
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    pts.push({
      x: mt * mt * x1 + 2 * mt * t * ctrlX + t * t * x2,
      y: mt * mt * y1 + 2 * mt * t * ctrlY + t * t * y2,
    });
  }
  return pts;
}

/** Arc-length-parametrized point + local perpendicular unit vector at
 *  fractional distance `t` (0..1) along a polyline. Shared by all the
 *  "follow the actual path" style helpers (lightning, wavy, tick marks)
 *  so a curved base path and a straight one produce identical density/
 *  amplitude — only the shape of the path differs, not the styling. */
export function pointAlong(
  pts: Point[],
  t: number,
): { x: number; y: number; px: number; py: number } {
  if (pts.length < 2)
    return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, px: 0, py: 1 };
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLens.push(l);
    total += l;
  }
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    const segLen = segLens[i] || 1;
    if (acc + segLen >= target || i === segLens.length - 1) {
      const localT = Math.max(0, Math.min(1, (target - acc) / segLen));
      const a = pts[i],
        b = pts[i + 1];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: a.x + dx * localT,
        y: a.y + dy * localT,
        px: -dy / len,
        py: dx / len,
      };
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, px: 0, py: 1 };
}

export function lightningPath(points: Point[], intensity = 4): string {
  if (points.length < 2) return polylinePath(points);
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  // Number of deflections proportional to intensity and TOTAL length —
  // computed once for the whole path, not per-segment, so a curved path
  // (sampled into several short segments) zigzags exactly the same as a
  // straight one of the same overall length.
  const numZigzags = Math.max(1, Math.round((total / 100) * intensity * 2));
  const mag = Math.max(2, Math.min(8, total * 0.06));
  // Short straight "lead-in/out" near each end so the arrowhead (oriented
  // along the path's local tangent right at the endpoint) points cleanly
  // at the target instead of whatever random angle the last zigzag
  // happened to be.
  const LEAD = 0.18;
  const first = pointAlong(points, 0);
  const segs: Point[] = [{ x: first.x, y: first.y }];
  for (let j = 1; j <= numZigzags; j++) {
    const t = j / (numZigzags + 1);
    if (t < LEAD || t > 1 - LEAD) continue;
    const sign = j % 2 === 0 ? 1 : -1;
    const p = pointAlong(points, t);
    segs.push({ x: p.x + p.px * mag * sign, y: p.y + p.py * mag * sign });
  }
  const last = points[points.length - 1];
  segs.push({ x: last.x, y: last.y });
  return polylinePath(segs);
}

/** Insert a new bend point at `index` (0 = before first bend, N = after last).
 *  Returns a new array; original is not mutated. */
export function insertBendPoint(
  bend: BendPoints | undefined,
  index: number,
  p: Point,
): BendPoints {
  const arr = bend ? bend.slice() : [];
  const i = Math.max(0, Math.min(arr.length, index));
  arr.splice(i, 0, { x: p.x, y: p.y });
  return arr;
}

/** Remove the bend point at the given index. Returns a new array. */
export function removeBendPoint(
  bend: BendPoints | undefined,
  index: number,
): BendPoints {
  if (!bend) return [];
  if (index < 0 || index >= bend.length) return bend.slice();
  const arr = bend.slice();
  arr.splice(index, 1);
  return arr;
}

/** Move the bend point at the given index to a new location. Returns a new array. */
export function moveBendPoint(
  bend: BendPoints | undefined,
  index: number,
  p: Point,
): BendPoints {
  if (!bend) return [];
  if (index < 0 || index >= bend.length) return bend.slice();
  const arr = bend.slice();
  arr[index] = { x: p.x, y: p.y };
  return arr;
}

/** Find the best segment index to insert a new bend point near `p`. Returns
 *  the index such that `insertBendPoint(bend, returned, p)` makes geometric
 *  sense (between the two endpoints that bracket `p`'s projection). */
export function nearestInsertIndex(
  start: Point,
  end: Point,
  bend: BendPoints | undefined,
  p: Point,
): number {
  const points = buildPolyPoints(start, end, bend);
  let bestSegment = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
    );
    const projx = a.x + dx * t;
    const projy = a.y + dy * t;
    const d = Math.hypot(p.x - projx, p.y - projy);
    if (d < bestDist) {
      bestDist = d;
      bestSegment = i;
    }
  }
  // segment i sits between full-index i and i+1; bend insertion index = i
  return bestSegment;
}

// ── Obstacle-aware orthogonal router (A* on coarse grid) ─────────────────────
// Used for "Αυτόματη" route type. Routes around shapes by finding a path on a
// grid with cells of CELL size, avoiding cells that overlap any obstacle bbox.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CELL = 20; // grid resolution in canvas units
const PAD = 14; // padding around each obstacle

/** Returns an orthogonal SVG path from (x1,y1) to (x2,y2) that avoids the
 *  given obstacle rectangles using A* on a coarse grid. Falls back to a
 *  simple 3-segment path if no route is found. */
export function autoRoutePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Rect[],
): string {
  // Grid bounds with generous margin
  const margin = CELL * 5;
  const gx0 = Math.floor((Math.min(x1, x2) - margin) / CELL);
  const gy0 = Math.floor((Math.min(y1, y2) - margin) / CELL);
  const gx1 = Math.ceil((Math.max(x1, x2) + margin) / CELL);
  const gy1 = Math.ceil((Math.max(y1, y2) + margin) / CELL);
  const cols = gx1 - gx0 + 1;
  const rows = gy1 - gy0 + 1;

  // Build blocked grid
  const blocked = new Uint8Array(cols * rows);
  for (const o of obstacles) {
    const ox0 = Math.floor((o.x - PAD) / CELL) - gx0;
    const oy0 = Math.floor((o.y - PAD) / CELL) - gy0;
    const ox1 = Math.ceil((o.x + o.w + PAD) / CELL) - gx0;
    const oy1 = Math.ceil((o.y + o.h + PAD) / CELL) - gy0;
    for (let cy = Math.max(0, oy0); cy <= Math.min(rows - 1, oy1); cy++) {
      for (let cx = Math.max(0, ox0); cx <= Math.min(cols - 1, ox1); cx++) {
        blocked[cy * cols + cx] = 1;
      }
    }
  }

  const idx = (cx: number, cy: number) => cy * cols + cx;
  const toG = (v: number, g0: number) => Math.round(v / CELL) - g0;
  const sx = toG(x1, gx0),
    sy = toG(y1, gy0);
  const ex = toG(x2, gx0),
    ey = toG(y2, gy0);

  // Clamp to grid
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  const scx = clamp(sx, 0, cols - 1),
    scy = clamp(sy, 0, rows - 1);
  const ecx = clamp(ex, 0, cols - 1),
    ecy = clamp(ey, 0, rows - 1);

  if (scx === ecx && scy === ecy) return `M ${x1} ${y1} L ${x2} ${y2}`;

  // A* — manhattan heuristic, 4-directional
  const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const h = (cx: number, cy: number) => Math.abs(cx - ecx) + Math.abs(cy - ecy);
  const dist = new Float32Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  dist[idx(scx, scy)] = 0;

  // Simple priority queue via sorted array (sufficient for small grids)
  const open: Array<[number, number, number]> = [[h(scx, scy), scx, scy]];

  let found = false;
  const MAX_ITER = cols * rows * 2;
  let iter = 0;

  while (open.length > 0 && iter++ < MAX_ITER) {
    open.sort((a, b) => a[0] - b[0]);
    const [, cx, cy] = open.shift()!;
    if (cx === ecx && cy === ecy) {
      found = true;
      break;
    }
    const d = dist[idx(cx, cy)];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (blocked[idx(nx, ny)]) continue;
      const nd = d + 1;
      if (nd < dist[idx(nx, ny)]) {
        dist[idx(nx, ny)] = nd;
        prev[idx(nx, ny)] = idx(cx, cy);
        open.push([nd + h(nx, ny), nx, ny]);
      }
    }
  }

  if (!found) {
    // Fallback: 3-segment orthogonal path
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }

  // Reconstruct path
  const path: Point[] = [];
  let cur = idx(ecx, ecy);
  while (cur !== -1) {
    const cy = Math.floor(cur / cols);
    const cx = cur % cols;
    path.unshift({ x: (cx + gx0) * CELL, y: (cy + gy0) * CELL });
    cur = prev[cur];
  }

  // Snap first/last point to actual connector endpoints
  if (path.length > 0) {
    path[0] = { x: x1, y: y1 };
    path[path.length - 1] = { x: x2, y: y2 };
  }

  // Simplify: remove collinear points
  const simplified: Point[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev2 = simplified[simplified.length - 1];
    const curr = path[i];
    const next = path[i + 1];
    const dx1 = curr.x - prev2.x,
      dy1 = curr.y - prev2.y;
    const dx2 = next.x - curr.x,
      dy2 = next.y - curr.y;
    // Keep point if direction changes
    if (dx1 * dy2 !== dx2 * dy1) simplified.push(curr);
  }
  simplified.push(path[path.length - 1]);

  return polylinePath(simplified);
}
