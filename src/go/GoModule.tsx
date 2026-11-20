/** Sky GO: оболочка раздела. Нижняя навигация: Главная / Заказы / Работа / Профиль. */
import { NotifyPrefs, MySupport, SupportForm } from './Support';
import { useEffect, useRef, useState } from 'react';
import { Bus, Car, UtensilsCrossed, Package, Plane, Fuel, ParkingCircle, Building2, Home, ClipboardList, Briefcase, User, LifeBuoy, BedDouble, Map as MapIcon, Hotel } from 'lucide-react';
import { goApi, ROLE_LABEL, STAY_LABEL, type GoRole, type StayKind } from './api';
import { Back, Btn, Card, Chip, Col, CitySelect, Empty, ErrorState, Notice, fail, useCity, useLoad, C, GO, fmt } from './ui';
import { flash } from '@/shared/flash';
import { OrdersTab, OrderScreen } from './Orders';
import { TaxiScreen } from './Ride';
import { DeliveryHub, DeliveryForm, type DeliveryMode } from './Delivery';
import { FoodScreen } from './Food';
import { FlightsScreen } from './Flights';
import { AutoScreen, FuelScreen, type AutoKind } from './Fuel';
import { RegisterScreen, StatusChip } from './Register';
import { TravelScreen, type TravelTab } from './Travel';
import { StayCabinet } from './StayCabinet';
import { ParkingScreen } from './Parking';
import { PlacesScreen } from './Places';
import { TransitScreen } from './Transit';
import { takeGoLink, clearGoLink } from './deeplink';
import { ParkingOwnerScreen } from './ParkingOwner';
import { DriverCabinet, SellerCabinet, CompanyCabinet, PayDetailsCard } from './Cabinet';
import { bizApi, type OrgRole, type Member, type AssignMode, type Workspaces } from './bizApi';
import { BusinessWorkspace } from './Business';
import { ExecutorWorkspace } from './Work';
import { DeliveryForm as OrgDeliveryForm, type OrgFormCtx } from './Delivery';

type Tab = 'home' | 'orders' | 'work' | 'profile';
type Screen = null | { biz: string; name: string; role: OrgRole; order?: string } | { bizNew: OrgFormCtx & { role: OrgRole } } | { work: 'courier' | 'taxi_driver' } | 'taxi' | 'food' | 'delivery' | { delivery: DeliveryMode } | { auto: AutoKind | null } | 'flights' | 'fuel' | 'parking' | 'places' | 'transit' | 'parkingOwner' | { order: string } | { travel: TravelTab } | { role: GoRole; mode: 'register' | 'cabinet' };

const SERVICES = [
  { key: 'taxi', title: 'Такси', hint: 'Поездка по городу', Icon: Car },
  { key: 'food', title: 'Еда', hint: 'Из заведений города', Icon: UtensilsCrossed },
  { key: 'delivery', title: 'Доставка', hint: 'Курьером из точки в точку', Icon: Package },
  { key: 'flights', title: 'Авиабилеты', hint: 'Поиск предложений', Icon: Plane },
  { key: 'fuel', title: 'Моё авто', hint: 'Заправки и мойки рядом', Icon: Fuel },
  { key: 'parking', title: 'Парковки', hint: 'Оплата по реквизитам организации', Icon: ParkingCircle },
  { key: 'transit', title: 'Билеты на проезд', hint: 'Купить и показать QR', Icon: Bus },
  { key: 'places', title: 'Организации', hint: 'Находите места рядом с собой', Icon: Building2 },
] as const;

