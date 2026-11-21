/**
 * Sky Pets — ядро: игрок, питомцы, яйца, совместное воспитание, дом, магазин, задания, достижения.
 * Всё решает сервер: клиент присылает только действие и идентификаторы (уровни, статы, шансы и цены он не задаёт).
 *  • Питомец не умирает и не теряет прогресс от бездействия: потребности «остывают» лениво при чтении (до пола 10),
 *    здоровье падает не ниже 30, уровень и опыт не уменьшаются никогда.
 *  • Действие над питомцем — одна транзакция под FOR UPDATE строки питомца: два владельца не затирают друг друга.
 *  • Валюта: игровые монеты (внутри Sky Pets) и баллы Prime через wallet.spendPointsIn в той же транзакции.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { inTx } from './gocore.mjs';
import { wallet } from './wallet.mjs';
import { notifyGift } from './giftnotify.mjs';
import { mayWriteTo } from './privacy.mjs';
import { checkContent } from './contentfilterstore.mjs';
import { pushGameServer } from './signal.mjs';
import { CATEGORIES, RARITIES, CHARACTERS, SKILLS, ROOMS, BASE_ROOMS, SPECIES, EVOLUTIONS, EGGS, ITEMS, TASKS, ACHIEVEMENTS, UNLOCKS, xpFor, levelReward } from './spdata.mjs';

export const err = (code, extra = {}) => ({ error: code, ...extra });
const uid = (p) => `${p}-${crypto.randomUUID()}`;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const clean = (v, n) => Array.from(String(v ?? '')).filter((c) => c.charCodeAt(0) > 31).join('').trim().slice(0, n);
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const week = (d = new Date()) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return `${t.getUTCFullYear()}-W${Math.ceil(((t - y0) / 864e5 + 1) / 7)}`; };
export const season = (d = new Date()) => { const m = d.getUTCMonth() + 1; return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'; };
const PUBLISHED = `status = 'published'`;

// ───────────────────────────── засев каталога ─────────────────────────────
let seeded = null;
export const ensureSeed = () => (seeded ??= (async () => {
  const { rows } = await query(`SELECT (SELECT count(*) FROM sp_species WHERE builtin)::int AS n, (SELECT count(*) FROM sp_items WHERE builtin)::int AS i`);
  if (rows[0].n >= SPECIES.length && rows[0].i >= ITEMS.length) return true;
  await inTx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pets-seed']);
    for (const s of SPECIES) {
      const ev = EVOLUTIONS[s.id];
      await c.query(`INSERT INTO sp_species (id,name,description,category,rarity,art,cost_coins,season,exclusive,builtin,status,evolves_to,evolve_level,base_stats)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,'published',$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.description ?? '', s.category, s.rarity, JSON.stringify(s.art), s.cost_coins ?? (s.rarity === 'common' ? 250 : 0), s.season ?? null, Boolean(s.exclusive), ev?.[0] ?? null, ev?.[1] ?? null, JSON.stringify({ energy: 80, satiety: 80, health: 100 })]);
    }
    for (const e of EGGS) {
      await c.query(`INSERT INTO sp_eggs (id,name,description,kind,rarity,art,price_coins,price_points,hatch_seconds,season,builtin,buyable,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,'published') ON CONFLICT (id) DO NOTHING`,
      [e.id, e.name, e.description ?? '', e.kind, e.rarity, JSON.stringify(e.art), e.price_coins, e.price_points, e.hatch_seconds, e.season ?? null, e.buyable !== false && (e.price_coins > 0 || e.price_points > 0)]);
      for (const [sid, w] of Object.entries(e.drops)) await c.query('INSERT INTO sp_egg_drops (egg_id,species_id,weight) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [e.id, sid, w]);
    }
    for (const i of ITEMS) {
      await c.query(`INSERT INTO sp_items (id,kind,name,description,category,rarity,art,effect,price_coins,price_points,builtin,shop,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,TRUE,'published') ON CONFLICT (id) DO NOTHING`,
      [i.id, i.kind, i.name, i.description ?? '', i.category, i.rarity, JSON.stringify(i.art), JSON.stringify(i.effect), i.price_coins, i.price_points]);
    }
    for (const t of TASKS) await c.query(`INSERT INTO sp_tasks (id,title,kind,action,target,reward,builtin,sort) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7) ON CONFLICT (id) DO NOTHING`, [t.id, t.title, t.kind, t.action, t.target, JSON.stringify(t.reward), t.sort]);
  });
  return true;
})().catch((e) => { seeded = null; throw e; }));

let itemCache = { at: 0, map: new Map() };
export const itemMap = async () => {
  if (Date.now() - itemCache.at < 20000) return itemCache.map;
  const { rows } = await query(`SELECT id, kind, name, rarity, effect, art, image_id, giftable FROM sp_items`);
  itemCache = { at: Date.now(), map: new Map(rows.map((r) => [r.id, r])) }; return itemCache.map;
};
export const dropItemCache = () => { itemCache.at = 0; };

// ───────────────────────────── игрок ─────────────────────────────
export const ensurePlayer = async (profileId, c = null) => {
  await ensureSeed();
  const run = async (cl) => {
    const ins = await cl.query('INSERT INTO sp_players (profile_id, coins) VALUES ($1, 200) ON CONFLICT DO NOTHING RETURNING profile_id', [profileId]);
    if (ins.rowCount) {
      await cl.query(`INSERT INTO sp_inventory (profile_id,item_id,qty) VALUES ($1,'food-kibble',5),($1,'toy-ball',1) ON CONFLICT DO NOTHING`, [profileId]);
      await cl.query(`INSERT INTO sp_player_eggs (id,owner_id,egg_id,source) VALUES ($1,$2,'egg-common','starter')`, [uid('peg'), profileId]);
      await cl.query('UPDATE sp_players SET starter_given = TRUE WHERE profile_id = $1', [profileId]);
    }
    const { rows } = await cl.query('SELECT * FROM sp_players WHERE profile_id = $1', [profileId]);
    return rows[0];
  };
  return c ? run(c) : inTx(run);
};

// ───────────────────────────── состояние питомца (ленивое) ─────────────────────────────
const FLOOR = 10;
/** Приводит потребности к «сейчас». Никогда не уменьшает уровень/опыт, не убивает: пол 10, здоровье ≥ 30. */
export const settle = (p, now = Date.now()) => {
  const o = { ...p }; const t0 = new Date(p.stat_at).getTime();
  let from = t0; let energy = Number(p.energy);
  if (p.sleeping_until) {
    const until = new Date(p.sleeping_until).getTime();
    if (now >= until) { energy = 100; from = until; o.sleeping_until = null; o.sleeping = false; o.awake_at_settle = true; }
    else { const k = (now - t0) / Math.max(1, until - t0); o.energy = Math.round(energy + (100 - energy) * clamp(k, 0, 1)); o.sleeping = true; o.satiety = p.satiety; o.hygiene = p.hygiene; o.fun = p.fun; o.health = p.health; return o; }
  }
  const h = clamp((now - from) / 3600000, 0, 72);
  o.energy = Math.round(clamp(energy - h * 2, FLOOR, 100));
  o.satiety = Math.round(clamp(p.satiety - h * 4, FLOOR, 100)); o.hygiene = Math.round(clamp(p.hygiene - h * 2, FLOOR, 100)); o.fun = Math.round(clamp(p.fun - h * 3, FLOOR, 100));
  let hp = Number(p.health); if (o.satiety < 25 || o.hygiene < 25) hp -= h * 1.5; else hp += h * 1;
  o.health = Math.round(clamp(hp, 30, 100)); o.sleeping = false;
  return o;
};
export const moodOf = (o) => {
  if (o.sleeping) return 'sleeping';
  if (o.health < 45) return 'sick'; if (o.satiety < 30) return 'hungry'; if (o.energy < 25) return 'tired'; if (o.hygiene < 25) return 'dirty'; if (o.fun < 30) return 'bored';
  const avg = (o.satiety + o.energy + o.fun + o.hygiene + o.health) / 5; return avg >= 80 ? 'happy' : avg >= 55 ? 'calm' : 'sad';
};
const needsOf = (o) => [o.satiety < 40 && 'feed', o.hygiene < 40 && 'bathe', o.fun < 40 && 'play', o.energy < 35 && 'sleep', o.health < 60 && 'heal'].filter(Boolean);
const skillOf = (skills) => Object.fromEntries(SKILLS.map((k) => [k, skills?.[k] ?? { l: 0, x: 0 }]));

