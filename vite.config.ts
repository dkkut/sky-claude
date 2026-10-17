import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Страницы для ссылок из писем — отдельный HTML (verify.html), а не приложение (см. комментарий в verify.html). */
const VERIFY_PATHS = new Set(['/admin-verify', '/ssh-verify', '/ssh-confirm', '/2fa-reset', '/unfreeze', '/storage-verify']);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sky-verify-pages',
      // В dev-сервере и preview те же адреса отдают verify.html — как nginx на боевом сайте.
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const p = (req.url ?? '').split('?')[0];
          if (VERIFY_PATHS.has(p)) req.url = '/verify.html' + (req.url ?? '').slice(p.length);
          // Для проверки сайта восстановления без отдельного домена: /recovery-site/… отдаёт recovery.html (на боевом сервере его отдаёт nginx домена recovery.*).
          else if (p === '/recovery-site' || p.startsWith('/recovery-site/')) req.url = '/recovery.html';
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          const p = (req.url ?? '').split('?')[0];
          if (VERIFY_PATHS.has(p)) req.url = '/verify.html' + (req.url ?? '').slice(p.length);
          // Для проверки сайта восстановления без отдельного домена: /recovery-site/… отдаёт recovery.html (на боевом сервере его отдаёт nginx домена recovery.*).
          else if (p === '/recovery-site' || p.startsWith('/recovery-site/')) req.url = '/recovery.html';
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        verify: path.resolve(__dirname, 'verify.html'),
        recovery: path.resolve(__dirname, 'recovery.html'),
      },
    },
  },
});
