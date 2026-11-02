/** Sky GO → Организации: каталог мест, страница организации, маршрут, заказ и «Мои заказы». Оплата — прямым переводом по реквизитам организации (SkyKassa Business). */
import { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Clock, Heart, Share2, Route as RouteIcon, Search, Phone, ShoppingBag, Navigation, Map as MapIcon } from 'lucide-react';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { flash } from '@/shared/flash';
import { BookBlock, ReviewsBlock, ReportBlock, MyBookings } from './PlacesExtra';
import { gp, placeImg, type GpCard, type GpCategory, type GpItem, type GpOrder, type GpPlace, type GpRoute } from './placesApi';
import { Back, Btn, Card, Chip, Col, Empty, ErrorState, Input, Notice, Segmented, fail, useAction, useLoad, locate, C, GO, fmt } from './ui';
import { shareOrigin } from '@/core/nativeApp';

type Pos = { lat: number; lng: number } | null;
const DAY_NAMES: [string, string][] = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']];
const km = (v: number | null) => (v == null ? '' : v < 1 ? `${Math.round(v * 1000)} м` : `${v} км`);
const OpenChip = ({ open, today }: { open: boolean | null; today: string }) => open == null ? null
  : <Chip color={open ? '#22c55e' : '#ef4444'}>{open ? `Открыто${today ? ` · ${today}` : ''}` : 'Закрыто'}</Chip>;

const Img = ({ src, h, round = 16 }: { src: string | null; h: number; round?: number }) => src
  ? <img src={placeImg(src)} alt="" loading="lazy" style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: round, display: 'block' }} />
  : <div style={{ width: '100%', height: h, borderRadius: round, background: C.l2, display: 'grid', placeItems: 'center', color: C.t3 }}><Building2 size={28} /></div>;