const names = async (ids) => {
  if (!ids.length) return {};
  const { rows } = await query('SELECT id, name, username FROM profiles WHERE id = ANY($1::text[])', [[...new Set(ids)]]);
  return Object.fromEntries(rows.map((r) => [r.id, { id: r.id, name: r.name, username: r.username }]));
};

const speciesMap = async (ids) => {
  if (!ids.length) return {};
  const { rows } = await query('SELECT id,name,category,rarity,art,image_id,view,max_level,evolves_to,evolve_level,season FROM sp_species WHERE id = ANY($1::text[])', [[...new Set(ids)]]);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
};
const skinMap = async (ids) => {
  const list = [...new Set(ids.filter(Boolean))]; if (!list.length) return {};
  const { rows } = await query('SELECT id,species_id,name,rarity,art,image_id,view FROM sp_skins WHERE id = ANY($1::text[])', [list]);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
};

const view = (p, ownersOf, sp, skin, nm) => {
  const o = settle(p);
  return {
    id: p.id, name: p.name, speciesId: p.species_id, species: sp ? { id: sp.id, name: sp.name, category: sp.category, rarity: sp.rarity, art: sp.art, imageId: sp.image_id, view: sp.view, maxLevel: sp.max_level, season: sp.season } : null,
    skin: skin ? { id: skin.id, name: skin.name, rarity: skin.rarity, art: skin.art, imageId: skin.image_id, view: skin.view } : null,
    level: p.level, xp: Number(p.xp), xpNeed: xpFor(p.level), character: p.character, shared: p.shared, room: p.room,
    energy: o.energy, satiety: o.satiety, health: o.health, hygiene: o.hygiene, fun: o.fun, sleeping: Boolean(o.sleeping), sleepingUntil: o.sleeping ? p.sleeping_until : null,
    mood: moodOf(o), needs: needsOf(o), skills: skillOf(p.skills), accessories: p.accessories ?? [], source: p.source, bornAt: p.born_at,
    owners: (ownersOf ?? []).map((id) => nm?.[id] ?? { id }),
    canEvolve: Boolean(sp?.evolves_to && p.level >= (sp.evolve_level ?? 999)),
  };
};

const loadPets = async (where, params, me = null) => {
  const { rows } = await query(`SELECT p.*, (SELECT array_agg(o.profile_id ORDER BY o.joined_at) FROM sp_owners o WHERE o.pet_id = p.id) AS owner_ids,
      ${me ? `COALESCE((SELECT favorite FROM sp_owners f WHERE f.pet_id = p.id AND f.profile_id = '${String(me).replace(/'/g, '')}'), FALSE)` : 'FALSE'} AS fav
    FROM sp_pets p WHERE p.deleted_at IS NULL AND ${where} ORDER BY p.born_at`, params);
  const sps = await speciesMap(rows.map((r) => r.species_id)); const sk = await skinMap(rows.map((r) => r.skin_id)); const nm = await names(rows.flatMap((r) => r.owner_ids ?? []));
  return rows.map((r) => ({ ...view(r, r.owner_ids, sps[r.species_id], sk[r.skin_id], nm), favorite: r.fav }));
};

// ───────────────────────────── уведомления ─────────────────────────────
export const ping = async (userIds, kind, title, body, { important = true, ref = null, push = null } = {}) => {
  try {
    const ids = [...new Set(userIds)].filter(Boolean); if (!ids.length) return;
    const { rows } = await query('SELECT profile_id, notify FROM sp_players WHERE profile_id = ANY($1::text[])', [ids]); const pref = Object.fromEntries(rows.map((r) => [r.profile_id, r.notify]));
    for (const id of ids) { const n = pref[id] ?? 'all'; if (n === 'off' || (n === 'important' && !important)) continue; await notifyGift(id, `pets_${kind}`, title, body, ref); }
    pushGameServer(ids, { type: 'pets:changed', payload: push ?? { kind, ref } });
  } catch (e) { console.error('[pets] ping', e.message); }
};
const poke = (ids, payload) => { try { pushGameServer([...new Set(ids)].filter(Boolean), { type: 'pets:changed', payload }); } catch { /* сокет недоступен */ } };

// ───────────────────────────── награды ─────────────────────────────
export const grant = async (c, profileId, reward, source = 'reward') => {
  if (!reward) return {}; await ensurePlayer(profileId, c);
  if (reward.coins) await c.query('UPDATE sp_players SET coins = coins + $2 WHERE profile_id = $1', [profileId, Math.floor(reward.coins)]);
  for (const [id, q] of Object.entries(reward.items ?? {})) await c.query('INSERT INTO sp_inventory (profile_id,item_id,qty) VALUES ($1,$2,$3) ON CONFLICT (profile_id,item_id) DO UPDATE SET qty = sp_inventory.qty + $3', [profileId, id, q]);
  for (const [id, q] of Object.entries(reward.eggs ?? {})) for (let i = 0; i < q; i++) await c.query('INSERT INTO sp_player_eggs (id,owner_id,egg_id,source) VALUES ($1,$2,$3,$4)', [uid('peg'), profileId, id, source]);
  return reward;
};

// ───────────────────────────── ограничения частоты (против фарма) ─────────────────────────────
const CAPS = { feed: 40, play: 40, bathe: 12, walk: 12, teach: 24, heal: 12, sleep: 12, touch: 80, photo: 20, wake: 30 };
const bump = async (c, profileId, action, cap) => {
  const win = Math.floor(Date.now() / 3600000);
  const r = await c.query(`INSERT INTO sp_rate (profile_id,action,win,n) VALUES ($1,$2,$3,1) ON CONFLICT (profile_id,action,win) DO UPDATE SET n = sp_rate.n + 1 RETURNING n`, [profileId, action, win]);
  return r.rows[0].n <= cap;
};
const DAY_XP_CAP = 900;

// ───────────────────────────── дом: бонусы ─────────────────────────────
const houseFor = async (c, pet, ownerId) => {
  const where = pet.shared ? ['pet_id', pet.id] : ['profile_id', ownerId];
  const { rows } = await c.query(`SELECT * FROM sp_houses WHERE ${where[0]} = $1`, [where[1]]); return rows[0] ?? null;
};
const bonuses = async (house) => {
  const b = { energyRegen: 0, feedBonus: 0, funBonus: 0, skill: {} };
  if (!house) return b; const items = await itemMap();
  for (const p of house.placed ?? []) { const it = items.get(p.itemId); const e = it?.effect ?? {}; if (e.energyRegen) b.energyRegen = Math.max(b.energyRegen, e.energyRegen); if (e.feedBonus) b.feedBonus = Math.max(b.feedBonus, e.feedBonus); if (it?.kind === 'toy' && e.fun) b.funBonus = Math.max(b.funBonus, 3); if (e.skill && e.skillBonus) b.skill[e.skill] = (b.skill[e.skill] ?? 0) + e.skillBonus; }
  return b;
};

// ───────────────────────────── опыт и уровни ─────────────────────────────
const addXp = async (c, pet, xp, notes) => {
  const sp = (await c.query('SELECT max_level, name FROM sp_species WHERE id = $1', [pet.species_id])).rows[0];
  const max = sp?.max_level ?? 30; let { level } = pet; let x = Number(pet.xp) + xp; const gained = [];
  while (level < max && x >= xpFor(level)) { x -= xpFor(level); level++; gained.push(level); }
  if (level >= max) x = Math.min(x, xpFor(level) - 1);
  pet.level = level; pet.xp = x;
  if (gained.length) {
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id = $1', [pet.id])).rows.map((r) => r.profile_id);
    for (const lv of gained) { for (const o of owners) await grant(c, o, levelReward(lv), 'level'); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,NULL,'level_up',$2)`, [pet.id, JSON.stringify({ level: lv, unlock: UNLOCKS[lv] ?? null })]); }
    notes.push({ users: owners, kind: 'level', title: `${pet.name}: новый уровень ${level}`, body: UNLOCKS[level] ? `Открылось: ${UNLOCKS[level]}` : 'Награда за уровень уже в инвентаре.', ref: pet.id, important: true });
  }
  return gained;
};

