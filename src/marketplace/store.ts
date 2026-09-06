/* ======================================================================
   SKY MARKET  -  Store
====================================================================== */
import { create } from 'zustand';
import { Product, Order, SellerProfile, Review, WithdrawRequest, ProductCategory, OrderStatus, Game, MarketCommissionRates } from './types';
import { useAuthStore } from '@/core/auth/store';
import { useTransportStore } from './logistics/transportStore';

const KEY = 'sky:market:v1';
const W   = typeof window !== 'undefined';
const me  = () => useAuthStore.getState().currentUserId ?? '';

const load = () => {
  if (!W) return null;
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
const save = (data: object) => {
  if (!W) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
};

/* --- Генерация трек-номера ----------------------------------------- */
const genTrack = (): string => {
  const part = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4).padEnd(4,'X');
  return `SKY-${part()}-${part()}`;
};

/* Автовыбор доставки при оформлении заказа:
   1) собственная ТК продавца, если есть;
   2) лучшая по цене/скорости/рейтингу сторонняя ТК среди зарегистрированных;
   3) системная доставка Sky Market (если ни одной ТК ещё не создано). */
const pickDeliveryCompany = (sellerId: string, weightKg: number) => {
  const ts = useTransportStore.getState();
  const own = ts.companyByOwner(sellerId);
  if (own) return { id: own.id, name: own.name, source: 'seller' as const, price: Math.max(own.minPrice, own.pricePerKm * 5) };

  const candidates = ts.companies.filter(c => c.maxWeightKg >= weightKg);
  if (candidates.length > 0) {
    const scored = candidates.map(c => ({
      c, score: c.rating * 20 - c.minPrice * 0.02 - c.deliveryTimeHours * 0.5,
    })).sort((a,b) => b.score - a.score);
    const best = scored[0].c;
    return { id: best.id, name: best.name, source: 'external' as const, price: Math.max(best.minPrice, best.pricePerKm * 5) };
  }

  return { id: 'skymarket', name: 'Sky Market Доставка', source: 'skymarket' as const, price: 250 };
};

