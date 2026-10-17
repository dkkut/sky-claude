/**
 * Витрина коллекционера в профиле (настройки). Какие подарки лежат у человека, решает nft_ownership;
 * здесь только оформление и список закреплённых. Закрепить можно лишь то, чем человек владеет СЕЙЧАС;
 * чужие витрины видны по тем же правилам приватности, что и подарки в профиле (showGifts).
 */
import { query } from './db.mjs';
import { ownedByProfile, publicOwnedBy } from './nft.mjs';

const BACKGROUNDS = ['aurora', 'space', 'galaxy', 'clouds', 'liquid_metal', 'water', 'crystal', 'neon', 'glass', 'gold', 'ice', 'fire', 'matrix', 'waves', 'particles'];
const LAYOUTS = ['grid', 'carousel', 'spotlight'];
const DEFAULT = { background: 'galaxy', layout: 'grid', description: '', pinned: [] };

const view = (r) => (r ? { background: r.background, layout: r.layout, description: r.description, pinned: r.pinned ?? [] } : { ...DEFAULT });

export const getShowcase = async (viewerId, targetId) => {
  const owned = await publicOwnedBy(viewerId, targetId);
  if (owned.hidden) return { hidden: true, items: [], config: { ...DEFAULT } };
  const { rows } = await query('SELECT * FROM nft_showcases WHERE profile_id = $1', [targetId]);
  const config = view(rows[0]);
  const have = new Set(owned.items.map((i) => i.nftId));
  config.pinned = config.pinned.filter((id) => have.has(id));   // проданное/переданное с витрины пропадает само
  return { hidden: false, items: owned.items, config };
};

export const saveShowcase = async (profileId, b) => {
  const background = BACKGROUNDS.includes(b?.background) ? b.background : null;
  const layout = LAYOUTS.includes(b?.layout) ? b.layout : null;
  const description = typeof b?.description === 'string' ? b.description.replace(/\s+/g, ' ').trim().slice(0, 160) : null;
  let pinned = null;
  if (Array.isArray(b?.pinned)) {
    const have = new Set((await ownedByProfile(profileId)).map((i) => i.nftId));
    pinned = [...new Set(b.pinned.map(String))].filter((id) => have.has(id)).slice(0, 12);
  }
  await query(
    `INSERT INTO nft_showcases (profile_id, background, layout, description, pinned)
     VALUES ($1, COALESCE($2,'galaxy'), COALESCE($3,'grid'), COALESCE($4,''), COALESCE($5::jsonb,'[]'::jsonb))
     ON CONFLICT (profile_id) DO UPDATE SET
       background = COALESCE($2, nft_showcases.background), layout = COALESCE($3, nft_showcases.layout),
       description = COALESCE($4, nft_showcases.description), pinned = COALESCE($5::jsonb, nft_showcases.pinned), updated_at = now()`,
    [profileId, background, layout, description, pinned == null ? null : JSON.stringify(pinned)]);
  return { ok: true };
};
