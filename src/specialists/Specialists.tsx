/**
 * Sky Marketplace — биржа специалистов (вкладка «Специалисты» в Студии): каталог с фильтрами, анкета, портфолио, предложения и обсуждение условий,
 * свои заказы, кабинет специалиста. Денег здесь нет: «бюджет» — справочная цифра, оплата вне биржи (рекомендуем сделку Sky Garant). Сервер: server/specialists.mjs.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Flag, Search } from 'lucide-react';
import { StoryImg } from '@/stories/StoryMedia';
import { SkyLoader } from '@/shared/SkyLoader';
import { flash } from '@/shared/flash';
import * as A from './api';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'plain' | 'red' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-2xl px-4 py-2 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
  <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
    className="min-w-0 rounded-[22px] p-4" style={{ background: C.l1, border: `1px solid ${C.brd}`, cursor: onClick ? 'pointer' : undefined }}>{children}</div>
);
const In = ({ label, value, onChange, area = false, ph = '' }: { label: string; value: unknown; onChange: (v: string) => void; area?: boolean; ph?: string }) => (
  <label className="block min-w-0 text-[11px]" style={{ color: C.t3 }}>{label}
    {area ? <textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={4} placeholder={ph} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field} />
      : <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field} />}
  </label>
);
const Pill = ({ children, tone }: { children: ReactNode; tone?: string }) => <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: C.l2, color: tone ?? C.t2 }}>{children}</span>;
const availTone = (a: string) => (a === 'open' ? C.green : a === 'busy' ? '#f59e0b' : C.red);

/* ─── Каталог ─── */
const Catalog = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const [f, setF] = useState({ category: '', spec: '', service: '', workType: '', availability: '', q: '' });
  const [list, setList] = useState<A.Spec[] | null>(null);
  const load = useCallback(async () => { const r = await A.apiSearch(f); setList(r.ok ? r.data?.specialists ?? [] : []); }, [f]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const sel = (k: keyof typeof f, opts: Record<string, string>, any: string) => (
    <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="min-w-0 rounded-xl px-2 py-2 text-xs" style={field} aria-label={any}>
      <option value="">{any}</option>{Object.entries(opts).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={field}><Search size={14} style={{ color: C.t3 }} />
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Имя или описание" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sel('category', A.CATEGORY, 'Все специализации')}{sel('workType', A.WORK, 'Любой тип работы')}{sel('availability', A.AVAIL, 'Любая доступность')}
        <input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="Услуга" className="min-w-0 rounded-xl px-2 py-2 text-xs" style={field} />
      </div>
      {!list ? <SkyLoader /> : list.length === 0 ? <p className="text-sm" style={{ color: C.t3 }}>Подходящих специалистов пока нет.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">{list.map((s) => (
          <Card key={s.id} onClick={() => onOpen(s.id)}>
            <div className="flex gap-3">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl" style={{ background: C.l2 }}>{s.hasPhoto && <StoryImg src={`/api/specialists/${s.id}/photo`} className="h-full w-full object-cover" />}</div>
              <div className="min-w-0"><p translate="no" className="truncate text-sm font-bold" style={{ color: C.t1 }}>{s.displayName}</p>
                <p className="text-[11px]" style={{ color: C.t3 }}>{A.CATEGORY[s.category]}</p>
                <Pill tone={availTone(s.availability)}>{A.AVAIL[s.availability]}</Pill></div>
            </div>
            {s.headline && <p translate="no" className="mt-2 line-clamp-2 text-xs" style={{ color: C.t2 }}>{s.headline}</p>}
          </Card>))}</div>)}
    </div>
  );
};

