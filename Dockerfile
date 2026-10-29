FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
ENV DATABASE_PATH=/data/adforja.db
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3000}/salud || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
