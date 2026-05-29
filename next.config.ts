import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // ws (used by @neondatabase/serverless) must not be bundled — its prebuilt
  // native helpers (bufferutil/utf-8-validate) get mangled by webpack and
  // throw "b.mask is not a function" at runtime on Vercel Functions. Keeping
  // these external lets Vercel resolve them from node_modules at runtime.
  serverExternalPackages: ["ws", "@neondatabase/serverless"],
};

export default config;
