# --- Build Stage ---
FROM node:19-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build



# --- Production Stage ---
FROM node:20-alpine3.16

WORKDIR /app

# Copy production files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production

# On Render, set DATABASE_URL as a service environment variable in your Render dashboard.
CMD sh -c "npx prisma generate && npx prisma migrate deploy && npm start"