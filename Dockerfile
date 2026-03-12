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

# Generate Prisma client and build TypeScript
RUN npx prisma generate
RUN npm run build

# --- Production Stage ---
FROM node:20-alpine

WORKDIR /app

# Copy production files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

# Environment variables
ENV NODE_ENV=production

# Final preparation: generate prisma and run start
# We use a shell script or a joined command to run migrations before start
CMD npx prisma migrate deploy && npm start
