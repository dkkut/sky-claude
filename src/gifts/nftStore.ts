/* ======================================================================
   SKY GIFTS NFT  —  Store
   (отдельно от существующего src/gifts/store.ts — там простые Telegram-style
   подарки на эмодзи; здесь — полноценная NFT-коллекционная платформа)
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import {
  apiNftTransfer, apiNftOwners, apiNftActiveListings, apiNftCreateListing,
  apiNftCancelListing, apiNftBuyListing, apiNftHistory, type NftListing,
} from './giftsApi';
import {
  RARITY_CONFIG, RARITY_ORDER, ALL_BACKGROUNDS, ACHIEVEMENT_LABELS,
} from './types';
import type {
  Gift, GiftCollection, Rarity, BackgroundTheme, CollectionKind,
  ProvenanceEntry, Listing, ListingType, Bid, Offer,
  AIValuation, GiftComment, ReactionEmoji, GiftReaction, FollowEdge,
  ShowcaseConfig, AchievementKey, GiftNotification, GiftNotificationType,
  ActionLogEntry, Transaction, PriceTick,
} from './types';

const KEY = 'sky:nftgifts:v1';
const W   = typeof window !== 'undefined';
const me  = () => useAuthStore.getState().currentUserId ?? '';
const myName = () => useAuthStore.getState().accounts.find(a => a.id === me())?.name ?? 'Коллекционер';

const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
const save = (d: object) => { if (!W) return; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0,8)}`;
const nowISO = () => new Date().toISOString();

const hash = (s: string) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };
const seeded = (seed: string, min: number, max: number) => min + ((hash(seed)%10000)/10000)*(max-min);
const pick = <T,>(seed: string, arr: T[]): T => arr[Math.floor(seeded(seed,0,arr.length*0.9999))];

/* ══════════════════════════════════════════════════════════════════
   ГЕНЕРАЦИЯ КАТАЛОГА (детерминированная, без внешнего API)
══════════════════════════════════════════════════════════════════ */
const COLLECTION_SEEDS: { name:string; kind: CollectionKind; cover: BackgroundTheme; desc:string; author:string; supply:number }[] = [
  { name:'Северная Сага',       kind:'thematic',     cover:'aurora',       desc:'Коллекция, рождённая полярным сиянием и тишиной севера.', author:'Sky Studio',   supply: 500 },
  { name:'Глубокий Космос',     kind:'thematic',     cover:'space',        desc:'Подарки для тех, кто смотрит на звёзды.',                  author:'Sky Studio',   supply: 400 },
  { name:'Галактический Прайм', kind:'exclusive',    cover:'galaxy',       desc:'Эксклюзивная серия для держателей Sky Prime.',             author:'Sky Labs',     supply: 150 },
  { name:'Зимний Эфир',         kind:'seasonal',     cover:'ice',          desc:'Сезонная зимняя коллекция ограниченного выпуска.',         author:'Sky Studio',   supply: 300 },
  { name:'Новогодние Огни',     kind:'holiday',      cover:'fire',         desc:'Праздничная серия к новому году.',                          author:'Sky Studio',   supply: 250 },
  { name:'Жидкое Золото',       kind:'limited',      cover:'gold',         desc:'Лимитированная серия премиум-металлик подарков.',          author:'Sky Atelier',  supply: 120 },
  { name:'Кристальная Грань',   kind:'thematic',     cover:'crystal',      desc:'Грани, отражающие свет тысячами осколков.',                author:'Sky Atelier',  supply: 350 },
  { name:'Неонова Ночь',        kind:'collab',       cover:'neon',         desc:'Коллаборация Sky × городская неоновая культура.',          author:'Sky × Neonova',supply: 280 },
  { name:'Матрица Кодов',       kind:'thematic',     cover:'matrix',       desc:'Цифровая серия для разработчиков и техно-эстетов.',        author:'Sky Labs',     supply: 600 },
  { name:'Океанский Бриз',      kind:'seasonal',     cover:'water',        desc:'Летняя коллекция в духе морской глубины.',                 author:'Sky Studio',   supply: 450 },
  { name:'5 лет Sky',           kind:'anniversary',  cover:'liquid_metal', desc:'Юбилейная коллекция в честь пятилетия экосистемы Sky.',   author:'Sky Foundation',supply: 555 },
  { name:'Облачный Архив',      kind:'thematic',     cover:'clouds',       desc:'Лёгкая воздушная серия повседневных подарков.',            author:'Sky Studio',   supply: 800 },
];

