/**
 * Sky Skin Market — косметика для питомцев: скины/наряды/головные
 * уборы/аксессуары/ауры/эффекты/анимации/фоны/следы/эмоции.
 *
 * Самое чувствительное место — покупка Limited-предмета: номер
 * экземпляра выдаёт только атомарный UPDATE с условием в WHERE
 * (`issued_count < supply`), а не «прочитать остаток, проверить в
 * JS, записать» — вторая схема ровно и есть классическая гонка,
 * из-за которой два одновременных покупателя оба получили бы
 * последний экземпляр. Здесь Postgres сам сериализует конкурентные
 * UPDATE одной строки: кто вторым дойдёт до условия — увидит уже
 * не прошедшее WHERE и получит 0 обновлённых строк, а не чужой номер.
 *
 * Оплата (Pet Coins или Sky Money) списывается уже ПОСЛЕ успешной
 * резервации отдельной транзакцией через существующие кошельки
 * (petEconomy.spendCoins / server/wallet.mjs) — если списание не
 * удалось, резервация компенсируется обратным декрементом, а не
 * оставляется висеть наполовину.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { spendCoins, earnCoins, trackMetric } from './petEconomy.mjs';
import { wallet } from './wallet.mjs';
import { listStoredIds, remove as removeMedia } from './skinstore.mjs';

export const ITEM_TYPES = ['skin', 'outfit', 'headwear', 'accessory', 'aura', 'effect', 'animation', 'background', 'trail', 'emote'];
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];
export const AVAILABILITIES = ['unlimited', 'limited', 'event', 'exclusive'];
export const MEDIA_ID_RE = /^skm-[0-9a-f-]{36}$/;
export const ITEM_ID_RE = /^ski-[0-9a-f-]{36}$/;

const SINGLE_SLOTS = ['skin', 'outfit', 'headwear', 'aura', 'effect', 'trail'];
const MULTI_SLOTS = ['accessory', 'emote'];

const toItemView = (r, ownedRow) => ({
  id: r.id, name: r.name, description: r.description, itemType: r.item_type,
  petTypeId: r.pet_type_id, rarity: r.rarity, availability: r.availability,
  supply: r.supply, remaining: r.supply === null ? null : Math.max(0, r.supply - r.issued_count),
  soldOut: r.supply !== null && r.issued_count >= r.supply,
  pricePetCoins: r.price_pet_coins, priceSkyMoneyKopecks: r.price_sky_money_kopecks,
  collectionId: r.collection_id, eventId: r.event_id,
  previewUrl: r.preview_media_id ? `/api/pets/market/media/${r.preview_media_id}` : undefined,
  modelUrl: r.model_media_id ? `/api/pets/market/media/${r.model_media_id}` : undefined,
  animations: r.animations, effects: r.effects, releasedAt: r.released_at, status: r.status,
  owned: !!ownedRow, instanceNumber: ownedRow?.instance_number ?? undefined,
});

export const listItems = async (profileId, { q, itemType, rarity, availability, petTypeId, sort } = {}) => {
  const clauses = [`status = 'active'`];
  const params = [];
  if (q) { params.push(`%${String(q).slice(0, 60)}%`); clauses.push(`name ILIKE $${params.length}`); }
  if (itemType && ITEM_TYPES.includes(itemType)) { params.push(itemType); clauses.push(`item_type = $${params.length}`); }
  if (rarity && RARITIES.includes(rarity)) { params.push(rarity); clauses.push(`rarity = $${params.length}`); }
  if (availability && AVAILABILITIES.includes(availability)) { params.push(availability); clauses.push(`availability = $${params.length}`); }
  if (petTypeId) { params.push(petTypeId); clauses.push(`(pet_type_id = $${params.length} OR pet_type_id IS NULL)`); }

  const order = sort === 'trending' ? 'issued_count DESC' : sort === 'new' ? 'released_at DESC' : 'released_at DESC';
  const { rows } = await query(`SELECT * FROM skin_items WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT 100`, params);

  const { rows: owned } = await query('SELECT item_id, instance_number FROM skin_inventory WHERE profile_id = $1', [profileId]);
  const ownedById = new Map(owned.map((o) => [o.item_id, o]));
  return rows.map((r) => toItemView(r, ownedById.get(r.id)));
};

export const getItem = async (profileId, itemId) => {
  const { rows } = await query('SELECT * FROM skin_items WHERE id = $1', [itemId]);
  if (!rows[0]) return null;
  const { rows: owned } = await query('SELECT instance_number FROM skin_inventory WHERE profile_id = $1 AND item_id = $2', [profileId, itemId]);
  return toItemView(rows[0], owned[0]);
};

/** Атомарная резервация экземпляра для Limited — единственное место,
 *  где увеличивается issued_count. Для unlimited/event/exclusive без
 *  supply просто ничего не резервирует и возвращает instanceNumber=null. */
