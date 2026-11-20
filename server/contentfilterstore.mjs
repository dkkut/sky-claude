/* Фильтры контента: настройки, очередь удержаний, применение решения к материалу.
 * Разбор текста — в contentfilter.mjs (без БД). Сюда подключаются разделы Sky: см. CLAUDE.md. */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { encryptSecret, decryptSecret } from './crypto.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { CATEGORIES, ACTIONS, DEFAULT_ACTIONS, inspectMany, inspectText } from './contentfilter.mjs';

const note = async (u, k, t, b, r) => { try { await notifyGift(u, k, t, b, r); } catch { /* уведомление не должно ломать дело */ } };

let cache = null; let cacheAt = 0;
export const forgetSettings = () => { cache = null; };

export const getSettings = async () => {
  if (cache && Date.now() - cacheAt < 15_000) return cache;
  let row = null;
  try { row = (await query('SELECT enabled, actions, custom_words, allow_words FROM content_filter_settings WHERE id = 1')).rows[0]; } catch { /* таблицы ещё нет — работаем по умолчанию */ }
  cache = {
    enabled: row ? row.enabled : true,
    actions: { ...DEFAULT_ACTIONS, ...(row?.actions ?? {}) },
    customWords: row?.custom_words ?? [],
    allowWords: row?.allow_words ?? [],
  };
  cacheAt = Date.now();
  return cache;
};

const logEvent = async (kind, authorId, categories, action) => {
  try { await query('INSERT INTO cf_events (kind, author_id, categories, action) VALUES ($1,$2,$3,$4)', [kind, authorId, categories, action]); } catch { /* журнал не обязателен */ }
};

/** Проверка набора полей. Сбой фильтра материал НЕ блокирует (закрыто — не значит «всё заблокировано»). */
export const checkContent = async (kind, authorId, parts) => {
  try {
    const st = await getSettings();
    const r = inspectMany(parts, st);
    if (r.action !== 'allow') await logEvent(kind, authorId, r.categories, r.action);
    return r;
  } catch (e) {
    console.error('[contentfilter]', e?.message);
    return { action: 'allow', categories: [], hits: [], maskFields: parts };
  }
};

/** Ответ клиенту на отказ. */
export const blockedReply = (r) => ({ error: 'content_blocked', categories: r.categories });

/** Удержание на проверку. Скрыть сам материал должен вызывающий (в той же транзакции, если нужно). */
export const createHold = async (exec, { kind, targetId, authorId, categories, text }) => {
  const id = `cfh-${generateId()}`;
  const excerpt = String(text ?? '').slice(0, 1500);
  await exec(
    `INSERT INTO cf_holds (id, kind, target_id, author_id, categories, excerpt_enc) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (kind, target_id) WHERE status = 'pending' DO NOTHING`,
    [id, kind, targetId, authorId, categories, excerpt ? encryptSecret(excerpt) : null]);
  await note(authorId, 'content_hold', 'Публикация отправлена на проверку',
    'В тексте нашлось то, что требует проверки модератором. Пока она идёт, публикацию никто не видит.', targetId);
  return id;
};

/* ── применение решения ───────────────────────────────────────── */
const APPLY = {
  async bloom_post(c, id, ok) { await c.query(ok ? 'UPDATE bloom_posts SET deleted_at = NULL, held_at = NULL WHERE id = $1 AND held_at IS NOT NULL' : 'UPDATE bloom_posts SET held_at = NULL WHERE id = $1 AND held_at IS NOT NULL', [id]); },
  async bloom_comment(c, id, ok) { await c.query(ok ? 'UPDATE bloom_comments SET deleted_at = NULL, held_at = NULL WHERE id = $1 AND held_at IS NOT NULL' : 'UPDATE bloom_comments SET held_at = NULL WHERE id = $1 AND held_at IS NOT NULL', [id]); },
  async bloom_event(c, id, ok) { await c.query(ok ? 'UPDATE bloom_events SET held_at = NULL WHERE id = $1 AND held_at IS NOT NULL' : 'UPDATE bloom_events SET held_at = NULL, removed_at = now(), remove_reason = \'отклонено проверкой\' WHERE id = $1 AND held_at IS NOT NULL', [id]); },
  async qa_question(c, id, ok) { await c.query('UPDATE qa_questions SET status = $2 WHERE id = $1 AND status = \'held\'', [id, ok ? 'open' : 'removed']); },
  async qa_answer(c, id, ok) {
    const r = await c.query('UPDATE qa_answers SET status = $2 WHERE id = $1 AND status = \'held\' RETURNING question_id', [id, ok ? 'visible' : 'removed']);
    if (ok && r.rows[0]) await c.query('UPDATE qa_questions SET answers = answers + 1 WHERE id = $1', [r.rows[0].question_id]);
  },
};
export const HOLD_KINDS = Object.keys(APPLY);

