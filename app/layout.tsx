import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIbooking.dk",
  description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
  applicationName: "AIbooking",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iPhone reads these instead of the manifest when the dashboard is added
  // to the home screen from Safari.
  appleWebApp: {
    capable: true,
    title: "AIbooking",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#3866f5",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body className="font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
