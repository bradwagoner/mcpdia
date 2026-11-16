# MCPdia over HTTP. With docker-compose.yml it runs on Postgres; on its own it
# keeps a SQLite graph in /data. See docs/docker.md.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries, so no install scripts or compilers are needed.
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production \
    MCPDIA_HTTP_HOST=0.0.0.0 \
    MCPDIA_HTTP_PORT=7411 \
    MCPDIA_DB=/data/mcpdia.db \
    MCPDIA_METRICS_FILE=/data/mcpdia-metrics.jsonl
VOLUME /data
EXPOSE 7411
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:7411/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--http"]
