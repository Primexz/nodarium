.PHONY: build test dev docker format format-check update-mining-pools
build:
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web build
	go build -trimpath -o bin/nodarium ./cmd/nodarium

test:
	go test -race ./...
	pnpm --dir web test

dev:
	DATA_DIR=./data go run ./cmd/nodarium

docker:
	docker build -t nodarium:local .

format:
	gofmt -w cmd internal web/embed.go
	pnpm --dir web format

format-check:
	@test -z "$$(gofmt -l cmd internal web/embed.go)" || { gofmt -l cmd internal web/embed.go; exit 1; }
	pnpm --dir web lint
	pnpm --dir web format:check

update-mining-pools:
	go run ./cmd/update-mining-pools
