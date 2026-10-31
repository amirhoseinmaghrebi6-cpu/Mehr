# M2smart production images, built from the repository root (infra/prod/compose.yaml builds both):
#   docker build --target web -t m2smart-web .
#   docker build --target api -t m2smart-api .
# Images are built where npm is reachable and copied to the server (infra/prod/README.md), so the
# server itself never needs a foreign registry.

FROM node:20.19-alpine@sha256:658d0f63e501824d6c23e06d4bb95c71e7d704537c9d9272f488ac03a370d448 AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.14.0
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile
COPY . .
# The web app's /api/v1 rewrite is fixed at build time: it points at the api service.
RUN M2SMART_STANDALONE=true M2SMART_API_INTERNAL_URL=http://api:4000 pnpm build
RUN pnpm --filter @m2smart/api build

# The API, and its migration tool (node backend/dist/db/migrate.js), which reads the SQL files
# from the same layout as the repository. Both are single bundles: no node_modules.
FROM node:20.19-alpine@sha256:658d0f63e501824d6c23e06d4bb95c71e7d704537c9d9272f488ac03a370d448 AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
WORKDIR /app
COPY --from=build /repo/backend/dist backend/dist
COPY --from=build /repo/infra/postgres infra/postgres
COPY --from=build /repo/supabase/migrations supabase/migrations
USER node
EXPOSE 4000
CMD ["node", "backend/dist/server.js"]

FROM node:20.19-alpine@sha256:658d0f63e501824d6c23e06d4bb95c71e7d704537c9d9272f488ac03a370d448 AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/.next/standalone ./
COPY --from=build /repo/.next/static .next/static
COPY --from=build /repo/public public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
