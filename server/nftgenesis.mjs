/**
 * Зеркало детерминированной генерации каталога NFT-подарков
 * (src/gifts/nftStore.ts) — но только той части, что решает, кому
 * подарок принадлежит «по умолчанию», пока в nft_ownership нет строки.
 *
 * Сам каталог (имя, редкость, фон, цена, коллекция) НЕ пересоздаётся
 * здесь и не хранится в базе: он как был, так и остаётся процедурным
 * и считается на клиенте — это ровно то, что просили не трогать. Эта
 * маленькая копия существует только потому, что «истинный» текущий
 * владелец должен уметь вычисляться и на сервере (для проверки прав
 * при передаче), а серверный и клиентский код на разных языках, так
 * что общий модуль не выйдет — только одинаковая формула.
 *
 * Если формулу в nftStore.ts когда-нибудь поменяют, эту копию нужно
 * поменять тем же способом, иначе «сервер думает одно, клиент рисует
 * другое» — тест gifts-nft.mjs проверяет ровно это совпадение по
 * нескольким id.
 */

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const seeded = (seed, min, max) => min + ((hash(seed) % 10000) / 10000) * (max - min);
const pick = (seed, arr) => arr[Math.floor(seeded(seed, 0, arr.length * 0.9999))];

const OWNER_POOL = [
  { id: 'acc-luna', name: 'Luna Nova' }, { id: 'acc-neo', name: 'Neon Driver' }, { id: 'acc-kutuzov', name: 'Kutuzov' },
  { id: 'col-mira', name: 'Mira Vetrova' }, { id: 'col-arkin', name: 'Arkin Sol' }, { id: 'col-zima', name: 'Zima Hollow' },
  { id: 'col-orel', name: 'Orel Bright' }, { id: 'col-vesna', name: 'Vesna Lake' },
];

export const COLLECTION_COUNT = 12;
export const ITEMS_PER_COLLECTION = 7;
export const NFT_COUNT = COLLECTION_COUNT * ITEMS_PER_COLLECTION;

const NFT_ID_RE = /^gift-([0-9]+)$/;

/** Существует ли такой id в каталоге (тот же диапазон, что генерирует клиент). */
export const isKnownNftId = (nftId) => {
  const m = NFT_ID_RE.exec(String(nftId ?? ''));
  if (!m) return false;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= NFT_COUNT;
};

/** Платформа: нераспроданные подарки принадлежат ей и продаются по цене каталога. */
export const MINT_ID = 'sky-mint';
export const MINT_NAME = 'Sky Mint';

/**
 * Владелец «по рождению» — теперь всегда Sky Mint: демонстрационных
 * владельцев (Luna Nova и других) у подарков больше нет, любой подарок,
 * который ещё никто не купил, можно купить у платформы (nft.mjs::buyFromMint).
 */
export const genesisOwner = (nftId) => {
  const m = NFT_ID_RE.exec(String(nftId ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > NFT_COUNT) return null;
  return { id: MINT_ID, name: MINT_NAME };
};

/** Редкости и их вес/доля выпадения — те же числа, что RARITY_CONFIG в src/gifts/types.ts. */
const RARITY = [
  ['common', 0.15, 40], ['uncommon', 0.25, 25], ['rare', 0.4, 16], ['epic', 0.55, 10], ['legendary', 0.7, 5],
  ['mythic', 0.8, 2.5], ['divine', 0.9, 1], ['limited', 0.75, 0.5], ['founder', 0.95, 0.07], ['one_of_one', 1, 0.03],
];

/**
 * Цена подарка у платформы, в рублях — зеркало buildGifts() в nftStore.ts
 * (редкость → базовая цена → последняя точка истории). Считается на
 * сервере, чтобы покупатель не мог подставить свою цену.
 */
export const mintPrice = (nftId) => {
  const m = NFT_ID_RE.exec(String(nftId ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > NFT_COUNT) return null;
  const seed = `col-${Math.floor((n - 1) / ITEMS_PER_COLLECTION)}-${(n - 1) % ITEMS_PER_COLLECTION}`;
  const roll = seeded(`${seed}rarity`, 0, 100);
  let cum = 0; let weight = RARITY[0][1];
  for (const [, w, drop] of RARITY) { cum += drop; if (roll <= cum) { weight = w; break; } }
  const basePrice = Math.round((50 + weight * weight * 4500) * (1 + seeded(`${seed}price`, 0, 0.4)));
  return Math.round(basePrice * (1 + seeded(`${seed}h13`, -0.18, 0.28)));
};
