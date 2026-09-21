import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export interface BoardSyncSignal {
  revision: number;
  savedAt: number;
}

type FirestoreTimestampLike = {
  toMillis?: () => number;
};

/**
 * Real-time notification for collaborative boards.
 *
 * The canonical save transaction already updates
 * projects/{mapId}/snapshots/current in Firestore. Listening to that exact
 * document makes the live notification atomic with the saved revision: if a
 * save succeeds, collaborators observe the new revision without depending on
 * a second RTDB write. The board JSON itself still stays in the protected
 * payload API and is fetched by CanvasStage after this signal.
 */
export function subscribeBoardSync(
  mapId: string,
  onSignal: (signal: BoardSyncSignal) => void,
): () => void {
  const snapshotRef = doc(db(), "projects", mapId, "snapshots", "current");

  return onSnapshot(
    snapshotRef,
    (snapshot) => {
      if (!snapshot.exists()) return;
      const value = snapshot.data() as {
        revision?: unknown;
        savedAt?: unknown;
      };
      if (typeof value.revision !== "number") return;

      const savedAtValue = value.savedAt as FirestoreTimestampLike | number | undefined;
      const savedAt =
        typeof savedAtValue === "number"
          ? savedAtValue
          : typeof savedAtValue?.toMillis === "function"
            ? savedAtValue.toMillis()
            : 0;

      onSignal({
        revision: value.revision,
        savedAt,
      });
    },
    (error) => {
      // Polling in CanvasStage remains the fallback if the realtime listener
      // is temporarily unavailable, so a listener error must not crash the UI.
      console.warn("Board Firestore live-sync listener failed", error);
    },
  );
}
