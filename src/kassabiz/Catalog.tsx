/* SkyKassa Business, этап 2: товары и услуги, витрина (на Sky и на своём сервере), заказы, чаевые, счета.
   Цены и суммы считает сервер; здесь они только показываются. Оплата — всегда прямым переводом владельцу, «оплачено» ставит владелец. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Copy, Download, Printer, ImagePlus, Trash2, ExternalLink } from 'lucide-react';
import { flash } from '@/shared/flash';
import { uploadUrl } from '@/core/auth/api';
import * as K from './api';
import { qrSvg, downloadPng, downloadSvg, printQr } from './qr';
import { card, field, why, dt, Btn, In } from './ui';

const toDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read')); r.readAsDataURL(f); });
const copy = (t: string) => { void navigator.clipboard?.writeText(t).then(() => flash('Скопировано')); };
const Wait = () => <div className="grid place-items-center py-10"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--t3)' }} /></div>;

/* ── Товары и услуги ── */
const ItemForm = ({ item, onDone }: { item: K.Item | null; onDone: () => void }) => {
  const [f, setF] = useState({ title: item?.title ?? '', description: item?.description ?? '', priceRub: String(item?.priceRub ?? ''), category: item?.category ?? '', leadTime: item?.leadTime ?? '', available: item?.available ?? true, kind: (item?.kind ?? 'product') as 'product' | 'service', stock: item?.stock != null ? String(item.stock) : '', durationMin: item?.durationMin != null ? String(item.durationMin) : '', capacity: String(item?.capacity ?? 1) });
  const [vars, setVars] = useState<{ name: string; priceRub: string }[]>((item?.variants ?? []).map((v) => ({ name: v.name, priceRub: v.priceRub ? String(v.priceRub) : '' })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await K.kbItemSave(item?.id ?? null, { ...f, stock: f.kind === 'service' || f.stock === '' ? null : Number(f.stock), durationMin: f.kind === 'service' && f.durationMin ? Number(f.durationMin) : null, capacity: Number(f.capacity) || 1, priceRub: Number(f.priceRub), variants: vars.filter((v) => v.name.trim()).map((v) => ({ name: v.name, priceRub: v.priceRub ? Number(v.priceRub) : undefined })) });
    setBusy(false);
    if (!r.ok) { flash(why(r)); return; }
    onDone();
  };
  const photo = async (file?: File) => {
    if (!file || !item) return;
    if (file.size > 300 * 1024) { flash('Фото не больше 300 КБ.'); return; }
    const r = await K.kbItemPhoto(item.id, await toDataUrl(file)); flash(r.ok ? 'Фото загружено' : why(r)); if (r.ok) onDone();
  };
  return (
    <div className="rounded-2xl p-4 space-y-2" style={card}>
      <In label="Название" value={f.title} onChange={(v) => setF({ ...f, title: v })} max={120} />
      <In label="Описание" value={f.description} onChange={(v) => setF({ ...f, description: v })} max={1000} />
      <div className="grid grid-cols-2 gap-2">
        <In label="Цена, ₽" value={f.priceRub} onChange={(v) => setF({ ...f, priceRub: v.replace(/\D/g, '').slice(0, 7) })} />
        <In label="Категория" value={f.category} onChange={(v) => setF({ ...f, category: v })} max={60} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Тип
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'product' | 'service' })} className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm outline-none" style={field}><option value="product">Товар</option><option value="service">Услуга</option></select>
        </label>
        {f.kind === 'service' && <In label="Длительность, мин (для записи)" value={f.durationMin} onChange={(v) => setF({ ...f, durationMin: v.replace(/\D/g, '').slice(0, 4) })} />}
        {f.kind === 'service' && <In label="Одновременно клиентов" value={f.capacity} onChange={(v) => setF({ ...f, capacity: v.replace(/\D/g, '').slice(0, 3) })} />}
        {f.kind === 'product' && <In label="Остаток (пусто — без учёта)" value={f.stock} onChange={(v) => setF({ ...f, stock: v.replace(/\D/g, '').slice(0, 7) })} />}
      </div>
      <In label="Срок выполнения / изготовления" value={f.leadTime} onChange={(v) => setF({ ...f, leadTime: v })} max={60} />
      <div>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Варианты (размер, цвет…) — цена по желанию, иначе общая</p>
        {vars.map((v, i) => (
          <div key={i} className="mt-1 flex gap-1.5">
            <input aria-label="Вариант" value={v.name} maxLength={60} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={field} placeholder="Название варианта" />
            <input aria-label="Цена варианта" inputMode="numeric" value={v.priceRub} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, priceRub: e.target.value.replace(/\D/g, '').slice(0, 7) } : x)))} className="w-24 rounded-lg px-3 py-2 text-sm outline-none" style={field} placeholder="₽" />
            <Btn small onClick={() => setVars(vars.filter((_, j) => j !== i))}><Trash2 size={12} /></Btn>
          </div>
        ))}
        {vars.length < 20 && <div className="mt-1.5"><Btn small onClick={() => setVars([...vars, { name: '', priceRub: '' }])}><Plus size={12} className="inline" /> Вариант</Btn></div>}
      </div>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} /> В наличии (показывать на витрине)</label>
      {item && <label className="block text-[11px]" style={{ color: 'var(--t3)' }}><ImagePlus size={12} className="inline" /> Фото (PNG, JPEG, WebP до 300 КБ)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void photo(e.target.files?.[0])} className="mt-1 block text-xs" /></label>}
      <div className="flex gap-2 pt-1"><Btn tone="accent" disabled={busy} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</Btn><Btn onClick={onDone}>Закрыть</Btn></div>
    </div>
  );
};

