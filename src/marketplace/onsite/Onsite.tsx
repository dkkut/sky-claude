/**
 * Sky Market → «На месте»: вещи, которые смотрят и покупают при встрече — в городе, области или по стране.
 * Sky деньги за вещь не принимает и вещь не проверяет: договариваются и рассчитываются люди при встрече.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, MapPin, Plus, Star, ShieldAlert, Clock, Check } from 'lucide-react';
import { apiBlob } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { C, fmt } from '../ui';
import { COUNTRIES } from '../countries';
import { onsiteApi, errText, CATEGORY_LABEL, CONDITION_LABEL, SCOPE_LABEL, DEAL_LABEL, type OnsiteCard, type OnsiteDetail, type Deal, type Scope, type Reach } from './api';

const ACC = '#0ea5a4';
const box: React.CSSProperties = { background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 16, padding: 12 };
const field: React.CSSProperties = { width: '100%', height: 44, borderRadius: 12, border: `1px solid ${C.brd}`, background: C.l2, color: C.t1, padding: '0 12px', fontSize: 14, boxSizing: 'border-box' };
const Btn = ({ children, onClick, kind = 'main', disabled, busy }: { children: React.ReactNode; onClick?: () => void; kind?: 'main' | 'soft' | 'danger'; disabled?: boolean; busy?: boolean }) => (
  <button type="button" disabled={disabled || busy} onClick={onClick} style={{ minHeight: 44, borderRadius: 12, padding: '0 16px', fontWeight: 700, fontSize: 14, border: kind === 'soft' ? `1px solid ${C.brd}` : 'none',
    background: kind === 'main' ? ACC : kind === 'danger' ? 'rgba(239,68,68,.14)' : C.l2, color: kind === 'main' ? '#fff' : kind === 'danger' ? '#ef4444' : C.t1, opacity: disabled || busy ? 0.55 : 1, cursor: 'pointer' }}>{children}</button>);
const Chip = ({ on, children, onClick }: { on?: boolean; children: React.ReactNode; onClick?: () => void }) => (
  <button type="button" onClick={onClick} style={{ flexShrink: 0, minHeight: 36, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: `1px solid ${on ? ACC : C.brd}`, background: on ? 'rgba(14,165,164,.14)' : C.l2, color: on ? ACC : C.t2 }}>{children}</button>);
const Head = ({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
    {onBack && <button type="button" onClick={onBack} aria-label="Назад" style={{ width: 40, height: 40, borderRadius: 12, border: 'none', background: C.l2, color: C.t1, display: 'grid', placeItems: 'center' }}><ChevronLeft size={20} /></button>}
    <div style={{ flex: 1, fontSize: 18, fontWeight: 800, color: C.t1 }}>{title}</div>{right}
  </div>);

const cache = new Map<string, string>();
const Photo = ({ id, admin, style }: { id: string | null; admin?: boolean; style?: React.CSSProperties }) => {
  const [url, setUrl] = useState<string | null>(id ? cache.get(id) ?? null : null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    if (cache.has(id)) { setUrl(cache.get(id)!); return; }
    let alive = true;
    void apiBlob(admin ? `/api/admin/onsite/photos/${id}` : `/api/onsite/photos/${id}`).then((r) => { if (!r.ok || !r.blob) return; const u = URL.createObjectURL(r.blob); cache.set(id, u); if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id, admin]);
  return url ? <img src={url} alt="" style={{ objectFit: 'cover', width: '100%', height: '100%', ...style }} /> : <div style={{ width: '100%', height: '100%', background: C.l2, ...style }} />;
};
export { Photo as OnsitePhoto };

/* ─── Моё место (для фильтра) ─── */
interface Place { country: string; region: string; city: string; reach: Reach }
const loadPlace = (): Place => { try { const p = JSON.parse(localStorage.getItem('sky:onsite:place') ?? ''); if (p?.country) return { country: p.country, region: p.region ?? '', city: p.city ?? '', reach: ['city', 'region', 'country'].includes(p.reach) ? p.reach : 'country' }; } catch { /* нет */ } return { country: 'RU', region: '', city: '', reach: 'country' }; };
const savePlace = (p: Place) => { try { localStorage.setItem('sky:onsite:place', JSON.stringify(p)); } catch { /* ок */ } };