export const decideHold = async (adminId, holdId, approve, reason, meta) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const why = String(reason ?? '').trim();
  if (!approve && why.length < 5) return { error: 'reason_required' };
  const client = await pool.connect();
  let h;
  try {
    await client.query('BEGIN');
    h = (await client.query(`SELECT * FROM cf_holds WHERE id = $1 AND status = 'pending' FOR UPDATE`, [holdId])).rows[0];
    if (!h) { await client.query('ROLLBACK'); return { error: 'not_found' }; }
    if (h.author_id === adminId) { await client.query('ROLLBACK'); return { error: 'self_review' }; }
    await APPLY[h.kind]?.(client, h.target_id, approve);
    await client.query(`UPDATE cf_holds SET status = $2, decided_by = $3, reason = $4, decided_at = now(), excerpt_enc = NULL WHERE id = $1`,
      [holdId, approve ? 'approved' : 'rejected', adminId, why || null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  await logAdmin({ actorId: adminId, targetId: h.author_id, targetType: `cf_${h.kind}`, type: approve ? 'content_filter_approve' : 'content_filter_reject', detail: why.slice(0, 200), meta });
  await note(h.author_id, 'content_hold',
    approve ? 'Публикация одобрена' : 'Публикация отклонена модерацией',
    approve ? 'Модератор проверил вашу публикацию — она опубликована.' : `Модератор не одобрил публикацию. Причина: ${why}`, h.target_id);
  return { ok: true };
};

export const listHolds = async (adminId, status = 'pending') => {
  if (!(await can(adminId, 'content'))) return null;
  const st = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  const { rows } = await query(
    `SELECT h.*, p.name AS author_name, p.username AS author_username FROM cf_holds h LEFT JOIN profiles p ON p.id = h.author_id
      WHERE h.status = $1 ORDER BY h.created_at DESC LIMIT 100`, [st]);
  return {
    holds: rows.map((h) => ({
      id: h.id, kind: h.kind, targetId: h.target_id, categories: h.categories, createdAt: h.created_at, status: h.status, reason: h.reason,
      excerpt: h.excerpt_enc ? (() => { try { return decryptSecret(h.excerpt_enc); } catch { return ''; } })() : '',
      author: { id: h.author_id, name: h.author_name, username: h.author_username },
    })),
  };
};

/* ── настройки ─────────────────────────────────────────────────── */
const cleanWords = (list, max) => (Array.isArray(list) ? list : []).slice(0, max).map((x) => String(x ?? '').trim().slice(0, 60)).filter((x) => x.length >= 2);

export const getAdminView = async (adminId) => {
  if (!(await can(adminId, 'content'))) return null;
  forgetSettings();
  const st = await getSettings();
  const stats = (await query(`SELECT unnest(categories) AS c, count(*)::int AS n FROM cf_events WHERE created_at > now() - interval '7 days' GROUP BY 1`)).rows;
  const pending = (await query(`SELECT count(*)::int AS n FROM cf_holds WHERE status = 'pending'`)).rows[0].n;
  return { settings: st, defaults: DEFAULT_ACTIONS, categories: CATEGORIES, actions: ACTIONS, stats: Object.fromEntries(stats.map((r) => [r.c, r.n])), pending };
};

export const saveSettings = async (adminId, b, meta) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const actions = {};
  for (const c of CATEGORIES) { const a = b?.actions?.[c]; if (ACTIONS.includes(a)) actions[c] = a; }
  const custom = (Array.isArray(b?.customWords) ? b.customWords : []).slice(0, 300).map((w) => ({
    word: String(w?.word ?? '').trim().slice(0, 60),
    category: CATEGORIES.includes(w?.category) ? w.category : 'custom',
    weight: Number(w?.weight) === 1 ? 1 : 2,
  })).filter((w) => w.word.length >= 3);
  const allow = cleanWords(b?.allowWords, 300);
  const enabled = b?.enabled !== false;
  await query(`INSERT INTO content_filter_settings (id, enabled, actions, custom_words, allow_words, updated_by, updated_at) VALUES (1,$1,$2,$3,$4,$5, now())
               ON CONFLICT (id) DO UPDATE SET enabled = $1, actions = $2, custom_words = $3, allow_words = $4, updated_by = $5, updated_at = now()`,
  [enabled, JSON.stringify(actions), JSON.stringify(custom), allow, adminId]);
  forgetSettings();
  await logAdmin({ actorId: adminId, targetId: null, targetType: 'content_filter', type: 'content_filter_settings', detail: `enabled=${enabled}; ${Object.entries(actions).map(([k, v]) => `${k}:${v}`).join(',')}; слов ${custom.length}/${allow.length}`.slice(0, 200), meta });
  return { ok: true };
};

export const testText = async (adminId, text) => {
  if (!(await can(adminId, 'content'))) return { error: 'not_allowed' };
  const st = await getSettings();
  const r = inspectText(String(text ?? '').slice(0, 5000), st);
  return { action: r.action, categories: r.categories, hits: r.hits.map((h) => ({ category: h.category, score: h.score, action: h.action, samples: h.samples })), masked: r.mask(String(text ?? '').slice(0, 5000)) };
};
