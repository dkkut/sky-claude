/* ======================================================================
   SKY GIFTS  —  Types
   Цифровые коллекционные NFT-подарки
====================================================================== */

/* ══════════════════════════════════════════════════════════════════
   РЕДКОСТЬ
══════════════════════════════════════════════════════════════════ */
export type Rarity =
  | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  | 'mythic' | 'divine' | 'limited' | 'founder' | 'one_of_one';

export interface RarityConfig {
  key: Rarity;
  label: string;
  color: string;
  glow: string;
  weight: number;     // влияет на интенсивность эффектов 0-1
  dropRate: number;    // относительная редкость для генерации
}

export const RARITY_CONFIG: Record<Rarity, RarityConfig> = {
  common:    { key:'common',    label:'Common',          color:'#9aa0ad', glow:'rgba(154,160,173,0.35)', weight:0.15, dropRate: 40 },
  uncommon:  { key:'uncommon',  label:'Uncommon',        color:'#34d399', glow:'rgba(52,211,153,0.4)',   weight:0.25, dropRate: 25 },
  rare:      { key:'rare',      label:'Rare',            color:'#4f6ef7', glow:'rgba(79,110,247,0.45)',  weight:0.4,  dropRate: 16 },
  epic:      { key:'epic',      label:'Epic',            color:'#a78bfa', glow:'rgba(167,139,250,0.5)',  weight:0.55, dropRate: 10 },
  legendary: { key:'legendary', label:'Legendary',       color:'#f59e0b', glow:'rgba(245,158,11,0.55)',  weight:0.7,  dropRate: 5  },
  mythic:    { key:'mythic',    label:'Mythic',          color:'#f43f5e', glow:'rgba(244,63,94,0.6)',    weight:0.8,  dropRate: 2.5},
  divine:    { key:'divine',    label:'Divine',          color:'#22d3ee', glow:'rgba(34,211,238,0.65)',  weight:0.9,  dropRate: 1  },
  limited:   { key:'limited',   label:'Limited',         color:'#fbbf24', glow:'rgba(251,191,36,0.6)',   weight:0.75, dropRate: 0.5},
  founder:   { key:'founder',   label:'Founder Edition', color:'#e879f9', glow:'rgba(232,121,249,0.7)',  weight:0.95, dropRate: 0.07},
  one_of_one:{ key:'one_of_one',label:'One of One',      color:'#ffffff', glow:'rgba(255,255,255,0.8)',  weight:1,    dropRate: 0.03},
};

export const RARITY_ORDER: Rarity[] = ['common','uncommon','rare','epic','legendary','mythic','divine','limited','founder','one_of_one'];

/* ══════════════════════════════════════════════════════════════════
   ФОНЫ
══════════════════════════════════════════════════════════════════ */
export type BackgroundTheme =
  | 'aurora' | 'space' | 'galaxy' | 'clouds' | 'liquid_metal' | 'water'
  | 'crystal' | 'neon' | 'glass' | 'gold' | 'ice' | 'fire' | 'matrix'
  | 'waves' | 'particles';

export const BACKGROUND_LABELS: Record<BackgroundTheme, string> = {
  aurora:'Северное сияние', space:'Космос', galaxy:'Галактика', clouds:'Облака',
  liquid_metal:'Жидкий металл', water:'Вода', crystal:'Кристаллы', neon:'Неон',
  glass:'Стекло', gold:'Золото', ice:'Лёд', fire:'Огонь', matrix:'Цифровая матрица',
  waves:'Абстрактные волны', particles:'Световые частицы',
};

export const ALL_BACKGROUNDS = Object.keys(BACKGROUND_LABELS) as BackgroundTheme[];

/* ══════════════════════════════════════════════════════════════════
   КОЛЛЕКЦИИ
══════════════════════════════════════════════════════════════════ */
export type CollectionKind =
  | 'thematic' | 'seasonal' | 'holiday' | 'limited' | 'exclusive'
  | 'collab' | 'anniversary' | 'custom';

export const COLLECTION_KIND_LABELS: Record<CollectionKind, string> = {
  thematic:'Тематическая', seasonal:'Сезонная', holiday:'Праздничная', limited:'Лимитированная',
  exclusive:'Эксклюзивная', collab:'Коллаборация', anniversary:'Юбилейная', custom:'Пользовательская',
};

export interface GiftCollection {
  id:          string;
  name:        string;
  kind:        CollectionKind;
  cover:       BackgroundTheme;
  description: string;
  authorId:    string;
  authorName:  string;
  totalSupply: number;
  createdAt:   string;
}

/* ══════════════════════════════════════════════════════════════════
   ПОДАРОК (NFT)
══════════════════════════════════════════════════════════════════ */
export interface PriceTick { at: string; price: number; }

export interface Gift {
  id:           string;
  name:         string;
  collectionId: string;
  background:   BackgroundTheme;
  rarity:       Rarity;
  edition:      number;     // номер экземпляра
  totalEdition: number;     // общий тираж
  authorId:     string;
  authorName:   string;
  ownerId:      string;
  ownerName:    string;
  basePrice:    number;
  price:        number;     // текущая рыночная цена
  priceHistory: PriceTick[];
  views:        number;
  likes:        number;
  hasAnimation: boolean;
  hasSound:     boolean;
  releasedAt:   string;
  createdAt:    string;
}

/* ── История владения / переходов ──────────────────────────────────── */
export type ProvenanceType = 'minted' | 'sale' | 'gift' | 'transfer';

export interface ProvenanceEntry {
  id:         string;
  giftId:     string;
  type:       ProvenanceType;
  fromId:     string | null;
  fromName:   string;
  toId:       string;
  toName:     string;
  price:      number | null;
  at:         string;
}

