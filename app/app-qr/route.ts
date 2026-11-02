import QRCode from "qrcode";

// QR code on the login page: scanning it on a phone opens the login with the
// "Hent app" steps showing, so the customer can add the app to the home screen.
// aibooking.dk links to the same /login?app=1.
//
// Built from the address the login page itself was loaded on, not
// NEXT_PUBLIC_APP_URL: someone signing in on app.aibooking.dk must get a code
// for app.aibooking.dk, even while the old vercel.app address still works or
// the env var lags behind a domain change.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const svg = await QRCode.toString(`${origin}/login?app=1`, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
}
