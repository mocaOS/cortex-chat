import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false,
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  outputFileTracingIncludes: {
    "/**/*": ["./src/lib/db/migrations/**/*"],
  },
  experimental: {
    // Keep in sync with MAX_UPLOAD_BYTES in src/lib/upload-limits.ts.
    // Default is 10MB; oversized multipart bodies are silently truncated
    // by the proxy buffer and break request.formData() in route handlers.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
