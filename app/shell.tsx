import type { ReactNode } from "react";

// The app's own page frame, kept out of the platform-owned app/layout.tsx. Each page brings its own header: the
// visitor's (app/parts/site-header.tsx) or the owner area's (app/owner/owner-shell.tsx). Nav entries come from each
// feature's pramaan.feature.json.
export function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col">{children}</div>;
}
