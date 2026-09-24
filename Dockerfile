# Multi-stage Dockerfile untuk Backend Monitoring Tanki RSA UGM (Docker)

# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Salin package.json dan install seluruh dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Salin source code dan compile TypeScript
COPY src ./src
RUN npm run build

# Stage 2: Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0

# Install dependensi produksi saja
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Salin hasil kompilasi dari builder stage
COPY --from=builder /app/dist ./dist

# Buat user non-root untuk keamanan container
USER node

EXPOSE 8000

CMD ["node", "dist/index.js"]