// ───────────────────────────── задания / события ─────────────────────────────
const periodOf = (t) => (t.kind === 'daily' ? day() : t.kind === 'weekly' || t.kind === 'joint' ? week() : t.event_id ?? 'p');
const taskTick = async (c, profileIds, action, shared) => {
  const { rows } = await c.query(`SELECT * FROM sp_tasks WHERE active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now()) AND (action = $1 OR action = 'any' OR (action = 'joint' AND $2))`, [action, shared]);
  for (const t of rows) for (const pid of profileIds) {
    await c.query(`INSERT INTO sp_task_progress (profile_id,task_id,period,progress) VALUES ($1,$2,$3,1) ON CONFLICT (profile_id,task_id,period) DO UPDATE SET progress = LEAST(sp_task_progress.progress + 1, $4)`, [pid, t.id, periodOf(t), t.target]);
  }
};
const eventTick = async (c, pid, xp) => {
  const { rows } = await c.query(`SELECT id, metric FROM sp_events WHERE active AND starts_at <= now() AND ends_at > now() AND metric IN ('actions','xp')`);
  for (const e of rows) await c.query(`INSERT INTO sp_event_scores (event_id,profile_id,score) VALUES ($1,$2,$3) ON CONFLICT (event_id,profile_id) DO UPDATE SET score = sp_event_scores.score + $3`, [e.id, pid, e.metric === 'xp' ? xp : 1]);
};

