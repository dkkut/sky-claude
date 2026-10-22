/// <reference types="vite/client" />

/**
 * Флаги, которые видит только нативная сборка (Android/Windows) — см.
 * .env.native и src/core/nativeApp.ts. В обычной веб-сборке они пусты,
 * поведение остаётся прежним.
 */
interface ImportMetaEnv {
  readonly VITE_NATIVE_APP?: string;
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_API_FALLBACKS?: string;
}
