/** Sky Pets: дом, магазин, задания и события, город, подарки, передача и удаление питомцев. Основа и действия — spcore.mjs. */
import { query } from './db.mjs';
import { inTx } from './gocore.mjs';
import { wallet } from './wallet.mjs';
import { mayWriteTo } from './privacy.mjs';
import { ROOMS, BASE_ROOMS, CATEGORIES, RARITIES } from './spdata.mjs';
import { err, ensurePlayer, ensureSeed, itemMap, names, loadPets, uid, clean, day, week, season, grant, ping, poke, bonuses, settle, moodOf } from './spcore.mjs';

class Abort extends Error { constructor(code, extra) { super(code); this.code = code; this.extra = extra; } }
const abort = (code, extra = {}) => { throw new Abort(code, extra); };
export const tx = async (fn) => { try { return await inTx(fn); } catch (e) { if (e instanceof Abort) return err(e.code, e.extra); throw e; } };

// ───────────────────────────── дом ─────────────────────────────
const HOUSE_MAX_ITEMS = 60;
const scopeHouse = async (c, me, scope, lock = false) => {
  const l = lock ? ' FOR UPDATE' : '';
  if (scope === 'me') {
    await c.query(`INSERT INTO sp_houses (id, profile_id, name) VALUES ($1,$2,'Мой дом') ON CONFLICT DO NOTHING`, [uid('phs'), me]);
    return (await c.query(`SELECT * FROM sp_houses WHERE profile_id=$1${l}`, [me])).rows[0];
  }
  if (!/^pet-[0-9a-f-]{36}$/.test(String(scope))) return null;
  const own = await c.query(`SELECT p.shared FROM sp_pets p JOIN sp_owners o ON o.pet_id=p.id AND o.profile_id=$2 WHERE p.id=$1 AND p.deleted_at IS NULL`, [scope, me]);
  if (!own.rowCount || !own.rows[0].shared) return null;
  await c.query(`INSERT INTO sp_houses (id, pet_id, name) VALUES ($1,$2,'Общий дом') ON CONFLICT DO NOTHING`, [uid('phs'), scope]);
  return (await c.query(`SELECT * FROM sp_houses WHERE pet_id=$1${l}`, [scope])).rows[0];
};
const houseOut = async (h, scope) => ({ id: h.id, scope, name: h.name, rooms: h.rooms, style: h.style, placed: h.placed, limit: HOUSE_MAX_ITEMS, bonuses: await bonuses(h), allRooms: ROOMS });
export const getHouse = async (me, scope = 'me') => {
  await ensurePlayer(me); return tx(async (c) => { const h = await scopeHouse(c, me, scope); if (!h) return err('not_found'); return houseOut(h, scope); });
};
const PLACEABLE = ['furniture', 'bed', 'bowl', 'decor', 'toy'];
export const placeItem = async (me, scope, b) => tx(async (c) => {
  const h = await scopeHouse(c, me, scope, true); if (!h) abort('not_found');
  const items = await itemMap(); const it = items.get(String(b.itemId)); if (!it) abort('bad_item');
  const room = String(b.room); if (!h.rooms.includes(room)) abort('room_locked');
  const inv = async () => Number((await c.query('SELECT qty FROM sp_inventory WHERE profile_id=$1 AND item_id=$2 FOR UPDATE', [me, it.id])).rows[0]?.qty ?? 0);
  if (it.kind === 'interior') {
    if (!(await inv())) abort('no_item'); const style = { ...(h.style ?? {}) }; style[room] = { ...(style[room] ?? {}), ...(it.effect?.wall ? { wall: it.effect.wall } : {}), ...(it.effect?.floor ? { floor: it.effect.floor } : {}) };
    await c.query('UPDATE sp_houses SET style=$2, updated_at=now() WHERE id=$1', [h.id, JSON.stringify(style)]); return { ok: true, style };
  }
  if (!PLACEABLE.includes(it.kind)) abort('bad_item');
  if ((h.placed ?? []).length >= HOUSE_MAX_ITEMS) abort('house_full');
  if (!(await inv())) abort('no_item');
  await c.query('UPDATE sp_inventory SET qty = qty - 1 WHERE profile_id=$1 AND item_id=$2', [me, it.id]);
  const placed = [...(h.placed ?? []), { uid: uid('pl').slice(0, 11), itemId: it.id, room, x: Math.round(Math.max(0, Math.min(100, Number(b.x) || 50))), y: Math.round(Math.max(0, Math.min(100, Number(b.y) || 70))), by: me }];
  await c.query('UPDATE sp_houses SET placed=$2, updated_at=now() WHERE id=$1', [h.id, JSON.stringify(placed)]); if (scope !== 'me') poke([], {}); return { ok: true, placed };
});
export const removePlaced = async (me, scope, plUid) => tx(async (c) => {
  const h = await scopeHouse(c, me, scope, true); if (!h) abort('not_found');
  const f = (h.placed ?? []).find((x) => x.uid === plUid); if (!f) abort('not_found');
  await c.query('INSERT INTO sp_inventory (profile_id,item_id,qty) VALUES ($1,$2,1) ON CONFLICT (profile_id,item_id) DO UPDATE SET qty = sp_inventory.qty + 1', [me, f.itemId]);
  const placed = h.placed.filter((x) => x.uid !== plUid); await c.query('UPDATE sp_houses SET placed=$2, updated_at=now() WHERE id=$1', [h.id, JSON.stringify(placed)]); return { ok: true, placed };
});
export const expandHouse = async (me, scope, itemId) => tx(async (c) => {
  const h = await scopeHouse(c, me, scope, true); if (!h) abort('not_found'); const it = (await itemMap()).get(String(itemId)); if (!it || it.kind !== 'house' || !ROOMS.includes(it.effect?.room)) abort('bad_item');
  if (h.rooms.includes(it.effect.room)) abort('room_exists');
  const t = await c.query('UPDATE sp_inventory SET qty = qty - 1 WHERE profile_id=$1 AND item_id=$2 AND qty > 0 RETURNING qty', [me, it.id]); if (!t.rowCount) abort('no_item');
  const rooms = [...h.rooms, it.effect.room]; await c.query('UPDATE sp_houses SET rooms=$2, updated_at=now() WHERE id=$1', [h.id, JSON.stringify(rooms)]); return { ok: true, rooms };
});
export const renameHouse = async (me, scope, name) => tx(async (c) => { const h = await scopeHouse(c, me, scope, true); if (!h) abort('not_found'); const n = clean(name, 30); if (n.length < 2) abort('bad_name'); await c.query('UPDATE sp_houses SET name=$2 WHERE id=$1', [h.id, n]); return { ok: true, name: n }; });

