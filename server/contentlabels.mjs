/**
 * Метки контента (модуль 9, ноябрь-2026): Explicit «E», «Старая версия», сведения об источнике.
 *
 * Кто что ставит:
 *  • владелец материала — свою отметку Explicit, «источник» и «правообладателя» (о своём);
 *  • модератор (право `content`) — решение по Explicit (перекрывает отметку автора), «Старая версия» (только он, по подтверждённым
 *    данным), уточнение источника. Любое его изменение — с причиной, и пишется в журнал меток и журнал администрации.
 * Итоговый Explicit = решение модератора, если оно есть, иначе отметка автора.
 */
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

const KINDS = {
  track: { table: 'music_tracks', owner: 'owner_id', author: 'artist' },
  movie: { table: 'film_movies', owner: 'owner_id', author: 'director' },
  book:  { table: 'books', owner: 'author_id', author: null },
};
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const effectiveExplicit = (row) => (row.mod_explicit === null || row.mod_explicit === undefined ? row.explicit === true : row.mod_explicit === true);

export const getSettings = async () => {
  const s = (await query('SELECT * FROM content_label_settings WHERE id')).rows[0];
  return { legacyEnabled: s.legacy_enabled, legacyText: s.legacy_text, explicitText: s.explicit_text };
};

const loadRow = async (kind, id) => {
  const k = KINDS[kind]; if (!k) return null;
  const { rows } = await query(`SELECT * FROM ${k.table} WHERE id = $1`, [String(id ?? '')]);
  return rows[0] ? { row: rows[0], k } : null;
};
const visibleTo = async (row, k, viewerId) => row.status === 'published' || row[k.owner] === viewerId || await can(viewerId, 'content');

/** Сведения для карточки: итоговые метки и источник (кто добавил, когда, источник, автор, правообладатель, лицензия). */
export const getLabels = async (kind, id, viewerId) => {
  const f = await loadRow(kind, id);
  if (!f || !(await visibleTo(f.row, f.k, viewerId))) return null;
  const { row, k } = f;
  const s = await getSettings();
  const ownerId = row[k.owner];
  const who = ownerId ? (await query('SELECT name FROM profiles WHERE id = $1', [ownerId])).rows[0]?.name : null;
  const mod = await can(viewerId, 'content');
  return {
    explicit: effectiveExplicit(row),
    explicitBy: row.mod_explicit === null || row.mod_explicit === undefined ? 'author' : 'moderator',
    legacy: s.legacyEnabled && row.legacy_label === true,
    legacyText: s.legacyText,
    explicitText: s.explicitText,
    source: {
      addedBy: who ?? undefined,
      addedAt: (row.created_at ?? row.published_at)?.toISOString?.(),
      source: row.source_note ? decryptContent(row.source_note) ?? undefined : (row.license_source || undefined),
      author: (k.author ? row[k.author] : undefined) || undefined,
      rightsholder: row.rightsholder ? decryptContent(row.rightsholder) ?? undefined : undefined,
      license: row.license || undefined,
    },
    canEditOwn: ownerId === viewerId,
    canModerate: mod,
    ...(mod ? { history: await historyOf(kind, id) } : {}),
  };
};

const historyOf = async (kind, id) => (await query(
  `SELECT l.field, l.old_value, l.new_value, l.reason, l.actor_role, l.at, p.username FROM content_label_log l LEFT JOIN profiles p ON p.id = l.actor_id WHERE l.kind=$1 AND l.content_id=$2 ORDER BY l.id DESC LIMIT 50`, [kind, id])).rows
  .map((r) => ({ field: r.field, from: r.old_value, to: r.new_value, reason: r.reason ? decryptContent(r.reason) ?? undefined : undefined, by: r.actor_role, actor: r.username ? `@${r.username}` : undefined, at: r.at.toISOString() }));

const logChange = (kind, id, actor, role, field, oldV, newV, reason) => query(
  'INSERT INTO content_label_log (kind, content_id, actor_id, actor_role, field, old_value, new_value, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
  [kind, id, actor, role, field, oldV === undefined ? null : String(oldV), newV === undefined ? null : String(newV), reason ? encryptContent(reason) : null]);

