FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.11.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
    && DATABASE_URL=postgresql://build:build@127.0.0.1/build pnpm db:generate \
    && pnpm build:web
ARG PF_GIT_COMMIT
ARG PF_GIT_TREE
ARG PF_BUILD_ID
ARG PF_BUILD_AT
RUN PF_GIT_COMMIT="$PF_GIT_COMMIT" PF_GIT_TREE="$PF_GIT_TREE" PF_BUILD_ID="$PF_BUILD_ID" PF_BUILD_AT="$PF_BUILD_AT" node scripts/write-release.mjs

FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 problemforge && useradd --uid 10001 --gid 10001 --no-create-home problemforge
WORKDIR /app
COPY --from=build --chown=root:root /app /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3100 STORAGE_ROOT=/data
ARG PF_GIT_COMMIT
ARG PF_BUILD_ID
ARG PF_BUILD_AT
LABEL org.opencontainers.image.revision=$PF_GIT_COMMIT org.opencontainers.image.version=$PF_BUILD_ID org.opencontainers.image.created=$PF_BUILD_AT
USER 10001:10001
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
