import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android-обёртка Sky. dist/ — собранный НАТИВНЫМ режимом
 * (npm run build:native, см. .env.native) — вшивается прямо внутрь APK и
 * запускается с локального веб-сервера Capacitor на https://localhost, а
 * не с боевого домена: холодный старт мгновенный, офлайн-заглушки не
 * нужно. Абсолютный адрес API (VITE_API_ORIGIN) и явный токен вместо
 * HttpOnly-куки — см. src/core/nativeApp.ts и src/core/auth/api.ts.
 * Обновление интерфейса теперь требует новой сборки APK, а не только
 * веб-деплоя — см. DEPLOY.md.
 */
const config: CapacitorConfig = {
  appId: 'online.skymessenger.app',
  appName: 'Sky',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
