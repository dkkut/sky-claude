/* Sky Business — отдельная среда экосистемы (на одном уровне со «Студией»).
   Это оболочка: собственная навигация, обзор и настройки. Сами системы — прежние компоненты со своей логикой,
   данными и API (SkyKassa Business, кабинет продавца, ПВЗ, логистика, бизнес-часть Sky GO); здесь они только собраны под единой навигацией. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Wallet, Store, PackageCheck, Truck, Car, BarChart3, Settings2, ChevronRight, Loader2,
  CheckCircle2, Clock3, CircleDashed, LifeBuoy, UserCog,
} from 'lucide-react';
import { ModuleGate } from '@/core/moduleClosures';
import { useAuthStore } from '@/core/auth/store';
import { useModuleStore } from '@/data/state/modules';
import { useMarketStore } from '@/marketplace/store';
import { apiMarketTicket } from '@/marketplace/marketApi';
import { BecomeSeller, SellerCabinet } from '@/marketplace/SellerCabinet';
import { PvzCabinet } from '@/marketplace/PvzCabinet';
import { CarrierCabinet } from '@/marketplace/CarrierCabinet';
import { TransportCompanyHub } from '@/marketplace/logistics/TransportCompanyHub';
import { WarehouseHub } from '@/marketplace/logistics/WarehouseHub';
import { CellMarket } from '@/marketplace/logistics/CellMarket';
import { ShipmentHub } from '@/marketplace/logistics/ShipmentHub';
import { PassHub } from '@/marketplace/logistics/PassHub';
import { SellerBatches } from '@/marketplace/logistics/Batches';
import { KassaBusiness } from '@/kassabiz/KassaBusiness';
import { AnalyticsView } from '@/kassabiz/Team';
import * as K from '@/kassabiz/api';
import { bizApi } from '@/go/bizApi';
import { goApi } from '@/go/api';
import { SkyGo } from '@/go/GoModule';

type Sec = 'overview' | 'kassa' | 'seller' | 'pvz' | 'logistics' | 'go' | 'analytics' | 'settings';
const SECTIONS: { id: Sec; label: string; hint: string; icon: typeof Wallet; closedKey?: string }[] = [
  { id: 'overview',  label: 'Обзор',      hint: 'Все ваши бизнес-системы',            icon: LayoutDashboard },
  { id: 'kassa',     label: 'Касса',      hint: 'Sky для бизнеса: оплата, QR, витрина', icon: Wallet, closedKey: 'kbiz' },
  { id: 'seller',    label: 'Магазин',    hint: 'Sky Seller: товары и заказы',          icon: Store, closedKey: 'market' },
  { id: 'pvz',       label: 'Пункты выдачи', hint: 'Sky ПВЗ',                          icon: PackageCheck, closedKey: 'pvz' },
  { id: 'logistics', label: 'Логистика',  hint: 'Доставка, склады, отправления',        icon: Truck, closedKey: 'market' },
  { id: 'go',        label: 'Sky GO',     hint: 'Организации, водители, парковки',      icon: Car, closedKey: 'go' },
  { id: 'analytics', label: 'Аналитика',  hint: 'Показатели SkyKassa Business',         icon: BarChart3, closedKey: 'kbiz' },
  { id: 'settings',  label: 'Настройки',  hint: 'Раздел по умолчанию, поддержка',       icon: Settings2 },
];
const IDS = new Set<string>(SECTIONS.map((s) => s.id));
const DEFAULT_KEY = 'sky:biz:default';
const readDefault = (): Sec => { try { const v = localStorage.getItem(DEFAULT_KEY); return v && IDS.has(v) ? (v as Sec) : 'overview'; } catch { return 'overview'; } };

const Wait = () => <div className="grid h-full place-items-center py-16"><Loader2 className="animate-spin" size={20} style={{ color: 'var(--t3)' }} /></div>;
const fmtRub = (n: number) => `${Math.round(n).toLocaleString('ru')} ₽`;

type Tone = 'on' | 'wait' | 'off';
const Status = ({ tone, children }: { tone: Tone; children: ReactNode }) => {
  const c = tone === 'on' ? '#10b981' : tone === 'wait' ? '#f59e0b' : 'var(--t3)';
  const I = tone === 'on' ? CheckCircle2 : tone === 'wait' ? Clock3 : CircleDashed;
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}><I size={11} />{children}</span>;
};

/* ── Обзор ── */
interface Facts {
  kbiz: { name: string; sub: string; stats: K.Stats | null } | null | undefined;
  seller: 'none' | 'pending' | 'active' | 'suspended' | undefined;
  pvz: number | undefined; carriers: number | undefined;
  go: { orgs: number; roles: number } | undefined;
}
const SUB: Record<string, string> = { inactive: 'подписка не активна', active: 'подписка активна', expiring: 'подписка скоро истекает', suspended: 'приостановлена', expired: 'подписка истекла' };

