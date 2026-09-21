import { onValue, ref } from "firebase/database";
import { rtdb } from "../firebase";

export interface BoardSyncSignal {
  revision: number;
  savedAt: number;
}

/**
 * Lightweight real-time notification for collaborative boards.
 * The actual board JSON stays in the board payload API; RTDB only tells
 * connected clients that a newer revision exists so they can fetch it
 * immediately instead of waiting for the polling fallback.
 */
export function subscribeBoardSync(
  mapId: string,
  onSignal: (signal: BoardSyncSignal) => void,
): () => void {
  const signalRef = ref(rtdb(), `boardSync/${mapId}`);
  return onValue(signalRef, (snapshot) => {
    const value = snapshot.val() as Partial<BoardSyncSignal> | null;
    if (!value || typeof value.revision !== "number") return;
    onSignal({
      revision: value.revision,
      savedAt: typeof value.savedAt === "number" ? value.savedAt : 0,
    });
  });
}