const GIFT_NAME_PARTS = {
  prefix: ['Сияющий','Тихий','Звёздный','Ледяной','Огненный','Кристальный','Цифровой','Древний','Вечный','Светлый','Тёмный','Золотой','Хрупкий','Невесомый'],
  noun:   ['Талисман','Кулон','Знак','Орб','Кристалл','Артефакт','Сигил','Тотем','Эмблема','Реликт','Сфера','Жетон'],
};

const buildCollections = (): GiftCollection[] => COLLECTION_SEEDS.map((c,i) => ({
  id: `col-${i}`, name: c.name, kind: c.kind, cover: c.cover, description: c.desc,
  authorId: `author-${i}`, authorName: c.author, totalSupply: c.supply,
  createdAt: new Date(Date.now() - 86400000 * (700 - i*40)).toISOString(),
}));

const OWNER_POOL = [
  { id:'acc-luna', name:'Luna Nova' }, { id:'acc-neo', name:'Neon Driver' }, { id:'acc-kutuzov', name:'Kutuzov' },
  { id:'col-mira', name:'Mira Vetrova' }, { id:'col-arkin', name:'Arkin Sol' }, { id:'col-zima', name:'Zima Hollow' },
  { id:'col-orel', name:'Orel Bright' }, { id:'col-vesna', name:'Vesna Lake' },
];

const buildGifts = (collections: GiftCollection[]): { gifts: Gift[]; provenance: ProvenanceEntry[] } => {
  const gifts: Gift[] = [];
  const provenance: ProvenanceEntry[] = [];
  let counter = 0;

  collections.forEach((col) => {
    const itemsInCollection = 7; // витрина по 7 предметов на коллекцию — достаточно для богатого каталога без лишнего объёма
    for (let i = 0; i < itemsInCollection; i++) {
      counter++;
      const seed = `${col.id}-${i}`;
      const rarityRoll = seeded(seed+'rarity', 0, 100);
      let cum = 0; let rarity: Rarity = 'common';
      for (const r of RARITY_ORDER) { cum += RARITY_CONFIG[r].dropRate; if (rarityRoll <= cum) { rarity = r; break; } }
      const rc = RARITY_CONFIG[rarity];
      const background = pick(seed+'bg', ALL_BACKGROUNDS);
      const edition = Math.max(1, Math.round(seeded(seed+'ed', 1, col.totalSupply*0.6)));
      const basePrice = Math.round((50 + rc.weight*rc.weight*4500) * (1 + seeded(seed+'price',0,0.4)));
      const owner = pick(seed+'owner', OWNER_POOL);
      const name = `${pick(seed+'pfx', GIFT_NAME_PARTS.prefix)} ${pick(seed+'noun', GIFT_NAME_PARTS.noun)}`;
      const releasedAt = new Date(Date.parse(col.createdAt) + 86400000*Math.round(seeded(seed+'rel',1,300))).toISOString();

      const history: PriceTick[] = Array.from({ length: 14 }, (_,d) => ({
        at: new Date(Date.now() - 86400000*(13-d)).toISOString(),
        price: Math.round(basePrice * (1 + seeded(seed+'h'+d, -0.18, 0.28))),
      }));
      const price = history[history.length-1].price;

      const gift: Gift = {
        id: `gift-${counter}`, name, collectionId: col.id, background, rarity, edition, totalEdition: col.totalSupply,
        authorId: col.authorId, authorName: col.authorName, ownerId: owner.id, ownerName: owner.name,
        basePrice, price, priceHistory: history,
        views: Math.round(seeded(seed+'views', 80, 9000)),
        likes: Math.round(seeded(seed+'likes', 5, 800)),
        hasAnimation: seeded(seed+'anim',0,1) > 0.3,
        hasSound: seeded(seed+'snd',0,1) > 0.75,
        releasedAt, createdAt: releasedAt,
      };
      gifts.push(gift);
      provenance.push({ id: genId('prov'), giftId: gift.id, type:'minted', fromId:null, fromName:'Sky Mint', toId: owner.id, toName: owner.name, price: basePrice, at: releasedAt });
    }
  });
  return { gifts, provenance };
};

// Лоты маркета больше не подделка на клиенте — их настоящий источник
// server/nftmarket.mjs, а эта функция только переводит его ответ в ту
// же форму Listing, которую уже рисуют существующие экраны.
const toLocalListing = (l: NftListing): Listing => ({
  id: l.id, giftId: l.nftId, sellerId: l.sellerId, sellerName: l.sellerName ?? '—', type: l.type,
  price: l.price, currentBid: l.currentBid, reservePrice: l.reservePrice, decayPct: l.decayPct,
  decayHours: 24, durationH: l.durationH, status: l.status, views: 0, watchers: 0,
  createdAt: l.createdAt, endsAt: l.endsAt, soldAt: l.soldAt, soldPrice: l.soldPrice,
});

