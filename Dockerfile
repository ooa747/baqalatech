# Prices API (SQLite). Mount a persistent volume at /data so the database survives redeploys.
FROM node:24-alpine
WORKDIR /app
COPY package.json schema.sql lib.mjs server.mjs seed.mjs set-price.mjs ./
COPY seed ./seed
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/prices.db
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "server.mjs"]
