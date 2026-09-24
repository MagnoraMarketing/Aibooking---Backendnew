import type { MetadataRoute } from "next";

// robots.txt for the backend host. Nothing here should ever show up in
// search results — that is the marketing site's job (lib/seo/marketing-site.ts).
//
// Page routes are deliberately NOT disallowed: a crawler that is blocked by
// robots.txt never fetches the page, so it never sees the noindex header
// (next.config.mjs) and may still list the bare URL from a link it found
// elsewhere. Letting it fetch the page is what actually keeps it out.
//
// /api/ is disallowed (JSON and webhooks, nothing to crawl) except for the
// public widget endpoints and /widget.js, which Google fetches when it
// renders a *customer's* page that embeds the widget.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/widget.js", "/api/widget/"],
      disallow: ["/api/"],
    },
  };
}
