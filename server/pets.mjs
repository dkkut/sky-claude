/**
 * Sky Pets — коллекционные питомцы профиля: типы, экземпляры, уход,
 * прогрессия (XP/уровень/стадия), характеристики.
 *
 * Расширяет то немногое полезное, что уже было в клиент-локальном
 * прототипе (src/messenger/petData.ts — 12 персонажей с именем/видом/
 * цветом/звуками/редкостью): эти же 12 типов сидятся сюда как стартовый
 * каталог (seedPetTypes), а не придумываются заново. Вся прогрессия,
 * характеристики, кулдауны ухода и валюта (Pet Coins — см. petEconomy.mjs)
 * теперь считает только сервер: клиент никогда не присылает XP, редкость,
 * характеристики или результат кулдауна — только «я нажал покормить».
 */
import { query, pool } from './db.mjs';
import { generateId } from './security.mjs';
import { can } from './admin.mjs';
import { earnCoins, spendCoins, trackMetric } from './petEconomy.mjs';

const inTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'secret'];
export const STAGES = ['baby', 'young', 'adult', 'special'];
export const CARE_ACTIONS = ['feed', 'play', 'pet', 'sleep', 'walk', 'toy'];
export const MOODS = ['idle', 'happy', 'excited', 'sleepy', 'love', 'angry'];

const STAT_MIN = 20; // «показатели могут снижаться до минимального значения без необратимых последствий» — не 0.
const STAT_MAX = 100;
const clampStat = (v) => Math.min(STAT_MAX, Math.max(STAT_MIN, Math.round(v)));

/** Уход — cooldown в секундах и эффект на характеристики/XP. */
const CARE_CFG = {
  feed:  { cooldown: 300,  xp: 10, effect: { hunger: +30, happiness: +5,  energy: +5  } },
  play:  { cooldown: 480,  xp: 15, effect: { happiness: +25, energy: -15, hunger: -5  } },
  pet:   { cooldown: 120,  xp: 5,  effect: { happiness: +10, loyalty: +3 } },
  sleep: { cooldown: 1200, xp: 10, effect: { energy: +50, happiness: +5 } },
  walk:  { cooldown: 600,  xp: 15, effect: { happiness: +15, energy: -10, loyalty: +2 } },
  toy:   { cooldown: 480,  xp: 10, effect: { happiness: +20, intelligence: +2 } },
};
/** Реакция питомца сразу после действия — для клиента, не влияет на баланс. */
const CARE_REACTION = { feed: 'happy', play: 'excited', pet: 'love', sleep: 'sleepy', walk: 'excited', toy: 'happy' };

