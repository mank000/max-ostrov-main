FROM node:24-alpine AS build
WORKDIR /src
COPY frontend/package*.json ./frontend/
COPY dating/frontend/package*.json ./dating/frontend/
COPY games/package*.json ./games/
COPY moderation/package*.json ./moderation/
RUN cd frontend && npm ci \
    && cd ../dating/frontend && npm ci \
    && cd ../../games && npm ci \
    && cd ../moderation && npm ci
COPY frontend/ ./frontend/
COPY dating/frontend/ ./dating/frontend/
COPY games/ ./games/
COPY moderation/ ./moderation/
FROM build AS check
RUN npm --prefix frontend run typecheck \
    && npm --prefix dating/frontend run typecheck \
    && npm --prefix games run typecheck \
    && npm --prefix moderation run typecheck
CMD ["node", "--version"]

FROM check AS bundle
RUN npm --prefix frontend run build && npm --prefix moderation run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/proxy.conf /etc/nginx/proxy.conf
COPY --from=bundle /src/frontend/dist/ /usr/share/nginx/html/app/
COPY --from=bundle /src/moderation/dist/ /usr/share/nginx/html/moderation/
EXPOSE 8080 8081
CMD ["nginx", "-g", "daemon off;"]
