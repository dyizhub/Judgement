# Judgement game server — small production image.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install deps first so this layer caches between code-only deploys.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Server + bot AI + the web client it serves.
COPY server.js bots.js ./
COPY public ./public

EXPOSE 3000
CMD ["node", "server.js"]
