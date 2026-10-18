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
ok=0; skipped=()
need() { command -v "$1" >/dev/null 2>&1; }
prep() { [ -d node_modules ] || npm ci --no-audit --no-fund || return 1; }
sums() { ( cd "$OUT" && sha256sum -- *.apk *.exe *.ipa 2>/dev/null > SHA256SUMS ); }

build_apk() {
  need java || { skipped+=("apk: нет JDK 17 (apt install openjdk-17-jdk)"); return; }
  [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || { skipped+=("apk: не задан ANDROID_HOME (Android SDK: platforms;android-34, build-tools)"); return; }
  [ -d android ] || { skipped+=("apk: нет каталога android/"); return; }
  echo "==> Android"; prep || { skipped+=("apk: npm ci не прошёл"); return; }
  npm run cap:sync && ( cd android && ./gradlew --no-daemon assembleRelease ) || { skipped+=("apk: сборка не прошла (см. вывод выше)"); return; }
  f="$(ls -t android/app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)"
  [ -n "$f" ] || { skipped+=("apk: файл не найден после сборки"); return; }
  cp "$f" "$OUT/Sky-$VER-$STAMP.apk" && ok=$((ok+1)) && echo "   ✔ $OUT/Sky-$VER-$STAMP.apk"
  case "$f" in *unsigned*) echo "   ⚠ APK не подписан: подпишите (apksigner) своим ключом перед выдачей людям.";; esac
}
build_exe() {
  if [ "$(uname -s)" = Linux ] && ! need wine; then skipped+=("exe: на Linux нужен wine (apt install wine64) — или собирайте через GitHub Actions (build-windows.yml)"); return; fi
  echo "==> Windows"; prep || { skipped+=("exe: npm ci не прошёл"); return; }
  npm run build:native && npx electron-builder --win nsis || { skipped+=("exe: сборка не прошла"); return; }
  f="$(ls -t release/*.exe dist-electron/*.exe 2>/dev/null | head -1)"
  [ -n "$f" ] || { skipped+=("exe: установщик не найден (проверьте build.directories.output в package.json)"); return; }
  cp "$f" "$OUT/Sky-$VER-$STAMP.exe" && ok=$((ok+1)) && echo "   ✔ $OUT/Sky-$VER-$STAMP.exe"
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
