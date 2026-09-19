import { auth } from "../firebase";
import type { CanvasState } from "./types";

const URL = "/api/board-payload";

export interface BoardPayload {
  state: CanvasState | null;
  revision: number;
  savedAt: number;
}
export interface SavedBoardPayload extends BoardPayload {
  success: true;
  payloadRef: string;
  payloadUrl: string;
  size: number;
  state: CanvasState;
}

export class PayloadApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function token(): Promise<string> {
  const user = auth().currentUser;
  if (!user) throw new PayloadApiError("Authentication required", 401);
  return user.getIdToken();
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!response.ok)
    throw new PayloadApiError(
      data?.error || `Board payload request failed (HTTP ${response.status})`,
      response.status,
    );
  if (!data)
    throw new PayloadApiError(
      "Board payload server returned invalid JSON",
      response.status,
    );
  return data as T;
}

export async function loadBoardPayload(mapId: string): Promise<BoardPayload> {
  const idToken = await token();
  const response = await fetch(`${URL}?mapId=${encodeURIComponent(mapId)}`, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: AbortSignal.timeout(45_000),
  });
  return responseJson<BoardPayload>(response);
}

export async function saveBoardPayload(
  mapId: string,
  state: CanvasState,
  baseState?: CanvasState | null,
  baseRevision?: number,
): Promise<SavedBoardPayload> {
  const idToken = await token();
  const body: Record<string, unknown> = { mapId, state };
  if (baseState !== undefined) body.baseState = baseState;
  if (baseRevision !== undefined) body.baseRevision = baseRevision;
  const request = () =>
    fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    });
  let response = await request();
  for (let attempt = 0; response.status === 409 && attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 600 * 2 ** attempt));
    response = await request();
  }
  const data = await responseJson<SavedBoardPayload>(response);
  if (
    data.success !== true ||
    !data.state ||
    typeof data.revision !== "number"
  ) {
    throw new PayloadApiError(
      "Board payload server returned an incomplete save response",
      response.status,
    );
  }
  return data;
}