/* --- Seed данные --------------------------------------------------- */
const SEED_PRODUCTS_RAW: Omit<Product, 'marketType'>[] = [
  // Electronics
  { id:'p1',  sellerId:'acc-luna', title:'Игровая мышь SkyX Pro',       description:'Оптический сенсор 16000 DPI, RGB подсветка, 7 кнопок, USB-C. Лёгкая сетчатая конструкция 69г.', price:3490, oldPrice:4990, category:'electronics', images:[], stock:12, rating:4.8, reviewCount:34,  sold:89,  createdAt:new Date(Date.now()-86400000*7).toISOString(),  active:true, badge:'ХИТ', discount:30 },
  { id:'p2',  sellerId:'acc-luna', title:'Коврик SkyMat XL 900×400',    description:'900×400×4 мм. Водоотталкивающее покрытие, прошитые края, нескользящая основа.', price:890, category:'electronics', images:[], stock:30, rating:4.9, reviewCount:56,  sold:201, createdAt:new Date(Date.now()-86400000*3).toISOString(),  active:true },
  { id:'p3',  sellerId:'acc-luna', title:'Наушники Sky Sound Pro 7.1',  description:'Беспроводные, 40ч работы, активное шумоподавление, виртуальный 7.1, складные, USB-C зарядка.', price:6990, oldPrice:8990, category:'electronics', images:[], stock:5,  rating:4.7, reviewCount:18,  sold:44,  createdAt:new Date(Date.now()-86400000*21).toISOString(), active:true, badge:'−22%', discount:22 },
  { id:'p4',  sellerId:'acc-luna', title:'Клавиатура SkyKey TKL',       description:'Механическая TKL, свитчи Gateron Red, RGB per-key, алюминиевый топкейс, 1000 Гц polling.', price:5490, category:'electronics', images:[], stock:8,  rating:4.6, reviewCount:27,  sold:63,  createdAt:new Date(Date.now()-86400000*10).toISOString(), active:true },
  { id:'p5',  sellerId:'acc-luna', title:'Монитор Sky Vision 27" 165Hz', description:'IPS 2K 27", 165 Гц, 1мс, G-Sync Compatible, HDR400, 99% sRGB, 2× HDMI, 1× DP.', price:28900, oldPrice:34900, category:'electronics', images:[], stock:3,  rating:4.9, reviewCount:11,  sold:19,  createdAt:new Date(Date.now()-86400000*5).toISOString(),  active:true, badge:'NEW', discount:17 },
  { id:'p6',  sellerId:'acc-neo',  title:'Геймпад Sky Pad Pro',          description:'Беспроводной, 20ч заряд, вибрация, адаптивные триггеры, совместим PC/Android/iOS.', price:3990, category:'electronics', images:[], stock:15, rating:4.5, reviewCount:22,  sold:78,  createdAt:new Date(Date.now()-86400000*4).toISOString(),  active:true },
  // Clothing
  { id:'p7',  sellerId:'acc-neo',  title:'Футболка Neo Driver™ Oversized', description:'100% хлопок 220г/м², принт Arena Squad, пресс-стирка 40°, размеры XS–3XL.', price:1290, oldPrice:1590, category:'clothing', images:[], stock:50, rating:4.6, reviewCount:21,  sold:143, createdAt:new Date(Date.now()-86400000*14).toISOString(), active:true, badge:'ХИТ', discount:19 },
  { id:'p8',  sellerId:'acc-neo',  title:'Худи Sky Ecosystem Zip',       description:'Флис-начёс 340г/м², YKK молния, карманы кенгуру, вышивка логотипа, размеры S–XXL.', price:2990, category:'clothing', images:[], stock:25, rating:4.7, reviewCount:15,  sold:67,  createdAt:new Date(Date.now()-86400000*6).toISOString(),  active:true },
  { id:'p9',  sellerId:'acc-neo',  title:'Кепка Sky Classic 6-Panel',   description:'100% хлопок, металлическая застёжка, вышитый логотип Sky спереди. One size.', price:690, category:'clothing', images:[], stock:40, rating:4.4, reviewCount:9,   sold:112, createdAt:new Date(Date.now()-86400000*20).toISOString(), active:true },
  { id:'p10', sellerId:'acc-neo',  title:'Носки Sky Gaming Pack ×5',    description:'5 пар с разными принтами, 80% хлопок, размеры 36–46. В подарочной упаковке.', price:590, category:'clothing', images:[], stock:60, rating:4.8, reviewCount:33,  sold:289, createdAt:new Date(Date.now()-86400000*8).toISOString(),  active:true, badge:'ХИТ' },
  // Food
  { id:'p11', sellerId:'acc-neo',  title:'Энергетик Sky Boost × 12',   description:'12 × 500мл, натуральный кофеин 80мг, без сахара, таурин + B-витамины. Вкус: лесные ягоды.', price:1190, category:'food', images:[], stock:8,  rating:4.4, reviewCount:12,  sold:67,  createdAt:new Date(Date.now()-86400000*2).toISOString(),  active:true },
  { id:'p12', sellerId:'acc-neo',  title:'Протеиновый бар Sky Bar × 10', description:'10 × 60г. 20г белка, 4г сахара, без пальмового масла. Вкусы: шоколад, карамель.', price:890, category:'food', images:[], stock:20, rating:4.3, reviewCount:8,   sold:45,  createdAt:new Date(Date.now()-86400000*1).toISOString(),  active:true },
  // Books
  { id:'p13', sellerId:'acc-luna', title:'«Архитектура высоких нагрузок»', description:'Мартин Клеппман. 600 стр., твёрдая обложка. Проектирование надёжных распределённых систем.', price:1890, category:'books', images:[], stock:7,  rating:5.0, reviewCount:6,   sold:23,  createdAt:new Date(Date.now()-86400000*9).toISOString(),  active:true },
  { id:'p14', sellerId:'acc-luna', title:'«Чистый код» Роберт Мартин', description:'Классика. 464 стр. Руководство по написанию качественного кода. На русском языке.', price:1290, category:'books', images:[], stock:12, rating:4.9, reviewCount:44,  sold:156, createdAt:new Date(Date.now()-86400000*30).toISOString(), active:true, badge:'ХИТ' },
  // Sports
  { id:'p15', sellerId:'acc-neo',  title:'Кресло Sky Ergo Pro',         description:'Ортопедическая поддержка, сетчатая спинка, 4D-подлокотники, до 130 кг, колёса PU.', price:18900, oldPrice:22900, category:'sports', images:[], stock:4,  rating:4.6, reviewCount:7,   sold:14,  createdAt:new Date(Date.now()-86400000*12).toISOString(), active:true, badge:'−17%', discount:17 },
  // Home
  { id:'p16', sellerId:'acc-luna', title:'Подставка под ноутбук Sky Stand', description:'Алюминий, 6 углов наклона, 2× USB-A хаб, слот для телефона, до 17".', price:1490, category:'home', images:[], stock:18, rating:4.7, reviewCount:14,  sold:52,  createdAt:new Date(Date.now()-86400000*4).toISOString(),  active:true },
  { id:'p17', sellerId:'acc-luna', title:'Органайзер Sky Desk Pro',      description:'Магнитный конструктор: лоток, держатель кабелей, стакан, подставка телефона.', price:990, category:'home', images:[], stock:22, rating:4.5, reviewCount:11,  sold:38,  createdAt:new Date(Date.now()-86400000*6).toISOString(),  active:true },
  // Beauty
  { id:'p18', sellerId:'acc-neo',  title:'Увлажняющий крем для рук «Геймер»', description:'50мл. Быстро впитывается, без запаха, не скользит. Витамин E + алоэ.', price:390, category:'beauty', images:[], stock:35, rating:4.3, reviewCount:5,   sold:89,  createdAt:new Date(Date.now()-86400000*3).toISOString(),  active:true },
  // Toys
  { id:'p19', sellerId:'acc-luna', title:'Лего-набор Sky HQ',            description:'1200 деталей, скоростная сборка, уровень 14+. Коллекционный набор Sky Ecosystem штаб.', price:3490, category:'toys', images:[], stock:6,  rating:4.8, reviewCount:3,   sold:12,  createdAt:new Date(Date.now()-86400000*1).toISOString(),  active:true, badge:'NEW' },
  { id:'p20', sellerId:'acc-neo',  title:'Фигурка Luna Nova Limited',   description:'ПВХ, высота 22см, подставка, ручная роспись. Лимитированный тираж 500 шт.', price:2490, category:'toys', images:[], stock:2,  rating:5.0, reviewCount:2,   sold:8,   createdAt:new Date(Date.now()-86400000*0.5).toISOString(), active:true, badge:'ЛИМ' },
];