export const SkyGo = ({ businessMode = false }: { businessMode?: boolean } = {}) => {
  const [tab, setTab] = useState<Tab>(businessMode ? 'work' : 'home');
  const [link] = useState(() => takeGoLink());   // переход по ссылке ?place= / ?go=transport
  const [screen, setScreen] = useState<Screen>(link ? 'places' : null);
  useEffect(() => { clearGoLink(); }, []);
  const [cfg, reloadCfg] = useLoad(() => goApi.config(), []);
  const [exec, reloadExec] = useLoad(() => goApi.executors(), []);
  const config = cfg?.ok ? cfg.data! : null;
  const [city, setCity] = useCity(config?.cities);
  const executors = exec?.ok ? exec.data!.executors : [];
  const autoDone = useRef(false);
  const goTab = (t: Tab) => {
    setTab(t); setScreen(null);
    // Первый заход в «Работу» за сеанс ведёт в последнее рабочее пространство (или в единственное): человек попадает туда, где работает.
    if (t === 'work' && !autoDone.current && workspaces) {
      autoDone.current = true;
      const spaces = [...workspaces.orgs.filter((o) => o.staff && !o.suspended).map((o) => ({ id: `biz:${o.id}`, open: () => openBiz(o) })),
        ...workRoles.map((r) => ({ id: `work:${r}`, open: () => openWork(r) }))];
      let last = ''; try { last = localStorage.getItem('sky:go:ws') ?? ''; } catch { /* ok */ }
      (spaces.find((x) => x.id === last) ?? (spaces.length === 1 ? spaces[0] : null))?.open();
    }
  };
  const open = (id: string) => setScreen({ order: id });
  const [ws, reloadWs] = useLoad(() => bizApi.workspaces(), []);
  const workspaces: Workspaces | null = ws?.ok ? ws.data! : null;
  const workRoles = (['courier', 'taxi_driver'] as const).filter((r) => executors.some((e) => e.role === r && e.status === 'approved'));
  const openBiz = (o: { id: string; name: string; role: OrgRole }) => { try { localStorage.setItem('sky:go:ws', `biz:${o.id}`); } catch { /* ok */ } setScreen({ biz: o.id, name: o.name, role: o.role }); };
  const openWork = (r: 'courier' | 'taxi_driver') => { try { localStorage.setItem('sky:go:ws', `work:${r}`); } catch { /* ok */ } setScreen({ work: r }); };
  /** «От компании»: сотрудники организации оформляют заказ в её кабинете (адреса, назначение), остальные — прежней формой. */
  const openCompanyOrder = async () => {
    const o = workspaces?.orgs.find((x) => x.staff && !x.suspended);
    if (!o) return setScreen({ delivery: 'company' });
    const [s, m] = await Promise.all([bizApi.settings(o.id), bizApi.members(o.id)]);
    if (!s.ok) return fail(s);
    setScreen({ bizNew: { id: o.id, name: o.name, role: o.role, assignMode: s.data!.org.assignMode as AssignMode, points: s.data!.points.map((p) => ({ id: p.id, title: p.title, address: p.address })), executors: m.ok ? (m.data!.members as Member[]).filter((x) => x.status === 'active') : [] } });
  };

  const body = () => {
    if (!config) return cfg && !cfg.ok ? <ErrorState text="Sky GO сейчас недоступен. Проверьте соединение и попробуйте снова." onRetry={reloadCfg} /> : <Empty text="Загрузка…" />;
    if (screen && typeof screen === 'object' && 'work' in screen) return <ExecutorWorkspace roles={workRoles} initial={screen.work} onClose={() => setScreen(null)} />;
    if (screen && typeof screen === 'object' && 'bizNew' in screen) {
      const c = screen.bizNew;
      return <OrgDeliveryForm mode="company" city={city} cargo={config.cargo} org={c} onBack={() => setScreen({ biz: c.id, name: c.name, role: c.role })} onCreated={(id) => setScreen({ biz: c.id, name: c.name, role: c.role, order: id })} />;
    }
    if (screen && typeof screen === 'object' && 'biz' in screen) {
      const b = screen;
      return <>
        <Back onClick={() => { setScreen(null); reloadWs(); }} title="Рабочие пространства" />
        <BusinessWorkspace org={b.biz} name={b.name} role={b.role} openId={b.order ?? null} onOpenOrder={(id) => setScreen({ ...b, order: id })} onCloseOrder={() => setScreen({ biz: b.biz, name: b.name, role: b.role })}
          onNew={(c) => setScreen({ bizNew: { ...c, role: b.role } })} />
      </>;
    }
    if (screen === 'taxi') return <TaxiScreen city={city} onBack={() => setScreen(null)} onCreated={open} />;
    if (screen === 'food') return <FoodScreen city={city} onBack={() => setScreen(null)} onCreated={open} />;
    if (screen === 'delivery') return <DeliveryHub hasCompany={executors.some((e) => e.role === 'company' && e.status === 'approved')} onBack={() => setScreen(null)} onPick={(m) => (m === 'company' ? void openCompanyOrder() : setScreen({ delivery: m }))} />;
    if (screen && typeof screen === 'object' && 'delivery' in screen) return <DeliveryForm mode={screen.delivery} city={city} cargo={config.cargo} onBack={() => setScreen('delivery')} onCreated={open} />;
    if (screen === 'flights') return <TravelScreen initial="flights" cities={config.cities} city={city} onCity={setCity} onBack={() => setScreen(null)} onBooked={open} onOrders={() => goTab('orders')} />;
    if (screen === 'parkingOwner') return <ParkingOwnerScreen onBack={() => setScreen(null)} />;
    if (screen === 'transit') return <TransitScreen city={city} onBack={() => setScreen(null)} />;
    if (screen === 'places') return <PlacesScreen city={city} onBack={() => setScreen(null)} group={link?.group} initialOpen={link?.open ?? null} onOpenApp={(k) => setScreen(k === 'fuel' ? 'fuel' : 'parking')} />;
    if (screen === 'parking') return <ParkingScreen city={city} onBack={() => setScreen(null)} />;
    if (screen === 'fuel') return <AutoScreen city={city} onBack={() => setScreen(null)} onOpen={(k) => setScreen({ auto: k })} />;
    if (screen && typeof screen === 'object' && 'auto' in screen && screen.auto) return <FuelScreen city={city} kind={screen.auto} onBack={() => setScreen('fuel')} />;
    if (screen && typeof screen === 'object' && 'travel' in screen) return <TravelScreen initial={screen.travel} cities={config.cities} city={city} onCity={setCity} onBack={() => setScreen(null)} onBooked={open} onOrders={() => goTab('orders')} />;
    if (screen && typeof screen === 'object' && 'order' in screen) return <OrderScreen id={screen.order} onBack={() => setScreen(null)} />;
    if (screen && typeof screen === 'object' && 'role' in screen) {
      const ex = executors.find((e) => e.role === screen.role) ?? null;
      const back = () => { setScreen(null); reloadExec(); };
      if (screen.mode === 'register') return <RegisterScreen role={screen.role} existing={ex} cities={config.cities} onBack={back} onDone={back} />;
      return (
        <>
          <Back onClick={back} title={ROLE_LABEL[screen.role]} />
          {screen.role === 'food_seller' ? <SellerCabinet onOpen={open} />
            : screen.role === 'company' ? <CompanyCabinet onDeliver={() => setScreen('delivery')} />
            : screen.role === 'host' || screen.role === 'tour_operator' || screen.role === 'hotel'
              ? <StayCabinet kind={screen.role === 'host' ? 'home' : screen.role === 'tour_operator' ? 'tour' : 'hotel'} cities={config.cities} onOpen={open} />
            : <DriverCabinet role={screen.role} onOpen={open} />}
        </>
      );
    }
    if (tab === 'orders') return <OrdersTab onOpen={open} />;
    if (tab === 'work') return <WorkTab executors={executors} tariffs={config.tariffs} workspaces={workspaces} onPick={(role, mode) => setScreen({ role, mode })} onBiz={openBiz} onWork={openWork} onParking={() => setScreen('parkingOwner')} onInvite={async (orgId, accept) => { const r = await bizApi.respondInvite(orgId, accept); if (!r.ok) return fail(r); flash(accept ? 'Вы в команде' : 'Приглашение отклонено'); reloadWs(); }} />;
    if (tab === 'profile') return <ProfileTab executors={executors} />;
    return (
      <Col gap={14}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 24, fontWeight: 900, color: C.t1 }}>Sky GO</div><div style={{ fontSize: 13, color: C.t2 }}>Всё для города в одном месте</div></div>
          <CitySelect cities={config.cities} city={city} onChange={setCity} />
        </div>
        <div className="go-services">
          {SERVICES.map(({ key, title, hint, Icon }, i) => (
            <Card key={key} onClick={() => setScreen(key)} style={{ gridColumn: i === 0 ? '1 / -1' : undefined, padding: 16 }}>
              <div aria-hidden style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(14,165,164,.14)', color: GO, display: 'grid', placeItems: 'center', marginBottom: 10 }}><Icon size={22} /></div>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.t1 }}>{title}</div>
              <div style={{ fontSize: 12.5, color: C.t2 }}>{hint}</div>
            </Card>))}
        </div>
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.t1, marginBottom: 2 }}>Жилье и отдых</div>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>Бронь напрямую у владельцев</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([['home', BedDouble], ['tour', MapIcon], ['hotel', Hotel]] as const).map(([k, Icon]) => (
              <button key={k} type="button" onClick={() => setScreen({ travel: k === 'hotel' ? 'hotel' : k })} style={{ minHeight: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 4px', borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, fontSize: 12, fontWeight: 700, lineHeight: 1.2, textAlign: 'center' }}>
                <Icon size={20} color={GO} />{STAY_LABEL[k]}</button>))}
          </div>
        </Card>
        {config.cities.length === 0 && <Notice tone="warn">Города ещё не подключены администрацией.</Notice>}
      </Col>
    );
  };

  const ALL_TABS: [Tab, string, typeof Home][] = [['home', 'Главная', Home], ['orders', 'Заказы', ClipboardList], ['work', 'Работа', Briefcase], ['profile', 'Профиль', User]];
  /* В среде «Бизнес» Sky GO показывает только рабочую часть: пространства и кабинеты, заказы, профиль исполнителя. */
  const TABS = businessMode ? ALL_TABS.filter(([k]) => k !== 'home') : ALL_TABS;
  return (
    <div className="go-root" style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>
      <main className="go-main" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', width: '100%', margin: '0 auto' }}>{body()}</main>
      <nav aria-label="Разделы Sky GO" className="go-nav" style={{ display: 'flex', borderTop: `1px solid ${C.brd}`, background: C.l1, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(([k, t, Icon]) => (
          <button key={k} type="button" aria-current={tab === k && !screen ? 'page' : undefined} onClick={() => goTab(k)} style={{ flex: 1, minHeight: 56, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '8px 0', border: 'none', background: 'none', color: tab === k && !screen ? GO : C.t3, fontSize: 11.5, fontWeight: 700 }}>
            <Icon size={21} aria-hidden />{t}
          </button>))}
      </nav>
    </div>
  );
};

