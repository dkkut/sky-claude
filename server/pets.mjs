/**
 * Sky Pets — питомец профиля и рынок скинов.
 *
 * Один питомец на профиль (заводится сам при первом обращении, без
 * отдельного «создать»). Владение скином — из wallet.spendPoints,
 * тем же способом, что подарки Bloom (server/bloom.mjs::sendGift):
 * баллы списываются, потом выдаётся строка в user_pet_skins, а гонку
 * двух одновременных покупок одного скина останавливает уникальный
 * индекс (profile_id, skin_id) — вторая попытка просто возвращает
 * деньги и «уже куплено», а не выдаёт скин дважды.
 *
 * Владелец питомца/скина — всегда profileId из серверной сессии,
 * никогда из тела запроса.
 */
import { query, pool } from './db.mjs';
import { generateId, rateLimit } from './security.mjs';
import { wallet } from './wallet.mjs';
import { remove as removeMedia } from './petsstore.mjs';
import { can } from './admin.mjs';

export const MEDIA_ID_RE = /^pts-[0-9a-f-]{36}$/;
export const SKIN_ID_RE = /^pks-[0-9a-f-]{36}$/;

export const PET_TYPES = ['dragon', 'cat', 'robot', 'phoenix'];
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const MAX_NAME_CHARS = 32;
/** Взаимодействие раз в несколько минут — не бесконечный фарм опыта кликами. */
const INTERACT_COOLDOWN_PER_HOUR = 20;
const XP_PER_ACTION = { feed: 5, play: 10 };

const clean = (v, max) => String(v ?? '')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
  .trim()
  .slice(0, max);

const newPetId = () => `pet-${generateId()}`;
const newSkinId = () => `pks-${generateId()}`;
const newOwnershipId = () => `ups-${generateId()}`;

/** Уровень — из накопленного опыта, а не отдельное поле, которое можно рассинхронизировать. */
const levelFor = (experience) => Math.max(1, Math.floor(experience / 100) + 1);

const petView = (row, ownedSkins = []) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  level: levelFor(row.experience),
  experience: row.experience,
  activeSkinId: row.active_skin_id,
  state: row.state,
  createdAt: row.created_at.toISOString(),
  ownedSkinIds: ownedSkins,
});

const skinView = (row, ownedIds) => ({
  id: row.id,
  petType: row.pet_type,
  name: row.name,
  description: row.description,
  rarity: row.rarity,
  price: row.price_points,
  previewUrl: row.preview_media_id ? `/api/pets/media/${row.preview_media_id}` : undefined,
  modelUrl: row.model_media_id ? `/api/pets/media/${row.model_media_id}` : undefined,
  animations: row.animations ?? [],
  effects: row.effects ?? [],
  status: row.status,
  owned: ownedIds ? ownedIds.has(row.id) : undefined,
});

/** Свой ли питомец заводится сам — здесь нет отдельного «создать». */
export const getOrCreatePet = async (profileId, wantedType) => {
  const { rows } = await query('SELECT * FROM pets WHERE profile_id = $1', [profileId]);
  if (rows[0]) return hydratePet(rows[0]);

  const type = PET_TYPES.includes(wantedType) ? wantedType : PET_TYPES[0];
  const id = newPetId();
  await query(
    `INSERT INTO pets (id, profile_id, type) VALUES ($1,$2,$3)
     ON CONFLICT (profile_id) DO NOTHING`,
    [id, profileId, type],
  );
  const { rows: made } = await query('SELECT * FROM pets WHERE profile_id = $1', [profileId]);
  return hydratePet(made[0]);
};

const hydratePet = async (row) => {
  const { rows } = await query('SELECT skin_id FROM user_pet_skins WHERE profile_id = $1', [row.profile_id]);
  return petView(row, rows.map((r) => r.skin_id));
};

export const renamePet = async (profileId, name) => {
  const clean_ = clean(name, MAX_NAME_CHARS);
  if (!clean_) return { error: 'invalid_name' };
  const { rows } = await query(
    'UPDATE pets SET name = $2, updated_at = now() WHERE profile_id = $1 RETURNING *',
    [profileId, clean_],
  );
  if (!rows[0]) return { error: 'not_found' };
  return { pet: await hydratePet(rows[0]) };
};

