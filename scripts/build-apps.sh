#!/usr/bin/env bash
# Сборка приложений Sky на сервере и складывание в каталог хранилища (по умолчанию /opt/sky/apps).
#   bash scripts/build-apps.sh apk          # Android (.apk): нужен JDK 21 и Android SDK (ANDROID_HOME)
#   bash scripts/build-apps.sh exe          # Windows (.exe, NSIS): на Linux нужен wine (apt install wine64); надёжнее — GitHub Actions
#   bash scripts/build-apps.sh ipa          # iOS (.ipa): ТОЛЬКО на macOS с Xcode и подписью Apple; на Linux-сервере невозможно
#   bash scripts/build-apps.sh all          # всё, что возможно на этой машине; остальное пропускается с пояснением
#   OUT=/путь bash scripts/build-apps.sh apk   # другой каталог
# Результат: $OUT/<имя>-<версия>-<дата>.<ext> + SHA256SUMS. Файлы потом можно загрузить в админке «Сайт» → «Скачивание».
#   Подпись APK: SKY_KEYSTORE=/путь/sky-release.jks [SKY_KEY_ALIAS=sky]; пароль спрашивается при каждом запуске (виден при вводе; SKY_PASS_HIDE=1 скрывает; SKY_PASS_ASK=0 — не спрашивать, тогда SKY_KEYSTORE_PASS_FILE или SKY_KEYSTORE_PASS)
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
# Сборка запускается в собственной группе systemd с потолком памяти и процессора: при нехватке убивается ТОЛЬКО сборка,
# а не сайт (BUILD_MEM_MAX, по умолчанию 55 % памяти; BUILD_CPU, по умолчанию 150 % = 1,5 ядра). Без systemd-run — прежний nice/ionice.
if [ -z "${SKY_BUILD_NICE:-}" ]; then
  export SKY_BUILD_NICE=1 NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
  if command -v systemd-run >/dev/null 2>&1 && [ "$(id -u)" = 0 ]; then
    exec systemd-run --scope --quiet -p "MemoryMax=${BUILD_MEM_MAX:-55%}" -p "CPUQuota=${BUILD_CPU:-150%}" nice -n 19 ionice -c3 bash "$0" "$@"
  fi
  if command -v ionice >/dev/null 2>&1; then exec nice -n 19 ionice -c3 bash "$0" "$@"; fi
  exec nice -n 19 bash "$0" "$@"
fi
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

