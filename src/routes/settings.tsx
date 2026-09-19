import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pendingRole, useAuth } from "@/lib/auth-context";
import { ClientOnly } from "@/lib/client-only";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, KeyRound, ArrowLeft, Trash2 } from "lucide-react";
import { loadAISettings, saveAISettings, maskKey } from "@/lib/ai";
import { subscribeQuota, type QuotaSnapshot } from "@/lib/quota-guard";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Ρυθμίσεις — Unity Map Studio" }] }),
  component: () => (
    <ClientOnly fallback={<div className="min-h-screen bg-background" />}>
      <SettingsGate />
    </ClientOnly>
  ),
});

function SettingsGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);
  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <AppShell>
      <SettingsPage />
    </AppShell>
  );
}

function SettingsPage() {
  const {
    user,
    profile,
    changeDisplayName,
    sendPasswordReset,
    claimRole,
    deleteAccount,
  } = useAuth();
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const upgradeRole = pendingRole();

  useEffect(() => {
    if (!user) return;
    loadAISettings(user.uid)
      .then((s) => {
        setCurrentKey(s.openaiApiKey ?? null);
      })
      .finally(() => setLoaded(true));
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveAISettings(user.uid, {
        openaiApiKey: input.trim() || undefined,
      });
      setCurrentKey(input.trim() ? `••••${input.trim().slice(-4)}` : null);
      setInput("");
      toast.success("Αποθηκεύτηκε");
    } catch (e) {
      toast.error("Αποτυχία αποθήκευσης", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await saveAISettings(user.uid, { openaiApiKey: "" });
      setCurrentKey(null);
      toast.success("Το κλειδί αφαιρέθηκε");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ρυθμίσεις</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Λογαριασμός και ενσωμάτωση OpenAI.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-2">
          <Link to="/lobby">
            <ArrowLeft className="h-4 w-4" />
            Lobby
          </Link>
        </Button>
      </div>

      <Card className="panel-soft p-6 space-y-5">
        <div>
          <h2 className="font-medium">Λογαριασμός</h2>
          <p className="text-xs text-muted-foreground mt-1">{user?.email}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="display-name">Όνομα προβολής</Label>
          <div className="flex gap-2">
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Button
              disabled={accountBusy || !displayName.trim()}
              onClick={async () => {
                setAccountBusy(true);
                try {
                  await changeDisplayName(displayName);
                  toast.success("Το όνομα ενημερώθηκε.");
                } catch (e) {
                  toast.error("Η ενημέρωση απέτυχε", {
                    description: e instanceof Error ? e.message : undefined,
                  });
                } finally {
                  setAccountBusy(false);
                }
              }}
            >
              Αποθήκευση
            </Button>
          </div>
        </div>
        <Button
          variant="outline"
          disabled={accountBusy || !user?.email}
          onClick={async () => {
            if (!user?.email) return;
            setAccountBusy(true);
            try {
              await sendPasswordReset(user.email);
              toast.success("Στείλαμε σύνδεσμο αλλαγής κωδικού στο email σας.");
            } catch (e) {
              toast.error("Η αποστολή απέτυχε", {
                description: e instanceof Error ? e.message : undefined,
              });
            } finally {
              setAccountBusy(false);
            }
          }}
        >
          Αποστολή συνδέσμου αλλαγής κωδικού
        </Button>

        {upgradeRole && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3 text-amber-950">
            <div>
              <h3 className="font-medium">Ολοκλήρωση αναβάθμισης ρόλου</h3>
              <p className="text-xs mt-1">
                Ο λογαριασμός σας δημιουργήθηκε ως μαθητικός, αλλά η αναβάθμιση
                δεν ολοκληρώθηκε. Εισαγάγετε ξανά τον κωδικό πρόσβασης.
              </p>
            </div>
            <Input
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Κωδικός πρόσβασης"
            />
            <Button
              disabled={accountBusy || !accessCode.trim()}
              onClick={async () => {
                setAccountBusy(true);
                try {
                  await claimRole(upgradeRole, accessCode.trim());
                  setAccessCode("");
                  toast.success("Ο ρόλος ενεργοποιήθηκε.");
                } catch (e) {
                  toast.error("Η αναβάθμιση απέτυχε", {
                    description:
                      e instanceof Error ? e.message : "Δοκιμάστε ξανά.",
                  });
                } finally {
                  setAccountBusy(false);
                }
              }}
            >
              Δοκιμή ξανά
            </Button>
          </div>
        )}

        <div className="border-t pt-5 space-y-2">
          <Label htmlFor="delete-password">Διαγραφή λογαριασμού</Label>
          <p className="text-xs text-muted-foreground">
            Πληκτρολογήστε τον τρέχοντα κωδικό σας. Αν φιλοξενείτε ενεργό
            μάθημα, τερματίστε το πρώτα.
          </p>
          <div className="flex gap-2">
            <Input
              id="delete-password"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Τρέχων κωδικός"
            />
            <Button
              variant="destructive"
              disabled={accountBusy || !deletePassword}
              onClick={async () => {
                if (
                  !window.confirm(
                    "Να διαγραφεί οριστικά ο λογαριασμός και τα δεδομένα του;",
                  )
                )
                  return;
                setAccountBusy(true);
                try {
                  await deleteAccount(deletePassword);
                  toast.success("Ο λογαριασμός διαγράφηκε.");
                  window.location.assign("/auth");
                } catch (e) {
                  toast.error("Η διαγραφή απέτυχε", {
                    description: e instanceof Error ? e.message : undefined,
                  });
                  setAccountBusy(false);
                }
              }}
            >
              Διαγραφή
            </Button>
          </div>
        </div>
      </Card>

      {isTeacher && (
        <Card className="panel-soft p-6">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="font-medium">OpenAI API key</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Το κλειδί αποθηκεύεται κρυπτογραφημένο για τον λογαριασμό σας. Οι
            κλήσεις προς το OpenAI εκτελούνται από τον server. Εδώ εμφανίζονται
            μόνο οι τελευταίοι τέσσερις χαρακτήρες.
          </p>

          {loaded ? (
            <div className="space-y-4">
              <div className="text-sm">
                Τρέχον κλειδί:{" "}
                <code className="px-2 py-0.5 rounded bg-muted text-xs">
                  {maskKey(currentKey ?? undefined)}
                </code>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openai-key">Νέο κλειδί (sk-...)</Label>
                <Input
                  id="openai-key"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="sk-..."
                  type="password"
                  autoComplete="off"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={save} disabled={saving || !input.trim()}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Αποθήκευση
                </Button>
                {currentKey && (
                  <Button variant="outline" onClick={remove} disabled={saving}>
                    <Trash2 className="h-4 w-4 mr-2" /> Αφαίρεση
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </Card>
      )}

      {isTeacher && <QuotaDebugCard />}
    </div>
  );
}

function QuotaDebugCard() {
  const [snap, setSnap] = useState<QuotaSnapshot | null>(null);
  useEffect(() => subscribeQuota(setSnap), []);
  if (!snap) return null;
  const rPct = Math.min(100, Math.round((snap.reads / snap.readBudget) * 100));
  const wPct = Math.min(
    100,
    Math.round((snap.writes / snap.writeBudget) * 100),
  );
  return (
    <Card className="panel-soft p-6">
      <h2 className="font-medium mb-1">
        Εκτίμηση χρήσης Firestore (αυτή η συνεδρία)
      </h2>
      <p className="text-xs text-muted-foreground mb-4">
        Εσωτερική προσέγγιση — δεν είναι το επίσημο μετρητικό του Firebase.
        Μηδενίζεται σε κάθε επαναφόρτωση σελίδας. Επίπεδο:{" "}
        <strong className="capitalize">{snap.level}</strong>.
      </p>
      <div className="space-y-3 text-sm">
        <Bar
          label="Αναγνώσεις"
          value={snap.reads}
          max={snap.readBudget}
          pct={rPct}
        />
        <Bar
          label="Εγγραφές"
          value={snap.writes}
          max={snap.writeBudget}
          pct={wPct}
        />
      </div>
    </Card>
  );
}

function Bar({
  label,
  value,
  max,
  pct,
}: {
  label: string;
  value: number;
  max: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value} / ~{max} ({pct}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={
            pct >= 85
              ? "h-full bg-red-500"
              : pct >= 60
                ? "h-full bg-amber-500"
                : "h-full bg-emerald-500"
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
