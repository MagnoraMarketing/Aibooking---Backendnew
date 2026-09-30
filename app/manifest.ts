import type { MetadataRoute } from "next";

// Web app manifest — makes the dashboard installable on phones ("Installer"
// in Chrome / "Føj til hjemmeskærm" in Safari) so it opens as a standalone
// app with the Magnora icon instead of a Chrome shortcut.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "Magnora",
    short_name: "Magnora",
    description: "AI voice widgets for businesses — multi-tenant SaaS platform.",
    lang: "da",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