// Существующие товары были созданы до появления Game Market — все они
// обычные (marketType='standard'), чтобы ничего не сломать.
const SEED_PRODUCTS: Product[] = SEED_PRODUCTS_RAW.map(p => ({ ...p, marketType: 'standard' as const }));



const SEED_SELLERS: SellerProfile[] = [
  { accountId:'acc-luna', shopName:'Luna Store',  description:'Гейминг-аксессуары от Luna Nova. Быстрая доставка!',     status:'active', balance:12450, totalEarned:84230, commission:0.05, createdAt:new Date(Date.now()-86400000*30).toISOString(), rating:4.8, salesCount:334 },
  { accountId:'acc-neo',  shopName:'Neo Market',  description:'Мерч команды и спортивное питание от Neo Driver.',        status:'active', balance:4310,  totalEarned:21700, commission:0.05, createdAt:new Date(Date.now()-86400000*14).toISOString(), rating:4.5, salesCount:210 },
];

const SEED_ORDERS_RAW: Omit<Order, 'marketType'>[] = [
  { id:'o1', trackNumber:'SKY-A3XK-7PQR', buyerId:'acc-neo',     sellerId:'acc-luna', productId:'p1', productTitle:'Игровая мышь SkyX Pro',   quantity:1, price:3490, total:3490, status:'delivered', address:'Москва, ул. Арбат 1',   createdAt:new Date(Date.now()-86400000*5).toISOString(),  shippedAt:new Date(Date.now()-86400000*4).toISOString(), deliveredAt:new Date(Date.now()-86400000*2).toISOString() },
  { id:'o2', trackNumber:'SKY-BF9M-2ZTL', buyerId:'acc-kutuzov', sellerId:'acc-neo',  productId:'p2', productTitle:'Футболка Neo Driver™',    quantity:2, price:1290, total:2580, status:'shipped',   address:'СПб, Невский пр. 100',  createdAt:new Date(Date.now()-86400000*2).toISOString(),  shippedAt:new Date(Date.now()-86400000*1).toISOString() },
  { id:'o3', trackNumber:'SKY-CX5N-KM8P', buyerId:'acc-neo',     sellerId:'acc-luna', productId:'p3', productTitle:'Коврик для мыши XL',      quantity:1, price:890,  total:890,  status:'confirmed', address:'Москва, ул. Арбат 1',   createdAt:new Date(Date.now()-86400000*1).toISOString() },
  { id:'o4', trackNumber:'SKY-DQ7R-WV3J', buyerId:'acc-kutuzov', sellerId:'acc-luna', productId:'p5', productTitle:'Наушники Sky Sound Pro',  quantity:1, price:6990, total:6990, status:'pending',   address:'Казань, ул. Пушкина 5', createdAt:new Date(Date.now()-3600000*2).toISOString() },
];
const SEED_ORDERS: Order[] = SEED_ORDERS_RAW.map(o => ({ ...o, marketType: 'standard' as const }));

