#!/usr/bin/env node
// Превращает страницу списка Free-TV/IPTV (lists/russia.md) в плейлист M3U для scripts/tv-import.sh.
//   node scripts/freetv-to-m3u.mjs russia.md > russia.m3u
// Берёт разделы DVB-T2, Regional, Web, DVB-S; раздел Invalid пропускает. Оставляет только https-потоки HLS (.m3u8) с именем узла:
// DASH (.mpd), страницы ok.ru / vk.com / YouTube, голые IP и необычные порты отбрасываются (tv-import их всё равно не примет).
import { readFileSync } from 'node:fs';

const md = readFileSync(process.argv[2], 'utf8');
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
let section = '';
const out = ['#EXTM3U'];
const skip = { dash: 0, page: 0, ip: 0, port: 0, http: 0, invalid: 0 };
const seen = new Set();
for (const line of md.split('\n')) {
  const h = /^<h2>(.*?)<\/h2>/.exec(line);
  if (h) { section = h[1].trim(); continue; }
  if (!line.startsWith('|') || /^\|[:\- |]+\|$/.test(line)) continue;
  const cells = line.split('|').map((c) => c.trim());          // ['', '#', 'Канал', '[>](url)', 'logo', 'epg', '']
  if (cells.length < 6 || !/^\d+$/.test(cells[1])) continue;
  if (/^invalid$/i.test(section)) { skip.invalid++; continue; }
  const name = clean(cells[2], 80);
  const url = /\((https?:\/\/[^)\s]+)\)/.exec(cells[3])?.[1];
  if (!name || !url) continue;
  let u; try { u = new URL(url); } catch { continue; }
  if (u.protocol !== 'https:') { skip.http++; continue; }
  if (/\.mpd(\?|$)/i.test(u.pathname)) { skip.dash++; continue; }
  if (/(^|\.)(ok\.ru|vk\.com|youtube\.com|youtu\.be)$/.test(u.hostname) || !/\.m3u8/i.test(u.pathname + u.search)) { skip.page++; continue; }
  if (/^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':')) { skip.ip++; continue; }
  if (u.port) { skip.port++; continue; }
  if (seen.has(url)) continue; seen.add(url);
  const logo = /src="(https:\/\/[^"]+)"/.exec(cells[4])?.[1] ?? '';
  out.push(`#EXTINF:-1 tvg-id="${clean(cells[5], 80)}" tvg-logo="${clean(logo, 300)}" group-title="${clean(section, 40)}",${name}`, url);
}
console.error(`Каналов: ${(out.length - 1) / 2}. Пропущено: DASH ${skip.dash}, страницы/соцсети ${skip.page}, http ${skip.http}, IP ${skip.ip}, порты ${skip.port}, раздел Invalid ${skip.invalid}.`);
process.stdout.write(out.join('\n') + '\n');
