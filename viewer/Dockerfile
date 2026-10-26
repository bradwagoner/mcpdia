# The read-only graph viewer, for the Compose stack in the repo root. See docs/docker.md.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries, so no install scripts or compilers are needed.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["node", "scripts/serve.mjs"]
