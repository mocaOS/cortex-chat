import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false,
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2"],
  outputFileTracingIncludes: {
    "/**/*": ["./src/lib/db/migrations/**/*"],
  },
  // Source maps are only emitted when a GlitchTip upload will consume them
  // (scripts/glitchtip-sourcemaps.mjs runs after the build, uploads both
  // client and server maps, then strips .map files from .next/static).
  productionBrowserSourceMaps: !!process.env.SENTRY_AUTH_TOKEN,
  experimental: {
    // Keep in sync with MAX_UPLOAD_BYTES in src/lib/upload-limits.ts.
    // Default is 10MB; oversized multipart bodies are silently truncated
    // by the proxy buffer and break request.formData() in route handlers.
    proxyClientMaxBodySize: "200mb",
    serverSourceMaps: !!process.env.SENTRY_AUTH_TOKEN,
  },
};

// Release ties runtime events to the source maps uploaded at build time, and
// GlitchTip requires one for its (legacy, release-based) artifact storage.
// Coolify provides SOURCE_COMMIT (plumbed through the Dockerfile as a build
// arg); local builds fall back to `git rev-parse`, then the package version,
// so a release name always exists deterministically.
function resolveCommit(): string {
  if (process.env.SOURCE_COMMIT) return process.env.SOURCE_COMMIT.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return ""; // no git in the Docker build context
  }
}
const commit = resolveCommit();
const rawRelease =
  process.env.SENTRY_RELEASE ||
  `cortex-chat-${commit || process.env.npm_package_version || "0.0.0"}`;
// GlitchTip < 6 rejected non-slug chars in release URLs; 6.x accepts them,
// but we keep sanitizing so release names stay consistent across upgrades.
// Keep in sync with resolveRelease() in scripts/glitchtip-sourcemaps.mjs.
const release = rawRelease.replace(/[^-a-zA-Z0-9_]/g, "-");

// GlitchTip speaks the Sentry protocol, so the stock Sentry build plugin
// wires the SDK (release injection etc.) — pointed at our instance via
// sentryUrl. Runtime DSN/env config lives in src/lib/glitchtip.ts.
export default withSentryConfig(nextConfig, {
  sentryUrl: "https://glitchtip.cortex.eco",
  org: "cortex",
  project: "cortex-chat",

  // Build-time only (never needed at runtime): enables source map upload.
  // Without it the build still succeeds — uploads are just skipped.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  release: { name: release },

  // The plugin's own upload is disabled: browsers only report debug IDs when
  // the SERVED client chunks carry the `_sentryDebugIds` snippet, so
  // `sentry-cli sourcemaps inject` must run BEFORE upload — an ordering the
  // plugin's Turbopack hook doesn't allow. scripts/glitchtip-sourcemaps.mjs
  // (chained after `next build`) does inject + upload instead.
  sourcemaps: { disable: true },

  // Upload problems (GlitchTip down, bad token) must never fail a deploy —
  // events would just show minified frames until the next good build.
  errorHandler: (err) => {
    console.warn(
      `[glitchtip] source map upload failed (build continues): ${err.message}`
    );
  },

  // Don't send build telemetry to sentry.io — GlitchTip is our only backend.
  telemetry: false,
});
