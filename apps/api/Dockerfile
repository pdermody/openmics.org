# syntax=docker/dockerfile:1
# Build context is the repo root (single package.json, no per-app package.json for apps/api).
# NOTE: the web app must be built first (`npm run build:web`) — its dist/index.html is
# baked into this image for server-side OG tag injection on /media/:id deep links.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY apps/api ./apps/api
COPY scripts/copy-city-catalogue.mjs ./scripts/copy-city-catalogue.mjs
RUN npm run build:api

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules carried through as-is (incl. devDependencies) so node-pg-migrate is available
# in this same image for the one-off ECS migration task.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY apps/api/migrations ./apps/api/migrations
# SPA entry HTML for OG injection (apps/api/src/spa-routes.ts reads /app/public/index.html).
COPY apps/web/dist/index.html ./public/index.html

EXPOSE 3000
CMD ["node", "dist/apps/api/src/server.js"]
