#!/usr/bin/env bash
# Сборка приложений Sky на сервере и складывание в каталог хранилища (по умолчанию /opt/sky/apps).
#   bash scripts/build-apps.sh apk          # Android (.apk): нужен JDK 17 и Android SDK (ANDROID_HOME)
#   bash scripts/build-apps.sh exe          # Windows (.exe, NSIS): на Linux нужен wine (apt install wine64); надёжнее — GitHub Actions
#   bash scripts/build-apps.sh ipa          # iOS (.ipa): ТОЛЬКО на macOS с Xcode и подписью Apple; на Linux-сервере невозможно
#   bash scripts/build-apps.sh all          # всё, что возможно на этой машине; остальное пропускается с пояснением
#   OUT=/путь bash scripts/build-apps.sh apk   # другой каталог
# Результат: $OUT/<имя>-<версия>-<дата>.<ext> + SHA256SUMS. Файлы потом можно загрузить в админке «Сайт» → «Скачивание».
# Сборка идёт из исходников этого каталога (vite build --mode native), боевой сервер не затрагивается.
set -uo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-/opt/sky/apps}"; STAMP="$(date +%Y%m%d)"
VER="$(node -p "require('./package.json').version" 2>/dev/null || echo 0)"
mkdir -p "$OUT"; chmod 755 "$OUT"
# Предохранитель: сборка (Gradle, wine, vite) тяжёлая, а сервер боевой. Без запаса места и памяти не начинаем —
# именно сборка приложений однажды положила сайт. FORCE=1 — начать всё равно. Приоритет сборки понижаем.
free_gb=$(df -P "$OUT" | awk 'NR==2{print int($4/1048576)}'); mem_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
if [ "${FORCE:-0}" != 1 ] && { [ "${free_gb:-0}" -lt 8 ] || [ "${mem_mb:-0}" -lt 2500 ]; }; then
  echo "Сборка отложена: свободно ${free_gb} ГБ диска и ${mem_mb} МБ памяти (нужно ≥8 ГБ и ≥2500 МБ). Соберите через GitHub Actions или повторите с FORCE=1."; exit 1
