import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, Send } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { aiChat, aiGenerate, loadAISettings, summarizeCanvas } from "@/lib/ai";
import { mapStore } from "@/lib/canvas/storage";
import type { CanvasObject } from "@/lib/canvas/types";

interface Props {
  mapId: string;
  onInsert: (objects: CanvasObject[]) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

export function AIPanel({ mapId, onInsert }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<ChatMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [genInput, setGenInput] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  useEffect(() => {
    setApiKey(null);
    setChatLog([]);
  }, [user?.uid]);

  useEffect(() => {
    if (!open || !user) return;
    loadAISettings(user.uid)
      .then((s) => {
        setApiKey(s.openaiApiKey ?? null);
        if (s.model) setModel(s.model);
      })
      .catch((e) => console.warn("load AI settings", e));
  }, [open, user]);

  const noKey = apiKey === null || apiKey === "";

  const sendChat = async () => {
    if (!apiKey || !chatInput.trim()) return;
    const q = chatInput.trim();
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text: q }]);
    setChatBusy(true);
    try {
      const cur = (await mapStore.load(mapId)) ?? {
        objects: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
      };
      const { text, tokens } = await aiChat({
        apiKey,
        model,
        question: q,
        canvasSummary: summarizeCanvas(cur),
      });
      setChatLog((l) => [
        ...l,
        {
          role: "assistant",
          text: tokens ? `${text}\n\n(~${tokens} tokens)` : text,
        },
      ]);
    } catch (e) {
      toast.error("AI σφάλμα", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setChatBusy(false);
    }
  };

  const runGenerate = async () => {
    if (!apiKey || !genInput.trim()) return;
    setGenBusy(true);
    try {
      const objects = await aiGenerate({
        apiKey,
        model,
        prompt: genInput.trim(),
      });
      if (!objects.length) {
        toast.error("Δεν παρήχθησαν αντικείμενα");
      } else {
        onInsert(objects);
        toast.success(`Προστέθηκαν ${objects.length} αντικείμενα`);
        setOpen(false);
      }
    } catch (e) {
      toast.error("AI σφάλμα", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5">
          <Sparkles className="h-4 w-4" />
          AI Βοηθός
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[420px] sm:max-w-[420px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Βοηθός
          </SheetTitle>
        </SheetHeader>

        {noKey ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
            <p className="text-sm text-muted-foreground">
              Δεν έχει οριστεί κλειδί OpenAI για τον λογαριασμό σας.
            </p>
            <Button asChild variant="outline">
              <Link to="/settings">Άνοιγμα Ρυθμίσεων</Link>
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="chat" className="flex-1 flex flex-col mt-3">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="chat">Συνομιλία</TabsTrigger>
              <TabsTrigger value="generate">Δημιουργία</TabsTrigger>
            </TabsList>

            <TabsContent
              value="chat"
              className="flex-1 flex flex-col min-h-0 mt-3 gap-2"
            >
              <div className="flex-1 overflow-y-auto border border-border rounded-md p-3 space-y-3 text-sm">
                {chatLog.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Ρωτήστε κάτι σχετικά με τον τρέχοντα πίνακα.
                  </p>
                )}
                {chatLog.map((m, i) => (
                  <div
                    key={i}
                    className={
                      m.role === "user"
                        ? "text-foreground"
                        : "text-muted-foreground whitespace-pre-wrap"
                    }
                  >
                    <span className="font-medium mr-1">
                      {m.role === "user" ? "Εσείς:" : "AI:"}
                    </span>
                    {m.text}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  rows={2}
                  placeholder="π.χ. πώς να βελτιώσω αυτόν τον χάρτη;"
                />
                <Button
                  size="icon"
                  onClick={sendChat}
                  disabled={chatBusy || !chatInput.trim()}
                >
                  {chatBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent
              value="generate"
              className="flex-1 flex flex-col mt-3 gap-2"
            >
              <p className="text-xs text-muted-foreground">
                Περιγράψτε τι θέλετε στον καμβά. Τα αντικείμενα θα προστεθούν ως
                ένα βήμα Undo.
              </p>
              <Textarea
                value={genInput}
                onChange={(e) => setGenInput(e.target.value)}
                rows={4}
                placeholder="π.χ. φτιάξε γενεόγραμμα για οικογένεια 4 ατόμων"
              />
              <Button
                onClick={runGenerate}
                disabled={genBusy || !genInput.trim()}
              >
                {genBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Δημιουργία
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
