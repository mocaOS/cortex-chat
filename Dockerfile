# --- Stage 1: Install dependencies ---
FROM node:20-alpine AS deps
# better-sqlite3 needs build tools to compile native bindings.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- Stage 2: Build the application ---
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# App config is runtime-only: branding lives in the DB via /admin/settings;
# server-side config (CORTEX_API_URL, BACKEND_ADMIN_API_KEY, APP_ENCRYPTION_KEY,
# SUPERADMIN_*) is read from the container environment.
#
# Build-time inputs, all optional and scoped to this builder stage (never in
# the runtime image):
#   SENTRY_AUTH_TOKEN            enables GlitchTip source map upload (skipped
#                                cleanly when unset)
#   SOURCE_COMMIT                release naming; Coolify provides it automatically
#   NEXT_PUBLIC_SENTRY_DISABLED  Next.js inlines only NEXT_PUBLIC_* vars into the
#                                browser bundle, so this is the ONLY way to turn
#                                off client-side GlitchTip reporting — the
#                                runtime-only SENTRY_DISABLED (see glitchtip.ts)
#                                never reaches the browser. The published GHCR
#                                release image sets this to 1 (see
#                                .github/workflows/release.yml); the
#                                maintainers' own Dokploy/Coolify source builds
#                                leave it unset and keep reporting.
ARG SENTRY_AUTH_TOKEN
ARG SOURCE_COMMIT
ARG NEXT_PUBLIC_SENTRY_DISABLED
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    SOURCE_COMMIT=$SOURCE_COMMIT \
    NEXT_PUBLIC_SENTRY_DISABLED=$NEXT_PUBLIC_SENTRY_DISABLED
RUN npm run build

# --- Stage 3: Production runner ---
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Copy standalone output (includes traced node_modules — better-sqlite3 bindings
# are traced because of outputFileTracingIncludes in next.config.ts).
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/migrations ./src/lib/db/migrations

USER nextjs

# Persist SQLite + avatars across container rebuilds.
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