const SEED_REVIEWS: Review[] = [
  { id:'r1', productId:'p1', buyerId:'acc-neo',     buyerName:'Neo Driver', rating:5, text:'Отличная мышь, реагирует мгновенно! RGB яркий, провод мягкий.',       createdAt:new Date(Date.now()-86400000*2).toISOString() },
  { id:'r2', productId:'p3', buyerId:'acc-kutuzov', buyerName:'Kutuzov',    rating:5, text:'Огромный, качественный. Лежит на всём столе. Рекомендую!',             createdAt:new Date(Date.now()-86400000*1).toISOString() },
  { id:'r3', productId:'p2', buyerId:'acc-luna',    buyerName:'Luna Nova',  rating:4, text:'Хлопок мягкий, принт ровный. Размер чуть больше ожидаемого.',          createdAt:new Date(Date.now()-86400000*3).toISOString() },
];

/* ── Игровой маркет: игры (управляются из Admin Panel) ── */
const SEED_GAMES: Game[] = [
  { id:'g-minecraft', title:'Minecraft', slug:'minecraft', description:'Кубический песочница-выживание.', categories:['currency','accounts','items','services'], order:0, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-gta5',      title:'GTA V',     slug:'gta-v',      description:'Экшн от третьего/первого лица в открытом мире.', categories:['currency','accounts','services'], order:1, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-roblox',    title:'Roblox',    slug:'roblox',     description:'Платформа пользовательских игр.', categories:['currency','accounts','items'], order:2, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-cs2',       title:'CS2',       slug:'cs2',        description:'Тактический шутер от первого лица.', categories:['skins','accounts','services'], order:3, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-fortnite',  title:'Fortnite',  slug:'fortnite',   description:'Королевская битва с элементами строительства.', categories:['currency','accounts','skins'], order:4, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-dota2',     title:'Dota 2',    slug:'dota-2',     description:'MOBA от Valve.', categories:['skins','accounts','services'], order:5, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-rust',      title:'Rust',      slug:'rust',       description:'Выживание в суровом открытом мире.', categories:['accounts','items','services'], order:6, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'g-pubg',      title:'PUBG',      slug:'pubg',       description:'Королевская битва с реалистичной баллистикой.', categories:['currency','accounts','skins'], order:7, hidden:false, createdAt:new Date(Date.now()-86400000*60).toISOString() },
];

interface MarketState {
  products:  Product[];
  orders:    Order[];
  sellers:   SellerProfile[];
  reviews:   Review[];
  withdraws: WithdrawRequest[];

  // -- Товары ------------------------------------------------
  addProduct:    (p: Omit<Product, 'id'|'rating'|'reviewCount'|'sold'|'createdAt'>) => string;
  updateProduct: (id: string, p: Partial<Product>) => void;
  deleteProduct: (id: string) => void;

  // -- Заказы ------------------------------------------------
  placeOrder:    (p: { productId: string; quantity: number; address: string }) => Order | null;
  confirmOrder:  (orderId: string) => void;                // продавец подтвердил
  shipOrder:     (orderId: string) => void;                // продавец отправил (трек уже есть)
  confirmDelivery:(orderId: string) => void;               // покупатель подтвердил получение
  adminForceDelivery:(orderId: string, note?: string) => void; // админ принудительно подтверждает за покупателя
  adminForceShipped:(orderId: string) => void;                 // админ принудительно подтверждает отправку
  disputeOrder:(orderId: string, reason: string) => void;      // открыть спор по заказу
  resolveOrderDispute:(orderId: string, winner:'seller'|'buyer', note:string) => void;
  cancelOrder:   (orderId: string, reason?: string) => void;

  // -- Продавцы ----------------------------------------------
  becomeSeller:  (shopName: string, description: string) => boolean;
  updateShop:    (p: Partial<Pick<SellerProfile,'shopName'|'description'>>) => void;
  withdraw:      (amount: number) => WithdrawRequest | null;  // 5% комиссия

  // -- Отзывы ------------------------------------------------
  addReview:     (p: { productId: string; rating: number; text: string }) => void;

