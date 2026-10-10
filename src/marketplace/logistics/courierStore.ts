/* ======================================================================
   SKY MARKET / LOGISTICS — курьеры

   Хранилище стало кэшем ответов сервера. Раньше каталог курьеров был
   выдуманным списком в памяти вкладки: «заявка на сотрудничество»
   никуда не уходила, переписка существовала только у того, кто её
   открыл, а «курьер на связи» означало, что кто-то нажал кнопку у себя.

   Список функций и их имена прежние — экраны не переписаны. Изменилось
   то, откуда берётся правда.
====================================================================== */
import { create } from 'zustand';
import { useAuthStore } from '@/core/auth/store';
import type {
  Courier, CourierReview, CollabRequest, CollabStatus, CourierChatMessage,
  CourierAssignment, DeliveryNotification, DeliveryEventType,
  CourierVerification, PoolOrder, CourierStats, CourierEarning,
} from './types';
import {
  apiMyCourier, apiRegisterCourier, apiCourierPresence, apiCouriers, apiCourier,
  apiCourierFavorite, apiCourierReviews, apiAddCourierReview,
  apiSendCollab, apiCollabs, apiRespondCollab,
  apiCourierChat, apiSendCourierMessage,
  apiAssignments, apiAssignCourier, apiSetAssignmentStatus, apiReportAssignmentProblem,
  apiLogiNotifications, apiReadLogiNotification,
  apiOpenPool, apiPostOrderToPool, apiCancelPoolPosting, apiTakeOrder,
  apiCourierConfirmPickup, apiCourierConfirmDelivery,
  apiSetCourierBirthdate, apiMyVerification, apiSubmitVerification, apiUploadVerificationDoc,
  apiCourierStats, apiCourierEarnings,
} from './logisticsApi';

const me = () => useAuthStore.getState().currentUserId ?? '';

interface CourierState {
  couriers: Courier[];
  reviews: CourierReview[];
  favorites: string[];
  collabs: CollabRequest[];
  messages: CourierChatMessage[];
  notifications: DeliveryNotification[];
  assignments: CourierAssignment[];
  myProfile: Courier | null;
  loaded: boolean;

  /** Допуск к работе: возраст и паспорт — правду знает только сервер. */
  verification: CourierVerification | null;
  poolOrders: PoolOrder[];
  stats: CourierStats | null;
  earnings: CourierEarning[];

  load: () => Promise<void>;
  loadChat: (courierId: string, sellerId?: string) => Promise<void>;
  loadReviews: (courierId: string) => Promise<void>;

  toggleFavorite: (courierId: string) => Promise<void>;
  isFavorite: (courierId: string) => boolean;

  sendCollabRequest: (courierId: string, message: string) => Promise<CollabRequest | null>;
  respondCollab: (collabId: string, status: CollabStatus) => Promise<void>;
  endCollab: (collabId: string) => Promise<void>;
  collabWith: (courierId: string) => CollabRequest | null;
  myCollabs: () => CollabRequest[];

  sendMessage: (courierId: string, text: string, from?: 'seller' | 'courier') => Promise<void>;
  chatWith: (courierId: string) => CourierChatMessage[];

  assignCourier: (orderId: string, courierId: string) => Promise<void>;
  bulkAssignCourier: (orderIds: string[], courierId: string) => Promise<void>;
  setAssignmentStatus: (assignmentId: string, status: CourierAssignment['status']) => Promise<void>;
  assignmentForOrder: (orderId: string) => CourierAssignment | null;

