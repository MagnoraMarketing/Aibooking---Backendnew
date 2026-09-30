import type { MetadataRoute } from "next";

// Makes the dashboard installable as an app ("Installer app" in Chrome on
// Android, "Føj til hjemmeskærm" in Safari on iPhone). Served by Next at
// /manifest.webmanifest and linked from the root layout automatically.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AIbooking.dk",
    short_name: "AIbooking",
    description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#3866f5",
    lang: "da",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