/* ─── Каталог ─── */
export const PlacesScreen = ({ city, onBack }: { city: string; onBack: () => void }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [orders, setOrders] = useState(false);
  const [q, setQ] = useState(''); const [cat, setCat] = useState(''); const [onlyOpen, setOnlyOpen] = useState(false); const [fav, setFav] = useState(false);
  const [sort, setSort] = useState<'name' | 'distance'>('name'); const [view, setView] = useState<'list' | 'map'>('list');
  const [pos, setPos] = useState<Pos>(null); const [useCity, setUseCity] = useState(true); const [qd, setQd] = useState('');
  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const [cats] = useLoad(() => gp.categories(), []);
  const [data, reload] = useLoad(() => gp.list({ q: qd, category: cat, city: useCity ? city : '', open: onlyOpen, fav, sort: sort === 'distance' && pos ? 'distance' : 'name', ...(pos ?? {}) }), [qd, cat, onlyOpen, fav, sort, pos?.lat, pos?.lng, useCity, city]);

  if (open) return <PlaceScreen id={open} pos={pos} onBack={() => { setOpen(null); reload(); }} />;
  if (orders) return <MyOrders onBack={() => setOrders(false)} />;
  const places: GpCard[] = data && data.ok ? data.data!.places : [];
  const points = places.filter((p) => p.lat != null && p.lng != null).map((p) => ({ id: p.id, pos: { lat: p.lat!, lng: p.lng! }, label: p.name }));
  const near = async () => { const p = await locate(); if (!p) return flash('Не удалось определить местоположение. Разрешите доступ к геолокации или выберите город.'); setPos(p); setSort('distance'); };

  return (
    <div>
      <Back onClick={onBack} title="Организации" />
      <div style={{ fontSize: 13, color: C.t2, margin: '-6px 0 12px' }}>Находите места рядом с собой</div>
      <Col>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: 15, color: C.t3 }} />
          <input aria-label="Поиск" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Название, адрес, описание" maxLength={60}
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px 12px 34px', borderRadius: 14, border: `1px solid ${C.brd}`, background: C.l1, color: C.t1, fontSize: 15 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          <button type="button" onClick={() => setCat('')} aria-pressed={!cat} style={chipBtn(!cat)}>Все</button>
          {(cats && cats.ok ? cats.data!.categories : []).map((c: GpCategory) => <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id} style={chipBtn(cat === c.id)}>{c.name}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setOnlyOpen(!onlyOpen)} aria-pressed={onlyOpen} style={chipBtn(onlyOpen)}>Открыто сейчас</button>
          <button type="button" onClick={() => setFav(!fav)} aria-pressed={fav} style={chipBtn(fav)}>Избранное</button>
          <button type="button" onClick={() => setUseCity(!useCity)} aria-pressed={useCity} style={chipBtn(useCity)}>{city ? `Город: ${city}` : 'Мой город'}</button>
          <button type="button" onClick={() => (pos && sort === 'distance' ? setSort('name') : void near())} aria-pressed={sort === 'distance'} style={chipBtn(sort === 'distance')}>Рядом со мной</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}><Segmented value={view} onChange={setView} options={[{ v: 'list', t: 'Список' }, { v: 'map', t: 'Карта' }]} /></div>
          <Btn kind="soft" onClick={() => setOrders(true)}><ShoppingBag size={16} /> Мои заказы</Btn>
        </div>
        {!data ? <Empty text="Загрузка…" /> : !data.ok ? <ErrorState text="Не удалось загрузить каталог." onRetry={reload} />
          : !places.length ? <Empty text="Ничего не найдено" hint="Измените поиск или фильтры. Организации появляются после проверки администрацией." />
          : view === 'map' ? (
            <div style={{ borderRadius: 22, overflow: 'hidden', border: `1px solid ${C.brd}` }}>
              {points.length ? <SkyMap points={points} height={320} /> : <Empty text="У найденных организаций нет точки на карте" />}
              <Col gap={8}>{places.map((p) => <PlaceRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}</Col>
            </div>
          ) : <Col>{places.map((p) => <PlaceRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />)}</Col>}
      </Col>
    </div>
  );
};
const chipBtn = (on: boolean): React.CSSProperties => ({ flexShrink: 0, minHeight: 36, padding: '6px 14px', borderRadius: 999, border: `1px solid ${on ? GO : C.brd}`, background: on ? GO : C.l1, color: on ? '#fff' : C.t1, fontSize: 13, fontWeight: 700 });

const PlaceRow = ({ p, onOpen }: { p: GpCard; onOpen: () => void }) => (
  <Card onClick={onOpen}>
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ width: 84, flexShrink: 0 }}><Img src={p.photo ?? p.logoUrl} h={84} round={14} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div translate="no" style={{ fontWeight: 800, fontSize: 16, color: C.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ fontSize: 12, color: C.t2, margin: '2px 0 6px' }}>{p.categoryName}{p.distanceKm != null ? ` · ${km(p.distanceKm)}` : ''}</div>
        <div translate="no" style={{ fontSize: 12, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><MapPin size={12} style={{ verticalAlign: -1 }} /> {p.address}</div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}><OpenChip open={p.open} today={p.today} />{p.fav && <Heart size={14} color="#ef4444" fill="#ef4444" />}</div>
      </div>
    </div>
  </Card>
);