const Overview = ({ open }: { open: (s: Sec) => void }) => {
  const { seller, sellerLoaded, myPvz, myCarriers } = useMarketStore();
  const [kb, setKb] = useState<Facts['kbiz']>(undefined);
  const [go, setGo] = useState<Facts['go']>(undefined);
  useEffect(() => {
    void (async () => {
      const me = await K.kbMe();
      if (!me.ok || !me.data.business) { setKb(null); return; }
      const ov = await K.kbOverview();
      setKb({ name: me.data.business.name, sub: SUB[me.data.subscription.status] ?? '', stats: ov.ok ? ov.data.stats : null });
    })();
    void (async () => {
      const [w, e] = await Promise.all([bizApi.workspaces(), goApi.executors()]);
      setGo({ orgs: w.ok ? w.data!.orgs.filter((o) => o.staff).length : 0, roles: e.ok ? e.data!.executors.filter((x) => x.status === 'approved').length : 0 });
    })();
  }, []);
  const st = kb?.stats;
  const kpis: [string, string][] = st ? [
    ['Подтверждено владельцем', fmtRub(st.confirmedByOwnerSumRub)],
    ['Ждут проверки оплаты', String(st.awaiting)],
    ['Заявок на оплату', String(st.requests)],
    ['Страниц оплаты', String(st.qr)],
  ] : [];
  const cards: { id: Sec; title: string; icon: typeof Wallet; tone: Tone; badge: string; lines: string[] }[] = [
    { id: 'kassa', title: 'Касса и оплата', icon: Wallet,
      tone: kb ? 'on' : 'off', badge: kb === undefined ? '…' : kb ? 'подключено' : 'не подключено',
      lines: kb ? [kb.name, kb.sub] : ['Страницы оплаты, QR, чаевые, счета и витрина. Деньги идут вам напрямую.'] },
    { id: 'seller', title: 'Магазин (Sky Seller)', icon: Store,
      tone: !sellerLoaded ? 'off' : seller ? (seller.status === 'active' ? 'on' : 'wait') : 'off',
      badge: !sellerLoaded ? '…' : seller ? (seller.status === 'active' ? 'работает' : seller.status === 'pending' ? 'на проверке' : 'приостановлен') : 'не открыт',
      lines: seller ? [seller.shopName, seller.ordersTotal == null ? '' : seller.ordersDone == null ? `Заказов: ${seller.ordersTotal}` : `Заказов: ${seller.ordersTotal}, выполнено ${seller.ordersDone}`] : ['Откройте магазин в Sky Market и торгуйте после проверки.'] },
    { id: 'pvz', title: 'Пункты выдачи (Sky ПВЗ)', icon: PackageCheck,
      tone: myPvz.length ? 'on' : 'off', badge: myPvz.length ? `пунктов: ${myPvz.length}` : 'нет пунктов',
      lines: myPvz.length ? myPvz.slice(0, 2).map((p) => `${p.title}, ${p.city}`) : ['Заявка на ПВЗ — для ИП и организаций.'] },
    { id: 'logistics', title: 'Логистика', icon: Truck,
      tone: myCarriers.length ? 'on' : 'off', badge: myCarriers.length ? `компаний: ${myCarriers.length}` : 'доступно',
      lines: ['Транспортная компания, склады, ячейки, отправления, поставки курьеру.'] },
    { id: 'go', title: 'Sky GO для бизнеса', icon: Car,
      tone: go && (go.orgs || go.roles) ? 'on' : 'off', badge: go === undefined ? '…' : go.orgs || go.roles ? `пространств: ${go.orgs + go.roles}` : 'не подключено',
      lines: ['Организации и сотрудники, водитель/курьер, парковки, жильё, заведения.'] },
  ];
  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 overflow-x-hidden p-4">
      <div className="bz-hero rounded-3xl p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,.7)' }}>Сервисы для бизнеса</p>
        <p className="mt-1 text-2xl font-black text-white">Всё для вашего дела в одном месте</p>
        <p className="mt-1 max-w-xl text-[13px]" style={{ color: 'rgba(255,255,255,.82)' }}>Магазин, оплата, пункты выдачи, логистика и коммерческие направления Sky GO. Каждая система работает со своими данными — здесь они собраны вместе.</p>
      </div>
      {kpis.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 md:grid-cols-4">
          {kpis.map(([k, v]) => <div key={k} className="bz-card min-w-0 break-words rounded-2xl p-3"><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{k}</p><p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{v}</p></div>)}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <button key={c.id} type="button" onClick={() => open(c.id)} className="bz-card group flex min-w-0 flex-col gap-2 break-words rounded-2xl p-4 text-left">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: 'color-mix(in srgb, #10b981 16%, transparent)' }}><c.icon size={19} style={{ color: '#10b981' }} /></div>
              <p className="min-w-0 flex-1 truncate text-[14px] font-bold" style={{ color: 'var(--t1)' }}>{c.title}</p>
              <Status tone={c.tone}>{c.badge}</Status>
            </div>
            {c.lines.filter(Boolean).map((l, i) => <p key={i} translate="no" className="truncate text-[12px]" style={{ color: 'var(--t2)' }}>{l}</p>)}
            <span className="mt-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: '#10b981' }}>Открыть <ChevronRight size={13} /></span>
          </button>
        ))}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Цифры берутся из самих систем; если системы не подключены, показатели не выдумываются. Sky не принимает деньги покупателей — оплата идёт напрямую на ваши реквизиты.</p>
    </div>
  );
};