  /** Уведомления складывает сервер. Здесь осталась только перезагрузка. */
  pushNotification: (courierId?: string, type?: DeliveryEventType, text?: string, orderId?: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  myNotifications: () => DeliveryNotification[];

  /** Геопозиции обновляет сам курьер. Перерисовка — просто перечитывание. */
  simulateTick: () => Promise<void>;
  addReview: (courierId: string, rating: number, text: string) => Promise<void>;
  reviewsFor: (courierId: string) => CourierReview[];

  registerAsCourier: (p: {
    name: string; phone: string; cityId: string; district: string;
    vehicle: Courier['vehicle']; pricePerDelivery: number;
    workFrom: string; workTo: string; bio: string;
  }) => Promise<void>;
  myCourierProfile: () => Courier | null;
  setMyOnline: (online: boolean) => Promise<{ ok: boolean; error?: string }>;

  /* ── Допуск к работе: дата рождения и проверка паспорта ──────────── */
  loadVerification: () => Promise<void>;
  setBirthdate: (dateOfBirth: string) => Promise<{ ok: boolean; error?: string }>;
  submitVerification: (fullName: string) => Promise<{ ok: boolean; error?: string }>;
  uploadVerificationDoc: (verificationId: string, file: Blob) => Promise<{ ok: boolean; error?: string }>;

  /* ── Пул заказов: доступные заказы и их самостоятельное взятие ───── */
  loadPool: () => Promise<void>;
  postOrderToPool: (orderId: string, priceKop: number, cityId: string, district: string) => Promise<{ ok: boolean; error?: string }>;
  cancelPoolPosting: (orderId: string) => Promise<void>;
  takeOrder: (orderId: string) => Promise<{ ok: boolean; error?: string }>;

  /* ── Получение от продавца / доставка покупателю: код или QR ─────── */
  confirmPickup: (orderId: string, proof: string) => Promise<{ ok: boolean; error?: string }>;
  confirmDelivery: (orderId: string, proof: string) => Promise<{ ok: boolean; error?: string; earned?: number }>;
  reportProblem: (assignmentId: string, reason: string) => Promise<{ ok: boolean; error?: string }>;
  myActiveAssignment: () => CourierAssignment | null;

  /* ── Статистика и заработок ────────────────────────────────────── */
  loadStats: () => Promise<void>;
  loadEarnings: () => Promise<void>;
}

export const useCourierStore = create<CourierState>((set, get) => ({
  couriers: [],
  reviews: [],
  favorites: [],
  collabs: [],
  messages: [],
  notifications: [],
  assignments: [],
  myProfile: null,
  loaded: false,

  verification: null,
  poolOrders: [],
  stats: null,
  earnings: [],

  load: async () => {
    const [list, mine, collabs, assignSeller, assignCourier, notes] = await Promise.all([
      apiCouriers(), apiMyCourier(), apiCollabs(),
      apiAssignments('seller'), apiAssignments('courier'), apiLogiNotifications(),
    ]);
    const couriers = list.ok && list.data ? list.data.couriers : [];
    set({
      couriers,
      favorites: couriers.filter((c) => c.favorite).map((c) => c.id),
      myProfile: mine.ok ? (mine.data?.courier ?? null) : null,
      collabs: collabs.ok && collabs.data ? collabs.data.collabs : [],
      assignments: [
        ...(assignSeller.ok && assignSeller.data ? assignSeller.data.assignments : []),
        ...(assignCourier.ok && assignCourier.data ? assignCourier.data.assignments : []),
      ],
      notifications: notes.ok && Array.isArray(notes.data?.items) ? notes.data!.items : [],
      loaded: true,
    });
  },

  loadChat: async (courierId, sellerId) => {
    const r = await apiCourierChat(courierId, sellerId);
    if (!r.ok || !r.data) return;
    set({
      messages: [...get().messages.filter((m) => m.courierId !== courierId), ...r.data.messages],
    });
  },

  loadReviews: async (courierId) => {
    const r = await apiCourierReviews(courierId);
    if (!r.ok || !r.data) return;
    set({ reviews: [...get().reviews.filter((x) => x.courierId !== courierId), ...r.data.reviews] });
  },

  toggleFavorite: async (courierId) => {
    const on = !get().favorites.includes(courierId);
    const r = await apiCourierFavorite(courierId, on);
    if (!r.ok) return;
    set({
      favorites: on
        ? [...get().favorites, courierId]
        : get().favorites.filter((id) => id !== courierId),
    });
  },

  isFavorite: (courierId) => get().favorites.includes(courierId),

  sendCollabRequest: async (courierId, message) => {
    const r = await apiSendCollab(courierId, message);
    const c = await apiCollabs();
    if (c.ok && c.data) set({ collabs: c.data.collabs });
    return r.ok && r.data ? r.data.collab : null;
  },

  respondCollab: async (collabId, status) => {
    await apiRespondCollab(collabId, status);
    const c = await apiCollabs();
    if (c.ok && c.data) set({ collabs: c.data.collabs });
    /* Принятая заявка открывает телефон курьера — список нужно перечитать. */
    const list = await apiCouriers();
    if (list.ok && list.data) set({ couriers: list.data.couriers });
  },

  endCollab: async (collabId) => { await get().respondCollab(collabId, 'ended'); },

  collabWith: (courierId) => get().collabs.find(
    (c) => c.courierId === courierId && c.sellerId === me()
      && (c.status === 'pending' || c.status === 'accepted')) ?? null,

  myCollabs: () => get().collabs,

  sendMessage: async (courierId, text, from) => {
    /* Кем написано, решает сервер по тому, кто спрашивает: присланное
       from здесь ничего не значит и передаётся только как подсказка о
       собеседнике, когда пишет курьер. */
    const sellerId = from === 'courier' ? undefined : undefined;
    await apiSendCourierMessage(courierId, text, sellerId);
    await get().loadChat(courierId);
  },

  chatWith: (courierId) => get().messages.filter((m) => m.courierId === courierId),

  assignCourier: async (orderId, courierId) => {
    await apiAssignCourier(orderId, courierId);
    const r = await apiAssignments('seller');
    if (r.ok && r.data) {
      set({
        assignments: [
          ...get().assignments.filter((a) => a.sellerId !== me()),
          ...r.data.assignments,
        ],
      });
    }
  },

  bulkAssignCourier: async (orderIds, courierId) => {
    for (const id of orderIds) await apiAssignCourier(id, courierId);
    const r = await apiAssignments('seller');
    if (r.ok && r.data) {
      set({
        assignments: [
          ...get().assignments.filter((a) => a.sellerId !== me()),
          ...r.data.assignments,
        ],
      });
    }
  },

  setAssignmentStatus: async (assignmentId, status) => {
    await apiSetAssignmentStatus(assignmentId, status);
    const [s, c] = await Promise.all([apiAssignments('seller'), apiAssignments('courier')]);
    set({
      assignments: [
        ...(s.ok && s.data ? s.data.assignments : []),
        ...(c.ok && c.data ? c.data.assignments : []),
      ],
    });
  },

  assignmentForOrder: (orderId) => get().assignments.find((a) => a.orderId === orderId) ?? null,

  pushNotification: async () => {
    const r = await apiLogiNotifications();
    if (r.ok && Array.isArray(r.data?.items)) set({ notifications: r.data!.items });
  },

  markNotificationRead: async (id) => {
    const r = await apiReadLogiNotification(id);
    // Прочитанным считаем, только если сервер подтвердил: иначе после
    // перезагрузки уведомление снова окажется непрочитанным.
    if (!r.ok) return;
    set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) });
  },

