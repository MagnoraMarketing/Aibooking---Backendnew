import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIbooking.dk",
  description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
  applicationName: "Magnora",
  appleWebApp: { capable: true, title: "Magnora", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans text-slate-900 antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
