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

# Build-time env vars (NEXT_PUBLIC_* are inlined at build time by Next.js).
# Server-side secrets (BACKEND_ADMIN_API_KEY, APP_ENCRYPTION_KEY, SUPERADMIN_*)
# are read at runtime — pass them via the container environment, not as ARGs.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_ACCENT_COLOR="#ff9500"
ARG NEXT_PUBLIC_LOGO_URL=
ARG NEXT_PUBLIC_LOCALE=english

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_ACCENT_COLOR=$NEXT_PUBLIC_ACCENT_COLOR
ENV NEXT_PUBLIC_LOGO_URL=$NEXT_PUBLIC_LOGO_URL
ENV NEXT_PUBLIC_LOCALE=$NEXT_PUBLIC_LOCALE

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
