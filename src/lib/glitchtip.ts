// GlitchTip (Sentry-protocol) error tracking — shared config for all three
// runtimes (browser, nodejs, edge). Init lives in src/instrumentation-client.ts,
// src/sentry.server.config.ts and src/sentry.edge.config.ts; source map upload
// is wired in next.config.ts.
//
// The DSN is a submit-only public identifier (it can create events, nothing
// else), so shipping the default to the browser bundle is fine. Override per
// deployment without a rebuild via SENTRY_DSN (server) or at build time via
// NEXT_PUBLIC_SENTRY_DSN (client + server).

const DEFAULT_DSN =
  "https://f28a0a60bead451ea20a3d5540093b5a@glitchtip.cortex.eco/4";

export function glitchtipDsn(): string {
  return (
    process.env.SENTRY_DSN || // runtime env — server only (undefined in browser)
    process.env.NEXT_PUBLIC_SENTRY_DSN || // inlined at build time
    DEFAULT_DSN
  );
}

// Reporting is on in production builds only (a `next dev` session should never
// page anyone). Set SENTRY_DISABLED=1 (server, runtime) or
// NEXT_PUBLIC_SENTRY_DISABLED=1 (build time) to opt a deployment out.
export function glitchtipEnabled(): boolean {
  if (process.env.SENTRY_DISABLED || process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
    return false;
  }
  return process.env.NODE_ENV === "production";
}

// Distinguishes tenant deployments in GlitchTip ("production" by default).
export function glitchtipEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
    process.env.NODE_ENV ||
    "development"
  );
}
