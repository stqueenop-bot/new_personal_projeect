# ─────────────────────────────────────────────────────────────
# Stage 1 — Builder
# Install ALL deps, generate Prisma client, compile TypeScript
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install OpenSSL needed by Prisma query engine on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Copy dependency manifests first (layer-cache friendly)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDeps for tsc)
RUN npm ci

# Copy the rest of the source
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY lib ./lib
COPY generated ./generated

# Generate Prisma client into ./generated (matches your prisma.config.ts output)
# then compile TypeScript  →  ./dist
RUN npx prisma generate && npm run build


# ─────────────────────────────────────────────────────────────
# Stage 2 — Runner
# Lean production image — no devDeps, no source files
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependency manifests and install ONLY production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy Prisma config (Prisma v7 reads prisma.config.ts for migrate deploy)
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy Prisma schema + migrations (needed for prisma migrate deploy at runtime)
COPY --from=builder /app/prisma ./prisma

# Copy generated Prisma client (query engine binaries live here)
COPY --from=builder /app/generated ./generated

# Switch to non-root user
USER appuser

# Render injects PORT at runtime; default to 5000 to match your env config
ENV PORT=5000
ENV NODE_ENV=production

# Expose the port (documentation only — Render reads PORT from env)
EXPOSE 5000

# Prisma v7: pass --config explicitly so it finds prisma.config.ts
# DATABASE_URL is injected by Render as a runtime env var — no .env needed
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma.config.ts && node dist/src/index.js"]

