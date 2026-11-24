# Radar WhatsApp connector, for an always-on server (Railway, Fly.io, any VPS with Docker).
# It is a background worker: no web port. The WhatsApp login lives in AUTH_DIR, which must be
# on a persistent volume or every redeploy asks for a new QR code.
FROM node:20-slim

# git: the WhatsApp library pulls one package (libsignal) straight from GitHub.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
 && git config --global --add url."https://github.com/".insteadOf "git@github.com:"

WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

ENV NODE_ENV=production \
    AUTH_DIR=/data/auth

CMD ["node", "src/index.js"]
