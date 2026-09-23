# syntax=docker/dockerfile:1
# Build context is the repo root (single package.json, no per-app package.json for apps/api).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY apps/api ./apps/api
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

EXPOSE 3000
CMD ["node", "dist/apps/api/src/server.js"]