/** 12 персонажей старого локального прототипа — стартовый каталог типов. */
const SEED_TYPES = [
  { id: 'cat-neon',      name: 'Неон',       species: 'Кот',       color: '#a855f7', rarity: 'common',    desc: 'Игривый фиолетовый котик. Любит лазерные указки и ночные прогулки.', from: 'starter' },
  { id: 'fox-sky',       name: 'Скай',       species: 'Лиса',      color: '#f59e0b', rarity: 'rare',      desc: 'Хитрая рыжая лиса. Умеет предсказывать погоду и воровать носки.',   from: 'shop', price: 2500 },
  { id: 'dragon-mini',   name: 'Дракончик',  species: 'Дракон',    color: '#10b981', rarity: 'epic',      desc: 'Маленький дракончик из Sky Arena. Выдыхает зелёный огонь и пиксели.', from: 'shop', price: 8000 },
  { id: 'bunny-pixel',   name: 'Пиксель',    species: 'Кролик',    color: '#f43f5e', rarity: 'common',    desc: 'Быстрый белый кролик. Всегда опаздывает и везде прыгает.',          from: 'shop', price: 500 },
  { id: 'wolf-void',     name: 'Войд',       species: 'Волк',      color: '#6366f1', rarity: 'epic',      desc: 'Таинственный волк из пустоты. Воет на луну и слушает lo-fi.',        from: 'shop', price: 8000 },
  { id: 'panda-zen',     name: 'Дзен',       species: 'Панда',     color: '#34d399', rarity: 'rare',      desc: 'Флегматичная панда. Ест бамбук, медитирует, иногда подмигивает.',   from: 'shop', price: 2500 },
  { id: 'unicorn-sky',   name: 'Звёздочка',  species: 'Единорог',  color: '#ec4899', rarity: 'legendary', desc: 'Легендарный единорог Sky. Оставляет радужные следы и исполняет желания.', from: 'shop', price: 20000 },
  { id: 'penguin-ice',   name: 'Айс',        species: 'Пингвин',   color: '#3b82f6', rarity: 'rare',      desc: 'Крутой пингвин из Антарктиды. DJ на льдинах, чемпион по скольжению.', from: 'shop', price: 2500 },
  { id: 'shark-reef',    name: 'Рифф',       species: 'Акула',     color: '#0ea5e9', rarity: 'epic',      desc: 'Дружелюбный акулёнок из кораллового рифа. Обожает пузыри и погони за курсором.', from: 'shop', price: 8000 },
  { id: 'capybara-chill',name: 'Чилл',       species: 'Капибара',  color: '#a16207', rarity: 'rare',      desc: 'Невозмутимая капибара. Ничего не боится, всем рада, любит тёплые лужи.', from: 'shop', price: 2500 },
  { id: 'robot-byte',    name: 'Байт',       species: 'Робот',     color: '#64748b', rarity: 'epic',      desc: 'Маленький дроид Sky Lab. Пищит на двоичном, обожает апдейты прошивки.', from: 'shop', price: 8000 },
  { id: 'ghost-boo',     name: 'Бу',         species: 'Привидение',color: '#c4b5fd', rarity: 'legendary', desc: 'Дружелюбное привидение Sky. Просачивается сквозь интерфейс и пугает в шутку.', from: 'shop', price: 20000 },
];

