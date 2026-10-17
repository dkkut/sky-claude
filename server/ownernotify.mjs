/**
 * Уведомления владельца. Две версии (настраивает сам владелец, Профиль → Настройки):
 *   «Заявки на подтверждение» (по умолчанию) — только то, что ждёт его решения;
 *   «Все действия» — ещё и каждое действие администрации из журнала (собственные действия владельца — по его галочке; от каждого администратора можно отключить; сами заявки — отдельно).
 * Куда: раздел «Уведомления» и/или push (приходит, когда приложение закрыто). Журнал администрации остаётся полным при любых настройках.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';
import { generateId, rateLimit } from './security.mjs';
import { pushGiftNotification } from './signal.mjs';

export const MODES = ['requests', 'all'];
const DEFAULTS = { mode: 'requests', inApp: true, push: true, includeOwn: false, mutedAdmins: [] };
/** «Все действия» могут быть частыми — свой предел, иначе владельца засыплет; журнал всё равно полный. */
const ACTIONS_PER_MIN = 20;

const ownerIds = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return [];
  const { rows } = await query('SELECT id FROM profiles WHERE lower(username) = $1', [name]);
  return rows.map((r) => r.id);
};

export const getPrefs = async (profileId) => {
  const { rows } = await query('SELECT mode, in_app, push, include_own, muted_admins FROM owner_notify_prefs WHERE profile_id = $1', [profileId]);
  return rows[0] ? { mode: rows[0].mode, inApp: rows[0].in_app, push: rows[0].push, includeOwn: rows[0].include_own, mutedAdmins: rows[0].muted_admins ?? [] } : { ...DEFAULTS };
};

export const setPrefs = async (profileId, b) => {
  const mode = MODES.includes(b?.mode) ? b.mode : null;
  if (!mode) return { error: 'bad_mode' };
  const inApp = b?.inApp !== false; const push = b?.push !== false;
  if (!inApp && !push) return { error: 'no_channel' };
  const includeOwn = b?.includeOwn === true;
  const mutedAdmins = Array.isArray(b?.mutedAdmins) ? [...new Set(b.mutedAdmins.map(String))].slice(0, 200) : [];
  await query(`INSERT INTO owner_notify_prefs (profile_id, mode, in_app, push, include_own, muted_admins) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT (profile_id) DO UPDATE SET mode = $2, in_app = $3, push = $4, include_own = $5, muted_admins = $6::jsonb, updated_at = now()`, [profileId, mode, inApp, push, includeOwn, JSON.stringify(mutedAdmins)]);
  return { ok: true, mode, inApp, push, includeOwn, mutedAdmins };
};

const deliver = async (ownerId, prefs, kind, title, body, refId) => {
  const note = { id: `gnf-${generateId()}`, userId: ownerId, kind, title, body, refId, read: false, createdAt: new Date().toISOString() };
  if (prefs.inApp) {
    await query('INSERT INTO gift_notifications (id, user_id, kind, title, body, ref_id) VALUES ($1,$2,$3,$4,$5,$6)', [note.id, ownerId, kind, title, body, refId]);
  }
  // Сокет (раздел «Уведомления» вживую) и push — каждый по своему переключателю.
  pushGiftNotification([ownerId], note, { inApp: prefs.inApp, push: prefs.push });
};

/** Заявка ждёт решения — приходит при любом режиме (каналы — по настройке). */
export const notifyOwnerRequest = async (actorId, title, refId) => {
  for (const id of await ownerIds()) {
    if (id === actorId) continue;
    await deliver(id, await getPrefs(id), 'admin_pending', 'Новая заявка на подтверждение', title, refId).catch(() => {});
  }
};

/** Действие администрации — только в режиме «Все действия». Исключения и пределы — см. шапку. */
/** Администраторы для переключателей «от кого присылать». */
export const listAdminsForNotify = async () => {
  const { rows } = await query(`SELECT id, username FROM profiles WHERE is_admin = true ORDER BY username LIMIT 200`);
  return rows.map((r) => ({ id: r.id, username: r.username }));
};

export const notifyOwnerAction = async ({ actorId, type, result, detail, id }) => {
  try {
    if (!actorId || String(type).endsWith('_request')) return;
    const owners = await ownerIds();
    if (!owners.length) return;
    const actorIsOwner = owners.includes(actorId);
    for (const o of owners) {
      const prefs = await getPrefs(o);
      if (prefs.mode !== 'all') continue;
      // Свои действия владельца — только если он это включил; остальных администраторов можно отключать по одному.
      if (actorIsOwner ? !(prefs.includeOwn && actorId === o) : prefs.mutedAdmins.includes(actorId)) continue;
      if (!rateLimit(`ownernote:${o}`, ACTIONS_PER_MIN)) continue;
      const { rows: who } = await query('SELECT username FROM profiles WHERE id = $1', [actorId]);
      const name = who[0]?.username ? `@${who[0].username}` : 'Администратор';
      const body = `${name}: ${String(type).replace(/_/g, ' ')}${detail ? ` — ${String(detail).slice(0, 120)}` : ''}${result && result !== 'ok' ? ` (${result})` : ''}`;
      await deliver(o, prefs, 'admin_action', 'Действие администрации', body, id ?? null);
    }
  } catch { /* уведомление не должно мешать действию */ }
};