/* ── Разделы-обёртки ── */
const SellerSection = () => {
  const { seller, sellerLoaded } = useMarketStore();
  const meId = useAuthStore((s) => s.currentUserId) ?? '';
  if (!sellerLoaded) return <Wait />;
  return seller ? <SellerCabinet seller={seller} meId={meId} /> : <div className="h-full overflow-y-auto"><BecomeSeller /></div>;
};

const LOGI: { id: string; label: string; node: () => ReactNode }[] = [
  { id: 'carrier',   label: 'Доставка',     node: () => <CarrierCabinet /> },
  { id: 'transport', label: 'Транспорт',    node: () => <TransportCompanyHub /> },
  { id: 'warehouses', label: 'Склады',      node: () => <WarehouseHub /> },
  { id: 'cells',     label: 'Ячейки',       node: () => <CellMarket /> },
  { id: 'shipments', label: 'Отправления',  node: () => <ShipmentHub /> },
  { id: 'batches',   label: 'Поставки',     node: () => <SellerBatches /> },
  { id: 'passes',    label: 'Пропуска',     node: () => <PassHub /> },
];
const Logistics = () => {
  const [t, setT] = useState('carrier');
  const seller = useMarketStore((s) => s.seller);
  const cur = LOGI.find((x) => x.id === t) ?? LOGI[0];
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-3">
        <div className="glass-pill flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {LOGI.map((x) => (
            <button key={x.id} type="button" onClick={() => setT(x.id)} className="relative isolate shrink-0 rounded-full px-4 py-2 text-[12px] font-semibold" style={{ color: t === x.id ? 'var(--t1)' : 'var(--t3)' }}>
              {x.label}
              {t === x.id && <motion.div layoutId="bz-logi" className="glass-lens absolute inset-0 -z-10" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            </button>
          ))}
        </div>
        {!seller && <p className="mt-2 text-[11.5px]" style={{ color: 'var(--t3)' }}>Часть логистики (склады, отправления, поставки) работает вместе с магазином Sky Seller. Откройте магазин в разделе «Магазин».</p>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{cur.node()}</div>
    </div>
  );
};