const Safety = () => (
  <div style={{ ...box, background: 'rgba(245,158,11,.1)', borderColor: 'rgba(245,158,11,.35)', fontSize: 12.5, lineHeight: 1.45, color: C.t2 }}>
    <b style={{ color: C.t1 }}>Безопасная встреча.</b> Встречайтесь в людном месте, осматривайте вещь до оплаты, не переводите деньги заранее. Sky не принимает деньги за вещь, не проверяет её и не отвечает за расчёт при встрече — отвечают стороны. Не отдавайте код встречи заранее: его показывает покупатель продавцу при встрече.
  </div>);

/* ═══ Каталог ═══ */
const Catalog = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [place, setPlace] = useState<Place>(loadPlace);
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [sort, setSort] = useState('new'); const [edit, setEdit] = useState(false);
  const [items, setItems] = useState<OnsiteCard[] | null>(null); const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const r = await onsiteApi.catalog({ country: place.country, region: place.region, city: place.city, reach: place.reach, category: cat, q, sort });
    if (r.ok) setItems(r.data!.items); else { setItems([]); setErr(errText(r)); }
  }, [place, cat, q, sort]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 350 : 0); return () => clearTimeout(t); }, [load, q]);
  const set = (p: Partial<Place>) => { const n = { ...place, ...p }; setPlace(n); savePlace(n); };
  const where = [place.city, place.region].filter(Boolean).join(', ') || 'место не указано';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 8 }}>
        <MapPin size={18} color={ACC} /><div translate="no" style={{ flex: 1, fontSize: 14, color: C.t1, fontWeight: 600 }}>{where}</div>
        <Btn kind="soft" onClick={() => setEdit(!edit)}>{edit ? 'Готово' : 'Изменить'}</Btn>
      </div>
      {edit && (
        <div style={{ ...box, display: 'grid', gap: 8 }}>
          <select aria-label="Страна" value={place.country} onChange={(e) => set({ country: e.target.value })} style={field}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          <input aria-label="Область" placeholder="Область / регион" value={place.region} onChange={(e) => set({ region: e.target.value })} style={field} />
          <input aria-label="Город" placeholder="Город" value={place.city} onChange={(e) => set({ city: e.target.value })} style={field} />
        </div>)}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {(['city', 'region', 'country'] as Reach[]).map((r) => <Chip key={r} on={place.reach === r} onClick={() => set({ reach: r })}>{r === 'city' ? 'Мой город' : r === 'region' ? '+ область' : '+ вся страна'}</Chip>)}
      </div>
      <input aria-label="Поиск" placeholder="Поиск по объявлениям" value={q} onChange={(e) => setQ(e.target.value)} style={field} />
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        <Chip on={!cat} onClick={() => setCat('')}>Все</Chip>
        {Object.entries(CATEGORY_LABEL).map(([k, l]) => <Chip key={k} on={cat === k} onClick={() => setCat(k)}>{l}</Chip>)}
      </div>
      <select aria-label="Сортировка" value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...field, height: 38 }}><option value="new">Сначала новые</option><option value="cheap">Сначала дешёвые</option><option value="expensive">Сначала дорогие</option></select>
      {err && <div role="alert" style={{ color: '#ef4444', fontSize: 13 }}>{err}</div>}
      {items === null ? <div role="status" style={{ color: C.t3, padding: 24, textAlign: 'center' }}>Загрузка…</div>
        : items.length === 0 ? <div style={{ color: C.t3, padding: 28, textAlign: 'center', fontSize: 14 }}>Объявлений рядом пока нет. Расширьте радиус («+ область», «+ вся страна») или разместите своё.</div>
        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 }}>
          {items.map((i) => (
            <button key={i.id} type="button" onClick={() => onOpen(i.id)} style={{ ...box, padding: 0, overflow: 'hidden', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ aspectRatio: '1 / 1', position: 'relative' }}><Photo id={i.photo} />{i.status === 'reserved' && <span style={{ position: 'absolute', top: 8, left: 8, background: '#f59e0b', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>Забронировано</span>}</div>
              <div style={{ padding: 10 }}>
                <div style={{ fontWeight: 800, color: C.t1 }}>{i.priceRub === 0 ? 'Даром' : fmt(i.priceRub)}</div>
                <div translate="no" style={{ fontSize: 13, color: C.t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</div>
                <div translate="no" style={{ fontSize: 11.5, color: C.t3 }}>{i.city}</div>
              </div>
            </button>))}
        </div>}
    </div>
  );
};

/* ═══ Страница объявления ═══ */
const ListingPage = ({ id, onBack, onDeal }: { id: string; onBack: () => void; onDeal: (dealId: string) => void }) => {
  const [res, setRes] = useState<Awaited<ReturnType<typeof onsiteApi.listing>> | null>(null);
  const [note, setNote] = useState(''); const [ask, setAsk] = useState(false); const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState(false); const [reason, setReason] = useState('forbidden'); const [rtext, setRtext] = useState(''); const [ph, setPh] = useState(0);
  const load = useCallback(async () => setRes(await onsiteApi.listing(id)), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!res) return <div role="status" style={{ color: C.t3, padding: 24 }}>Загрузка…</div>;
  if (!res.ok) return <><Head title="Объявление" onBack={onBack} /><div style={{ color: C.t3 }}>{errText(res)}</div></>;
  const l: OnsiteDetail = res.data!.listing; const my = res.data!.myDeal;
  const request = async () => { setBusy(true); const r = await onsiteApi.request(id, note); setBusy(false); if (!r.ok) { if (r.error === 'deal_exists') { const d = (r.data as { id?: string } | undefined)?.id; if (d) return onDeal(d); } return flash(errText(r)); } flash('Заявка отправлена продавцу'); onDeal(r.data!.id); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Head title="Объявление" onBack={onBack} />
      <div style={{ aspectRatio: '4 / 3', borderRadius: 16, overflow: 'hidden', background: C.l2 }}><Photo id={l.photos[ph] ?? null} /></div>
      {l.photos.length > 1 && <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>{l.photos.map((p, i) => <button key={p} type="button" aria-label={`Фото ${i + 1}`} onClick={() => setPh(i)} style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 10, overflow: 'hidden', padding: 0, border: `2px solid ${i === ph ? ACC : 'transparent'}` }}><Photo id={p} /></button>)}</div>}
      <div style={{ fontSize: 22, fontWeight: 900, color: C.t1 }}>{l.priceRub === 0 ? 'Даром' : fmt(l.priceRub)}{l.negotiable && <span style={{ fontSize: 12, fontWeight: 600, color: C.t3 }}> · торг</span>}</div>
      <div translate="no" style={{ fontSize: 16, fontWeight: 700, color: C.t1 }}>{l.title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><Chip>{CATEGORY_LABEL[l.category]}</Chip><Chip>{CONDITION_LABEL[l.condition]}</Chip><Chip>{SCOPE_LABEL[l.scope]}</Chip>{l.status === 'reserved' && <Chip on>Забронировано</Chip>}</div>
      <div translate="no" style={{ fontSize: 13, color: C.t2 }}><MapPin size={13} style={{ verticalAlign: -2 }} /> {[l.city, l.region].filter(Boolean).join(', ')}{l.area ? ` · ${l.area}` : ''}</div>
      {l.descr && <div translate="no" style={{ ...box, whiteSpace: 'pre-wrap', fontSize: 14, color: C.t1 }}>{l.descr}</div>}
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}><div translate="no" style={{ fontWeight: 700, color: C.t1 }}>@{l.seller?.username}</div>
          <div style={{ fontSize: 12.5, color: C.t3 }}>{l.seller?.reviews ? <><Star size={12} style={{ verticalAlign: -1 }} fill="#f59e0b" color="#f59e0b" /> {l.seller.avg} · {l.seller.reviews} отз.</> : 'Отзывов пока нет'} · сделок: {l.seller?.completedDeals ?? 0}</div></div>
      </div>
      <Safety />
      {!l.own && (my ? <Btn onClick={() => onDeal(my.id)}>{`Моя встреча: ${DEAL_LABEL[my.status] ?? my.status}`}</Btn>
        : l.status === 'published' ? (ask ? (
          <div style={{ ...box, display: 'grid', gap: 8 }}>
            <textarea aria-label="Сообщение продавцу" placeholder="Когда удобно посмотреть? (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} style={{ ...field, height: 'auto', padding: 10 }} />
            <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} onClick={request}>Отправить заявку</Btn><Btn kind="soft" onClick={() => setAsk(false)}>Отмена</Btn></div></div>)
          : <Btn onClick={() => setAsk(true)}>Хочу посмотреть вещь</Btn>)
          : <div style={{ color: C.t3, fontSize: 13 }}>Вещь забронирована другим покупателем.</div>)}
      {l.own && <div style={{ color: C.t3, fontSize: 13 }}>Это ваше объявление. Управлять им можно во вкладке «Мои».{l.modNote ? ` Модерация: ${l.modNote}` : ''}</div>}
      {res.data!.reviews.length > 0 && <div style={{ display: 'grid', gap: 6 }}><b style={{ color: C.t1, fontSize: 14 }}>Отзывы о продавце</b>{res.data!.reviews.map((r, i) => <div key={i} style={{ ...box, fontSize: 13, color: C.t2 }}>{'★'.repeat(r.rating)} <span translate="no">{r.text}</span> <span style={{ color: C.t3 }}>— @{r.by}</span></div>)}</div>}
      {!l.own && (rep ? (
        <div style={{ ...box, display: 'grid', gap: 8 }}>
          <select aria-label="Причина жалобы" value={reason} onChange={(e) => setReason(e.target.value)} style={field}><option value="forbidden">Запрещённый товар</option><option value="fraud">Похоже на обман</option><option value="wrong_info">Неверное описание</option><option value="spam">Спам</option><option value="other">Другое</option></select>
          <textarea aria-label="Пояснение" placeholder="Что не так (необязательно)" value={rtext} onChange={(e) => setRtext(e.target.value)} maxLength={500} rows={2} style={{ ...field, height: 'auto', padding: 10 }} />
          <div style={{ display: 'flex', gap: 8 }}><Btn onClick={async () => { const r = await onsiteApi.report(id, reason, rtext); flash(r.ok ? 'Жалоба отправлена модераторам' : errText(r)); if (r.ok) setRep(false); }}>Пожаловаться</Btn><Btn kind="soft" onClick={() => setRep(false)}>Отмена</Btn></div></div>)
        : <button type="button" onClick={() => setRep(true)} style={{ background: 'none', border: 'none', color: C.t3, fontSize: 12.5, textAlign: 'left' }}><ShieldAlert size={12} style={{ verticalAlign: -2 }} /> Пожаловаться на объявление</button>)}
    </div>
  );
};

