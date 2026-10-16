/**
 * Sky Gifts: состояние владения и покупок — только чтение, для админки (право `gifts`).
 * Ничего не исправляет и не удаляет: сначала доказательство, потом (отдельно, осознанно) исправление.
 * Показывает: кому на самом деле принадлежат NFT-подарки (платформа Sky Mint / настоящие профили / «неизвестные» владельцы,
 * в том числе остатки прежних демонстрационных аккаунтов), протухшие лоты, оплаченные, но невыданные покупки и застрявшие заказы обычных подарков.
 */
import { query } from './db.mjs';
import { MINT_ID } from './nftgenesis.mjs';

const DEMO_IDS = ['acc-luna', 'acc-neo', 'acc-kutuzov', 'col-mira', 'col-arkin', 'col-zima', 'col-orel', 'col-vesna'];

export const giftsHealth = async () => {
  const [own, demo, unknown, stale, paidNotDelivered, orders, stuck, catalog, tx] = await Promise.all([
    query(`SELECT
             count(*) FILTER (WHERE o.owner_id = $1)::int AS mint,
             count(*) FILTER (WHERE o.owner_id <> $1 AND p.id IS NOT NULL)::int AS real,
             count(*)::int AS materialized
           FROM nft_ownership o LEFT JOIN profiles p ON p.id = o.owner_id`, [MINT_ID]),
    query('SELECT nft_id, owner_id, owner_name FROM nft_ownership WHERE owner_id = ANY($1::text[]) LIMIT 50', [DEMO_IDS]),
    query(`SELECT o.nft_id, o.owner_id, o.owner_name FROM nft_ownership o LEFT JOIN profiles p ON p.id = o.owner_id
            WHERE o.owner_id <> $1 AND p.id IS NULL AND o.owner_id <> ALL($2::text[]) LIMIT 50`, [MINT_ID, DEMO_IDS]),
    query(`SELECT l.id, l.nft_id, l.seller_id FROM nft_listings l
             LEFT JOIN nft_ownership o ON o.nft_id = l.nft_id
            WHERE l.status = 'active' AND coalesce(o.owner_id, $1) <> l.seller_id LIMIT 50`, [MINT_ID]),
    // Списание за NFT есть, а записи о передаче покупателю — нет: деньги ушли, подарок не выдан
    query(`SELECT t.id, t.user_id, t.amount, t.ref, t.created_at FROM wallet_transactions t
            WHERE t.type = 'nft_purchase' AND t.amount < 0 AND t.created_at > now() - interval '90 days'
              AND NOT EXISTS (SELECT 1 FROM nft_provenance v WHERE v.type = 'sale' AND v.to_id = t.user_id AND v.price = -t.amount
                                AND v.at BETWEEN t.created_at - interval '1 minute' AND t.created_at + interval '10 minutes')
              AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.user_id = t.user_id AND r.ref = t.ref AND r.amount > 0)
            ORDER BY t.created_at DESC LIMIT 50`),
    query(`SELECT status, count(*)::int AS n FROM gift_orders GROUP BY status`),
    query(`SELECT id, buyer_id, status, price, created_at FROM gift_orders
            WHERE status = 'awaiting_payment' AND created_at < now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 50`),
    query(`SELECT count(*) FILTER (WHERE active)::int AS active, count(*)::int AS total FROM gift_catalog`).catch(() => ({ rows: [{ active: null, total: null }] })),
    query(`SELECT count(*)::int AS n, coalesce(sum(-amount),0)::bigint AS rub FROM wallet_transactions WHERE type = 'nft_purchase' AND amount < 0 AND created_at > now() - interval '7 days'`),
  ]);
  const o = own.rows[0];
  return {
    nft: {
      materialized: o.materialized, mint: o.mint, realOwners: o.real,
      demoOwners: demo.rows.map((r) => ({ nftId: r.nft_id, ownerId: r.owner_id, ownerName: r.owner_name })),
      unknownOwners: unknown.rows.map((r) => ({ nftId: r.nft_id, ownerId: r.owner_id, ownerName: r.owner_name })),
      staleListings: stale.rows.map((r) => ({ id: r.id, nftId: r.nft_id, sellerId: r.seller_id })),
      paidNotDelivered: paidNotDelivered.rows.map((r) => ({ txId: r.id, userId: r.user_id, amount: -Number(r.amount), ref: r.ref, at: r.created_at.toISOString() })),
      purchases7d: { count: tx.rows[0].n, rub: Number(tx.rows[0].rub) },
    },
    orders: { byStatus: Object.fromEntries(orders.rows.map((r) => [r.status, r.n])), stuck: stuck.rows.map((r) => ({ id: r.id, buyerId: r.buyer_id, price: r.price, at: r.created_at.toISOString() })) },
    catalog: catalog.rows[0],
  };
};
