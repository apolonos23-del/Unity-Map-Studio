import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { InvitationListener } from "@/components/live/InvitationListener";
import { LiveBroadcastListener } from "@/components/live/LiveBroadcastListener";
import { QuotaWarningSurface } from "@/components/QuotaWarningSurface";
import { Button } from "@/components/ui/button";
import {
  Map,
  FolderOpen,
  Users,
  Archive,
  LogOut,
  Settings,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type NavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  search?: Record<string, string>;
  badge?: number;
};

function mainNav(): NavItem[] {
  return [
    {
      to: "/lobby",
      search: { tab: "projects" },
      label: "Τα Έργα μου",
      icon: <FolderOpen className="h-4 w-4" />,
    },
    {
      to: "/lobby",
      search: { tab: "collab" },
      label: "Συνεργατικά",
      icon: <Users className="h-4 w-4" />,
    },
    {
      to: "/lobby",
      search: { tab: "received" },
      label: "Σχέδια που έλαβα",
      icon: <Mail className="h-4 w-4" />,
    },
    {
      to: "/lobby",
      search: { tab: "archive" },
      label: "Αρχείο",
      icon: <Archive className="h-4 w-4" />,
    },
  ];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut, user } = useAuth();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const isTeacher =
    profile?.role === "teacher" || profile?.role === "therapist";
  const items = mainNav();
  const currentTab = (location.search as { tab?: string })?.tab ?? "projects";

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-sidebar flex flex-col">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <Map className="h-4 w-4 text-primary" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">
              Unity Map
            </span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Studio v2
            </span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <div className="px-2 pb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {isTeacher ? "Πίνακας εκπαιδευτικού" : "Πίνακας μαθητή"}
          </div>
          {items.map((item) => {
            const active =
              location.pathname === "/lobby" && currentTab === item.search?.tab;
            return (
              <Link
                key={item.label}
                to={item.to}
                search={item.search}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <span
                  className={cn(
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="pill bg-primary/10 text-primary text-[10px]">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-semibold text-primary">
              {(profile?.displayName ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {profile?.displayName}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {roleLabel(profile?.role)}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth" });
              }}
              title="Αποσύνδεση"
              aria-label="Αποσύνδεση"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur flex items-center justify-between px-6 sticky top-0 z-10">
          <div className="text-sm text-muted-foreground">
            <Link to="/lobby" className="hover:text-foreground">
              Lobby
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              title="Ρυθμίσεις"
              aria-label="Ρυθμίσεις"
            >
              <Link to="/settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </header>
        <div className="flex-1 min-h-0">{children}</div>
      </main>
      <InvitationListener />
      <LiveBroadcastListener />
      <QuotaWarningSurface />
    </div>
  );
}

function roleLabel(role?: string) {
  switch (role) {
    case "teacher":
      return "Εκπαιδευτικός";
    case "therapist":
      return "Θεραπευτής/τρια";
    case "student":
      return "Μαθητής/τρια";
    default:
      return "—";
  }
}