const seedComments = (gifts: Gift[]): GiftComment[] => gifts.slice(0,18).map((g,i) => ({
  id: genId('cmt'), giftId: g.id, authorId: OWNER_POOL[i%OWNER_POOL.length].id, authorName: OWNER_POOL[i%OWNER_POOL.length].name,
  text: pick(g.id+'ctxt', ['Невероятная редкость!','Хочу себе такой 🔥','Фон просто космос','Сколько готовы продать?','Топовый экземпляр коллекции']),
  createdAt: new Date(Date.now()-3600000*seeded(g.id+'ct',1,400)).toISOString(),
}));

const seedReactions = (gifts: Gift[]): GiftReaction[] => gifts.map(g => ({
  giftId: g.id, emoji: pick(g.id+'remo', ['🔥','😍','👏','💎','🚀'] as ReactionEmoji[]),
  userIds: OWNER_POOL.slice(0, Math.round(seeded(g.id+'rusers',0,5))).map(o=>o.id),
}));

/* ══════════════════════════════════════════════════════════════════
   AI-ОЦЕНКА (детерминированная)
══════════════════════════════════════════════════════════════════ */
const buildValuation = (gift: Gift, listings: Listing[], owners: number): AIValuation => {
  const rc = RARITY_CONFIG[gift.rarity];
  const demand = listings.filter(l=>l.giftId===gift.id && l.status==='active').reduce((a,l)=>a+l.watchers,0);
  const ageDays = Math.round((Date.now() - Date.parse(gift.createdAt))/86400000);
  const trendBase = gift.priceHistory[gift.priceHistory.length-1].price - gift.priceHistory[0].price;
  const trendPct = Math.round((trendBase / Math.max(1,gift.priceHistory[0].price)) * 100);

  const recommendedPrice = Math.round(gift.price * (1 + rc.weight*0.1) * (1 + Math.min(0.15, demand/500)));
  const saleProbabilityPct = Math.round(Math.min(98, Math.max(8, 40 + rc.weight*25 + Math.min(20,demand/8) - Math.max(0,ageDays-200)/40)));
  const score = rc.weight*40 + Math.min(30,demand/4) + Math.max(-20,Math.min(20,trendPct));
  const investmentRating: AIValuation['investmentRating'] = score>70?'premium':score>45?'high':score>20?'medium':'low';

  const reasoning: string[] = [
    `Уровень редкости «${rc.label}» формирует базовую стоимость экземпляра.`,
    `Спрос рынка: ${demand} наблюдателей по активным лотам этого предмета.`,
    `Возраст NFT: ${ageDays} дн. с момента выпуска.`,
    trendPct >= 0 ? `Цена выросла на ${trendPct}% за последние 14 точек истории.` : `Цена снизилась на ${Math.abs(trendPct)}% за последние 14 точек истории.`,
    owners > 1 ? `Сменил ${owners} владельцев — устойчивый интерес коллекционеров.` : 'Первый владелец — предмет ещё не выходил на вторичный рынок.',
  ];

  return { giftId: gift.id, recommendedPrice, saleProbabilityPct, trendPct, investmentRating, reasoning, computedAt: nowISO() };
};

/* ══════════════════════════════════════════════════════════════════
   STORE STATE
══════════════════════════════════════════════════════════════════ */
interface NftGiftsState {
  collections: GiftCollection[];
  gifts:       Gift[];
  provenance:  ProvenanceEntry[];
  listings:    Listing[];
  bids:        Bid[];
  offers:      Offer[];
  favorites:   string[];
  archivedIds: string[];
  comments:    GiftComment[];
  reactions:   GiftReaction[];
  follows:     FollowEdge[];
  showcases:   Record<string, ShowcaseConfig>;
  notifications: GiftNotification[];
  actionLog:   ActionLogEntry[];
  transactions:Transaction[];

  giftById:        (id: string) => Gift | null;
  collectionById:  (id: string) => GiftCollection | null;
  giftsInCollection:(collectionId: string) => Gift[];
  ownersCount:     (giftId: string) => number;
  myGifts:         () => Gift[];