/* ─── Страница организации ─── */
const PlaceScreen = ({ id, pos, onBack }: { id: string; pos: Pos; onBack: () => void }) => {
  const [res, reload] = useLoad(() => gp.get(id, pos), [id]);
  const [cart, setCart] = useState<Record<string, { qty: number; variant?: string }>>({});
  const [step, setStep] = useState<'view' | 'route' | 'checkout'>('view');
  const [photo, setPhoto] = useState(0);
  const [busy, run] = useAction();
  if (!res) return <Empty text="Загрузка…" />;
  if (!res.ok) return <><Back onClick={onBack} title="Организация" /><ErrorState text={res.status === 404 ? 'Организация недоступна или скрыта.' : 'Не удалось загрузить.'} onRetry={reload} /></>;
  const p: GpPlace = res.data!.place;
  const lines = Object.entries(cart).filter(([, v]) => v.qty > 0).map(([itemId, v]) => ({ item: p.items.find((i) => i.id === itemId)!, ...v })).filter((l) => l.item);
  const price = (it: GpItem, variant?: string) => it.variants.find((v) => v.name === variant)?.priceRub || it.priceRub;
  const total = lines.reduce((s, l) => s + l.qty * price(l.item, l.variant), 0);
  const setQty = (it: GpItem, d: number) => setCart((c) => {
    const cur = c[it.id] ?? { qty: 0, variant: it.variants[0]?.name };
    const max = it.left ?? 99;
    return { ...c, [it.id]: { ...cur, qty: Math.max(0, Math.min(max, cur.qty + d)) } };
  });
  const share = async () => {
    const url = `${shareOrigin()}/?place=${p.id}`;
    try { if (navigator.share) await navigator.share({ title: p.name, text: p.address, url }); else { await navigator.clipboard.writeText(url); flash('Ссылка скопирована'); } } catch { /* отмена */ }
  };
  const toggleFav = () => void run(async () => { const r = await gp.fav(p.id, !p.fav); if (!r.ok) return fail(r); reload(); });

  if (step === 'route') return <RouteSheet place={p} pos={pos} onBack={() => setStep('view')} />;
  if (step === 'checkout') return <Checkout place={p} lines={lines.map((l) => ({ id: l.item.id, qty: l.qty, variant: l.variant, title: l.item.title, price: price(l.item, l.variant) }))} total={total}
    onBack={() => setStep('view')} onDone={() => { setCart({}); setStep('view'); reload(); }} />;

  const photos = p.photos.length ? p.photos : (p.photo ? [p.photo] : []);
  return (
    <div style={{ paddingBottom: lines.length ? 90 : 0 }}>
      <Back onClick={onBack} title="Организация" />
      <Col>
        <Img src={photos[photo] ?? null} h={200} round={20} />
        {photos.length > 1 && <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{photos.map((ph, i) => <button key={ph} type="button" aria-label={`Фото ${i + 1}`} onClick={() => setPhoto(i)} style={{ border: i === photo ? `2px solid ${GO}` : '2px solid transparent', borderRadius: 12, padding: 0, background: 'none', width: 64, flexShrink: 0 }}><Img src={ph} h={48} round={10} /></button>)}</div>}
        <div>
          <div translate="no" style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{p.name}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>{p.categoryName && <Chip>{p.categoryName}</Chip>}<OpenChip open={p.open} today={p.today} />{p.distanceKm != null && <Chip color="#64748b">{km(p.distanceKm)}</Chip>}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn onClick={() => setStep('route')}><RouteIcon size={16} /> Маршрут</Btn>
          <Btn kind="soft" busy={busy} onClick={toggleFav}><Heart size={16} fill={p.fav ? '#ef4444' : 'none'} color={p.fav ? '#ef4444' : undefined} /> {p.fav ? 'В избранном' : 'В избранное'}</Btn>
          <Btn kind="soft" onClick={() => void share()}><Share2 size={16} /></Btn>
        </div>
        {p.about && <Card><div translate="no" style={{ fontSize: 14, color: C.t1, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{p.about}</div></Card>}
        <Card>
          <div translate="no" style={{ fontSize: 14, color: C.t1, display: 'flex', gap: 8 }}><MapPin size={16} style={{ flexShrink: 0, marginTop: 2 }} /> <span>{p.city}, {p.address}</span></div>
          {p.lat != null && p.lng != null && <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: 10 }}><SkyMap points={[{ id: p.id, pos: { lat: p.lat, lng: p.lng }, label: p.name }]} height={160} /></div>}
          {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} style={{ display: 'flex', gap: 8, marginTop: 10, color: GO, fontWeight: 700, textDecoration: 'none' }}><Phone size={16} /> <span translate="no">{p.phone}</span></a>}
          {p.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer nofollow" translate="no" style={{ display: 'block', marginTop: 6, color: GO, fontSize: 13, wordBreak: 'break-all' }}>{l.title || l.url}</a>)}
        </Card>
        <Card>
          <div style={{ fontWeight: 800, marginBottom: 6, color: C.t1 }}><Clock size={15} style={{ verticalAlign: -2 }} /> Часы работы</div>
          {Object.keys(p.hours).length ? DAY_NAMES.map(([k, n]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.t2, padding: '2px 0' }}><span>{n}</span><span>{p.hours[k]?.length ? p.hours[k]!.map(([a, b]) => `${a}–${b}`).join(', ') : 'выходной'}</span></div>) : <div style={{ fontSize: 13, color: C.t2 }}>Часы работы не указаны.</div>}
        </Card>
        <BookBlock placeId={p.id} onBooked={() => undefined} />
        <div style={{ fontWeight: 800, fontSize: 17, color: C.t1 }}>Каталог</div>
        {!p.items.length ? <Empty text="Организация пока не добавила позиции" />
          : !p.canOrder ? <Notice tone="warn">Онлайн-заказ сейчас недоступен — свяжитесь с организацией напрямую.</Notice> : null}
        {p.items.map((it) => {
          const c = cart[it.id]; const qty = c?.qty ?? 0;
          return (
            <Card key={it.id}>
              <div style={{ display: 'flex', gap: 12 }}>
                {it.photo && <div style={{ width: 72, flexShrink: 0 }}><Img src={it.photo} h={72} round={12} /></div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{it.title}</div>
                  {it.description && <div translate="no" style={{ fontSize: 12, color: C.t2, margin: '2px 0' }}>{it.description}</div>}
                  <div style={{ fontWeight: 800, color: C.t1 }}>{it.variants.length ? 'от ' : ''}{fmt(it.variants.length ? Math.min(it.priceRub, ...it.variants.map((v) => v.priceRub || it.priceRub)) : it.priceRub)} ₽ <span style={{ fontSize: 11, color: C.t3, fontWeight: 600 }}>{it.kind === 'service' ? 'услуга' : 'товар'}</span></div>
                  {it.left != null && <div style={{ fontSize: 12, color: C.amber }}>Осталось: {it.left}</div>}
                  {it.variants.length > 0 && p.canOrder && <select aria-label="Вариант" value={c?.variant ?? it.variants[0].name} onChange={(e) => setCart((x) => ({ ...x, [it.id]: { qty: x[it.id]?.qty ?? 0, variant: e.target.value } }))} style={{ marginTop: 6, padding: 6, borderRadius: 10, background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{it.variants.map((v) => <option key={v.name} value={v.name}>{v.name}{v.priceRub ? ` — ${v.priceRub} ₽` : ''}</option>)}</select>}
                </div>
              </div>
              {p.canOrder && (it.available ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <Btn kind="soft" onClick={() => setQty(it, -1)} disabled={!qty}>−</Btn><b style={{ minWidth: 24, textAlign: 'center', color: C.t1 }}>{qty}</b><Btn kind="soft" onClick={() => setQty(it, 1)}>+</Btn>
                </div>
              ) : <div style={{ marginTop: 8 }}><Chip color="#ef4444">Нет в наличии</Chip></div>)}
            </Card>
          );
        })}
        <ReviewsBlock placeId={p.id} />
        <ReportBlock placeId={p.id} />
      </Col>
      {lines.length > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: C.l1, borderTop: `1px solid ${C.brd}`, zIndex: 20 }}>
          <Btn onClick={() => setStep('checkout')}>Оформить заказ · {fmt(total)} ₽</Btn>
        </div>
      )}
    </div>
  );
};

