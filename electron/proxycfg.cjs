/**
 * Настройка прокси Windows-приложения: проверка ввода и правило для Chromium (`session.setProxy`).
 * Чистые функции без Electron — проверяются обычным Node (scripts/audit/proxycfg-test.mjs).
 *
 * Что поддерживает сам Chromium: HTTP/HTTPS-прокси (логин и пароль — через событие `login`),
 * SOCKS4/SOCKS5 БЕЗ логина и пароля. VLESS/Trojan Chromium не умеет — для них нужен внешний клиент.
 */
const TYPES = new Set(['http', 'socks5', 'socks4']);
const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Возвращает { ok: true, cfg, rules } или { ok: false, error }. */
const normalize = (raw) => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = String(r.type ?? 'http');
  if (!TYPES.has(type)) return { ok: false, error: 'bad_type' };
  const host = String(r.host ?? '').trim();
  const isIp6 = /^[0-9a-fA-F:]+$/.test(host) && host.includes(':');
  if (!host || (!HOST_RE.test(host) && !isIp6)) return { ok: false, error: 'bad_host' };
  const port = Number(r.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'bad_port' };
  const username = String(r.username ?? '').slice(0, 200);
  const password = String(r.password ?? '').slice(0, 200);
  if (/[\r\n]/.test(username + password)) return { ok: false, error: 'bad_credentials' };
  // SOCKS-прокси с логином Chromium не поддерживает: лучше отказать, чем молча ходить без авторизации.
  if (type !== 'http' && (username || password)) return { ok: false, error: 'socks_auth_unsupported' };
  const at = isIp6 ? `[${host}]` : host;
  const rules = type === 'http' ? `http://${at}:${port}` : `${type}://${at}:${port}`;
  return { ok: true, cfg: { enabled: Boolean(r.enabled), type, host, port, username, password }, rules };
};

module.exports = { normalize, TYPES };
