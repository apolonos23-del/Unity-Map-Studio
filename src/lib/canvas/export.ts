// Canvas export utilities — PNG, SVG, JSON.
// Reads the live <svg id="ums-canvas-svg"> rendered by CanvasStage,
// serializes it with inlined dimensions, and triggers a browser download.

import type { CanvasState } from "./types";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getCanvasSvg(): SVGSVGElement | null {
  return document.getElementById("ums-canvas-svg") as SVGSVGElement | null;
}

/** Rasterizing an SVG containing <foreignObject> (used for rich-text
 *  labels) via canvas taints the canvas in most browsers — canvas.toBlob()
 *  then throws instead of producing an image. This walks the LIVE svg's
 *  foreignObjects (so getComputedStyle works — a detached clone can't
 *  compute styles), builds equivalent plain <text> elements, and swaps
 *  them into the clone at the same position/order. Only used for PNG;
 *  the SVG export keeps the richer foreignObject-based rendering. */
let __exportMeasureCtx: CanvasRenderingContext2D | null = null;
function exportWrapLines(
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  if (typeof document === "undefined") return [text];
  if (!__exportMeasureCtx) {
    __exportMeasureCtx = document.createElement("canvas").getContext("2d");
  }
  const ctx = __exportMeasureCtx;
  if (!ctx) return [text];
  ctx.font = font;
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

function replaceForeignObjectsWithText(
  liveSvg: SVGSVGElement,
  clone: SVGSVGElement,
) {
  const liveFos = Array.from(liveSvg.querySelectorAll("foreignObject"));
  const cloneFos = Array.from(clone.querySelectorAll("foreignObject"));
  liveFos.forEach((liveFo, i) => {
    const cloneFo = cloneFos[i];
    if (!cloneFo) return;
    const div = liveFo.querySelector("div");
    const text = (div?.textContent ?? "").trim();
    if (!text) {
      cloneFo.remove();
      return;
    }
    const x = parseFloat(liveFo.getAttribute("x") ?? "0");
    const y = parseFloat(liveFo.getAttribute("y") ?? "0");
    const w = parseFloat(liveFo.getAttribute("width") ?? "0");
    const h = parseFloat(liveFo.getAttribute("height") ?? "0");
    const cs = div ? window.getComputedStyle(div) : null;
    const fontSize = cs ? parseFloat(cs.fontSize) || 12 : 12;
    const color = cs?.color || "#0F172A";
    const fontWeight = cs?.fontWeight || "400";
    const fontStyle = cs?.fontStyle || "normal";
    const align = cs?.textAlign;
    const anchor =
      align === "center"
        ? "middle"
        : align === "right"
          ? "end"
          : align === "left"
            ? "start"
            : "middle";
    const anchorX =
      anchor === "middle" ? x + w / 2 : anchor === "end" ? x + w : x;
    const padding = 8; // matches the tooltip/label divs' own CSS padding
    const lineHeight = fontSize * 1.35;
    const wrapped = exportWrapLines(
      text,
      Math.max(10, w - padding * 2),
      `${fontStyle} ${fontWeight} ${fontSize}px sans-serif`,
    );
    const textEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    textEl.setAttribute("x", String(anchorX));
    textEl.setAttribute("text-anchor", anchor);
    textEl.setAttribute("font-size", String(fontSize));
    textEl.setAttribute("fill", color);
    textEl.setAttribute("font-weight", fontWeight);
    textEl.setAttribute("font-style", fontStyle);
    // Vertically center the whole wrapped block within the foreignObject's
    // original box, same as it visually appeared live.
    const blockH = wrapped.length * lineHeight;
    const firstBaselineY =
      y + Math.max(fontSize, (h - blockH) / 2 + fontSize * 0.85);
    wrapped.forEach((line, i) => {
      const tspan = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "tspan",
      );
      tspan.setAttribute("x", String(anchorX));
      tspan.setAttribute("y", String(firstBaselineY + i * lineHeight));
      tspan.textContent = line;
      textEl.appendChild(tspan);
    });
    cloneFo.replaceWith(textEl);
  });
}

function serializeSvg(svg: SVGSVGElement): {
  source: string;
  width: number;
  height: number;
} {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  const source = new XMLSerializer().serializeToString(clone);
  return {
    source: '<?xml version="1.0" encoding="UTF-8"?>\n' + source,
    width,
    height,
  };
}

