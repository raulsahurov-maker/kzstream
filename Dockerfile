FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
ENV NODE_ENV=production PORT=10000 DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 10000
CMD ["node", "server.js"]
