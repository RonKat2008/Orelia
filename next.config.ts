import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agentmail SDK dynamically imports an optional peer (@x402/fetch) that is not installed;
  // loading it from node_modules at runtime keeps the bundler from trying to resolve it.
  serverExternalPackages: ["agentmail"],
  // playwright-core (the Kernel cloud-browser client) reads browsers.json and other package files at runtime, which
  // file tracing misses; without them every Kernel session fails on Vercel with "Cannot find module ...browsers.json".
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/playwright-core/**/*"],
    "/review/**": ["./node_modules/playwright-core/**/*"],
  },
  // Share links carry a bearer token in the path: keep it out of Referer headers and caches.
  async headers() {
    return [
      {
        source: "/share/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
