.PHONY: help up down logs clean build test demo compat dist k8s

help:
	@echo "ECCA Stack v3 — make targets"
	@echo "  make up        # docker compose up -d --build"
	@echo "  make down      # tear down + volumes"
	@echo "  make logs      # tail compose logs"
	@echo "  make build     # turbo build all packages"
	@echo "  make test      # turbo test"
	@echo "  make demo      # run e2e demo"
	@echo "  make compat    # replay v2 test vectors"
	@echo "  make dist      # docker stack deploy (Swarm)"
	@echo "  make k8s       # render Helm charts"

up:
	docker compose up -d --build

down:
	docker compose down -v --remove-orphans

logs:
	docker compose logs -f --tail=200

build:
	pnpm install --frozen-lockfile=false
	pnpm build

test:
	pnpm test

demo:
	pnpm demo

compat:
	pnpm compat

dist:
	docker stack deploy -c docker-compose.distributed.yml ecca

k8s:
	helm template ecca deploy/k8s/

clean:
	pnpm clean
	docker compose down -v --remove-orphans
