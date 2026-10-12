import QRCode from "qrcode";
import { getPublicAppUrl } from "@/lib/app-url";

// QR code on the login page: scanning it on a phone opens the login with the
// "Hent app" steps showing, so the customer can add the app to the home screen.
// aibooking.dk links to the same /login?app=1.
export async function GET() {
  const svg = await QRCode.toString(`${getPublicAppUrl()}/login?app=1`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
