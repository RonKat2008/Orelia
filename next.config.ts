import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agentmail SDK dynamically imports an optional peer (@x402/fetch) that is not installed;
  // loading it from node_modules at runtime keeps the bundler from trying to resolve it.
  serverExternalPackages: ["agentmail"],
};

export default nextConfig;
