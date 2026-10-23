/**
 * Владение и передача существующих NFT-подарков.
 *
 * Сам каталог (84 подарка, 12 коллекций) остаётся ровно тем же
 * процедурным клиентским кодом, что и был (src/gifts/nftStore.ts) —
 * здесь только правда о том, кому какой подарок сейчас принадлежит, и
 * неизменяемая история передач.
 *
 * Пока подарок ни разу не передавали, «истинный» владелец — тот же,
 * что вычисляет клиент (см. server/nftgenesis.mjs): строки в
 * nft_ownership для него ещё нет. Первая передача материализует эту
 * строку и одновременно записывает «genesis» в историю — дальше
 * подарок уже целиком под управлением базы.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { getPrivacy, exceptionOf } from './privacy.mjs';
import { isKnownNftId, genesisOwner, MINT_ID, mintPrice } from './nftgenesis.mjs';
import { wallet } from './wallet.mjs';
import { notifyGift } from './giftnotify.mjs';

const materializeGenesis = async (client, nftId) => {
  const { rows } = await client.query(
    'SELECT owner_id, owner_name FROM nft_ownership WHERE nft_id = $1',
    [nftId],
  );
  if (rows[0]) return rows[0];
  const g = genesisOwner(nftId);
  if (!g) return null;
  await client.query(
    `INSERT INTO nft_ownership (nft_id, owner_id, owner_name) VALUES ($1,$2,$3)
     ON CONFLICT (nft_id) DO NOTHING`,
    [nftId, g.id, g.name],
  );
  await client.query(
    `INSERT INTO nft_provenance (id, nft_id, type, from_id, from_name, to_id, to_name, operation_id, source)
     VALUES ($1,$2,'genesis',NULL,'Sky Mint',$3,$4,$5,'seed')
     ON CONFLICT (operation_id) DO NOTHING`,
    [`nprov-${generateId()}`, nftId, g.id, g.name, `genesis:${nftId}`],
  );
  const { rows: after } = await client.query(
    'SELECT owner_id, owner_name FROM nft_ownership WHERE nft_id = $1',
    [nftId],
  );
  return after[0] ?? { owner_id: g.id, owner_name: g.name };
};

/** Текущий владелец. Без записи в базу — только для чтения. */
export const currentOwner = async (nftId) => {
  if (!isKnownNftId(nftId)) return null;
  const { rows } = await query(
    'SELECT owner_id, owner_name, updated_at FROM nft_ownership WHERE nft_id = $1',
    [nftId],
  );
  if (rows[0]) return { id: rows[0].owner_id, name: rows[0].owner_name, since: rows[0].updated_at.toISOString(), transferred: true };
  const g = genesisOwner(nftId);
  return g ? { id: g.id, name: g.name, since: null, transferred: false } : null;
};

/** Владельцы нескольких подарков разом — витрина и каталог спрашивают так. */
export const ownersOf = async (nftIds) => {
  const ids = Array.from(new Set((Array.isArray(nftIds) ? nftIds : []).map(String).filter(isKnownNftId)));
  const out = {};
  if (!ids.length) return out;
  const { rows } = await query(
    'SELECT nft_id, owner_id, owner_name, updated_at FROM nft_ownership WHERE nft_id = ANY($1::text[])',
    [ids],
  );
  const known = new Map(rows.map((r) => [r.nft_id, r]));
  for (const id of ids) {
    const row = known.get(id);
    if (row) { out[id] = { id: row.owner_id, name: row.owner_name, since: row.updated_at.toISOString(), transferred: true }; continue; }
    const g = genesisOwner(id);
    if (g) out[id] = { id: g.id, name: g.name, since: null, transferred: false };
  }
  return out;
};

/**
 * NFT, которые сейчас реально принадлежат настоящему профилю (для
 * показа в своём/чужом профиле). Подарки, у которых ещё нет строки в
 * nft_ownership, здесь не участвуют — их «владелец по рождению» либо
 * демонстрационный аккаунт, либо ещё никем не заявлен, и в профиль
 * реального человека он не попадёт, пока подарок ему не подарят.
 */