/* ─── Профиль специалиста и предложение ─── */
const OfferForm = ({ s, onDone }: { s: A.Spec; onDone: () => void }) => {
  const [f, setF] = useState({ kind: s.workTypes[0] ?? 'one_time', title: '', brief: '', budgetRub: '', deadline: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); const r = await A.apiSendOffer({ specialistId: s.id, ...f, budgetRub: f.budgetRub === '' ? null : Number(f.budgetRub), deadline: f.deadline || null }); setBusy(false);
    if (!r.ok || r.data?.error) { flash(A.errText(r.data?.error ?? r.error, r.data)); return; } flash('Предложение отправлено'); onDone();
  };
  return (
    <Card>
      <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Отправить предложение</p>
      <div className="space-y-2">
        <label className="block text-[11px]" style={{ color: C.t3 }}>Формат
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field}>{s.workTypes.map((w) => <option key={w} value={w}>{A.WORK[w]}</option>)}</select></label>
        <In label="Название задачи" value={f.title} onChange={(v) => setF({ ...f, title: v })} />
        <In label="Опишите задачу (от 20 знаков)" value={f.brief} onChange={(v) => setF({ ...f, brief: v })} area />
        <div className="grid grid-cols-2 gap-2"><In label="Предлагаемый бюджет, ₽ (необязательно)" value={f.budgetRub} onChange={(v) => setF({ ...f, budgetRub: v.replace(/\D/g, '') })} /><In label="Срок (ГГГГ-ММ-ДД)" value={f.deadline} onChange={(v) => setF({ ...f, deadline: v })} /></div>
        <p className="text-[11px]" style={{ color: C.t3 }}>Бюджет — справочная цифра: Sky не принимает и не удерживает оплату за работу. Для безопасной оплаты стороны могут оформить сделку Sky Garant.</p>
        <Btn disabled={busy || f.title.length < 3 || f.brief.length < 20} onClick={() => void send()}>Отправить</Btn>
      </div>
    </Card>
  );
};

