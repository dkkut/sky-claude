#!/usr/bin/env bash
# Хранить .env на сервере ЗАШИФРОВАННЫМ (gpg, AES-256, пароль вводится вручную и нигде не сохраняется).
# Открытый .env нужен только в момент запуска/пересоздания контейнеров (docker compose читает его тогда); работающие контейнеры
# уже держат значения в памяти. Поэтому: большую часть времени на диске только .env.gpg.
#
#   cd /opt/sky
#   bash /opt/sky-src/scripts/env-seal.sh seal            # зашифровать .env → .env.gpg, открытый .env удалить (shred)
#   bash /opt/sky-src/scripts/env-seal.sh unseal          # расшифровать .env.gpg → .env (для правок/деплоя), права 600
#   bash /opt/sky-src/scripts/env-seal.sh run bash /opt/sky-src/scripts/deploy-local.sh
#                                                         # расшифровать → выполнить команду → снова зашифровать и удалить .env
#   bash /opt/sky-src/scripts/env-seal.sh check           # есть ли открытый .env и зашифрованная копия
#
# ВАЖНО: пароль храните отдельно от сервера (менеджер паролей). Потеряете пароль — .env.gpg не открыть; копия .env у вас на компьютере должна быть.
# Ограничение, о котором надо знать: пока контейнеры работают, секреты есть в их окружении (docker inspect, root на хосте их увидит) —
# шифрование .env защищает файл на диске и его копии, а не работающий процесс.
set -euo pipefail
cd "${APP_DIR:-/opt/sky}"
command -v gpg >/dev/null 2>&1 || { echo "Нужен gpg: apt-get install -y gnupg"; exit 1; }
ENC=".env.gpg"
shred_file() { [ -f "$1" ] && { shred -u "$1" 2>/dev/null || rm -f "$1"; }; true; }

seal() {
  [ -f .env ] || { echo ".env не найден в $PWD"; exit 1; }
  umask 077
  local tmp; tmp="$(mktemp .env.gpg.XXXXXX)"
  gpg --batch=false --yes --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --s2k-digest-algo SHA512 -o "$tmp" .env
  # Проверка: расшифровывается и совпадает с оригиналом — только потом удаляем открытый файл
  if ! gpg --quiet --decrypt "$tmp" 2>/dev/null | cmp -s - .env; then rm -f "$tmp"; echo "✖ Проверка не прошла (неверный пароль при повторном вводе?). .env НЕ тронут."; exit 1; fi
  mv "$tmp" "$ENC"; chmod 600 "$ENC"
  shred_file .env
  echo "✔ Зашифровано: $PWD/$ENC. Открытый .env удалён."
}
unseal() {
  [ -f "$ENC" ] || { echo "$ENC не найден"; exit 1; }
  [ ! -f .env ] || { echo "Открытый .env уже есть — ничего не делаю."; exit 1; }
  umask 077
  gpg --quiet --decrypt -o .env "$ENC"; chmod 600 .env
  echo "✔ Расшифровано в $PWD/.env (права 600). После работы: bash $0 seal"
}
case "${1:-}" in
  seal) seal ;;
  unseal) unseal ;;
  run)
    shift; [ "$#" -gt 0 ] || { echo "Укажите команду после run"; exit 1; }
    had=0; [ -f .env ] && had=1
    [ "$had" = 1 ] || unseal
    rc=0; "$@" || rc=$?
    if [ "$had" = 0 ]; then
      # Если в .env что-то правили во время команды — зашифровываем новое состояние
      seal
    fi
    exit $rc ;;
  check)
    [ -f .env ] && echo "  ! открытый .env на диске" || echo "  ✔ открытого .env нет"
    [ -f "$ENC" ] && echo "  ✔ есть $ENC" || echo "  ✖ нет $ENC" ;;
  *) sed -n 2,16p "$0"; exit 1 ;;
esac
