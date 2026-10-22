#!/usr/bin/env bash
# Поиск секретов в отслеживаемых git файлах (и, по желанию, в истории). Ничего не меняет и не печатает сами значения — только файл:строка и тип.
#   scripts/secret-scan.sh            # рабочее дерево (git ls-files)
#   scripts/secret-scan.sh --staged   # только то, что в индексе (для pre-commit)
#   scripts/secret-scan.sh --history  # вся история (медленно на большом репозитории)
# Код выхода 1 — найдено. Ложное срабатывание: добавить строку «файл:тип» в .secret-scan-allow.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
MODE=tree; case "${1:-}" in --staged) MODE=staged;; --history) MODE=history;; esac
PATTERNS=(
  'aws_key|AKIA[0-9A-Z]{16}'
  'private_key|-----BEGIN [A-Z ]*PRIVATE KEY-----[[:space:]]*$'
  'sk_key|sk-[A-Za-z0-9_-]{32,}'
  'slack|xox[baprs]-[A-Za-z0-9-]{10,}'
  'github|gh[pousr]_[A-Za-z0-9]{30,}'
  'google_api|AIza[0-9A-Za-z_-]{35}'
  'jwt|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}'
  'url_password|[a-z]+://[A-Za-z0-9_.-]+:[^@/[:space:]$<{*]{6,}@[A-Za-z0-9.-]+'
  'assigned_secret|(password|passwd|secret|api[_-]?key|token)[A-Za-z_]*[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_+/=-]{20,}["'"'"']'
)
SKIP='(^|/)(package-lock\.json|.*\.md|\.env\.example|\.secret-scan-allow|scripts/secret-scan\.sh|scripts/audit/.*|src/i18n/en\.json)$'
ALLOW=.secret-scan-allow; [ -f "$ALLOW" ] || ALLOW=/dev/null
COMBINED=""; for p in "${PATTERNS[@]}"; do COMBINED="$COMBINED${COMBINED:+|}${p#*|}"; done
HITS="$(mktemp)"; trap 'rm -f "$HITS"' EXIT
classify() {  # stdin: "файл:строка:текст" → "[тип] файл:строка"
  while IFS= read -r line; do
    for p in "${PATTERNS[@]}"; do
      if printf '%s' "$line" | grep -qE -- "${p#*|}"; then
        f="$(printf '%s' "$line" | cut -d: -f1)"
        grep -qxF "$f:${p%%|*}" "$ALLOW" || echo "[${p%%|*}] $(printf '%s' "$line" | cut -d: -f1,2)"
        break
      fi
    done
  done
}
case $MODE in
  tree)    git ls-files -z | grep -zvE "$SKIP" | xargs -0 grep -IHnE -- "$COMBINED" 2>/dev/null | classify > "$HITS" ;;
  staged)  git diff --cached --name-only -z --diff-filter=ACM | grep -zvE "$SKIP" | while IFS= read -r -d '' f; do git show ":$f" 2>/dev/null | grep -InE -- "$COMBINED" | sed "s|^|$f:|"; done | classify > "$HITS" ;;
  history) git log --all -p --no-color -U0 --format='commit %h' -- . ':(exclude)*.md' ':(exclude)package-lock.json' ':(exclude)scripts/audit' | grep -E '^(\+[^+]|commit )' | sed 's/^+//' | awk '/^commit /{c=$2;next}{print c":0:"$0}' | grep -E -- "$COMBINED" | classify > "$HITS" ;;
esac
if [ -s "$HITS" ]; then cat "$HITS"; echo "Секреты найдены (значения не показаны). Уберите их из кода, смените ключ (docs/SECURITY-HARDENING.md, «Ротация») и только потом коммитьте."; exit 1; fi
echo "Секретов не найдено ($MODE)."
