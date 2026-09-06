/* ======================================================================
   SKY MARKET / LOGISTICS  —  Courier store
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import { pointForSeed, jitter } from './geo';
import type {
  Courier, CourierReview, CollabRequest, CourierChatMessage,
  DeliveryNotification, CourierAssignment, CollabStatus, DeliveryEventType,
} from './types';

const KEY = 'sky:logistics:couriers:v1';
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

const genId = (p: string) => `${p}-${crypto.randomUUID().slice(0,8)}`;

/* ── Seed-данные ──────────────────────────────────────────────────── */
const SEED_COURIERS: Courier[] = [
  { id:'cr1', name:'Иван Петров',     avatar:'🚴', phone:'+7 999 111-22-33', cityId:'msk', district:'ЦАО',    vehicle:'bike',    rating:4.9, reviewCount:58, deliveriesCount:234, pricePerDelivery:180, workFrom:'08:00', workTo:'22:00', online:true,  bio:'Работаю быстро и аккуратно, есть термобокс для еды.', location:pointForSeed('msk','cr1'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*120).toISOString() },
  { id:'cr2', name:'Алексей Смирнов', avatar:'🛵', phone:'+7 999 222-33-44', cityId:'msk', district:'САО',    vehicle:'scooter', rating:4.7, reviewCount:41, deliveriesCount:189, pricePerDelivery:220, workFrom:'09:00', workTo:'21:00', online:true,  bio:'Доставка крупногабаритных товаров, есть багажный бокс.', location:pointForSeed('msk','cr2'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*90).toISOString() },
  { id:'cr3', name:'Мария Козлова',   avatar:'🚗', phone:'+7 999 333-44-55', cityId:'msk', district:'ЗАО',    vehicle:'car',     rating:4.8, reviewCount:77, deliveriesCount:312, pricePerDelivery:350, workFrom:'07:00', workTo:'23:00', online:false, bio:'Авто-доставка по всему городу, до 50кг.',               location:pointForSeed('msk','cr3'), updatedAt:new Date(Date.now()-3600000*4).toISOString(), createdAt:new Date(Date.now()-86400000*200).toISOString() },
  { id:'cr4', name:'Дмитрий Новиков', avatar:'🛵', phone:'+7 999 444-55-66', cityId:'msk', district:'ЮВАО',   vehicle:'scooter', rating:4.6, reviewCount:24, deliveriesCount:98,  pricePerDelivery:200, workFrom:'10:00', workTo:'20:00', online:true,  bio:'Новичок, но очень ответственный. Гибкий график.',       location:pointForSeed('msk','cr4'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*30).toISOString() },
  { id:'cr5', name:'Елена Сидорова',  avatar:'🚴', phone:'+7 999 555-66-77', cityId:'spb', district:'Центральный', vehicle:'bike', rating:5.0, reviewCount:103,deliveriesCount:456, pricePerDelivery:170, workFrom:'08:00', workTo:'22:00', online:true,  bio:'Топ курьер СПб. Аккуратная упаковка, всегда на связи.', location:pointForSeed('spb','cr5'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*300).toISOString() },
  { id:'cr6', name:'Сергей Волков',   avatar:'🚐', phone:'+7 999 666-77-88', cityId:'spb', district:'Невский',     vehicle:'van',  rating:4.4, reviewCount:19, deliveriesCount:67,  pricePerDelivery:450, workFrom:'06:00', workTo:'18:00', online:false, bio:'Грузовая доставка, паллеты, переезды складов.',         location:pointForSeed('spb','cr6'), updatedAt:new Date(Date.now()-3600000*9).toISOString(), createdAt:new Date(Date.now()-86400000*60).toISOString() },
  { id:'cr7', name:'Алия Гарифуллина',avatar:'🚲', phone:'+7 999 777-88-99', cityId:'kzn', district:'Вахитовский',  vehicle:'foot', rating:4.9, reviewCount:35, deliveriesCount:140, pricePerDelivery:130, workFrom:'09:00', workTo:'21:00', online:true,  bio:'Пешая доставка в центре, без пробок и опозданий.',      location:pointForSeed('kzn','cr7'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*45).toISOString() },
  { id:'cr8', name:'Павел Орлов',     avatar:'🛵', phone:'+7 999 888-99-00', cityId:'ekb', district:'Ленинский',   vehicle:'scooter', rating:4.5, reviewCount:28, deliveriesCount:115, pricePerDelivery:210, workFrom:'10:00', workTo:'22:00', online:true,  bio:'Работаю вечерами и в выходные.',                        location:pointForSeed('ekb','cr8'), updatedAt:new Date().toISOString(), createdAt:new Date(Date.now()-86400000*15).toISOString() },
];

