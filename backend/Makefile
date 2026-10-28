# FLIRT — wrapper subțire peste `docker compose`, DOAR pentru DEZVOLTARE LOCALĂ.
# Fiecare țintă afișează comanda pe care o rulează, ca să poți renunța oricând la make.
#
# ⛔ Producția NU se pornește de aici: rulează pe k3s —
#    ssh flirt 'cd /opt/flirt && deploy/k8s/scripts/deploy.sh'
#    (runbook: deploy/k8s/scripts/README.md). NU rula docker compose pe server.
#
#   make up       — pornește stiva de dev (db + redis + api; migrații automate)
#   make down     — oprește tot (datele rămân în volume)
#   make logs     — log-urile, live
#   make migrate  — rulează migrațiile manual (normal se fac singure la `up`)
#   make check    — readiness-ul API-ului local
#   make config   — validează un .env (guardul din config.py)
#   make ps       — starea serviciilor
.DEFAULT_GOAL := help

DC := docker compose

.PHONY: help up down restart logs ps migrate check config build

help:
	@grep -E '^#   make' $(MAKEFILE_LIST) | sed 's/^#   /  /'

## Pornește stiva de dev. Migrațiile rulează automat (entrypoint.sh).
up:
	$(DC) up --build -d
	@echo "→ aștept API healthy..."
	@for i in $$(seq 1 60); do \
		$(DC) ps api | grep -q healthy && { echo "✓ api healthy"; exit 0; }; \
		sleep 5; \
	done; echo "✗ api nu a devenit healthy — vezi 'make logs'"; exit 1

down:
	$(DC) down

restart:
	$(DC) restart

build:
	$(DC) build

logs:
	$(DC) logs -f --tail 100

ps:
	$(DC) ps

## Migrațiile rulează AUTOMAT la fiecare `up`. Ținta asta e pentru cazuri speciale
## (ex. ai restaurat un dump dintr-o schemă mai veche).
migrate:
	$(DC) exec api alembic upgrade head
	$(DC) exec api alembic current

## Readiness-ul API-ului local (portul 8000 e publicat de docker-compose.override.yml).
check:
	@$(DC) ps
	@curl -fsS http://localhost:8000/health/ready -w "\n   HTTP %{http_code}\n" \
		|| echo "   ✗ nu răspunde (ai copiat docker-compose.override.example.yml?)"

## Validează .env fără să pornească nimic: (1) valori necompletate, (2) guardul din
## config.py. Guardul singur NU prinde un `.env` copiat și necompletat (pentru el,
## `<<< COMPLETEAZĂ >>>` e un șir nevid, deci „valid") — de aia verificăm întâi
## placeholderele. Pe server, deploy/k8s/scripts/deploy.sh face aceleași verificări.
config:
	@test -f .env || { echo "✗ .env lipsește. Rulează: cp .env.example .env"; exit 1; }
	@if grep -n 'COMPLETEAZĂ' .env | grep -qvE '^[0-9]+:[[:space:]]*#'; then \
		echo "✗ .env are valori NECOMPLETATE:"; \
		grep -n 'COMPLETEAZĂ' .env | grep -vE '^[0-9]+:[[:space:]]*#' \
			| cut -d= -f1 | sed 's/^/    /'; \
		exit 1; \
	fi
	@echo "✓ niciun <<< COMPLETEAZĂ >>> rămas în .env"
	$(DC) run --rm --no-deps api \
		python -c "from app.core.config import Settings; Settings(); print('✓ config OK')"
