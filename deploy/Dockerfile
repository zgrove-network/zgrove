# syntax=docker/dockerfile:1

# One image for the orchestrator: the stratum proxy, the control plane, and
# the zgrove CLI that plans and records payouts.
#
# Built and run on the same base. better-sqlite3 is a native module, and a
# build stage on a different libc or architecture than the one it runs on
# produces a binary that loads here and fails there.

FROM node:24-bookworm-slim AS build
WORKDIR /repo

# A compiler for better-sqlite3 when no prebuilt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Manifests first, so the install layer is reused until a dependency changes.
# Every workspace manifest is copied, not just the orchestrator's: the lockfile
# describes all of them, and a frozen install checks it against what it sees.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/db/package.json packages/db/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/ring/package.json apps/ring/
RUN pnpm install --frozen-lockfile --filter "@zgrove/orchestrator..."

COPY packages/protocol packages/protocol
COPY packages/db packages/db
COPY apps/orchestrator apps/orchestrator
RUN pnpm --filter "@zgrove/orchestrator..." build

# A standalone copy with production dependencies only: no compiler, no
# TypeScript, no source.
RUN pnpm --filter @zgrove/orchestrator deploy --prod /out


FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /out ./

# Not root. The process reads a database and two ports; nothing it does needs
# more, and a proxy that talks to strangers should not be able to.
RUN useradd --uid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin zgrove \
 && mkdir -p /data \
 && chown zgrove:zgrove /data
USER zgrove

# Inside a container the loopback defaults would make both ports unreachable.
# Which of them is exposed to the world is decided by compose, not here.
ENV ZGROVE_DB_PATH=/data/zgrove.sqlite \
    ZGROVE_STRATUM_HOST=0.0.0.0 \
    ZGROVE_CONTROL_HOST=0.0.0.0

VOLUME /data
EXPOSE 3333 3334

CMD ["node", "dist/index.js"]