/** Сменить вид питомца — уровень/опыт остаются на профиле, скин
 * сбрасывается: скины привязаны к виду, чужой не налезет. */
export const changeType = async (profileId, type) => {
  if (!PET_TYPES.includes(type)) return { error: 'unknown_type' };
  const { rows } = await query(
    `UPDATE pets SET type = $2, active_skin_id = NULL, updated_at = now()
      WHERE profile_id = $1 RETURNING *`,
    [profileId, type],
  );
  if (!rows[0]) return { error: 'not_found' };
  return { pet: await hydratePet(rows[0]) };
};

/** Погладить/покормить — небольшой опыт, с пределом в час, чтобы не фармили кликами. */
export const interact = async (profileId, action) => {
  if (!XP_PER_ACTION[action]) return { error: 'unknown_action' };
  if (!rateLimit(`pets:interact:${profileId}`, INTERACT_COOLDOWN_PER_HOUR)) return { error: 'rate_limited' };

  const { rows } = await query(
    `UPDATE pets SET experience = experience + $2, state = 'happy', updated_at = now()
      WHERE profile_id = $1 RETURNING *`,
    [profileId, XP_PER_ACTION[action]],
  );
  if (!rows[0]) return { error: 'not_found' };
  return { pet: await hydratePet(rows[0]) };
};

/** Сменить активный скин — только из уже купленных и только для своего типа питомца. */
export const setActiveSkin = async (profileId, skinId) => {
  const { rows: petRows } = await query('SELECT * FROM pets WHERE profile_id = $1', [profileId]);
  const pet = petRows[0];
  if (!pet) return { error: 'not_found' };

  const { rows: ownRows } = await query(
    `SELECT s.id, s.pet_type FROM user_pet_skins u
       JOIN pet_skins s ON s.id = u.skin_id
      WHERE u.profile_id = $1 AND u.skin_id = $2`,
    [profileId, skinId],
  );
  const owned = ownRows[0];
  if (!owned) return { error: 'not_owned' };
  if (owned.pet_type !== pet.type) return { error: 'wrong_pet_type' };

  const { rows } = await query(
    'UPDATE pets SET active_skin_id = $2, updated_at = now() WHERE profile_id = $1 RETURNING *',
    [profileId, skinId],
  );
  return { pet: await hydratePet(rows[0]) };
};

/* ── Рынок скинов ───────────────────────────────────────────────── */