function serializeSvgForRaster(svg: SVGSVGElement): {
  source: string;
  width: number;
  height: number;
} {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  replaceForeignObjectsWithText(svg, clone);
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  const source = new XMLSerializer().serializeToString(clone);
  return {
    source: '<?xml version="1.0" encoding="UTF-8"?>\n' + source,
    width,
    height,
  };
}

export function exportSVG(filename = "canvas.svg") {
  const svg = getCanvasSvg();
  if (!svg) throw new Error("Canvas not ready");
  const { source } = serializeSvg(svg);
  triggerDownload(
    new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
    filename,
  );
}

export async function exportPNG(
  filename = "canvas.png",
  scale = 2,
  background = "#ffffff",
) {
  const svg = getCanvasSvg();
  if (!svg) throw new Error("Canvas not ready");
  const { source, width, height } = serializeSvgForRaster(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to rasterize SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    await new Promise<void>((resolve) => {
      canvas.toBlob((b) => {
        if (b) triggerDownload(b, filename);
        resolve();
      }, "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── PDF export: canvas snapshot + a clear table of every object's info ──

const SHAPE_KIND_LABELS_EL: Record<string, string> = {
  rectangle: "Ορθογώνιο",
  "rounded-rectangle": "Στρογγυλεμένο ορθογώνιο",
  square: "Τετράγωνο",
  circle: "Κύκλος",
  oval: "Οβάλ",
  triangle: "Τρίγωνο",
  diamond: "Ρόμβος",
  polygon: "Πολύγωνο",
};
const SYMBOL_KIND_LABELS_EL: Record<string, string> = {
  thunderbolt: "Κεραυνός",
  "thunderbolt-bidi": "Κεραυνός (αμφίδρομος)",
  loop: "Βρόχος",
  "process-arrow": "Βέλος διαδικασίας",
  warning: "Προειδοποίηση",
  "flow-step": "Βήμα διαδικασίας",
};

function displayNameFor(o: CanvasState["objects"][number]): string {
  switch (o.type) {
    case "shape":
      return (
        o.text?.trim() ||
        `(${SHAPE_KIND_LABELS_EL[o.shapeKind] ?? "σχήμα"} χωρίς κείμενο)`
      );
    case "text":
      return o.text?.trim() || "(κενό κείμενο)";
    case "symbol":
      return SYMBOL_KIND_LABELS_EL[o.symbolKind] ?? "Σύμβολο";
    case "frame":
      return o.title?.trim() || "(πλαίσιο χωρίς τίτλο)";
    case "line":
    case "connector":
      return o.label?.trim() || "(σχέση χωρίς ετικέτα)";
    case "drawing":
      return "Ελεύθερο σχέδιο";
    default:
      return "—";
  }
}

function typeLabelFor(o: CanvasState["objects"][number]): string {
  switch (o.type) {
    case "shape":
      return SHAPE_KIND_LABELS_EL[o.shapeKind] ?? "Σχήμα";
    case "text":
      return "Κείμενο";
    case "symbol":
      return "Σύμβολο";
    case "frame":
      return "Πλαίσιο";
    case "line":
      return "Γραμμή";
    case "connector":
      return "Σύνδεσμος";
    case "drawing":
      return "Ελεύθερο σχέδιο";
    default:
      return "—";
  }
}

export async function exportPDF(
  state: CanvasState,
  projectTitle: string,
  filename = "canvas.pdf",
) {
  const [
    { jsPDF },
    { default: autoTable },
    { NOTO_SANS_REGULAR_BASE64, NOTO_SANS_BOLD_BASE64 },
  ] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    import("./pdf-font"),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  // jsPDF's built-in fonts (Helvetica etc.) only cover WinAnsi — Greek
  // text renders as garbled symbols with them. Embed a Greek-covering
  // font (subsetted Noto Sans) and use it for everything instead.
  doc.addFileToVFS("NotoSans-Regular.ttf", NOTO_SANS_REGULAR_BASE64);
  doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", NOTO_SANS_BOLD_BASE64);
  doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  doc.setFont("NotoSans", "normal");

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const dateStr = new Date().toLocaleDateString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const drawHeader = () => {
    doc.setFont("NotoSans", "bold");
    doc.setFontSize(18);
    doc.setTextColor(0);
    doc.text(projectTitle || "Χάρτης", margin, 44);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Εξαγωγή: ${dateStr}`, margin, 60);
    doc.setTextColor(0);
  };

  // ── Page 1: title + a large, clear snapshot of the diagram ──
  drawHeader();
  try {
    const svg = getCanvasSvg();
    if (svg) {
      const { source, width, height } = serializeSvgForRaster(svg);
      const pngDataUrl = await svgSourceToPngDataUrl(
        source,
        width,
        height,
        2,
        "#ffffff",
      );
      const top = 82;
      const maxImgW = pageWidth - margin * 2;
      const maxImgH = pageHeight - top - margin;
      const ratio = Math.min(maxImgW / width, maxImgH / height);
      const imgW = width * ratio;
      const imgH = height * ratio;
      const imgX = margin + (maxImgW - imgW) / 2; // centered horizontally
      doc.addImage(pngDataUrl, "PNG", imgX, top, imgW, imgH);
    }
  } catch (e) {
    console.warn("PDF snapshot image skipped", e);
  }

  // ── Page 2: the info table ──
  doc.addPage();
  drawHeader();
  const cursorY = 82;

  // ── Info table ──
  const byId = new Map(state.objects.map((o) => [o.id, o] as const));
  const rows: string[][] = [];
  let n = 1;
  for (const o of state.objects) {
    if (o.type === "line" || o.type === "connector") {
      const srcId = o.type === "connector" ? o.sourceObjectId : undefined;
      const tgtId = o.type === "connector" ? o.targetObjectId : undefined;
      const src = srcId ? displayNameFor(byId.get(srcId) ?? o) : "";
      const tgt = tgtId ? displayNameFor(byId.get(tgtId) ?? o) : "";
      const arrowStart = o.arrowStart ? "←" : "";
      const arrowEnd = o.arrowEnd ? "→" : "";
      const connection =
        srcId && tgtId
          ? `${src} ${arrowStart || "–"}${arrowEnd ? "" : ""} ${tgt}`.replace(
              /\s+/g,
              " ",
            )
          : "";
      const val = o.relationshipValue;
      const details = [
        connection &&
          `Σύνδεση: ${src} ${arrowStart}${!arrowStart && !arrowEnd ? "—" : ""}${arrowEnd} ${tgt}`.trim(),
        val !== undefined &&
          val !== 0 &&
          `Συντελεστής: ${val > 0 ? "+" : ""}${val}`,
      ]
        .filter(Boolean)
        .join(" · ");
      rows.push([
        String(n++),
        typeLabelFor(o),
        displayNameFor(o),
        o.notes?.trim() || "—",
        details || "—",
      ]);
    } else {
      rows.push([
        String(n++),
        typeLabelFor(o),
        displayNameFor(o),
        o.notes?.trim() || "—",
        "—",
      ]);
    }
  }

  if (rows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [["#", "Τύπος", "Ετικέτα / Κείμενο", "Σημειώσεις", "Λεπτομέρειες"]],
      body: rows,
      margin: { left: margin, right: margin },
      styles: {
        font: "NotoSans",
        fontSize: 9,
        cellPadding: 6,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [59, 130, 246],
        textColor: 255,
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { cellWidth: 90 },
        2: { cellWidth: 150 },
        3: { cellWidth: 180 },
      },
    });
  } else {
    doc.setFontSize(11);
    doc.text("Ο χάρτης δεν έχει ακόμα αντικείμενα.", margin, cursorY + 20);
  }

  doc.save(filename);
}

/** Shared by exportPNG and exportPDF's embedded snapshot. */
function svgSourceToPngDataUrl(
  source: string,
  width: number,
  height: number,
  scale: number,
  background: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D unavailable");
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to rasterize SVG"));
    };
    img.src = url;
  });
}

export function exportJSON(state: CanvasState, filename = "canvas.json") {
  const payload = JSON.stringify(
    { schemaVersion: 1, exportedAt: Date.now(), state },
    null,
    2,
  );
  triggerDownload(new Blob([payload], { type: "application/json" }), filename);
}

export function importJSON(file: File): Promise<CanvasState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = JSON.parse(text);
        const state = (parsed?.state ?? parsed) as CanvasState;
        if (!state || !Array.isArray(state.objects))
          throw new Error("Invalid canvas file");
        resolve(state);
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsText(file);
  });
}
