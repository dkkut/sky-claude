/**
 * Удаление профиля и Sky ID с возможностью восстановления в течение 30 дней.
 *
 *  1. Запрос. Нужна подтверждённая почта (или аутентификатор) и код: удалить аккаунт «по сессии» нельзя. Перед запросом человек видит
 *     последствия (`deletionPreview`) и явно подтверждает потерю баланса. Незавершённые сделки (Garant, заказы, платежи, семья-владелец,
 *     права администратора) удалению мешают — их сначала нужно закрыть.
 *  2. Ожидание (30 дней). Данные НЕ трогаются — аккаунт только блокируется: все сессии отозваны, вход невозможен (423 `account_deletion_pending`),
 *     профиль скрыт. Поэтому «восстановить» = снять отметку, ничего не копируется и не теряется. Отдельно пишется зашифрованный манифест
 *     (что было: счётчики, идентификаторы, маски контактов — без паролей, токенов, секретов и файлов) для сверки.
 *  3. Отмена. Только с доказательством владения: код на подтверждённую почту (+ код аутентификатора, если он включён).
 *  4. Окончательная очистка (`purgeDue`, раз в час). Личные данные и контент стираются, профиль ОБЕЗЛИЧИВАЕТСЯ (строка остаётся с псевдонимом),
 *     потому что финансовые и договорные записи обязаны храниться: кошелёк, заказы, споры Garant, платежи SkyKassa, штрафы, согласия, журнал админки.
 *     Сообщения в чужих чатах остаются у собеседников, автор — «Удалённый пользователь». Манифест удаляется.
 *
 * Чего здесь нет: полной и немедленной очистки резервных копий — копии стираются по своему сроку хранения (Sky Storage).
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { encryptSecret, decryptContent } from './crypto.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { sendEmail } from './notify.mjs';
import { sessionStore } from './sessions.mjs';
import { generateId } from './security.mjs';
import { isOwnerRaw } from './admin.mjs';
import { L } from './lang.mjs';
import { deleteTrack } from './music.mjs';
import { deleteMovie } from './film.mjs';
import { deleteBook } from './books.mjs';
import { removeBookFiles, removeChapterAudio } from './bookstore.mjs';
import { deletePodcast } from './podcasts.mjs';
import { deletePost } from './bloom.mjs';
import { deleteStory } from './stories.mjs';
import { deleteBot } from './bots.mjs';
import { deleteVideo } from './skyvideo.mjs';

export const RETENTION_DAYS = 30;

const ipHash = (ip) => crypto.createHmac('sha256', config.jwtSecret).update(`del-ip:${ip}`).digest('hex').slice(0, 32);
const maskEmail = (e) => String(e ?? '').replace(/^(.).*(@.*)$/, '$1***$2');
const n = (v) => Number(v ?? 0);

const sky = async (skyId) => (await query(
  `SELECT id, email, email_verified, phone, two_factor_enabled, two_factor_method, deletion_purge_at, deleted_at FROM sky_ids WHERE id = $1`, [skyId])).rows[0] ?? null;
const myProfiles = async (skyId) => (await query(
  `SELECT id, username, name, is_admin, admin_role, deletion_purge_at, deleted_at FROM profiles WHERE sky_id = $1 ORDER BY created_at`, [skyId])).rows;

/* ─── Последствия и препятствия ───────────────────────────────────── */

const count = async (sql, args) => n((await query(sql, args)).rows[0]?.n);

