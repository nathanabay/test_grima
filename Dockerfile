# syntax=docker/dockerfile:1

# PharmaCore — multi-stage build producing separate api and web images.
# Build with:  docker build --target api -t pharmacore-api .
#              docker build --target web -t pharmacore-web .

# ---- Base: dependencies, shared across both apps ----
FROM node:22-alpine AS deps
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- Shared package build ----
FROM deps AS shared
COPY packages/shared packages/shared
RUN pnpm --filter @pharmacore/shared build

# ---- API build ----
FROM shared AS api-build
COPY apps/api apps/api
RUN pnpm --filter @pharmacore/api prisma generate \
 && pnpm --filter @pharmacore/api build

# ---- API runtime ----
FROM node:22-alpine AS api
# pg_dump is required for the backup job (§55); without it backups fail loudly.
RUN apk add --no-cache postgresql16-client tini && corepack enable
ENV NODE_ENV=production PG_DUMP_PATH=/usr/bin/pg_dump
WORKDIR /repo
COPY --from=api-build /repo/node_modules node_modules
COPY --from=api-build /repo/packages/shared packages/shared
COPY --from=api-build /repo/apps/api/node_modules apps/api/node_modules
COPY --from=api-build /repo/apps/api/dist apps/api/dist
COPY --from=api-build /repo/apps/api/prisma apps/api/prisma
COPY --from=api-build /repo/apps/api/package.json apps/api/
WORKDIR /repo/apps/api
# Uploads and backups must be volumes: they are not part of the image.
VOLUME ["/repo/apps/api/uploads", "/repo/apps/api/backups"]
EXPOSE 4000
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]

# ---- Web build ----
FROM shared AS web-build
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @pharmacore/web build

# ---- Web runtime ----
FROM node:22-alpine AS web
RUN corepack enable
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=web-build /repo/node_modules node_modules
COPY --from=web-build /repo/packages/shared packages/shared
COPY --from=web-build /repo/apps/web apps/web
WORKDIR /repo/apps/web
EXPOSE 3000
USER node
CMD ["npx", "next", "start", "-p", "3000"]