/* ─── Маршрут ─── */
const RouteSheet = ({ place, pos, onBack }: { place: GpPlace; pos: Pos; onBack: () => void }) => {
  const [from, setFrom] = useState<Pos>(pos); const [addr, setAddr] = useState('');
  const [r, setR] = useState<GpRoute | null>(null); const [err, setErr] = useState('');
  const [busy, run] = useAction();
  const build = (b: { fromLat?: number; fromLng?: number; fromAddress?: string }) => void run(async () => {
    setErr(''); const res = await gp.route(place.id, b);
    if (!res.ok) return setErr(res.error === 'from_not_found' ? 'Адрес начала маршрута не найден. Уточните город и улицу.' : 'Не удалось построить маршрут. Попробуйте позже или откройте во внешнем приложении.');
    setR(res.data!);
  });
  useEffect(() => { if (pos) build({ fromLat: pos.lat, fromLng: pos.lng }); else void gp.route(place.id, {}).then((x) => { if (x.ok) setR(x.data!); }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const geo = async () => { const p = await locate(); if (!p) return setErr('Геолокация недоступна. Разрешите доступ в настройках или введите адрес вручную.'); setFrom(p); build({ fromLat: p.lat, fromLng: p.lng }); };
  const links = r?.links;
  return (
    <div>
      <Back onClick={onBack} title="Маршрут" />
      <Col>
        <Card><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{place.name}</div><div translate="no" style={{ fontSize: 13, color: C.t2 }}>{place.city}, {place.address}</div></Card>
        <Btn busy={busy} onClick={() => void geo()}><Navigation size={16} /> От моего местоположения</Btn>
        <Input label="Или адрес начала маршрута" value={addr} onChange={setAddr} placeholder="Город, улица, дом" max={200} />
        <Btn kind="soft" busy={busy} disabled={addr.trim().length < 3} onClick={() => build({ fromAddress: addr.trim() })}>Построить маршрут</Btn>
        {err && <Notice tone="warn">{err}</Notice>}
        {r?.km != null && <Card><div style={{ fontSize: 18, fontWeight: 900, color: C.t1 }}>{r.km} км · {r.minutes} мин</div>{r.estimated && <div style={{ fontSize: 12, color: C.t2 }}>Оценка по прямой: точный маршрут по дорогам недоступен.</div>}</Card>}
        {r?.unavailable && <Notice tone="warn">Расстояние и время рассчитать не удалось — откройте маршрут во внешнем приложении.</Notice>}
        {r?.need === 'from' && !err && <Notice>Укажите, откуда ехать, — или откройте маршрут во внешнем приложении: оно спросит начало само.</Notice>}
        {r?.from && place.lat != null && place.lng != null && <div style={{ borderRadius: 18, overflow: 'hidden' }}><SkyMap height={220} points={[{ id: 'a', pos: r.from, label: 'Старт' }, { id: 'b', pos: { lat: place.lat, lng: place.lng }, label: place.name }]} /></div>}
        {links && <Card><div style={{ fontWeight: 800, marginBottom: 8, color: C.t1 }}><MapIcon size={15} style={{ verticalAlign: -2 }} /> Открыть в приложении</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{([['Яндекс Карты', links.yandex], ['Google Maps', links.google], ['2ГИС', links.twogis]] as const).map(([n, u]) => <a key={n} href={u} target="_blank" rel="noopener noreferrer" style={{ padding: '10px 14px', borderRadius: 12, background: C.l2, color: GO, fontWeight: 700, textDecoration: 'none' }}>{n}</a>)}</div></Card>}
      </Col>
    </div>
  );
};

/* ─── Оформление заказа ─── */
const Checkout = ({ place, lines, total, onBack, onDone }: { place: GpPlace; lines: { id: string; qty: number; variant?: string; title: string; price: number }[]; total: number; onBack: () => void; onDone: () => void }) => {
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState('');
  const [done, setDone] = useState<{ number: number; payUrl: string; totalRub: number } | null>(null);
  const [busy, run] = useAction();
  const send = () => void run(async () => {
    const r = await gp.order(place.id, { items: lines.map((l) => ({ id: l.id, qty: l.qty, variant: l.variant })), contact: { name, phone, address } });
    if (!r.ok) return fail(r);
    setDone(r.data!);
  });
  if (done) return (
    <Col>
      <Card><div style={{ fontSize: 20, fontWeight: 900, color: C.t1 }}>Заказ № {done.number} создан</div>
        <div style={{ fontSize: 14, color: C.t2, margin: '6px 0 10px' }}>К оплате: {fmt(done.totalRub)} ₽. Оплата — прямым переводом организации по её реквизитам. Sky деньги не принимает; статус изменится, когда организация подтвердит поступление.</div>
        <a href={done.payUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: 14, borderRadius: 14, background: GO, color: '#fff', fontWeight: 800, textDecoration: 'none' }}>Перейти к оплате</a></Card>
      <Btn kind="soft" onClick={onDone}>Готово</Btn>
    </Col>
  );
  return (
    <div>
      <Back onClick={onBack} title="Оформление" />
      <Col>
        <Card>{lines.map((l) => <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.t1, padding: '3px 0' }}><span translate="no">{l.title}{l.variant ? ` (${l.variant})` : ''} × {l.qty}</span><b>{fmt(l.qty * l.price)} ₽</b></div>)}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 900, color: C.t1 }}><span>Итого</span><span>{fmt(total)} ₽</span></div></Card>
        <Input label="Имя" value={name} onChange={setName} max={80} />
        <Input label="Телефон" value={phone} onChange={setPhone} type="tel" max={30} placeholder="+7…" />
        <Input label="Комментарий или адрес (необязательно)" value={address} onChange={setAddress} max={200} area />
        <Notice>Итоговую сумму и наличие позиций проверяет сервер. Оплата — прямой перевод организации, Sky деньги не принимает.</Notice>
        <Btn busy={busy} disabled={name.trim().length < 2 || phone.trim().length < 5} onClick={send}>Создать заказ и перейти к оплате</Btn>
      </Col>
    </div>
  );
};

