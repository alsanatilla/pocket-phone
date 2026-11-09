# Pocket on one Node server (Fly.io): the web app and Pip's worker in one image, one build, one code version.
#   fly deploy           (fly.toml in the repository root)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Behind Fly's proxy the server sees http while browsers send https; Pocket's own routes check the origin
# against BETTER_AUTH_URL, so Astro's own origin check stands down (see astro.config.mjs).
ENV POCKET_TARGET=node POCKET_ALLOW_PROXY=1
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/src ./src
COPY --from=build /app/services ./services
COPY --from=build /app/public ./public
EXPOSE 8080
USER node
CMD ["node", "services/server/start.mjs"]
