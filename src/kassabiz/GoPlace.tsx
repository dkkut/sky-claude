/** Sky для бизнеса → «Sky GO»: подключение организации к каталогу «Организации», карточка, часы, фото, отправка на проверку. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, MapPin, Send, ImagePlus } from 'lucide-react';
import { flash } from '@/shared/flash';
import { apiBlob } from '@/core/auth/api';
import { goError } from '@/go/api';
import { gpOwner, photoId, type GpCategory, type GpHours, type GpOwnerPlace } from '@/go/placesApi';
import { SkyMap } from '@/marketplace/logistics/SkyMap';
import { Btn, In, card, field } from './ui';
import { Bookings, Schedule, OwnerReviews, PlaceStats } from './GoPlaceOps';

const DAYS: [string, string][] = [['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Вс']];
const TONE: Record<string, string> = { draft: 'var(--t3)', pending: 'var(--amber, #f59e0b)', published: 'var(--green, #22c55e)', rejected: 'var(--red)', hidden: 'var(--t3)', blocked: 'var(--red)' };
const toData = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });

const OwnerPhoto = ({ url, onDel }: { url: string; onDel: () => void }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let u = ''; let alive = true;
    void apiBlob(`/api/kbiz/place/media/${photoId(url)}`).then((r) => { if (alive && r.ok && r.blob) { u = URL.createObjectURL(r.blob); setSrc(u); } });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [url]);
  return (
    <div className="relative h-20 w-20 overflow-hidden rounded-xl" style={{ background: 'var(--bg-l2)' }}>
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
      <button type="button" aria-label="Удалить фото" onClick={onDel} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,.6)', color: '#fff' }}><Trash2 size={12} /></button>
    </div>
  );
};

const GoPlaceCard = () => {
  const [p, setP] = useState<GpOwnerPlace | null>(null); const [cats, setCats] = useState<GpCategory[]>([]); const [err, setErr] = useState(false);
  const [f, setF] = useState({ categoryId: '', about: '', city: '', address: '', phone: '', links: '' });
  const [hours, setHours] = useState<GpHours>({}); const [busy, setBusy] = useState(false); const [geoFailed, setGeoFailed] = useState(false);
  const fill = (x: GpOwnerPlace) => { setP(x); setF({ categoryId: x.categoryId ?? '', about: x.about, city: x.city, address: x.address, phone: x.phone, links: (x.links ?? []).map((l) => l.url).join('\n') }); setHours(x.hours ?? {}); };
  const load = useCallback(async () => { const r = await gpOwner.get(); if (!r.ok) return setErr(true); setErr(false); fill(r.data!.place); setCats(r.data!.categories ?? []); }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p className="text-sm" style={{ color: 'var(--red)' }}>Не удалось загрузить. <button type="button" className="underline" onClick={() => void load()}>Повторить</button></p>;
  if (!p) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} /></div>;

  const run = async <T,>(fn: () => Promise<{ ok: boolean; data?: T; error?: string; reason?: string; status?: number }>, after?: (d: T) => void) => {
    if (busy) return; setBusy(true);
    try { const r = await fn(); if (!r.ok) { flash(goError(r)); return; } after?.(r.data as T); } finally { setBusy(false); }
  };
  const save = () => run(() => gpOwner.save({
    categoryId: f.categoryId || undefined, about: f.about, city: f.city, address: f.address, phone: f.phone, hours,
    links: f.links.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 5).map((url) => ({ url })),
  } as never), (d) => { const x = d as { place: GpOwnerPlace; geoFailed?: boolean; returnedToDraft?: boolean }; fill(x.place); setGeoFailed(Boolean(x.geoFailed)); flash(x.returnedToDraft ? 'Сохранено. Карточка вернулась в черновик — отправьте её на проверку снова.' : 'Сохранено'); });
  const setSlot = (d: string, i: number, k: 0 | 1, v: string) => setHours((h) => { const s = [...(h[d] ?? [])]; s[i] = (k === 0 ? [v, s[i]?.[1] ?? '18:00'] : [s[i]?.[0] ?? '09:00', v]) as [string, string]; return { ...h, [d]: s }; });
  const photo = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return flash('Фото не больше 2 МБ.');
    await run(async () => gpOwner.addPhoto(await toData(file)), (d) => { setP((x) => (x ? { ...x, photos: d.photos } : x)); flash('Фото добавлено'); });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={card}>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Подключить к Sky GO</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Организация появится в каталоге «Организации» в Sky GO после проверки администрацией. Отдельного кабинета нет: заказы и оплата — здесь, в Sky для бизнеса.</p></div>
          <input type="checkbox" role="switch" aria-label="Подключить к Sky GO" checked={p.connected} disabled={busy || p.status === 'blocked'} onChange={(e) => void run(() => gpOwner.connect(e.target.checked), (d) => fill((d as { place: GpOwnerPlace }).place))} className="h-6 w-11 shrink-0" />
        </div>
        <p className="mt-2 text-xs font-semibold" style={{ color: TONE[p.status] }}>Статус: {p.statusLabel}</p>
        {p.rejectReason && <p role="alert" className="mt-1 text-xs" style={{ color: 'var(--red)' }}>Причина: {p.rejectReason}</p>}
      </div>

      {p.connected && p.status !== 'blocked' && <>
        <div className="rounded-2xl p-4 space-y-2" style={card}>
          <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Категория
            <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm outline-none" style={field}>
              <option value="">Выберите…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <In label="Описание" value={f.about} onChange={(v) => setF({ ...f, about: v })} max={1500} />
          <div className="grid grid-cols-2 gap-2"><In label="Город" value={f.city} onChange={(v) => setF({ ...f, city: v })} max={80} /><In label="Телефон" value={f.phone} onChange={(v) => setF({ ...f, phone: v })} max={30} /></div>
          <In label="Адрес" value={f.address} onChange={(v) => setF({ ...f, address: v })} max={200} />
          <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Ссылки (по одной в строке, только https)
            <textarea value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} rows={3} maxLength={900} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm outline-none" style={field} /></label>
          <div>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}><MapPin size={12} className="inline" /> Местоположение: {p.lat != null && p.lng != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'не определено'}</p>
            {(geoFailed || p.lat == null) && <p className="text-xs" style={{ color: 'var(--amber, #f59e0b)' }}>Адрес не удалось найти автоматически. Нажмите на карте нужную точку и сохраните.</p>}
            <div className="mt-1 overflow-hidden rounded-xl"><SkyMap height={200}
              points={p.lat != null && p.lng != null ? [{ id: 'me', pos: { lat: p.lat, lng: p.lng }, label: p.businessName }] : []}
              onPick={(pt) => void run(() => gpOwner.save({ lat: pt.lat, lng: pt.lng }), (d) => { fill((d as { place: GpOwnerPlace }).place); flash('Точка сохранена'); })} /></div>
          </div>
        </div>

        <div className="rounded-2xl p-4" style={card}>
          <p className="mb-1 text-sm font-black" style={{ color: 'var(--t1)' }}>Часы работы</p>
          {DAYS.map(([d, n]) => (
            <div key={d} className="flex flex-wrap items-center gap-1.5 py-1">
              <span className="w-8 text-xs" style={{ color: 'var(--t2)' }}>{n}</span>
              {(hours[d] ?? []).map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input type="time" aria-label={`${n}: с`} value={s[0]} onChange={(e) => setSlot(d, i, 0, e.target.value)} className="rounded-lg px-2 py-1 text-xs" style={field} />–
                  <input type="time" aria-label={`${n}: до`} value={s[1]} onChange={(e) => setSlot(d, i, 1, e.target.value)} className="rounded-lg px-2 py-1 text-xs" style={field} />
                  <button type="button" aria-label="Убрать интервал" onClick={() => setHours((h) => ({ ...h, [d]: (h[d] ?? []).filter((_, j) => j !== i) }))}><Trash2 size={12} /></button>
                </span>
              ))}
              {(hours[d]?.length ?? 0) === 0 && <span className="text-xs" style={{ color: 'var(--t3)' }}>выходной</span>}
              {(hours[d]?.length ?? 0) < 3 && <button type="button" aria-label="Добавить интервал" onClick={() => setHours((h) => ({ ...h, [d]: [...(h[d] ?? []), ['09:00', '18:00'] as [string, string]] }))}><Plus size={14} /></button>}
            </div>
          ))}
          <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>Если часы не заданы, статус «Открыто/Закрыто» не показывается. Интервал через полночь (22:00–02:00) поддерживается.</p>
        </div>

        <div className="rounded-2xl p-4" style={card}>
          <p className="mb-2 text-sm font-black" style={{ color: 'var(--t1)' }}>Фотографии</p>
          <div className="flex flex-wrap gap-2">
            {p.photos.map((u) => <OwnerPhoto key={u} url={u} onDel={() => void run(() => gpOwner.delPhoto(photoId(u)), (d) => setP((x) => (x ? { ...x, photos: d.photos } : x)))} />)}
            {p.photos.length < 10 && <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-xl" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}><ImagePlus size={20} />
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void photo(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>PNG, JPEG или WebP. Позиции каталога (товары и услуги) добавляются во вкладке «Каталог».</p>
        </div>

        {p.missing.length > 0 && <div className="rounded-2xl p-3 text-xs" style={{ ...card, color: 'var(--t2)' }}><p className="font-bold">Чтобы отправить на проверку:</p><ul className="ml-4 list-disc">{p.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
        <div className="flex gap-2">
          <Btn tone="accent" disabled={busy} onClick={() => void save()}>Сохранить</Btn>
          <Btn disabled={busy || !p.canSubmit || p.status === 'pending' || p.status === 'published'} onClick={() => void run(() => gpOwner.submit(), (d) => { fill((d as { place: GpOwnerPlace }).place); flash('Отправлено на проверку'); })}><Send size={13} className="mr-1 inline" />Отправить на проверку</Btn>
        </div>
      </>}
    </div>
  );
};

const TABS = [['card', 'Карточка'], ['book', 'Записи'], ['sched', 'Расписание'], ['rev', 'Отзывы'], ['stat', 'Статистика']] as const;
export const GoPlace = () => {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('card');
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(([k, n]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold" style={tab === k ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t2)' }}>{n}</button>)}
      </div>
      {tab === 'card' && <GoPlaceCard />}{tab === 'book' && <Bookings />}{tab === 'sched' && <Schedule />}{tab === 'rev' && <OwnerReviews />}{tab === 'stat' && <PlaceStats />}
    </div>
  );
};
