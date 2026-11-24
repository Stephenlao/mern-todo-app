# ---------- Stage 1: build the React app into static files ----------
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# CRA bakes REACT_APP_* into the JS bundle at build time, so it must be a build arg.
# "/api" = same origin as the page; Nginx below proxies it to the backend container.
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL
RUN npm run build

# ---------- Stage 2: serve the static files with Nginx ----------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