export const Items = () => {
  const [list, setList] = useState<K.Item[] | null>(null); const [edit, setEdit] = useState<K.Item | 'new' | null>(null);
  const load = useCallback(async () => { const r = await K.kbItems(); if (r.ok) setList(r.data.items); }, []);
  useEffect(() => { void load(); }, [load]);
  const remove = async (i: K.Item) => { if (!window.confirm(`Убрать «${i.title}» в архив? С витрины позиция исчезнет.`)) return; const r = await K.kbItemDelete(i.id); if (!r.ok) flash(why(r)); void load(); };
  if (!list) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Товары и услуги</p><Btn small tone="accent" onClick={() => setEdit('new')}><Plus size={12} className="inline" /> Добавить</Btn></div>
      {edit && <ItemForm key={edit === 'new' ? 'new' : edit.id} item={edit === 'new' ? null : edit} onDone={() => { setEdit(null); void load(); }} />}
      {!list.length && !edit && <p className="text-sm" style={{ color: 'var(--t3)' }}>Позиций пока нет. Добавьте первую — она появится на витрине.</p>}
      {list.map((i) => (
        <div key={i.id} className="rounded-2xl p-3 flex gap-3" style={card}>
          {i.photoUrl ? <img src={uploadUrl(i.photoUrl)} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-lg" style={{ background: 'var(--bg-l2)' }} />}
          <div className="min-w-0 flex-1">
            <p translate="no" className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{i.title}</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>{i.priceRub} ₽{i.variants.length ? ` · вариантов: ${i.variants.length}` : ''}{i.category ? ` · ${i.category}` : ''}{i.available ? '' : ' · скрыто'}</p>
            <div className="mt-1.5 flex gap-1.5"><Btn small onClick={() => setEdit(i)}>Изменить</Btn><Btn small tone="danger" onClick={() => void remove(i)}>В архив</Btn></div>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Витрина ── */
export const ShopSettings = () => {
  const [shop, setShop] = useState<K.Shop | null | undefined>(undefined);
  const [f, setF] = useState({ slug: '', enabled: false, origins: '', notice: '' }); const [busy, setBusy] = useState(false); const [api, setApi] = useState('');
  const load = useCallback(async () => { const r = await K.kbShop(); if (r.ok) { setShop(r.data.shop); const s = r.data.shop; if (s) setF({ slug: s.slug ?? '', enabled: s.enabled, origins: s.origins.join('\n'), notice: s.notice }); } }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setBusy(true); const r = await K.kbShopSave({ slug: f.slug.trim().toLowerCase(), enabled: f.enabled, origins: f.origins.split(/[\s,]+/).filter(Boolean), notice: f.notice }); setBusy(false);
    if (!r.ok) { flash(r.field === 'slug' ? 'Адрес: 3–40 знаков, латиница, цифры и дефис.' : r.field === 'origins' ? 'Сайты — только https://адрес, без пути.' : why(r)); return; }
    flash('Сохранено'); void load();
  };
  const pack = async () => {
    const b = await K.kbShopPackage(api.trim() || undefined); if (!b) { flash('Не удалось подготовить пакет. Сначала сохраните адрес витрины.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'sky-shop.tar.gz'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  if (shop === undefined) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4 space-y-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Сайт каталога на Sky</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Витрина открывается по адресу вида <span translate="no">…/s/ваш-адрес</span>: покупатели видят товары, собирают корзину, оформляют заказ и переходят к оплате по вашим реквизитам. Нужны действующая подписка и реквизиты.</p>
        <In label="Адрес витрины (латиница, цифры, дефис)" value={f.slug} onChange={(v) => setF({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') })} max={40} ph="my-shop" />
        <In label="Объявление над каталогом (необязательно)" value={f.notice} onChange={(v) => setF({ ...f, notice: v })} max={300} />
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Витрина включена</label>
        <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Свои сайты, где показывается витрина (по одному в строке, https://…)
          <textarea value={f.origins} onChange={(e) => setF({ ...f, origins: e.target.value })} rows={2} placeholder="https://shop.example.ru" className="mt-0.5 block w-full rounded-lg px-3 py-2 text-sm outline-none" style={field} /></label>
        <div className="flex flex-wrap gap-2"><Btn tone="accent" disabled={busy || f.slug.length < 3} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить'}</Btn>
          {shop?.url && shop.enabled && <Btn onClick={() => window.open(shop.url!, '_blank', 'noopener')}><ExternalLink size={13} className="inline" /> Открыть витрину</Btn>}
          {shop?.url && <Btn onClick={() => copy(shop.url!)}><Copy size={13} className="inline" /> Ссылка</Btn>}</div>
        {shop?.url && <p translate="no" className="text-[11px] break-all" style={{ color: 'var(--t3)' }}>{shop.url}</p>}
      </div>
      <div className="rounded-2xl p-4 space-y-2" style={card}>
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Сайт каталога на своём сервере (VPS)</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Те же страницы можно поставить на свой домен: скачайте пакет (4 файла и инструкция), положите на сервер, добавьте адрес сайта в список выше. Каталог, цены и заказы по-прежнему хранятся у Sky — на вашем сервере только сам сайт. Пакет не содержит ни реквизитов, ни ключей.</p>
        <In label="Адрес Sky для сайта (необязательно, по умолчанию наш)" value={api} onChange={setApi} ph="https://" max={200} />
        <Btn disabled={!shop?.slug} onClick={() => void pack()}><Download size={13} className="inline" /> Скачать пакет для VPS</Btn>
      </div>
    </div>
  );
};

/* ── Заказы ── */
const ORD_FILTERS: [string, string][] = [['', 'Все'], ['new', 'Новые'], ['confirmed', 'Подтверждены'], ['in_progress', 'В работе'], ['ready', 'Готовы'], ['done', 'Выполнены'], ['rejected', 'Отклонены'], ['cancelled', 'Отменены']];
export const Orders = () => {
  const [st, setSt] = useState(''); const [list, setList] = useState<K.Order[] | null>(null);
  const load = useCallback(async () => { const r = await K.kbOrders(st || undefined); if (r.ok) setList(r.data.orders); }, [st]);
  useEffect(() => { void load(); }, [load]);
  const act = async (o: K.Order, a: string, ask = false) => {
    let comment: string | undefined;
    if (ask) { comment = window.prompt('Причина (видна покупателю не будет, нужна для журнала):') ?? undefined; if (!comment) return; }
    const r = await K.kbOrderAct(o.id, a, comment); if (!r.ok) flash(why(r)); void load();
  };
  if (!list) return <Wait />;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>{ORD_FILTERS.map(([k, l]) => <button key={k} type="button" onClick={() => setSt(k)} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ ...field, ...(st === k ? { border: '1px solid var(--accent)' } : {}) }}>{l}</button>)}</div>
      {!list.length && <p className="text-sm" style={{ color: 'var(--t3)' }}>Заказов нет.</p>}
      {list.map((o) => (
        <div key={o.id} className="rounded-2xl p-3" style={card}>
          <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Заказ № {o.number} · {o.totalRub} ₽</p><span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{o.statusLabel}</span></div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{dt(o.createdAt)}{o.paymentStatus ? ` · оплата: ${({ reported: 'покупатель сообщил', pending_check: 'на проверке', confirmed: 'подтверждена владельцем', not_found: 'не обнаружена', created: 'не начата' } as Record<string, string>)[o.paymentStatus] ?? o.paymentStatus}` : ' · оплата не начата'}</p>
          <ul className="mt-1.5 text-xs" style={{ color: 'var(--t2)' }}>{o.lines.map((l, i) => <li key={i} translate="no">{l.title}{l.variant ? ` (${l.variant})` : ''} × {l.qty} — {l.qty * l.priceRub} ₽</li>)}</ul>
          <p translate="no" className="mt-1.5 text-xs" style={{ color: 'var(--t2)' }}>{o.contact.name} · {o.contact.phone}{o.contact.email ? ` · ${o.contact.email}` : ''}{o.contact.address ? ` · ${o.contact.address}` : ''}</p>
          {o.note && <p translate="no" className="text-xs" style={{ color: 'var(--t3)' }}>«{o.note}»</p>}
          {o.ownerComment && <p translate="no" className="text-[11px]" style={{ color: 'var(--t3)' }}>Комментарий: {o.ownerComment}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.status === 'new' && <><Btn small tone="accent" onClick={() => void act(o, 'confirm')}>Подтвердить</Btn><Btn small tone="danger" onClick={() => void act(o, 'reject', true)}>Отклонить</Btn></>}
            {o.status === 'confirmed' && <Btn small onClick={() => void act(o, 'progress')}>В работу</Btn>}
            {(o.status === 'confirmed' || o.status === 'in_progress') && <Btn small onClick={() => void act(o, 'ready')}>Готов</Btn>}
            {['confirmed', 'in_progress', 'ready'].includes(o.status) && <Btn small tone="accent" onClick={() => void act(o, 'done')}>Выполнен</Btn>}
            {['new', 'confirmed', 'in_progress', 'ready'].includes(o.status) && o.status !== 'new' && <Btn small tone="danger" onClick={() => void act(o, 'cancel', true)}>Отменить</Btn>}
            {['new', 'confirmed', 'in_progress', 'ready'].includes(o.status) && o.payExpired && <Btn small onClick={async () => { const r = await K.kbOrderRenewPay(o.id); flash(r.ok ? 'Новая ссылка на оплату создана' : why(r)); void load(); }}>Новая ссылка на оплату</Btn>}
            {o.payUrl && <Btn small onClick={() => copy(o.payUrl!)}><Copy size={12} className="inline" /> Ссылка на оплату</Btn>}
            <Btn small onClick={async () => { const r = await K.kbOrderInvoice(o.id); flash(r.ok ? `Черновик счёта № ${r.data.number} создан — во вкладке «Счета»` : why(r)); }}>Счёт из заказа</Btn>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ── Чаевые ── */
const TipQr = ({ t, bizName }: { t: K.Tip; bizName: string }) => {
  const [svg, setSvg] = useState('');
  useEffect(() => { let a = true; void qrSvg(t.url, 200).then((s) => { if (a) setSvg(s); }); return () => { a = false; }; }, [t.url]);
  return (
    <div className="rounded-2xl p-3 flex gap-3" style={card}>
      <div className="shrink-0 rounded-lg overflow-hidden self-start" style={{ width: 104, height: 104 }} dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="104" height="104"') }} />
      <div className="min-w-0 flex-1">
        <p translate="no" className="text-sm font-bold truncate" style={{ color: 'var(--t1)' }}>{t.recipient}</p>
        <p className="text-xs" style={{ color: 'var(--t3)' }}>Суммы: {t.amounts.join(' / ')} ₽{t.allowCustom ? ' · своя сумма' : ''} · {t.min}–{t.max} ₽</p>
        <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Открытий: {t.opens} · заявок: {t.requests} · подтверждено: {t.confirmed} ({t.confirmedSumRub} ₽)</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Btn small onClick={() => copy(t.url)}><Copy size={12} className="inline" /> Ссылка</Btn>
          <Btn small onClick={() => void downloadPng(t.url, `skykassa-tip-${t.publicId}`)}><Download size={12} className="inline" /> PNG</Btn>
          <Btn small onClick={() => void downloadSvg(t.url, `skykassa-tip-${t.publicId}`)}>SVG</Btn>
          <Btn small onClick={() => void printQr(t.url, bizName, `Чаевые: ${t.recipient} — наведите камеру`)}><Printer size={12} className="inline" /> Печать</Btn>
        </div>
      </div>
    </div>
  );
};
export const Tips = ({ bizName }: { bizName: string }) => {
  const [d, setD] = useState<{ tips: K.Tip[]; stats: K.TipStats | null } | null>(null); const [form, setForm] = useState(false);
  const [f, setF] = useState({ recipient: '', message: '', amounts: '50, 100, 200', min: '10', max: '50000', allowCustom: true }); const [photo, setPhoto] = useState('');
  const load = useCallback(async () => { const r = await K.kbTips(); if (r.ok) setD(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    const r = await K.kbTipCreate({ recipient: f.recipient, message: f.message, amounts: f.amounts.split(/[\s,]+/).filter(Boolean).map(Number), min: Number(f.min), max: Number(f.max), allowCustom: f.allowCustom, photo: photo || undefined });
    if (!r.ok) { flash(why(r)); return; }
    setForm(false); setPhoto(''); void load();
  };
  if (!d) return <Wait />;
  const s = d.stats;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Чаевые</p><Btn small tone="accent" onClick={() => setForm(true)}><Plus size={12} className="inline" /> Страница чаевых</Btn></div>
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Гость сканирует QR и переводит чаевые напрямую вам по реквизитам. Sky комиссию не берёт и перевод не проверяет — вы сами подтверждаете поступление во вкладке «Приём оплаты».</p>
      {form && (
        <div className="rounded-2xl p-4 space-y-2" style={card}>
          <In label="Кому (имя сотрудника или «Команде»)" value={f.recipient} onChange={(v) => setF({ ...f, recipient: v })} max={60} />
          <In label="Сообщение гостю (необязательно)" value={f.message} onChange={(v) => setF({ ...f, message: v })} max={200} />
          <In label="Быстрые суммы, ₽ (до 6, через запятую)" value={f.amounts} onChange={(v) => setF({ ...f, amounts: v })} max={60} />
          <div className="grid grid-cols-2 gap-2"><In label="Минимум, ₽" value={f.min} onChange={(v) => setF({ ...f, min: v.replace(/\D/g, '') })} max={6} /><In label="Максимум, ₽" value={f.max} onChange={(v) => setF({ ...f, max: v.replace(/\D/g, '') })} max={7} /></div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={f.allowCustom} onChange={(e) => setF({ ...f, allowCustom: e.target.checked })} /> Можно ввести свою сумму</label>
          <label className="block text-[11px]" style={{ color: 'var(--t3)' }}>Фото получателя (необязательно, до 300 КБ)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 300 * 1024) { flash('Фото не больше 300 КБ.'); return; } setPhoto(await toDataUrl(file)); }} className="mt-1 block text-xs" /></label>
          <div className="flex gap-2"><Btn tone="accent" onClick={() => void create()}>Создать</Btn><Btn onClick={() => setForm(false)}>Отмена</Btn></div>
        </div>
      )}
      {s && <div className="grid grid-cols-3 gap-2">{[['Заявок', s.requests], ['Подтверждено', s.confirmed], ['Сумма, ₽', s.confirmedSumRub]].map(([k, v]) => <div key={String(k)} className="rounded-2xl p-3" style={card}><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{k}</p><p className="text-lg font-black" style={{ color: 'var(--t1)' }}>{v}</p></div>)}</div>}
      {s && s.confirmed > 0 && <p className="text-xs" style={{ color: 'var(--t3)' }}>Средние чаевые: {s.averageRub} ₽. Считаются только подтверждённые вами.</p>}
      {!d.tips.length && !form && <p className="text-sm" style={{ color: 'var(--t3)' }}>Страниц чаевых пока нет.</p>}
      {d.tips.map((t) => <TipQr key={t.id} t={t} bizName={bizName} />)}
    </div>
  );
};

/* ── Счета ── */
interface DraftLine { title: string; qty: string; priceRub: string; discountRub: string }
const emptyLine = (): DraftLine => ({ title: '', qty: '1', priceRub: '', discountRub: '' });
const InvoiceForm = ({ onDone }: { onDone: () => void }) => {
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]); const [f, setF] = useState({ discountRub: '', orderNo: '', comment: '', dueAt: '' }); const [busy, setBusy] = useState(false);
  const num = (v: string) => Number(v) || 0;
  const sub = lines.reduce((a, l) => a + Math.max(0, num(l.qty) * num(l.priceRub) - num(l.discountRub)), 0);
  const save = async () => {
    setBusy(true);
    const r = await K.kbInvoiceSave(null, { lines: lines.filter((l) => l.title.trim()).map((l) => ({ title: l.title, qty: num(l.qty), priceRub: num(l.priceRub), discountRub: num(l.discountRub) })), discountRub: num(f.discountRub), orderNo: f.orderNo, comment: f.comment, dueAt: f.dueAt || undefined });
    setBusy(false);
    if (!r.ok) { flash(r.field === 'dueAt' ? 'Срок оплаты должен быть в будущем.' : r.field === 'discountRub' ? 'Скидка больше суммы счёта.' : why(r)); return; }
    onDone();
  };
  const setL = (i: number, k: keyof DraftLine, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: k === 'title' ? v : v.replace(/\D/g, '') } : l)));
  return (
    <div className="rounded-2xl p-4 space-y-2" style={card}>
      <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Новый счёт</p>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_52px_84px_72px_auto] gap-1.5 items-center">
          <input aria-label="Позиция" value={l.title} maxLength={120} onChange={(e) => setL(i, 'title', e.target.value)} placeholder="Позиция" className="min-w-0 rounded-lg px-2 py-2 text-sm outline-none" style={field} />
          <input aria-label="Количество" inputMode="numeric" value={l.qty} onChange={(e) => setL(i, 'qty', e.target.value)} className="rounded-lg px-2 py-2 text-sm outline-none" style={field} />
          <input aria-label="Цена" inputMode="numeric" value={l.priceRub} onChange={(e) => setL(i, 'priceRub', e.target.value)} placeholder="Цена ₽" className="rounded-lg px-2 py-2 text-sm outline-none" style={field} />
          <input aria-label="Скидка" inputMode="numeric" value={l.discountRub} onChange={(e) => setL(i, 'discountRub', e.target.value)} placeholder="Скидка" className="rounded-lg px-2 py-2 text-sm outline-none" style={field} />
          <Btn small onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [emptyLine()])}><Trash2 size={12} /></Btn>
        </div>
      ))}
      {lines.length < 50 && <Btn small onClick={() => setLines([...lines, emptyLine()])}><Plus size={12} className="inline" /> Строка</Btn>}
      <div className="grid grid-cols-2 gap-2"><In label="Общая скидка, ₽" value={f.discountRub} onChange={(v) => setF({ ...f, discountRub: v.replace(/\D/g, '') })} max={7} /><In label="Номер заказа / договора" value={f.orderNo} onChange={(v) => setF({ ...f, orderNo: v })} max={40} /></div>
      <In label="Оплатить до (необязательно)" type="date" value={f.dueAt} onChange={(v) => setF({ ...f, dueAt: v })} />
      <In label="Комментарий для клиента" value={f.comment} onChange={(v) => setF({ ...f, comment: v })} max={300} />
      <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Итого: {Math.max(0, sub - num(f.discountRub))} ₽ <span className="text-[11px] font-normal" style={{ color: 'var(--t3)' }}>(сервер пересчитает при сохранении)</span></p>
      <div className="flex gap-2"><Btn tone="accent" disabled={busy} onClick={() => void save()}>{busy ? 'Сохраняю…' : 'Сохранить черновик'}</Btn><Btn onClick={onDone}>Отмена</Btn></div>
    </div>
  );
};
export const Invoices = ({ bizName }: { bizName: string }) => {
  const [list, setList] = useState<K.Invoice[] | null>(null); const [form, setForm] = useState(false);
  const load = useCallback(async () => { const r = await K.kbInvoices(); if (r.ok) setList(r.data.invoices); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!list) return <Wait />;
  const send = async (i: K.Invoice) => { const r = await K.kbInvoiceSend(i.id); if (!r.ok) flash(why(r)); else copy(r.data.url); void load(); };
  const cancel = async (i: K.Invoice) => { if (!window.confirm(`Отменить счёт № ${i.number}? Страница оплаты закроется.`)) return; const r = await K.kbInvoiceCancel(i.id); if (!r.ok) flash(r.error === 'bad_state' ? 'Оплаченный счёт отменить нельзя — оформите возврат по заявке.' : why(r)); void load(); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Счета</p><Btn small tone="accent" onClick={() => setForm(true)}><Plus size={12} className="inline" /> Новый счёт</Btn></div>
      {form && <InvoiceForm onDone={() => { setForm(false); void load(); }} />}
      {!list.length && !form && <p className="text-sm" style={{ color: 'var(--t3)' }}>Счетов пока нет.</p>}
      {list.map((i) => (
        <div key={i.id} className="rounded-2xl p-3" style={card}>
          <div className="flex items-start justify-between gap-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Счёт № {i.number} · {i.totalRub} ₽</p><span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>{i.statusLabel}</span></div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{dt(i.createdAt)}{i.dueAt ? ` · оплатить до ${dt(i.dueAt)}` : ''}{i.orderNo ? ` · заказ ${i.orderNo}` : ''}{i.discountRub ? ` · скидка ${i.discountRub} ₽` : ''}</p>
          <ul className="mt-1 text-xs" style={{ color: 'var(--t2)' }}>{i.lines.map((l, k) => <li key={k} translate="no">{l.title} × {l.qty} — {l.qty * l.priceRub - (l.discountRub ?? 0)} ₽</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {i.status === 'draft' && <Btn small tone="accent" onClick={() => void send(i)}>Отправить (скопировать ссылку)</Btn>}
            {i.url && <Btn small onClick={() => copy(i.url!)}><Copy size={12} className="inline" /> Ссылка</Btn>}
            {i.url && <Btn small onClick={() => void printQr(i.url!, bizName, `Счёт № ${i.number} — наведите камеру для оплаты`)}><Printer size={12} className="inline" /> QR</Btn>}
            {!['confirmed', 'cancelled'].includes(i.status) && <Btn small tone="danger" onClick={() => void cancel(i)}>Отменить</Btn>}
          </div>
        </div>
      ))}
    </div>
  );
};
