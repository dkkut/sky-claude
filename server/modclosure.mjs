/**
 * Закрытие любого модуля из админки. Закрытый модуль у людей заменяется баннером «Сервис временно недоступен…»;
 * причина обязательна, пишется в журнал и видна администрации, людям — только если отмечено «показывать причину».
 * Это закрытие интерфейса (клиент читает список из публичного /api/platform/status); API модулей оно не блокирует —
 * для полной остановки есть режимы «Технические/Аварийные работы».
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

/** Ключи: верхний уровень (разделы оболочки) и вкладки Sky (Extras). Список ведёт сервер, подписи — для админки. */
export const MODULES = [
  { key: 'messages', label: 'Чаты', group: 'Разделы' },
  { key: 'stories', label: 'Истории', group: 'Разделы' },
  { key: 'bloom', label: 'Bloom', group: 'Разделы' },
  { key: 'notifications', label: 'События', group: 'Разделы' },
  { key: 'gaming', label: 'Игры', group: 'Разделы' },
  { key: 'extras', label: 'Sky (все сервисы целиком)', group: 'Разделы' },
  { key: 'video', label: 'Sky Video', group: 'Разделы' },
  { key: 'library', label: 'Библиотека', group: 'Разделы' },
  { key: 'studio', label: 'Studio', group: 'Разделы' },
  { key: 'profile', label: 'Профиль', group: 'Разделы' },
  { key: 'music', label: 'Музыка', group: 'Сервисы Sky' },
  { key: 'movies', label: 'Кино', group: 'Сервисы Sky' },
  { key: 'tv', label: 'ТВ', group: 'Сервисы Sky' },
  { key: 'podcasts', label: 'Подкасты', group: 'Сервисы Sky' },
  { key: 'books', label: 'Книги', group: 'Сервисы Sky' },
  { key: 'tickets', label: 'Билеты', group: 'Сервисы Sky' },
  { key: 'ai', label: 'Sky AI', group: 'Сервисы Sky' },
  { key: 'bots', label: 'Боты', group: 'Сервисы Sky' },
  { key: 'mybots', label: 'Мои боты', group: 'Сервисы Sky' },
  { key: 'prime', label: 'Prime', group: 'Сервисы Sky' },
  { key: 'rooms', label: 'Вместе', group: 'Сервисы Sky' },
  { key: 'go', label: 'Sky GO', group: 'Сервисы Sky' },
  { key: 'market', label: 'Market', group: 'Сервисы Sky' },
  { key: 'pvz', label: 'Sky ПВЗ', group: 'Сервисы Sky' },
  { key: 'blox', label: 'Sky Blox', group: 'Сервисы Sky' },
  { key: 'nftgifts', label: 'Sky Gifts', group: 'Сервисы Sky' },
  { key: 'work', label: 'Работа', group: 'Сервисы Sky' },
  { key: 'family', label: 'Sky Family', group: 'Сервисы Sky' },
  { key: 'pulse', label: 'Pulse', group: 'Сервисы Sky' },
  { key: 'garant', label: 'Гарант', group: 'Сервисы Sky' },
  { key: 'ads', label: 'Реклама', group: 'Сервисы Sky' },
  { key: 'campaigns', label: 'Мероприятия', group: 'Сервисы Sky' },
  { key: 'musicians', label: 'Музыканты', group: 'Сервисы Sky' },
  { key: 'cloudgaming', label: 'Sky Gaming Cloud', group: 'Сервисы Sky' },
  { key: 'cloud', label: 'Sky Cloud', group: 'Сервисы Sky' },
];
const KEYS = new Set(MODULES.map((m) => m.key));
const allowed = (me) => can(me, 'modules');
const log = (me, type, detail, meta) => logAdmin({ actorId: me, targetType: 'system', type, detail: String(detail).slice(0, 200), meta });

/** Публичная часть: {ключ: {reason?}} — причина только если её разрешено показывать. */
export const closedPublic = async () => {
  const { rows } = await query('SELECT module, reason, show_reason FROM closed_modules');
  return Object.fromEntries(rows.map((r) => [r.module, r.show_reason ? { reason: r.reason } : {}]));
};

export const adminList = async (me) => {
  if (!(await allowed(me))) return null;
  const { rows } = await query('SELECT module, reason, show_reason, closed_by, closed_at FROM closed_modules');
  const by = new Map(rows.map((r) => [r.module, r]));
  return MODULES.map((m) => {
    const r = by.get(m.key);
    return { ...m, closed: !!r, reason: r?.reason ?? '', showReason: !!r?.show_reason, closedAt: r?.closed_at?.toISOString?.() ?? null };
  });
};

export const adminSet = async (me, key, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (!KEYS.has(key)) return { error: 'unknown_module' };
  if (b?.closed === true) {
    const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (reason.length < 3) return { error: 'reason_required' };
    await query(`INSERT INTO closed_modules (module, reason, show_reason, closed_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (module) DO UPDATE SET reason=$2, show_reason=$3, closed_by=$4, closed_at=now()`, [key, reason, b.showReason === true, me]);
    await log(me, 'module_closed', `${key}: ${reason}`, meta);
  } else {
    await query('DELETE FROM closed_modules WHERE module = $1', [key]);
    await log(me, 'module_opened', key, meta);
  }
  return { ok: true };
};
