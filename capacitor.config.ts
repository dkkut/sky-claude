import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android/iOS-обёртка Sky. dist/ — собранный НАТИВНЫМ режимом
 * (npm run build:native, см. .env.native) — вшивается прямо внутрь
 * APK/IPA и запускается с локального веб-сервера Capacitor
 * (https://localhost на Android, capacitor://localhost на iOS), а не с
 * боевого домена: холодный старт мгновенный, офлайн-заглушки не нужно.
 * Абсолютный адрес API (VITE_API_ORIGIN) и явный токен вместо
 * HttpOnly-куки — см. src/core/nativeApp.ts и src/core/auth/api.ts.
 * Оба origin должны быть в EXTRA_ORIGINS на сервере — см. .env.example.
 * Обновление интерфейса теперь требует новой сборки приложения, а не
 * только веб-деплоя — см. DEPLOY.md.
 */
const config: CapacitorConfig = {
  appId: 'online.skymessenger.app',
  appName: 'Sky',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
