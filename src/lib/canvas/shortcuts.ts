import { useEffect } from "react";

interface Handlers {
  onDelete?: () => void;
  onDuplicate?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onResize?: (delta: number) => void;
  onTool?: (tool: "select" | "hand" | "text" | "line" | "arrow") => void;
  onEscape?: () => void;
  onGroup?: () => void;
  onUngroup?: () => void;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
  onCopyStyle?: () => void;
  onPasteStyle?: () => void;
  onLockToggle?: () => void;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable;
}

export function useCanvasShortcuts(
  h: Handlers,
  hasSelection: boolean,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (hasSelection) {
          e.preventDefault();
          h.onDelete?.();
        }
        return;
      }
      if (meta && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        h.onDuplicate?.();
        return;
      }
      if (meta && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) h.onRedo?.();
        else h.onUndo?.();
        return;
      }
      if (meta && (e.key === "+" || e.key === "=")) {
        if (hasSelection) {
          e.preventDefault();
          h.onResize?.(1.1);
        }
        return;
      }
      if (meta && e.key === "-") {
        if (hasSelection) {
          e.preventDefault();
          h.onResize?.(1 / 1.1);
        }
        return;
      }
      // Group / ungroup
      if (meta && (e.key === "g" || e.key === "G")) {
        if (hasSelection) {
          e.preventDefault();
          if (e.shiftKey) h.onUngroup?.();
          else h.onGroup?.();
        }
        return;
      }
      // Layering: Cmd+] front, Cmd+[ back
      if (meta && e.key === "]") {
        if (hasSelection) {
          e.preventDefault();
          h.onBringToFront?.();
        }
        return;
      }
      if (meta && e.key === "[") {
        if (hasSelection) {
          e.preventDefault();
          h.onSendToBack?.();
        }
        return;
      }
      // Copy / paste style: Cmd+Alt+C / Cmd+Alt+V
      if (meta && e.altKey && (e.key === "c" || e.key === "C")) {
        if (hasSelection) {
          e.preventDefault();
          h.onCopyStyle?.();
        }
        return;
      }
      if (meta && e.altKey && (e.key === "v" || e.key === "V")) {
        if (hasSelection) {
          e.preventDefault();
          h.onPasteStyle?.();
        }
        return;
      }
      // Lock toggle: Cmd+L
      if (meta && (e.key === "l" || e.key === "L")) {
        if (hasSelection) {
          e.preventDefault();
          h.onLockToggle?.();
        }
        return;
      }

      if (e.key === "Escape") {
        h.onEscape?.();
        return;
      }

      if (!meta && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case "v":
            h.onTool?.("select");
            break;
          case "h":
            h.onTool?.("hand");
            break;
          case "t":
            h.onTool?.("text");
            break;
          case "l":
            h.onTool?.("line");
            break;
          case "a":
            h.onTool?.("arrow");
            break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [h, hasSelection, enabled]);
}
