# One image, one process, one port. Build from the repository root:
#   docker compose -f selfhost/docker-compose.yml up --build
FROM node:22-alpine

WORKDIR /app

# Dependencies first so an edit to the source does not re-install everything.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# EDITION=full bakes the Vue client into the image. The build needs the relay
# URL up front (config.auth.api is fixed at build time), so pass PUBLIC_URL as
# the address people will actually type — a LAN IP or a domain, not localhost,
# unless the only visitor is on the host machine itself.
ARG EDITION=lite
ARG PUBLIC_URL=http://localhost:8080
RUN if [ "$EDITION" = "full" ]; then \
      VITE_RELAY_WS="$(echo "$PUBLIC_URL" | sed -e 's|^http|ws|')" \
      VITE_RELAY_GUN="$PUBLIC_URL/gun" \
      VITE_RELAY_API="$PUBLIC_URL" \
      VITE_WEB_ORIGIN="$PUBLIC_URL" \
      SELFHOST_URLS_PINNED=1 \
      node selfhost/build-full.js; \
    fi

ENV EDITION=$EDITION \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1

CMD ["node", "selfhost/relay/server.js"]
