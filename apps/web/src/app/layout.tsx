import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

/** Self-hosted at build time, so the page makes no request to a font host
 * and a visitor's browser tells nobody they were here. */
const serif = Playfair_Display({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--serif",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://zgrove.network"),
  title: "zGrove — mine to a shielded address",
  description:
    "Mine with your GPU through a proxy the pool cannot see past. Earnings settle in shielded ZEC, so no contributor's income is on any chain.",
  icons: {
    icon: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Mine to a shielded address.",
    description: "zgrove.network",
    url: "https://zgrove.network",
    siteName: "zGrove",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0e0f",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body>{children}</body>
    </html>
  );
}
