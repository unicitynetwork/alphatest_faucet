# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Builder (for any build steps if needed)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .

# Stage 3: Production Runtime
FROM node:20-alpine AS runner

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    curl \
    tini \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -S faucet && adduser -S faucet -G faucet

WORKDIR /app

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY --from=builder /app/src ./src
COPY --from=builder /app/cli ./cli
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./

# Copy entrypoint script
COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create data and config directories
RUN mkdir -p /app/data /app/config && \
    chown -R faucet:faucet /app

# Environment defaults
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/faucet.db \
    LOG_LEVEL=info

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use tini as init system for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Switch to non-root user
USER faucet

# Start application
CMD ["/entrypoint.sh"]
