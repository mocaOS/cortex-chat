// GlitchTip source map pipeline — runs after `next build` (see package.json).
//
// Why not the Sentry plugin's built-in upload? One ordering constraint the
// plugin's Turbopack hook can't satisfy (verified against glitchtip.cortex.eco,
// GlitchTip 6.2, 2026-07):
//
// Browser events only get readable stack traces when they carry debug IDs,
// and browsers can only report debug IDs when the SERVED chunk contains the
// `_sentryDebugIds` registration snippet. So `sentry-cli sourcemaps inject`
// must run on the client chunks BEFORE they are uploaded — the plugin uploads
// from inside `next build` without injecting the on-disk files. The Node
// runtime doesn't need the snippet (the SDK reads Turbopack's `//# debugId=`
// comment straight from the file on disk), and we must NOT modify
// .next/server JS after the build — the standalone output was already
// assembled from it and would desync from the uploaded artifacts.
//
// Uploads use artifact bundles (GlitchTip >= 4.2 / sentry-cli negotiates via
// the chunk-upload endpoint), so re-uploads are checksum-deduplicated and
// same-commit rebuilds are safe. --rewrite additionally embeds sourcesContent
// into maps that lack it (Turbopack's server maps) so GlitchTip can show
// source context lines, not just mapped file:line.
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const SENTRY_URL = "https://glitchtip.cortex.eco";
const ORG = "cortex";
const PROJECT = "cortex-chat";

const token = process.env.SENTRY_AUTH_TOKEN;
if (!token) {
  console.log("[glitchtip] SENTRY_AUTH_TOKEN not set — skipping source map upload.");
  cleanupClientMaps(); // never ship .map files in the public static dir
  process.exit(0);
}

// Must produce the SAME value as the release computation in next.config.ts —
// keep the two in sync (SENTRY_RELEASE > SOURCE_COMMIT > git > pkg version).
function resolveRelease() {
  if (process.env.SENTRY_RELEASE) return sanitize(process.env.SENTRY_RELEASE);
  let commit = process.env.SOURCE_COMMIT ? process.env.SOURCE_COMMIT.slice(0, 7) : "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse --short HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      /* no git in Docker build context */
    }
  }
  return sanitize(`cortex-chat-${commit || process.env.npm_package_version || "0.0.0"}`);
}
// GlitchTip < 6 rejected non-slug chars in release URLs; 6.x accepts them,
// but we keep sanitizing so release names stay consistent across upgrades.
function sanitize(name) {
  return name.replace(/[^-a-zA-Z0-9_]/g, "-");
}

function cli(args) {
  const require = createRequire(import.meta.url);
  const bin = require.resolve("@sentry/cli/bin/sentry-cli");
  execFileSync(bin, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SENTRY_URL,
      SENTRY_ORG: ORG,
      SENTRY_PROJECT: PROJECT,
      SENTRY_AUTH_TOKEN: token,
    },
  });
}

function cleanupClientMaps() {
  if (!existsSync(".next/static")) return;
  execSync("find .next/static -name '*.map' -delete");
  console.log("[glitchtip] removed .map files from .next/static (not publicly served).");
}

const release = resolveRelease();
try {
  // Sanity: client maps are deleted at the end of every run, so a re-run on
  // an already-processed tree would upload chunks WITHOUT maps — and those
  // map-less bundles can supersede the good ones server-side. Skip instead.
  const haveMaps =
    existsSync(".next/static/chunks") &&
    execSync("find .next/static/chunks -name '*.map' | head -1").toString().trim();
  if (!haveMaps) {
    console.log(
      "[glitchtip] no client .map files found (already uploaded this build?) — skipping upload."
    );
    process.exit(0);
  }

  // 1. Debug-id snippets into CLIENT chunks (in place, idempotent — reuses
  //    Turbopack's existing //# debugId, and adjusts the maps for the added
  //    lines). These exact files are then uploaded AND served, so browser
  //    events report debug IDs that match the uploaded artifacts.
  cli(["sourcemaps", "inject", ".next/static/chunks"]);

  // 2. Upload client chunks + maps, then server bundles + maps.
  cli(["sourcemaps", "upload", "--rewrite", "--release", release, ".next/static/chunks"]);
  cli(["sourcemaps", "upload", "--rewrite", "--release", release, ".next/server"]);

  console.log(`[glitchtip] source maps uploaded for release ${release}.`);
} catch (err) {
  // Never fail the build over monitoring infrastructure.
  console.warn(`[glitchtip] source map upload failed (build continues): ${err.message}`);
} finally {
  cleanupClientMaps();
}
