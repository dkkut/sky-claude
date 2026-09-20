import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android-обёртка Sky. Мы не переносим собранный dist/ внутрь APK —
 * приложение открывает тот же боевой адрес, что и веб (server.url),
 * поэтому все относительные вызовы (/api/..., /ws) в src/core/auth/api.ts
 * и в мессенджере работают без изменений, куки refresh-токена ведут себя
 * как в обычном браузере, а обновление сайта не требует новой сборки APK.
 *
 * webDir всё равно обязателен для Capacitor (нужен как офлайн-заглушка
 * на случай, если server.url недоступен) — используем собранный dist/.
 */
const config: CapacitorConfig = {
  appId: 'online.skymessenger.app',
  appName: 'Sky',
  webDir: 'dist',
  server: {
    url: 'https://web.skymessenger.online',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
