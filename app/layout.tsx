import type { ReactNode } from "react";
import { pramaanFonts } from "../lib/pramaan/fonts";
import { Shell } from "./shell";
import { siteName } from "./site";
import { styleCandidates } from "./style-candidates";
import { StyleSwitcher } from "./style-switcher";
import "./theme.css";

// Platform-owned: the theme and the fonts must load on every page, so a build cannot drop them. The page frame is the
// app's own, in app/shell.tsx.

// Pramaan's preview build sets this; a live build never does, so the switcher is absent there.
const stylePreview = process.env.PRAMAAN_STYLE_PREVIEW === "1" && styleCandidates.names.length > 1;

export const metadata = {
  title: { default: siteName, template: `%s · ${siteName}` },
  description: "Book an appointment online, in your own time zone.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pramaanFonts}>
      <body className="min-h-dvh">
        <Shell>{children}</Shell>
        {stylePreview && <StyleSwitcher {...styleCandidates} />}
      </body>
    </html>
  );
}
