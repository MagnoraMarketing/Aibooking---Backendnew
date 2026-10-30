/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  // The old Vercel address still works, but people are sent on to
  // app.aibooking.dk. /api/* and /widget.js stay put: Twilio, Vapi, Stripe,
  // Shopify and OAuth providers may still have the old URL saved, and most of
  // them don't follow redirects — nor do customer sites embedding the widget.
  async redirects() {
    return [
      {
        source: "/:path((?!api/|widget\\.js$).*)",
        has: [{ type: "host", value: "aibooking-backendnew.vercel.app" }],
        destination: "https://app.aibooking.dk/:path",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/widget.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};

export default nextConfig;
