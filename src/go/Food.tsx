/** Sky GO: еда — каталог заведений и корзина. Сумма считается сервером по актуальному меню. */
import { useState } from 'react';
import { Minus, Plus, Search, Store, UtensilsCrossed } from 'lucide-react';
import { goApi } from './api';
import { Back, Btn, Card, Chip, Col, Empty, Head, Input, Notice, StickyBar, fail, fmt, locate, useLoad, C, GO } from './ui';
import { flash } from '@/shared/flash';

export const FoodScreen = ({ city, onBack, onCreated }: { city: string; onBack: () => void; onCreated: (id: string) => void }) => {
  const [q, setQ] = useState(''); const [cat, setCat] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [list] = useLoad(() => goApi.places(city, q), [city, q]);
  if (placeId) return <PlaceScreen id={placeId} onBack={() => setPlaceId(null)} onCreated={onCreated} />;
  const places = list?.ok ? list.data!.places : null;
  // Категории — из настоящих заведений города (а не придуманный список): сколько их и сколько заведений в каждой.
  const cats = new Map<string, number>();
  for (const p of places ?? []) cats.set(p.category || 'Другое', (cats.get(p.category || 'Другое') ?? 0) + 1);
  const shown = (places ?? []).filter((p) => !cat || (p.category || 'Другое') === cat);
  return (
    <>
      <Head title="Еда" sub={city} icon={<UtensilsCrossed size={22} />} onBack={onBack} />
      <Col gap={14}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, borderRadius: 26, background: C.l2, padding: '0 18px' }}>
          <Search size={20} color={C.t2} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск" maxLength={60} style={{ flex: 1, border: 'none', background: 'transparent', color: C.t1, fontSize: 17, fontWeight: 600, outline: 'none' }} />
        </div>
        {cats.size > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[...cats.entries()].map(([name, n]) => (
              <button key={name} onClick={() => setCat(cat === name ? '' : name)} style={{ textAlign: 'left', minHeight: 96, borderRadius: 22, padding: 14, border: `2px solid ${cat === name ? GO : 'transparent'}`, background: C.l2, color: C.t1,
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <span translate="no" style={{ fontSize: 17, fontWeight: 800 }}>{name}</span>
                <span style={{ fontSize: 12.5, color: C.t2 }}>{`Заведений: ${n}`}</span>
              </button>))}
          </div>)}
        <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{cat || 'Заведения'}</div>
        {!places ? <Empty text="Загрузка…" /> : shown.length === 0
          ? <Empty text={`В городе «${city}» пока нет заведений. Они появляются после проверки и оформления подписки продавцом.`} />
          : shown.map((p) => (
            <Card key={p.id} onClick={() => setPlaceId(p.id)} style={{ borderRadius: 22 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 54, height: 54, borderRadius: 18, background: 'rgba(14,165,164,.12)', display: 'grid', placeItems: 'center', color: GO }}><Store size={24} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div translate="no" style={{ fontWeight: 800, fontSize: 17, color: C.t1 }}>{p.name}</div>
                  <div translate="no" style={{ fontSize: 13, color: C.t2 }}>{p.category}{p.hours ? ` · ${p.hours}` : ''}</div>
                  {p.descr && <div translate="no" style={{ fontSize: 12.5, color: C.t3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.descr}</div>}
                </div>
              </div>
            </Card>))}
      </Col>
    </>
  );
};

const PlaceScreen = ({ id, onBack, onCreated }: { id: string; onBack: () => void; onCreated: (id: string) => void }) => {
  const [res] = useLoad(() => goApi.place(id), [id]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [address, setAddress] = useState(''); const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [rn, setRn] = useState(''); const [rp, setRp] = useState(''); const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (!res?.ok) return <><Back onClick={onBack} title="Заведение" /><Empty text={res ? 'Заведение недоступно.' : 'Загрузка…'} /></>;
  const { place, items } = res.data!;
  const lines = items.filter((i) => cart[i.id] > 0);
  const sum = lines.reduce((s, i) => s + i.priceRub * cart[i.id], 0);
  const cats = [...new Set(items.map((i) => i.category || 'Меню'))];
  const set = (iid: string, d: number) => setCart((c) => ({ ...c, [iid]: Math.max(0, Math.min(20, (c[iid] ?? 0) + d)) }));

  const order = async () => {
    setBusy(true);
    const r = await goApi.foodCreate({ placeId: id, items: lines.map((i) => ({ id: i.id, qty: cart[i.id] })), address: { address, ...(pos ?? {}) }, recipient: { name: rn, phone: rp }, comment });
    setBusy(false);
    if (!r.ok) return fail(r);
    flash('Заказ отправлен заведению'); onCreated(r.data!.orderId);
  };
  return (
    <>
      <Back onClick={onBack} title={place.name} />
      <Col>
        {cats.map((c) => (
          <Card key={c}>
            <div style={{ fontWeight: 800, color: C.t1, marginBottom: 6 }}>{c}</div>
            {items.filter((i) => (i.category || 'Меню') === c).map((i) => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.brd}`, opacity: i.available ? 1 : 0.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div translate="no" style={{ color: C.t1, fontWeight: 600 }}>{i.name}</div>
                  {i.descr && <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>{i.descr}</div>}
                  <div style={{ fontSize: 14, color: C.t1, fontWeight: 700 }}>{fmt(i.priceRub)}</div>
                </div>
                {i.available ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cart[i.id] > 0 && <><button aria-label="Меньше" onClick={() => set(i.id, -1)} style={QTY}><Minus size={16} /></button><b style={{ minWidth: 18, textAlign: 'center', color: C.t1 }}>{cart[i.id]}</b></>}
                    <button aria-label="Больше" onClick={() => set(i.id, 1)} style={{ ...QTY, background: GO, color: '#fff' }}><Plus size={16} /></button>
                  </div>
                ) : <Chip color={C.t3}>Нет в наличии</Chip>}
              </div>))}
          </Card>))}
        {lines.length > 0 && (
          <Card><Col>
            <div style={{ fontWeight: 800, color: C.t1 }}>Оформление · блюда {fmt(sum)}</div>
            <Input label="Адрес доставки" value={address} onChange={(v) => { setAddress(v); setPos(null); }} max={240} placeholder="Город, улица, дом, квартира" />
            <Btn kind="soft" onClick={async () => { const p = await locate(); if (!p) return flash('Нет доступа к геолокации.'); setPos(p); if (!address) setAddress('Моё местоположение'); }}>Использовать моё местоположение</Btn>
            <Input label="Получатель: имя" value={rn} onChange={setRn} max={80} />
            <Input label="Получатель: телефон" value={rp} onChange={setRp} type="tel" placeholder="+7…" />
            <Input label="Комментарий" value={comment} onChange={setComment} max={200} />
            <Notice>Доставка курьером оплачивается отдельно — её цена появится в заказе после готовности. Оба платежа — напрямую исполнителям.</Notice>
            <Btn busy={busy} disabled={!address || rn.trim().length < 2 || rp.length < 10} onClick={order}>Заказать</Btn>
          </Col></Card>)}
      </Col>
    </>
  );
};
const QTY = { width: 32, height: 32, borderRadius: 10, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, display: 'grid', placeItems: 'center' } as const;
