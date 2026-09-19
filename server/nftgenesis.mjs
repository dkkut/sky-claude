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

/**
 * Владелец «по рождению» — тот же расчёт, что делает buildGifts() в
 * nftStore.ts для поля ownerId/ownerName. Используется, только пока
 * подарок ни разу не передавали по-настоящему.
 */
export const genesisOwner = (nftId) => {
  const m = NFT_ID_RE.exec(String(nftId ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > NFT_COUNT) return null;
  const colIndex = Math.floor((n - 1) / ITEMS_PER_COLLECTION);
  const itemIndex = (n - 1) % ITEMS_PER_COLLECTION;
  const seed = `col-${colIndex}-${itemIndex}`;
  const owner = pick(`${seed}owner`, OWNER_POOL);
  return { id: owner.id, name: owner.name };
};