const Profile = ({ id, onBack, onOffer }: { id: string; onBack: () => void; onOffer: () => void }) => {
  const [s, setS] = useState<A.Spec | null | undefined>();
  const [reason, setReason] = useState(''); const [showForm, setShowForm] = useState(false);
  useEffect(() => { void A.apiSpecialist(id).then((r) => setS(r.ok ? r.data?.specialist ?? null : null)); }, [id]);
  if (s === undefined) return <SkyLoader />;
  if (!s) return <div><Btn tone="plain" onClick={onBack}>Назад</Btn><p className="mt-3 text-sm" style={{ color: C.t3 }}>Анкета недоступна.</p></div>;
  const report = async () => {
    const r = await A.apiReport({ targetType: 'profile', targetId: s.id, reason, details: '' });
    flash(r.ok && !r.data?.error ? 'Жалоба отправлена' : A.errText(r.data?.error ?? r.error)); if (r.ok && !r.data?.error) setReason('');
  };
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs font-bold" style={{ color: C.acc }}><ArrowLeft size={14} />К каталогу</button>
      <Card>
        <div className="flex gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-3xl" style={{ background: C.l2 }}>{s.hasPhoto && <StoryImg src={`/api/specialists/${s.id}/photo`} className="h-full w-full object-cover" />}</div>
          <div className="min-w-0"><p translate="no" className="text-base font-bold" style={{ color: C.t1 }}>{s.displayName}</p>
            <p className="text-xs" style={{ color: C.t3 }}>{A.CATEGORY[s.category]}</p>
            <div className="mt-1 flex flex-wrap gap-1"><Pill tone={availTone(s.availability)}>{A.AVAIL[s.availability]}</Pill>{s.workTypes.map((w) => <Pill key={w}>{A.WORK[w]}</Pill>)}</div>
            {s.availabilityNote && <p translate="no" className="mt-1 text-[11px]" style={{ color: C.t3 }}>{s.availabilityNote}</p>}</div>
        </div>
        <p translate="no" className="mt-3 whitespace-pre-line text-sm" style={{ color: C.t2 }}>{s.description}</p>
        <div className="mt-2 flex flex-wrap gap-1">{s.specializations.map((x) => <Pill key={x}><span translate="no">{x}</span></Pill>)}</div>
      </Card>
      <Card><p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Услуги</p>
        {s.services.map((v, i) => <div key={i} className="flex items-baseline justify-between gap-2 py-1 text-sm" style={{ color: C.t2 }}><span translate="no" className="min-w-0">{v.title}{v.note ? ` — ${v.note}` : ''}</span><span className="shrink-0 text-xs" style={{ color: C.t3 }}>{v.priceFrom ? `от ${v.priceFrom.toLocaleString('ru-RU')} ₽` : 'по договорённости'}</span></div>)}</Card>
      <Card><p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Портфолио</p>
        <div className="grid gap-3 sm:grid-cols-2">{(s.portfolio ?? []).map((w) => (
          <div key={w.id} className="overflow-hidden rounded-2xl" style={{ background: C.l2 }}>
            {w.hasImage && <StoryImg src={`/api/specialists/work/${w.id}/image`} className="h-36 w-full object-cover" />}
            <div className="p-3"><p translate="no" className="text-sm font-bold" style={{ color: C.t1 }}>{w.title}</p>{w.description && <p translate="no" className="text-xs" style={{ color: C.t3 }}>{w.description}</p>}
              {w.url && <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold" style={{ color: C.acc }}>Открыть пример</a>}</div>
          </div>))}</div>
        <p className="mt-2 text-[11px]" style={{ color: C.t3 }}>Sky проверяет анкету вручную, но не проверяет авторство работ.</p></Card>
      {!s.isMine && (showForm
        ? <OfferForm s={s} onDone={onOffer} />
        : <Btn disabled={s.availability === 'closed'} onClick={() => setShowForm(true)}>{s.availability === 'closed' ? 'Не принимает заказы' : 'Отправить предложение'}</Btn>)}
      {!s.isMine && <div className="flex flex-wrap items-center gap-2"><Flag size={13} style={{ color: C.t3 }} />
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl px-2 py-1.5 text-xs" style={field} aria-label="Причина жалобы"><option value="">Пожаловаться…</option>
          {Object.entries({ fraud: 'Мошенничество', spam: 'Спам', abuse: 'Оскорбления', fake_portfolio: 'Чужие работы в портфолио', illegal: 'Запрещённый контент', other: 'Другое' }).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <Btn tone="plain" disabled={!reason} onClick={() => void report()}>Отправить</Btn></div>}
    </div>
  );
};

/* ─── Предложения ─── */
const OfferView = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [d, setD] = useState<{ offer: A.Offer; messages: A.Msg[] } | null>(null); const [text, setText] = useState(''); const [why, setWhy] = useState('');
  const load = useCallback(async () => { const r = await A.apiOffer(id); if (r.ok && r.data) setD({ offer: r.data.offer, messages: r.data.messages }); }, [id]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => clearInterval(t); }, [load]);
  if (!d) return <SkyLoader />;
  const o = d.offer; const spec = o.role === 'specialist';
  const act = async (a: string, needWhy = false) => {
    if (needWhy && why.trim().length < 5) { flash('Укажите причину (от 5 знаков)'); return; }
    const r = await A.apiAction(id, a, why); if (!r.ok || r.data?.error) flash(A.errText(r.data?.error ?? r.error)); else { setWhy(''); void load(); }
  };
  const send = async () => { const r = await A.apiMessage(id, text); if (r.ok && !r.data?.error) { setText(''); void load(); } else flash(A.errText(r.data?.error ?? r.error)); };
  const live = ['sent', 'negotiating', 'accepted', 'in_progress', 'disputed'].includes(o.status);
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs font-bold" style={{ color: C.acc }}><ArrowLeft size={14} />К предложениям</button>
      <Card>
        <p translate="no" className="text-sm font-bold" style={{ color: C.t1 }}>{o.title}</p>
        <div className="my-1 flex flex-wrap gap-1"><Pill tone={C.acc}>{A.STATUS[o.status]}</Pill><Pill>{A.WORK[o.kind]}</Pill>{o.budgetRub != null && <Pill>{`Бюджет (справочно): ${o.budgetRub.toLocaleString('ru-RU')} ₽`}</Pill>}{o.deadline && <Pill>{`Срок: ${String(o.deadline).slice(0, 10)}`}</Pill>}</div>
        <p className="text-[11px]" style={{ color: C.t3 }}>{spec ? 'Клиент' : 'Специалист'}: <span translate="no">{spec ? o.clientName : o.specialistName}</span></p>
        <p translate="no" className="mt-2 whitespace-pre-line text-sm" style={{ color: C.t2 }}>{o.brief}</p>
        {o.statusReason && <p translate="no" className="mt-2 text-xs" style={{ color: C.t3 }}>{`Причина: ${o.statusReason}`}</p>}
      </Card>
      <Card><p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Обсуждение условий</p>
        <div className="max-h-64 space-y-1.5 overflow-y-auto">{d.messages.length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Сообщений пока нет.</p>}
          {d.messages.map((m) => <div key={m.id} className={`flex ${m.mine ? 'justify-end' : ''}`}><p translate="no" className="max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-1.5 text-sm" style={{ background: m.mine ? C.acc : C.l2, color: m.mine ? '#fff' : C.t1 }}>{m.text}</p></div>)}</div>
        {live && <div className="mt-2 flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Сообщение" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm" style={field} /><Btn disabled={!text.trim()} onClick={() => void send()}>Отправить</Btn></div>}</Card>
      {live && (
        <Card><div className="space-y-2">
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Причина (нужна для отказа, отмены и спора)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
          <div className="flex flex-wrap gap-2">
            {spec && ['sent', 'negotiating'].includes(o.status) && <><Btn onClick={() => void act('accept')}>Принять</Btn><Btn tone="red" onClick={() => void act('decline', true)}>Отклонить</Btn></>}
            {!spec && ['sent', 'negotiating'].includes(o.status) && <Btn tone="plain" onClick={() => void act('withdraw')}>Отозвать</Btn>}
            {spec && o.status === 'accepted' && <Btn onClick={() => void act('start')}>Начать работу</Btn>}
            {o.status === 'in_progress' && (!spec || o.kind === 'long_term') && <Btn onClick={() => void act('complete')}>{o.kind === 'long_term' ? 'Завершить сотрудничество' : 'Принять работу'}</Btn>}
            {['accepted', 'in_progress'].includes(o.status) && <><Btn tone="plain" onClick={() => void act('cancel', true)}>Отменить</Btn><Btn tone="red" onClick={() => void act('dispute', true)}>Открыть спор</Btn></>}
          </div>
          <p className="text-[11px]" style={{ color: C.t3 }}>Спор рассматривает администрация Sky; деньги она не двигает — оплата ведётся вне биржи.</p>
        </div></Card>)}
    </div>
  );
};

