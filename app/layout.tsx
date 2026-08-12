import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIbooking.dk",
  description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
