/**
 * Журнал действий по HTTP: каждый изменяющий запрос к API (POST/PUT/PATCH/DELETE) — одна запись «кто, куда, чем кончилось».
 * Содержимого запросов нет (ни тел, ни параметров): идентификаторы в пути заменяются на :id, секреты в журнал не попадают.
 *  • путь /api/admin/… → категория `admin` (аудиторская, с цепочкой хешей);
 *  • остальное → `user` (действия людей по всей экосистеме).
 * Чтение (GET) не пишется: оно не меняет ничего и забило бы журнал; исключены также частые служебные запросы (пульсы, позиция трека, печатает…).
 */
import { logEvent } from './skylog.mjs';
import { clientIp } from './http.mjs';

const SKIP = /^\/api\/(telemetry|platform\/status|auth\/refresh|admin\/logs)|\/(pulse|heartbeat|position|presence|typing|progress|ping|seen|read)(\/|$)/;
const ID = /^(?:[0-9a-f]{8,}(?:-[0-9a-f]{4,})*|[a-z]{1,6}-[0-9a-z-]{8,}|\d{3,}|[0-9A-Za-z_-]{22,})$/i;

export const normalizeRoute = (path) => String(path ?? '').split('?')[0].split('/').map((seg) => (ID.test(seg) ? ':id' : seg)).join('/').slice(0, 120);

export const auditRequest = (req, status, ms, ctx) => {
  try {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
    const path = String(req.url ?? '').split('?')[0];
    if (!path.startsWith('/api/') || SKIP.test(path)) return;
    const route = normalizeRoute(path);
    const isAdmin = route.startsWith('/api/admin');
    const parts = route.split('/');
    const service = (isAdmin ? parts[3] : parts[2]) || 'api';
    const result = status >= 500 ? 'error' : status >= 400 ? 'denied' : 'ok';
    logEvent({
      category: isAdmin ? 'admin' : 'user', type: isAdmin ? 'http.admin' : 'http.action', service: String(service).slice(0, 40), actorId: ctx?.actor ?? null,
      targetId: `${req.method} ${route}`, result, level: status >= 500 ? 'ERROR' : 'INFO', reason: status >= 400 ? `HTTP ${status}` : '',
      ip: clientIp(req), ua: req.headers['user-agent'], detail: { status, ms },
    });
  } catch { /* журнал не должен мешать ответу */ }
};