export const ownedByProfile = async (profileId, { forOwner = true } = {}) => {
  const { rows } = await query(
    `SELECT nft_id, updated_at, hidden_in_profile FROM nft_ownership WHERE owner_id = $1 ${forOwner ? '' : 'AND NOT hidden_in_profile'} ORDER BY updated_at DESC`,
    [profileId],
  );
  return rows.map((r) => ({ nftId: r.nft_id, since: r.updated_at.toISOString(), hiddenInProfile: r.hidden_in_profile === true }));
};

/** То же самое, но с проверкой видимости (используется для чужого профиля). */
export const publicOwnedBy = async (viewerId, targetId) => {
  if (viewerId !== targetId) {
    const exc = await exceptionOf(targetId, viewerId, 'gifts');
    if (exc === 'deny') return { hidden: true, items: [] };
    const priv = await getPrivacy(targetId);
    if (exc !== 'allow' && priv.profileVisibility?.showGifts === false) return { hidden: true, items: [] };
    return { hidden: false, items: await ownedByProfile(targetId, { forOwner: false }) };
  }
  return { hidden: false, items: await ownedByProfile(targetId) };
};

/** Скрыть/показать отдельный NFT-подарок в профиле (только владелец подарка). */
export const setNftHidden = async (profileId, nftId, hidden) => {
  const r = await query('UPDATE nft_ownership SET hidden_in_profile = $3 WHERE nft_id = $1 AND owner_id = $2 RETURNING nft_id', [String(nftId ?? ''), profileId, hidden === true]);
  return r.rows[0] ? { ok: true } : { error: 'not_found' };
};

/** Полная неизменяемая история подарка, от рождения до сегодня. */
export const provenanceOf = async (nftId) => {
  if (!isKnownNftId(nftId)) return null;
  await (async () => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await materializeGenesis(client, nftId); await client.query('COMMIT'); }
    catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  })();
  const { rows } = await query(
    `SELECT id, type, from_id, from_name, to_id, to_name, operation_id, source, price, at
       FROM nft_provenance WHERE nft_id = $1 ORDER BY at ASC`,
    [nftId],
  );
  return rows.map((r) => ({
    id: r.id, type: r.type, fromId: r.from_id, fromName: r.from_name,
    toId: r.to_id, toName: r.to_name, operationId: r.operation_id,
    source: r.source, price: r.price == null ? null : Number(r.price), at: r.at.toISOString(),
  }));
};

/**
 * Передача подарка от текущего владельца к другому реальному профилю.
 *
 * Блокировка по nftId сериализует все одновременные попытки передать
 * ОДИН И ТОТ ЖЕ подарок: вторая заявка дожидается первой и видит уже
 * нового владельца, поэтому «два одновременных перевода одного NFT»
 * не может дать двух победителей — либо `not_owner`, либо успех, и
 * только у одного из двух запросов.
 */
/**
 * Сама передача — внутри ЧУЖОЙ открытой транзакции (client уже в BEGIN). Берёт блокировку подарка, проверяет владельца,
 * меняет владельца и пишет историю. Возвращает {ok, …, notify} либо {error} — при ошибке вызывающий обязан откатить транзакцию.
 * Уведомление НЕ отправляется здесь: его шлют после COMMIT (`notify`), иначе откат оставил бы «ложное» уведомление.
 */