// ───────────────────────────── ДЕЙСТВИЯ над питомцем ─────────────────────────────
const CARE = ['feed', 'play', 'bathe', 'sleep', 'heal', 'walk', 'teach', 'photo'];
export const act = async (me, petId, action, p = {}) => {
  if (!/^pet-[0-9a-f-]{36}$/.test(String(petId))) return err('not_found');
  await ensurePlayer(me);
  const notes = []; let result;
  const out = await inTx(async (c) => {
    const pet = (await c.query('SELECT * FROM sp_pets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id = $1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
    if (CAPS[action] && !(await bump(c, me, action, CAPS[action]))) return err('slow_down');
    const s = settle(pet); let { energy, satiety, health, hygiene, fun } = s; let sleepingUntil = s.sleeping ? pet.sleeping_until : null;
    const house = await houseFor(c, pet, owners[0]); const bn = await bonuses(house); const items = await itemMap();
    const inv = async (id) => Number((await c.query('SELECT qty FROM sp_inventory WHERE profile_id = $1 AND item_id = $2 FOR UPDATE', [me, id])).rows[0]?.qty ?? 0);
    const take = async (id) => c.query('UPDATE sp_inventory SET qty = qty - 1 WHERE profile_id = $1 AND item_id = $2', [me, id]);
    let xp = 0, coins = 0, skillName = null, skillXp = 0; const detail = {};
    if (s.sleeping && !['wake', 'touch', 'rename', 'favorite'].includes(action)) return err('sleeping', { until: pet.sleeping_until });
    switch (action) {
      case 'feed': { const it = items.get(String(p.itemId)); if (!it || it.kind !== 'food' || !it.effect?.satiety) return err('bad_item'); if (satiety >= 98) return err('already_full'); if (!(await inv(it.id))) return err('no_item'); await take(it.id);
        satiety = clamp(satiety + Math.round(it.effect.satiety * (1 + bn.feedBonus)), 0, 100); fun = clamp(fun + (it.effect.fun ?? 0), 0, 100); xp = it.effect.xp ?? 5; detail.item = it.id; break; }
      case 'heal': { const it = items.get(String(p.itemId)); if (!it || !it.effect?.health) return err('bad_item'); if (health >= 98) return err('already_healthy'); if (!(await inv(it.id))) return err('no_item'); await take(it.id); health = clamp(health + it.effect.health, 0, 100); xp = it.effect.xp ?? 6; detail.item = it.id; break; }
      case 'play': { if (energy < 15) return err('too_tired'); let gain = 10; xp = 5;
        if (p.itemId) { const it = items.get(String(p.itemId)); if (!it || it.kind !== 'toy') return err('bad_item'); const placed = (house?.placed ?? []).some((x) => x.itemId === it.id); if (!placed && !(await inv(it.id))) return err('no_item'); gain = it.effect?.fun ?? 10; xp += it.effect?.xp ?? 0; if (it.effect?.skill) { skillName = it.effect.skill; skillXp = it.effect.skillXp ?? 1; } detail.item = it.id; }
        fun = clamp(fun + gain + bn.funBonus, 0, 100); energy = clamp(energy - 10, 0, 100); hygiene = clamp(hygiene - 4, 0, 100); break; }
      case 'bathe': if (hygiene >= 90) return err('already_clean'); hygiene = 100; fun = clamp(fun - 3, 0, 100); xp = 4; break;
      case 'walk': { if (energy < 20) return err('too_tired'); if (satiety < 15) return err('too_hungry'); energy -= 15; fun = clamp(fun + 15, 0, 100); hygiene = clamp(hygiene - 10, 0, 100); satiety = clamp(satiety - 10, 0, 100); xp = 10; coins = 2 + crypto.randomInt(0, 4); detail.coins = coins; break; }
      case 'teach': { const sk = String(p.skill); if (!SKILLS.includes(sk)) return err('bad_skill'); if (energy < 15) return err('too_tired'); energy -= 10; fun = clamp(fun - 2, 0, 100); xp = 12; skillName = sk; skillXp = 1 + (bn.skill[sk] ?? 0); break; }
      case 'sleep': { const start = energy; if (start >= 95) return err('not_sleepy'); const rate = 40 * (1 + bn.energyRegen); const secs = clamp(Math.ceil(((100 - start) / rate) * 3600), 60, 6 * 3600); sleepingUntil = new Date(Date.now() + secs * 1000); xp = 3; detail.seconds = secs; break; }
      case 'wake': { if (!s.sleeping) return err('not_sleeping'); sleepingUntil = null; break; }
      case 'touch': fun = clamp(fun + 1, 0, 100); break;
      case 'photo': { const pose = clean(p.pose, 20) || 'sit'; const id = uid('pph'); const cnt = (await c.query(`SELECT count(*)::int AS n FROM sp_photos WHERE pet_id = $1 AND actor_id = $2 AND created_at > now() - interval '1 day'`, [petId, me])).rows[0].n; if (cnt >= 10) return err('slow_down');
        await c.query('INSERT INTO sp_photos (id,pet_id,actor_id,pose,caption,snapshot) VALUES ($1,$2,$3,$4,$5,$6)', [id, petId, me, pose, clean(p.caption, 80), JSON.stringify({ level: pet.level, mood: moodOf(settle(pet)), skin: pet.skin_id, accessories: pet.accessories })]); xp = 2; detail.photoId = id; break; }
      default: return err('bad_action');
    }
    // анти-фарм: суточный потолок опыта на человека и питомца
    if (xp > 0) { const used = Number((await c.query(`SELECT COALESCE(sum(xp),0) AS s FROM sp_history WHERE pet_id = $1 AND actor_id = $2 AND created_at >= date_trunc('day', now())`, [petId, me])).rows[0].s); if (used >= DAY_XP_CAP) { xp = 0; coins = 0; detail.capped = true; } else xp = Math.min(xp, DAY_XP_CAP - used); }
    pet.stat_at = new Date(); pet.energy = energy; pet.satiety = satiety; pet.health = health; pet.hygiene = hygiene; pet.fun = fun; pet.sleeping_until = sleepingUntil;
    if (action === 'sleep') { pet.stat_at = new Date(); }
    const skills = { ...(pet.skills ?? {}) };
    if (skillName && xp > 0) { const cur = skills[skillName] ?? { l: 0, x: 0 }; cur.x += skillXp; const cap = Math.min(10, Math.floor(pet.level / 2) + 1); while (cur.l < cap && cur.x >= (cur.l + 1) * 2) { cur.x -= (cur.l + 1) * 2; cur.l++; } if (cur.l >= cap) cur.x = Math.min(cur.x, (cur.l + 1) * 2 - 1); skills[skillName] = cur; detail.skill = skillName; detail.skillLevel = cur.l; }
    const gained = xp ? await addXp(c, pet, xp, notes) : [];
    await c.query(`UPDATE sp_pets SET energy=$2, satiety=$3, health=$4, hygiene=$5, fun=$6, stat_at=$7, sleeping_until=$8, level=$9, xp=$10, skills=$11, actions_total = actions_total + $12 WHERE id = $1`,
      [petId, pet.energy, pet.satiety, pet.health, pet.hygiene, pet.fun, pet.stat_at, pet.sleeping_until, pet.level, pet.xp, JSON.stringify(skills), CARE.includes(action) ? 1 : 0]);
    if (coins) await c.query('UPDATE sp_players SET coins = coins + $2 WHERE profile_id = $1', [me, coins]);
    if (action !== 'touch' && action !== 'wake') await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail,xp) VALUES ($1,$2,$3,$4,$5)`, [petId, me, action, JSON.stringify(detail), xp]);
    if (CARE.includes(action)) { await taskTick(c, pet.shared ? owners : [me], action, pet.shared); if (xp) await eventTick(c, me, xp); }
    if (pet.shared && owners.length > 1 && CARE.includes(action)) notes.push({ users: owners.filter((x) => x !== me), kind: 'partner_action', title: `${pet.name}: партнёр рядом`, body: ({ feed: 'Питомца покормили', play: 'С питомцем поиграли', bathe: 'Питомца искупали', sleep: 'Питомец лёг спать', heal: 'Питомца вылечили', walk: 'Питомец ушёл на прогулку', teach: 'Питомца учат новому', photo: 'Сделали фото питомца' })[action], ref: pet.id, important: false });
    result = { ok: true, xp, coins, levelUps: gained, ...detail };
    return { pet: pet.id, shared: pet.shared, owners };
  });
  if (out?.error) return out;
  for (const n of notes) await ping(n.users, n.kind, n.title, n.body, { important: n.important, ref: n.ref });
  poke(out.owners, { kind: 'pet', petId: out.pet });
  await achSweep(me, out.pet).catch(() => {});
  return { ...result, pet: (await petView(me, out.pet)).pet };
};

// ───────────────────────────── редкие действия ─────────────────────────────
export const rename = async (me, petId, name) => {
  const n = clean(name, 20); if (n.length < 2) return err('bad_name');
  const f = await checkContent('pet_name', me, [n]); if (f.action !== 'allow') return err('name_not_allowed');
  return inTx(async (c) => {
    const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
    await c.query('UPDATE sp_pets SET name=$2 WHERE id=$1', [petId, n]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'rename',$3)`, [petId, me, JSON.stringify({ from: pet.name, to: n })]);
    poke(owners, { kind: 'pet', petId }); return { ok: true, name: n };
  });
};
export const setFavorite = async (me, petId, on) => { const r = await query('UPDATE sp_owners SET favorite=$3 WHERE pet_id=$1 AND profile_id=$2', [petId, me, Boolean(on)]); return r.rowCount ? { ok: true } : err('not_found'); };
export const moveRoom = async (me, petId, room) => {
  if (!ROOMS.includes(room)) return err('bad_room');
  return inTx(async (c) => {
    const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
    const house = await houseFor(c, pet, owners[0]); if (house && !house.rooms.includes(room)) return err('room_locked');
    if (!house && !BASE_ROOMS.includes(room)) return err('room_locked');
    await c.query('UPDATE sp_pets SET room=$2 WHERE id=$1', [petId, room]); return { ok: true };
  });
};
export const setSkin = async (me, petId, skinId) => inTx(async (c) => {
  const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
  const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
  if (skinId) {
    const sk = (await c.query(`SELECT * FROM sp_skins WHERE id=$1 AND status='published'`, [skinId])).rows[0]; if (!sk || sk.species_id !== pet.species_id) return err('bad_skin');
    const own = (await c.query('SELECT 1 FROM sp_skin_owned WHERE profile_id=$1 AND skin_id=$2', [me, skinId])).rowCount > 0;
    const free = sk.price_coins === 0 && sk.price_points === 0 && (sk.unlock_level == null || pet.level >= sk.unlock_level);
    if (!own && !free) return err('skin_not_owned');
  }
  await c.query('UPDATE sp_pets SET skin_id=$2 WHERE id=$1', [petId, skinId || null]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'skin',$3)`, [petId, me, JSON.stringify({ skin: skinId || null })]);
  poke(owners, { kind: 'pet', petId }); return { ok: true };
});
const SLOT_LEVEL = { head: 3, neck: 8, body: 20 };
export const equip = async (me, petId, itemId) => inTx(async (c) => {
  const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
  const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
  const items = await itemMap(); const it = items.get(String(itemId)); if (!it || !['accessory', 'clothes'].includes(it.kind)) return err('bad_item');
  const slot = it.effect?.slot ?? 'head'; if (pet.level < (SLOT_LEVEL[slot] ?? 3)) return err('level_too_low', { need: SLOT_LEVEL[slot] ?? 3 });
  if (!Number((await c.query('SELECT qty FROM sp_inventory WHERE profile_id=$1 AND item_id=$2', [me, it.id])).rows[0]?.qty)) return err('no_item');
  const acc = (pet.accessories ?? []).filter((a) => a.slot !== slot); acc.push({ slot, itemId: it.id });
  await c.query('UPDATE sp_pets SET accessories=$2 WHERE id=$1', [petId, JSON.stringify(acc)]); poke(owners, { kind: 'pet', petId }); return { ok: true, accessories: acc };
});
export const unequip = async (me, petId, slot) => inTx(async (c) => {
  const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
  const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id); if (!owners.includes(me)) return err('not_found');
  const acc = (pet.accessories ?? []).filter((a) => a.slot !== slot); await c.query('UPDATE sp_pets SET accessories=$2 WHERE id=$1', [petId, JSON.stringify(acc)]); return { ok: true, accessories: acc };
});
export const evolve = async (me, petId) => {
  const notes = [];
  const r = await inTx(async (c) => {
    const pet = (await c.query('SELECT * FROM sp_pets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [petId])).rows[0]; if (!pet) return err('not_found');
    const owners = (await c.query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((x) => x.profile_id); if (!owners.includes(me)) return err('not_found');
    const sp = (await c.query('SELECT * FROM sp_species WHERE id=$1', [pet.species_id])).rows[0]; if (!sp?.evolves_to) return err('cannot_evolve');
    if (pet.level < (sp.evolve_level ?? 999)) return err('level_too_low', { need: sp.evolve_level }); const o = settle(pet); if (moodOf(o) === 'sick' || o.health < 70 || o.satiety < 40) return err('not_in_shape');
    const next = (await c.query(`SELECT id,name FROM sp_species WHERE id=$1 AND status='published'`, [sp.evolves_to])).rows[0]; if (!next) return err('cannot_evolve');
    await c.query('UPDATE sp_pets SET species_id=$2, skin_id=NULL WHERE id=$1', [petId, next.id]); await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'evolve',$3)`, [petId, me, JSON.stringify({ from: sp.id, to: next.id })]);
    notes.push({ users: owners, kind: 'evolve', title: `${pet.name} эволюционировал!`, body: `Теперь это «${next.name}».`, ref: petId }); return { ok: true, speciesId: next.id };
  });
  for (const n of notes) await ping(n.users, n.kind, n.title, n.body, { ref: n.ref });
  return r;
};

