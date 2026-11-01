"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { nav } from "../routes.generated";
import { siteName } from "../site";
import { api } from "./fetch";
import { Monogram } from "./illustrations";

let known: Promise<string> | null = null;
/** The business's name as the owner set it (Settings), else the app's; asked for once per page load. */
export function useBusinessName(given?: string) {
  const [name, setName] = useState(given?.trim() || "");
  useEffect(() => {
    if (given?.trim()) {
      setName(given.trim());
      return;
    }
    known ??= api<{ business: { name: string } }>("/api/booking/catalog")
      .then((catalog) => catalog.business.name)
      .catch(() => siteName);
    let live = true;
    void known.then((value) => {
      if (live) setName(value);
    });
    return () => {
      live = false;
    };
  }, [given]);
  return name || siteName;
}

/**
 * The visitor's header: the business's mark and name, and the nav entries features declare in their
 * pramaan.feature.json (scripts/generate-routes.mjs writes them to app/routes.generated.ts).
 */
export function SiteHeader({ name }: { name?: string }) {
  const shown = useBusinessName(name);
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-5 pt-6 sm:px-8">
      <Link href="/" className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg">
        <Monogram name={shown} className="h-10 w-10 shrink-0" />
        <span className="truncate font-display text-lg leading-tight sm:text-xl">{shown}</span>
      </Link>
      {nav.length > 0 && (
        <nav aria-label="Main" className="flex shrink-0 items-center gap-0.5 text-sm sm:gap-1">
          {nav.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold whitespace-nowrap text-muted hover:bg-accent-soft hover:text-fg sm:px-4"
            >
              {entry.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter({ name }: { name?: string }) {
  const shown = useBusinessName(name);
  return (
    <footer className="mx-auto mt-20 flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 border-t border-line px-5 py-6 text-sm text-muted sm:px-8">
      <p className="py-2">{shown} · Times are shown in your own time zone.</p>
      <Link
        href="/owner"
        className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        Owner area
      </Link>
    </footer>
  );
}
