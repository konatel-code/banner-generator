# Banner service CK DAKA – render bannerov + produktové feedy
#
# Build (z koreňa repozitára, nie z priečinka server/):
#   docker build -f server/Dockerfile -t ckdaka-banner .
# Beh:
#   docker run -p 3457:3457 -e PUBLIC_URL=https://banner.ckdaka.sk ckdaka-banner
FROM node:22-slim

# fonts-noto-color-emoji – ikona 📅 vo svetlom štýle bannera
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Najprv závislosti – vrstva sa cachuje, kým sa nezmení package.json
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Zdieľané moduly používa server aj prehliadačová appka
COPY shared/ ./shared/
COPY server/ ./server/
COPY index.html ./index.html

ENV NODE_ENV=production \
    PORT=3457 \
    HOST=0.0.0.0 \
    CACHE_DIR=/app/.cache

EXPOSE 3457
VOLUME ["/app/.cache"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3457)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "index.js"]