// ───────────────────────────── яйца ─────────────────────────────
const eggRow = (e, egg) => ({ id: e.id, eggId: e.egg_id, name: egg?.name, kind: egg?.kind, rarity: egg?.rarity, art: egg?.art, imageId: egg?.image_id, state: e.state, readyAt: e.ready_at, incubateAt: e.incubate_at, touches: e.touches, needTouches: egg?.interactions ?? 3, hatchSeconds: egg?.hatch_seconds, ownerId: e.owner_id, partnerId: e.partner_id, source: e.source,
  ready: e.state === 'incubating' && e.ready_at && new Date(e.ready_at).getTime() <= Date.now(), secondsLeft: e.state === 'incubating' && e.ready_at ? Math.max(0, Math.ceil((new Date(e.ready_at).getTime() - Date.now()) / 1000)) : null });
export const myEggs = async (me) => {
  const { rows } = await query(`SELECT * FROM sp_player_eggs WHERE (owner_id = $1 OR partner_id = $1) AND state <> 'hatched' AND state <> 'gifted' ORDER BY created_at`, [me]);
  const { rows: eg } = await query('SELECT * FROM sp_eggs WHERE id = ANY($1::text[])', [[...new Set(rows.map((r) => r.egg_id))]]); const m = Object.fromEntries(eg.map((e) => [e.id, e]));
  const nm = await names(rows.flatMap((r) => [r.owner_id, r.partner_id].filter(Boolean)));
  return rows.map((r) => ({ ...eggRow(r, m[r.egg_id]), owner: nm[r.owner_id], partner: r.partner_id ? nm[r.partner_id] : null }));
};
export const eggOdds = async (eggId) => {
  const e = (await query('SELECT * FROM sp_eggs WHERE id=$1', [eggId])).rows[0]; if (!e) return err('not_found');
  const { rows } = await query(`SELECT d.weight, s.id, s.name, s.rarity, s.art, s.image_id FROM sp_egg_drops d JOIN sp_species s ON s.id = d.species_id WHERE d.egg_id = $1 AND s.status = 'published' ORDER BY d.weight DESC`, [eggId]);
  const total = rows.reduce((a, r) => a + r.weight, 0);
  return { egg: { id: e.id, name: e.name, hatchSeconds: e.hatch_seconds, interactions: e.interactions }, total, drops: rows.map((r) => ({ speciesId: r.id, name: r.name, rarity: r.rarity, art: r.art, imageId: r.image_id, weight: r.weight, percent: total ? Math.round((r.weight / total) * 10000) / 100 : 0 })) };
};
const myEggLocked = async (c, me, id) => { const e = (await c.query('SELECT * FROM sp_player_eggs WHERE id=$1 FOR UPDATE', [id])).rows[0]; return e && (e.owner_id === me || e.partner_id === me) ? e : null; };
export const incubate = async (me, id) => inTx(async (c) => {
  const e = await myEggLocked(c, me, id); if (!e) return err('not_found'); if (e.state !== 'unhatched') return err('bad_state');
  const n = Number((await c.query(`SELECT count(*) AS n FROM sp_player_eggs WHERE state='incubating' AND (owner_id=$1 OR partner_id=$1)`, [me])).rows[0].n); if (n >= 3) return err('incubator_full');
  const egg = (await c.query('SELECT hatch_seconds FROM sp_eggs WHERE id=$1', [e.egg_id])).rows[0];
  const r = (await c.query(`UPDATE sp_player_eggs SET state='incubating', incubate_at=now(), ready_at = now() + ($2 || ' seconds')::interval WHERE id=$1 RETURNING ready_at`, [id, String(egg.hatch_seconds)])).rows[0];
  poke([e.owner_id, e.partner_id], { kind: 'egg', eggId: id }); return { ok: true, readyAt: r.ready_at };
});
export const touchEgg = async (me, id) => inTx(async (c) => {
  const e = await myEggLocked(c, me, id); if (!e) return err('not_found'); if (e.state !== 'incubating') return err('bad_state');
  const win = Math.floor(Date.now() / 15000); const r = await c.query(`INSERT INTO sp_rate (profile_id,action,win,n) VALUES ($1,'egg_touch',$2,1) ON CONFLICT (profile_id,action,win) DO UPDATE SET n = sp_rate.n + 1 RETURNING n`, [me, win]); if (r.rows[0].n > 1) return err('slow_down');
  const u = (await c.query('UPDATE sp_player_eggs SET touches = touches + 1 WHERE id=$1 RETURNING touches', [id])).rows[0]; poke([e.owner_id, e.partner_id], { kind: 'egg', eggId: id }); return { ok: true, touches: u.touches };
});
const pickDrop = (rows) => { const total = rows.reduce((a, r) => a + r.weight, 0); let n = crypto.randomInt(0, total); for (const r of rows) { if (n < r.weight) return r; n -= r.weight; } return rows[rows.length - 1]; };
export const hatch = async (me, id, nameIn) => {
  const notes = []; let petId, owners;
  const out = await inTx(async (c) => {
    const e = await myEggLocked(c, me, id); if (!e) return err('not_found'); if (e.state !== 'incubating') return err('bad_state');
    const egg = (await c.query('SELECT * FROM sp_eggs WHERE id=$1', [e.egg_id])).rows[0];
    if (new Date(e.ready_at).getTime() > Date.now()) return err('not_ready', { secondsLeft: Math.ceil((new Date(e.ready_at).getTime() - Date.now()) / 1000) });
    if (e.touches < (egg.interactions ?? 3)) return err('needs_interaction', { touches: e.touches, need: egg.interactions ?? 3 });
    const drops = (await c.query(`SELECT d.species_id AS id, d.weight, s.name, s.rarity, s.category FROM sp_egg_drops d JOIN sp_species s ON s.id=d.species_id WHERE d.egg_id=$1 AND s.status='published'`, [e.egg_id])).rows; if (!drops.length) return err('egg_empty');
    const sp = pickDrop(drops); let name = clean(nameIn, 20) || sp.name;
    if (nameIn) { const f = await checkContent('pet_name', me, [name]); if (f.action !== 'allow') return err('name_not_allowed'); }
    petId = uid('pet'); owners = [e.owner_id, e.partner_id].filter(Boolean); const shared = owners.length > 1;
    await c.query(`INSERT INTO sp_pets (id,species_id,name,character,shared,source) VALUES ($1,$2,$3,$4,$5,'egg')`, [petId, sp.id, name, CHARACTERS[crypto.randomInt(0, CHARACTERS.length)], shared]);
    for (const o of owners) await c.query('INSERT INTO sp_owners (pet_id,profile_id) VALUES ($1,$2)', [petId, o]);
    await c.query(`UPDATE sp_player_eggs SET state='hatched', pet_id=$2 WHERE id=$1`, [id, petId]);
    await c.query(`INSERT INTO sp_history (pet_id,actor_id,action,detail) VALUES ($1,$2,'hatched',$3)`, [petId, me, JSON.stringify({ egg: e.egg_id, rarity: sp.rarity })]);
    if (shared) await c.query('INSERT INTO sp_houses (id,pet_id,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [uid('phs'), petId, `Дом «${name}»`]);
    notes.push({ users: owners, kind: 'hatched', title: 'Яйцо вылупилось!', body: `Новый питомец: ${name} (${sp.name}).`, ref: petId });
    return { ok: true, speciesId: sp.id, rarity: sp.rarity };
  });
  if (out.error) return out;
  for (const n of notes) await ping(n.users, n.kind, n.title, n.body, { ref: n.ref });
  for (const o of owners) await achSweep(o, petId).catch(() => {});
  return { ...out, pet: (await petView(me, petId)).pet };
};

// ───────────────────────────── совместное воспитание: приглашения ─────────────────────────────
const INVITE_TTL_DAYS = 7;
export const invite = async (me, toId, playerEggId) => {
  if (!toId || toId === me) return err('bad_target');
  const to = (await query('SELECT id, name FROM profiles WHERE id=$1 AND deleted_at IS NULL', [toId])).rows[0]; if (!to) return err('not_found');
  if (!(await mayWriteTo(toId, me))) return err('not_allowed');
  await ensurePlayer(me);
  const r = await inTx(async (c) => {
    const e = (await c.query('SELECT * FROM sp_player_eggs WHERE id=$1 AND owner_id=$2 FOR UPDATE', [playerEggId, me])).rows[0]; if (!e) return err('not_found');
    if (!['unhatched', 'incubating'].includes(e.state) || e.partner_id) return err('bad_state');
    if ((await c.query(`SELECT 1 FROM sp_invites WHERE egg_id IS NOT NULL AND player_egg_id=$1 AND status='pending'`, [playerEggId])).rowCount) return err('already_invited');
    const out = Number((await c.query(`SELECT count(*) AS n FROM sp_invites WHERE from_id=$1 AND status='pending'`, [me])).rows[0].n); if (out >= 5) return err('too_many_invites');
    try { const id = uid('pin'); await c.query(`INSERT INTO sp_invites (id,from_id,to_id,egg_id,player_egg_id) VALUES ($1,$2,$3,$4,$5)`, [id, me, toId, e.egg_id, playerEggId]); return { ok: true, id }; }
    catch (x) { if (x.code === '23505') return err('already_invited'); throw x; }
  });
  if (r.error) return r;
  const meName = (await names([me]))[me]?.name ?? 'Кто-то';
  await ping([toId], 'invite', 'Питомец на двоих', `${meName} зовёт вас растить питомца вместе.`, { ref: r.id });
  return r;
};
export const respondInvite = async (me, id, accept) => {
  const notes = [];
  const r = await inTx(async (c) => {
    const inv = (await c.query('SELECT * FROM sp_invites WHERE id=$1 FOR UPDATE', [id])).rows[0]; if (!inv) return err('not_found');
    const canCancel = inv.from_id === me && accept === 'cancel';
    if (inv.to_id !== me && !canCancel) return err('not_found');
    if (inv.status !== 'pending') return err('already_decided');
    if (Date.now() - new Date(inv.created_at).getTime() > INVITE_TTL_DAYS * 864e5) { await c.query(`UPDATE sp_invites SET status='expired', decided_at=now() WHERE id=$1`, [id]); return err('expired'); }
    if (canCancel) { await c.query(`UPDATE sp_invites SET status='cancelled', decided_at=now() WHERE id=$1`, [id]); return { ok: true, status: 'cancelled' }; }
    if (!accept) { await c.query(`UPDATE sp_invites SET status='declined', decided_at=now() WHERE id=$1`, [id]); notes.push({ users: [inv.from_id], kind: 'invite_declined', title: 'Приглашение отклонено', body: 'Партнёр не готов растить питомца вместе.', ref: id, important: false }); return { ok: true, status: 'declined' }; }
    await ensurePlayer(me, c);
    const e = (await c.query('SELECT * FROM sp_player_eggs WHERE id=$1 FOR UPDATE', [inv.player_egg_id])).rows[0];
    if (!e || e.owner_id !== inv.from_id || e.partner_id || !['unhatched', 'incubating'].includes(e.state)) { await c.query(`UPDATE sp_invites SET status='cancelled', decided_at=now() WHERE id=$1`, [id]); return err('egg_unavailable'); }
    await c.query('UPDATE sp_player_eggs SET partner_id=$2 WHERE id=$1', [e.id, me]); await c.query(`UPDATE sp_invites SET status='accepted', decided_at=now() WHERE id=$1`, [id]);
    notes.push({ users: [inv.from_id], kind: 'invite_accepted', title: 'Приглашение принято', body: 'Теперь яйцо общее — выращивайте вместе.', ref: e.id }); return { ok: true, status: 'accepted', eggId: e.id };
  });
  for (const n of notes) await ping(n.users, n.kind, n.title, n.body, { ref: n.ref, important: n.important !== false });
  return r;
};
export const myInvites = async (me) => {
  await query(`UPDATE sp_invites SET status='expired', decided_at=now() WHERE status='pending' AND created_at < now() - interval '${INVITE_TTL_DAYS} days'`);
  const { rows } = await query(`SELECT * FROM sp_invites WHERE (from_id=$1 OR to_id=$1) AND status='pending' ORDER BY created_at DESC`, [me]);
  const nm = await names(rows.flatMap((r) => [r.from_id, r.to_id])); const { rows: eg } = await query('SELECT id,name,art FROM sp_eggs WHERE id = ANY($1::text[])', [rows.map((r) => r.egg_id)]); const em = Object.fromEntries(eg.map((e) => [e.id, e]));
  return rows.map((r) => ({ id: r.id, direction: r.from_id === me ? 'out' : 'in', from: nm[r.from_id], to: nm[r.to_id], egg: em[r.egg_id], createdAt: r.created_at }));
};

// ───────────────────────────── просмотр ─────────────────────────────
const achState = async (q, key, me, pet) => {
  const A = ACHIEVEMENTS.find((a) => a.key === key); if (!A) return null;
  const cnt = async (sql, p) => Number((await q(sql, p)).rows[0].n);
  let progress = 0, target = 1;
  switch (key) {
    case 'first_pet': progress = await cnt(`SELECT count(*) AS n FROM sp_owners o JOIN sp_pets p ON p.id=o.pet_id AND p.deleted_at IS NULL WHERE o.profile_id=$1`, [me]); break;
    case 'collect_5': case 'collect_10': target = key === 'collect_5' ? 5 : 10; progress = await cnt(`SELECT count(DISTINCT p.species_id) AS n FROM sp_owners o JOIN sp_pets p ON p.id=o.pet_id AND p.deleted_at IS NULL WHERE o.profile_id=$1`, [me]); break;
    case 'first_shared': progress = pet?.shared ? 1 : 0; break;
    case 'joint_days_3': case 'joint_days_7': case 'joint_days_30': target = Number(key.split('_')[2]); progress = pet?.shared ? await cnt(`SELECT count(*) AS n FROM (SELECT created_at::date FROM sp_history WHERE pet_id=$1 AND actor_id IS NOT NULL AND action = ANY($2::text[]) GROUP BY 1 HAVING count(DISTINCT actor_id) >= 2) t`, [pet.id, CARE]) : 0; break;
    case 'joint_actions_100': target = 100; progress = pet?.shared ? await cnt(`SELECT count(*) AS n FROM sp_history WHERE pet_id=$1 AND actor_id IS NOT NULL AND action = ANY($2::text[])`, [pet.id, CARE]) : 0; break;
    case 'shared_level_10': target = 10; progress = pet?.shared ? pet.level : 0; break;
    case 'shared_rare': progress = pet?.shared && pet.rarity && pet.rarity !== 'common' ? 1 : 0; break;
    case 'level_10': target = 10; progress = pet?.level ?? 0; break;
    default: return null;
  }
  return { key, title: A.title, reward: A.reward, scope: A.scope, shared: Boolean(A.shared), progress: Math.min(progress, target), target, ready: progress >= target };
};
const sweepKeys = (pet) => ACHIEVEMENTS.filter((a) => (a.scope === 'pet' ? !a.shared || pet?.shared : true)).map((a) => a.key);
const achSweep = async (me, petId) => {
  const pet = (await query(`SELECT p.*, s.rarity FROM sp_pets p JOIN sp_species s ON s.id=p.species_id WHERE p.id=$1 AND p.deleted_at IS NULL`, [petId])).rows[0]; if (!pet) return;
  const owners = (await query('SELECT profile_id FROM sp_owners WHERE pet_id=$1', [petId])).rows.map((r) => r.profile_id);
  for (const key of sweepKeys(pet)) {
    const A = ACHIEVEMENTS.find((a) => a.key === key);
    for (const o of owners) {
      const st = await achState((s, p) => query(s, p), key, o, pet); if (!st?.ready) continue;
      const scopeId = A.scope === 'pet' ? petId : '';
      const mark = await query(`INSERT INTO sp_ach_claims (profile_id,key,pet_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`, [o, `n:${key}`, scopeId]);
      if (mark.rowCount) await ping([o], 'achievement', `Достижение: ${A.title}`, 'Заберите награду в разделе «Достижения».', { ref: key });
    }
  }
};
export const achievements = async (me, petId = null) => {
  await ensurePlayer(me);
  const pets = (await query(`SELECT p.*, s.rarity FROM sp_pets p JOIN sp_owners o ON o.pet_id=p.id AND o.profile_id=$1 JOIN sp_species s ON s.id=p.species_id WHERE p.deleted_at IS NULL ${petId ? 'AND p.id=$2' : ''} ORDER BY p.born_at`, petId ? [me, petId] : [me])).rows;
  const claims = new Set((await query(`SELECT key||'|'||pet_id AS k FROM sp_ach_claims WHERE profile_id=$1`, [me])).rows.map((r) => r.k)); const out = [];
  for (const A of ACHIEVEMENTS) {
    if (A.scope === 'player') { if (petId) continue; const st = await achState((s, p) => query(s, p), A.key, me, null); out.push({ ...st, claimed: claims.has(`${A.key}|`) }); }
    else for (const p of pets) { if (A.shared && !p.shared) continue; const st = await achState((s, q) => query(s, q), A.key, me, p); out.push({ ...st, petId: p.id, petName: p.name, claimed: claims.has(`${A.key}|${p.id}`) }); }
  }
  return { achievements: out };
};
export const claimAchievement = async (me, key, petId = null) => {
  const A = ACHIEVEMENTS.find((a) => a.key === key); if (!A) return err('not_found');
  return inTx(async (c) => {
    let pet = null;
    if (A.scope === 'pet') {
      pet = (await c.query(`SELECT p.*, s.rarity FROM sp_pets p JOIN sp_owners o ON o.pet_id=p.id AND o.profile_id=$2 JOIN sp_species s ON s.id=p.species_id WHERE p.id=$1 AND p.deleted_at IS NULL`, [petId, me])).rows[0]; if (!pet) return err('not_found');
      if (A.shared && !pet.shared) return err('not_ready');
    }
    const st = await achState((s, p) => c.query(s, p), key, me, pet); if (!st?.ready) return err('not_ready');
    const ins = await c.query(`INSERT INTO sp_ach_claims (profile_id,key,pet_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1`, [me, key, A.scope === 'pet' ? petId : '']); if (!ins.rowCount) return err('already_claimed');
    await grant(c, me, A.reward, 'achievement'); return { ok: true, reward: A.reward };
  });
};

export const petView = async (me, petId) => {
  if (!/^pet-[0-9a-f-]{36}$/.test(String(petId))) return err('not_found');
  const mine = (await query('SELECT 1 FROM sp_owners WHERE pet_id=$1 AND profile_id=$2', [petId, me])).rowCount; if (!mine) return err('not_found');
  const [pet] = await loadPets('p.id = $1', [petId], me); if (!pet) return err('not_found');
  const { rows: hist } = await query('SELECT id, actor_id, action, detail, xp, created_at FROM sp_history WHERE pet_id=$1 ORDER BY id DESC LIMIT 40', [petId]);
  const nm = await names(hist.map((h) => h.actor_id).filter(Boolean)); const items = await itemMap();
  const track = []; for (let l = pet.level + 1; l <= Math.min(pet.level + 8, pet.species?.maxLevel ?? 30); l++) track.push({ level: l, reward: levelReward(l), unlock: UNLOCKS[l] ?? null });
  const { rows: photos } = await query('SELECT id, pose, caption, actor_id, snapshot, created_at FROM sp_photos WHERE pet_id=$1 ORDER BY created_at DESC LIMIT 12', [petId]);
  const ach = (await achievements(me, petId)).achievements; const { rows: skins } = await query(`SELECT s.id,s.name,s.rarity,s.art,s.image_id,s.view,s.price_coins,s.price_points,s.unlock_level, (o.skin_id IS NOT NULL) AS owned FROM sp_skins s LEFT JOIN sp_skin_owned o ON o.skin_id=s.id AND o.profile_id=$2 WHERE s.species_id=$1 AND s.status='published' ORDER BY s.created_at`, [pet.speciesId, me]);
  return { pet, history: hist.map((h) => ({ id: h.id, action: h.action, xp: h.xp, at: h.created_at, detail: h.detail, actor: h.actor_id ? nm[h.actor_id] ?? { id: h.actor_id } : null })), levelTrack: track,
    photos: photos.map((p) => ({ id: p.id, pose: p.pose, caption: p.caption, at: p.created_at, actor: p.actor_id, snapshot: p.snapshot })), achievements: ach, skins: skins.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, art: s.art, imageId: s.image_id, view: s.view, owned: s.owned || (s.price_coins === 0 && s.price_points === 0 && (s.unlock_level == null || pet.level >= s.unlock_level)), priceCoins: s.price_coins, pricePoints: s.price_points, unlockLevel: s.unlock_level })),
    foodItems: [...items.values()].filter((i) => i.kind === 'food').map((i) => ({ id: i.id, name: i.name })) };
};

