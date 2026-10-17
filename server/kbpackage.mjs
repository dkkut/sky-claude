/**
 * Пакет сайта каталога для собственного сервера бизнеса (tar.gz): те же файлы, что отдаёт Sky по /s/<адрес>,
 * с уже вписанными адресом Sky и адресом витрины. Секретов в пакете нет — только публичные настройки.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { query } from './db.mjs';
import { err, payOrigin } from './kbiz.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = [path.resolve(here, '../catalog-site'), path.resolve(here, '../public/shop')].find((d) => fs.existsSync(path.join(d, 'app.js')));

/** Минимальный ustar: имя ≤ 100 знаков, размер ≤ 8 ГБ — для нескольких небольших файлов этого достаточно. */
export const tarFiles = (files) => {
  const parts = [];
  for (const [name, buf] of files) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(buf.length.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, buf, Buffer.alloc((512 - (buf.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
};

const readme = (slug, api) => `Сайт каталога SkyKassa Business — установка на свой сервер
=====================================================

Что внутри: index.html, app.js, style.css, config.js — статические файлы без зависимостей и без сборки.
Заказы и оплата идут через Sky (${api}); на вашем сервере хранится только сам сайт.

1. Скопируйте файлы в папку сайта (например, /var/www/shop).
2. В кабинете SkyKassa Business → «Магазин» добавьте адрес вашего сайта (например, https://shop.example.ru)
   в список «Сайты, где показывается витрина». Без этого Sky не примет заказы с вашего сайта.
3. Откройте сайт по https. Пример для nginx:

   server {
       listen 443 ssl;
       server_name shop.example.ru;
       root /var/www/shop;
       index index.html;
       add_header X-Content-Type-Options nosniff always;
       add_header Referrer-Policy no-referrer always;
       location / { try_files $uri /index.html; }
   }

В config.js уже вписано: api = ${api}, адрес витрины = ${slug}. Менять нужно только если сменили адрес витрины в кабинете.
Каталог и цены берутся у Sky при каждом открытии — при изменении товаров пересобирать сайт не нужно.
Если подписка SkyKassa Business закончилась, витрина показывает «недоступно».
`;

export const shopPackage = async (profileId, apiOverride) => {
  const { rows } = await query('SELECT shop_slug FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (!rows[0]) return err('no_business');
  if (!rows[0].shop_slug) return err('shop_not_configured');
  if (!SRC) return err('package_unavailable');
  let api = payOrigin();
  if (apiOverride) { try { const u = new URL(apiOverride); if (u.protocol === 'https:' && !u.username) api = u.origin; } catch { /* оставляем адрес Sky */ } }
  const files = [];
  for (const f of ['index.html', 'app.js', 'style.css']) files.push([f, fs.readFileSync(path.join(SRC, f))]);
  files.push(['config.js', Buffer.from(`window.SKY_SHOP = { api: ${JSON.stringify(api)}, slug: ${JSON.stringify(rows[0].shop_slug)} };\n`)]);
  files.push(['README.txt', Buffer.from(readme(rows[0].shop_slug, api))]);
  return { data: zlib.gzipSync(tarFiles(files)) };
};