const WorkTab = ({ executors, tariffs, workspaces, onPick, onBiz, onWork, onParking, onInvite }: { executors: any[]; tariffs: { tariffs: { code: string; priceRub: number; periodDays: number }[]; roleTariff: Record<GoRole, string> }; workspaces: Workspaces | null; onPick: (r: GoRole, m: 'register' | 'cabinet') => void; onBiz: (o: { id: string; name: string; role: OrgRole }) => void; onWork: (r: 'courier' | 'taxi_driver') => void; onParking: () => void; onInvite: (orgId: string, accept: boolean) => void }) => {
  const price = (r: GoRole) => { const t = tariffs.tariffs.find((x) => x.code === tariffs.roleTariff[r]); return t ? `${fmt(t.priceRub)} / ${t.periodDays} дн.` : ''; };
  const ROLES: { role: GoRole; group: string; text: string }[] = [
    { role: 'taxi_driver', group: 'Водитель', text: 'Возите пассажиров на своём автомобиле' },
    { role: 'courier', group: 'Курьер', text: 'Развозите заказы и доставки' },
    { role: 'food_seller', group: 'Продавец еды', text: 'Своё заведение в каталоге Sky Еда' },
    { role: 'company', group: 'Компания', text: 'Доставки от организации получателям' },
    { role: 'host', group: 'Квартиры и дома', text: 'Сдавайте жильё посуточно' },
    { role: 'tour_operator', group: 'Туры', text: 'Размещайте туры и принимайте заявки (ИП и организации)' },
    { role: 'hotel', group: 'Отель', text: 'Номера и бронь напрямую (ИП и организации)' },
  ];
  const spaces: { key: string; title: string; hint: string; go: () => void }[] = [];
  for (const o of workspaces?.orgs ?? []) if (o.staff) spaces.push({ key: `biz-${o.id}`, title: `Бизнес · ${o.name}`, hint: `Заказы, команда, настройки · ваша роль: ${o.roleLabel.toLowerCase()}${o.suspended ? ' · приостановлена' : ''}`, go: () => onBiz(o) });
  for (const r of ['courier', 'taxi_driver'] as const) {
    const ex = executors.find((e) => e.role === r);
    const member = r === 'courier' && (workspaces?.orgs ?? []).some((o) => o.role === 'driver' || o.role === 'courier');
    if (ex?.status === 'approved' || (member && ex)) spaces.push({ key: `w-${r}`, title: r === 'courier' ? 'Курьер · рабочий экран' : 'Водитель · рабочий экран', hint: 'Карта, маршрут, заказы и история смены', go: () => onWork(r) });
  }
  return (
    <Col>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>Работа в Sky GO</div>
      {(workspaces?.invites ?? []).map((i) => (
        <Card key={i.orgId} style={{ borderColor: GO }}><Col gap={8}>
          <div style={{ fontWeight: 800, color: C.t1 }}>Приглашение в «{i.orgName}»</div>
          <div style={{ fontSize: 13, color: C.t2 }}>Роль: {i.roleLabel.toLowerCase()}{i.by ? ` · пригласил @${i.by.username}` : ''}</div>
          <div style={{ display: 'flex', gap: 8 }}><Btn style={{ flex: 1 }} onClick={() => onInvite(i.orgId, true)}>Принять</Btn><Btn kind="soft" onClick={() => onInvite(i.orgId, false)}>Отклонить</Btn></div>
        </Col></Card>))}
      {spaces.length > 0 && <div style={{ fontWeight: 800, color: C.t1 }}>Мои рабочие пространства</div>}
      {spaces.map((sp) => <Card key={sp.key} onClick={sp.go}><div style={{ fontWeight: 800, color: C.t1 }}>{sp.title}</div><div style={{ fontSize: 13, color: C.t2 }}>{sp.hint}</div><div style={{ fontSize: 12.5, color: GO, marginTop: 4 }}>Открыть →</div></Card>)}
      <div style={{ fontWeight: 800, color: C.t1, marginTop: 6 }}>Регистрация и кабинеты</div>
      <Notice>Работать можно как самозанятый (НПД), ИП или ООО. Заявку проверяют сотрудники Sky вручную. Подписка — на 7 дней, без автосписаний.</Notice>
      <Card onClick={onParking}>
        <div style={{ fontWeight: 800, color: C.t1 }}>Владелец парковки</div>
        <div style={{ fontSize: 13, color: C.t2, margin: '4px 0' }}>Свои парковки, тарифы, сессии и возвраты. Карточки проверяет администрация Sky.</div>
        <div style={{ fontSize: 12.5, color: GO }}>Открыть кабинет →</div>
      </Card>
      {ROLES.map(({ role, group, text }) => {
        const ex = executors.find((e) => e.role === role);
        const approved = ex?.status === 'approved';
        return (
          <Card key={role} onClick={() => onPick(role, approved ? 'cabinet' : 'register')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, color: C.t1 }}>{group}</div>
              {ex ? <StatusChip s={ex.status} /> : <Chip>{price(role)}</Chip>}
            </div>
            <div style={{ fontSize: 13, color: C.t2, margin: '4px 0' }}>{text}</div>
            {ex && ex.status !== 'approved' && ex.status !== 'submitted' && <div style={{ fontSize: 12.5, color: GO }}>Открыть анкету →</div>}
            {approved && <div style={{ fontSize: 12.5, color: GO }}>Открыть кабинет →</div>}
          </Card>);
      })}
    </Col>
  );
};

const ProfileTab = ({ executors }: { executors: any[] }) => {
  return (
    <Col>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>Профиль Sky GO</div>
      {executors.length > 0 && <Card><div style={{ fontWeight: 800, color: C.t1, marginBottom: 6 }}>Мои роли</div>
        {executors.map((e) => <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', color: C.t1, fontSize: 14 }}>{ROLE_LABEL[e.role as GoRole]}<StatusChip s={e.status} /></div>)}</Card>}
      <PayDetailsCard />
      <NotifyPrefs />
      <MySupport />
      <SupportForm />
      <Card><div style={{ display: 'flex', gap: 10, alignItems: 'center', color: C.t1 }}><LifeBuoy size={20} color={GO} />
        <div style={{ fontSize: 14 }}>Проблема с заказом? Откройте заказ → «Проблема с заказом». По остальным вопросам — Профиль → Техническая поддержка.</div></div></Card>
    </Col>
  );
};
