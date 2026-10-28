# syntax=docker/dockerfile:1
# FLIRT — imaginea `flirt-web`: panoul de admin + Telegram Mini App (fișiere
# statice) + nginx-ul care face proxy către API (Service `api`, port 8000).
#
# Build (context = RĂDĂCINA repo-ului, BuildKit obligatoriu pentru
# `Dockerfile.dockerignore`):
#   DOCKER_BUILDKIT=1 docker build -f deploy/k8s/images/web/Dockerfile \
#     --build-arg DOMAIN=api.flrt.md --build-arg TELEGRAM_BOT_USERNAME=... \
#     -t flirt-web:<tag> .
#
# Echivalentul serviciilor `admin-build` / `miniapp-build` din
# backend/docker-compose.yml (scripts/build_admin.sh, build_miniapp.sh), cu O
# DIFERENȚĂ voită: un build stricat FACE build-ul imaginii să eșueze (nu mai
# servim placeholder). În k8s asta e corect — deploy.sh se oprește, iar
# versiunea veche rămâne online.
#
# Variabilele VITE_* sunt inline-uite în bundle la BUILD → vin ca ARG-uri.
# NICIUN SECRET aici: bundle-ul e public (TELEGRAM_BOT_TOKEN NU intră niciodată).

# --------------------------------------------------------------------------- #
# 1. Panoul de admin — node:20 (ca `admin-build`)
# --------------------------------------------------------------------------- #
FROM node:20-alpine AS admin
WORKDIR /src/admin
# Întâi doar manifestele npm: layer-ul cu dependențe se reface doar când se
# schimbă lock-file-ul, nu la fiecare modificare de cod.
COPY admin/package.json admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
# `tsc --noEmit` verifică și testul de paritate admin/src/lib/coverFraming.parity.test.ts,
# care importă `../../../miniapp/src/...` → sursele miniapp trebuie să stea lângă
# admin, iar importurile lor (react) se rezolvă prin node_modules la rădăcină.
COPY miniapp/src /src/miniapp/src
RUN ln -s /src/admin/node_modules /src/node_modules
COPY admin/ ./
# ARG-urile DUPĂ `npm ci`: o schimbare de domeniu nu reinstalează dependențele.
ARG DOMAIN=localhost
ARG API_V1_PREFIX=/api/v1
ARG VITE_API_URL=
# Gol → compus din DOMAIN, exact ca build_admin.sh.
RUN VITE_API_URL="${VITE_API_URL:-https://${DOMAIN}${API_V1_PREFIX}}" \
    && export VITE_API_URL \
    && echo "VITE_API_URL=${VITE_API_URL}" \
    && npm run build \
    && test -f dist/index.html

# --------------------------------------------------------------------------- #
# 2. Telegram Mini App — node:22 (`react-router` cere >=22.22)
# --------------------------------------------------------------------------- #
FROM node:22-alpine AS miniapp
WORKDIR /src/miniapp
COPY miniapp/package.json miniapp/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Sursele partajate cu aplicația mobilă (alias-urile @mobile/ și @theme/ din
# miniapp/vite.config.ts arată spre ../mobile). __tests__ sunt excluse prin
# Dockerfile.dockerignore (ca în build_miniapp.sh).
COPY mobile/src /src/mobile/src
COPY mobile/theme /src/mobile/theme
# Puntea de dependențe: sursele din mobile/ importă axios, i18next etc., iar
# TypeScript le caută urcând din folderul fișierului → node_modules la rădăcină.
RUN ln -s /src/miniapp/node_modules /src/node_modules
COPY miniapp/ ./
ARG DOMAIN=localhost
ARG API_V1_PREFIX=/api/v1
ARG VITE_API_URL=
ARG TELEGRAM_BOT_USERNAME=
ARG VITE_TELEGRAM_BOT_USERNAME=
RUN VITE_API_URL="${VITE_API_URL:-https://${DOMAIN}${API_V1_PREFIX}}" \
    && VITE_TELEGRAM_BOT_USERNAME="${VITE_TELEGRAM_BOT_USERNAME:-${TELEGRAM_BOT_USERNAME}}" \
    && export VITE_API_URL VITE_TELEGRAM_BOT_USERNAME \
    && echo "VITE_API_URL=${VITE_API_URL} VITE_TELEGRAM_BOT_USERNAME=${VITE_TELEGRAM_BOT_USERNAME}" \
    && npm run build \
    && test -f dist/index.html

# --------------------------------------------------------------------------- #
# 3. Runtime — nginx NON-ROOT (uid 101), port 8080
# --------------------------------------------------------------------------- #
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Configul implicit al imaginii (server pe :8080 pentru `localhost`) ar concura
# cu blocurile noastre. /var/www/media = punctul de montare al volumului media
# (read-only, același PVC pe care scrie `api`).
USER root
RUN rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /var/www/admin /var/www/miniapp /var/www/media /etc/nginx/flirt /etc/nginx/snippets

COPY deploy/k8s/images/web/nginx.conf /etc/nginx/nginx.conf
COPY deploy/k8s/images/web/nginx.conf.template /etc/nginx/flirt/flirt.conf.template
COPY deploy/k8s/images/web/proxy-api.conf /etc/nginx/snippets/proxy-api.conf
COPY deploy/k8s/images/web/entrypoint.sh /usr/local/bin/flirt-web-entrypoint.sh
COPY --from=admin /src/admin/dist /var/www/admin
COPY --from=miniapp /src/miniapp/dist /var/www/miniapp

# Fișierele statice: citibile de toți, proprietatea lui root → nginx (101) NU
# le poate modifica nici dacă ar fi compromis.
RUN chmod 0755 /usr/local/bin/flirt-web-entrypoint.sh \
    && chmod -R a+rX /var/www /etc/nginx/flirt /etc/nginx/snippets /etc/nginx/nginx.conf

USER 101
EXPOSE 8080

# Randare șablon (envsubst, listă fixă de variabile) → `nginx -t` → nginx.
# Tot ce se scrie la rulare stă în /tmp (compatibil cu readOnlyRootFilesystem
# + emptyDir pe /tmp). STOPSIGNAL SIGQUIT (oprire grațioasă) vine din imaginea de bază.
ENTRYPOINT ["/usr/local/bin/flirt-web-entrypoint.sh"]
