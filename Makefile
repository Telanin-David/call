.PHONY: dev db migrate gen lint test build

dev:
	docker compose -f infra/docker-compose.dev.yml up -d
	@echo "Postgres on :5432, Valkey on :6379"
	@echo "Run: cd services/api && go run ./cmd/api"
	@echo "Run: cd apps/web && pnpm dev"

db:
	docker compose -f infra/docker-compose.dev.yml up -d postgres valkey

migrate:
	cd services/api && go run github.com/pressly/goose/v3/cmd/goose@latest \
		-dir migrations postgres "$(DATABASE_URL)" up

migrate-down:
	cd services/api && go run github.com/pressly/goose/v3/cmd/goose@latest \
		-dir migrations postgres "$(DATABASE_URL)" down

gen:
	cd packages/api-client && pnpm run generate

lint:
	cd services/api && golangci-lint run ./...
	pnpm --filter @dialer/web run lint

test:
	cd services/api && go test -race ./...

build:
	cd services/api && \
		CGO_ENABLED=0 go build -trimpath -o ../../dist/api ./cmd/api && \
		CGO_ENABLED=0 go build -trimpath -o ../../dist/dialer ./cmd/dialer && \
		CGO_ENABLED=0 go build -trimpath -o ../../dist/worker ./cmd/worker
	pnpm --filter @dialer/web build
