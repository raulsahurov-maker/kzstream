FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
ENV NODE_ENV=production PORT=10000 DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 10000
CMD ["node", "server.js"]
