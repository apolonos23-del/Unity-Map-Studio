import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { pendingRole, useAuth, type UserRole } from "@/lib/auth-context";
import { ClientOnly } from "@/lib/client-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Map } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Σύνδεση — Unity Map Studio" }] }),
  component: () => (
    <ClientOnly fallback={<div className="min-h-screen" />}>
      <AuthPage />
    </ClientOnly>
  ),
});

function AuthPage() {
  const { user, signIn, signUp, sendPasswordReset, loading } = useAuth();
  const navigate = useNavigate();

  if (!loading && user) {
    navigate({ to: "/lobby" });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-3">
            <Map className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Unity Map Studio
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Συνεργατικοί εννοιολογικοί χάρτες
          </p>
        </div>

        <Card className="panel-soft p-6">
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="signin">Σύνδεση</TabsTrigger>
              <TabsTrigger value="signup">Εγγραφή</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <SignInForm
                onSignIn={signIn}
                onPasswordReset={sendPasswordReset}
              />
            </TabsContent>
            <TabsContent value="signup">
              <SignUpForm onSignUp={signUp} />
            </TabsContent>
          </Tabs>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Με τη σύνδεση συμφωνείτε με τους όρους χρήσης της πλατφόρμας.
        </p>
      </div>
    </div>
  );
}

function SignInForm({
  onSignIn,
  onPasswordReset,
}: {
  onSignIn: (e: string, p: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [resetting, setResetting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onSignIn(email, password);
      toast.success("Καλώς ήρθατε!");
      navigate({ to: "/lobby" });
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? (err as { code?: string }).code
          : undefined;
      toast.error("Σφάλμα σύνδεσης", { description: prettyAuthError(code) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div>
        <Label htmlFor="password">Κωδικός</Label>
        <Input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Σύνδεση
      </Button>
      <button
        type="button"
        className="w-full text-sm text-primary hover:underline disabled:opacity-50"
        disabled={resetting}
        onClick={async () => {
          if (!email.trim()) {
            toast.error("Συμπληρώστε πρώτα το email σας.");
            return;
          }
          setResetting(true);
          try {
            await onPasswordReset(email.trim());
            toast.success("Στείλαμε σύνδεσμο επαναφοράς στο email σας.");
          } catch (err) {
            toast.error("Η αποστολή απέτυχε", {
              description: prettyAuthError(
                err instanceof Error && "code" in err
                  ? (err as { code?: string }).code
                  : undefined,
              ),
            });
          } finally {
            setResetting(false);
          }
        }}
      >
        Ξέχασα τον κωδικό μου
      </button>
    </form>
  );
}

function SignUpForm({
  onSignUp,
}: {
  onSignUp: (
    e: string,
    p: string,
    n: string,
    r: UserRole,
    code?: string,
  ) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("student");
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const needsCode = role !== "student";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες");
      return;
    }
    if (needsCode && !accessCode.trim()) {
      toast.error(
        "Απαιτείται κωδικός πρόσβασης για ρόλο εκπαιδευτικού/θεραπευτή",
      );
      return;
    }
    setLoading(true);
    try {
      await onSignUp(email, password, name, role, accessCode);
      toast.success("Ο λογαριασμός δημιουργήθηκε!");
      navigate({ to: "/lobby" });
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? (err as { code?: string }).code
          : undefined;
      toast.error("Σφάλμα εγγραφής", { description: prettyAuthError(code) });
      if (pendingRole()) {
        toast.info(
          "Ο μαθητικός λογαριασμός δημιουργήθηκε. Ολοκληρώστε την αναβάθμιση ρόλου στις ρυθμίσεις.",
        );
        navigate({ to: "/settings" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="name">Όνομα προβολής</Label>
        <Input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="π.χ. Μαρία Παπαδοπούλου"
        />
      </div>
      <div>
        <Label htmlFor="email-up">Email</Label>
        <Input
          id="email-up"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      <div>
        <Label htmlFor="password-up">Κωδικός</Label>
        <Input
          id="password-up"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div>
        <Label htmlFor="role">Ρόλος</Label>
        <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
          <SelectTrigger id="role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="student">Μαθητής/τρια</SelectItem>
            <SelectItem value="teacher">Εκπαιδευτικός</SelectItem>
            <SelectItem value="therapist">Θεραπευτής/τρια</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {needsCode && (
        <div>
          <Label htmlFor="access-code">Κωδικός πρόσβασης εκπαιδευτικού</Label>
          <Input
            id="access-code"
            type="password"
            required
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            placeholder="Δοθείς από τον διαχειριστή"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Ο κωδικός επαληθεύεται με ασφάλεια πριν ενεργοποιηθεί ο επιλεγμένος
            ρόλος.
          </p>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Δημιουργία λογαριασμού
      </Button>
    </form>
  );
}

function prettyAuthError(code?: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "Μη έγκυρο email.";
    case "auth/user-not-found":
      return "Δεν βρέθηκε χρήστης με αυτό το email.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Λάθος email ή κωδικός.";
    case "auth/email-already-in-use":
      return "Το email χρησιμοποιείται ήδη.";
    case "auth/weak-password":
      return "Πολύ αδύναμος κωδικός (τουλάχιστον 6 χαρακτήρες).";
    case "auth/network-request-failed":
      return "Πρόβλημα δικτύου. Δοκιμάστε ξανά.";
    default:
      return "Δοκιμάστε ξανά σε λίγο.";
  }
}
