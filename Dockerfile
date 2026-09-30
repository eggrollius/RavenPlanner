FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig*.json vite.config.ts index.html ./
COPY server ./server
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=5000
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 5000
CMD ["node", "dist/server/index.js"]
