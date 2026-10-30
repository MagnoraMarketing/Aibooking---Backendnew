import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.aibooking.dk"),
  title: "AIbooking.dk – log ind",
  description: "Log ind på AIbooking.dk og administrér jeres AI-receptionist, widget, opkald og bookinger.",
  // The customer app is not a landing page: aibooking.dk is the site that
  // should rank. noindex keeps login/signup out of search results so they
  // don't compete with it for the brand name; follow lets the links back to
  // www.aibooking.dk pass on what this subdomain has.
  robots: { index: false, follow: true },
  appleWebApp: { capable: true, title: "AIbooking", statusBarStyle: "default" },
  icons: { icon: "/app-icon/192.png", apple: "/app-icon/180.png" },
};

export const viewport: Viewport = { themeColor: "#264ed1" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
