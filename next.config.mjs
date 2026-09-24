/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [
      // Keep the whole backend host (dashboard, admin, auth pages, API,
      // widget loader) out of search indexes — only www.aibooking.dk should
      // rank. A header rather than only a <meta> tag so it also covers JSON,
      // JS and the raw-HTML preview route. See app/robots.ts.
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      {
        source: "/widget.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300" }],
      },
    ];
  },
};

export default nextConfig;
