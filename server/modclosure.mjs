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
  { key: 'partners', label: 'Партнёры', group: 'Сервисы Sky' },
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
  { key: 'kbiz', label: 'Sky для бизнеса (SkyKassa Business)', group: 'Сервисы Sky' },
];
const KEYS = new Set(MODULES.map((m) => m.key));
const allowed = (me) => can(me, 'modules');
const log = (me, type, detail, meta) => logAdmin({ actorId: me, targetType: 'system', type, detail: String(detail).slice(0, 200), meta });

/** Закрыт ли модуль (для серверных проверок). Ответ держится 3 с; сбрасывается при любом изменении. */
let _cache = { at: 0, set: new Set() };
const forget = () => { _cache = { at: 0, set: new Set() }; };
export const isClosed = async (key) => {
  if (Date.now() - _cache.at > 3000) {
    try { _cache = { at: Date.now(), set: new Set((await query('SELECT module FROM closed_modules')).rows.map((r) => r.module)) }; }
    catch { return false; }   // сбой базы не должен закрывать сервис
  }
  return _cache.set.has(key);
};

/** Баннер «Sky работает с перебоями» в Sky Media: состояние в platform_flags, включает/выключает право `modules`. Текст зашит на клиенте. */
export const mediaBannerOn = async () => {
  try { return !!(await query(`SELECT on_flag FROM platform_flags WHERE key = 'media_banner'`)).rows[0]?.on_flag; } catch { return false; }
};
export const adminSetBanner = async (me, on, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (typeof on !== 'boolean') return { error: 'bad_value' };
  await query(`INSERT INTO platform_flags (key, on_flag, updated_by) VALUES ('media_banner', $1, $2)
    ON CONFLICT (key) DO UPDATE SET on_flag = $1, updated_by = $2, updated_at = now()`, [on, me]);
  await log(me, on ? 'media_banner_on' : 'media_banner_off', 'Sky Media', meta);
  return { ok: true, on };
};

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
    forget();
    await log(me, 'module_closed', `${key}: ${reason}`, meta);
  } else {
    await query('DELETE FROM closed_modules WHERE module = $1', [key]);
    forget();
    await log(me, 'module_opened', key, meta);
  }
  return { ok: true };
};

/**
 * «Закрыть/открыть все модули» одним действием. Закрываются все ключи списка (включая «Профиль»: у людей закрытый профиль
 * показывает только «Выйти из Sky ID»). Причина обязательна и общая; уже закрытые со своей причиной сохраняют её.
 */
export const adminSetAll = async (me, b, meta) => {
  if (!(await allowed(me))) return { error: 'not_allowed' };
  if (b?.closed === true) {
    const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (reason.length < 3) return { error: 'reason_required' };
    for (const m of MODULES) {
      await query(`INSERT INTO closed_modules (module, reason, show_reason, closed_by) VALUES ($1,$2,$3,$4) ON CONFLICT (module) DO NOTHING`, [m.key, reason, b.showReason === true, me]);
    }
    forget();
    await log(me, 'modules_closed_all', reason, meta);
  } else {
    await query('DELETE FROM closed_modules');
    forget();
    await log(me, 'modules_opened_all', 'все модули', meta);
  }
  return { ok: true };
};
