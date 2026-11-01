"use client";
// The owner area's frame: who is signed in, the owner's navigation, and the gate for everyone else. Pramaan's
// "Open as owner" signs the founder in through /api/account/owner-pass and lands here.
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { api, currentUser, type SessionUser } from "../parts/fetch";
import { Monogram } from "../parts/illustrations";
import { useBusinessName } from "../parts/site-header";
import { Button, Skeleton } from "../ui";

const OwnerContext = createContext<SessionUser | null>(null);

/** The signed-in owner, inside the owner area. */
export function useOwner() {
  const owner = useContext(OwnerContext);
  if (!owner) throw new Error("useOwner is for pages under app/owner");
  return owner;
}

/** The owner's API: every call carries x-app-user, so a session that changed account is refused. */
export function ownerCall<T>(owner: SessionUser, path: string, body?: unknown) {
  return api<T>(path, { body, user: owner.id });
}

const NAV = [
  { href: "/owner/classes", label: "Classes", icon: CalendarDays },
  { href: "/owner/roles", label: "Roles", icon: Users },
  { href: "/owner/email", label: "Email", icon: Settings },
  { href: "/records", label: "Records", icon: ListChecks },
  { href: "/owner", label: "Today", icon: LayoutDashboard },
  { href: "/owner/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/owner/services", label: "Services", icon: ListChecks },
  { href: "/owner/staff", label: "Staff", icon: Users },
  { href: "/owner/hours", label: "Hours and days off", icon: Clock3 },
  { href: "/owner/settings", label: "Settings", icon: Settings },
];

export function OwnerShell({ children }: { children: ReactNode }) {
  const [owner, setOwner] = useState<SessionUser | null | undefined>(undefined);
  const path = usePathname();
  const businessName = useBusinessName();
  useEffect(() => {
    void currentUser().then((user) => setOwner(user?.role === "owner" ? user : null));
  }, []);

  if (owner === undefined)
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-5 py-16">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64" />
      </main>
    );
  if (owner === null)
    return (
      <main className="mx-auto w-full max-w-xl px-5 py-20">
        <section className="card space-y-4 p-8">
          <p className="eyebrow">Owner area</p>
          <h1 className="font-display text-3xl">This area is for the owner</h1>
          <p className="text-muted">
            Open the app as its owner from Pramaan, or sign in with the owner's email and password.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/account" className="button-primary inline-flex min-h-11 items-center">
              Sign in
            </Link>
            <Link href="/" className="button-secondary inline-flex min-h-11 items-center">
              Back to the booking page
            </Link>
          </div>
        </section>
      </main>
    );

  const current = (href: string) =>
    href === "/owner" ? path === "/owner" : path?.startsWith(href);
  return (
    <OwnerContext.Provider value={owner}>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row">
        <aside className="border-b border-line px-4 pt-5 pb-3 lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:border-r lg:border-b-0 lg:px-5 lg:py-8">
          <Link href="/owner" className="mb-4 flex min-h-11 items-center gap-3 lg:mb-8">
            <Monogram name={businessName} className="h-9 w-9 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate font-display text-lg leading-tight">
                {businessName}
              </span>
              <span className="block text-xs text-muted">Owner area</span>
            </span>
          </Link>
          <nav
            aria-label="Owner"
            className="-mx-1 flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible"
          >
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-current={current(href) ? "page" : undefined}
                className="flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-sm font-semibold text-muted hover:bg-accent-soft hover:text-fg aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg"
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 hidden space-y-2 border-t border-line pt-6 text-sm lg:block">
            <Link href="/" className="flex min-h-11 items-center gap-2 text-muted hover:text-fg">
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
              View booking page
            </Link>
            <p className="truncate text-xs text-muted">
              {owner.email ?? "Signed in through Pramaan"}
            </p>
            <Button
              className="px-4! py-1.5!"
              onClick={() =>
                void api("/api/account/signout", { body: {}, user: owner.id }).finally(() =>
                  window.location.assign("/"),
                )
              }
            >
              Sign out
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">{children}</main>
      </div>
    </OwnerContext.Provider>
  );
}

/** A page's title row. */
export function OwnerHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="font-display text-4xl leading-tight">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-3">{children}</div>}
    </div>
  );
}
