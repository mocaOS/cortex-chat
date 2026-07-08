// GlitchTip source map pipeline — runs after `next build` (see package.json).
//
// Why not the Sentry plugin's built-in upload? GlitchTip specifics, verified
// against glitchtip.cortex.eco (GlitchTip 4.0.12, 2026-07):
//
// 1. GlitchTip 4.0.x pairs a stack frame's minified file with its source map
//    strictly by NAME convention: `<file>.js` ↔ `<file>.js.map` (compared on
//    basenames, scoped to the event's release). Turbopack names client and
//    edge maps with independent content hashes (e.g. 0467f4ff.js referencing
//    b833ecb3.js.map), which never pairs. We therefore copy each referenced
//    map to `<file>.js.map` before uploading. Server chunks already follow
//    the convention — which is why server frames resolved from day one.
//
// 2. Forward-compat for GlitchTip >= 4.2 (debug-id matching): we
//    `sentry-cli sourcemaps inject` the CLIENT chunks before upload so served
//    bundles contain the `_sentryDebugIds` registration snippet and browser
//    events carry debug IDs. The Node runtime doesn't need the snippet (the
//    SDK reads Turbopack's `//# debugId=` comment from disk), and we must NOT
//    modify .next/server JS after the build — the standalone output was
//    already assembled from it and would desync from the uploaded artifacts.
//    Map copies are fine: the runtime never consumes them.
//
// 3. Re-uploading artifacts to an existing GlitchTip release 500s in the
//    assemble step. One release gets exactly one upload: if the release
//    already has files, skip (same-commit rebuilds/redeploys stay safe).
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

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
// keep the two in sync (SENTRY_RELEASE > SOURCE_COMMIT > git > pkg version,
// sanitized to GlitchTip's slug-safe charset).
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
  const version =
    process.env.npm_package_version ||
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
      .version ||
    "0.0.0";
  return sanitize(`cortex-chat-${commit || version}`);
}
// GlitchTip's release URL routes only match [-a-zA-Z0-9_] — dots/@/+ 403.
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

function* walkJs(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walkJs(p);
    else if (p.endsWith(".js")) yield p;
  }
}

const MAP_URL_RE = /\/\/# sourceMappingURL=([^\s]+)/;

// GlitchTip 4.0.x needs `<file>.js.map` next to `<file>.js`. Copy the map a
// chunk actually references to that canonical name. rewriteJs additionally
// updates the sourceMappingURL comment so sentry-cli derives matching
// artifact headers — only safe for files that are served as-is (client
// static chunks), never for .next/server (standalone copy already made).
function normalizeMapNames(dir, { rewriteJs }) {
  if (!existsSync(dir)) return;
  let copied = 0;
  for (const jsPath of walkJs(dir)) {
    const content = readFileSync(jsPath, "utf8");
    const match = content.match(MAP_URL_RE);
    if (!match) continue;
    const referenced = decodeURIComponent(match[1].split("/").pop());
    const canonical = basename(jsPath) + ".map";
    if (referenced === canonical) continue;
    const referencedPath = join(dirname(jsPath), referenced);
    if (!existsSync(referencedPath)) continue;
    copyFileSync(referencedPath, join(dirname(jsPath), canonical));
    copied++;
    if (rewriteJs) {
      writeFileSync(
        jsPath,
        content.replace(MAP_URL_RE, `//# sourceMappingURL=${canonical}`)
      );
    }
  }
  if (copied) {
    console.log(`[glitchtip] ${dir}: normalized ${copied} map name(s) to <file>.js.map.`);
  }
}

function cleanupClientMaps() {
  if (!existsSync(".next/static")) return;
  execSync("find .next/static -name '*.map' -delete");
  console.log("[glitchtip] removed .map files from .next/static (not publicly served).");
}

async function releaseHasFiles(release) {
  const res = await fetch(
    `${SENTRY_URL}/api/0/organizations/${ORG}/releases/${encodeURIComponent(release)}/files/`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return false; // release doesn't exist yet
  if (!res.ok) throw new Error(`release files check failed: HTTP ${res.status}`);
  return ((await res.json()).length ?? 0) > 0;
}

const release = resolveRelease();
try {
  if (await releaseHasFiles(release)) {
    console.log(
      `[glitchtip] release ${release} already has artifacts — skipping upload (re-uploads corrupt GlitchTip releases).`
    );
    cleanupClientMaps();
    process.exit(0);
  }

  // 1. Canonical `<file>.js.map` names (GlitchTip 4.0.x pairing).
  normalizeMapNames(".next/static/chunks", { rewriteJs: true });
  normalizeMapNames(".next/server", { rewriteJs: false });

  // 2. Debug-id snippets into CLIENT chunks (in place, idempotent — reuses
  //    Turbopack's existing //# debugId). Forward-compat for GlitchTip 4.2+.
  cli(["sourcemaps", "inject", ".next/static/chunks"]);

  // 3. Upload client chunks + maps, then server bundles + maps.
  //    --rewrite flattens Turbopack's indexed ("sections") client maps into
  //    plain maps — GlitchTip's symbolic parser can't read indexed maps.
  cli(["sourcemaps", "upload", "--rewrite", "--release", release, ".next/static/chunks"]);
  cli(["sourcemaps", "upload", "--rewrite", "--release", release, ".next/server"]);

  console.log(`[glitchtip] source maps uploaded for release ${release}.`);
} catch (err) {
  // Never fail the build over monitoring infrastructure.
  console.warn(`[glitchtip] source map upload failed (build continues): ${err.message}`);
} finally {
  cleanupClientMaps();
}
