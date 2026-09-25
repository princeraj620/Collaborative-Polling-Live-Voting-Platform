# Stage 1: build the React UI.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Nginx serves the static UI and load-balances /api across replicas.
FROM nginx:1.27-alpine
# Templates are rendered with envsubst at container start
# (only variables prefixed EDGE_ are substituted, see compose file).
COPY nginx/templates/ /etc/nginx/templates/
COPY --from=web /web/dist /usr/share/nginx/html
EXPOSE 80