const reserveInstance = async (itemId) => {
  const { rows } = await query(
    `UPDATE skin_items SET issued_count = issued_count + 1, updated_at = now()
      WHERE id = $1 AND status = 'active' AND (supply IS NULL OR issued_count < supply)
     RETURNING issued_count, supply`,
    [itemId],
  );
  if (!rows.length) return { error: 'unavailable' };
  return { instanceNumber: rows[0].supply === null ? null : rows[0].issued_count };
};

const releaseInstance = (itemId) =>
  query('UPDATE skin_items SET issued_count = GREATEST(0, issued_count - 1), updated_at = now() WHERE id = $1', [itemId]);

/**
 * Покупка. `idempotencyKey` обязателен — без него повторно отправленный
 * (двойной клик, повтор сети) запрос списал бы валюту дважды.
 */
export const purchaseItem = async (profileId, itemId, { idempotencyKey, currency } = {}) => {
  const key = String(idempotencyKey ?? '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return { error: 'bad_idempotency_key' };

  const { rows: prior } = await query(
    'SELECT status, result FROM skin_purchase_attempts WHERE idempotency_key = $1 AND profile_id = $2',
    [key, profileId],
  );
  if (prior.length) return prior[0].result;

  const record = async (status, result) => {
    try {
      await query(
        `INSERT INTO skin_purchase_attempts (idempotency_key, profile_id, item_id, status, result)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [key, profileId, itemId, status, JSON.stringify(result)],
      );
    } catch (err) {
      // Гонка на тот же idempotency_key: кто-то другой (тот же клиент,
      // повторный запрос) уже записал результат — отдать его, а не
      // затирать чужую запись.
      if (err.code === '23505') {
        const { rows } = await query('SELECT result FROM skin_purchase_attempts WHERE idempotency_key = $1', [key]);
        return rows[0]?.result ?? result;
      }
      throw err;
    }
    return result;
  };

  const { rows: itemRows } = await query('SELECT * FROM skin_items WHERE id = $1', [itemId]);
  const item = itemRows[0];
  if (!item || item.status !== 'active') return record('error', { error: 'not_found' });

  const { rows: alreadyOwned } = await query('SELECT 1 FROM skin_inventory WHERE profile_id = $1 AND item_id = $2', [profileId, itemId]);
  if (alreadyOwned.length) return record('error', { error: 'already_owned' });

  // Цену и валюту решает СЕРВЕР по товару — тело запроса только выбирает
  // ХОТЯ БЫ ОДНУ из поддерживаемых для этого товара валют.
  const useMoney = currency === 'sky_money' && item.price_sky_money_kopecks !== null;
  const useCoins = !useMoney && item.price_pet_coins !== null;
  if (!useMoney && !useCoins) return record('error', { error: 'bad_currency' });

  const reserved = await reserveInstance(itemId);
  if (reserved.error) return record('error', { error: 'sold_out' });

  const chargeRef = `skin:${itemId}`;
  const charge = useMoney
    ? await wallet.spend(profileId, item.price_sky_money_kopecks, 'skin_purchase', `Скин «${item.name}»`, chargeRef)
    : await spendCoins(profileId, item.price_pet_coins, 'spend_market', `Скин «${item.name}»`, chargeRef, key);
  if (charge.error) {
    await releaseInstance(itemId);
    return record('error', charge);
  }

  const invId = `sinv-${generateId()}`;
  try {
    await query(
      `INSERT INTO skin_inventory (id, profile_id, item_id, instance_number, acquired_via)
       VALUES ($1,$2,$3,$4,'purchase')`,
      [invId, profileId, itemId, reserved.instanceNumber],
    );
  } catch (err) {
    if (err.code !== '23505') throw err;
    // Гонка по (profile_id, item_id): тот же пользователь купил тем же
    // ключом почти одновременно с другой вкладки — вернуть уплаченное
    // и освободить зарезервированный номер, отдать already_owned.
    if (useMoney) await wallet.credit(profileId, item.price_sky_money_kopecks, 'skin_purchase_refund', 'Возврат: уже куплено', chargeRef);
    else await earnCoins(profileId, item.price_pet_coins, 'refund', 'Возврат: уже куплено', chargeRef);
    await releaseInstance(itemId);
    return record('error', { error: 'already_owned' });
  }

  await query(
    `INSERT INTO skin_transactions (id, item_id, buyer_id, price_pet_coins, price_sky_money_kopecks, kind)
     VALUES ($1,$2,$3,$4,$5,'primary_purchase')`,
    [`sktx-${generateId()}`, itemId, profileId, useCoins ? item.price_pet_coins : 0, useMoney ? item.price_sky_money_kopecks : 0],
  );
  await query(
    `INSERT INTO skin_ownership_history (id, item_id, instance_number, to_profile_id, reason)
     VALUES ($1,$2,$3,$4,'purchase')`,
    [`soh-${generateId()}`, itemId, reserved.instanceNumber, profileId],
  );

  const { rows: countRows } = await query('SELECT COUNT(*)::int AS n FROM skin_inventory WHERE profile_id = $1', [profileId]);
  await trackMetric(profileId, 'skins_owned', countRows[0].n, { max: true });

  return record('ok', { ok: true, itemId, instanceNumber: reserved.instanceNumber });
};

/* ─── Инвентарь / экипировка ─────────────────────────────────────────── */

export const getMySkins = async (profileId) => {
  const { rows } = await query(
    `SELECT si.*, s.name, s.item_type, s.rarity, s.availability, s.supply,
            s.preview_media_id, s.model_media_id, s.animations, s.effects, s.pet_type_id
       FROM skin_inventory si JOIN skin_items s ON s.id = si.item_id
      WHERE si.profile_id = $1 ORDER BY si.acquired_at DESC`,
    [profileId],
  );
  return rows.map((r) => ({
    inventoryId: r.id, itemId: r.item_id, name: r.name, itemType: r.item_type, rarity: r.rarity,
    availability: r.availability, instanceNumber: r.instance_number, supply: r.supply,
    petTypeId: r.pet_type_id,
    previewUrl: r.preview_media_id ? `/api/pets/market/media/${r.preview_media_id}` : undefined,
    modelUrl: r.model_media_id ? `/api/pets/market/media/${r.model_media_id}` : undefined,
    animations: r.animations, effects: r.effects, acquiredVia: r.acquired_via, acquiredAt: r.acquired_at,
  }));
};

const getConfigNumber = async (key, fallback) => {
  const { rows } = await query('SELECT value FROM pet_config WHERE key = $1', [key]);
  return Number(rows[0]?.value ?? fallback);
};

/** Экипировать предмет на своего питомца — сервер проверяет и владение
 *  предметом, и владение питомцем, и что предмет подходит виду питомца. */
export const equipItem = async (profileId, petId, itemId, position) => {
  const { rows: petRows } = await query('SELECT id, type_id FROM pets WHERE id = $1 AND profile_id = $2', [petId, profileId]);
  if (!petRows[0]) return { error: 'pet_not_found' };

  const { rows: ownRows } = await query(
    `SELECT si.instance_number, s.item_type, s.pet_type_id
       FROM skin_inventory si JOIN skin_items s ON s.id = si.item_id
      WHERE si.profile_id = $1 AND si.item_id = $2`,
    [profileId, itemId],
  );
  const owned = ownRows[0];
  if (!owned) return { error: 'not_owned' };
  if (owned.pet_type_id && owned.pet_type_id !== petRows[0].type_id) return { error: 'wrong_pet_type' };

  const slot = owned.item_type;
  if (SINGLE_SLOTS.includes(slot)) {
    await query(
      `INSERT INTO skin_equipment (pet_id, slot, item_id) VALUES ($1,$2,$3)
       ON CONFLICT (pet_id, slot) DO UPDATE SET item_id = $3, equipped_at = now()`,
      [petId, slot, itemId],
    );
  } else if (MULTI_SLOTS.includes(slot)) {
    const maxSlots = await getConfigNumber(slot === 'accessory' ? 'accessory_slots' : 'emote_slots', 3);
    const pos = Math.max(0, Math.min(maxSlots - 1, Math.trunc(Number(position) || 0)));
    await query(
      `INSERT INTO skin_equipment_multi (pet_id, slot, position, item_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (pet_id, slot, position) DO UPDATE SET item_id = $4, equipped_at = now()`,
      [petId, slot, pos, itemId],
    );
  } else {
    return { error: 'bad_slot' };
  }
  await trackMetric(profileId, `equip_${slot}`, 1);
  return { ok: true };
};

export const unequipSlot = async (profileId, petId, slot, position) => {
  const { rows: petRows } = await query('SELECT id FROM pets WHERE id = $1 AND profile_id = $2', [petId, profileId]);
  if (!petRows[0]) return { error: 'pet_not_found' };
  if (SINGLE_SLOTS.includes(slot)) {
    await query('DELETE FROM skin_equipment WHERE pet_id = $1 AND slot = $2', [petId, slot]);
  } else if (MULTI_SLOTS.includes(slot)) {
    await query('DELETE FROM skin_equipment_multi WHERE pet_id = $1 AND slot = $2 AND position = $3', [petId, slot, Math.trunc(Number(position) || 0)]);
  } else {
    return { error: 'bad_slot' };
  }
  return { ok: true };
};

export const getEquipment = async (petId) => {
  const { rows: single } = await query('SELECT slot, item_id FROM skin_equipment WHERE pet_id = $1', [petId]);
  const { rows: multi } = await query('SELECT slot, position, item_id FROM skin_equipment_multi WHERE pet_id = $1 ORDER BY position', [petId]);
  return {
    single: Object.fromEntries(single.map((r) => [r.slot, r.item_id])),
    multi: multi.reduce((acc, r) => { (acc[r.slot] ??= []).push({ position: r.position, itemId: r.item_id }); return acc; }, {}),
  };
};

/* ─── Заготовка вторичного P2P-рынка (создание/отмена листинга — без
   покупки: включать торговлю целиком сейчас не просят) ──────────────── */

export const createListing = async (profileId, inventoryId, pricePetCoins) => {
  const price = Math.trunc(Number(pricePetCoins));
  if (!Number.isSafeInteger(price) || price <= 0) return { error: 'bad_price' };
  const { rows } = await query('SELECT id FROM skin_inventory WHERE id = $1 AND profile_id = $2', [inventoryId, profileId]);
  if (!rows[0]) return { error: 'not_owned' };
  try {
    const id = `skl-${generateId()}`;
    await query('INSERT INTO skin_listings (id, seller_id, inventory_id, price_pet_coins) VALUES ($1,$2,$3,$4)', [id, profileId, inventoryId, price]);
    return { id };
  } catch (err) {
    if (err.code === '23505') return { error: 'already_listed' };
    throw err;
  }
};

export const cancelListing = async (profileId, listingId) => {
  const { rows } = await query(
    `UPDATE skin_listings SET status = 'cancelled', decided_at = now()
      WHERE id = $1 AND seller_id = $2 AND status = 'active' RETURNING id`,
    [listingId, profileId],
  );
  if (!rows.length) return { error: 'not_found' };
  return { ok: true };
};

/* ─── Медиа ──────────────────────────────────────────────────────────── */

export const mediaMimeOf = async (mediaId) => {
  const { rows } = await query(
    `SELECT preview_mime AS mime FROM skin_items WHERE preview_media_id = $1
     UNION ALL SELECT model_mime AS mime FROM skin_items WHERE model_media_id = $1 LIMIT 1`,
    [mediaId],
  );
  return rows[0]?.mime ?? null;
};

/* ─── Админка ────────────────────────────────────────────────────────── */

export const adminListItems = async (actorId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT * FROM skin_items ORDER BY created_at DESC LIMIT 300');
  return { items: rows.map((r) => toItemView(r, null)) };
};

export const adminCreateItem = async (actorId, body) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const name = String(body?.name ?? '').trim().slice(0, 60);
  const itemType = ITEM_TYPES.includes(body?.itemType) ? body.itemType : null;
  const rarity = RARITIES.includes(body?.rarity) ? body.rarity : null;
  const availability = AVAILABILITIES.includes(body?.availability) ? body.availability : null;
  if (!name || !itemType || !rarity || !availability) return { error: 'bad_input' };

  const supply = availability === 'limited' ? Math.max(1, Math.trunc(Number(body?.supply) || 0)) : null;
  if (availability === 'limited' && !supply) return { error: 'bad_supply' };

  const priceCoins = body?.pricePetCoins != null ? Math.max(0, Math.trunc(Number(body.pricePetCoins))) : null;
  const priceMoney = body?.priceSkyMoneyKopecks != null ? Math.max(0, Math.trunc(Number(body.priceSkyMoneyKopecks))) : null;
  if (priceCoins === null && priceMoney === null) return { error: 'bad_price' };

  const id = `ski-${generateId()}`;
  await query(
    `INSERT INTO skin_items
       (id, name, description, item_type, pet_type_id, rarity, availability, supply,
        price_pet_coins, price_sky_money_kopecks, collection_id, event_id,
        preview_media_id, preview_mime, model_media_id, model_mime, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, name, String(body?.description ?? '').slice(0, 500), itemType,
      body?.petTypeId || null, rarity, availability, supply,
      priceCoins, priceMoney, body?.collectionId || null, body?.eventId || null,
      body?.previewMediaId || null, body?.previewMime || null, body?.modelMediaId || null, body?.modelMime || null, actorId],
  );
  return { id };
};

/** Цену/supply можно менять только ДО первой продажи — это не бюрократия,
 *  а сама защита: изменить условия сделки задним числом для тех, кто уже
 *  купил, нельзя в принципе, поэтому опасное «изменение цены/supply» из
 *  брифа здесь структурно невозможно, а не просто требует лишнего клика. */
export const adminUpdateItem = async (actorId, itemId, patch) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT issued_count FROM skin_items WHERE id = $1', [itemId]);
  if (!rows[0]) return { error: 'not_found' };
  const locked = rows[0].issued_count > 0;

  const sets = [];
  const params = [itemId];
  const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (patch.name !== undefined) push('name', String(patch.name).slice(0, 60));
  if (patch.description !== undefined) push('description', String(patch.description).slice(0, 500));
  if (!locked && patch.pricePetCoins !== undefined) push('price_pet_coins', patch.pricePetCoins === null ? null : Math.max(0, Math.trunc(Number(patch.pricePetCoins))));
  if (!locked && patch.priceSkyMoneyKopecks !== undefined) push('price_sky_money_kopecks', patch.priceSkyMoneyKopecks === null ? null : Math.max(0, Math.trunc(Number(patch.priceSkyMoneyKopecks))));
  if (!locked && patch.supply !== undefined) push('supply', Math.max(1, Math.trunc(Number(patch.supply))));
  if (sets.length === 0) return { error: 'nothing_to_update', locked };

  await query(`UPDATE skin_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  return { ok: true, locked };
};

/**
 * Превью-картинка предмета — отдельно от остальных полей, потому что
 * приходит не JSON-телом, а байтами файла (routes/pets.mjs). Старый
 * файл стираем сразу: файлы, на которые никто больше не ссылается,
 * не должны накапливаться на диске.
 */
export const adminSetItemPreview = async (actorId, itemId, mediaId, mime) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query('SELECT preview_media_id FROM skin_items WHERE id = $1', [itemId]);
  if (!rows[0]) return { error: 'not_found' };
  const old = rows[0].preview_media_id;
  await query(
    `UPDATE skin_items SET preview_media_id = $2, preview_mime = $3, updated_at = now() WHERE id = $1`,
    [itemId, mediaId, mime]);
  if (old && old !== mediaId) await removeMedia(old);
  return { ok: true };
};

/** «Удаление» — это retire: у уже купивших предмет остаётся, просто
 *  пропадает из витрины и больше не продаётся. */
export const adminRetireItem = async (actorId, itemId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  await query(`UPDATE skin_items SET status = 'retired', updated_at = now() WHERE id = $1`, [itemId]);
  return { ok: true };
};

/** Файлы на диске без строки-владельца (превью/модель) в skin_items —
 *  та же сверка диск/база, что и в stories.mjs/bloom.mjs. */
export const sweepOrphanSkinMedia = async () => {
  const stored = await listStoredIds();
  if (!stored.length) return { removed: 0 };
  const { rows } = await query(
    `SELECT preview_media_id AS id FROM skin_items WHERE preview_media_id = ANY($1::text[])
     UNION SELECT model_media_id AS id FROM skin_items WHERE model_media_id = ANY($1::text[])`,
    [stored],
  );
  const used = new Set(rows.map((r) => r.id));
  const orphans = stored.filter((id) => !used.has(id));
  for (const id of orphans) await removeMedia(id);
  return { removed: orphans.length };
};

export const adminItemSales = async (actorId, itemId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const { rows } = await query(
    `SELECT si.instance_number, si.acquired_via, si.acquired_at, p.username, p.name
       FROM skin_inventory si JOIN profiles p ON p.id = si.profile_id
      WHERE si.item_id = $1 ORDER BY si.acquired_at DESC LIMIT 500`,
    [itemId],
  );
  return { owners: rows.map((r) => ({ username: r.username, name: r.name, instanceNumber: r.instance_number, acquiredVia: r.acquired_via, acquiredAt: r.acquired_at })) };
};
