# Stage 1: Build frontend
#
# `better-sqlite3` ships precompiled binaries via `prebuild-install`. When
# the fetch is flaky (socket hang up, GitHub rate-limit, offline build) npm
# falls back to compiling from source via `node-gyp`, which needs Python
# + a C++ toolchain. `node:20-slim` ships neither, so we add them in every
# stage that runs `npm ci`. The final runtime image (stage 4) does not
# install these and stays lean.
FROM node:20-slim AS client-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
      && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src/client/ src/client/
RUN npm run build:client

# Stage 2: Build backend
FROM node:20-slim AS server-build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
      && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.server.json ./
RUN npm ci
COPY src/server/ src/server/
RUN npm run build:server

# Stage 3: Production-only node_modules
#
# Split from the runtime image so we can compile native addons here
# (with python+g++) and copy the resulting node_modules into a clean
# runtime stage that doesn't need a toolchain.
FROM node:20-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
      && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 4: Lean runtime — no compilers, just ping + node + compiled modules
FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      iputils-ping \
      && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=prod-deps   /app/node_modules ./node_modules
COPY --from=client-build /app/dist/client ./dist/client
COPY --from=server-build /app/dist/server ./dist/server

RUN mkdir -p /app/data

ENV PORT=3000
ENV DB_PATH=/app/data/oneresponse.db
ENV NODE_ENV=production

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "dist/server/index.js"]