fi
if [ -z "${SKY_BUILD_NICE:-}" ]; then export SKY_BUILD_NICE=1; exec nice -n 19 ionice -c3 bash "$0" "$@" 2>/dev/null || exec nice -n 19 bash "$0" "$@"; fi
ok=0; skipped=()
need() { command -v "$1" >/dev/null 2>&1; }
sums() { ( cd "$OUT" && sha256sum -- *.apk *.exe *.ipa 2>/dev/null > SHA256SUMS ); }
# Оптимизация выгрузки: (1) веб-часть native собирается ОДИН раз для apk и exe (раньше дважды по ~3 минуты);
# (2) npm ci — только если изменился package-lock.json; (3) если исходники приложения не менялись с прошлой сборки и файл на месте —
# сборка пропускается (FORCE_BUILD=1 — собрать заново); (4) Gradle с кэшем и ограничением памяти; (5) хранятся только KEEP (3) последних файлов.
KEEP="${KEEP:-3}"
srchash() { { find src public electron android/app/src capacitor.config.* package.json package-lock.json .env.native vite.config.ts index.html -type f 2>/dev/null | sort | xargs -r sha256sum; } | sha256sum | cut -c1-16; }
SRC_HASH="$(srchash)"
unchanged() { # $1 = apk|exe → путь готового файла, если исходники те же
  local st="$OUT/.stamp-$1" f; [ "${FORCE_BUILD:-0}" = 1 ] && return 1; [ -f "$st" ] || return 1
  [ "$(sed -n 1p "$st")" = "$SRC_HASH" ] || return 1; f="$(sed -n 2p "$st")"; [ -f "$f" ] || return 1; echo "$f"
}
stamp() { printf '%s\n%s\n' "$SRC_HASH" "$2" > "$OUT/.stamp-$1"; }
prune() { ls -t "$OUT"/*."$1" 2>/dev/null | tail -n +"$((KEEP+1))" | xargs -r rm -f; }
prep() {
  local lh; lh="$(sha256sum package-lock.json 2>/dev/null | cut -c1-16)"
  if [ -d node_modules ] && [ -f node_modules/.sky-lock ] && [ "$(cat node_modules/.sky-lock)" = "$lh" ]; then return 0; fi
  npm ci --no-audit --no-fund && echo "$lh" > node_modules/.sky-lock
}
WEB_DONE=0
web() { [ "$WEB_DONE" = 1 ] && return 0; echo "==> Веб-часть (vite build --mode native), один раз для всех приложений"; prep && npm run build:native && WEB_DONE=1; }

build_apk() {
  local old; if old="$(unchanged apk)"; then echo "==> Android: исходники не менялись — беру готовый $old"; ok=$((ok+1)); return; fi
  need java || { skipped+=("apk: нет JDK 17 (apt install openjdk-17-jdk)"); return; }
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || { skipped+=("apk: не задан ANDROID_HOME (Android SDK: platforms;android-34, build-tools)"); return; }
  [ -d android ] || { skipped+=("apk: нет каталога android/"); return; }
  echo "==> Android"; web || { skipped+=("apk: сборка веб-части не прошла"); return; }
  npx cap sync android && ( cd android && ./gradlew --no-daemon --build-cache --console=plain -Dorg.gradle.jvmargs=-Xmx1536m -Dorg.gradle.workers.max=2 assembleRelease ) || { skipped+=("apk: сборка не прошла (см. вывод выше)"); return; }
  f="$(ls -t android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)"
  [ -n "$f" ] || { skipped+=("apk: файл не найден после сборки"); return; }
  cp "$f" "$OUT/Sky-$VER-$STAMP.apk" && ok=$((ok+1)) && echo "   ✔ $OUT/Sky-$VER-$STAMP.apk" && stamp apk "$OUT/Sky-$VER-$STAMP.apk" && prune apk
  case "$f" in *unsigned*) echo "   ⚠ APK не подписан: подпишите (apksigner) своим ключом перед выдачей людям.";; esac
}
build_exe() {
  local old; if old="$(unchanged exe)"; then echo "==> Windows: исходники не менялись — беру готовый $old"; ok=$((ok+1)); return; fi
  if [ "$(uname -s)" = Linux ] && ! need wine; then skipped+=("exe: на Linux нужен wine (apt install wine64) — или собирайте через GitHub Actions (build-windows.yml)"); return; fi
  echo "==> Windows"; web || { skipped+=("exe: сборка веб-части не прошла"); return; }
  npx electron-builder --win nsis || { skipped+=("exe: сборка не прошла"); return; }
  f="$(ls -t release/*.exe dist-electron/*.exe 2>/dev/null | head -1)"
  [ -n "$f" ] || { skipped+=("exe: установщик не найден (проверьте build.directories.output в package.json)"); return; }
  cp "$f" "$OUT/Sky-$VER-$STAMP.exe" && ok=$((ok+1)) && echo "   ✔ $OUT/Sky-$VER-$STAMP.exe" && stamp exe "$OUT/Sky-$VER-$STAMP.exe" && prune exe
}
build_ipa() {
  [ "$(uname -s)" = Darwin ] && need xcodebuild || { skipped+=("ipa: нужен macOS с Xcode и сертификатом/профилем Apple — на Linux-сервере невозможно; используйте build-ios.yml (macOS-раннер) или свой Mac"); return; }
  echo "==> iOS"; skipped+=("ipa: на Mac запустите: npm run cap:sync:ios, затем архивируйте в Xcode (Product → Archive) и экспортируйте .ipa в $OUT")
}

case "${1:-all}" in
  apk) build_apk;; exe) build_exe;; ipa) build_ipa;;
  all) build_apk; build_exe; build_ipa;;
  *) sed -n 2,9p "$0"; exit 1;;
esac
sums
echo; echo "Собрано: $ok. Каталог: $OUT"
[ "${#skipped[@]}" -gt 0 ] && { echo "Пропущено:"; printf '  • %s\n' "${skipped[@]}"; }
[ "$ok" -gt 0 ] || exit 1
