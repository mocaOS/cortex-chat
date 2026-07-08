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
// GlitchTip's release URL routes only match slug-safe versions
// ([-a-zA-Z0-9_]) — anything with dots/@/+ gets a Django 403 on the
// finalize/assemble endpoints (verified against 5.x, 2026-07). Sanitize.
const release = rawRelease.replace(/[^-a-zA-Z0-9_]/g, "-");

// GlitchTip speaks the Sentry protocol, so the stock Sentry build plugin
// handles source map upload — pointed at our instance via sentryUrl. Runtime
// DSN/env config lives in src/lib/glitchtip.ts.
export default withSentryConfig(nextConfig, {
  sentryUrl: "https://glitchtip.cortex.eco",
  org: "cortex",
  project: "cortex-chat",

  // Build-time only (never needed at runtime): enables source map upload.
  // Without it the build still succeeds — uploads are just skipped.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // finalize:false — GlitchTip 405s sentry-cli's finalize call (PUT without
  // trailing slash); finalization is cosmetic (sets dateReleased) and not
  // needed for source map resolution.
  release: { name: release, finalize: false },

  // The plugin's own upload is disabled: GlitchTip needs the client chunks
  // debug-id-injected BEFORE upload (browsers can't read //# debugId comments
  // the way the Node SDK can), and it 500s on duplicate re-uploads. Both are
  // handled by scripts/glitchtip-sourcemaps.mjs, chained after `next build`.
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
