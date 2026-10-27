# Build context is the repo root (docker-compose.yml), so docs/openapi.yaml can be copied in.
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

FROM deps AS build
COPY backend/ ./
# The seed is compiled so the runtime image needs no ts-node.
RUN npx prisma generate \
  && npm run build \
  && npx tsc prisma/seed.ts --outDir dist/prisma --module commonjs --target es2023 --esModuleInterop --skipLibCheck \
  && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=build /app/backend/package.json ./
COPY --from=build /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/dist ./dist
# app.setup.ts serves ../../docs/openapi.yaml relative to dist/.
COPY docs/openapi.yaml /app/docs/openapi.yaml
USER node
EXPOSE 3000
# Spec §11: migrate (idempotent), seed when asked (upserts), then start.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && if [ \"$SEED_ON_START\" = \"true\" ]; then node dist/prisma/seed.js; fi && exec node dist/main.js"]
