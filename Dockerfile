FROM node:22-bookworm-slim AS build
ENV NODE_LLAMA_CPP_GPU=false NODE_LLAMA_CPP_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY server ./server
COPY RavenData ./RavenData
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5000 NODE_LLAMA_CPP_GPU=false NODE_LLAMA_CPP_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf node_modules/@node-llama-cpp/*-cuda* node_modules/@node-llama-cpp/*-vulkan && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5000
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5000/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/server/index.js"]
