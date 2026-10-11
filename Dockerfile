FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.2-alpine AS go
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /gte ./cmd/gte

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S gte && adduser -S -G gte gte
WORKDIR /app
COPY --from=go /gte /app/gte
COPY --from=web /src/web/dist /app/web
COPY THIRD_PARTY_NOTICES.md LICENSE /app/
USER gte
ENV LISTEN_ADDR=0.0.0.0:8080 WEB_DIR=/app/web GRAPH_DIR=/app/routing APP_ENV=production
EXPOSE 8080
ENTRYPOINT ["/app/gte"]