/* ══════════════════════════════════════════════════════════════════
   МАРКЕТПЛЕЙС / ЛИСТИНГИ
══════════════════════════════════════════════════════════════════ */
export type ListingType = 'fixed' | 'auction' | 'instant' | 'reserve';
export type ListingStatus = 'active' | 'sold' | 'cancelled' | 'expired';

export interface Bid {
  id:        string;
  listingId: string;
  bidderId:  string;
  bidderName:string;
  amount:    number;
  at:        string;
}

export interface Offer {
  id:        string;
  giftId:    string;
  buyerId:   string;
  buyerName: string;
  amount:    number;
  status:    'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
}

export interface Listing {
  id:          string;
  giftId:      string;
  sellerId:    string;
  sellerName:  string;
  type:        ListingType;
  price:       number;          // стартовая/фиксированная цена
  currentBid:  number | null;   // для аукциона
  reservePrice:number | null;
  decayPct:    number;          // % автоснижения цены за период (для fixed)
  decayHours:  number;
  durationH:   number;
  status:      ListingStatus;
  views:       number;
  watchers:    number;
  createdAt:   string;
  endsAt:      string;
  soldAt:      string | null;
  soldPrice:   number | null;
}

/* ══════════════════════════════════════════════════════════════════
   AI-ОЦЕНКА
══════════════════════════════════════════════════════════════════ */
export interface AIValuation {
  giftId:            string;
  recommendedPrice:   number;
  saleProbabilityPct: number;
  trendPct:           number;   // прогноз изменения за 30 дней
  investmentRating:   'low' | 'medium' | 'high' | 'premium';
  reasoning:          string[];
  computedAt:         string;
}

/* ══════════════════════════════════════════════════════════════════
   СОЦИАЛЬНОЕ
══════════════════════════════════════════════════════════════════ */
export interface GiftComment {
  id:        string;
  giftId:    string;
  authorId:  string;
  authorName:string;
  text:      string;
  createdAt: string;
}

export type ReactionEmoji = '🔥'|'😍'|'👏'|'💎'|'🚀';
export interface GiftReaction { giftId: string; emoji: ReactionEmoji; userIds: string[]; }

export interface FollowEdge { followerId: string; followingId: string; createdAt: string; }

/* ══════════════════════════════════════════════════════════════════
   ВИТРИНА
══════════════════════════════════════════════════════════════════ */
export interface ShowcaseConfig {
  userId:      string;
  background:  BackgroundTheme;
  musicOn:     boolean;
  layout:      'grid' | 'carousel' | 'spotlight';
  description: string;
  pinnedGiftIds: string[];
  openAnimation: 'fade' | 'rise' | 'shatter' | 'unfold';
}

/* ══════════════════════════════════════════════════════════════════
   ДОСТИЖЕНИЯ
══════════════════════════════════════════════════════════════════ */
export type AchievementKey =
  | 'first_purchase' | 'first_sale' | 'first_collection' | 'rarest_nft'
  | 'collector_of_month' | 'million_collection' | 'unique_piece' | 'top_seller';

export const ACHIEVEMENT_LABELS: Record<AchievementKey, { title: string; desc: string }> = {
  first_purchase:     { title:'Первая покупка',        desc:'Совершите первую покупку на маркетплейсе' },
  first_sale:         { title:'Первая продажа',         desc:'Продайте свой первый подарок' },
  first_collection:   { title:'Первая коллекция',       desc:'Соберите 5 подарков из одной коллекции' },
  rarest_nft:         { title:'Редчайший экземпляр',    desc:'Станьте владельцем Mythic, Divine или One of One' },
  collector_of_month: { title:'Коллекционер месяца',    desc:'Войдите в топ-10 коллекционеров за месяц' },
  million_collection: { title:'Коллекция на миллион',   desc:'Стоимость вашей коллекции превысила 1 000 000 ₽' },
  unique_piece:       { title:'Уникальный экземпляр',   desc:'Владейте подарком One of One' },
  top_seller:         { title:'Топ-продавец',           desc:'Совершите 25 успешных продаж' },
};

export interface UnlockedAchievement {
  key:         AchievementKey;
  userId:      string;
  unlockedAt:  string;
}

/* ══════════════════════════════════════════════════════════════════
   УВЕДОМЛЕНИЯ
══════════════════════════════════════════════════════════════════ */
export type GiftNotificationType =
  | 'purchase' | 'sale' | 'gift' | 'price_up' | 'price_down'
  | 'auction_end' | 'offer' | 'new_collection';

export interface GiftNotification {
  id:        string;
  userId:    string;
  type:      GiftNotificationType;
  title:     string;
  text:      string;
  giftId:    string | null;
  read:      boolean;
  createdAt: string;
}

/* ══════════════════════════════════════════════════════════════════
   ИСТОРИЯ ДЕЙСТВИЙ / БЕЗОПАСНОСТЬ
══════════════════════════════════════════════════════════════════ */
export interface ActionLogEntry {
  id:         string;
  userId:     string;
  userName:   string;
  action:     string;
  description:string;
  ip:         string;
  device:     string;
  createdAt:  string;
}

/* ══════════════════════════════════════════════════════════════════
   ТРАНЗАКЦИИ (для статистики)
══════════════════════════════════════════════════════════════════ */
export type TxType = 'buy' | 'sell' | 'gift_in' | 'gift_out' | 'mint';

export interface Transaction {
  id:        string;
  userId:    string;
  giftId:    string;
  type:      TxType;
  amount:    number;
  at:        string;
}
