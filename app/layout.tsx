import type { ReactNode } from "react";
import { pramaanFonts } from "../lib/pramaan/fonts";
import { siteName } from "./site";
import { styleCandidates } from "./style-candidates";
import { StyleSwitcher } from "./style-switcher";
import "./theme.css";

// Pramaan's preview build sets this; a live build never does, so the switcher is absent there.
const stylePreview = process.env.PRAMAAN_STYLE_PREVIEW === "1" && styleCandidates.names.length > 1;

export const metadata = {
  title: { default: siteName, template: `%s · ${siteName}` },
  description: "Book an appointment online, in your own time zone.",
};

// Each page brings its own header: the visitor's (app/parts/site-header.tsx) or the owner area's
// (app/owner/owner-shell.tsx). Nav entries come from each feature's pramaan.feature.json.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={pramaanFonts}>
      <body className="flex min-h-dvh flex-col">
        {children}
        {stylePreview && <StyleSwitcher {...styleCandidates} />}
      </body>
    </html>
  );
}