  activeListings:  () => Listing[];
  listingFor:      (giftId: string) => Listing | null;
  // Настоящие: сервер (server/nftmarket.mjs) проверяет владение, баланс
  // покупателя и атомарно переносит собственность — эта витрина только
  // отражает то, что он подтвердил, как и giftToUser ниже.
  createListing:   (giftId: string, p: { type: ListingType; price: number; reservePrice?: number; decayPct?: number; durationH: number }) => Promise<{ ok: boolean; reason?: string }>;
  cancelListing:   (listingId: string) => Promise<{ ok: boolean; reason?: string }>;
  buyListing:      (listingId: string) => Promise<{ ok: boolean; reason?: string }>;
  syncListings:    () => Promise<void>;
  placeBid:        (listingId: string, amount: number) => void;
  bidsFor:         (listingId: string) => Bid[];
  makeOffer:       (giftId: string, amount: number) => void;
  offersFor:       (giftId: string) => Offer[];
  respondOffer:    (offerId: string, accept: boolean) => void;

  giftToUser: (giftId: string, toAccountId: string, toAccountName: string) => Promise<{ ok: boolean; reason?: string }>;
  // Подтягивает настоящих владельцев и активные лоты маркета с сервера
  // поверх детерминированного расчёта «по рождению» — так виден
  // результат передачи или покупки, сделанной с другого устройства или
  // другим сеансом.
  syncOwnership: () => Promise<void>;
  // История конкретного подарка с сервера — тянется только по запросу
  // (открыли карточку), не для всех 84 сразу: без этого таймлайн
  // «История» показывал бы только то, что случилось в этом же браузере.
  syncProvenance: (giftId: string) => Promise<void>;
  realSince: Record<string, string>;

  isFavorite:     (giftId: string) => boolean;
  toggleFavorite: (giftId: string) => void;
  acquiredAtFor:  (giftId: string) => string;
  canSellFor:     (giftId: string) => boolean;   // можно продать только первую неделю после получения
  isArchived:     (giftId: string) => boolean;
  toggleArchive:  (giftId: string) => void;
  deleteGift:     (giftId: string) => void;      // безвозвратное удаление
  commentsFor:    (giftId: string) => GiftComment[];
  addComment:     (giftId: string, text: string) => void;
  reactionFor:    (giftId: string) => GiftReaction | null;
  toggleReaction: (giftId: string, emoji: ReactionEmoji) => void;
  isFollowing:    (userId: string) => boolean;
  toggleFollow:   (userId: string, userName: string) => void;
  followersCount: (userId: string) => number;

  showcaseFor:    (userId: string) => ShowcaseConfig;
  updateShowcase: (userId: string, patch: Partial<ShowcaseConfig>) => void;

  valuationFor:   (giftId: string) => AIValuation;
  provenanceFor:  (giftId: string) => ProvenanceEntry[];
  achievementsFor:(userId: string) => { key: AchievementKey; unlocked: boolean }[];
  statsFor:       (userId: string) => {
    collectionValue: number; income: number; spent: number; profit: number;
    avgBuy: number; avgSell: number; roiPct: number; volume: number; activityScore: number;
  };

  search:        (query: string) => Gift[];
  notificationsFor: (userId: string) => GiftNotification[];
  markNotificationRead: (id: string) => void;
  log:           (action: string, description: string) => void;
}

const stored = load();
const seedCollections = stored?.collections ?? buildCollections();
const seedGiftsData = stored ? { gifts: stored.gifts, provenance: stored.provenance } : buildGifts(seedCollections);