/* ─── Мои заказы ─── */
const MyOrders = ({ onBack }: { onBack: () => void }) => {
  const [tab, setTab] = useState<'orders' | 'bookings'>('orders');
  const [res, reload] = useLoad(() => gp.orders(), [], 20000);
  const [busy, run] = useAction();
  const orders: GpOrder[] = res && res.ok ? res.data!.orders : [];
  return (
    <div>
      <Back onClick={onBack} title="Мои заказы и записи" />
      <div style={{ marginBottom: 10 }}><Segmented value={tab} onChange={setTab} options={[{ v: 'orders', t: 'Заказы' }, { v: 'bookings', t: 'Записи' }]} /></div>
      {tab === 'bookings' ? <MyBookings /> : !res ? <Empty text="Загрузка…" /> : !res.ok ? <ErrorState text="Не удалось загрузить заказы." onRetry={reload} /> : !orders.length ? <Empty text="Заказов пока нет" /> : (
        <Col>{orders.map((o) => (
          <Card key={o.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b translate="no" style={{ color: C.t1 }}>{o.placeName} · № {o.number}</b><b style={{ color: C.t1 }}>{fmt(o.totalRub)} ₽</b></div>
            <div style={{ fontSize: 12, color: C.t2, margin: '4px 0' }}>{o.lines.map((l) => `${l.title}${l.variant ? ` (${l.variant})` : ''} × ${l.qty}`).join(', ')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Chip>{o.statusLabel}</Chip><Chip color="#64748b">{o.payLabel}</Chip></div>
            {o.comment && <div translate="no" style={{ fontSize: 12, color: C.t2, marginTop: 4 }}>{o.comment}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {o.payUrl && <a href={o.payUrl} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: 'center', padding: 12, borderRadius: 12, background: GO, color: '#fff', fontWeight: 800, textDecoration: 'none' }}>Оплатить</a>}
              {o.status === 'new' && <Btn kind="danger" busy={busy} onClick={() => void run(async () => { const r = await gp.cancelOrder(o.id); if (!r.ok) return fail(r); flash('Заказ отменён'); reload(); })}>Отменить</Btn>}
            </div>
          </Card>
        ))}</Col>
      )}
    </div>
  );
};

