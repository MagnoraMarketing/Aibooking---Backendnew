// The public marketing site — the one place AIbooking.dk wants to rank.
//
// This backend (dashboard, admin, API, widget loader) is deliberately kept
// out of every search index (see app/robots.ts and the X-Robots-Tag header
// in next.config.mjs), so a crawler that lands here has nothing to rank.
// What it *can* do is follow a link on to the marketing site, which is why
// every brand mention the backend renders — the widget's "Powered by"
// line, the AIbooking.dk heading on the auth pages — links here.
//
// Always the canonical www host: the apex aibooking.dk 308-redirects to it,
// and a link that has to go through a redirect first passes less on.
export const MARKETING_SITE_URL = "https://www.aibooking.dk";
