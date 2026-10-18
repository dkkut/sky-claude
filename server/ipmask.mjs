/**
 * Адреса в журналах безопасности: полный IP в базе не хранится.
 *   ipMask(ip) — укрупнённый адрес для показа и разбора инцидентов: IPv4 → a.b.c.0/24, IPv6 → первые 48 бит (…::/48);
 *   ipFp(ip)   — отпечаток HMAC полного адреса: позволяет увидеть «тот же адрес» без возможности восстановить его по дампу.
 * Не-адреса (имя узла из PAM и т. п.) возвращаются как есть, обрезанные.
 * Полный адрес остаётся только в самом запросе и в письме владельцу аккаунта (в базу не пишется).
 */
import net from 'node:net';
import { macOf } from './crypto.mjs';

export const isMasked = (s) => /\/(24|48)$/.test(String(s ?? ''));

export const ipMask = (ip, max = 60) => {
  let s = String(ip ?? '').trim();
  if (!s) return '';
  if (s.startsWith('::ffff:') && net.isIPv4(s.slice(7))) s = s.slice(7);
  if (isMasked(s)) return s.slice(0, max);
  if (net.isIPv4(s)) return `${s.split('.').slice(0, 3).join('.')}.0/24`;
  if (net.isIPv6(s)) {
    // раскрываем «::» и берём первые три группы (48 бит)
    const [head, tail = ''] = s.split('::');
    const h = head ? head.split(':') : []; const t = tail ? tail.split(':') : [];
    const groups = s.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
    return `${groups.slice(0, 3).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/48`;
  }
  return s.slice(0, max);
};

export const ipFp = (ip) => {
  const s = String(ip ?? '').trim();
  return s && !isMasked(s) ? macOf('ip', s.startsWith('::ffff:') ? s.slice(7) : s).slice(0, 24) : '';
};
