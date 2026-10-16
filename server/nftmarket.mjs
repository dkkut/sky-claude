/**
 * Sky Gifts NFT — настоящий маркет: выставить на продажу, снять,
 * купить.
 *
 * Раньше все эти действия жили только в браузерном localStorage
 * (src/gifts/nftStore.ts) — «покупка» не проверяла баланс, лот не
 * переживал перезагрузку и не был виден с другого устройства. Здесь —
 * постоянное хранилище лотов и деньги настоящие.
 *
 * Как и везде в проекте, деньги при покупке уходят у покупателя и
 * никому не зачисляются — платёжного шлюза и вывода средств в проекте
 * нет нигде (см. server/primegifts.mjs, server/market.mjs): списание —
 * уже вся «оплата». Продавец получает не деньги на счёт, а то же, что
 * получает любой продавец в Sky Market — заявку исполненной. Это не
 * ограничение под спешку, а тот же принцип, что уже принят для Sky
 * Market, Sky Tickets, ПВЗ и подарков Prime.
 */
import { pool, query } from './db.mjs';
import { generateId } from './security.mjs';
import { wallet } from './wallet.mjs';
import { isKnownNftId } from './nftgenesis.mjs';
import { currentOwner, transferNftIn } from './nft.mjs';
import { notifyGift } from './giftnotify.mjs';

const TYPES = new Set(['fixed', 'auction', 'instant', 'reserve']);
const MAX_PRICE = 10_000_000;
const COMMISSION_PCT = 3; // тот же процент, что показывает клиент (src/gifts/Trade.tsx) — только для отображения итога, комиссия никому не платится.

const rowToListing = (r) => ({
  id: r.id, nftId: r.nft_id, sellerId: r.seller_id, sellerName: r.seller_name ?? null,
  type: r.type, price: Number(r.price), reservePrice: r.reserve_price == null ? null : Number(r.reserve_price),
  decayPct: Number(r.decay_pct), durationH: Number(r.duration_h),
  currentBid: r.current_bid == null ? null : Number(r.current_bid),
  status: r.status, soldPrice: r.sold_price == null ? null : Number(r.sold_price),
  soldAt: r.sold_at ? r.sold_at.toISOString() : null,
  createdAt: r.created_at.toISOString(), endsAt: r.ends_at.toISOString(),
});

const SELECT = `SELECT l.*, p.name AS seller_name FROM nft_listings l LEFT JOIN profiles p ON p.id = l.seller_id`;

export const activeListings = async () => {
  const { rows } = await query(`${SELECT} WHERE l.status = 'active' ORDER BY l.created_at DESC`);
  return rows.map(rowToListing);
};

export const listingFor = async (nftId) => {
  if (!isKnownNftId(nftId)) return null;
  const { rows } = await query(`${SELECT} WHERE l.nft_id = $1 AND l.status = 'active'`, [nftId]);
  return rows[0] ? rowToListing(rows[0]) : null;
};

export const createListing = async (sellerId, nftId, params) => {
  if (!isKnownNftId(nftId)) return { error: 'not_found' };
  const type = String(params?.type ?? '');
  if (!TYPES.has(type)) return { error: 'invalid_type' };
  const price = Math.round(Number(params?.price));
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return { error: 'invalid_price' };
  const durationH = Math.min(Math.max(Math.round(Number(params?.durationH) || 72), 1), 24 * 30);
  const reservePrice = type === 'reserve' && Number.isFinite(Number(params?.reservePrice))
    ? Math.round(Number(params.reservePrice)) : null;
  const decayPct = type === 'fixed' ? Math.min(Math.max(Math.round(Number(params?.decayPct) || 0), 0), 90) : 0;

  const owner = await currentOwner(nftId);
  if (!owner || owner.id !== sellerId) return { error: 'not_owner' };

  const existing = await query(`SELECT 1 FROM nft_listings WHERE nft_id = $1 AND status = 'active'`, [nftId]);
  if (existing.rowCount) return { error: 'already_listed' };

  const id = `lst-${generateId()}`;
  try {
    await query(
      `INSERT INTO nft_listings (id, nft_id, seller_id, type, price, reserve_price, decay_pct, duration_h, current_bid, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + make_interval(hours => $8))`,
      [id, nftId, sellerId, type, price, reservePrice, decayPct, durationH, type === 'auction' ? price : null],
    );
  } catch (err) {
    // Гонка: кто-то выставил тот же подарок между проверкой и вставкой — ловит партиальный уникальный индекс.
    if (err.code === '23505') return { error: 'already_listed' };
    throw err;
  }
  const { rows } = await query(`${SELECT} WHERE l.id = $1`, [id]);
  return { ok: true, listing: rowToListing(rows[0]) };
};