const Analytics = () => {
  const [has, setHas] = useState<boolean | undefined>(undefined);
  useEffect(() => { void K.kbMe().then((r) => setHas(r.ok ? !!r.data.business : false)); }, []);
  if (has === undefined) return <Wait />;
  if (!has) return <p className="p-4 text-sm" style={{ color: 'var(--t3)' }}>Аналитика появится, когда вы подключите SkyKassa Business в разделе «Касса».</p>;
  return (
    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-4">
      <p className="mb-2 text-base font-black" style={{ color: 'var(--t1)' }}>Показатели SkyKassa Business</p>
      <AnalyticsView />
      <p className="mt-3 text-[11px]" style={{ color: 'var(--t3)' }}>Статистика заказов магазина и Sky GO — в их кабинетах («Магазин», «Sky GO»): там данные считаются по их собственным таблицам.</p>
    </div>
  );
};

const Settings = ({ open }: { open: (s: Sec) => void }) => {
  const [def, setDef] = useState<Sec>(readDefault);
  const setModule = useModuleStore((s) => s.setActiveModule);
  const setProfileSection = useModuleStore((s) => s.setPendingProfileSection);
  const pick = (v: Sec) => { setDef(v); try { localStorage.setItem(DEFAULT_KEY, v); } catch { /* ok */ } };
  const toProfile = (sec: string) => { setProfileSection(sec); setModule('profile'); };
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4">
      <p className="text-base font-black" style={{ color: 'var(--t1)' }}>Настройки сервисов для бизнеса</p>
      <div className="bz-card rounded-2xl p-4">
        <label className="block text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Раздел, который открывается первым (на этом устройстве)
          <select value={def} onChange={(e) => pick(e.target.value as Sec)} className="mt-1 block w-full rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
            {SECTIONS.filter((s) => s.id !== 'settings').map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {([
        ['Реквизиты и подписка Sky для бизнеса', 'Меняются в разделе «Касса» (смена реквизитов — с кодом аутентификатора).', () => open('kassa'), Wallet],
        ['Безопасность аккаунта', 'Профиль → Sky ID: аутентификатор, устройства, защита входа.', () => toProfile('skyid'), UserCog],
        ['Поддержка', 'Обращение по любой бизнес-системе — через техническую поддержку Sky.', () => toProfile('support'), LifeBuoy],
      ] as [string, string, () => void, typeof Wallet][]).map(([t, h, go, I]) => (
        <button key={t} type="button" onClick={go} className="bz-card flex w-full items-center gap-3 rounded-2xl p-4 text-left">
          <I size={18} style={{ color: '#10b981' }} /><span className="min-w-0 flex-1"><span className="block text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{t}</span><span className="block text-[11.5px]" style={{ color: 'var(--t3)' }}>{h}</span></span><ChevronRight size={14} style={{ color: 'var(--t3)' }} />
        </button>
      ))}
    </div>
  );
};

