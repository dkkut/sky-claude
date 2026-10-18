/**
 * Роялти экосистемы: ТОЛЬКО переключатели. Начислений, расчётов и выплат в Sky нет — этот модуль решает лишь,
 * считать ли артиста участником роялти. Глобальный режим сильнее настройки артиста:
 *   per_artist — решает карточка; all_on — включено у всех; all_off — выключено у всех (настройки артистов сохраняются).
 * Любое изменение пишется в журнал; повтор того же значения журнал не засоряет.
 */
import { query, pool } from './db.mjs';
import { isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { clean } from './gocore.mjs';

export const MODES = ['per_artist', 'all_on', 'all_off'];
export const globalMode = async () => (await query('SELECT mode FROM music_royalty_settings WHERE id=1')).rows[0]?.mode ?? 'per_artist';
/** Единая точка решения — любые будущие начисления обязаны спрашивать её, а не читать флаг карточки. */
export const effectiveRoyalty = async (cardId) => {
  const mode = await globalMode();
  if (mode === 'all_on') return { enabled: true, source: 'global' };
  if (mode === 'all_off') return { enabled: false, source: 'global' };
  const c = (await query('SELECT royalty_enabled FROM music_artist_cards WHERE id=$1', [String(cardId ?? '')])).rows[0];
  return { enabled: c?.royalty_enabled === true, source: 'artist' };
};

export const cardRoyalty = async (me, cardId) => {
  const c = (await query('SELECT id, name, royalty_enabled FROM music_artist_cards WHERE id=$1 AND owner_id=$2 AND merged_into IS NULL AND NOT hidden', [String(cardId ?? ''), me])).rows[0];
  if (!c) return { error: 'not_found' };
  const eff = await effectiveRoyalty(c.id);
  return { cardId: c.id, name: c.name, setting: c.royalty_enabled, effective: eff.enabled, source: eff.source, globalMode: await globalMode() };
};

export const setCardRoyalty = async (me, cardId, enabled) => {
  if (typeof enabled !== 'boolean') return { error: 'bad_value' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const c = (await client.query('SELECT id, royalty_enabled FROM music_artist_cards WHERE id=$1 AND owner_id=$2 AND merged_into IS NULL AND NOT hidden FOR UPDATE', [String(cardId ?? ''), me])).rows[0];
    if (!c) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (c.royalty_enabled !== enabled) {
      await client.query('UPDATE music_artist_cards SET royalty_enabled=$2, updated_at=now() WHERE id=$1', [c.id, enabled]);
      await client.query('INSERT INTO music_royalty_log (scope, card_id, actor_id, old_value, new_value) VALUES ($1,$2,$3,$4,$5)', ['card', c.id, me, String(c.royalty_enabled), String(enabled)]);
    }
    await client.query('COMMIT');
  } catch { await client.query('ROLLBACK').catch(() => {}); return { error: 'failed' }; } finally { client.release(); }
  return cardRoyalty(me, cardId);
};

export const adminGet = async (me) => {
  if (!(await isOwner(me))) return { error: 'not_allowed' };
  const s = (await query('SELECT mode, reason, updated_by, updated_at FROM music_royalty_settings WHERE id=1')).rows[0];
  const stat = (await query('SELECT count(*) FILTER (WHERE royalty_enabled)::int AS on_n, count(*)::int AS total FROM music_artist_cards WHERE owner_id IS NOT NULL AND merged_into IS NULL AND NOT hidden')).rows[0];
  const log = (await query('SELECT id, scope, card_id, actor_id, old_value, new_value, reason, at FROM music_royalty_log ORDER BY id DESC LIMIT 100')).rows;
  return { mode: s.mode, reason: s.reason, updatedAt: s.updated_at, artistsOn: stat.on_n, artistsWithOwner: stat.total, log,
    note: 'Это только переключатели. Sky не рассчитывает и не выплачивает роялти — расчёты и договоры вне платформы.' };
};

/** Глобальный переключатель: только владелец сервиса, причина обязательна. Повтор того же режима — без записи в журнал. */
export const adminSet = async (me, mode, reasonRaw) => {
  if (!(await isOwner(me))) return { error: 'not_allowed' };
  if (!MODES.includes(mode)) return { error: 'bad_value' };
  const reason = clean(reasonRaw, 300); if (reason.length < 5) return { error: 'reason_required' };
  const client = await pool.connect();
  let changed = false;
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT mode FROM music_royalty_settings WHERE id=1 FOR UPDATE')).rows[0];
    if (cur.mode !== mode) {
      await client.query('UPDATE music_royalty_settings SET mode=$1, reason=$2, updated_by=$3, updated_at=now() WHERE id=1', [mode, reason, me]);
      await client.query('INSERT INTO music_royalty_log (scope, actor_id, old_value, new_value, reason) VALUES ($1,$2,$3,$4,$5)', ['global', me, cur.mode, mode, reason]);
      changed = true;
    }
    await client.query('COMMIT');
  } catch { await client.query('ROLLBACK').catch(() => {}); return { error: 'failed' }; } finally { client.release(); }
  if (changed) await logAdmin({ actorId: me, targetType: 'music_royalty', type: 'music_royalty_global', detail: `${mode} — ${reason}` }).catch(() => {});
  return { ok: true, changed, mode };
};