export const cancelListing = async (sellerId, listingId) => {
  const { rows } = await query(
    `UPDATE nft_listings SET status = 'cancelled' WHERE id = $1 AND seller_id = $2 AND status = 'active' RETURNING id`,
    [listingId, sellerId],
  );
  if (!rows[0]) return { error: 'not_found' };
  return { ok: true };
};

/**
 * Покупка: тот же принцип «сначала бронируем лот, потом платим, потом
 * выдаём — и откатываем назад на любой сорванной ступени», что и в
 * server/gifts.mjs::sendGift и server/primegifts.mjs::sendPrimeGift.
 * Лот помечается проданным под блокировкой по его id — параллельная
 * повторная покупка того же лота увидит status≠active и уйдёт с
 * ошибкой, а не спишет деньги дважды.
 */
export const buyListing = async (buyerId, listingId) => {
  // Одна транзакция под блокировкой лота И подарка: лот помечается проданным, деньги списываются, владелец меняется — вместе.
  // Любой сбой между шагами откатывает всё (раньше «списали → передали → вернули отдельным запросом» мог оставить человека без денег и подарка).
  const client = await pool.connect();
  let done;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nft-listing:${listingId}`]);
    const { rows } = await client.query('SELECT * FROM nft_listings WHERE id = $1', [listingId]);
    const listing = rows[0];
    if (!listing || listing.status !== 'active') { await client.query('ROLLBACK'); return { error: 'unavailable' }; }
    if (listing.seller_id === buyerId) { await client.query('ROLLBACK'); return { error: 'self_transfer' }; }

    // Владельца читаем под блокировкой подарка (та же, что у передачи) — иначе прямой подарок мог бы проскочить между проверкой и покупкой.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`nft:${listing.nft_id}`]);
    const { rows: own } = await client.query('SELECT owner_id FROM nft_ownership WHERE nft_id = $1', [listing.nft_id]);
    const ownerId = own[0]?.owner_id ?? (await currentOwner(listing.nft_id))?.id;
    if (ownerId !== listing.seller_id) {
      // Подарок ушёл с рук продавца в обход маркета (прямой подарок другу) — лот протух.
      await client.query(`UPDATE nft_listings SET status = 'cancelled' WHERE id = $1`, [listingId]);
      await client.query('COMMIT');
      return { error: 'unavailable' };
    }

    const finalPrice = listing.type === 'auction' ? Number(listing.current_bid ?? listing.price) : Number(listing.price);
    const paid = await wallet.spendIn(client, buyerId, finalPrice, 'nft_purchase', `Покупка NFT «${listing.nft_id}»`, listingId);
    if (paid.error) { await client.query('ROLLBACK'); return { error: paid.error }; }
    const t = await transferNftIn(client, listing.seller_id, listing.nft_id, buyerId, 'market', { price: finalPrice, type: 'sale' });
    if (!t.ok) { await client.query('ROLLBACK'); return { error: t.error ?? 'unavailable' }; }
    await client.query(`UPDATE nft_listings SET status = 'sold', sold_at = now(), sold_price = $2 WHERE id = $1`, [listingId, finalPrice]);
    await client.query('COMMIT');
    done = { nftId: listing.nft_id, sellerId: listing.seller_id, finalPrice, t };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await done.t.notify().catch(() => {});
  await notifyGift(done.sellerId, 'nft_sale', '🛍️ Подарок продан',
    `«${done.nftId}» продан за ${done.finalPrice.toLocaleString('ru')} ₽`, done.nftId).catch(() => {});

  return { ok: true, nftId: done.nftId, price: done.finalPrice, ownerId: done.t.ownerId, ownerName: done.t.ownerName };
};

export const COMMISSION_PCT_VALUE = COMMISSION_PCT;