let seeded = false;
/** Идемпотентный сид — вызывается лениво при первом обращении к каталогу. */
export const seedPetTypes = async () => {
  if (seeded) return;
  for (const t of SEED_TYPES) {
    await query(
      `INSERT INTO pet_types (id, name, species, description, base_color, base_rarity, price_pet_coins, available_from)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [t.id, t.name, t.species, t.desc, t.color, t.rarity, t.price ?? null, t.from],
    );
  }
  seeded = true;
};

const toPetTypeRow = (r) => ({
  id: r.id, name: r.name, species: r.species, description: r.description,
  color: r.base_color, rarity: r.base_rarity,
  pricePetCoins: r.price_pet_coins ?? null, availableFrom: r.available_from,
  status: r.status,
});

export const listPetTypes = async () => {
  await seedPetTypes();
  const { rows } = await query(`SELECT * FROM pet_types WHERE status = 'active' ORDER BY created_at`);
  return rows.map(toPetTypeRow);
};

const getConfig = async (key, fallback) => {
  const { rows } = await query('SELECT value FROM pet_config WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
};

const xpForLevel = async (level) => {
  const base = Number(await getConfig('xp_per_level_base', 200));
  return level * base;
};

const stageForLevel = (level) =>
  level >= 30 ? 'special' : level >= 15 ? 'adult' : level >= 5 ? 'young' : 'baby';

/** Пассивное угасание характеристик — считается лениво при каждом чтении,
 *  а не таймером: неактивный питомец не «тикает» впустую на сервере. */
const applyDecay = (pet) => {
  const hours = Math.min((Date.now() - new Date(pet.stats_updated_at).getTime()) / 3_600_000, 48);
  if (hours < 0.05) return pet;
  const decay = (v, rate) => clampStat(v - hours * rate);
  return {
    ...pet,
    happiness: decay(pet.happiness, 2),
    energy: decay(pet.energy, 2.5),
    hunger: decay(pet.hunger, 3),
    stats_updated_at: new Date(),
  };
};

const toPetRow = (r, typeRow) => ({
  id: r.id, typeId: r.type_id, type: typeRow ? toPetTypeRow(typeRow) : undefined,
  name: r.name, rarity: r.rarity, level: r.level, xp: r.xp,
  stage: r.stage, stageHistory: r.stage_history, mood: r.mood,
  happiness: r.happiness, energy: r.energy, hunger: r.hunger,
  loyalty: r.loyalty, intelligence: r.intelligence, luck: r.luck,
  isActive: r.is_active, acquisitionSource: r.acquisition_source, acquiredAt: r.acquired_at,
});

const withType = async (petRows) => {
  if (!petRows.length) return [];
  const typeIds = [...new Set(petRows.map((p) => p.type_id))];
  const { rows: types } = await query('SELECT * FROM pet_types WHERE id = ANY($1)', [typeIds]);
  const byId = new Map(types.map((t) => [t.id, t]));
  return petRows.map((p) => toPetRow(applyDecay(p), byId.get(p.type_id)));
};

/** Полный список питомцев профиля (для коллекции), плюс автогрант
 *  стартового питомца тем, у кого пока нет ни одного. */
export const getMyPets = async (profileId) => {
  await seedPetTypes();
  let { rows } = await query('SELECT * FROM pets WHERE profile_id = $1 ORDER BY created_at', [profileId]);
  if (rows.length === 0) {
    await createPet(profileId, 'cat-neon', { source: 'starter', makeActive: true });
    ({ rows } = await query('SELECT * FROM pets WHERE profile_id = $1 ORDER BY created_at', [profileId]));
  }
  return withType(rows);
};

/** Один питомец с проверкой владения — иначе IDOR: чужой petId вернул бы чужого питомца. */
const getOwnedPetRow = async (profileId, petId) => {
  const { rows } = await query('SELECT * FROM pets WHERE id = $1 AND profile_id = $2', [petId, profileId]);
  return rows[0] ?? null;
};

/** Выдать новому/купленному питомцу редкость — базовая редкость типа,
 *  с небольшим шансом апгрейда через удачу владельца (косметическая
 *  случайность коллекционирования, не влияет на реальные деньги). */
const rollRarity = (baseRarity) => {
  const idx = RARITIES.indexOf(baseRarity);
  if (Math.random() < 0.05 && idx < RARITIES.length - 1) return RARITIES[idx + 1];
  return baseRarity;
};

export const createPet = async (profileId, typeId, { source = 'shop', makeActive = false } = {}) => {
  await seedPetTypes();
  const { rows: types } = await query(`SELECT * FROM pet_types WHERE id = $1 AND status = 'active'`, [typeId]);
  const type = types[0];
  if (!type) return { error: 'not_found' };

  if (source === 'shop') {
    if (type.available_from !== 'shop' || type.price_pet_coins === null) return { error: 'not_purchasable' };
    const spend = await spendCoins(profileId, type.price_pet_coins, 'spend_shop', `Питомец «${type.name}»`, `pet-type:${typeId}`);
    if (spend.error) return spend;
  }

  const id = `pet-${generateId()}`;
  await pool.query(
    `INSERT INTO pets (id, profile_id, type_id, name, rarity, acquisition_source, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, profileId, typeId, type.name, rollRarity(type.base_rarity), source, false],
  );
  if (makeActive) await setActivePet(profileId, id);
  await trackMetric(profileId, 'pets_owned', 1);
  const { rows } = await query('SELECT * FROM pets WHERE id = $1', [id]);
  return { pet: (await withType(rows))[0] };
};

export const setActivePet = async (profileId, petId) => {
  const pet = await getOwnedPetRow(profileId, petId);
  if (!pet) return { error: 'not_found' };
  await inTransaction(async (c) => {
    await c.query('UPDATE pets SET is_active = false WHERE profile_id = $1', [profileId]);
    await c.query('UPDATE pets SET is_active = true, updated_at = now() WHERE id = $1', [petId]);
  });
  const { rows } = await query('SELECT * FROM pets WHERE id = $1', [petId]);
  return { pet: (await withType(rows))[0] };
};

export const renamePet = async (profileId, petId, rawName) => {
  const name = String(rawName ?? '').trim().slice(0, 24);
  if (!name) return { error: 'bad_name' };
  const pet = await getOwnedPetRow(profileId, petId);
  if (!pet) return { error: 'not_found' };
  await query('UPDATE pets SET name = $2, updated_at = now() WHERE id = $1', [petId, name]);
  const { rows } = await query('SELECT * FROM pets WHERE id = $1', [petId]);
  return { pet: (await withType(rows))[0] };
};

/** Уход — единственная точка, откуда меняются характеристики/XP/уровень.
 *  Кулдаун проверяется по журналу на сервере, а не по значению из клиента. */
export const careForPet = async (profileId, petId, action) => {
  const cfg = CARE_CFG[action];
  if (!cfg) return { error: 'bad_action' };
  const pet = await getOwnedPetRow(profileId, petId);
  if (!pet) return { error: 'not_found' };

  const { rows: last } = await query(
    `SELECT created_at FROM pet_care_log WHERE pet_id = $1 AND action = $2 ORDER BY created_at DESC LIMIT 1`,
    [petId, action],
  );
  if (last.length) {
    const remaining = cfg.cooldown - (Date.now() - new Date(last[0].created_at).getTime()) / 1000;
    if (remaining > 0) return { error: 'cooldown', remainingSeconds: Math.ceil(remaining) };
  }

  const decayed = applyDecay(pet);
  const next = { ...decayed };
  for (const [k, delta] of Object.entries(cfg.effect)) {
    next[k] = ['happiness', 'energy', 'hunger'].includes(k) ? clampStat(next[k] + delta)
      : Math.min(100, Math.max(0, Math.round(next[k] + delta)));
  }

  const maxLevel = Number(await getConfig('max_level', 50));
  let xp = next.xp + cfg.xp;
  let level = next.level;
  while (level < maxLevel && xp >= (await xpForLevel(level))) {
    xp -= await xpForLevel(level);
    level += 1;
  }

  // «Дни вместе» — считаем ДО того, как запишем сегодняшнее действие в
  // журнал, иначе собственная же запись всегда «находилась» бы там.
  const { rows: careToday } = await query(
    `SELECT 1 FROM pet_care_log WHERE pet_id IN (SELECT id FROM pets WHERE profile_id = $1)
       AND created_at >= date_trunc('day', now()) LIMIT 1`,
    [profileId],
  );
  const isFirstToday = careToday.length === 0;

  await query(
    `UPDATE pets SET happiness=$2, energy=$3, hunger=$4, loyalty=$5, intelligence=$6,
       mood=$7, xp=$8, level=$9, stats_updated_at=now(), updated_at=now()
     WHERE id = $1`,
    [petId, next.happiness, next.energy, next.hunger, next.loyalty, next.intelligence,
      CARE_REACTION[action], xp, level],
  );
  await query(
    `INSERT INTO pet_care_log (id, pet_id, action) VALUES ($1,$2,$3)`,
    [`pcl-${generateId()}`, petId, action],
  );

  // Шанс на Pet Coins от ухода — растёт от удачи питомца, но это игровая,
  // не денежная случайность (см. petEconomy.mjs: Pet Coins не рубли).
  let coinsEarned = 0;
  if (Math.random() < 0.2 + next.luck / 500) {
    coinsEarned = 1 + Math.floor(Math.random() * 3);
    await earnCoins(profileId, coinsEarned, 'earn_care', `Уход за питомцем: ${action}`);
  }

  if (isFirstToday) await trackMetric(profileId, 'days_together', 1);
  await trackMetric(profileId, 'interactions_total', 1);
  await trackMetric(profileId, `care_${action}`, 1);
  await trackMetric(profileId, 'xp_gained', cfg.xp);
  if (new Date().getUTCHours() < 5) await trackMetric(profileId, 'night_interactions', 1);
  if (level > pet.level) await trackMetric(profileId, 'level_reached', level, { max: true });

  const { rows } = await query('SELECT * FROM pets WHERE id = $1', [petId]);
  const updated = (await withType(rows))[0];
  return { pet: updated, coinsEarned, leveledUp: level > pet.level };
};

/** Эволюция — только по явному подтверждению пользователя, никогда сама. */
/** XP напрямую — награда за достижение/задание/событие, не действие
 *  ухода (нет собственного кулдауна/эффекта на характеристики). Экспорт
 *  отдельно, чтобы petEconomy.mjs не тянул сюда циклический import на
 *  верхнем уровне модуля (грузится динамически при выдаче награды). */
export const addXpDirect = async (petId, amount) => {
  const { rows } = await query('SELECT xp, level FROM pets WHERE id = $1', [petId]);
  if (!rows[0]) return;
  const maxLevel = Number(await getConfig('max_level', 50));
  let xp = rows[0].xp + amount;
  let level = rows[0].level;
  while (level < maxLevel && xp >= (await xpForLevel(level))) {
    xp -= await xpForLevel(level);
    level += 1;
  }
  await query('UPDATE pets SET xp = $2, level = $3, updated_at = now() WHERE id = $1', [petId, xp, level]);
};

export const evolvePet = async (profileId, petId) => {
  const pet = await getOwnedPetRow(profileId, petId);
  if (!pet) return { error: 'not_found' };
  const target = stageForLevel(pet.level);
  const order = STAGES.indexOf(target);
  const current = STAGES.indexOf(pet.stage);
  if (order <= current) return { error: 'not_eligible' };

  const history = Array.isArray(pet.stage_history) ? pet.stage_history : [];
  history.push({ stage: pet.stage, level: pet.level, at: new Date().toISOString() });
  await query(
    'UPDATE pets SET stage = $2, stage_history = $3::jsonb, updated_at = now() WHERE id = $1',
    [petId, target, JSON.stringify(history)],
  );
  await trackMetric(profileId, 'evolutions_total', 1);
  const { rows } = await query('SELECT * FROM pets WHERE id = $1', [petId]);
  return { pet: (await withType(rows))[0] };
};

export const getVisibility = async (profileId) => {
  const { rows } = await query('SELECT * FROM pet_visibility_settings WHERE profile_id = $1', [profileId]);
  if (!rows.length) {
    return { showInProfile: true, showNearMessages: true, showInChats: true, hiddenEntirely: false };
  }
  const r = rows[0];
  return { showInProfile: r.show_in_profile, showNearMessages: r.show_near_messages, showInChats: r.show_in_chats, hiddenEntirely: r.hidden_entirely };
};

export const setVisibility = async (profileId, patch) => {
  const cur = await getVisibility(profileId);
  const next = {
    showInProfile: patch.showInProfile ?? cur.showInProfile,
    showNearMessages: patch.showNearMessages ?? cur.showNearMessages,
    showInChats: patch.showInChats ?? cur.showInChats,
    hiddenEntirely: patch.hiddenEntirely ?? cur.hiddenEntirely,
  };
  await query(
    `INSERT INTO pet_visibility_settings (profile_id, show_in_profile, show_near_messages, show_in_chats, hidden_entirely, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (profile_id) DO UPDATE SET
       show_in_profile=$2, show_near_messages=$3, show_in_chats=$4, hidden_entirely=$5, updated_at=now()`,
    [profileId, next.showInProfile, next.showNearMessages, next.showInChats, next.hiddenEntirely],
  );
  return next;
};

/* ─── Админка каталога типов ────────────────────────────────────────── */

export const adminCreatePetType = async (actorId, body) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  const name = String(body?.name ?? '').trim().slice(0, 40);
  const species = String(body?.species ?? '').trim().slice(0, 40);
  const color = /^#[0-9a-fA-F]{6}$/.test(body?.color ?? '') ? body.color : '#8b5cf6';
  const rarity = RARITIES.includes(body?.rarity) ? body.rarity : 'common';
  const availableFrom = ['starter', 'shop', 'event', 'achievement'].includes(body?.availableFrom) ? body.availableFrom : 'shop';
  const price = availableFrom === 'shop' ? Math.max(0, Math.trunc(Number(body?.pricePetCoins) || 0)) : null;
  if (!name || !species) return { error: 'bad_input' };

  const id = `ptp-${generateId()}`;
  await query(
    `INSERT INTO pet_types (id, name, species, description, base_color, base_rarity, price_pet_coins, available_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, name, species, String(body?.description ?? '').slice(0, 300), color, rarity, price, availableFrom],
  );
  return { id };
};

export const adminRetirePetType = async (actorId, typeId) => {
  if (!(await can(actorId, 'content'))) return { error: 'not_allowed' };
  await query(`UPDATE pet_types SET status = 'retired' WHERE id = $1`, [typeId]);
  return { ok: true };
};
