# ============================================================
#  WEB — сборка фронтенда и раздача статики через nginx.
#  Собирается в Node, отдаётся nginx: в образ попадает только dist,
#  без node_modules и исходников.
# ============================================================

# ---------- stage 1: сборка ----------
FROM node:22-alpine AS build

WORKDIR /app

# Сначала манифесты — слой с зависимостями переиспользуется, пока они не менялись.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .

# tsc --noEmit + vite build: типы проверяются на этапе сборки образа,
# сломанный по типам код не доедет до продакшна.
RUN npm run build

# ---------- stage 2: раздача ----------
FROM nginx:1.27-alpine AS runtime

# Свои конфиги вместо дефолтных.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/nginx.conf   /etc/nginx/nginx.conf
COPY nginx/snippets/    /etc/nginx/snippets/
# Шаблоны обрабатываются entrypoint-ом образа: envsubst подставит ${DOMAIN}
# и положит результат в /etc/nginx/conf.d/ при старте контейнера.
COPY nginx/templates/   /etc/nginx/templates/
# KutRent Market (market.kutrent.online) — второй вхост, но НЕ через
# штатный envsubst-on-templates (см. docker-entrypoint.d/05-market-nginx.sh
# за подробностями, почему у него отдельная обработка): сюда, а не в
# /etc/nginx/templates.
COPY nginx/market-template/ /etc/nginx/market-template/
# Скрипты отсюда entrypoint образа выполняет перед стартом nginx.
COPY nginx/docker-entrypoint.d/ /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/*.sh
# openssl — 05-market-nginx.sh генерирует временный самоподписанный
# сертификат, пока для market.kutrent.online не выпущен настоящий.
RUN apk add --no-cache openssl

COPY --from=build /app/dist /usr/share/nginx/html

# KutRent Market — обычная статика (без сборки: чистые HTML/CSS/JS),
# отдаётся market.conf.template отдельным вхостом, см. Root=выше.
COPY market-site/ /usr/share/nginx/html-market

# Каталог для ACME-челленджей Let's Encrypt.
RUN mkdir -p /var/www/certbot

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
