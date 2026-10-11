.PHONY: test web build deps
GO ?= go
deps:
	docker compose up -d --wait
	npm ci --prefix web
test:
	$(GO) test -race ./...
	$(GO) vet ./...
	npm test --prefix web
web:
	npm run dev --prefix web
build:
	npm run build --prefix web
	$(GO) build -trimpath -o bin/gte ./cmd/gte