export const listSkins = async (viewerId, { q, rarity, petType } = {}) => {
  const conds = ["status = 'active'"];
  const params = [];
  if (petType && PET_TYPES.includes(petType)) { params.push(petType); conds.push(`pet_type = $${params.length}`); }
  if (rarity && RARITIES.includes(rarity)) { params.push(rarity); conds.push(`rarity = $${params.length}`); }
  if (q) { params.push(`%${clean(q, 60).toLowerCase()}%`); conds.push(`lower(name) LIKE $${params.length}`); }

  const { rows } = await query(
    `SELECT * FROM pet_skins WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
    params,
  );
  const { rows: owned } = await query('SELECT skin_id FROM user_pet_skins WHERE profile_id = $1', [viewerId]);
  const ownedIds = new Set(owned.map((r) => r.skin_id));
  return rows.map((r) => skinView(r, ownedIds));
};

export const getSkin = async (skinId, viewerId) => {
  const { rows } = await query("SELECT * FROM pet_skins WHERE id = $1 AND status = 'active'", [skinId]);
  if (!rows[0]) return null;
  const { rows: owned } = await query(
    'SELECT 1 FROM user_pet_skins WHERE profile_id = $1 AND skin_id = $2', [viewerId, skinId],
  );
  return skinView(rows[0], new Set(owned.length ? [skinId] : []));
};

/**
 * Покупка. Порядок: право (скин существует и активен) → деньги
 * (spendPoints) → выдача (INSERT с уникальным индексом). Гонка из двух
 * одновременных запросов на один и тот же скин не выдаёт его дважды:
 * вторую попытку остановит уникальный индекс, и деньги за неё
 * вернутся, а не пропадут.
 */
export const purchaseSkin = async (profileId, skinId) => {
  if (!SKIN_ID_RE.test(String(skinId ?? ''))) return { error: 'not_found' };
  const { rows } = await query("SELECT * FROM pet_skins WHERE id = $1 AND status = 'active'", [skinId]);
  const skin = rows[0];
  if (!skin) return { error: 'not_found' };

  const already = await query(
    'SELECT 1 FROM user_pet_skins WHERE profile_id = $1 AND skin_id = $2', [profileId, skinId],
  );
  if (already.rows.length) return { error: 'already_owned' };

  const price = Number(skin.price_points) || 0;
  if (price > 0) {
    const paid = await wallet.spendPoints(profileId, price, `Скин питомца: ${skin.name}`, skinId);
    if (paid.error) return { error: paid.error };
  }

  const id = newOwnershipId();
  try {
    await query(
      `INSERT INTO user_pet_skins (id, profile_id, skin_id, acquisition_source, purchase_ref)
       VALUES ($1,$2,$3,'purchase',$4)`,
      [id, profileId, skinId, id],
    );
  } catch (err) {
    if (err?.code === '23505') {
      // Кто-то купил тот же скин на долю секунды раньше — деньги назад,
      // скин повторно не выдаём.
      if (price > 0) {
        await wallet.creditPoints(profileId, price, 'pet_skin_refund', `Возврат: уже куплено — ${skin.name}`, skinId)
          .catch(() => {});
      }
      return { error: 'already_owned' };
    }
    throw err;
  }
  return { ok: true, skinId };
};

/* ── Админка каталога ──────────────────────────────────────────────
   Право проверяется здесь же: у pets.mjs нет других вызывающих, но
   проверка права рядом с самим изменением — тот же принцип, что и у
   setPostRegions в bloom.mjs. */

export const adminCreateSkin = async (actorId, body) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const petType = PET_TYPES.includes(body?.petType) ? body.petType : null;
  const name = clean(body?.name, 60);
  if (!petType || !name) return { error: 'invalid_input' };
  const rarity = RARITIES.includes(body?.rarity) ? body.rarity : 'common';
  const price = Number.isSafeInteger(body?.price) && body.price >= 0 ? body.price : 0;
  const previewMediaId = body?.previewMediaId && MEDIA_ID_RE.test(body.previewMediaId) ? body.previewMediaId : null;
  const modelMediaId = body?.modelMediaId && MEDIA_ID_RE.test(body.modelMediaId) ? body.modelMediaId : null;

  const id = newSkinId();
  await query(
    `INSERT INTO pet_skins (id, pet_type, name, description, rarity, price_points,
                            preview_media_id, preview_mime, model_media_id, model_mime)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, petType, name, clean(body?.description, 500), rarity, price,
     previewMediaId, previewMediaId ? clean(body?.previewMime, 100) : null,
     modelMediaId, modelMediaId ? clean(body?.modelMime, 100) : null],
  );
  return { id };
};

/** Все скины, включая снятые с продажи — для управления в админке. */
export const adminListSkins = async (actorId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM pet_skins ORDER BY created_at DESC LIMIT 500');
  return { items: rows.map((r) => skinView(r)) };
};

export const adminRetireSkin = async (actorId, skinId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rowCount } = await query("UPDATE pet_skins SET status = 'retired', updated_at = now() WHERE id = $1", [skinId]);
  if (!rowCount) return { error: 'not_found' };
  return { ok: true };
};

/** MIME по id уже сохранённого медиа — для раздачи файла (Content-Type). */
export const mediaMimeOf = async (mediaId) => {
  const { rows } = await query(
    `SELECT preview_mime AS mime FROM pet_skins WHERE preview_media_id = $1
     UNION SELECT model_mime AS mime FROM pet_skins WHERE model_media_id = $1
     LIMIT 1`,
    [mediaId],
  );
  return rows[0]?.mime ?? null;
};

export const sweepOrphanPetMedia = async () => {
  const { listStoredIds } = await import('./petsstore.mjs');
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const { rows } = await query(
    `SELECT preview_media_id AS id FROM pet_skins WHERE preview_media_id = ANY($1::text[])
     UNION SELECT model_media_id AS id FROM pet_skins WHERE model_media_id = ANY($1::text[])`,
    [stored],
  );
  const used = new Set(rows.map((r) => r.id));
  const orphans = stored.filter((id) => !used.has(id));
  for (const id of orphans) await removeMedia(id);
  return { removed: orphans.length };
};

export { pool };
