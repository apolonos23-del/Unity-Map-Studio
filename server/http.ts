import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "./admin.js";
import { createHash } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}
export function string(value: unknown, name: string, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `Μη έγκυρο πεδίο: ${name}`);
  return value.trim();
}
export function id(value: unknown, name = "id"): string {
  const result = string(value, name, 180);
  if (!/^[a-zA-Z0-9_-]+$/.test(result))
    throw new HttpError(400, `Μη έγκυρο αναγνωριστικό: ${name}`);
  return result;
}
export function body(req: ApiRequest): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new HttpError(400, "Απαιτούνται δεδομένα JSON.");
  if (Buffer.byteLength(JSON.stringify(req.body)) > 3_500_000)
    throw new HttpError(413, "Το σχέδιο είναι πολύ μεγάλο για μία αποθήκευση.");
  return req.body as Record<string, unknown>;
}
export async function authenticate(req: ApiRequest): Promise<DecodedIdToken> {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer "))
    throw new HttpError(401, "Απαιτείται σύνδεση.");
  try {
    return await adminAuth().verifyIdToken(header.slice(7), true);
  } catch {
    throw new HttpError(401, "Η σύνδεση έληξε. Συνδεθείτε ξανά.");
  }
}
export function sendError(res: ApiResponse, error: unknown) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(
    "API operation failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  res.status(500).json({
    error:
      "Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά ή ελέγξτε τη ρύθμιση του server.",
  });
}
export function privateResponse(res: ApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}
/** Persistent limiter: survives cold starts and multiple Vercel instances. */
export async function rateLimit(uid: string, bucket: string, max = 120) {
  const ref = adminDb().doc(
    `_rateLimits/${createHash("sha256").update(`${uid}:${bucket}`).digest("hex")}`,
  );
  await adminDb().runTransaction(async (tx) => {
    const old = (await tx.get(ref)).data();
    const now = Date.now();
    const count = old && old.until > now ? old.count + 1 : 1;
    if (count > max)
      throw new HttpError(
        429,
        "Πολλές προσπάθειες. Δοκιμάστε ξανά σε ένα λεπτό.",
      );
    tx.set(ref, {
      count,
      until: old && old.until > now ? old.until : now + 60_000,
    });
  });
}
