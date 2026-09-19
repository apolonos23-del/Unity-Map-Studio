import type { SymbolObject } from "@/lib/canvas/types";

/** Symbol kinds that are pure stroke-based icons with no fillable area —
 *  the properties panel hides the "Γέμισμα" control for these. */
export const SYMBOL_KINDS_WITHOUT_FILL = new Set(["loop", "process-arrow"]);

/** Renders one of the symbol glyphs inside the object's bounding box. */
export function SymbolGlyph({ o }: { o: SymbolObject }) {
  const { x, y, width: w, height: h } = o;
  const stroke = o.color ?? o.stroke ?? "#0F172A";
  const fill = o.fill ?? "#FEF3C7";
  const sw = o.strokeWidth ?? 2;
  const cx = x + w / 2,
    cy = y + h / 2;
  const markerId = `sym-arrow-${o.id}`;

  switch (o.symbolKind) {
    case "thunderbolt":
    case "thunderbolt-bidi": {
      // Lightning bolt scaled into bbox
      const px = (rx: number) => x + (rx / 24) * w;
      const py = (ry: number) => y + (ry / 24) * h;
      const d = `M ${px(13)} ${py(2)} L ${px(4)} ${py(14)} L ${px(11)} ${py(14)} L ${px(10)} ${py(22)} L ${px(20)} ${py(10)} L ${px(13)} ${py(10)} Z`;
      return (
        <g>
          <path
            d={d}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          {o.symbolKind === "thunderbolt-bidi" && (
            <>
              <defs>
                <marker
                  id={`${markerId}-s`}
                  viewBox="0 0 10 10"
                  refX="1"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 10 0 L 0 5 L 10 10 z" fill={stroke} />
                </marker>
                <marker
                  id={`${markerId}-e`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
                </marker>
              </defs>
              <line
                x1={x}
                y1={cy}
                x2={x - 4}
                y2={cy}
                stroke={stroke}
                strokeWidth={sw}
                markerStart={`url(#${markerId}-s)`}
              />
              <line
                x1={x + w}
                y1={cy}
                x2={x + w + 4}
                y2={cy}
                stroke={stroke}
                strokeWidth={sw}
                markerEnd={`url(#${markerId}-e)`}
              />
            </>
          )}
        </g>
      );
    }
    case "loop": {
      const r = Math.min(w, h) / 2 - sw - 3;
      // Arc sweeping ~290° clockwise (SVG y-down), leaving a gap, with a
      // clear filled arrowhead at the end showing the cycle direction —
      // the old version's arrowhead was two barely-visible 4px ticks.
      const startDeg = -40;
      const endDeg = 250;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const sx = cx + r * Math.cos(toRad(startDeg));
      const sy = cy + r * Math.sin(toRad(startDeg));
      const ex = cx + r * Math.cos(toRad(endDeg));
      const ey = cy + r * Math.sin(toRad(endDeg));
      // Direction of travel at the end point (tangent for increasing angle).
      const tangent = toRad(endDeg) + Math.PI / 2;
      const headLen = Math.max(6, sw * 2.6);
      const headWidth = Math.max(4, sw * 1.8);
      const tipX = ex + headLen * 0.55 * Math.cos(tangent);
      const tipY = ey + headLen * 0.55 * Math.sin(tangent);
      const backX = ex - headLen * 0.45 * Math.cos(tangent);
      const backY = ey - headLen * 0.45 * Math.sin(tangent);
      const perpX = Math.cos(tangent + Math.PI / 2) * headWidth;
      const perpY = Math.sin(tangent + Math.PI / 2) * headWidth;
      return (
        <g color={stroke}>
          {/* Invisible full-bbox hit area — the arc+arrowhead alone leave
              the center empty, making the icon hard to grab/select there. */}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="none"
          />
          <path
            d={`M ${sx} ${sy} A ${r} ${r} 0 1 1 ${backX} ${backY}`}
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
            strokeLinecap="round"
          />
          <polygon
            points={`${tipX},${tipY} ${backX + perpX},${backY + perpY} ${backX - perpX},${backY - perpY}`}
            fill={stroke}
          />
        </g>
      );
    }
    case "process-arrow": {
      const midY = cy;
      return (
        <g color={stroke}>
          {/* Invisible full-bbox hit area, same reason as "loop". */}
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="transparent"
            stroke="none"
          />
          <defs>
            <marker
              id={`${markerId}-e`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
            </marker>
          </defs>
          <line
            x1={x + 4}
            y1={midY}
            x2={x + w - 8}
            y2={midY}
            stroke={stroke}
            strokeWidth={sw * 1.5}
            markerEnd={`url(#${markerId}-e)`}
          />
        </g>
      );
    }
    case "warning": {
      const px = (rx: number) => x + (rx / 24) * w;
      const py = (ry: number) => y + (ry / 24) * h;
      const d = `M ${px(12)} ${py(2)} L ${px(22)} ${py(20)} L ${px(2)} ${py(20)} Z`;
      return (
        <g>
          <path
            d={d}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
          <text
            x={cx}
            y={y + h * 0.7}
            textAnchor="middle"
            fill={stroke}
            fontSize={Math.min(w, h) * 0.4}
            fontWeight="bold"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            !
          </text>
        </g>
      );
    }
    case "flow-step":
    default: {
      return (
        <g>
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.min(w, h) * 0.2}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
          <line
            x1={x + 6}
            y1={y + h * 0.35}
            x2={x + w - 6}
            y2={y + h * 0.35}
            stroke={stroke}
            strokeWidth={1}
          />
          <line
            x1={x + 6}
            y1={y + h * 0.65}
            x2={x + w - 10}
            y2={y + h * 0.65}
            stroke={stroke}
            strokeWidth={1}
          />
        </g>
      );
    }
  }
}
