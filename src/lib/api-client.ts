import { auth } from "./firebase";

export async function apiRequest<T>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const user = auth().currentUser;
  if (!user) throw new Error("Authentication required");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as T & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error("The request timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