export const useNftGiftsStore = create<NftGiftsState>((set, get) => {
  const flush = () => {
    const s = get();
    save({
      // listings сюда намеренно не идут: с этого коммита это правда
      // сервера (server/nftmarket.mjs), а не локальная витрина — кэш в
      // localStorage до следующей синхронизации мог бы показать уже
      // проданный или снятый лот как «активный».
      collections: s.collections, gifts: s.gifts, provenance: s.provenance,
      bids: s.bids, offers: s.offers, favorites: s.favorites, archivedIds: s.archivedIds, comments: s.comments, reactions: s.reactions,
      follows: s.follows, showcases: s.showcases, notifications: s.notifications, actionLog: s.actionLog, transactions: s.transactions,
    });
  };
  const mut = (fn: (s: NftGiftsState) => Partial<NftGiftsState>) => { set(s => ({ ...s, ...fn(s) })); flush(); };

  const writeLog = (action: string, description: string) => {
    const entry: ActionLogEntry = {
      id: genId('log'), userId: me(), userName: myName(), action, description,
      ip: `10.${hash(me()+action)%255}.${hash(description)%255}.${hash(action)%255}`,
      device: 'Sky PC App / Chromium', createdAt: nowISO(),
    };
    set(s => ({ actionLog: [entry, ...s.actionLog].slice(0,500) }));
  };

  const notify = (userId: string, type: GiftNotificationType, title: string, text: string, giftId: string|null = null) => {
    const n: GiftNotification = { id: genId('ntf'), userId, type, title, text, giftId, read:false, createdAt: nowISO() };
    set(s => ({ notifications: [n, ...s.notifications].slice(0,200) }));
  };

  return {
    collections: seedCollections,
    gifts:       seedGiftsData.gifts,
    provenance:  seedGiftsData.provenance,
    listings:    [],
    bids:        stored?.bids ?? [],
    offers:      stored?.offers ?? [],
    favorites:   stored?.favorites ?? [],
    archivedIds: stored?.archivedIds ?? [],
    comments:    stored?.comments ?? seedComments(seedGiftsData.gifts),
    reactions:   stored?.reactions ?? seedReactions(seedGiftsData.gifts),
    follows:     stored?.follows ?? [],
    showcases:   stored?.showcases ?? {},
    notifications: stored?.notifications ?? [],
    actionLog:   stored?.actionLog ?? [],
    transactions:stored?.transactions ?? [],
    realSince:   {},

    giftById:       (id) => get().gifts.find(g=>g.id===id) ?? null,
    collectionById: (id) => get().collections.find(c=>c.id===id) ?? null,
    giftsInCollection: (collectionId) => get().gifts.filter(g=>g.collectionId===collectionId),
    ownersCount: (giftId) => new Set(get().provenance.filter(p=>p.giftId===giftId).map(p=>p.toId)).size,
    myGifts: () => { const uid = me(); return get().gifts.filter(g=>g.ownerId===uid); },

    activeListings: () => get().listings.filter(l => l.status==='active'),
    listingFor: (giftId) => get().listings.find(l=>l.giftId===giftId && l.status==='active') ?? null,

    createListing: async (giftId, p) => {
      const r = await apiNftCreateListing(giftId, {
        type: p.type, price: p.price, reservePrice: p.reservePrice, decayPct: p.decayPct, durationH: p.durationH,
      });
      if (!r.ok) return { ok: false, reason: r.reason };
      const listing = toLocalListing(r.listing);
      mut(s => ({ listings: [listing, ...s.listings.filter(l => l.giftId !== giftId)] }));
      const gift = get().giftById(giftId);
      writeLog('listing_created', `Подарок «${gift?.name ?? giftId}» выставлен на продажу (${p.type})`); flush();
      return { ok: true };
    },

    cancelListing: async (listingId) => {
      const r = await apiNftCancelListing(listingId);
      if (!r.ok) return { ok: false, reason: r.reason };
      mut(s => ({ listings: s.listings.map(l => l.id===listingId ? { ...l, status:'cancelled' as const } : l) }));
      writeLog('listing_cancelled', 'Лот снят с продажи'); flush();
      return { ok: true };
    },

    // Настоящая покупка: сервер (server/nftmarket.mjs::buyListing) сам
    // списывает баланс, проверяет, что лот ещё не забрали, и атомарно
    // переносит собственность — эта функция только отражает результат.
    buyListing: async (listingId) => {
      const before = get().listings.find(l=>l.id===listingId);
      const r = await apiNftBuyListing(listingId);
      if (!r.ok) return { ok: false, reason: r.reason };
      const buyerId = r.ownerId; const buyerName = r.ownerName; const price = r.price;
      mut(s => ({
        listings: s.listings.map(l => l.id===listingId ? { ...l, status:'sold' as const, soldAt: nowISO(), soldPrice: price } : l),
        gifts: s.gifts.map(g => g.id===r.nftId ? {
          ...g, ownerId: buyerId, ownerName: buyerName, price,
          priceHistory: [...g.priceHistory, { at: nowISO(), price }],
        } : g),
        provenance: [...s.provenance, { id: genId('prov'), giftId: r.nftId, type:'sale' as const, fromId: before?.sellerId ?? null, fromName: before?.sellerName ?? '—', toId: buyerId, toName: buyerName, price, at: nowISO() }],
        transactions: [...s.transactions, { id: genId('tx'), userId: buyerId, giftId: r.nftId, type:'buy' as const, amount: price, at: nowISO() }],
      }));
      const gift = get().giftById(r.nftId);
      writeLog('purchase', `Куплен подарок «${gift?.name ?? r.nftId}» за ${price.toLocaleString('ru-RU')} ₽`);
      notify(buyerId, 'purchase', 'Покупка совершена', `Вы приобрели «${gift?.name ?? r.nftId}» за ${price.toLocaleString('ru-RU')} ₽`, r.nftId);
      flush();
      return { ok: true };
    },

    syncListings: async () => {
      const items = await apiNftActiveListings();
      mut(() => ({ listings: items.map(toLocalListing) }));
    },

    placeBid: (listingId, amount) => {
      const listing = get().listings.find(l=>l.id===listingId); if (!listing || listing.type!=='auction') return;
      if (amount <= (listing.currentBid ?? listing.price)) return;
      const bid: Bid = { id: genId('bid'), listingId, bidderId: me(), bidderName: myName(), amount, at: nowISO() };
      mut(s => ({
        bids: [...s.bids, bid],
        listings: s.listings.map(l => l.id===listingId ? { ...l, currentBid: amount, watchers: l.watchers+1 } : l),
      }));
      writeLog('bid_placed', `Сделана ставка ${amount.toLocaleString('ru-RU')} ₽`); flush();
    },
    bidsFor: (listingId) => get().bids.filter(b=>b.listingId===listingId).sort((a,b)=>b.amount-a.amount),

    makeOffer: (giftId, amount) => {
      const offer: Offer = { id: genId('off'), giftId, buyerId: me(), buyerName: myName(), amount, status:'pending', createdAt: nowISO() };
      mut(s => ({ offers: [offer, ...s.offers] }));
      const gift = get().giftById(giftId);
      if (gift) notify(gift.ownerId, 'offer', 'Получено предложение', `Предложение ${amount.toLocaleString('ru-RU')} ₽ за «${gift.name}»`, giftId);
      flush();
    },
    offersFor: (giftId) => get().offers.filter(o=>o.giftId===giftId).sort((a,b)=>b.amount-a.amount),
    respondOffer: (offerId, accept) => {
      const offer = get().offers.find(o=>o.id===offerId); if (!offer) return;
      if (accept) {
        const gift = get().giftById(offer.giftId);
        if (gift) {
          mut(s => ({
            gifts: s.gifts.map(g => g.id===gift.id ? { ...g, ownerId: offer.buyerId, ownerName: offer.buyerName, price: offer.amount, priceHistory:[...g.priceHistory,{at:nowISO(),price:offer.amount}] } : g),
            provenance: [...s.provenance, { id: genId('prov'), giftId: gift.id, type:'sale' as const, fromId: gift.ownerId, fromName: gift.ownerName, toId: offer.buyerId, toName: offer.buyerName, price: offer.amount, at: nowISO() }],
            offers: s.offers.map(o => o.id===offerId ? { ...o, status:'accepted' as const } : o),
          }));
          notify(offer.buyerId, 'purchase', 'Предложение принято', `Ваше предложение за «${gift.name}» принято`, gift.id);
        }
      } else {
        mut(s => ({ offers: s.offers.map(o => o.id===offerId ? { ...o, status:'declined' as const } : o) }));
      }
      flush();
    },

    // Настоящая передача: сервер сам проверяет, что подарок сейчас
    // действительно принадлежит отправителю (server/nft.mjs::transferNft),
    // атомарно переключает владельца и дописывает постоянную историю.
    // Локальная витрина (эта функция) только отражает то, что сервер
    // подтвердил, — она не решает, состоялась ли передача.
    giftToUser: async (giftId, toAccountId, toAccountName) => {
      const gift = get().giftById(giftId); if (!gift) return { ok: false, reason: 'Подарок не найден' };
      const fromId = gift.ownerId; const fromName = gift.ownerName;
      const r = await apiNftTransfer(giftId, toAccountId);
      if (!r.ok) return { ok: false, reason: r.reason };
      mut(s => ({
        gifts: s.gifts.map(g => g.id===giftId ? { ...g, ownerId: r.ownerId, ownerName: r.ownerName } : g),
        provenance: [...s.provenance, { id: genId('prov'), giftId, type:'gift' as const, fromId, fromName, toId: r.ownerId, toName: r.ownerName, price: null, at: nowISO() }],
        transactions: [...s.transactions, { id: genId('tx'), userId: fromId, giftId, type:'gift_out' as const, amount:0, at: nowISO() }, { id: genId('tx'), userId: r.ownerId, giftId, type:'gift_in' as const, amount:0, at: nowISO() }],
      }));
      writeLog('gift_sent', `Подарок «${gift.name}» отправлен пользователю ${toAccountName}`);
      notify(toAccountId, 'gift', 'Вам подарок!', `${fromName} подарил вам «${gift.name}»`, giftId);
      flush();
      return { ok: true };
    },

    syncOwnership: async () => {
      const ids = get().gifts.map(g => g.id);
      const owners = await apiNftOwners(ids);
      mut(s => ({
        gifts: s.gifts.map(g => {
          const o = owners[g.id];
          return o && o.transferred ? { ...g, ownerId: o.id, ownerName: o.name } : g;
        }),
        // Настоящая дата передачи с сервера — иначе для подарка,
        // полученного в другом сеансе, «с какого числа он у меня» брать
        // неоткуда (у этого браузера нет записи о ней в provenance),
        // и правило «неделя на продажу» посчиталось бы неверно.
        realSince: Object.fromEntries(
          Object.entries(owners).filter(([, o]) => o.transferred && o.since).map(([id, o]) => [id, o.since as string]),
        ),
      }));
      void get().syncListings();
    },

    syncProvenance: async (giftId) => {
      const remote = await apiNftHistory(giftId);
      if (!remote.length) return;
      const local = get().provenance.filter(p => p.giftId !== giftId);
      const mapped: ProvenanceEntry[] = remote.map((r) => ({
        id: r.id, giftId,
        type: r.type === 'genesis' ? 'minted' : r.type === 'transfer' && r.source === 'gift' ? 'gift' : r.type,
        fromId: r.fromId, fromName: r.fromName ?? 'Sky Mint', toId: r.toId, toName: r.toName,
        price: r.price, at: r.at,
      }));
      mut(() => ({ provenance: [...local, ...mapped] }));
    },

    isFavorite: (giftId) => get().favorites.includes(giftId),
    toggleFavorite: (giftId) => mut(s => ({ favorites: s.favorites.includes(giftId) ? s.favorites.filter(id=>id!==giftId) : [...s.favorites, giftId] })),

    // Дата, с которой ТЕКУЩИЙ владелец владеет подарком — последняя запись
    // в истории (продажа/подарок/перевод на него), либо дата минта, если
    // подарок ни разу не переходил из рук в руки.
    acquiredAtFor: (giftId) => {
      const gift = get().giftById(giftId); if (!gift) return nowISO();
      const verified = get().realSince[giftId];
      if (verified) return verified;
      const history = get().provenance.filter(p => p.giftId === giftId && p.toId === gift.ownerId)
        .sort((a,b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      return history[0]?.at ?? gift.createdAt;
    },
    // Продать можно только в течение первой недели после получения —
    // дальше остаётся либо удалить безвозвратно, либо скрыть в архив.
    canSellFor: (giftId) => {
      const acquiredAt = get().acquiredAtFor(giftId);
      return Date.now() - new Date(acquiredAt).getTime() <= 7 * 24 * 3600 * 1000;
    },
    isArchived: (giftId) => get().archivedIds.includes(giftId),
    toggleArchive: (giftId) => mut(s => ({
      archivedIds: s.archivedIds.includes(giftId) ? s.archivedIds.filter(id => id !== giftId) : [...s.archivedIds, giftId],
    })),
    // Безвозвратное удаление: подарок и вся его история исчезают насовсем.
    deleteGift: (giftId) => mut(s => ({
      gifts:       s.gifts.filter(g => g.id !== giftId),
      provenance:  s.provenance.filter(p => p.giftId !== giftId),
      comments:    s.comments.filter(c => c.giftId !== giftId),
      reactions:   s.reactions.filter(r => r.giftId !== giftId),
      favorites:   s.favorites.filter(id => id !== giftId),
      archivedIds: s.archivedIds.filter(id => id !== giftId),
      listings:    s.listings.filter(l => l.giftId !== giftId),
    })),

    commentsFor: (giftId) => get().comments.filter(c=>c.giftId===giftId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    addComment: (giftId, text) => {
      if (!text.trim()) return;
      mut(s => ({ comments: [...s.comments, { id: genId('cmt'), giftId, authorId: me(), authorName: myName(), text: text.trim(), createdAt: nowISO() }] }));
    },

    reactionFor: (giftId) => get().reactions.find(r=>r.giftId===giftId) ?? null,
    toggleReaction: (giftId, emoji) => {
      const uid = me();
      mut(s => {
        const existing = s.reactions.find(r=>r.giftId===giftId && r.emoji===emoji);
        if (existing) {
          const has = existing.userIds.includes(uid);
          return { reactions: s.reactions.map(r => r===existing ? { ...r, userIds: has ? r.userIds.filter(i=>i!==uid) : [...r.userIds, uid] } : r) };
        }
        return { reactions: [...s.reactions, { giftId, emoji, userIds:[uid] }] };
      });
    },

    isFollowing: (userId) => get().follows.some(f=>f.followerId===me() && f.followingId===userId),
    toggleFollow: (userId, userName) => {
      const uid = me();
      mut(s => s.follows.some(f=>f.followerId===uid && f.followingId===userId)
        ? { follows: s.follows.filter(f=>!(f.followerId===uid && f.followingId===userId)) }
        : { follows: [...s.follows, { followerId: uid, followingId: userId, createdAt: nowISO() }] });
      void userName;
    },
    followersCount: (userId) => get().follows.filter(f=>f.followingId===userId).length,

    showcaseFor: (userId) => get().showcases[userId] ?? {
      userId, background:'galaxy', musicOn:false, layout:'grid', description:'Моя коллекция Sky Gifts',
      pinnedGiftIds: [], openAnimation:'fade',
    },
    updateShowcase: (userId, patch) => mut(s => ({ showcases: { ...s.showcases, [userId]: { ...get().showcaseFor(userId), ...patch } } })),

    valuationFor: (giftId) => {
      const gift = get().giftById(giftId)!;
      return buildValuation(gift, get().listings, get().ownersCount(giftId));
    },
    provenanceFor: (giftId) => get().provenance.filter(p=>p.giftId===giftId).sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime()),

    achievementsFor: (userId) => {
      const stats = get().statsFor(userId);
      const owned = get().gifts.filter(g=>g.ownerId===userId);
      const tx = get().transactions.filter(t=>t.userId===userId);
      const rareOwned = owned.some(g => ['mythic','divine','one_of_one'].includes(g.rarity));
      const oneOfOne = owned.some(g => g.rarity==='one_of_one');
      const cols = new Set(owned.map(g=>g.collectionId));
      const fullCollection = Array.from(cols).some(cid => owned.filter(g=>g.collectionId===cid).length >= 5);
      const sales = tx.filter(t=>t.type==='sell').length;

      const map: Record<AchievementKey, boolean> = {
        first_purchase: tx.some(t=>t.type==='buy'),
        first_sale: sales > 0,
        first_collection: fullCollection,
        rarest_nft: rareOwned,
        collector_of_month: stats.collectionValue > 300000,
        million_collection: stats.collectionValue >= 1000000,
        unique_piece: oneOfOne,
        top_seller: sales >= 25,
      };
      return (Object.keys(ACHIEVEMENT_LABELS) as AchievementKey[]).map(key => ({ key, unlocked: map[key] }));
    },

    statsFor: (userId) => {
      const owned = get().gifts.filter(g=>g.ownerId===userId);
      const tx = get().transactions.filter(t=>t.userId===userId);
      const collectionValue = owned.reduce((a,g)=>a+g.price,0);
      const income = tx.filter(t=>t.type==='sell').reduce((a,t)=>a+t.amount,0);
      const spent = tx.filter(t=>t.type==='buy').reduce((a,t)=>a+t.amount,0);
      const profit = income - spent;
      const buys = tx.filter(t=>t.type==='buy');
      const sells = tx.filter(t=>t.type==='sell');
      const avgBuy = buys.length ? spent/buys.length : 0;
      const avgSell = sells.length ? income/sells.length : 0;
      const roiPct = spent > 0 ? Math.round((profit/spent)*100) : 0;
      const volume = income + spent;
      const activityScore = Math.min(100, Math.round(tx.length*4 + owned.length*1.5));
      return { collectionValue, income, spent, profit, avgBuy, avgSell, roiPct, volume, activityScore };
    },

    search: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return get().gifts.filter(g => {
        const col = get().collectionById(g.collectionId);
        return g.name.toLowerCase().includes(q) || col?.name.toLowerCase().includes(q) ||
          g.ownerName.toLowerCase().includes(q) || g.authorName.toLowerCase().includes(q) ||
          String(g.edition).includes(q) || RARITY_CONFIG[g.rarity].label.toLowerCase().includes(q) ||
          String(g.price).includes(q);
      }).slice(0,60);
    },

    notificationsFor: (userId) => get().notifications.filter(n=>n.userId===userId).sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),
    markNotificationRead: (id) => mut(s => ({ notifications: s.notifications.map(n => n.id===id ? { ...n, read:true } : n) })),

    log: (action, description) => { writeLog(action, description); flush(); },
  };
});
