// AI requests and encrypted settings are handled by the authenticated Vercel API.
import { apiRequest } from "./api-client";
import { nanoid } from "nanoid";
import type { CanvasObject, CanvasState } from "./canvas/types";
interface SettingsDoc {
  openaiApiKey?: string;
  model?: string;
  updatedAt?: unknown;
}
export async function loadAISettings(_uid: string): Promise<SettingsDoc> {
  return apiRequest<SettingsDoc>("ai-settings");
}
export async function saveAISettings(
  _uid: string,
  patch: SettingsDoc,
): Promise<void> {
  await apiRequest("save-ai-settings", {
    openaiApiKey: patch.openaiApiKey ?? "",
  });
}

export function maskKey(k?: string): string {
  if (!k) return "—";
  if (k.length < 8) return "•••";
  return `••••••••${k.slice(-4)}`;
}

// ── Canvas summary helpers ───────────────────────────────────────────
export function summarizeCanvas(state: CanvasState): string {
  const counts: Record<string, number> = {};
  const labels: string[] = [];
  for (const o of state.objects) {
    counts[o.type] = (counts[o.type] ?? 0) + 1;
    const t =
      (o as { text?: string; label?: string; title?: string }).text ??
      (o as { text?: string; label?: string; title?: string }).label ??
      (o as { text?: string; label?: string; title?: string }).title;
    if (t && typeof t === "string" && t.trim())
      labels.push(t.trim().slice(0, 60));
  }
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v}× ${k}`)
    .join(", ");
  return `Canvas has ${state.objects.length} objects (${summary || "empty"}). Labels: ${
    labels.slice(0, 30).join(" | ") || "(none)"
  }`;
}

// ── OpenAI calls ─────────────────────────────────────────────────────
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

async function callOpenAI(
  _apiKey: string,
  _model: string,
  messages: OpenAIMessage[],
  jsonMode = false,
): Promise<{ text: string; tokens?: number }> {
  return apiRequest<{ text: string; tokens?: number }>("ai-complete", {
    messages,
    jsonMode,
  });
}

export async function aiChat(opts: {
  apiKey: string;
  model?: string;
  question: string;
  canvasSummary: string;
}): Promise<{ text: string; tokens?: number }> {
  return callOpenAI(opts.apiKey, opts.model || DEFAULT_MODEL, [
    {
      role: "system",
      content:
        "Είσαι βοηθός εκπαιδευτικού/θεραπευτή σε διαδραστικό λευκό πίνακα. Απάντησε σύντομα, στα Ελληνικά, με πρακτικές συμβουλές. Έχεις περιγραφή του τρέχοντος καμβά αλλά όχι τα ίδια τα δεδομένα.",
    },
    {
      role: "user",
      content: `Τρέχων καμβάς: ${opts.canvasSummary}\n\nΕρώτηση: ${opts.question}`,
    },
  ]);
}

// ── Structured generation ────────────────────────────────────────────
interface GenObject {
  type: "shape" | "text" | "line";
  shapeKind?: "rectangle" | "rounded-rectangle" | "circle" | "oval" | "diamond";
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  arrowEnd?: boolean;
}

export async function aiGenerate(opts: {
  apiKey: string;
  model?: string;
  prompt: string;
}): Promise<CanvasObject[]> {
  const sys = `Παράγεις JSON για έναν λευκό πίνακα. Επιστρέφεις ΜΟΝΟ JSON της μορφής:
{"objects":[{"type":"shape"|"text"|"line", "shapeKind":"rectangle|rounded-rectangle|circle|oval|diamond" (only for shape), "text": string (optional), "x":number, "y":number, "width":number, "height":number, "fontSize":number, "x1":number,"y1":number,"x2":number,"y2":number,"arrowEnd":boolean (only for line)}]}
Συντεταγμένες σε pixels, ξεκίνα κοντά στο (200,200), μέγεθος αντικειμένων ~140x70, καμβάς ~1200x800. Μέγιστο 30 αντικείμενα.`;
  const { text } = await callOpenAI(
    opts.apiKey,
    opts.model || DEFAULT_MODEL,
    [
      { role: "system", content: sys },
      { role: "user", content: opts.prompt },
    ],
    true,
  );
  let parsed: { objects?: GenObject[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Η απάντηση δεν ήταν έγκυρο JSON.");
  }
  const raw = Array.isArray(parsed.objects) ? parsed.objects.slice(0, 30) : [];
  return raw.map((o) => sanitize(o)).filter((o): o is CanvasObject => !!o);
}

function clamp(n: number, lo: number, hi: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function sanitize(o: GenObject): CanvasObject | null {
  const now = Date.now();
  const base = {
    id: nanoid(8),
    rotation: 0,
    zIndex: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (o.type === "text") {
    return {
      ...base,
      type: "text",
      x: clamp(o.x, -2000, 4000, 200),
      y: clamp(o.y, -2000, 4000, 200),
      width: clamp(o.width ?? 200, 40, 1000, 200),
      height: clamp(o.height ?? 32, 16, 400, 32),
      text: String(o.text ?? "").slice(0, 280),
      fontSize: clamp(o.fontSize ?? 16, 8, 64, 16),
    } as CanvasObject;
  }
  if (o.type === "line") {
    const x1 = clamp(o.x1 ?? 0, -2000, 4000, 0);
    const y1 = clamp(o.y1 ?? 0, -2000, 4000, 0);
    const x2 = clamp(o.x2 ?? 100, -2000, 4000, 100);
    const y2 = clamp(o.y2 ?? 0, -2000, 4000, 0);
    return {
      ...base,
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
      arrowEnd: !!o.arrowEnd,
      stroke: "#64748b",
      strokeWidth: 1.5,
    } as CanvasObject;
  }
  // shape (default)
  return {
    ...base,
    type: "shape",
    shapeKind: o.shapeKind ?? "rounded-rectangle",
    x: clamp(o.x, -2000, 4000, 200),
    y: clamp(o.y, -2000, 4000, 200),
    width: clamp(o.width ?? 140, 20, 1200, 140),
    height: clamp(o.height ?? 70, 20, 1200, 70),
    text: o.text ? String(o.text).slice(0, 140) : undefined,
    fontSize: clamp(o.fontSize ?? 14, 8, 48, 14),
    fill: "#ffffff",
    stroke: "#94a3b8",
    strokeWidth: 1.5,
  } as CanvasObject;
}
