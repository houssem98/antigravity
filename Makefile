# ─────────────────────────────────────────────────
#  Antigravity — Monorepo Makefile
# ─────────────────────────────────────────────────
#  make dev       → Start all services (Gravity API + Market Server + both UIs)
#  make infra     → Docker Compose up (Postgres, Redis, Qdrant, ES, Neo4j)
#  make seed      → Seed Gravity API with sample SEC filings
#  make test      → Run backend pytest + frontend vitest
#  make build     → Production builds for all apps
#  make down      → Docker Compose down
#  make clean     → Remove all node_modules, .venv, dist
#  make health    → Ping all service health endpoints
# ─────────────────────────────────────────────────

.PHONY: dev infra seed test build down clean health install

# ── Install ──────────────────────────────────────
install:
	npm install
	cd services/gravity-api && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt

# ── Development ──────────────────────────────────
dev:
	npx concurrently --kill-others-on-fail \
		--names "GRAVITY-API,MARKET-SRV,GRAVITY-UI,MARKET-UI" \
		--prefix-colors "cyan.bold,yellow.bold,green.bold,magenta.bold" \
		"cd services/gravity-api && .venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" \
		"npm -w market-server run dev" \
		"npm -w gravity-ui run dev" \
		"npm -w market-ui run dev"

# ── Infrastructure ───────────────────────────────
infra:
	docker compose -f infra/docker-compose.yml up -d

down:
	docker compose -f infra/docker-compose.yml down

# ── Seeding ──────────────────────────────────────
seed:
	cd services/gravity-api && .venv\Scripts\python -m scripts.seed_data

# ── Testing ──────────────────────────────────────
test:
	cd services/gravity-api && .venv\Scripts\python -m pytest tests/ -v
	npm -ws run test --if-present

# ── Build ────────────────────────────────────────
build:
	npm -w shared-types run build --if-present
	npm -w gravity-ui run build
	npm -w market-ui run build
	npm -w market-server run build

# ── Clean ────────────────────────────────────────
clean:
	npm run clean

# ── Health Check ─────────────────────────────────
health:
	powershell -ExecutionPolicy Bypass -File scripts/health-check.ps1
