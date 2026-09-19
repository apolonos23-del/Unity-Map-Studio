import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./admin";
import { HttpError, string } from "./http";

function encryptionKey() {
  const value = process.env.AI_ENCRYPTION_KEY;
  const key = value ? Buffer.from(value, "base64") : null;
  if (!key || key.length !== 32)
    throw new HttpError(
      503,
      "Δεν έχει ρυθμιστεί η ασφαλής αποθήκευση του κλειδιού AI.",
    );
  return key;
}
function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
function decrypt(value: { iv: string; tag: string; ciphertext: string }) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
export async function aiSettings(uid: string, input?: Record<string, unknown>) {
  const ref = adminDb().doc(`users/${uid}/private/settings`);
  if (input) {
    const key =
      typeof input.openaiApiKey === "string" ? input.openaiApiKey.trim() : "";
    if (key && (!key.startsWith("sk-") || key.length > 512))
      throw new HttpError(400, "Μη έγκυρο κλειδί AI.");
    if (!key) await ref.delete();
    else
      await ref.set({
        encryptedKey: encrypt(key),
        lastFour: key.slice(-4),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }
  let data = (await ref.get()).data();
  // One-time migration of existing private plaintext keys, never returning the key to the browser.
  if (data?.openaiApiKey) {
    await ref.set({
      encryptedKey: encrypt(data.openaiApiKey),
      lastFour: data.openaiApiKey.slice(-4),
      updatedAt: FieldValue.serverTimestamp(),
    });
    data = (await ref.get()).data();
  }
  return {
    openaiApiKey: data?.encryptedKey ? `••••••••${data.lastFour}` : undefined,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}
export async function aiComplete(uid: string, input: Record<string, unknown>) {
  await aiSettings(uid);
  const data = (
    await adminDb().doc(`users/${uid}/private/settings`).get()
  ).data();
  if (!data?.encryptedKey)
    throw new HttpError(400, "Προσθέστε κλειδί AI στις Ρυθμίσεις.");
  if (
    !Array.isArray(input.messages) ||
    !input.messages.length ||
    input.messages.length > 8
  )
    throw new HttpError(400, "Μη έγκυρο αίτημα AI.");
  const messages = input.messages.map((message: unknown) => {
    const m = message as { role?: string; content?: unknown };
    if (!m || !["user", "system", "assistant"].includes(m.role ?? ""))
      throw new HttpError(400, "Μη έγκυρο μήνυμα.");
    return { role: m.role, content: string(m.content, "content", 12000) };
  });
  if (JSON.stringify(messages).length > 24000)
    throw new HttpError(413, "Το αίτημα AI είναι πολύ μεγάλο.");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decrypt(data.encryptedKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.4,
        max_completion_tokens: 4000,
        ...(input.jsonMode === true
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new HttpError(502, "Η υπηρεσία AI δεν απάντησε.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new HttpError(
      502,
      `Η υπηρεσία AI απέρριψε το αίτημα (HTTP ${response.status}). Ελέγξτε το κλειδί και το διαθέσιμο υπόλοιπο.`,
    );
  return {
    text: result?.choices?.[0]?.message?.content ?? "",
    tokens: result?.usage?.total_tokens,
  };
}
