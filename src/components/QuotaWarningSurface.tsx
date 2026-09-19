/**
 * Global Firestore quota warning surface. Mounted once in AppShell.
 * Shows a single dismissible toast at WARN, a persistent banner at CRITICAL.
 *
 * The CRITICAL banner is intentionally persistent (not auto-dismissed) to
 * push the teacher to wrap up the session and avoid hitting the hard
 * Firebase free-tier daily cap. Polling features (e.g. CanvasStage live
 * sync) consult isCritical() and stop automatic refreshes when set.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { subscribeQuota, type QuotaLevel } from "@/lib/quota-guard";

export function QuotaWarningSurface() {
  const [level, setLevel] = useState<QuotaLevel>("ok");
  const [warnedOnce, setWarnedOnce] = useState(false);

  useEffect(() => {
    return subscribeQuota((s) => {
      setLevel((prev) => {
        if (
          s.level === "warn" &&
          prev !== "warn" &&
          prev !== "critical" &&
          !warnedOnce
        ) {
          toast.warning("Προσοχή στη χρήση δεδομένων", {
            description:
              "Η χρήση Firestore πλησιάζει στο συνιστώμενο όριο ασφαλείας για σήμερα.",
          });
          setWarnedOnce(true);
        }
        return s.level;
      });
    });
  }, [warnedOnce]);

  if (level !== "critical") return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[92%] px-4 py-3 rounded-lg shadow-lg bg-red-600 text-white text-sm">
      <strong className="font-medium">Κρίσιμο όριο χρήσης Firestore.</strong>{" "}
      Συνιστούμε να ολοκληρώσετε / παύσετε τη ζωντανή συνεδρία σύντομα. Οι
      αυτόματες ανανεώσεις έχουν απενεργοποιηθεί προσωρινά (χειροκίνητη
      αποθήκευση εξακολουθεί να λειτουργεί). Ξαναφορτώστε τη σελίδα για να
      μηδενίσετε τους εσωτερικούς μετρητές.
    </div>
  );
}