/** Что человек теряет и что мешает удалить. `scope`: account | profile. */
export const deletionPreview = async (skyId, { scope = 'account', profileId = null } = {}) => {
  const row = await sky(skyId);
  if (!row) return { error: 'not_found' };
  const all = (await myProfiles(skyId)).filter((p) => !p.deleted_at);
  let target = all;
  if (scope === 'profile') {
    target = all.filter((p) => p.id === profileId);
    if (!target.length) return { error: 'not_found' };
    if (all.filter((p) => !p.deletion_purge_at).length < 2) return { error: 'last_profile', hint: 'Это единственный профиль: удалите весь Sky ID.' };
  }
  const ids = target.map((p) => p.id);
  const blockers = [];
  const add = (code, text) => blockers.push({ code, text });
  if (await count(`SELECT count(*) AS n FROM garant_deals WHERE (buyer_id = ANY($1) OR seller_id = ANY($1)) AND status IN ('pending_seller','pending_buyer','in_escrow','disputed')`, [ids])) add('garant', 'Есть незавершённые сделки Sky Garant');
  if (await count(`SELECT count(*) AS n FROM market_orders WHERE (buyer_id = ANY($1) OR seller_id = ANY($1)) AND status NOT IN ('completed','cancelled')`, [ids])) add('market', 'Есть незавершённые заказы Sky Market');
  if (await count(`SELECT count(*) AS n FROM go_orders WHERE (customer_id = ANY($1) OR executor_id = ANY($1)) AND status NOT IN ('paid','cancelled','completed','refunded','expired','rejected')`, [ids])) add('go', 'Есть незавершённые заказы Sky GO');
  if (await count(`SELECT count(*) AS n FROM skykassa_payments WHERE (user_id = ANY($1) OR owner_id = ANY($1)) AND status IN ('awaiting_payment','user_reported','awaiting_review','in_review','awaiting_owner','confirmed','crediting','need_info','refund_requested','refund_processing')`, [ids])) add('skykassa', 'Есть платежи SkyKassa в обработке');
  if (await count(`SELECT count(*) AS n FROM families WHERE owner_id = ANY($1) AND status = 'active'`, [ids])) add('family', 'Вы владелец семьи Sky Family: передайте владение или закройте семью');
  if (target.some((p) => p.is_admin || p.admin_role)) add('admin', 'Аккаунт имеет права администрации: сначала их должен снять владелец');
  for (const p of target) if (await isOwnerRaw(p.id).catch(() => false)) { add('owner', 'Аккаунт владельца платформы удалить нельзя'); break; }

  const warnings = [];
  const wallet = (await query(`SELECT coalesce(sum(balance),0)::bigint AS rub, coalesce(sum(points),0)::bigint AS pts FROM wallet_accounts WHERE user_id = ANY($1)`, [ids])).rows[0];
  if (n(wallet.rub) > 0 || n(wallet.pts) > 0) warnings.push({ code: 'wallet', text: `Баланс кошелька (${n(wallet.rub)} ₽, ${n(wallet.pts)} баллов) будет потерян: вывода денег в Sky нет` });
  const prime = await count(`SELECT count(*) AS n FROM prime_subscriptions WHERE profile_id = ANY($1) AND status = 'active' AND (expires_at IS NULL OR expires_at > now())`, [ids]);
  if (prime) warnings.push({ code: 'prime', text: 'Активная подписка Sky Prime пропадёт без возврата' });
  const c = {
    tracks: await count(`SELECT count(*) AS n FROM music_tracks WHERE owner_id = ANY($1)`, [ids]),
    movies: await count(`SELECT count(*) AS n FROM film_movies WHERE owner_id = ANY($1)`, [ids]),
    books: await count(`SELECT count(*) AS n FROM books WHERE author_id = ANY($1)`, [ids]),
    videos: await count(`SELECT count(*) AS n FROM sky_videos WHERE owner_id = ANY($1)`, [ids]),
    posts: await count(`SELECT count(*) AS n FROM bloom_posts WHERE author_id = ANY($1)`, [ids]),
    followers: await count(`SELECT count(*) AS n FROM follows WHERE following_id = ANY($1)`, [ids]),
    chats: await count(`SELECT count(*) AS n FROM chat_members WHERE user_id = ANY($1)`, [ids]),
  };
  if (c.tracks + c.movies + c.books + c.videos + c.posts) warnings.push({ code: 'content', text: 'Ваш контент (музыка, фильмы, книги, видео, посты) будет удалён' });
  warnings.push({ code: 'messages', text: 'Сообщения в чатах других людей останутся у них, автор будет показан как «Удалённый пользователь»' });
  warnings.push({ code: 'retained', text: 'Финансовые и договорные записи (заказы, споры, платежи, штрафы, согласия) хранятся обезличенно — этого требует закон' });
  return { ok: true, scope, profiles: target.map((p) => ({ id: p.id, username: p.username, name: p.name })), blockers, warnings, counts: c,
    wallet: { rub: n(wallet.rub), points: n(wallet.pts) }, hasPrime: prime > 0, retentionDays: RETENTION_DAYS, canRequest: blockers.length === 0 };
};

/* ─── Подтверждение личности ──────────────────────────────────────── */

