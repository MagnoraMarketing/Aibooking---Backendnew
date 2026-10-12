import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIbooking.dk",
  description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
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