const SEED_REVIEWS: CourierReview[] = [
  { id:'crv1', courierId:'cr1', sellerId:'acc-luna', sellerName:'Luna Store', rating:5, text:'Всегда вовремя, очень вежливый. Рекомендую!', createdAt:new Date(Date.now()-86400000*10).toISOString() },
  { id:'crv2', courierId:'cr1', sellerId:'acc-neo',  sellerName:'Neo Market', rating:5, text:'Берёт крупные партии без проблем.',           createdAt:new Date(Date.now()-86400000*20).toISOString() },
  { id:'crv3', courierId:'cr3', sellerId:'acc-neo',  sellerName:'Neo Market', rating:4, text:'Хорошо, но один раз задержался на 30 минут.',  createdAt:new Date(Date.now()-86400000*5).toISOString() },
  { id:'crv4', courierId:'cr5', sellerId:'acc-luna', sellerName:'Luna Store', rating:5, text:'Лучший курьер в городе. Полная отдача!',       createdAt:new Date(Date.now()-86400000*3).toISOString() },
];

interface CourierState {
  couriers:      Courier[];
  reviews:       CourierReview[];
  favorites:     string[];             // courierId списком, общий список (без привязки к продавцу — упрощение для демо)
  collabs:       CollabRequest[];
  messages:      CourierChatMessage[];
  notifications: DeliveryNotification[];
  assignments:   CourierAssignment[];

  toggleFavorite:(courierId: string) => void;
  isFavorite:    (courierId: string) => boolean;

  sendCollabRequest: (courierId: string, message: string) => CollabRequest;
  respondCollab:     (collabId: string, status: CollabStatus) => void;
  endCollab:         (collabId: string) => void;
  collabWith:        (courierId: string) => CollabRequest | null;
  myCollabs:         () => CollabRequest[];

  sendMessage:  (courierId: string, text: string, from?: 'seller'|'courier') => void;
  chatWith:     (courierId: string) => CourierChatMessage[];

  assignCourier:    (orderId: string, courierId: string) => void;
  bulkAssignCourier:(orderIds: string[], courierId: string) => void;
  setAssignmentStatus:(assignmentId: string, status: CourierAssignment['status']) => void;
  assignmentForOrder:(orderId: string) => CourierAssignment | null;

  pushNotification: (courierId: string, type: DeliveryEventType, text: string, orderId?: string) => void;
  markNotificationRead: (id: string) => void;
  myNotifications: () => DeliveryNotification[];

  simulateTick: () => void; // обновляет геопозиции онлайн-курьеров (имитация real-time)
  addReview: (courierId: string, rating: number, text: string) => void;
  reviewsFor: (courierId: string) => CourierReview[];

  // Самостоятельная регистрация: пользователь сам приходит и устраивается курьером.
  // Не меняет логику существующей системы — просто добавляет новую запись в тот же каталог,
  // который уже используют продавцы в CourierHub.
  registerAsCourier: (p: { name: string; avatar: string; phone: string; cityId: string; district: string; vehicle: Courier['vehicle']; pricePerDelivery: number; workFrom: string; workTo: string; bio: string }) => void;
  myCourierProfile: () => Courier | null;
  setMyOnline: (online: boolean) => void;
}

const stored = load();