const sendCode = async (row, purpose) => {
  if (!row?.email_verified || !row.email) return { error: 'email_required' };
  const r = await issueCode('email', row.email, purpose);
  return r.error ? r : { ok: true, email: maskEmail(row.email), retryAfter: r.retryAfter };
};
export const sendDeletionCode = async (skyId) => sendCode(await sky(skyId), `delete:${skyId}`);

/** Доказательство владения: код аутентификатора (если включён) И/ИЛИ код с подтверждённой почты. Без почты удалять нельзя. */
const prove = async (row, purposeKey, body, verifyTwoFactor) => {
  if (!row.email_verified || !row.email) return { error: 'email_required' };
  if (row.two_factor_enabled) {
    if (!body?.twoFactorCode) return { error: 'two_factor_required' };
    const c = await verifyTwoFactor(row.id, String(body.twoFactorCode));
    if (c?.error) return { error: c.error === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code' };
  }
  if (!body?.emailCode) return { error: 'email_code_required' };
  const c = await verifyCode('email', row.email, purposeKey, String(body.emailCode));
  return c.error ? { error: 'invalid_code' } : { ok: true };
};

/* ─── Запрос ──────────────────────────────────────────────────────── */

const manifestOf = async (skyId, ids, row) => ({
  at: new Date().toISOString(), skyId, profiles: ids, emailMask: maskEmail(row.email), phoneTail: String(row.phone ?? '').slice(-2),
  counts: (await deletionPreview(skyId, { scope: 'account' })).counts ?? {},
});

export const requestDeletion = async (skyId, sid, { scope = 'account', profileId = null, ack = {}, ip = '', ...proof } = {}, verifyTwoFactor) => {
  const row = await sky(skyId);
  if (!row || row.deleted_at) return { error: 'not_found' };
  if (row.deletion_purge_at) return { error: 'already_pending' };
  if (!['account', 'profile'].includes(scope)) return { error: 'bad_scope' };
  const pre = await deletionPreview(skyId, { scope, profileId });
  if (pre.error) return pre;
  if (pre.blockers.length) return { error: 'blocked', blockers: pre.blockers };
  if ((pre.wallet.rub > 0 || pre.wallet.points > 0) && ack?.wallet !== true) return { error: 'ack_wallet_required', wallet: pre.wallet };
  if (pre.hasPrime && ack?.prime !== true) return { error: 'ack_prime_required' };
  if (ack?.understood !== true) return { error: 'ack_required' };
  const p = await prove(row, `delete:${skyId}`, proof, verifyTwoFactor);
  if (p.error) return p;

  const ids = pre.profiles.map((x) => x.id);
  const id = `del-${generateId()}`;
  const purgeAt = new Date(Date.now() + RETENTION_DAYS * 86_400_000);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO account_deletions (id, sky_id, profile_id, scope, purge_at, ip_hash, ack) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, skyId, scope === 'profile' ? profileId : null, scope, purgeAt, ipHash(ip), JSON.stringify({ wallet: ack.wallet === true, prime: ack.prime === true })]);
    await c.query(`INSERT INTO account_deletion_manifests (deletion_id, data_enc) VALUES ($1,$2)`, [id, encryptSecret(JSON.stringify(await manifestOf(skyId, ids, row)))]);
    if (scope === 'account') {
      await c.query(`UPDATE sky_ids SET deletion_purge_at = $2, updated_at = now() WHERE id = $1`, [skyId, purgeAt]);
      await c.query(`UPDATE profiles SET deletion_purge_at = $2 WHERE sky_id = $1`, [skyId, purgeAt]);
    } else await c.query(`UPDATE profiles SET deletion_purge_at = $2 WHERE id = $1 AND sky_id = $3`, [profileId, purgeAt, skyId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }

  // Сессии: при удалении всего Sky ID — все, включая текущую; при удалении профиля — только вход в этот профиль (его выбор перестаёт проходить).
  if (scope === 'account') await sessionStore.revokeAllForUser(skyId);
  await query(`DELETE FROM push_subscriptions WHERE profile_id = ANY($1)`, [ids]).catch(() => {});
  await notifyByEmail(row, purgeAt, scope).catch((e) => console.error('[deletion] письмо:', e.message));
  return { ok: true, id, scope, purgeAt: purgeAt.toISOString(), retentionDays: RETENTION_DAYS };
};