const Offers = ({ initial }: { initial?: string }) => {
  const [list, setList] = useState<A.Offer[] | null>(null); const [open, setOpen] = useState(initial ?? '');
  useEffect(() => { void A.apiOffers().then((r) => setList(r.ok ? r.data?.offers ?? [] : [])); }, [open]);
  if (open) return <OfferView id={open} onBack={() => setOpen('')} />;
  if (!list) return <SkyLoader />;
  if (!list.length) return <p className="text-sm" style={{ color: C.t3 }}>Предложений пока нет.</p>;
  return <div className="space-y-2">{list.map((o) => (
    <Card key={o.id} onClick={() => setOpen(o.id)}>
      <div className="flex items-center justify-between gap-2"><p translate="no" className="min-w-0 truncate text-sm font-bold" style={{ color: C.t1 }}>{o.title}</p><Pill tone={C.acc}>{A.STATUS[o.status]}</Pill></div>
      <p className="text-[11px]" style={{ color: C.t3 }}>{o.role === 'specialist' ? 'Вам' : 'Вы'} · <span translate="no">{o.role === 'specialist' ? o.clientName : o.specialistName}</span> · {A.WORK[o.kind]}</p>
    </Card>))}</div>;
};

/* ─── Кабинет специалиста ─── */
const Cabinet = () => {
  const [p, setP] = useState<A.Spec | null | undefined>();
  const [f, setF] = useState<Record<string, unknown>>({ category: 'editors', displayName: '', headline: '', description: '', specializations: '', workTypes: ['one_time'], availability: 'open', availabilityNote: '', services: [] as A.Svc[] });
  const [w, setW] = useState({ title: '', description: '', url: '', image: '' });
  const load = useCallback(async () => {
    const r = await A.apiMine(); const x = r.ok ? r.data?.profile ?? null : null; setP(x);
    if (x) setF({ category: x.category, displayName: x.displayName, headline: x.headline, description: x.description, specializations: x.specializations.join(', '), workTypes: x.workTypes, availability: x.availability, availabilityNote: x.availabilityNote, services: x.services });
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (p === undefined) return <SkyLoader />;
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const svcs = (f.services as A.Svc[]);
  const save = async () => {
    const r = await A.apiSave({ ...f, specializations: String(f.specializations).split(',').map((x) => x.trim()).filter(Boolean) });
    if (!r.ok || r.data?.error) { flash(A.errText(r.data?.error ?? r.error, r.data)); return; } flash(r.data?.status === 'pending' ? 'Сохранено, анкета на проверке' : 'Сохранено'); void load();
  };
  const pick = (cb: (data: string) => Promise<void>, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void A.shrink(file, max).then(cb).catch(() => flash('Не удалось прочитать картинку')); };
  const wt = f.workTypes as string[];
  return (
    <div className="space-y-3">
      {p && <Card><div className="flex flex-wrap items-center gap-2"><Pill tone={C.acc}>{A.PROFILE_STATUS[p.status]}</Pill>{p.statusReason && <span translate="no" className="text-xs" style={{ color: C.t3 }}>{`Причина: ${p.statusReason}`}</span>}</div>
        <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>Анкету публикует администрация. Правка имени, описания, специализаций и услуг, а также нового фото и работ возвращает её на проверку.</p></Card>}
      <Card><div className="space-y-2">
        <label className="block text-[11px]" style={{ color: C.t3 }}>Специализация<select value={String(f.category)} onChange={(e) => set('category', e.target.value)} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field}>{Object.entries(A.CATEGORY).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <In label="Имя" value={f.displayName} onChange={(v) => set('displayName', v)} /><In label="Коротко о себе" value={f.headline} onChange={(v) => set('headline', v)} />
        <In label="Описание (от 20 знаков)" value={f.description} onChange={(v) => set('description', v)} area /><In label="Навыки через запятую" value={f.specializations} onChange={(v) => set('specializations', v)} />
        <div className="flex flex-wrap gap-3 text-xs" style={{ color: C.t2 }}>{Object.entries(A.WORK).map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={wt.includes(k)} onChange={(e) => set('workTypes', e.target.checked ? [...wt, k] : wt.filter((x) => x !== k))} />{l}</label>)}</div>
        <label className="block text-[11px]" style={{ color: C.t3 }}>Доступность<select value={String(f.availability)} onChange={(e) => set('availability', e.target.value)} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field}>{Object.entries(A.AVAIL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <In label="Пояснение к доступности" value={f.availabilityNote} onChange={(v) => set('availabilityNote', v)} />
        <p className="text-xs font-bold" style={{ color: C.t1 }}>Услуги</p>
        {svcs.map((s, i) => <div key={i} className="grid grid-cols-[1fr_90px_auto] gap-2"><input value={s.title} onChange={(e) => set('services', svcs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Название услуги" className="min-w-0 rounded-xl px-2 py-1.5 text-sm" style={field} />
          <input value={s.priceFrom ?? ''} onChange={(e) => set('services', svcs.map((x, j) => (j === i ? { ...x, priceFrom: Number(e.target.value.replace(/\D/g, '')) || null } : x)))} placeholder="от, ₽" className="min-w-0 rounded-xl px-2 py-1.5 text-sm" style={field} />
          <button type="button" onClick={() => set('services', svcs.filter((_, j) => j !== i))} className="text-xs" style={{ color: C.red }}>×</button></div>)}
        {svcs.length < 12 && <Btn tone="plain" onClick={() => set('services', [...svcs, { title: '', workType: 'both', priceFrom: null, note: '' }])}>+ Услуга</Btn>}
        <Btn onClick={() => void save()}>Сохранить</Btn></div></Card>
      {p && <>
        <Card><p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Фотография</p>
          {p.hasPhoto && <div className="mb-2 h-20 w-20 overflow-hidden rounded-3xl"><StoryImg src={`/api/specialists/${p.id}/photo`} className="h-full w-full object-cover" /></div>}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick(async (d) => { const r = await A.apiPhoto(d); flash(r.ok && !r.data?.error ? 'Фото сохранено' : A.errText(r.data?.error ?? r.error)); void load(); }, 512)} className="text-xs" /></Card>
        <Card><p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Портфолио ({p.portfolio?.length ?? 0}/12)</p>
          {(p.portfolio ?? []).map((x) => <div key={x.id} className="flex items-center justify-between gap-2 py-1 text-sm" style={{ color: C.t2 }}><span translate="no" className="min-w-0 truncate">{x.title}</span><button type="button" onClick={() => void A.apiDelWork(x.id).then(load)} className="text-xs" style={{ color: C.red }}>Удалить</button></div>)}
          <div className="mt-2 space-y-2"><In label="Название работы" value={w.title} onChange={(v) => setW({ ...w, title: v })} /><In label="Описание" value={w.description} onChange={(v) => setW({ ...w, description: v })} /><In label="Ссылка на пример (https)" value={w.url} onChange={(v) => setW({ ...w, url: v })} />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pick(async (d) => setW((c) => ({ ...c, image: d })), 1280)} className="text-xs" />{w.image && <p className="text-[11px]" style={{ color: C.green }}>Картинка выбрана</p>}
            <Btn disabled={w.title.length < 2} onClick={() => void A.apiAddWork(w).then((r) => { flash(r.ok && !r.data?.error ? 'Добавлено' : A.errText(r.data?.error ?? r.error, r.data)); if (r.ok && !r.data?.error) { setW({ title: '', description: '', url: '', image: '' }); void load(); } })}>Добавить работу</Btn></div></Card>
        {['draft', 'rejected'].includes(p.status) && <Btn onClick={() => void A.apiSubmit().then((r) => { flash(r.ok && !r.data?.error ? 'Отправлено на проверку' : A.errText(r.data?.error ?? r.error, r.data)); void load(); })}>Отправить на проверку</Btn>}</>}
    </div>
  );
};

export const SpecialistsExchange = () => {
  const [tab, setTab] = useState<'catalog' | 'offers' | 'me'>('catalog'); const [openId, setOpenId] = useState(''); const [offerId, setOfferId] = useState('');
  return (
    <div className="min-w-0 space-y-3 p-3">
      <div className="glass-pill flex gap-1 p-1" role="tablist">{([['catalog', 'Каталог'], ['offers', 'Мои предложения'], ['me', 'Я специалист']] as const).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpenId(''); setOfferId(''); }} className="relative isolate min-w-0 flex-1 rounded-full px-2 py-1.5 text-xs font-bold" style={{ color: tab === k ? C.t1 : C.t3 }}>
          {tab === k && <span className="glass-lens absolute inset-0 -z-10 rounded-full" />}{l}</button>))}</div>
      {tab === 'catalog' && (openId ? <Profile id={openId} onBack={() => setOpenId('')} onOffer={() => { setOpenId(''); setTab('offers'); }} /> : <Catalog onOpen={setOpenId} />)}
      {tab === 'offers' && <Offers key={offerId} initial={offerId} />}
      {tab === 'me' && <Cabinet />}
    </div>
  );
};
export default SpecialistsExchange;
