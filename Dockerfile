# Pocket on one Node server (Fly.io): the web app and Pip's worker in one image, one build, one code version.
#   fly deploy           (fly.toml in the repository root)
FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Behind Fly's proxy the server sees http while browsers send https; Pocket's own routes check the origin
# against BETTER_AUTH_URL, so Astro's own origin check stands down (see astro.config.mjs).
ENV POCKET_ALLOW_PROXY=1
RUN npm run build && npm prune --omit=dev

FROM node:24.16.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client gosu && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/src ./src
COPY --from=build /app/services ./services
COPY --from=build /app/public ./public
COPY services/server/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "services/server/start.mjs"]