export const useCourierStore = create<CourierState>((set, get) => {
  const flush = () => {
    const s = get();
    save({
      couriers: s.couriers, reviews: s.reviews, favorites: s.favorites,
      collabs: s.collabs, messages: s.messages,
      notifications: s.notifications, assignments: s.assignments,
    });
  };
  const mut = (fn: (s: CourierState) => Partial<CourierState>) => {
    set(s => ({ ...s, ...fn(s) }));
    flush();
  };

  return {
    couriers:      stored?.couriers      ?? SEED_COURIERS,
    reviews:       stored?.reviews       ?? SEED_REVIEWS,
    favorites:     stored?.favorites     ?? [],
    collabs:       stored?.collabs       ?? [],
    messages:      stored?.messages      ?? [],
    notifications: stored?.notifications ?? [],
    assignments:   stored?.assignments   ?? [],

    toggleFavorite: (courierId) => mut(s => ({
      favorites: s.favorites.includes(courierId)
        ? s.favorites.filter(id => id !== courierId)
        : [...s.favorites, courierId],
    })),
    isFavorite: (courierId) => get().favorites.includes(courierId),

    sendCollabRequest: (courierId, message) => {
      const sellerId = me();
      const req: CollabRequest = {
        id: genId('collab'), courierId, sellerId,
        message: message.trim(), status: 'pending',
        createdAt: new Date().toISOString(),
      };
      mut(s => ({ collabs: [...s.collabs.filter(c => !(c.courierId===courierId && c.sellerId===sellerId && c.status==='pending')), req] }));
      return req;
    },

    respondCollab: (collabId, status) => mut(s => ({
      collabs: s.collabs.map(c => c.id === collabId
        ? { ...c, status, respondedAt: new Date().toISOString() }
        : c),
    })),

    endCollab: (collabId) => mut(s => ({
      collabs: s.collabs.map(c => c.id === collabId ? { ...c, status: 'ended' as const, respondedAt: new Date().toISOString() } : c),
    })),

    collabWith: (courierId) => {
      const sellerId = me();
      const list = get().collabs.filter(c => c.courierId===courierId && c.sellerId===sellerId);
      return list.length ? list[list.length-1] : null;
    },

    myCollabs: () => {
      const sellerId = me();
      return get().collabs.filter(c => c.sellerId === sellerId);
    },

    sendMessage: (courierId, text, from: 'seller'|'courier' = 'seller') => {
      if (!text.trim()) return;
      const sellerId = me();
      const msg: CourierChatMessage = {
        id: genId('msg'), courierId, sellerId, from,
        text: text.trim(), createdAt: new Date().toISOString(),
      };
      mut(s => ({ messages: [...s.messages, msg] }));
    },

    chatWith: (courierId) => {
      const sellerId = me();
      return get().messages.filter(m => m.courierId===courierId && m.sellerId===sellerId);
    },

    assignCourier: (orderId, courierId) => {
      const sellerId = me();
      const assignment: CourierAssignment = {
        id: genId('asg'), orderId, courierId, sellerId,
        status: 'assigned', assignedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      mut(s => ({
        assignments: [...s.assignments.filter(a => a.orderId !== orderId), assignment],
      }));
      get().pushNotification(courierId, 'accepted', 'Заказ назначен курьеру', orderId);
    },

    bulkAssignCourier: (orderIds, courierId) => {
      const sellerId = me();
      const now = new Date().toISOString();
      const news: CourierAssignment[] = orderIds.map(orderId => ({
        id: genId('asg'), orderId, courierId, sellerId,
        status: 'assigned', assignedAt: now, updatedAt: now,
      }));
      mut(s => ({
        assignments: [...s.assignments.filter(a => !orderIds.includes(a.orderId)), ...news],
      }));
      get().pushNotification(courierId, 'accepted', `Назначено ${orderIds.length} заказ(ов)`, undefined);
    },

    setAssignmentStatus: (assignmentId, status) => mut(s => ({
      assignments: s.assignments.map(a => a.id === assignmentId
        ? { ...a, status, updatedAt: new Date().toISOString() }
        : a),
    })),

    assignmentForOrder: (orderId) => get().assignments.find(a => a.orderId === orderId) ?? null,

    pushNotification: (courierId, type, text, orderId) => {
      const sellerId = me();
      const note: DeliveryNotification = {
        id: genId('ntf'), courierId, sellerId, orderId, type, text,
        read: false, createdAt: new Date().toISOString(),
      };
      mut(s => ({ notifications: [note, ...s.notifications].slice(0, 100) }));
    },

    markNotificationRead: (id) => mut(s => ({
      notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
    })),

    myNotifications: () => {
      const sellerId = me();
      return get().notifications.filter(n => n.sellerId === sellerId);
    },

    simulateTick: () => mut(s => ({
      couriers: s.couriers.map(c => c.online
        ? { ...c, location: jitter(c.location), updatedAt: new Date().toISOString() }
        : c),
    })),

    addReview: (courierId, rating, text) => {
      const sellerId = me();
      const sellerName = useAuthStore.getState().accounts.find(a => a.id===sellerId)?.name ?? 'Продавец';
      const review: CourierReview = {
        id: genId('crv'), courierId, sellerId, sellerName, rating, text: text.trim(),
        createdAt: new Date().toISOString(),
      };
      mut(s => {
        const reviews = [...s.reviews, review];
        const forCourier = reviews.filter(r => r.courierId === courierId);
        const avg = forCourier.reduce((a,r) => a+r.rating, 0) / forCourier.length;
        return {
          reviews,
          couriers: s.couriers.map(c => c.id === courierId
            ? { ...c, rating: Math.round(avg*10)/10, reviewCount: forCourier.length }
            : c),
        };
      });
    },

    reviewsFor: (courierId) => get().reviews.filter(r => r.courierId === courierId)
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),

    registerAsCourier: (p) => {
      const uid = me();
      if (!uid) return;
      const existing = get().couriers.find(c => c.id === uid);
      if (existing) { mut(s => ({ couriers: s.couriers.map(c => c.id === uid ? { ...c, ...p, online: true, updatedAt: new Date().toISOString() } : c) })); return; }
      const profile: Courier = {
        id: uid, name: p.name, avatar: p.avatar, phone: p.phone, cityId: p.cityId, district: p.district,
        vehicle: p.vehicle, rating: 5, reviewCount: 0, deliveriesCount: 0, pricePerDelivery: p.pricePerDelivery,
        workFrom: p.workFrom, workTo: p.workTo, online: true, bio: p.bio,
        location: pointForSeed(p.cityId, uid), updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      mut(s => ({ couriers: [profile, ...s.couriers] }));
    },

    myCourierProfile: () => get().couriers.find(c => c.id === me()) ?? null,

    setMyOnline: (online) => {
      const uid = me();
      mut(s => ({ couriers: s.couriers.map(c => c.id === uid ? { ...c, online, updatedAt: new Date().toISOString() } : c) }));
    },
  };
});