/* ═══ Встреча (сделка) ═══ */
const DealPage = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [res, setRes] = useState<Awaited<ReturnType<typeof onsiteApi.deal>> | null>(null);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(''); const [place, setPlace] = useState(''); const [code, setCode] = useState(''); const [fail, setFail] = useState(''); const [showFail, setShowFail] = useState(false);
  const [rating, setRating] = useState(5); const [rtext, setRtext] = useState('');
  const load = useCallback(async () => setRes(await onsiteApi.deal(id)), [id]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 8000); return () => clearInterval(t); }, [load]);
  if (!res) return <div role="status" style={{ color: C.t3, padding: 24 }}>Загрузка…</div>;
  if (!res.ok) return <><Head title="Встреча" onBack={onBack} /><div style={{ color: C.t3 }}>{errText(res)}</div></>;
  const d = res.data!.deal; const msgs = res.data!.messages; const seller = d.role === 'seller';
  const run = async (a: Parameters<typeof onsiteApi.dealAct>[1], body: unknown, ok: string) => { setBusy(true); const r = await onsiteApi.dealAct(id, a, body); setBusy(false); if (!r.ok) { flash(errText(r)); return false; } flash(ok); await load(); return true; };
  const when = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Head title="Встреча" onBack={onBack} />
      <div style={box}><div translate="no" style={{ fontWeight: 800, color: C.t1 }}>{d.title}</div><div style={{ fontSize: 13, color: C.t2 }}>{d.priceRub === 0 ? 'Даром' : fmt(d.priceRub ?? 0)} · {seller ? `покупатель @${d.buyer?.username}` : `продавец @${d.seller?.username}`}</div>
        <div style={{ marginTop: 6 }}><Chip on>{DEAL_LABEL[d.status] ?? d.status}</Chip></div></div>
      {['accepted', 'met'].includes(d.status) && <div style={{ ...box }}><div style={{ fontSize: 13, color: C.t3 }}>Время и место</div><div translate="no" style={{ fontWeight: 700, color: C.t1 }}>{when(d.meetAt)}</div><div translate="no" style={{ fontSize: 14, color: C.t2 }}>{d.meetPlace}</div></div>}
      {d.status === 'requested' && seller && (
        <div style={{ ...box, display: 'grid', gap: 8 }}>
          <b style={{ color: C.t1 }}>Назначить встречу</b>
          <input aria-label="Дата и время встречи" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} style={field} />
          <input aria-label="Место встречи" placeholder="Место встречи (людное, например ТЦ или метро)" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={160} style={field} />
          <div style={{ fontSize: 12, color: C.t3 }}>Объявление станет «забронировано», остальные заявки будут отклонены. Покупатель получит код встречи.</div>
          <div style={{ display: 'flex', gap: 8 }}><Btn busy={busy} disabled={!at || place.trim().length < 3} onClick={() => run('accept', { meetAt: new Date(at).toISOString(), place }, 'Встреча назначена')}>Принять</Btn><Btn kind="soft" onClick={() => run('decline', {}, 'Заявка отклонена')}>Отклонить</Btn></div>
        </div>)}
      {d.status === 'accepted' && !seller && d.meetCode && (
        <div style={{ ...box, textAlign: 'center' }}><div style={{ fontSize: 13, color: C.t3 }}>Код встречи — покажите продавцу при встрече, не раньше</div><div translate="no" style={{ fontSize: 34, fontWeight: 900, letterSpacing: 8, color: C.t1 }}>{d.meetCode}</div></div>)}
      {d.status === 'accepted' && seller && (
        <div style={{ ...box, display: 'grid', gap: 8 }}><b style={{ color: C.t1 }}>Вы встретились?</b><div style={{ fontSize: 12.5, color: C.t3 }}>Попросите у покупателя 4-значный код встречи и введите его.</div>
          <input aria-label="Код встречи" inputMode="numeric" maxLength={4} placeholder="0000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ ...field, letterSpacing: 6, textAlign: 'center', fontSize: 20 }} />
          <Btn busy={busy} disabled={code.length !== 4} onClick={async () => { if (await run('confirm', { code }, 'Встреча подтверждена')) setCode(''); }}>Подтвердить встречу</Btn></div>)}
      {d.status === 'met' && (
        <div style={{ ...box, display: 'grid', gap: 8 }}><b style={{ color: C.t1 }}>Осмотр и итог</b>
          <div style={{ fontSize: 12.5, color: C.t3 }}>Осмотрите вещь. Если всё устроило — оба подтверждают «сделка состоялась» (деньги — напрямую между вами). Если нет — отметьте «не состоялась», объявление вернётся в продажу.</div>
          {((seller && d.sellerDone) || (!seller && d.buyerDone)) ? <div style={{ fontSize: 13, color: C.t2 }}><Check size={13} style={{ verticalAlign: -2 }} /> Вы подтвердили. Ждём вторую сторону.</div>
            : <Btn busy={busy} onClick={() => run('done', {}, 'Подтверждено')}>Сделка состоялась</Btn>}
          {showFail ? (<><textarea aria-label="Причина" placeholder="Что не подошло (от 3 знаков)" value={fail} onChange={(e) => setFail(e.target.value)} maxLength={300} rows={2} style={{ ...field, height: 'auto', padding: 10 }} />
            <div style={{ display: 'flex', gap: 8 }}><Btn kind="danger" busy={busy} disabled={fail.trim().length < 3} onClick={() => run('fail', { note: fail }, 'Встреча закрыта без сделки')}>Не состоялась</Btn><Btn kind="soft" onClick={() => setShowFail(false)}>Отмена</Btn></div></>)
            : <Btn kind="soft" onClick={() => setShowFail(true)}>Не состоялась / не подошло</Btn>}
        </div>)}
      {['requested', 'accepted'].includes(d.status) && !(d.status === 'requested' && seller) && <Btn kind="soft" onClick={() => run('cancel', {}, 'Встреча отменена')}>{d.status === 'requested' ? 'Отозвать заявку' : 'Отменить встречу'}</Btn>}
      {d.status === 'accepted' && seller && <Btn kind="soft" onClick={() => run('cancel', {}, 'Встреча отменена')}>Отменить встречу</Btn>}
      {d.status === 'completed' && (d.myReview ? <div style={{ ...box, fontSize: 13, color: C.t2 }}>Ваш отзыв: {'★'.repeat(d.myReview.rating)} <span translate="no">{d.myReview.text}</span></div> : (
        <div style={{ ...box, display: 'grid', gap: 8 }}><b style={{ color: C.t1 }}>Оставьте отзыв</b>
          <div role="radiogroup" style={{ display: 'flex', gap: 6 }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n}`} onClick={() => setRating(n)} style={{ width: 44, height: 44, borderRadius: 12, border: `1px solid ${rating >= n ? '#f59e0b' : C.brd}`, background: rating >= n ? 'rgba(245,158,11,.18)' : C.l2, color: '#f59e0b', fontSize: 18 }}>★</button>)}</div>
          <textarea aria-label="Текст отзыва" placeholder="Как прошла встреча (необязательно)" value={rtext} onChange={(e) => setRtext(e.target.value)} maxLength={400} rows={2} style={{ ...field, height: 'auto', padding: 10 }} />
          <Btn busy={busy} onClick={() => run('review', { rating, text: rtext }, 'Спасибо за отзыв')}>Отправить отзыв</Btn></div>))}
      {d.outcomeNote && ['declined', 'cancelled', 'failed', 'expired'].includes(d.status) && <div translate="no" style={{ fontSize: 13, color: C.t3 }}>{d.outcomeNote}</div>}
      <div style={{ ...box, display: 'grid', gap: 6 }}>
        <b style={{ color: C.t1, fontSize: 14 }}>Переписка</b>
        {msgs.length === 0 && <div style={{ fontSize: 13, color: C.t3 }}>Сообщений пока нет.</div>}
        {msgs.map((m) => <div key={m.id} translate="no" style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.mine ? 'rgba(14,165,164,.16)' : C.l2, color: C.t1, borderRadius: 12, padding: '6px 10px', fontSize: 14 }}>{m.text}</div>)}
        {!['declined', 'cancelled', 'expired'].includes(d.status) && <div style={{ display: 'flex', gap: 6 }}><input aria-label="Сообщение" placeholder="Сообщение" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} style={{ ...field, flex: 1 }} />
          <Btn disabled={!text.trim()} busy={busy} onClick={async () => { if (await run('message', { text }, 'Отправлено')) setText(''); }}>→</Btn></div>}
      </div>
      <Safety />
    </div>
  );
};

/* ═══ Мои: объявления и встречи ═══ */
const emptyForm = { id: '', title: '', descr: '', category: 'other', condition: 'used', priceRub: '0', negotiable: false, scope: 'city' as Scope, country: 'RU', region: '', city: '', area: '' };
const Mine = ({ onDeal, onOpen }: { onDeal: (id: string) => void; onOpen: (id: string) => void }) => {
  const [list, setList] = useState<OnsiteCard[] | null>(null); const [deals, setDeals] = useState<Deal[] | null>(null);
  const [f, setF] = useState<typeof emptyForm | null>(null); const [photos, setPhotos] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const [a, b] = await Promise.all([onsiteApi.mine(), onsiteApi.deals()]); setList(a.ok ? a.data!.items : []); setDeals(b.ok ? b.data!.items : []); }, []);
  useEffect(() => { void load(); }, [load]);
  const edit = async (c: OnsiteCard) => { const r = await onsiteApi.listing(c.id); if (!r.ok) return flash(errText(r)); const l = r.data!.listing; setPhotos(l.photos); setF({ id: l.id, title: l.title, descr: l.descr, category: l.category, condition: l.condition, priceRub: String(l.priceRub), negotiable: l.negotiable, scope: l.scope, country: l.country, region: l.region, city: l.city, area: l.area }); };
  const save = async () => {
    if (!f) return; setBusy(true);
    const r = await onsiteApi.save({ ...f, id: f.id || undefined, priceRub: Number(f.priceRub) });
    setBusy(false); if (!r.ok) return flash(errText(r));
    flash('Сохранено'); setF({ ...f, id: r.data!.id }); void load();
  };
  const add = async (file: File | undefined) => {
    if (!file || !f?.id) return; setBusy(true); const r = await onsiteApi.addPhoto(f.id, file); setBusy(false);
    if (!r.ok) return flash(errText(r)); setPhotos((p) => [...p, r.data!.id]);
  };
  const act = async (id: string, a: 'publish' | 'close') => { const r = await onsiteApi.act(id, a); if (!r.ok) return flash(errText(r)); flash(a === 'publish' ? 'Опубликовано' : 'Снято с публикации'); void load(); };
  if (f) return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Head title={f.id ? 'Объявление' : 'Новое объявление'} onBack={() => { setF(null); void load(); }} />
      <input aria-label="Название" placeholder="Название" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={100} style={field} />
      <textarea aria-label="Описание" placeholder="Описание: состояние, комплект, причина продажи" value={f.descr} onChange={(e) => setF({ ...f, descr: e.target.value })} maxLength={2000} rows={4} style={{ ...field, height: 'auto', padding: 10 }} />
      <select aria-label="Категория" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={field}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select aria-label="Состояние" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} style={field}>{Object.entries(CONDITION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input aria-label="Цена, ₽" inputMode="numeric" placeholder="Цена, ₽ (0 — отдам даром)" value={f.priceRub} onChange={(e) => setF({ ...f, priceRub: e.target.value.replace(/\D/g, '') })} style={field} />
      <label style={{ fontSize: 13, color: C.t2 }}><input type="checkbox" checked={f.negotiable} onChange={(e) => setF({ ...f, negotiable: e.target.checked })} /> Торг уместен</label>
      <div style={{ fontSize: 12.5, color: C.t3 }}>Где вы готовы встретиться</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(['city', 'region', 'country'] as Scope[]).map((s) => <Chip key={s} on={f.scope === s} onClick={() => setF({ ...f, scope: s })}>{SCOPE_LABEL[s]}</Chip>)}</div>
      <select aria-label="Страна" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} style={field}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      <input aria-label="Город" placeholder="Город" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={80} style={field} />
      <input aria-label="Область" placeholder={f.scope === 'city' ? 'Область / регион (необязательно)' : 'Область / регион'} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={80} style={field} />
      <input aria-label="Район" placeholder="Район или метро (необязательно; точный адрес не публикуется)" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} maxLength={120} style={field} />
      <Btn busy={busy} onClick={save}>{f.id ? 'Сохранить' : 'Создать черновик'}</Btn>
      {f.id && (<>
        <div style={{ fontSize: 13, color: C.t2 }}>Фото ({photos.length}/6)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{photos.map((p) => <div key={p} style={{ position: 'relative', width: 72, height: 72, borderRadius: 10, overflow: 'hidden' }}><Photo id={p} /><button type="button" aria-label="Удалить фото" onClick={async () => { const r = await onsiteApi.removePhoto(f.id, p); if (r.ok) setPhotos((x) => x.filter((y) => y !== p)); }} style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff' }}>×</button></div>)}
          {photos.length < 6 && <label style={{ width: 72, height: 72, borderRadius: 10, border: `1px dashed ${C.brd}`, display: 'grid', placeItems: 'center', color: C.t3, cursor: 'pointer' }}><Plus size={22} /><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Добавить фото" hidden onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} /></label>}</div>
        <Btn kind="soft" onClick={() => act(f.id, 'publish')}>Опубликовать</Btn></>)}
    </div>);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Safety />
      <Btn onClick={() => { setPhotos([]); setF({ ...emptyForm, ...(() => { const p = loadPlace(); return { country: p.country, region: p.region, city: p.city }; })() }); }}>+ Разместить вещь</Btn>
      <b style={{ color: C.t1 }}>Мои встречи</b>
      {deals === null ? <div style={{ color: C.t3 }}>Загрузка…</div> : deals.length === 0 ? <div style={{ color: C.t3, fontSize: 13 }}>Встреч пока нет.</div> : deals.map((d) => (
        <button key={d.id} type="button" onClick={() => onDeal(d.id)} style={{ ...box, display: 'flex', gap: 10, textAlign: 'left', alignItems: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flexShrink: 0 }}><Photo id={d.photo ?? null} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div translate="no" style={{ fontWeight: 700, color: C.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</div><div style={{ fontSize: 12.5, color: C.t3 }}>{d.role === 'seller' ? 'Вы продаёте' : 'Вы покупаете'} · {DEAL_LABEL[d.status] ?? d.status}</div></div>
          {d.status === 'requested' && d.role === 'seller' && <Clock size={16} color="#f59e0b" />}
        </button>))}
      <b style={{ color: C.t1 }}>Мои объявления</b>
      {list === null ? <div style={{ color: C.t3 }}>Загрузка…</div> : list.length === 0 ? <div style={{ color: C.t3, fontSize: 13 }}>Объявлений пока нет.</div> : list.map((c) => (
        <div key={c.id} style={{ ...box, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" aria-label="Открыть" onClick={() => onOpen(c.id)} style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', flexShrink: 0, padding: 0, border: 'none' }}><Photo id={c.photo} /></button>
          <div style={{ flex: 1, minWidth: 0 }}><div translate="no" style={{ fontWeight: 700, color: C.t1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
            <div style={{ fontSize: 12.5, color: C.t3 }}>{({ draft: 'Черновик', published: 'В продаже', reserved: 'Забронировано', sold: 'Продано', closed: 'Снято' } as Record<string, string>)[c.status] ?? c.status} · {c.priceRub === 0 ? 'даром' : fmt(c.priceRub)}{c.requests ? ` · заявок: ${c.requests}` : ''}</div>
            {c.modNote && <div translate="no" style={{ fontSize: 12, color: '#ef4444' }}>Модерация: {c.modNote}</div>}</div>
          {['draft', 'published', 'closed'].includes(c.status) && <Btn kind="soft" onClick={() => edit(c)}>Изменить</Btn>}
          {c.status === 'published' && <Btn kind="soft" onClick={() => act(c.id, 'close')}>Снять</Btn>}
        </div>))}
    </div>
  );
};

/* ═══ Вкладка ═══ */
export const OnsiteTab = () => {
  const [view, setView] = useState<'catalog' | 'mine'>('catalog');
  const [listing, setListing] = useState<string | null>(null); const [deal, setDeal] = useState<string | null>(null);
  const back = () => { setListing(null); setDeal(null); };
  const body = useMemo(() => {
    if (deal) return <DealPage id={deal} onBack={back} />;
    if (listing) return <ListingPage id={listing} onBack={back} onDeal={(d) => { setListing(null); setDeal(d); }} />;
    return view === 'catalog' ? <Catalog onOpen={setListing} /> : <Mine onDeal={setDeal} onOpen={setListing} />;
  }, [view, listing, deal]);
  return (
    <div className="onsite-root" style={{ padding: 16, maxWidth: 760, margin: '0 auto', width: '100%' }}>
      {!listing && !deal && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <Chip on={view === 'catalog'} onClick={() => setView('catalog')}>Рядом</Chip><Chip on={view === 'mine'} onClick={() => setView('mine')}>Мои</Chip>
        </div>)}
      {body}
    </div>
  );
};