export const transferNftIn = async (client, senderId, nftId, recipientId, source = 'gift', opts = {}) => {
  if (!isKnownNftId(nftId)) return { error: 'not_found' };
  const to = String(recipientId ?? '');
  if (!to) return { error: 'invalid_recipient' };
  if (to === senderId) return { error: 'self_transfer' };
  const price = Number.isFinite(opts.price) ? Math.round(opts.price) : null;
  const provType = opts.type === 'sale' ? 'sale' : 'transfer';

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nft:${nftId}`]);

  const { rows: rp } = await client.query('SELECT id, name FROM profiles WHERE id = $1', [to]);
  if (!rp[0]) return { error: 'recipient_not_found' };

  const current = await materializeGenesis(client, nftId);
  if (!current) return { error: 'not_found' };
  if (current.owner_id !== senderId) return { error: 'not_owner' };

  await client.query(
    `UPDATE nft_ownership SET owner_id = $2, owner_name = $3, updated_at = now() WHERE nft_id = $1`,
    [nftId, to, rp[0].name],
  );
  const opId = opts.operationId ?? `${provType}-${generateId()}`;
  await client.query(
    `INSERT INTO nft_provenance (id, nft_id, type, from_id, from_name, to_id, to_name, operation_id, source, price)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [`nprov-${generateId()}`, nftId, provType, senderId, current.owner_name, to, rp[0].name, opId, String(source).slice(0, 32), price],
  );
  const note = provType === 'sale'
    ? { title: '🛍️ NFT продан', body: `«${nftId}» куплен за ${price ?? 0} ₽` }
    : { title: '🖼️ Вам подарили NFT', body: `Вам передали коллекционный подарок «${nftId}»` };
  return {
    ok: true, nftId, ownerId: to, ownerName: rp[0].name, operationId: opId,
    notify: () => notifyGift(to, provType === 'sale' ? 'nft_purchase' : 'nft_transfer', note.title, note.body, nftId),
  };
};

/**
 * Передача подарка от текущего владельца к другому реальному профилю.
 *
 * Блокировка по nftId сериализует все одновременные попытки передать
 * ОДИН И ТОТ ЖЕ подарок: вторая заявка дожидается первой и видит уже
 * нового владельца, поэтому «два одновременных перевода одного NFT»
 * не может дать двух победителей — либо `not_owner`, либо успех, и
 * только у одного из двух запросов.
 */
export const transferNft = async (senderId, nftId, recipientId, source = 'gift', opts = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await transferNftIn(client, senderId, nftId, recipientId, source, opts);
    if (!r.ok) { await client.query('ROLLBACK'); return r; }
    await client.query('COMMIT');
    await r.notify().catch(() => {});
    const { notify, ...out } = r; void notify;
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Покупка у платформы: подарок, которого ещё никто не купил, принадлежит
 * Sky Mint и стоит ровно столько, сколько насчитал каталог (mintPrice,
 * цену клиент не присылает).
 *
 * Списание денег и передача подарка — ОДНА транзакция под блокировкой подарка: либо нет ни того ни другого, либо есть и то и другое.
 * Раньше «списали → передали → при отказе вернули отдельным вызовом», и любая ошибка между шагами (сбой базы, обрыв)
 * оставляла человека без денег и без подарка. Повторное нажатие и гонка за один подарок: второй запрос видит нового владельца
 * и получает `unavailable` до какого-либо списания.
 */
export const buyFromMint = async (buyerId, nftId) => {
  if (!isKnownNftId(nftId)) return { error: 'not_found' };
  const price = mintPrice(nftId);
  if (!Number.isInteger(price) || price < 1) return { error: 'unavailable' };
  const ref = `mint:${nftId}:${buyerId}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nft:${nftId}`]);
    const cur = await materializeGenesis(client, nftId);
    if (!cur || cur.owner_id !== MINT_ID) { await client.query('ROLLBACK'); return { error: 'unavailable' }; }
    const paid = await wallet.spendIn(client, buyerId, price, 'nft_purchase', `Покупка NFT «${nftId}» у Sky Mint`, ref);
    if (paid.error) { await client.query('ROLLBACK'); return { error: paid.error }; }
    const t = await transferNftIn(client, MINT_ID, nftId, buyerId, 'mint', { price, type: 'sale' });
    if (!t.ok) { await client.query('ROLLBACK'); return { error: t.error === 'not_owner' ? 'unavailable' : (t.error ?? 'unavailable') }; }
    await client.query('COMMIT');
    await t.notify().catch(() => {});
    return { ok: true, nftId, price, ownerId: t.ownerId, ownerName: t.ownerName };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};