// ───────────────────────────── магазин ─────────────────────────────
const inSeason = (s) => !s || s === season();
const shopCols = { egg: 'sp_eggs', item: 'sp_items', skin: 'sp_skins', species: 'sp_species' };
export const shop = async (me) => {
  await ensurePlayer(me); const pl = (await query('SELECT coins FROM sp_players WHERE profile_id=$1', [me])).rows[0];
  const [eggs, items, skins, species] = await Promise.all([
    query(`SELECT id,name,description,kind,rarity,art,image_id,price_coins,price_points,hatch_seconds,season FROM sp_eggs WHERE status='published' AND buyable ORDER BY price_coins, price_points`),
    query(`SELECT id,kind,name,description,category,rarity,art,image_id,effect,price_coins,price_points,season FROM sp_items WHERE status='published' AND shop ORDER BY kind, price_coins`),
    query(`SELECT id,species_id,name,description,rarity,art,image_id,view,price_coins,price_points,unlock_level,season,limited_until,category FROM sp_skins WHERE status='published' AND (price_coins > 0 OR price_points > 0) AND (limited_until IS NULL OR limited_until > now())`),
    query(`SELECT id,name,description,category,rarity,art,image_id,view,cost_coins,season FROM sp_species WHERE status='published' AND cost_coins > 0 AND NOT exclusive ORDER BY cost_coins`),
  ]);
  const owned = new Set((await query('SELECT skin_id FROM sp_skin_owned WHERE profile_id=$1', [me])).rows.map((r) => r.skin_id));
  return { coins: Number(pl.coins), season: season(),
    eggs: eggs.rows.filter((e) => inSeason(e.season)), items: items.rows.filter((i) => inSeason(i.season)),
    skins: skins.rows.filter((s) => inSeason(s.season)).map((s) => ({ ...s, owned: owned.has(s.id) })), pets: species.rows.filter((s) => inSeason(s.season)) };
};
export const buy = async (me, b) => {
  const kind = String(b.kind); if (!shopCols[kind]) return err('bad_kind');
  const idem = clean(b.idemKey, 64); if (idem.length < 8) return err('idem_required');
  const qty = kind === 'skin' || kind === 'species' ? 1 : Math.max(1, Math.min(kind === 'egg' ? 5 : 20, Math.floor(Number(b.qty) || 1)));
  await ensurePlayer(me);
  return tx(async (c) => {
    const ins = await c.query(`INSERT INTO sp_purchases (profile_id,idem_key,kind,ref_id,qty) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING 1`, [me, idem, kind, String(b.id), qty]);
    if (!ins.rowCount) return { ok: true, duplicate: true };
    const row = (await c.query(`SELECT * FROM ${shopCols[kind]} WHERE id=$1 AND status='published'`, [String(b.id)])).rows[0]; if (!row) abort('not_found');
    if (!inSeason(row.season)) abort('out_of_season');
    let coinsPrice = kind === 'species' ? row.cost_coins : row.price_coins, pointsPrice = kind === 'species' ? 0 : row.price_points;
    if (kind === 'egg' && !row.buyable) abort('not_for_sale'); if (kind === 'item' && !row.shop) abort('not_for_sale'); if (kind === 'species' && (row.exclusive || row.cost_coins <= 0)) abort('not_for_sale');
    if (kind === 'skin' && row.limited_until && new Date(row.limited_until) < new Date()) abort('expired');
    if (kind === 'skin' && (await c.query('SELECT 1 FROM sp_skin_owned WHERE profile_id=$1 AND skin_id=$2', [me, row.id])).rowCount) abort('already_owned');
    const cur = b.currency === 'points' ? 'points' : 'coins';
    if (cur === 'points' && pointsPrice <= 0) abort('bad_currency'); if (cur === 'coins' && coinsPrice <= 0) abort(pointsPrice > 0 ? 'points_only' : 'not_for_sale');
    let spentCoins = 0, spentPoints = 0;
    if (cur === 'coins') { spentCoins = coinsPrice * qty; const u = await c.query('UPDATE sp_players SET coins = coins - $2 WHERE profile_id=$1 AND coins >= $2 RETURNING coins', [me, spentCoins]); if (!u.rowCount) abort('insufficient_coins'); }
    else { spentPoints = pointsPrice * qty; const r = await wallet.spendPointsIn(c, me, spentPoints, 'pets_purchase', `Sky Pets: ${row.name}`, `pets:${idem}`); if (r.error) abort(r.error === 'insufficient_points' ? 'insufficient_points' : r.error); }
    let petId = null;
    if (kind === 'egg') for (let i = 0; i < qty; i++) await c.query(`INSERT INTO sp_player_eggs (id,owner_id,egg_id,source) VALUES ($1,$2,$3,'shop')`, [uid('peg'), me, row.id]);
    else if (kind === 'item') await c.query('INSERT INTO sp_inventory (profile_id,item_id,qty) VALUES ($1,$2,$3) ON CONFLICT (profile_id,item_id) DO UPDATE SET qty = sp_inventory.qty + $3', [me, row.id, qty]);
    else if (kind === 'skin') await c.query('INSERT INTO sp_skin_owned (profile_id,skin_id) VALUES ($1,$2)', [me, row.id]);
    else { petId = uid('pet'); await c.query(`INSERT INTO sp_pets (id,species_id,name,character,source) VALUES ($1,$2,$3,'calm','shop')`, [petId, row.id, row.name]); await c.query('INSERT INTO sp_owners (pet_id,profile_id) VALUES ($1,$2)', [petId, me]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'bought',$3)`, [petId, me, JSON.stringify({ coins: spentCoins })]); }
    await c.query('UPDATE sp_purchases SET coins=$3, points=$4 WHERE profile_id=$1 AND idem_key=$2', [me, idem, spentCoins, spentPoints]);
    return { ok: true, spentCoins, spentPoints, petId };
  });
};

// ───────────────────────────── задания и события ─────────────────────────────
const periodOf = (t) => (t.kind === 'daily' ? day() : t.kind === 'weekly' || t.kind === 'joint' ? week() : t.event_id ?? 'p');
export const tasks = async (me) => {
  await ensurePlayer(me);
  const { rows } = await query(`SELECT * FROM sp_tasks WHERE active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) ORDER BY sort, id`);
  const { rows: pr } = await query(`SELECT task_id, period, progress, claimed_at FROM sp_task_progress WHERE profile_id=$1 AND period = ANY($2::text[])`, [me, [day(), week(), ...rows.filter((t) => t.event_id).map((t) => t.event_id), 'p']]);
  const m = new Map(pr.map((r) => [`${r.task_id}|${r.period}`, r]));
  return { tasks: rows.map((t) => { const p = m.get(`${t.id}|${periodOf(t)}`); return { id: t.id, title: t.title, kind: t.kind, action: t.action, target: t.target, reward: t.reward, progress: p?.progress ?? 0, claimed: Boolean(p?.claimed_at), ready: (p?.progress ?? 0) >= t.target && !p?.claimed_at, endsAt: t.ends_at }; }) };
};
export const claimTask = async (me, id) => tx(async (c) => {
  const t = (await c.query(`SELECT * FROM sp_tasks WHERE id=$1 AND active`, [id])).rows[0]; if (!t) abort('not_found');
  if ((t.starts_at && new Date(t.starts_at) > new Date()) || (t.ends_at && new Date(t.ends_at) < new Date())) abort('not_active');
  const u = await c.query(`UPDATE sp_task_progress SET claimed_at=now() WHERE profile_id=$1 AND task_id=$2 AND period=$3 AND claimed_at IS NULL AND progress >= $4 RETURNING 1`, [me, id, periodOf(t), t.target]);
  if (!u.rowCount) { const ex = await c.query('SELECT claimed_at FROM sp_task_progress WHERE profile_id=$1 AND task_id=$2 AND period=$3', [me, id, periodOf(t)]); abort(ex.rows[0]?.claimed_at ? 'already_claimed' : 'not_ready'); }
  await grant(c, me, t.reward, 'task'); return { ok: true, reward: t.reward };
});
export const events = async (me) => {
  await ensurePlayer(me);
  const { rows } = await query(`SELECT * FROM sp_events WHERE active AND ends_at > now() - interval '7 days' ORDER BY starts_at DESC LIMIT 20`);
  const out = [];
  for (const e of rows) {
    const mine = (await query('SELECT score, claimed_at FROM sp_event_scores WHERE event_id=$1 AND profile_id=$2', [e.id, me])).rows[0];
    const top = (await query('SELECT profile_id, score FROM sp_event_scores WHERE event_id=$1 AND score > 0 ORDER BY score DESC LIMIT 10', [e.id])).rows; const nm = await names(top.map((t) => t.profile_id));
    out.push({ id: e.id, title: e.title, description: e.description, kind: e.kind, metric: e.metric, startsAt: e.starts_at, endsAt: e.ends_at, reward: e.reward, started: new Date(e.starts_at) <= new Date(), ended: new Date(e.ends_at) <= new Date(), myScore: mine?.score ?? 0, claimed: Boolean(mine?.claimed_at), board: top.map((t, i) => ({ rank: i + 1, name: nm[t.profile_id]?.name ?? '', score: t.score, me: t.profile_id === me })) });
  }
  return { events: out };
};
export const claimEvent = async (me, id) => tx(async (c) => {
  const e = (await c.query('SELECT * FROM sp_events WHERE id=$1 AND active', [id])).rows[0]; if (!e) abort('not_found'); if (new Date(e.ends_at) > new Date()) abort('not_finished');
  const s = (await c.query('SELECT score, claimed_at FROM sp_event_scores WHERE event_id=$1 AND profile_id=$2 FOR UPDATE', [id, me])).rows[0]; if (!s || s.score <= 0) abort('no_score'); if (s.claimed_at) abort('already_claimed');
  const rank = 1 + Number((await c.query('SELECT count(*) AS n FROM sp_event_scores WHERE event_id=$1 AND score > $2', [id, s.score])).rows[0].n);
  const reward = { ...(e.reward?.participation ?? {}) }; const top = e.reward?.top?.[rank - 1]; if (top) { reward.coins = (reward.coins ?? 0) + (top.coins ?? 0); reward.items = { ...(reward.items ?? {}), ...(top.items ?? {}) }; reward.eggs = { ...(reward.eggs ?? {}), ...(top.eggs ?? {}) }; }
  await c.query('UPDATE sp_event_scores SET claimed_at=now() WHERE event_id=$1 AND profile_id=$2', [id, me]); await grant(c, me, reward, 'event'); return { ok: true, rank, reward };
});

// ───────────────────────────── город питомцев ─────────────────────────────
const areFriends = async (a, b) => (await query(`SELECT 1 FROM friendships WHERE status='accepted' AND a_id = LEAST($1::text,$2::text) AND b_id = GREATEST($1::text,$2::text)`, [a, b])).rowCount > 0;
const mayVisit = async (me, owner) => {
  if (me === owner) return true; const p = (await query('SELECT visit_policy FROM sp_players WHERE profile_id=$1', [owner])).rows[0]; if (!p) return false;
  if (p.visit_policy === 'none') return false; if (p.visit_policy === 'friends') return areFriends(me, owner);
  return (await mayWriteTo(owner, me)) || true;
};
export const city = async (me, q = '', offset = 0) => {
  await ensurePlayer(me); const like = `%${String(q).trim().replace(/[%_\\]/g, '\\$&').slice(0, 40)}%`;
  const { rows } = await query(`SELECT pl.profile_id, pr.name, pr.username, pl.visit_policy,
      (SELECT count(*)::int FROM sp_owners o JOIN sp_pets p ON p.id=o.pet_id AND p.deleted_at IS NULL WHERE o.profile_id = pl.profile_id) AS pets,
      (SELECT p.species_id FROM sp_owners o JOIN sp_pets p ON p.id=o.pet_id AND p.deleted_at IS NULL WHERE o.profile_id = pl.profile_id ORDER BY p.level DESC LIMIT 1) AS top_species
    FROM sp_players pl JOIN profiles pr ON pr.id = pl.profile_id AND pr.deleted_at IS NULL
    WHERE pl.profile_id <> $1 AND pl.visit_policy <> 'none' AND ($2 = '%%' OR pr.name ILIKE $2 OR pr.username ILIKE $2)
      AND (pl.visit_policy = 'all' OR EXISTS (SELECT 1 FROM friendships f WHERE f.status='accepted' AND f.a_id = LEAST($1::text, pl.profile_id) AND f.b_id = GREATEST($1::text, pl.profile_id)))
      AND EXISTS (SELECT 1 FROM sp_owners o JOIN sp_pets p ON p.id=o.pet_id AND p.deleted_at IS NULL WHERE o.profile_id = pl.profile_id)
    ORDER BY pets DESC, pr.name LIMIT 30 OFFSET $3`, [me, like === '%%' ? '%%' : like, Math.max(0, Number(offset) || 0)]);
  const sp = await query('SELECT id,name,art,image_id,rarity FROM sp_species WHERE id = ANY($1::text[])', [rows.map((r) => r.top_species).filter(Boolean)]); const sm = Object.fromEntries(sp.rows.map((s) => [s.id, s]));
  return { players: rows.map((r) => ({ id: r.profile_id, name: r.name, username: r.username, pets: r.pets, top: sm[r.top_species] ?? null })) };
};
export const visit = async (me, owner) => {
  if (!(await mayVisit(me, owner))) return err('private'); await ensurePlayer(me);
  const pets = await loadPets(`EXISTS (SELECT 1 FROM sp_owners o WHERE o.pet_id = p.id AND o.profile_id = $1)`, [owner], null);
  const h = (await query('SELECT * FROM sp_houses WHERE profile_id=$1', [owner])).rows[0]; const nm = await names([owner]);
  const { rows: rc } = await query(`SELECT kind, count(*)::int AS n FROM sp_reactions WHERE house_owner=$1 GROUP BY kind`, [owner]);
  const species = new Set(pets.map((p) => p.speciesId));
  return { owner: nm[owner], house: h ? { name: h.name, rooms: h.rooms, style: h.style, placed: h.placed } : null, pets: pets.map((p) => ({ ...p, owners: undefined })), collection: { species: species.size, pets: pets.length }, reactions: Object.fromEntries(rc.map((r) => [r.kind, r.n])), self: owner === me };
};
const REACTIONS = ['heart', 'wave', 'clap', 'star', 'cake'];
export const react = async (me, owner, kind, petId = null) => {
  if (!REACTIONS.includes(kind)) return err('bad_kind'); if (me === owner) return err('self'); if (!(await mayVisit(me, owner))) return err('private'); await ensurePlayer(me);
  const n = Number((await query(`SELECT count(*) AS n FROM sp_reactions WHERE actor_id=$1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n); if (n >= 30) return err('slow_down');
  const first = !(await query(`SELECT 1 FROM sp_reactions WHERE actor_id=$1 AND house_owner=$2 AND created_at > now() - interval '1 day'`, [me, owner])).rowCount;
  await query('INSERT INTO sp_reactions (house_owner,actor_id,kind,pet_id) VALUES ($1,$2,$3,$4)', [owner, me, kind, petId]);
  if (first) { const who = (await names([me]))[me]?.name ?? 'Гость'; await ping([owner], 'reaction', 'Гость в доме питомцев', `${who} заглянул(а) к вам и оставил(а) реакцию.`, { important: false, ref: me }); }
  return { ok: true };
};
export const playTogether = async (me, owner, myPetId, theirPetId) => {
  if (me === owner) return err('self'); if (!(await mayVisit(me, owner))) return err('private'); await ensurePlayer(me);
  const key = Math.floor(Date.now() / 864e5); const r = await query(`INSERT INTO sp_rate (profile_id,action,win,n) VALUES ($1,$2,$3,1) ON CONFLICT (profile_id,action,win) DO UPDATE SET n = sp_rate.n + 1 RETURNING n`, [me, `ptog:${owner}`, key]); if (r.rows[0].n > 3) return err('slow_down');
  let o;
  const res = await tx(async (c) => {
    const ids = [myPetId, theirPetId].sort(); const rows = (await c.query('SELECT * FROM sp_pets WHERE id = ANY($1::text[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE', [ids])).rows; if (rows.length !== 2) abort('not_found');
    const mine = rows.find((p) => p.id === myPetId), theirs = rows.find((p) => p.id === theirPetId);
    if (!(await c.query('SELECT 1 FROM sp_owners WHERE pet_id=$1 AND profile_id=$2', [mine.id, me])).rowCount) abort('not_found');
    if (!(await c.query('SELECT 1 FROM sp_owners WHERE pet_id=$1 AND profile_id=$2', [theirs.id, owner])).rowCount) abort('not_found');
    for (const p of [mine, theirs]) { const s = settle(p); if (s.sleeping) abort('sleeping'); if (s.energy < 15) abort('too_tired'); }
    for (const p of [mine, theirs]) { const s = settle(p); await c.query('UPDATE sp_pets SET energy=$2, satiety=$3, health=$4, hygiene=$5, fun=$6, stat_at=now(), sleeping_until=NULL, xp = xp + 5 WHERE id=$1', [p.id, Math.max(10, s.energy - 5), s.satiety, s.health, s.hygiene, Math.min(100, s.fun + 12)]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail,xp) VALUES ($1,$2,'play_together',$3,5)`, [p.id, me, JSON.stringify({ with: p.id === mine.id ? theirs.name : mine.name })]); }
    o = [owner]; return { ok: true };
  });
  if (res.ok) { await ping(o, 'play_together', 'Питомцы подружились', 'Гость поиграл(а) с вашим питомцем.', { important: false }); poke([me, owner], { kind: 'pet' }); }
  return res;
};

// ───────────────────────────── подарки ─────────────────────────────
export const sendGift = async (me, toId, kind, refId, qty, message) => {
  if (!toId || toId === me) return err('bad_target'); if (!['egg', 'item'].includes(kind)) return err('bad_kind');
  const to = (await query('SELECT id FROM profiles WHERE id=$1 AND deleted_at IS NULL', [toId])).rows[0]; if (!to) return err('not_found'); if (!(await mayWriteTo(toId, me))) return err('not_allowed'); await ensurePlayer(me);
  const n = Number((await query(`SELECT count(*) AS n FROM sp_gifts WHERE from_id=$1 AND created_at > now() - interval '1 day'`, [me])).rows[0].n); if (n >= 10) return err('slow_down');
  const q = kind === 'egg' ? 1 : Math.max(1, Math.min(20, Math.floor(Number(qty) || 1))); const msg = clean(message, 120);
  const r = await tx(async (c) => {
    const id = uid('pgf');
    if (kind === 'egg') { const u = await c.query(`UPDATE sp_player_eggs SET state='gifted' WHERE id=$1 AND owner_id=$2 AND state='unhatched' AND partner_id IS NULL RETURNING 1`, [refId, me]); if (!u.rowCount) abort('no_item'); }
    else { const it = (await itemMap()).get(String(refId)); if (!it || it.giftable === false) abort('bad_item'); const u = await c.query('UPDATE sp_inventory SET qty = qty - $3 WHERE profile_id=$1 AND item_id=$2 AND qty >= $3 RETURNING 1', [me, refId, q]); if (!u.rowCount) abort('no_item'); }
    await c.query('INSERT INTO sp_gifts (id,from_id,to_id,kind,ref_id,qty,message) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, me, toId, kind, refId, q, msg]); return { ok: true, id };
  });
  if (r.ok) { const who = (await names([me]))[me]?.name ?? 'Кто-то'; await ping([toId], 'gift', 'Подарок для питомцев', `${who} прислал(а) вам подарок.`, { ref: r.id }); }
  return r;
};
export const myGifts = async (me) => {
  const { rows } = await query(`SELECT * FROM sp_gifts WHERE (to_id=$1 OR from_id=$1) AND status='pending' ORDER BY created_at DESC LIMIT 50`, [me]); const nm = await names(rows.flatMap((r) => [r.from_id, r.to_id])); const items = await itemMap();
  const eg = (await query('SELECT id,name FROM sp_eggs')).rows; const en = Object.fromEntries(eg.map((e) => [e.id, e.name]));
  const pe = (await query('SELECT id, egg_id FROM sp_player_eggs WHERE id = ANY($1::text[])', [rows.filter((r) => r.kind === 'egg').map((r) => r.ref_id)])).rows; const pm = Object.fromEntries(pe.map((p) => [p.id, p.egg_id]));
  return { gifts: rows.map((r) => ({ id: r.id, direction: r.to_id === me ? 'in' : 'out', from: nm[r.from_id], to: nm[r.to_id], kind: r.kind, qty: r.qty, message: r.message, name: r.kind === 'egg' ? en[pm[r.ref_id]] ?? 'Яйцо' : items.get(r.ref_id)?.name ?? r.ref_id, at: r.created_at })) };
};
export const answerGift = async (me, id, how) => {
  const notes = [];
  const r = await tx(async (c) => {
    const g = (await c.query('SELECT * FROM sp_gifts WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!g) abort('not_found'); if (g.status !== 'pending') abort('already_decided');
    const toMe = g.to_id === me, fromMe = g.from_id === me; if (!toMe && !(fromMe && how === 'cancel')) abort('not_found');
    const give = async (target) => { if (g.kind === 'egg') await c.query(`UPDATE sp_player_eggs SET state='unhatched', owner_id=$2, source='gift' WHERE id=$1`, [g.ref_id, target]); else await c.query('INSERT INTO sp_inventory (profile_id,item_id,qty) VALUES ($1,$2,$3) ON CONFLICT (profile_id,item_id) DO UPDATE SET qty = sp_inventory.qty + $3', [target, g.ref_id, g.qty]); };
    if (how === 'accept' && toMe) { await ensurePlayer(me, c); await give(me); await c.query(`UPDATE sp_gifts SET status='accepted', decided_at=now() WHERE id=$1`, [id]); notes.push([g.from_id, 'Подарок принят', 'Получатель принял ваш подарок.']); return { ok: true, status: 'accepted' }; }
    await give(g.from_id); const st = toMe ? 'declined' : 'cancelled'; await c.query(`UPDATE sp_gifts SET status=$2, decided_at=now() WHERE id=$1`, [id, st]); if (toMe) notes.push([g.from_id, 'Подарок отклонён', 'Подарок вернулся к вам.']); return { ok: true, status: st };
  });
  for (const [u, t, b] of notes) await ping([u], 'gift_answer', t, b, { important: false });
  return r;
};

// ───────────────────────────── передача и удаление (нужно согласие всех владельцев) ─────────────────────────────
export const startTransfer = async (me, petId, kind, toId = null) => {
  if (!['transfer', 'delete'].includes(kind)) return err('bad_kind');
  const notes = [];
  const r = await tx(async (c) => {
    const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) abort('not_found');
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((x) => x.profile_id); if (!owners.includes(me)) abort('not_found');
    if (kind === 'transfer') { if (!toId || owners.includes(toId)) abort('bad_target'); if (!(await c.query('SELECT 1 FROM profiles WHERE id=$1 AND deleted_at IS NULL', [toId])).rowCount) abort('not_found'); if (!(await mayWriteTo(toId, me))) abort('not_allowed'); }
    await c.query(`UPDATE sp_transfers SET status='expired', decided_at=now() WHERE pet_id=$1 AND status='pending' AND created_at < now() - interval '7 days'`, [petId]);
    const id = uid('ptr'); try { await c.query('INSERT INTO sp_transfers (id,pet_id,kind,from_id,to_id,owners,agreed) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, petId, kind, me, toId, owners, [me]]); } catch (e) { if (e.code === '23505') abort('already_pending'); throw e; }
    const need = owners.filter((o) => o !== me); if (need.length) notes.push([need, 'Нужно ваше согласие', `По питомцу «${pet.name}» ${kind === 'delete' ? 'предлагают удаление' : 'предлагают передачу'}.`, id]); if (toId) notes.push([[toId], 'Вам предлагают питомца', `Вам хотят передать питомца «${pet.name}».`, id]);
    return { ok: true, id, ...(await finish(c, id)) };
  });
  for (const [u, t, b, ref] of notes) await ping(u, 'transfer', t, b, { ref });
  return r;
};
const finish = async (c, id) => {
  const t = (await c.query('SELECT * FROM sp_transfers WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!t || t.status !== 'pending') return { status: t?.status };
  const all = [...t.owners, ...(t.to_id ? [t.to_id] : [])]; if (!all.every((x) => t.agreed.includes(x))) return { status: 'pending', waiting: all.filter((x) => !t.agreed.includes(x)).length };
  const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [t.pet_id])).rows[0]; const cur = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [t.pet_id])).rows.map((x) => x.profile_id).sort();
  if (!pet || JSON.stringify(cur) !== JSON.stringify([...t.owners].sort())) { await c.query(`UPDATE sp_transfers SET status='cancelled', decided_at=now() WHERE id=$1`, [id]); return { status: 'cancelled' }; }
  if (t.kind === 'delete') { await c.query('UPDATE sp_pets SET deleted_at=now() WHERE id=$1', [t.pet_id]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'deleted','{}')`, [t.pet_id, t.from_id]); }
  else { await ensurePlayer(t.to_id, c); await c.query('DELETE FROM sp_owners WHERE pet_id=$1 AND profile_id=$2', [t.pet_id, t.from_id]); await c.query('INSERT INTO sp_owners (pet_id,profile_id) VALUES ($1,$2)', [t.pet_id, t.to_id]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'transferred',$3)`, [t.pet_id, t.from_id, JSON.stringify({ to: t.to_id })]); }
  await c.query(`UPDATE sp_transfers SET status='done', decided_at=now() WHERE id=$1`, [id]); return { status: 'done' };
};
export const respondTransfer = async (me, id, agree) => {
  const notes = [];
  const r = await tx(async (c) => {
    const t = (await c.query('SELECT * FROM sp_transfers WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!t) abort('not_found');
    if (!t.owners.includes(me) && t.to_id !== me) abort('not_found'); if (t.status !== 'pending') abort('already_decided');
    if (Date.now() - new Date(t.created_at).getTime() > 7 * 864e5) { await c.query(`UPDATE sp_transfers SET status='expired', decided_at=now() WHERE id=$1`, [id]); abort('expired'); }
    if (!agree) { await c.query(`UPDATE sp_transfers SET status='declined', decided_at=now() WHERE id=$1`, [id]); notes.push([[...t.owners, t.to_id].filter((x) => x && x !== me), 'Предложение отклонено', 'Передача или удаление питомца отклонены.', id]); return { ok: true, status: 'declined' }; }
    if (!t.agreed.includes(me)) await c.query('UPDATE sp_transfers SET agreed = array_append(agreed, $2) WHERE id=$1', [id, me]);
    const f = await finish(c, id); if (f.status === 'done') notes.push([[...t.owners, t.to_id].filter(Boolean), 'Готово', t.kind === 'delete' ? 'Питомец удалён по согласию всех владельцев.' : 'Питомец передан.', id]); return { ok: true, ...f };
  });
  for (const [u, t, b, ref] of notes) await ping(u, 'transfer', t, b, { ref });
  return r;
};
export const myTransfers = async (me) => {
  const { rows } = await query(`SELECT t.*, p.name AS pet_name FROM sp_transfers t JOIN sp_pets p ON p.id=t.pet_id WHERE t.status='pending' AND ($1 = ANY(t.owners) OR t.to_id=$1) ORDER BY t.created_at DESC`, [me]); const nm = await names(rows.flatMap((r) => [...r.owners, r.to_id].filter(Boolean)));
  return { transfers: rows.map((r) => ({ id: r.id, petId: r.pet_id, petName: r.pet_name, kind: r.kind, from: nm[r.from_id], to: r.to_id ? nm[r.to_id] : null, owners: r.owners.map((o) => nm[o]), agreed: r.agreed, mineAgreed: r.agreed.includes(me), createdAt: r.created_at })) };
};
export const cancelTransfer = async (me, id) => { const r = await query(`UPDATE sp_transfers SET status='cancelled', decided_at=now() WHERE id=$1 AND from_id=$2 AND status='pending' RETURNING 1`, [id, me]); return r.rowCount ? { ok: true } : err('not_found'); };
export const inventory = async (me) => { await ensurePlayer(me); const { rows } = await query(`SELECT item_id, qty FROM sp_inventory WHERE profile_id=$1 AND qty > 0`, [me]); return rows; };
export { CATEGORIES, RARITIES, moodOf, BASE_ROOMS, ensureSeed };
