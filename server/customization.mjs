/**
 * Маркет кастомизации — покупка рамок/баннеров чата/тем профиля/
 * оформления списка чатов за баллы (server/wallet.mjs).
 *
 * Внешний вид предметов остаётся кодом на клиенте
 * (src/customization/catalog/*.ts) — здесь только цена и факт
 * владения, то, что должно быть источником правды на сервере, а не
 * в localStorage браузера, как было раньше.
 *
 * Предметы без строки в customization_catalog (бесплатные по
 * умолчанию, выдаваемые по Prime/business/admin/стажу/сезону) сюда не
 * заходят вовсе — их разблокировку по-прежнему считает клиент по
 * флагам аккаунта по ровно тем же правилам, что были до этой правки.
 * Контроль сервера начинается там, где начинаются настоящие деньги —
 * у 39 предметов с ценой. Экипировка таких предметов не требует записи
 * в инвентаре — она и раньше ничего не проверяла, это не регресс.
 */
import { query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';

export const CATEGORIES = ['frame', 'banner', 'profileTheme', 'chatListStyle'];
export const ITEM_ID_RE = /^[a-z0-9-]{3,60}$/;

const toCatalogItem = (r) => ({
  id: r.id, category: r.category, pricePoints: Number(r.price_points),
});

/** Каталог покупных предметов — только цена, не внешний вид. */
export const listCatalog = async () => {
  const { rows } = await query(
    `SELECT id, category, price_points FROM customization_catalog WHERE active ORDER BY category, price_points`,
  );
  return rows.map(toCatalogItem);
};

/** Чем владеет профиль из покупного каталога. */
export const myInventory = async (profileId) => {
  const { rows } = await query(
    `SELECT item_id, acquired_via, acquired_at FROM customization_inventory WHERE profile_id = $1`,
    [profileId],
  );
  return rows.map((r) => ({ itemId: r.item_id, acquiredVia: r.acquired_via, acquiredAt: r.acquired_at }));
};

/** Что сейчас надето, по категориям. */
export const myEquipped = async (profileId) => {
  const { rows } = await query(
    `SELECT category, item_id FROM customization_equipped WHERE profile_id = $1`,
    [profileId],
  );
  return Object.fromEntries(rows.map((r) => [r.category, r.item_id]));
};

const ownsItem = async (profileId, itemId) => {
  const { rowCount } = await query(
    'SELECT 1 FROM customization_inventory WHERE profile_id = $1 AND item_id = $2', [profileId, itemId],
  );
  return rowCount > 0;
};

/**
 * Надеть предмет в его категорию (или снять, если itemId = null).
 *
 * Если предмет значится в платном каталоге — требуем владения: иначе
 * баллы можно было бы просто не платить и понадеяться, что экран не
 * спросит сервер. Предметы вне каталога (бесплатные/по Prime/сезонные)
 * сервер не проверяет вовсе — как и раньше, это чисто косметический
 * показ самому себе, денег тут нет.
 */
export const equipItem = async (profileId, category, itemId) => {
  if (!CATEGORIES.includes(category)) return { error: 'bad_category' };
  if (itemId === null) {
    await query('DELETE FROM customization_equipped WHERE profile_id = $1 AND category = $2', [profileId, category]);
    return { ok: true, category, itemId: null };
  }
  if (!ITEM_ID_RE.test(String(itemId))) return { error: 'bad_item' };

  const { rows: catalogRow } = await query(
    'SELECT category FROM customization_catalog WHERE id = $1 AND active', [itemId],
  );
  if (catalogRow.length) {
    if (catalogRow[0].category !== category) return { error: 'bad_category' };
    if (!(await ownsItem(profileId, itemId))) return { error: 'not_owned' };
  }

  await query(
    `INSERT INTO customization_equipped (profile_id, category, item_id) VALUES ($1,$2,$3)
       ON CONFLICT (profile_id, category) DO UPDATE SET item_id = EXCLUDED.item_id`,
    [profileId, category, itemId],
  );
  return { ok: true, category, itemId };
};

/**
 * Покупка. `idempotencyKey` обязателен — повторно отправленный запрос
 * (двойной тап, обрыв сети и повтор клиентом) не должен списать баллы
 * дважды. Тот же паттерн, что у server/skinMarket.mjs::purchaseItem.
 */
export const purchaseItem = async (profileId, itemId, { idempotencyKey } = {}) => {
  const key = String(idempotencyKey ?? '');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) return { error: 'bad_idempotency_key' };
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return { error: 'bad_item' };

  const { rows: prior } = await query(
    'SELECT status, result FROM customization_purchase_attempts WHERE idempotency_key = $1 AND profile_id = $2',
    [key, profileId],
  );
  if (prior.length) return prior[0].result;

  const record = async (status, result) => {
    try {
      await query(
        `INSERT INTO customization_purchase_attempts (idempotency_key, profile_id, item_id, status, result)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [key, profileId, itemId, status, JSON.stringify(result)],
      );
    } catch (err) {
      if (err.code === '23505') {
        const { rows } = await query('SELECT result FROM customization_purchase_attempts WHERE idempotency_key = $1', [key]);
        return rows[0]?.result ?? result;
      }
      throw err;
    }
    return result;
  };

  const { rows: itemRows } = await query(
    'SELECT * FROM customization_catalog WHERE id = $1 AND active', [itemId],
  );
  const item = itemRows[0];
  if (!item) return record('error', { error: 'not_found' });

  if (await ownsItem(profileId, itemId)) return record('error', { error: 'already_owned' });

  const chargeRef = `customization:${itemId}`;
  const charge = await wallet.spendPoints(profileId, item.price_points, `Кастомизация «${itemId}»`, chargeRef);
  if (charge.error) return record('error', charge);

  const invId = `cinv-${generateId()}`;
  try {
    await query(
      `INSERT INTO customization_inventory (id, profile_id, item_id, acquired_via)
       VALUES ($1,$2,$3,'purchase')`,
      [invId, profileId, itemId],
    );
  } catch (err) {
    if (err.code !== '23505') throw err;
    // Гонка по (profile_id, item_id): тот же пользователь купил тем же
    // предметом почти одновременно с другой вкладки/ключом — вернуть
    // списанные баллы, а не оставить их пропавшими за already_owned.
    await wallet.creditPoints(profileId, item.price_points, 'points_refund', 'Возврат: уже куплено', chargeRef);
    return record('error', { error: 'already_owned' });
  }

  return record('ok', { ok: true, itemId, category: item.category, pricePoints: item.price_points });
};

/** Выдача администратором — без списания, для будущей раздачи/грантов. */
export const adminGrantItem = async (profileId, itemId) => {
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return { error: 'bad_item' };
  const { rows: itemRows } = await query('SELECT category FROM customization_catalog WHERE id = $1', [itemId]);
  if (!itemRows[0]) return { error: 'not_found' };
  if (await ownsItem(profileId, itemId)) return { error: 'already_owned' };

  await query(
    `INSERT INTO customization_inventory (id, profile_id, item_id, acquired_via) VALUES ($1,$2,$3,'admin_grant')`,
    [`cinv-${generateId()}`, profileId, itemId],
  );
  return { ok: true };
};
