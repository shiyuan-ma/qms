FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json vite.config.js ./
COPY index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=5173 HOME=/tmp
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com --omit=dev --no-audit --no-fund \
    && addgroup --system --gid 10001 kan \
    && adduser --system --uid 10001 --ingroup kan --home /app --shell /sbin/nologin kan
COPY --from=builder --chown=kan:kan /app/dist ./dist
COPY --chown=kan:kan server.mjs ./server.mjs
USER kan
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5173/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