export const overview = async (me) => {
  const player = await ensurePlayer(me); const pets = await loadPets(`EXISTS (SELECT 1 FROM sp_owners o WHERE o.pet_id = p.id AND o.profile_id = $1)`, [me], me);
  const eggs = await myEggs(me); const { rows: inv } = await query(`SELECT i.item_id, i.qty FROM sp_inventory i WHERE i.profile_id=$1 AND i.qty > 0`, [me]); const items = await itemMap();
  const { rows: gifts } = await query(`SELECT count(*)::int AS n FROM sp_gifts WHERE to_id=$1 AND status='pending'`, [me]); const { rows: trs } = await query(`SELECT count(*)::int AS n FROM sp_transfers WHERE status='pending' AND ($1 = ANY(owners) OR to_id=$1) AND NOT ($1 = ANY(agreed))`, [me]);
  return { player: { coins: Number(player.coins), visitPolicy: player.visit_policy, notify: player.notify, dailyAvailable: String(player.daily_at ? day(new Date(player.daily_at)) : '') !== day() }, pets, eggs, inventory: inv.map((r) => ({ itemId: r.item_id, qty: r.qty, item: items.get(r.item_id) ? { id: r.item_id, kind: items.get(r.item_id).kind, name: items.get(r.item_id).name, rarity: items.get(r.item_id).rarity, art: items.get(r.item_id).art, imageId: items.get(r.item_id).image_id, effect: items.get(r.item_id).effect } : null })),
    invites: await myInvites(me), pending: { gifts: gifts[0].n, transfers: trs[0].n }, season: season() };
};
export const petsWith = async (me, peerId) => loadPets(`p.shared AND EXISTS (SELECT 1 FROM sp_owners a WHERE a.pet_id=p.id AND a.profile_id=$1) AND EXISTS (SELECT 1 FROM sp_owners b WHERE b.pet_id=p.id AND b.profile_id=$2)`, [me, peerId], me);

export const settings = async (me, b) => {
  await ensurePlayer(me); const sets = []; const vals = [me];
  if (b.visitPolicy) { if (!['all', 'friends', 'none'].includes(b.visitPolicy)) return err('bad_value'); vals.push(b.visitPolicy); sets.push(`visit_policy=$${vals.length}`); }
  if (b.notify) { if (!['all', 'important', 'off'].includes(b.notify)) return err('bad_value'); vals.push(b.notify); sets.push(`notify=$${vals.length}`); }
  if (sets.length) await query(`UPDATE sp_players SET ${sets.join(',')} WHERE profile_id=$1`, vals); return { ok: true };
};
export const daily = async (me) => {
  await ensurePlayer(me);
  const r = await query(`UPDATE sp_players SET coins = coins + 30, daily_at = CURRENT_DATE WHERE profile_id=$1 AND daily_at IS DISTINCT FROM CURRENT_DATE RETURNING coins`, [me]);
  return r.rowCount ? { ok: true, coins: 30, balance: Number(r.rows[0].coins) } : err('already_claimed');
};
export const SUPPORTED = { CATEGORIES, RARITIES };
export { names, loadPets, uid, clean, day, week, clamp, houseFor, bonuses, taskTick, eventTick, achSweep, poke, view };