const notifyByEmail = async (row, purgeAt, scope) => {
  const when = purgeAt.toISOString().slice(0, 10);
  await sendEmail(row.email,
    L('Sky: запрошено удаление аккаунта', 'Sky: account deletion requested'),
    L(`Вы запросили удаление ${scope === 'profile' ? 'профиля' : 'аккаунта Sky ID'}. Данные будут окончательно удалены ${when}. До этой даты их можно восстановить: ` +
      `войдите в Sky и выберите «Восстановить аккаунт» (понадобится код с этой почты). Если это были не вы — немедленно восстановите аккаунт и смените пароль.`,
    `You requested deletion of your ${scope === 'profile' ? 'profile' : 'Sky ID account'}. The data will be permanently deleted on ${when}. Until then you can restore it: ` +
      `sign in to Sky and choose “Restore account” (a code from this email is required). If this was not you, restore the account immediately and change your password.`));
};

/* ─── Состояние и отмена ──────────────────────────────────────────── */

export const deletionStatus = async (skyId) => {
  const row = await sky(skyId);
  if (!row) return { error: 'not_found' };
  const { rows } = await query(`SELECT id, scope, profile_id, requested_at, purge_at FROM account_deletions WHERE sky_id = $1 AND status = 'pending' ORDER BY requested_at DESC`, [skyId]);
  return { pending: rows.map((r) => ({ id: r.id, scope: r.scope, profileId: r.profile_id, requestedAt: r.requested_at.toISOString(), purgeAt: r.purge_at.toISOString(), daysLeft: Math.max(0, Math.ceil((r.purge_at - Date.now()) / 86_400_000)) })),
    hasEmail: Boolean(row.email_verified && row.email), needsTotp: Boolean(row.two_factor_enabled), retentionDays: RETENTION_DAYS };
};

