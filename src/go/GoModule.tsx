/** Sky GO: оболочка раздела. Нижняя навигация: Главная / Заказы / Работа / Профиль. */
import { useState } from 'react';
import { Car, UtensilsCrossed, Package, Plane, Fuel, Home, ClipboardList, Briefcase, User, LifeBuoy, BedDouble, Map as MapIcon, Hotel } from 'lucide-react';
import { goApi, ROLE_LABEL, STAY_LABEL, type GoRole, type StayKind } from './api';
import { Back, Card, Chip, Col, CitySelect, Empty, Notice, useCity, useLoad, C, GO, fmt } from './ui';
import { OrdersTab, OrderScreen } from './Orders';
import { TaxiScreen, DeliveryScreen } from './Ride';
import { FoodScreen } from './Food';
import { FlightsScreen } from './Flights';
import { FuelScreen } from './Fuel';
import { RegisterScreen, StatusChip } from './Register';
import { StayScreen } from './Stay';
import { StayCabinet } from './StayCabinet';
import { DriverCabinet, SellerCabinet, CompanyCabinet, PayDetailsCard } from './Cabinet';

type Tab = 'home' | 'orders' | 'work' | 'profile';
type Screen = null | 'taxi' | 'food' | 'delivery' | 'flights' | 'fuel' | { order: string } | { stay: StayKind } | { role: GoRole; mode: 'register' | 'cabinet' };

const SERVICES = [
  { key: 'taxi', title: 'Такси', hint: 'Поездка по городу', Icon: Car },
  { key: 'food', title: 'Еда', hint: 'Из заведений города', Icon: UtensilsCrossed },
  { key: 'delivery', title: 'Доставка', hint: 'Курьером из точки в точку', Icon: Package },
  { key: 'flights', title: 'Авиабилеты', hint: 'Поиск предложений', Icon: Plane },
  { key: 'fuel', title: 'Заправки', hint: 'Рядом с вами', Icon: Fuel },
] as const;

export const SkyGo = () => {
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>(null);
  const [cfg] = useLoad(() => goApi.config(), []);
  const [exec, reloadExec] = useLoad(() => goApi.executors(), []);
  const config = cfg?.ok ? cfg.data! : null;
  const [city, setCity] = useCity(config?.cities);
  const executors = exec?.ok ? exec.data!.executors : [];
  const goTab = (t: Tab) => { setTab(t); setScreen(null); };
  const open = (id: string) => setScreen({ order: id });

  const body = () => {
    if (!config) return <Empty text={cfg && !cfg.ok ? 'Sky GO сейчас недоступен.' : 'Загрузка…'} />;
    if (screen === 'taxi') return <TaxiScreen city={city} onBack={() => setScreen(null)} onCreated={open} />;
    if (screen === 'food') return <FoodScreen city={city} onBack={() => setScreen(null)} onCreated={open} />;
    if (screen === 'delivery') return <DeliveryScreen city={city} hasCompany={executors.some((e) => e.role === 'company' && e.status === 'approved')} onBack={() => setScreen(null)} onCreated={open} />;
    if (screen === 'flights') return <FlightsScreen onBack={() => setScreen(null)} />;
    if (screen === 'fuel') return <FuelScreen city={city} onBack={() => setScreen(null)} />;
    if (screen && typeof screen === 'object' && 'stay' in screen) return <StayScreen kind={screen.stay} city={city} onBack={() => setScreen(null)} onBooked={open} />;
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
    if (tab === 'work') return <WorkTab executors={executors} tariffs={config.tariffs} onPick={(role, mode) => setScreen({ role, mode })} />;
    if (tab === 'profile') return <ProfileTab executors={executors} />;
    return (
      <Col gap={14}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 24, fontWeight: 900, color: C.t1 }}>Sky GO</div><div style={{ fontSize: 13, color: C.t2 }}>Всё для города в одном месте</div></div>
          <CitySelect cities={config.cities} city={city} onChange={setCity} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {SERVICES.map(({ key, title, hint, Icon }, i) => (
            <Card key={key} onClick={() => setScreen(key)} style={{ gridColumn: i === 0 ? 'span 2' : undefined, padding: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(14,165,164,.14)', color: GO, display: 'grid', placeItems: 'center', marginBottom: 10 }}><Icon size={22} /></div>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.t1 }}>{title}</div>
              <div style={{ fontSize: 12.5, color: C.t2 }}>{hint}</div>
            </Card>))}
        </div>
        <Card style={{ padding: 14 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.t1, marginBottom: 2 }}>Жилье и отдых</div>
          <div style={{ fontSize: 12, color: C.t2, marginBottom: 10 }}>Бронь напрямую у владельцев</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([['home', BedDouble], ['tour', MapIcon], ['hotel', Hotel]] as const).map(([k, Icon]) => (
              <button key={k} onClick={() => setScreen({ stay: k })} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 4px', borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, fontSize: 12, fontWeight: 700, lineHeight: 1.2, textAlign: 'center' }}>
                <Icon size={20} color={GO} />{STAY_LABEL[k]}</button>))}
          </div>
        </Card>
        {config.cities.length === 0 && <Notice tone="warn">Города ещё не подключены администрацией.</Notice>}
      </Col>
    );
  };

  const TABS: [Tab, string, typeof Home][] = [['home', 'Главная', Home], ['orders', 'Заказы', ClipboardList], ['work', 'Работа', Briefcase], ['profile', 'Профиль', User]];
  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', background: C.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 24px', maxWidth: 680, width: '100%', margin: '0 auto' }}>{body()}</div>
      <nav style={{ display: 'flex', borderTop: `1px solid ${C.brd}`, background: C.l1, }}>
        {TABS.map(([k, t, Icon]) => (
          <button key={k} onClick={() => goTab(k)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 0', border: 'none', background: 'none', color: tab === k && !screen ? GO : C.t3, fontSize: 11.5, fontWeight: 700 }}>
            <Icon size={21} />{t}
          </button>))}
      </nav>
    </div>
  );
};

const WorkTab = ({ executors, tariffs, onPick }: { executors: any[]; tariffs: { tariffs: { code: string; priceRub: number; periodDays: number }[]; roleTariff: Record<GoRole, string> }; onPick: (r: GoRole, m: 'register' | 'cabinet') => void }) => {
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
  return (
    <Col>
      <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>Работа в Sky GO</div>
      <Notice>Работать можно как самозанятый (НПД), ИП или ООО. Заявку проверяют сотрудники Sky вручную. Подписка — на 7 дней, без автосписаний.</Notice>
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
      <Card><div style={{ display: 'flex', gap: 10, alignItems: 'center', color: C.t1 }}><LifeBuoy size={20} color={GO} />
        <div style={{ fontSize: 14 }}>Проблема с заказом? Откройте заказ → «Проблема с заказом». По остальным вопросам — Профиль → Техническая поддержка.</div></div></Card>
    </Col>
  );
};