  // -- Helpers -----------------------------------------------
  mySeller:      () => SellerProfile | null;
  myOrders:      () => Order[];         // как покупатель
  mySellerOrders:() => Order[];         // как продавец
}

const stored = load();

export const useMarketStore = create<MarketState>((set, get) => {
  const flush = () => {
    const s = get();
    save({ products: s.products, orders: s.orders, sellers: s.sellers, reviews: s.reviews, withdraws: s.withdraws });
  };
  const mut = (fn: (s: MarketState) => Partial<MarketState>) => {
    set(s => ({ ...s, ...fn(s) }));
    flush();
  };

  return {
    products:  stored?.products  ?? SEED_PRODUCTS,
    orders:    stored?.orders    ?? SEED_ORDERS,
    sellers:   stored?.sellers   ?? SEED_SELLERS,
    reviews:   stored?.reviews   ?? SEED_REVIEWS,
    withdraws: stored?.withdraws ?? [],

    /* -- Товары ----------------------------------------------- */
    addProduct: (p) => {
      const id = `prod-${crypto.randomUUID().slice(0,8)}`;
      mut(s => ({ products: [...s.products, { ...p, id, rating:0, reviewCount:0, sold:0, createdAt:new Date().toISOString() }] }));
      return id;
    },
    updateProduct: (id, p) => mut(s => ({ products: s.products.map(x => x.id===id ? {...x,...p} : x) })),
    deleteProduct: id => mut(s => ({ products: s.products.filter(x => x.id!==id) })),

    /* -- Заказы ----------------------------------------------- */
    placeOrder: ({ productId, quantity, address }) => {
      const uid    = me(); if (!uid) return null;
      const prod   = get().products.find(p => p.id===productId);
      if (!prod || prod.stock < quantity || !prod.active) return null;

      const estWeightKg = Math.max(0.5, quantity * 1.2); // грубая оценка веса для подбора ТК
      const delivery = pickDeliveryCompany(prod.sellerId, estWeightKg);

      const order: Order = {
        id:           `ord-${crypto.randomUUID().slice(0,8)}`,
        marketType:   prod.marketType,
        trackNumber:  genTrack(),
        buyerId:      uid,
        sellerId:     prod.sellerId,
        productId:    prod.id,
        productTitle: prod.title,
        productImage: prod.images[0],
        quantity,
        price:        prod.price,
        total:        prod.price * quantity,
        status:       'confirmed',   // автоподтверждение для демо
        address,
        createdAt:    new Date().toISOString(),
        deliveryCompanyId:   delivery.id,
        deliveryCompanyName: delivery.name,
        deliverySource:      delivery.source,
        deliveryPrice:       delivery.price,
      };
      mut(s => ({
        orders:   [...s.orders, order],
        products: s.products.map(p => p.id===productId
          ? { ...p, stock: p.stock-quantity, sold: p.sold+quantity }
          : p
        ),
      }));

      // Если доставку взяла на себя настоящая ТК (своя или сторонняя) —
      // заводим для неё реальный заказ в разделе "Заказы доставки".
      if (delivery.source !== 'skymarket') {
        const sellerName = useAuthStore.getState().accounts.find(a => a.id === prod.sellerId)?.name ?? 'Продавец';
        useTransportStore.getState().createOrderFromMarketplace(delivery.id, {
          sellerId: prod.sellerId, sellerName, productName: prod.title, qty: quantity,
          weightKg: estWeightKg, fromAddress: `Склад продавца (${sellerName})`, toAddress: address,
          price: delivery.price, distanceKm: Math.round(4 + Math.random() * 20),
        });
      }
      return order;
    },

    confirmOrder: id => mut(s => ({
      orders: s.orders.map(o => o.id===id && o.status==='pending' ? {...o, status:'confirmed'} : o)
    })),

    shipOrder: id => mut(s => ({
      orders: s.orders.map(o => o.id===id && (o.status==='confirmed'||o.status==='pending')
        ? { ...o, status:'shipped', shippedAt: new Date().toISOString() }
        : o
      )
    })),

    adminForceDelivery: (id, note) => {
      set(s => ({
        orders: s.orders.map(o => o.id===id ? {
          ...o, status:'delivered' as const, deliveredAt:new Date().toISOString(),
          cancelReason: note ?? 'Подтверждено администратором'
        } : o)
      }));
    },
    adminForceShipped: id => {
      set(s => ({
        orders: s.orders.map(o => o.id===id ? {
          ...o, status:'shipped' as const, shippedAt:new Date().toISOString()
        } : o)
      }));
    },
    disputeOrder: (id, reason) => {
      set(s => ({
        orders: s.orders.map(o => o.id===id ? { ...o, status:'disputed' as const, cancelReason:reason } : o)
      }));
    },
    resolveOrderDispute: (id, winner, note) => {
      // If seller wins - mark delivered (seller keeps money)
      // If buyer wins  - mark cancelled (buyer gets refund)
      set(s => ({
        orders: s.orders.map(o => o.id===id ? {
          ...o,
          status: winner==='seller' ? 'delivered' as const : 'cancelled' as const,
          cancelReason: `Спор решён: ${winner==='seller'?'победил продавец':'победил покупатель'}. ${note}`,
          deliveredAt: winner==='seller' ? new Date().toISOString() : undefined,
        } : o)
      }));
    },
    confirmDelivery: id => {
      const order = get().orders.find(o => o.id===id);
      if (!order || order.status!=='shipped') return;
      // Начисляем деньги продавцу
      const earned = order.total;
      mut(s => ({
        orders:  s.orders.map(o => o.id===id ? { ...o, status:'delivered', deliveredAt:new Date().toISOString() } : o),
        sellers: s.sellers.map(sel => sel.accountId===order.sellerId
          ? { ...sel, balance: sel.balance+earned, totalEarned: sel.totalEarned+earned, salesCount: sel.salesCount+1 }
          : sel
        ),
      }));
    },

    cancelOrder: (id, reason) => mut(s => ({
      orders: s.orders.map(o => o.id===id && !['delivered','cancelled'].includes(o.status)
        ? { ...o, status:'cancelled', cancelReason: reason }
        : o
      )
    })),

    /* -- Продавцы --------------------------------------------- */
    becomeSeller: (shopName, description) => {
      const uid = me(); if (!uid) return false;
      if (get().sellers.find(s => s.accountId===uid)) return false;
      const seller: SellerProfile = {
        accountId:   uid,
        shopName:    shopName.trim(),
        description: description.trim(),
        status:      'active',
        balance:     0,
        totalEarned: 0,
        commission:  0.05,
        createdAt:   new Date().toISOString(),
        rating:      0,
        salesCount:  0,
      };
      mut(s => ({ sellers: [...s.sellers, seller] }));
      return true;
    },

    updateShop: (p) => {
      const uid = me();
      mut(s => ({ sellers: s.sellers.map(sel => sel.accountId===uid ? {...sel,...p} : sel) }));
    },

    withdraw: (amount) => {
      const uid    = me();
      const seller = get().sellers.find(s => s.accountId===uid);
      if (!seller || seller.balance < amount || amount <= 0) return null;
      const fee = Math.round(amount * seller.commission);
      const net = amount - fee;
      const req: WithdrawRequest = {
        id:        `wd-${crypto.randomUUID().slice(0,8)}`,
        sellerId:  uid,
        amount,
        fee,
        net,
        status:    'done',
        createdAt: new Date().toISOString(),
      };
      mut(s => ({
        withdraws: [...s.withdraws, req],
        sellers:   s.sellers.map(sel => sel.accountId===uid
          ? { ...sel, balance: sel.balance - amount }
          : sel
        ),
      }));
      return req;
    },

    /* -- Отзывы ----------------------------------------------- */
    addReview: ({ productId, rating, text }) => {
      const uid = me(); if (!uid) return;
      const name = useAuthStore.getState().accounts.find(a=>a.id===uid)?.name ?? 'Аноним';
      const review: Review = {
        id:        `rev-${crypto.randomUUID().slice(0,8)}`,
        productId, buyerId:uid, buyerName:name, rating, text,
        createdAt: new Date().toISOString(),
      };
      mut(s => {
        const reviews = [...s.reviews, review];
        // Пересчитываем рейтинг товара
        const prodRevs = reviews.filter(r => r.productId===productId);
        const avg = prodRevs.reduce((a,r) => a+r.rating, 0) / prodRevs.length;
        return {
          reviews,
          products: s.products.map(p => p.id===productId
            ? { ...p, rating: Math.round(avg*10)/10, reviewCount: prodRevs.length }
            : p
          ),
        };
      });
    },

    /* -- Helpers ---------------------------------------------- */
    mySeller:       () => get().sellers.find(s => s.accountId===me()) ?? null,
    myOrders:       () => get().orders.filter(o => o.buyerId===me()),
    mySellerOrders: () => get().orders.filter(o => o.sellerId===me()),
  };
});
