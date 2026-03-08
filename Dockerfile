# Stage 1: Build frontend
FROM node:20-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src/client/ src/client/
RUN npm run build:client

# Stage 2: Build backend
FROM node:20-slim AS server-build
WORKDIR /app
COPY package.json package-lock.json tsconfig.server.json ./
RUN npm ci
COPY src/server/ src/server/
RUN npm run build:server

# Stage 3: Production
FROM node:20-slim
WORKDIR /app

# Install ping utility
RUN apt-get update && apt-get install -y iputils-ping && rm -rf /var/lib/apt/lists/*

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built assets
COPY --from=client-build /app/dist/client ./dist/client
COPY --from=server-build /app/dist/server ./dist/server

# Create data directory
RUN mkdir -p /app/data

ENV PORT=3000
ENV DB_PATH=/app/data/oneresponse.db
ENV NODE_ENV=production

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "dist/server/index.js"]
