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
  console.info("[COLLAB_DIAG]", {
    version: "2026-09-21.1",
    event: "SUBSCRIBE",
    at: Date.now(),
    mapId,
    path: `projects/${mapId}/snapshots/current`,
  });

  const unsubscribe = onSnapshot(
    snapshotRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        console.info("[COLLAB_DIAG]", {
          version: "2026-09-21.1",
          event: "EVENT_NO_SNAPSHOT",
          at: Date.now(),
          mapId,
        });
        return;
      }
      const value = snapshot.data() as {
        revision?: unknown;
        savedAt?: unknown;
      };
      if (typeof value.revision !== "number") {
        console.info("[COLLAB_DIAG]", {
          version: "2026-09-21.1",
          event: "EVENT_BAD_REVISION",
          at: Date.now(),
          mapId,
          revisionType: typeof value.revision,
        });
        return;
      }

      const savedAtValue = value.savedAt as FirestoreTimestampLike | number | undefined;
      const savedAt =
        typeof savedAtValue === "number"
          ? savedAtValue
          : typeof savedAtValue?.toMillis === "function"
            ? savedAtValue.toMillis()
            : 0;

      console.info("[COLLAB_DIAG]", {
        version: "2026-09-21.1",
        event: "EVENT_RECEIVED",
        at: Date.now(),
        mapId,
        revision: value.revision,
        savedAt,
      });
      onSignal({
        revision: value.revision,
        savedAt,
      });
    },
    (error) => {
      // Polling in CanvasStage remains the fallback if the realtime listener
      // is temporarily unavailable, so a listener error must not crash the UI.
      console.warn("[COLLAB_DIAG]", {
        version: "2026-09-21.1",
        event: "LISTENER_ERROR",
        at: Date.now(),
        mapId,
        code: (error as { code?: string }).code ?? null,
        message: error.message,
      });
      console.warn("Board Firestore live-sync listener failed", error);
    },
  );

  return () => {
    console.info("[COLLAB_DIAG]", {
      version: "2026-09-21.1",
      event: "UNSUBSCRIBE",
      at: Date.now(),
      mapId,
    });
    unsubscribe();
  };
}
