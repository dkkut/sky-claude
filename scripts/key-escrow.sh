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
# Пароль спрашиваем сами и отдаём gpg через дескриптор (--pinentry-mode loopback): иначе в SSH без tty (телефон, Termius)
# gpg падает с «Inappropriate ioctl for device». Пароль не попадает ни в аргументы, ни в историю, ни в файлы.
export GPG_TTY="$(tty 2>/dev/null || true)"
ask() { local p; if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then read -rsp "$1" p </dev/tty; else read -rsp "$1" p; fi; echo >&2; printf '%s' "$p"; }
G=(gpg --batch --yes --pinentry-mode loopback --quiet)
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
    pw1="$(ask 'Придумайте пароль для файла: ')"; pw2="$(ask 'Повторите пароль: ')"
    [ -n "$pw1" ] && [ "${#pw1}" -ge 12 ] || { echo "Пароль слишком короткий — нужно от 12 знаков."; exit 1; }
    [ "$pw1" = "$pw2" ] || { echo "Пароли не совпали. Ничего не создано."; exit 1; }
    "${G[@]}" --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-count 65011712 --s2k-digest-algo SHA512 --passphrase-fd 3 -o "$out" 3<<<"$pw1" <<<"$payload"
    # проверка: файл расшифровывается введённым паролем и совпадает
    if ! "${G[@]}" --decrypt --passphrase-fd 3 "$out" 3<<<"$pw1" 2>/dev/null | cmp -s - <(printf '%s\n' "$payload"); then rm -f "$out"; echo "✖ Проверка не прошла. Файл удалён."; exit 1; fi
    unset pw1 pw2
    chmod 600 "$out"
    echo "✔ Создан $PWD/$out. Внутри ключи: $(printf '%s\n' "$payload" | names | tr '\n' ' ')"
    echo "  Дальше: скачайте файл с сервера, сохраните ВНЕ сервера, затем удалите его здесь: shred -u $out"
    ;;
  verify|compare)
    f="${2:-}"; [ -f "$f" ] || { echo "Укажите файл: $0 $1 sky-keys-….gpg"; exit 1; }
    pw="$(ask 'Пароль от файла: ')"
    dec="$("${G[@]}" --decrypt --passphrase-fd 3 "$f" 3<<<"$pw" 2>/dev/null)" || { echo "✖ Файл не открылся (неверный пароль или повреждён)."; exit 1; }
    unset pw
    echo "✔ Файл открывается. Ключи внутри: $(printf '%s\n' "$dec" | names | tr '\n' ' ')"
    printf '%s\n' "$dec" | grep -q '^ENCRYPTION_KEY=.\{16,\}' || echo "⚠ ENCRYPTION_KEY в файле отсутствует или слишком короткий."
    if [ "$1" = compare ]; then
      [ -f "$ENVF" ] || { echo "Нет $ENVF для сверки."; exit 1; }
      if diff -q <(printf '%s\n' "$dec" | sort) <(pick | sort) >/dev/null; then echo "✔ Ключи в файле совпадают с текущим $ENVF."; else echo "⚠ Ключи в файле ОТЛИЧАЮТСЯ от текущего $ENVF (после смены ключей сделайте новую копию)."; exit 2; fi
    fi
    ;;
  *) sed -n 2,12p "$0"; exit 1;;
esac
