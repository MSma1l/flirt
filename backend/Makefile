# FLIRT — wrapper subțire peste `docker compose`. Nu e un al doilea sistem de build:
# fiecare țintă afișează comanda pe care o rulează, ca să poți renunța oricând la make.
#
#   make up       — pornește tot (build + migrații automate)
#   make down     — oprește tot (datele rămân în volume)
#   make logs     — log-urile, live
#   make migrate  — rulează migrațiile manual (normal se fac singure la `up`)
#   make backup   — backup pg_dump ACUM
#   make restore  — restore dintr-un backup (FILE=...)
#   make check    — verifică sănătatea stack-ului
#   make config   — validează .env pentru producție (guardul din config.py)
#   make ps       — starea serviciilor
.DEFAULT_GOAL := help

DC      := docker compose
DOMAIN  := $(shell grep -E '^DOMAIN=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs)
DOMAIN  := $(if $(DOMAIN),$(DOMAIN),localhost)

.PHONY: help up down restart logs ps migrate backup restore check config build

help:
	@grep -E '^#   make' $(MAKEFILE_LIST) | sed 's/^#   /  /'

## Pornește tot stack-ul. Migrațiile rulează automat (entrypoint.sh), certificatul
## Let's Encrypt se emite singur. Ăsta e SINGURUL pas de deploy.
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

## Backup manual, acum. Fă-l ÎNTOTDEAUNA înainte de un deploy cu migrații.
backup:
	$(DC) exec backup sh /scripts/backup_db.sh
	@ls -lh $${BACKUP_HOST_DIR:-./backups} | tail -5

## Restore. Implicit într-o bază de TEST (nu atinge producția):
##   make restore FILE=/backups/flirt-20260713-030000.sql.gz
## Restore REAL peste producție (pierzi datele curente):
##   make restore FILE=... FORCE=1
restore:
	@test -n "$(FILE)" || { echo "Lipsește FILE=. Ex: make restore FILE=/backups/flirt-20260713-030000.sql.gz"; \
	  echo "Backup-uri disponibile:"; $(DC) exec backup ls -1 /backups; exit 2; }
ifdef FORCE
	@echo "⚠️  RESTORE PESTE PRODUCȚIE. Opresc scrierile..."
	$(DC) stop api purge
	$(DC) run --rm backup sh /scripts/restore_db.sh $(FILE) --force
	$(DC) start api purge
	@$(MAKE) --no-print-directory check
else
	@echo "→ Restore de TEST în baza 'flirt_restore_test' (producția nu e atinsă)."
	$(DC) run --rm -e PGDATABASE=flirt_restore_test backup sh /scripts/restore_db.sh $(FILE)
endif

## Sănătatea reală: readiness prin nginx (TLS), nu un ping oarecare.
check:
	@echo "→ Servicii:"
	@$(DC) ps
	@echo
	@echo "→ Readiness (prin nginx, pe $(DOMAIN)):"
	@curl -sk --resolve "$(DOMAIN):443:127.0.0.1" "https://$(DOMAIN)/health/ready" \
		-w "\n   HTTP %{http_code}\n" || echo "   ✗ nu răspunde"
	@echo
	@echo "→ Certificat TLS:"
	@echo | openssl s_client -connect 127.0.0.1:443 -servername $(DOMAIN) 2>/dev/null \
		| openssl x509 -noout -issuer -subject -enddate 2>/dev/null \
		|| echo "   ✗ nu pot citi certificatul"
	@echo "   (issuer = Let's Encrypt → real; issuer = subject → încă self-signed)"

## Validează .env fără să pornească nimic: (1) valori necompletate, (2) guardul de
## producție din config.py. Guardul singur NU prinde un `.env` copiat și necompletat
## (pentru el, `<<< COMPLETEAZĂ >>>` e un șir nevid, deci „valid") — de aia verificăm
## întâi placeholderele.
config:
	@test -f .env || { echo "✗ .env lipsește. Rulează: cp .env.production.example .env"; exit 1; }
	@if grep -n 'COMPLETEAZĂ' .env | grep -qvE '^[0-9]+:[[:space:]]*#'; then \
		echo "✗ .env are valori NECOMPLETATE:"; \
		grep -n 'COMPLETEAZĂ' .env | grep -vE '^[0-9]+:[[:space:]]*#' \
			| cut -d= -f1 | sed 's/^/    /'; \
		exit 1; \
	fi
	@echo "✓ niciun <<< COMPLETEAZĂ >>> rămas în .env"
	$(DC) run --rm --no-deps api \
		python -c "from app.core.config import Settings; Settings(); print('✓ config OK pentru producție')"
