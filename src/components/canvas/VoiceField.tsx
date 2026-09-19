import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speak,
  stopSpeaking,
  useDictation,
} from "@/lib/voice";

interface VoiceFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** When true, render a single-line Input instead of a Textarea. */
  singleLine?: boolean;
  placeholder?: string;
  rows?: number;
  ariaLabel?: string;
}

/** Field with Greek dictation + read-aloud buttons.
 *  - Dictation only commits FINAL utterances (no save churn on interim).
 *  - Buttons are hidden if the browser lacks support (no fake buttons). */
export function VoiceField({
  value,
  onChange,
  singleLine,
  placeholder,
  rows = 3,
  ariaLabel,
}: VoiceFieldProps) {
  const [speaking, setSpeaking] = useState(false);
  const sttSupported = isSpeechRecognitionSupported();
  const ttsSupported = isSpeechSynthesisSupported();

  const dictation = useDictation({
    lang: "el-GR",
    onFinalText: (chunk) => {
      const sep = value && !/\s$/.test(value) ? " " : "";
      onChange((value + sep + chunk).trimStart());
    },
  });

  const toggleMic = () => {
    if (!sttSupported) {
      toast.error(
        "Η φωνητική λειτουργία δεν υποστηρίζεται σε αυτόν τον browser.",
      );
      return;
    }
    if (dictation.listening) dictation.stop();
    else {
      const ok = dictation.start();
      if (!ok) toast.error("Δεν ήταν δυνατή η εκκίνηση της υπαγόρευσης.");
    }
  };

  const toggleSpeak = () => {
    if (!ttsSupported) {
      toast.error(
        "Η ανάγνωση κειμένου δεν υποστηρίζεται σε αυτόν τον browser.",
      );
      return;
    }
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (!value.trim()) return;
    speak(value, "el-GR");
    setSpeaking(true);
    // Best-effort: clear flag when synthesis ends.
    const tick = () => {
      if (!window.speechSynthesis.speaking) setSpeaking(false);
      else setTimeout(tick, 400);
    };
    setTimeout(tick, 400);
  };

  return (
    <div className="space-y-1.5">
      {singleLine ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-8 text-sm"
          aria-label={ariaLabel}
        />
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="text-sm resize-none"
          aria-label={ariaLabel}
        />
      )}
      <div className="flex items-center gap-1">
        {sttSupported && (
          <Button
            type="button"
            variant={dictation.listening ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={toggleMic}
            title="Υπαγόρευση (Ελληνικά)"
          >
            {dictation.listening ? (
              <MicOff className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-3.5 w-3.5" />
            )}
            {dictation.listening ? "Διακοπή" : "Υπαγόρευση"}
          </Button>
        )}
        {ttsSupported && (
          <Button
            type="button"
            variant={speaking ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={toggleSpeak}
            disabled={!value.trim() && !speaking}
            title="Ανάγνωση (Ελληνικά)"
          >
            {speaking ? (
              <VolumeX className="h-3.5 w-3.5" />
            ) : (
              <Volume2 className="h-3.5 w-3.5" />
            )}
            {speaking ? "Σίγαση" : "Ανάγνωση"}
          </Button>
        )}
      </div>
    </div>
  );
}
