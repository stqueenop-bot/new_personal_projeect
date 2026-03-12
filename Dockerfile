# --- Build Stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Declare build arguments (Railway/System Env injection)
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Make build script executable, fix Windows line endings, and run it
RUN chmod +x ./scripts/build.sh && \
    sed -i 's/\r$//' ./scripts/build.sh && \
    ./scripts/build.sh


# --- Production Stage ---
FROM node:20-alpine

WORKDIR /app

# Copy production files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

# Run prisma after Railway injects env variables
CMD sh -c "npx prisma generate && npx prisma migrate deploy && npm start"