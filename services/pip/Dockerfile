# Pip's detached worker. Build from the repository root:
#   docker build -f services/pip/Dockerfile -t pocket-pip-worker .
#   docker run --env-file .env -p 8787:8787 pocket-pip-worker
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY services ./services
# The worker has no inbound traffic except this health endpoint; it calls out to Turso and the model provider.
EXPOSE 8787
USER node
CMD ["node", "services/pip/worker.mjs"]