/* ── Оболочка ── */
export const BusinessModule = () => {
  const userId = useAuthStore((s) => s.currentUserId);
  const pending = useModuleStore((s) => s.pendingBusinessSection);
  const setPending = useModuleStore((s) => s.setPendingBusinessSection);
  const { loadConfig, loadSeller, loadCarrier, loadMyPvz } = useMarketStore();
  const [sec, setSecState] = useState<Sec>(() => {
    let q = ''; try { q = new URLSearchParams(location.search).get('bsec') ?? ''; } catch { /* ok */ }
    const p = useModuleStore.getState().pendingBusinessSection;
    return IDS.has(p ?? '') ? (p as Sec) : IDS.has(q) ? (q as Sec) : readDefault();
  });

  /* Общая подготовка данных Market для кабинетов (пропуск для картинок, настройки, магазин, ПВЗ, перевозчик). */
  useEffect(() => { if (!userId) return; void apiMarketTicket(); void loadConfig(); void loadSeller(); void loadCarrier(); void loadMyPvz(); }, [userId]);

  useEffect(() => { if (pending && IDS.has(pending)) { setSecState(pending as Sec); setPending(null); } }, [pending]);

  /* Прямая ссылка: ?module=business&bsec=<раздел> держится в адресе, пока среда открыта. */
  useEffect(() => {
    try { const u = new URL(location.href); u.searchParams.set('module', 'business'); u.searchParams.set('bsec', sec); history.replaceState(null, '', u); } catch { /* ok */ }
  }, [sec]);
  useEffect(() => () => { try { const u = new URL(location.href); u.searchParams.delete('bsec'); if (u.searchParams.get('module') === 'business') u.searchParams.delete('module'); history.replaceState(null, '', u); } catch { /* ok */ } }, []);

  const setSec = useCallback((s: Sec) => setSecState(s), []);
  const cur = SECTIONS.find((s) => s.id === sec) ?? SECTIONS[0];

  const body = useMemo(() => {
    const wrap = (n: ReactNode) => (cur.closedKey ? <ModuleGate id={cur.closedKey}>{n}</ModuleGate> : <>{n}</>);
    switch (sec) {
      case 'overview':  return <div className="h-full overflow-y-auto overflow-x-hidden"><Overview open={setSec} /></div>;
      case 'kassa':     return wrap(<KassaBusiness />);
      case 'seller':    return wrap(<SellerSection />);
      case 'pvz':       return wrap(<PvzCabinet />);
      case 'logistics': return wrap(<Logistics />);
      case 'go':        return wrap(<SkyGo businessMode />);
      case 'analytics': return wrap(<Analytics />);
      default:          return <div className="h-full overflow-y-auto overflow-x-hidden"><Settings open={setSec} /></div>;
    }
  }, [sec, cur.closedKey, setSec]);

  return (
    <div className="bz-root flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden md:flex-row" style={{ background: 'var(--bg)' }}>
      {/* Телефон: лента разделов сверху */}
      <div className="min-w-0 shrink-0 md:hidden" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-l1)' }}>
        <div className="glass-pill mx-3 my-2 flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" aria-current={sec === s.id ? 'page' : undefined} onClick={() => setSec(s.id)}
              className="relative isolate shrink-0 rounded-full px-3.5 py-2 text-[12px] font-semibold" style={{ color: sec === s.id ? 'var(--t1)' : 'var(--t3)' }}>
              {s.label}
              {sec === s.id && <motion.div layoutId="bz-tab" className="glass-lens absolute inset-0 -z-10" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            </button>
          ))}
        </div>
      </div>
      {/* ПК: собственная боковая навигация среды */}
      <nav aria-label="Разделы сервисов для бизнеса" className="bz-rail hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto p-3 md:flex">
        <div className="mb-2 px-2">
          <p className="text-[10.5px] font-bold uppercase tracking-widest" style={{ color: '#10b981' }}>Сервисы для бизнеса</p>
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Рабочая среда бизнеса</p>
        </div>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" aria-current={sec === s.id ? 'page' : undefined} onClick={() => setSec(s.id)}
            className={`bz-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${sec === s.id ? 'on' : ''}`}>
            <s.icon size={17} className="shrink-0" />
            <span className="min-w-0"><span className="block truncate text-[13px] font-bold">{s.label}</span><span className="block truncate text-[10.5px] opacity-70">{s.hint}</span></span>
          </button>
        ))}
      </nav>
      <main className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden" aria-label={cur.label}>{body}</main>
    </div>
  );
};