/** Владелец о своём: Explicit, источник, правообладатель. */
export const ownerUpdate = async (kind, id, actorId, { explicit, sourceNote, rightsholder } = {}) => {
  const f = await loadRow(kind, id);
  if (!f) return { error: 'not_found' };
  if (f.row[f.k.owner] !== actorId) return { error: 'not_allowed' };
  const sets = []; const args = [id];
  const put = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  if (explicit !== undefined && explicit !== f.row.explicit) { put('explicit', explicit === true); await logChange(kind, id, actorId, 'owner', 'explicit', f.row.explicit, explicit === true, null); }
  if (sourceNote !== undefined) { const v = clean(sourceNote, 300); put('source_note', v ? encryptContent(v) : null); await logChange(kind, id, actorId, 'owner', 'source', null, v || '', null); }
  if (rightsholder !== undefined) { const v = clean(rightsholder, 200); put('rightsholder', v ? encryptContent(v) : null); await logChange(kind, id, actorId, 'owner', 'rightsholder', null, v || '', null); }
  if (!sets.length) return { ok: true };
  await query(`UPDATE ${f.k.table} SET ${sets.join(', ')} WHERE id = $1`, args);
  return { ok: true };
};

/** Модератор: решение по Explicit (true/false/null=снять решение), «Старая версия», уточнение источника — с обязательной причиной. */
export const moderatorUpdate = async (kind, id, actorId, { explicit, legacy, sourceNote, rightsholder, reason } = {}) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const f = await loadRow(kind, id);
  if (!f) return { error: 'not_found' };
  const why = clean(reason, 500);
  if (why.length < 5) return { error: 'reason_required' };
  const sets = []; const args = [id];
  const put = (c, v) => { args.push(v); sets.push(`${c} = $${args.length}`); };
  const changes = [];
  if (explicit !== undefined) {
    if (explicit !== null && typeof explicit !== 'boolean') return { error: 'bad_value' };
    if ((f.row.mod_explicit ?? null) !== explicit) { put('mod_explicit', explicit); changes.push(['mod_explicit', f.row.mod_explicit, explicit]); }
  }
  if (legacy !== undefined) {
    if (typeof legacy !== 'boolean') return { error: 'bad_value' };
    if (f.row.legacy_label !== legacy) { put('legacy_label', legacy); changes.push(['legacy', f.row.legacy_label, legacy]); }
  }
  if (sourceNote !== undefined) { const v = clean(sourceNote, 300); put('source_note', v ? encryptContent(v) : null); changes.push(['source', null, v]); }
  if (rightsholder !== undefined) { const v = clean(rightsholder, 200); put('rightsholder', v ? encryptContent(v) : null); changes.push(['rightsholder', null, v]); }
  if (!changes.length) return { error: 'nothing_to_change' };
  put('labeled_by', actorId); put('labeled_at', new Date());
  await query(`UPDATE ${f.k.table} SET ${sets.join(', ')} WHERE id = $1`, args);
  for (const [field, a, b] of changes) await logChange(kind, id, actorId, 'moderator', field, a, b, why);
  await logAdmin({ actorId, targetId: f.row[f.k.owner], targetType: 'content', type: 'content_label', detail: `${kind}:${id} ${changes.map((c) => c[0]).join(',')} — ${why}` });
  return { ok: true, labels: await getLabels(kind, id, actorId) };
};

/** Пакет для списков: { id: { explicit, legacy } } только для того, что человек вправе видеть. */
export const batch = async (kind, ids, viewerId) => {
  const k = KINDS[kind]; const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 100);
  if (!k || !list.length) return {};
  const s = await getSettings();
  const mod = await can(viewerId, 'content');
  const { rows } = await query(`SELECT id, status, ${k.owner} AS owner_id, explicit, mod_explicit, legacy_label FROM ${k.table} WHERE id = ANY($1)`, [list]);
  const out = {};
  for (const r of rows) {
    if (!(r.status === 'published' || r.owner_id === viewerId || mod)) continue;
    out[r.id] = { explicit: effectiveExplicit(r), legacy: s.legacyEnabled && r.legacy_label === true };
  }
  return out;
};

export const saveSettings = async (actorId, body) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const cur = await getSettings();
  const legacyText = body?.legacyText === undefined ? cur.legacyText : clean(body.legacyText, 200);
  const explicitText = body?.explicitText === undefined ? cur.explicitText : clean(body.explicitText, 200);
  if (!legacyText || !explicitText) return { error: 'bad_value' };
  const enabled = typeof body?.legacyEnabled === 'boolean' ? body.legacyEnabled : cur.legacyEnabled;
  await query('UPDATE content_label_settings SET legacy_enabled=$1, legacy_text=$2, explicit_text=$3, updated_by=$4, updated_at=now() WHERE id', [enabled, legacyText, explicitText, actorId]);
  await logAdmin({ actorId, targetType: 'system', type: 'content_label_settings', detail: `метка «Старая версия» ${enabled ? 'включена' : 'выключена'}` });
  return { ok: true, settings: await getSettings() };
};
