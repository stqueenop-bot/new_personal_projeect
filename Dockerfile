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

# Copy prisma schema BEFORE npm ci so postinstall → prisma generate can find it
COPY prisma ./prisma

# Install ALL dependencies (including devDeps for tsc)
# postinstall runs prisma generate automatically
RUN npm ci

# Copy the rest of the source
COPY tsconfig.json ./
COPY src ./src
COPY lib ./lib

# Compile TypeScript → ./dist
RUN npm run build


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

# Copy prisma schema BEFORE npm ci so postinstall → prisma generate can find it
COPY prisma ./prisma

# Install production deps (postinstall runs prisma generate here too)
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy generated Prisma client (query engine binaries live here)
COPY --from=builder /app/generated ./generated

# Switch to non-root user
USER appuser

# Render injects PORT at runtime; default to 5000 to match your env config
ENV PORT=5000
ENV NODE_ENV=production

# Expose the port (documentation only — Render reads PORT from env)
EXPOSE 5000

# Run migrations then start the app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]