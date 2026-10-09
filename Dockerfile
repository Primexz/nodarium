# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm run build

FROM golang:1.27-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY web/embed.go web/embed.go
COPY --from=frontend /src/web/dist web/dist
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/nodarium ./cmd/nodarium

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 monitor && useradd --uid 10001 --gid monitor --no-create-home monitor \
    && mkdir /data && chown monitor:monitor /data
COPY --from=backend /out/nodarium /usr/local/bin/nodarium
USER 10001:10001
ENV DATA_DIR=/data LISTEN_ADDR=:8080
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD ["nodarium", "healthcheck"]
ENTRYPOINT ["nodarium"]
