# syntax=docker/dockerfile:1

###############################################################################
# Build stage — compiles the SPA and the API server
###############################################################################
FROM node:24-alpine AS build

WORKDIR /app

# Install every dependency first so the layer is cached.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The SPA and the server are compiled together.
RUN npm run build


###############################################################################
# Runtime stage — serves the API and the built SPA from one process
###############################################################################
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    UPLOADS_DIR=/data/uploads

# Only the production dependencies are shipped.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The compiled server and SQL migrations. Optional seed data is mounted at runtime.
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/server/db/migrations ./server/db/migrations

# The built SPA, served by the API process.
COPY --from=build /app/dist ./dist

# The application runs as a non-root user.
RUN addgroup -g 1001 -S app \
 && adduser -u 1001 -S app -G app \
 && mkdir -p /data/uploads /app/data \
 && chown -R app:app /data /app

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server-dist/index.js"]
