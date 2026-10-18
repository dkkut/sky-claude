#!/usr/bin/env bash
# Аварийная копия КЛЮЧЕЙ Sky: ENCRYPTION_KEY, STORAGE_KEK_*, JWT_SECRET, REFRESH_TOKEN_SECRET из .env → один файл, зашифрованный
# паролем (gpg, AES-256). Без ENCRYPTION_KEY и KEK зашифрованные данные и копии НЕ открыть — этот файл защищает от потери сервера.
# Пароль вводится вручную и нигде не сохраняется. Сами значения на экран не выводятся.
#
#   cd /opt/sky
#   bash /opt/sky-src/scripts/key-escrow.sh export              # создать sky-keys-ДАТА.gpg (потом скачайте его и удалите с сервера)
#   bash /opt/sky-src/scripts/key-escrow.sh verify sky-keys-….gpg   # проверить, что файл открывается и ключи на месте (значения не печатаются)
#   bash /opt/sky-src/scripts/key-escrow.sh compare sky-keys-….gpg  # сверить файл с текущим .env (ключи совпадают / нет)
#
# Хранить файл и пароль ОТДЕЛЬНО друг от друга и от сервера (флешка, менеджер паролей). Потеряете пароль — файл не открыть.
set -euo pipefail
cd "${APP_DIR:-/opt/sky}"
command -v gpg >/dev/null 2>&1 || { echo "Нужен gpg: apt-get install -y gnupg"; exit 1; }
ENVF="${ENV_FILE:-.env}"
PATTERN='^(ENCRYPTION_KEY|JWT_SECRET|REFRESH_TOKEN_SECRET|STORAGE_KEK_[A-Za-z0-9_]+|STORAGE_KEK_ACTIVE)='
pick() { grep -E "$PATTERN" "$ENVF" || true; }
names() { sed -E 's/=.*//' | sort; }

case "${1:-}" in
  export)
    [ -f "$ENVF" ] || { echo "Не найден $ENVF (запускайте из каталога приложения)."; exit 1; }
    payload="$(pick)"
    echo "$payload" | grep -q '^ENCRYPTION_KEY=' || { echo "В $ENVF нет ENCRYPTION_KEY — копировать нечего (ключ выводится из JWT_SECRET)."; }
    [ -n "$payload" ] || { echo "Нет ни одного ключа для копирования."; exit 1; }
    out="sky-keys-$(date +%Y%m%d-%H%M%S).gpg"
    umask 077
    printf '%s\n' "$payload" | gpg --batch=false --yes --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --s2k-digest-algo SHA512 -o "$out"
    # проверка: расшифровывается и совпадает (пароль вводится ещё раз)
    if ! gpg --quiet --decrypt "$out" 2>/dev/null | cmp -s - <(printf '%s\n' "$payload"); then rm -f "$out"; echo "✖ Проверка не прошла (пароль при повторном вводе не совпал?). Файл удалён."; exit 1; fi
    chmod 600 "$out"
    echo "✔ Создан $PWD/$out. Внутри ключи: $(printf '%s\n' "$payload" | names | tr '\n' ' ')"
    echo "  Дальше: скачайте файл с сервера, сохраните ВНЕ сервера, затем удалите его здесь: shred -u $out"
    ;;
  verify|compare)
    f="${2:-}"; [ -f "$f" ] || { echo "Укажите файл: $0 $1 sky-keys-….gpg"; exit 1; }
    dec="$(gpg --quiet --decrypt "$f")" || { echo "✖ Файл не открылся (неверный пароль или повреждён)."; exit 1; }
    echo "✔ Файл открывается. Ключи внутри: $(printf '%s\n' "$dec" | names | tr '\n' ' ')"
    printf '%s\n' "$dec" | grep -q '^ENCRYPTION_KEY=.\{16,\}' || echo "⚠ ENCRYPTION_KEY в файле отсутствует или слишком короткий."
    if [ "$1" = compare ]; then
      [ -f "$ENVF" ] || { echo "Нет $ENVF для сверки."; exit 1; }
      if diff -q <(printf '%s\n' "$dec" | sort) <(pick | sort) >/dev/null; then echo "✔ Ключи в файле совпадают с текущим $ENVF."; else echo "⚠ Ключи в файле ОТЛИЧАЮТСЯ от текущего $ENVF (после смены ключей сделайте новую копию)."; exit 2; fi
    fi
    ;;
  *) sed -n 2,12p "$0"; exit 1;;
esac
