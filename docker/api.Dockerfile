# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./backend/
COPY dating/backend/go.mod ./dating/backend/
WORKDIR /src/backend
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ /src/backend/
COPY dating/backend/ /src/dating/backend/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api \
    && CGO_ENABLED=0 go build -tags demo -trimpath -ldflags="-s -w" -o /out/api-demo ./cmd/api \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/modgrant ./cmd/modgrant

FROM build AS test
CMD ["go", "test", "./..."]

FROM alpine:3.23 AS runtime
RUN apk add --no-cache ca-certificates curl ffmpeg \
    && addgroup -g 10001 app \
    && adduser -D -u 10001 -G app app \
    && mkdir -p /var/lib/kutezh/media \
    && chown app:app /var/lib/kutezh/media
USER app
WORKDIR /app
EXPOSE 8080
CMD ["api"]

FROM runtime AS demo
COPY --from=build /out/api-demo /usr/local/bin/api

FROM runtime AS production
COPY --from=build /out/api /out/modgrant /usr/local/bin/
