# Debian-based image (not alpine) so bcrypt's prebuilt native binary works without compilers
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so this layer is cached when only source code changes
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8000
# Run as the unprivileged "node" user that ships with the image
USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://localhost:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