  myNotifications: () => get().notifications,

  simulateTick: async () => {
    const r = await apiCouriers();
    if (r.ok && r.data) set({ couriers: r.data.couriers });
  },

  addReview: async (courierId, rating, text) => {
    await apiAddCourierReview(courierId, rating, text);
    await get().loadReviews(courierId);
    const one = await apiCourier(courierId);
    if (one.ok && one.data) {
      set({ couriers: get().couriers.map((c) => (c.id === courierId ? one.data!.courier : c)) });
    }
  },

  reviewsFor: (courierId) => get().reviews.filter((r) => r.courierId === courierId),

  registerAsCourier: async (p) => {
    await apiRegisterCourier(p);
    await get().load();
  },

  myCourierProfile: () => get().myProfile,

  setMyOnline: async (online) => {
    const r = await apiCourierPresence({ online });
    if (r.ok && r.data) set({ myProfile: r.data.courier });
    await get().simulateTick();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  /* ── Допуск к работе: дата рождения и проверка паспорта ──────────── */

  loadVerification: async () => {
    const r = await apiMyVerification();
    if (r.ok && r.data) set({ verification: r.data.verification });
  },

  setBirthdate: async (dateOfBirth) => {
    const r = await apiSetCourierBirthdate(dateOfBirth);
    await get().loadVerification();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  submitVerification: async (fullName) => {
    const r = await apiSubmitVerification(fullName);
    if (r.ok && r.data) set({ verification: r.data.verification });
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  uploadVerificationDoc: async (verificationId, file) => {
    const r = await apiUploadVerificationDoc(verificationId, file);
    if (r.ok) await get().loadVerification();
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  /* ── Пул заказов ───────────────────────────────────────────────── */

  loadPool: async () => {
    const r = await apiOpenPool();
    if (r.ok && r.data) set({ poolOrders: r.data.items });
  },

  postOrderToPool: async (orderId, priceKop, cityId, district) => {
    const r = await apiPostOrderToPool(orderId, { priceKop, cityId, district });
    const s = await apiAssignments('seller');
    if (s.ok && s.data) {
      set({ assignments: [...get().assignments.filter((a) => a.sellerId !== me()), ...s.data.assignments] });
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  cancelPoolPosting: async (orderId) => {
    await apiCancelPoolPosting(orderId);
    const s = await apiAssignments('seller');
    if (s.ok && s.data) {
      set({ assignments: [...get().assignments.filter((a) => a.sellerId !== me()), ...s.data.assignments] });
    }
  },

  takeOrder: async (orderId) => {
    const r = await apiTakeOrder(orderId);
    await get().loadPool();
    const c = await apiAssignments('courier');
    if (c.ok && c.data) {
      set({ assignments: [...get().assignments.filter((a) => a.courierId !== get().myProfile?.id), ...c.data.assignments] });
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  /* ── Получение от продавца / доставка покупателю ──────────────────── */

  confirmPickup: async (orderId, proof) => {
    const r = await apiCourierConfirmPickup(orderId, proof);
    const c = await apiAssignments('courier');
    if (c.ok && c.data) {
      set({ assignments: [...get().assignments.filter((a) => a.courierId !== get().myProfile?.id), ...c.data.assignments] });
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  confirmDelivery: async (orderId, proof) => {
    const r = await apiCourierConfirmDelivery(orderId, proof);
    const c = await apiAssignments('courier');
    if (c.ok && c.data) {
      set({ assignments: [...get().assignments.filter((a) => a.courierId !== get().myProfile?.id), ...c.data.assignments] });
    }
    if (r.ok) await get().loadStats();
    return r.ok ? { ok: true, earned: r.data?.earned } : { ok: false, error: r.error };
  },

  reportProblem: async (assignmentId, reason) => {
    const r = await apiReportAssignmentProblem(assignmentId, reason);
    const c = await apiAssignments('courier');
    if (c.ok && c.data) {
      set({ assignments: [...get().assignments.filter((a) => a.courierId !== get().myProfile?.id), ...c.data.assignments] });
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },

  myActiveAssignment: () => {
    const mine = get().myProfile;
    if (!mine) return null;
    return get().assignments.find((a) => a.courierId === mine.id
      && ['assigned', 'picked_up', 'in_transit', 'problem'].includes(a.status)) ?? null;
  },

  /* ── Статистика и заработок ───────────────────────────────────────── */

  loadStats: async () => {
    const r = await apiCourierStats();
    if (r.ok && r.data) set({ stats: r.data.stats });
  },

  loadEarnings: async () => {
    const r = await apiCourierEarnings();
    if (r.ok && r.data) set({ earnings: r.data.items });
  },
}));
