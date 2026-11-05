FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        imagemagick \
        webp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY scripts ./scripts

ENV HOST=0.0.0.0 \
    PORT=8010 \
    MAP_STUDIO_REPO_ROOT=/workspace \
    MAP_STUDIO_DRAFTS_ROOT=/var/lib/map-studio/drafts \
    NODE_PATH=/app/node_modules \
    MAP_HIRAETH_TILE_CACHE_DIR=/var/cache/map-studio/pages-tiles

RUN mkdir -p /workspace /var/cache/map-studio/pages-tiles /var/lib/map-studio/drafts \
    && chown -R node:node /app /workspace /var/cache/map-studio /var/lib/map-studio

USER node

RUN git config --global --add safe.directory /workspace

EXPOSE 8010
VOLUME ["/workspace", "/var/cache/map-studio", "/var/lib/map-studio/drafts"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:8010/healthz',{headers:{host:process.env.MAP_STUDIO_HEALTH_HOST||'map-studio.local'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/map_studio_server.js"]
