# Prices API. On the host it uses PostgreSQL via DATABASE_URL (no volume needed).
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY schema.sqlite.sql schema.pg.sql lib.mjs server.mjs seed.mjs set-price.mjs ./
COPY seed ./seed
ENV NODE_ENV=production \
    PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