# Подпись APK: SKY_KEYSTORE=/путь/к.jks, пароль — SKY_KEYSTORE_PASS_FILE (файл, chmod 600) или SKY_KEYSTORE_PASS (в окружении),
# алиас — SKY_KEY_ALIAS (sky). Пароль не попадает в аргументы команд (не виден в ps и в истории): apksigner читает его из файла/окружения.
# Без ключа APK остаётся неподписанным — об этом сказано, сборка не падает.
sign_apk() { # $1 = неподписанный apk, $2 = куда положить результат; 0 — файл положен (подписанный или нет)
  local src="$1" dst="$2" ks="${SKY_KEYSTORE:-}" al="${SKY_KEY_ALIAS:-sky}" bt aligned
  [ -n "$ks" ] || { [ -f "$HOME/sky-release.jks" ] && ks="$HOME/sky-release.jks"; }
  if [ -z "$ks" ] || [ ! -f "$ks" ]; then
    cp "$src" "$dst"; echo "   ⚠ APK не подписан: задайте SKY_KEYSTORE=/путь/к.jks и SKY_KEYSTORE_PASS_FILE=/путь/к/паролю (или SKY_KEYSTORE_PASS)"; return 0
  fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  bt="$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)"
  [ -n "$bt" ] && [ -x "$bt/apksigner" ] && [ -x "$bt/zipalign" ] || { skipped+=("apk: нет apksigner/zipalign в $sdk/build-tools — выполните: sudo bash scripts/setup-build-tools.sh --android"); return 1; }
  local passarg
  if [ -n "${SKY_KEYSTORE_PASS:-}" ]; then passarg="env:SKY_KEYSTORE_PASS"
  elif [ -n "${SKY_KEYSTORE_PASS_FILE:-}" ] && [ -f "$SKY_KEYSTORE_PASS_FILE" ]; then passarg="file:$SKY_KEYSTORE_PASS_FILE"
  else skipped+=("apk: ключ $ks найден, но пароль не введён (скрипт запущен без терминала)"); return 1; fi
  aligned="$(mktemp --suffix=.apk)"; rm -f "$aligned"
  "$bt/zipalign" -f -p 4 "$src" "$aligned" || { skipped+=("apk: zipalign не прошёл"); return 1; }
  "$bt/apksigner" sign --ks "$ks" --ks-key-alias "$al" --ks-pass "$passarg" --out "$dst" "$aligned" \
    || { rm -f "$aligned" "$dst"; skipped+=("apk: подпись не прошла (неверный пароль или алиас $al?)"); return 1; }
  rm -f "$aligned" "$dst.idsig"
  "$bt/apksigner" verify --print-certs "$dst" | grep -E "SHA-256 digest" | head -1 | sed 's/^/   ✔ подписан, /'
}
# Пароль ключа спрашивается при КАЖДОМ запуске (до долгой сборки), вводимое видно на экране.
# SKY_PASS_HIDE=1 — скрыть ввод; SKY_PASS_ASK=0 — не спрашивать (берётся SKY_KEYSTORE_PASS / SKY_KEYSTORE_PASS_FILE).
ask_keystore_pass() {
  local ks="${SKY_KEYSTORE:-}" p
  [ "${SKY_PASS_ASK:-1}" = 0 ] && return 0
  [ -n "$ks" ] || { [ -f "$HOME/sky-release.jks" ] && ks="$HOME/sky-release.jks"; }
  [ -n "$ks" ] && [ -f "$ks" ] || return 0
  if [ ! -r /dev/tty ]; then return 0; fi
  echo "==> Подпись APK: ключ $ks (алиас ${SKY_KEY_ALIAS:-sky})"
  if [ "${SKY_PASS_HIDE:-0}" = 1 ]; then read -r -s -p "   Пароль ключа: " p </dev/tty >/dev/tty; echo >/dev/tty
  else read -r -p "   Пароль ключа (виден при вводе): " p </dev/tty >/dev/tty; fi
  [ -n "$p" ] || { echo "   (пусто — подпись не пройдёт, APK будет пропущен)"; unset SKY_KEYSTORE_PASS SKY_KEYSTORE_PASS_FILE; return 0; }
  export SKY_KEYSTORE_PASS="$p"; echo "   Введён пароль: $p"
}
build_apk() {
  local old; if old="$(unchanged apk)"; then echo "==> Android: исходники не менялись — беру готовый $old"; ok=$((ok+1)); return; fi
  ask_keystore_pass
  J21="$(ls -d /usr/lib/jvm/java-21-openjdk-* 2>/dev/null | head -1)"; [ -n "$J21" ] && export JAVA_HOME="$J21" PATH="$J21/bin:$PATH"   # Capacitor 8 собирается только JDK 21 («invalid source release: 21» на 17)
  need java || { skipped+=("apk: нет JDK 21 — выполните: sudo bash scripts/setup-build-tools.sh --android"); return; }
  local nv; nv="$(node -v 2>/dev/null | sed 's/^v//;s/\..*//')"
  [ "${nv:-0}" -ge 22 ] 2>/dev/null || { skipped+=("apk: Node ${nv:-?}, а Capacitor CLI 8 требует 22+ — выполните: sudo bash scripts/setup-build-tools.sh --android"); return; }
  local jv; jv="$(java -version 2>&1 | sed -n '1s/.*"\([0-9]*\)[."].*/\1/p')"
  [ "${jv:-0}" -ge 21 ] 2>/dev/null || { skipped+=("apk: найден JDK ${jv:-?}, нужен 21+ (Capacitor 8: «invalid source release: 21») — выполните: sudo bash scripts/setup-build-tools.sh --android"); return; }
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || { [ -d /opt/android-sdk ] && export ANDROID_HOME=/opt/android-sdk ANDROID_SDK_ROOT=/opt/android-sdk; }
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || { skipped+=("apk: не задан ANDROID_HOME — выполните: sudo bash scripts/setup-build-tools.sh --android"); return; }
  [ -d android ] || { skipped+=("apk: нет каталога android/"); return; }
  echo "==> Android"; web || { skipped+=("apk: сборка веб-части не прошла"); return; }
  npx cap sync android && ( cd android && ./gradlew --no-daemon --build-cache --console=plain -Dorg.gradle.jvmargs=-Xmx1536m -Dorg.gradle.workers.max=2 assembleRelease ) || { skipped+=("apk: сборка не прошла (см. вывод выше)"); return; }
  f="$(ls -t android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)"
  [ -n "$f" ] || { skipped+=("apk: файл не найден после сборки"); return; }
  local dst="$OUT/Sky-$VER-$STAMP.apk"
  case "$f" in
    *unsigned*) sign_apk "$f" "$dst" || return;;
    *) cp "$f" "$dst";;   # Gradle уже подписал (если в проекте настроен signingConfig)
  esac
  ok=$((ok+1)); echo "   ✔ $dst"; stamp apk "$dst"; prune apk
}
build_exe() {
  local old; if old="$(unchanged exe)"; then echo "==> Windows: исходники не менялись — беру готовый $old"; ok=$((ok+1)); return; fi
  if [ "$(uname -s)" = Linux ] && ! need wine; then skipped+=("exe: на Linux нужен wine — выполните: sudo bash scripts/setup-build-tools.sh --wine (или GitHub Actions, build-windows.yml)"); return; fi
  if [ "$(uname -s)" = Linux ]; then
    command -v xvfb-run >/dev/null 2>&1 || { skipped+=("exe: нет xvfb-run (wine без экрана: «no driver could be loaded») — выполните: sudo bash scripts/setup-build-tools.sh --wine"); return; }
    dpkg -l wine32:i386 2>/dev/null | grep -q '^ii' || { skipped+=("exe: нет 32-битного wine («failed to load syswow64\\ntdll.dll») — выполните: sudo bash scripts/setup-build-tools.sh --wine"); return; }
  fi
  echo "==> Windows"; web || { skipped+=("exe: сборка веб-части не прошла"); return; }
  WINEDEBUG=-all ${XVFB:-$(command -v xvfb-run >/dev/null 2>&1 && echo 'xvfb-run -a')} npx electron-builder --win nsis || { skipped+=("exe: сборка не прошла"); return; }
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
