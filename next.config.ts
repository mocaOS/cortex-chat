import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false,
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  outputFileTracingIncludes: {
    "/**/*": ["./src/lib/db/migrations/**/*"],
  },
};

export default nextConfig;
