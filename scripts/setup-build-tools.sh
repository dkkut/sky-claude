#!/usr/bin/env bash
# Инструменты для сборки приложений на этом сервере (Debian/Ubuntu, root):
#   bash scripts/setup-build-tools.sh            # JDK 17 + Android SDK + wine (+32-бит) + xvfb
#   bash scripts/setup-build-tools.sh --check    # только показать, чего не хватает
#   bash scripts/setup-build-tools.sh --android  # только Android;  --wine — только wine
# После установки build-apps.sh сам найдёт SDK в /opt/android-sdk. Идемпотентно: повторный запуск ничего не ломает.
set -euo pipefail
SDK="${ANDROID_HOME:-/opt/android-sdk}"
CMD_ZIP_URL="${CMD_ZIP_URL:-https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip}"
MODE="${1:-all}"
have() { command -v "$1" >/dev/null 2>&1; }

check() {
  echo "java:        $(have java && java -version 2>&1 | head -1 || echo НЕТ)"
  echo "ANDROID_SDK: $([ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ] && echo "$SDK" || echo НЕТ)"
  echo "platform-34: $([ -d "$SDK/platforms/android-34" ] && echo есть || echo НЕТ)"
  echo "build-tools: $(ls "$SDK/build-tools" 2>/dev/null | tr '\n' ' ' || true)"
  echo "wine:        $(have wine && wine --version 2>/dev/null || echo НЕТ)"
  echo "wine 32-бит: $(dpkg -l wine32:i386 2>/dev/null | grep -q '^ii' && echo есть || echo НЕТ)"
  echo "xvfb-run:    $(have xvfb-run && echo есть || echo НЕТ)"
}
[ "$MODE" = "--check" ] && { check; exit 0; }
[ "$(id -u)" = 0 ] || { echo "Нужен root (apt install)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

install_android() {
  apt-get update -qq
  apt-get install -y -qq openjdk-17-jdk-headless unzip curl ca-certificates
  if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
    mkdir -p "$SDK/cmdline-tools"; tmp="$(mktemp -d)"
    curl -fsSL "$CMD_ZIP_URL" -o "$tmp/cmd.zip"
    unzip -q "$tmp/cmd.zip" -d "$tmp"
    rm -rf "$SDK/cmdline-tools/latest"; mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"; rm -rf "$tmp"
  fi
  export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")}"
  yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null || true
  "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platform-tools" "platforms;android-34" "build-tools;34.0.0"
  grep -q '^ANDROID_HOME=' /etc/environment 2>/dev/null || { echo "ANDROID_HOME=$SDK" >> /etc/environment; echo "ANDROID_SDK_ROOT=$SDK" >> /etc/environment; }
  echo "✔ Android SDK: $SDK"
}

install_wine() {
  dpkg --add-architecture i386
  apt-get update -qq
  apt-get install -y -qq wine wine64 wine32:i386 libwine:i386 xvfb xauth
  # Сломанный префикс (без 32-бит) мешал: «failed to load syswow64\ntdll.dll c0000135» — пересоздаём
  if [ -d "$HOME/.wine" ] && [ ! -e "$HOME/.wine/drive_c/windows/syswow64/ntdll.dll" ]; then rm -rf "$HOME/.wine"; fi
  WINEDEBUG=-all xvfb-run -a wineboot --init >/dev/null 2>&1 || true
  echo "✔ wine: $(wine --version 2>/dev/null || echo 'не запустился — смотрите вывод apt')"
}

case "$MODE" in
  --android) install_android;;
  --wine) install_wine;;
  all) install_android; install_wine;;
  *) sed -n 2,6p "$0"; exit 1;;
esac
check
