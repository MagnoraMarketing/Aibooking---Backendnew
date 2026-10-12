import type { MetadataRoute } from "next";

// Lets customers install the dashboard as an app ("Hent app") on their phone
// or desktop. It opens straight on /dashboard; middleware.ts sends anyone
// without a session to /login first.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard",
    name: "AIbooking.dk",
    short_name: "AIbooking",
    description: "Styr jeres AI-receptionist, opkald og bookinger.",
    lang: "da",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#264ed1",
    icons: [
      { src: "/app-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
