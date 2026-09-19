// Greek voice helpers — Web Speech API only (no network, no API keys).
// Speech-to-text uses webkitSpeechRecognition (Chrome/Edge/Safari).
// Text-to-speech uses window.speechSynthesis. Both gracefully no-op on
// unsupported browsers; callers should check `isSpeechRecognitionSupported`
// / `isSpeechSynthesisSupported` before showing buttons.

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal structural types for the Web Speech API (not in lib.dom for all targets).
interface SRAlternative {
  transcript: string;
  confidence?: number;
}
interface SRResult {
  0: SRAlternative;
  isFinal: boolean;
  length: number;
}
interface SRResultList {
  length: number;
  [i: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SRCtor = new () => SRInstance;

function getSpeechRecognitionCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

const capitalizeFirst = (s: string) =>
  s.length === 0 ? s : s[0].toLocaleUpperCase("el-GR") + s.slice(1);

/** Dictation hook. Calls onFinalText with each FINAL utterance only —
 *  never on interim results, so callers don't trigger save churn. */
export function useDictation(opts: {
  lang?: string;
  onFinalText: (text: string) => void;
  onInterim?: (text: string) => void;
}) {
  const { lang = "el-GR", onFinalText, onInterim } = opts;
  const [listening, setListening] = useState(false);
  const recRef = useRef<SRInstance | null>(null);
  // Keep latest callbacks without re-creating the recognizer.
  const finalRef = useRef(onFinalText);
  const interimRef = useRef(onInterim);
  useEffect(() => {
    finalRef.current = onFinalText;
  }, [onFinalText]);
  useEffect(() => {
    interimRef.current = onInterim;
  }, [onInterim]);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;
    if (recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        /* stop() can throw if recognition already ended */
      }
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SREvent) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0]?.transcript ?? "";
        if (r.isFinal) {
          finalRef.current(capitalizeFirst(txt.trim()));
        } else {
          interim += txt;
        }
      }
      if (interim && interimRef.current) interimRef.current(interim);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      return true;
    } catch {
      setListening(false);
      return false;
    }
  }, [lang]);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* stop() can throw if recognition already ended */
    }
    setListening(false);
  }, []);

  useEffect(
    () => () => {
      try {
        recRef.current?.stop();
      } catch {
        /* stop() can throw if recognition already ended */
      }
    },
    [],
  );

  return { listening, start, stop, supported: isSpeechRecognitionSupported() };
}

/** Read text aloud in Greek. Returns a tiny controller. */
export function speak(text: string, lang = "el-GR") {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    // Prefer a Greek voice if one is installed.
    const voices = window.speechSynthesis.getVoices();
    const greek = voices.find((v) => v.lang?.toLowerCase().startsWith("el"));
    if (greek) u.voice = greek;
    window.speechSynthesis.speak(u);
  } catch {
    /* speechSynthesis can throw if the engine is busy or unavailable */
  }
}

export function stopSpeaking() {
  if (isSpeechSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* cancel() can throw if synthesis is already idle */
    }
  }
}
