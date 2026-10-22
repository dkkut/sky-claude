#!/usr/bin/env bash
# Ставит локальный pre-commit: перед каждым коммитом ищет секреты в индексе (scripts/secret-scan.sh --staged). Снять: rm .git/hooks/pre-commit
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
exec bash "$(git rev-parse --show-toplevel)/scripts/secret-scan.sh" --staged
HOOK
chmod +x .git/hooks/pre-commit
echo "pre-commit установлен."