const doCancel = async (skyId, profileId) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (profileId) {
      await c.query(`UPDATE account_deletions SET status='cancelled', cancelled_at=now() WHERE sky_id=$1 AND profile_id=$2 AND status='pending'`, [skyId, profileId]);
      await c.query(`UPDATE profiles SET deletion_purge_at = NULL WHERE id = $1 AND sky_id = $2 AND deleted_at IS NULL`, [profileId, skyId]);
    } else {
      await c.query(`UPDATE account_deletions SET status='cancelled', cancelled_at=now() WHERE sky_id=$1 AND scope='account' AND status='pending'`, [skyId]);
      await c.query(`UPDATE sky_ids SET deletion_purge_at = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [skyId]);
      await c.query(`UPDATE profiles SET deletion_purge_at = NULL WHERE sky_id = $1 AND deleted_at IS NULL AND id NOT IN (SELECT profile_id FROM account_deletions WHERE sky_id=$1 AND status='pending' AND profile_id IS NOT NULL)`, [skyId]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
};

/** Отмена удаления ПРОФИЛЯ из открытой сессии (код почты/аутентификатора обязателен). */
export const cancelProfileDeletion = async (skyId, profileId, proof, verifyTwoFactor) => {
  const row = await sky(skyId);
  if (!row) return { error: 'not_found' };
  const { rows } = await query(`SELECT 1 FROM account_deletions WHERE sky_id=$1 AND profile_id=$2 AND status='pending'`, [skyId, profileId]);
  if (!rows[0]) return { error: 'not_pending' };
  const p = await prove(row, `delete:${skyId}`, proof, verifyTwoFactor);
  if (p.error) return p;
  await doCancel(skyId, profileId);
  return { ok: true };
};

const findByEmail = async (identifier) => {
  const e = String(identifier ?? '').trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  return (await query(`SELECT id, email, email_verified, phone, two_factor_enabled, two_factor_method, deletion_purge_at, deleted_at FROM sky_ids
                        WHERE lower(email) = $1 AND email_verified AND deletion_purge_at IS NOT NULL AND deleted_at IS NULL`, [e])).rows[0] ?? null;
};

/** Восстановление всего аккаунта БЕЗ входа: ответ одинаков для любого адреса (не выдаём, есть ли такой аккаунт). */
export const restoreStart = async (identifier) => {
  const row = await findByEmail(identifier);
  if (row) { const r = await sendCode(row, `restore:${row.id}`); if (r.error && r.error !== 'too_soon') console.error('[deletion] код восстановления:', r.error); }
  return { ok: true };
};
export const restoreFinish = async (identifier, proof, verifyTwoFactor, ip = '') => {
  const row = await findByEmail(identifier);
  if (!row) return { error: 'invalid_code' };
  const p = await prove(row, `restore:${row.id}`, proof, verifyTwoFactor);
  if (p.error) return p;
  await doCancel(row.id, null);
  await query(`INSERT INTO account_freeze_log (sky_id, kind, ip, detail) VALUES ($1,'deletion_restored',$2,'{}')`, [row.id, String(ip).slice(0, 100)]).catch(() => {});
  return { ok: true };
};

/** Для startSession: вход в удаляемый аккаунт закрыт (423). */
export const assertNotPendingDeletion = async (skyId) => {
  const row = await sky(skyId);
  if (row?.deletion_purge_at || row?.deleted_at) {
    throw Object.assign(new Error('account_deletion_pending'), { status: 423, purgeAt: row.deletion_purge_at?.toISOString?.() ?? null });
  }
};

/* ─── Окончательная очистка ───────────────────────────────────────── */

/** Таблицы с личными данными: [таблица, столбец]. Финансовые, договорные и журнальные сюда НЕ входят. */
export const PERSONAL = [
  ['ai_chats', 'profile_id'], ['ai_files', 'profile_id'], ['ai_messages', 'profile_id'], ['ai_usage', 'profile_id'],
  ['bloom_comment_likes', 'user_id'], ['bloom_comments', 'author_id'], ['bloom_hidden', 'user_id'], ['bloom_hidden', 'hidden_author_id'],
  ['bloom_poll_votes', 'user_id'], ['bloom_reactions', 'user_id'], ['bloom_reposts', 'user_id'], ['bloom_saves', 'user_id'], ['bloom_views', 'user_id'],
  ['blocks', 'blocker_id'], ['blocks', 'blocked_id'], ['blox_favorites', 'user_id'], ['blox_launches', 'user_id'], ['blox_reviews', 'user_id'],
  ['book_progress', 'user_id'], ['book_shelf', 'user_id'], ['bot_inline_pending', 'user_id'], ['bot_users', 'user_id'], ['bot_pairings', 'owner_id'],
  ['chat_bans', 'user_id'], ['chat_invites', 'created_by'], ['chat_join_requests', 'user_id'], ['chat_members', 'user_id'],
  ['customization_equipped', 'profile_id'], ['customization_purchase_attempts', 'profile_id'],
  ['film_progress', 'user_id'], ['film_ratings', 'user_id'], ['film_saved', 'user_id'],
  ['follows', 'follower_id'], ['follows', 'following_id'], ['friendships', 'a_id'], ['friendships', 'b_id'],
  ['game_prefs', 'user_id'], ['game_ratings', 'profile_id'], ['game_server_members', 'profile_id'], ['game_sessions', 'user_id'],
  ['go_cars', 'profile_id'], ['go_presence', 'profile_id'], ['go_places', 'owner_id'], ['go_pay_details', 'profile_id'],
  ['message_favorites', 'user_id'], ['message_reactions', 'user_id'], ['message_reads', 'user_id'], ['message_views', 'user_id'],
  ['music_artist_followers', 'follower_id'], ['music_favorites', 'user_id'], ['music_history', 'user_id'], ['music_playlists', 'owner_id'], ['music_progress', 'user_id'],
  ['notify_deliveries', 'profile_id'], ['podcast_favorites', 'user_id'], ['podcast_history', 'user_id'], ['podcast_progress', 'user_id'], ['podcast_subscriptions', 'user_id'],
  ['poll_votes', 'user_id'], ['profile_views', 'viewer_id'], ['profile_views', 'target_id'], ['push_subscriptions', 'profile_id'], ['quick_menu_settings', 'profile_id'],
  ['sky_video_likes', 'user_id'], ['sky_video_views', 'user_id'], ['story_close_friends', 'author_id'], ['story_close_friends', 'friend_id'],
  ['story_likes', 'user_id'], ['story_mentions', 'user_id'], ['story_poll_votes', 'user_id'], ['story_question_answers', 'user_id'], ['story_views', 'viewer_id'],
  ['ticket_favorites', 'user_id'], ['tv_favorites', 'user_id'], ['tv_recent', 'user_id'], ['market_favorites', 'user_id'],
  ['market_notifications', 'user_id'], ['garant_notifications', 'user_id'], ['logi_courier_notifications', 'user_id'], ['violation_notifications', 'user_id'],
  ['family_notifications', 'user_id'], ['family_invitations', 'recipient_id'], ['family_invitations', 'sender_id'], ['storage_shares', 'owner_id'], ['storage_shares', 'shared_with_id'],
  ['together_invitations', 'invitee_id'], ['together_invitations', 'inviter_id'], ['matchmaking_queue', 'profile_id'], ['live_stream_bans', 'profile_id'], ['voice_room_bans', 'profile_id'],
];

/** Контент автора — удаляется теми же функциями сервисов, что и кнопка «удалить» (они же убирают файлы). */
const purgeOwnedContent = async (pid) => {
  const run = async (label, ids, fn) => { for (const id of ids) { try { await fn(id); } catch (e) { console.error(`[deletion] ${label} ${id}:`, e.message); } } };
  const col = async (sql) => (await query(sql, [pid])).rows.map((r) => r.id);
  await run('track', await col(`SELECT id FROM music_tracks WHERE owner_id = $1`), (id) => deleteTrack(id, pid));
  await run('movie', await col(`SELECT id FROM film_movies WHERE owner_id = $1`), (id) => deleteMovie(id, pid));
  await run('book', await col(`SELECT id FROM books WHERE author_id = $1`), async (id) => {
    const r = await deleteBook(id, pid);
    if (r?.ok) { await removeBookFiles(id).catch(() => {}); for (const c of r.chapterIds ?? []) await removeChapterAudio(c).catch(() => {}); }
  });
  await run('video', await col(`SELECT id FROM sky_videos WHERE owner_id = $1`), (id) => deleteVideo(id, pid, 'аккаунт удалён'));
  await run('podcast', await col(`SELECT id FROM podcasts WHERE owner_id = $1`), (id) => deletePodcast(id, pid));
  await run('post', await col(`SELECT id FROM bloom_posts WHERE author_id = $1`), (id) => deletePost(id, pid));
  await run('story', await col(`SELECT id FROM stories WHERE author_id = $1`), (id) => deleteStory(id, pid));
  await run('bot', await col(`SELECT id FROM bots WHERE owner_id = $1`), (id) => deleteBot(id, pid));
};

const purgeProfile = async (pid) => {
  await purgeOwnedContent(pid);
  for (const [table, column] of PERSONAL) {
    // Имена из белого списка выше — не из запроса; ошибка одной таблицы не должна остановить остальные.
    await query(`DELETE FROM ${table} WHERE ${column} = $1`, [pid]).catch((e) => console.error(`[deletion] ${table}.${column}:`, e.message));
  }
  // Исполнители Sky GO, продавцы и т. п. хранят данные в своих таблицах — там остаются записи под псевдонимом (нужны для расчётов).
  const tag = `deleted-${crypto.createHash('sha256').update(pid).digest('hex').slice(0, 10)}`;
  await query(
    `UPDATE profiles SET username = $2, name = $3, avatar = NULL, bio = NULL, banner = NULL, profile_extra = '{}'::jsonb, profile_visibility = '{}'::jsonb,
            password_hash = NULL, two_factor_enabled = FALSE, two_factor_secret = NULL, is_admin = FALSE, admin_role = NULL, is_prime = FALSE,
            date_of_birth = NULL, region_code = NULL, moderation_note = '', deleted_at = now(), deletion_purge_at = NULL, updated_at = now()
      WHERE id = $1`, [pid, tag, 'Удалённый пользователь']);
  await query(`UPDATE prime_subscriptions SET status = 'cancelled' WHERE profile_id = $1 AND status = 'active'`, [pid]).catch(() => {});
};

const purgeOne = async (d) => {
  const ids = d.scope === 'profile' ? [d.profile_id] : (await query(`SELECT id FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL`, [d.sky_id])).rows.map((r) => r.id);
  for (const pid of ids) await purgeProfile(pid);
  if (d.scope === 'account') {
    await query(
      `UPDATE sky_ids SET phone = $2, email = NULL, email_verified = FALSE, phone_verified = FALSE, two_factor_enabled = FALSE, two_factor_secret = NULL,
              password_hash = NULL, ip_pin_hash = NULL, ip_pin_enabled = FALSE, freeze_token_hash = NULL, reg_ip_hash = NULL, deleted_at = now(), deletion_purge_at = NULL
        WHERE id = $1`, [d.sky_id, `deleted:${d.sky_id}`]);
    await sessionStore.revokeAllForUser(d.sky_id).catch((e) => console.error('[deletion] сессии:', e.message));
  }
  await query(`UPDATE account_deletion_manifests SET data_enc = '', purged_at = now() WHERE deletion_id = $1`, [d.id]);
  await query(`UPDATE account_deletions SET status = 'completed', completed_at = now() WHERE id = $1`, [d.id]);
};

/** Уборка: заявки, у которых срок вышел. Повторный запуск безопасен (статус меняется последним, очистка идемпотентна). */
export const purgeDue = async (limit = 5) => {
  const { rows } = await query(`SELECT * FROM account_deletions WHERE status = 'pending' AND purge_at <= now() ORDER BY purge_at LIMIT $1`, [limit]);
  let done = 0;
  for (const d of rows) {
    try { await purgeOne(d); done += 1; } catch (e) {
      console.error('[deletion] очистка не удалась:', d.id, e.message);
      await query(`UPDATE account_deletions SET error = $2 WHERE id = $1`, [d.id, String(e.message).slice(0, 200)]).catch(() => {});
    }
  }
  return done;
};

/* ─── Экспорт данных ──────────────────────────────────────────────── */

/** Выгрузка данных человека (JSON). Нужен код подтверждения. Секреты (пароль, токены, ключи) не выгружаются. */
export const exportData = async (skyId, proof, verifyTwoFactor) => {
  const row = await sky(skyId);
  if (!row || row.deleted_at) return { error: 'not_found' };
  const p = await prove(row, `export:${skyId}`, proof, verifyTwoFactor);
  if (p.error) return p;
  const ids = (await myProfiles(skyId)).filter((x) => !x.deleted_at).map((x) => x.id);
  const q = async (sql) => (await query(sql, [ids])).rows;
  const dec = (t) => { try { return decryptContent(t) ?? ''; } catch { return ''; } };
  const out = {
    exportedAt: new Date().toISOString(), format: 'sky-export-1',
    account: { skyId, email: row.email ?? null, phone: row.phone ?? null, twoFactor: Boolean(row.two_factor_enabled) },
    profiles: await q(`SELECT id, username, name, bio, created_at, profile_visibility, profile_extra FROM profiles WHERE id = ANY($1)`),
    wallet: await q(`SELECT user_id, balance, points FROM wallet_accounts WHERE user_id = ANY($1)`),
    walletTransactions: await q(`SELECT user_id, type, amount, descr, created_at FROM wallet_transactions WHERE user_id = ANY($1) ORDER BY created_at DESC LIMIT 5000`),
    subscriptions: await q(`SELECT profile_id, plan, status, expires_at FROM prime_subscriptions WHERE profile_id = ANY($1)`),
    music: {
      uploads: await q(`SELECT id, title, artist, album, status, created_at FROM music_tracks WHERE owner_id = ANY($1)`),
      favorites: await q(`SELECT user_id, track_id FROM music_favorites WHERE user_id = ANY($1)`),
      playlists: (await q(`SELECT id, owner_id, name FROM music_playlists WHERE owner_id = ANY($1)`)).map((r) => ({ ...r, name: dec(r.name) })),
    },
    film: { uploads: await q(`SELECT id, title, status, created_at FROM film_movies WHERE owner_id = ANY($1)`), saved: await q(`SELECT user_id, movie_id FROM film_saved WHERE user_id = ANY($1)`) },
    books: await q(`SELECT id, title, status, created_at FROM books WHERE author_id = ANY($1)`),
    social: { following: await q(`SELECT follower_id, following_id FROM follows WHERE follower_id = ANY($1)`), blocks: await q(`SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ANY($1)`) },
    posts: await q(`SELECT id, created_at FROM bloom_posts WHERE author_id = ANY($1)`),
    agreements: await q(`SELECT profile_id, doc_code, revision, accepted_at FROM sky_agreements WHERE profile_id = ANY($1)`).catch(() => []),
    notes: ['Сообщения и вложения чатов в выгрузку не входят — запросите их через поддержку.', 'Пароли, токены, ключи и секреты не выгружаются.'],
  };
  return { ok: true, data: out };
};

export const sendExportCode = async (skyId) => sendCode(await sky(skyId), `export:${skyId}`);
