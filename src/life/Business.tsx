/** Sky Business Connection: деловая карточка, поиск партнёров/инвесторов/сооснователей, Sky Match, предложения, избранное. Sky не проверяет публикации и не гарантирует их достоверность. */
import { useRef, useState } from 'react';
import { Plus, Star, Flag, Paperclip, Trash2, MessageCircle, ShieldAlert, ChevronDown } from 'lucide-react';
import { flash } from '@/shared/flash';
import { useMessengerStore } from '@/messenger/store';
import { broadcast } from '@/messenger/socket';
import { useModuleStore } from '@/data/state/modules';
import { J, uploadLife, openLifeFile, errText, fmtDate, fmtSize, type LFile } from './api';
import { Card, H, Btn, Chip, Empty, Field, TextIn, Area, Pick, Sheet, Spinner, Note, Seg, Check, Progress, useLoad, useAct } from './ui';

type Match = { pct: number | null; reason?: string; reasons?: { ok: boolean; text: string }[]; confidence?: number };
type Post = { id: string; ownerId: string; kind: string; title: string; data: Record<string, any>; hidden?: string[]; status: string; reason?: string | null; publishedAt?: string; owner?: { id: string; name: string; hasCard?: boolean; city?: string | null; username?: string; card?: any }; match?: Match; favorite?: boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
  private?: Record<string, any>; files?: LFile[]; proposals?: { sent: number; total: number }; finance?: Record<string, any>; contact?: string | null; proposal?: { id: string; status: string } | null; hasDocs?: boolean; notice?: string; riskFlags?: string[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Search = { posts: Post[]; total: number; shown: number; cap: number; prime: boolean; notice: string; myParams: { hasProfile: boolean; hasPost: boolean } };

const KIND: Record<string, string> = { partner: 'Ищу партнёра', cofounder: 'Ищу сооснователя', investor_ask: 'Ищу инвестора', investor: 'Я инвестор' };
const STAGES = [{ v: '', l: 'Любая стадия' }, { v: 'idea', l: 'Идея' }, { v: 'mvp', l: 'MVP' }, { v: 'launch', l: 'Запуск' }, { v: 'growth', l: 'Рост' }, { v: 'scale', l: 'Масштабирование' }];
const COOP = [{ v: 'equity', l: 'Доля в бизнесе' }, { v: 'revenue_share', l: 'Доля выручки' }, { v: 'salary', l: 'Оплата работы' }, { v: 'contract', l: 'Договор подряда' }, { v: 'barter', l: 'Бартер' }, { v: 'any', l: 'Любое' }];
const LABEL: Record<string, string> = { summary: 'Описание', idea: 'Идея', state: 'Текущее состояние', duties: 'Обязанности партнёра', roles: 'Распределение ролей', financeTerms: 'Финансовые условия', commitment: 'Вовлечённость', projectName: 'Проект', description: 'Описание бизнеса', problem: 'Проблема, которую решает продукт', audience: 'Аудитория', revenue: 'Выручка, ₽', amountNeeded: 'Нужная сумма, ₽', equityPct: 'Предлагаемая доля, %', useOfFunds: 'Использование инвестиций', model: 'Бизнес-модель', forecast: 'Финансовые прогнозы', presentationNote: 'О презентации и бизнес-плане',
  industries: 'Отрасли', industry: 'Сфера', skillsNeeded: 'Нужные навыки', stages: 'Стадии', geo: 'География', investType: 'Тип инвестирования', models: 'Бизнес-модели', terms: 'Условия сотрудничества', amountMin: 'Минимальная сумма, ₽', amountMax: 'Максимальная сумма, ₽', city: 'Город', country: 'Страна', stage: 'Стадия', coop: 'Тип сотрудничества', remote: 'Удалённый формат' };
const HIDEABLE = ['revenue', 'amountNeeded', 'equityPct', 'forecast', 'amountMin', 'amountMax', 'financeTerms'];
const show = (k: string, v: any): string => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (Array.isArray(v)) return v.map((x) => (k === 'coop' ? COOP.find((c) => c.v === x)?.l ?? x : k === 'stages' ? STAGES.find((c) => c.v === x)?.l ?? x : x)).join(', ');
  if (k === 'stage') return STAGES.find((s) => s.v === v)?.l ?? v; if (typeof v === 'boolean') return v ? 'да' : 'нет'; if (typeof v === 'number') return k === 'equityPct' ? `${v} %` : v.toLocaleString('ru-RU'); return String(v);
};
const FIELDS: Record<string, { k: string; area?: boolean; list?: boolean; num?: boolean; stage?: boolean; coop?: boolean; bool?: boolean }[]> = {
  partner: [{ k: 'idea', area: true }, { k: 'state', area: true }, { k: 'skillsNeeded', list: true }, { k: 'duties', area: true }, { k: 'roles', area: true }, { k: 'financeTerms', area: true }],
  cofounder: [{ k: 'idea', area: true }, { k: 'state', area: true }, { k: 'skillsNeeded', list: true }, { k: 'duties', area: true }, { k: 'roles', area: true }, { k: 'commitment' }, { k: 'financeTerms', area: true }],
  investor_ask: [{ k: 'projectName' }, { k: 'description', area: true }, { k: 'problem', area: true }, { k: 'audience' }, { k: 'revenue', num: true }, { k: 'amountNeeded', num: true }, { k: 'equityPct', num: true }, { k: 'useOfFunds', area: true }, { k: 'model', area: true }, { k: 'forecast', area: true }, { k: 'presentationNote', area: true }],
  investor: [{ k: 'industries', list: true }, { k: 'amountMin', num: true }, { k: 'amountMax', num: true }, { k: 'stages', list: true }, { k: 'geo', list: true }, { k: 'investType' }, { k: 'models', list: true }, { k: 'terms', area: true }],
};

const NoticeBox = ({ text }: { text?: string }) => (
  <div className="flex gap-2 rounded-2xl p-3" style={{ background: 'rgba(245,158,11,.1)' }}><ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: '#f59e0b' }} /><p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>{text ?? 'Sky не проверяет проекты, инвесторов и партнёров и не гарантирует достоверность предложений. Не переводите деньги незнакомым людям. Подтверждение личности (KYC) в Sky Life пока не подключено.'}</p></div>
);
const MatchBadge = ({ m }: { m?: Match }) => {
  const [open, setOpen] = useState(false); if (!m) return null;
  if (m.pct == null) return <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Совместимость не рассчитана: {m.reason ?? 'мало данных'}. Заполните деловую карточку, чтобы увидеть процент.</p>;
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left"><div className="flex-1"><Progress value={m.pct} tone={m.pct >= 70 ? 'ok' : undefined} /></div><span className="text-sm font-black" style={{ color: m.pct >= 70 ? '#10b981' : '#a78bfa' }}>{m.pct}%</span><ChevronDown size={14} style={{ color: 'var(--t3)', transform: open ? 'rotate(180deg)' : undefined }} /></button>
      {open && <div className="mt-2 space-y-1">{m.reasons?.map((r, i) => <p key={i} className="text-[12px]" style={{ color: r.ok ? 'var(--t2)' : 'var(--t3)' }}>{r.ok ? '✓' : '·'} {r.text}</p>)}<Note>Процент считается по реально заполненным параметрам обеих сторон (учтено {m.confidence}% возможных). Это подсказка, а не оценка надёжности.</Note></div>}
    </div>
  );
};

/* ─── публикация ──────────────────────────────────────────────────── */
const PostEditor = ({ kind, post, onClose, onSaved }: { kind: string; post: Post | null; onClose: () => void; onSaved: () => void }) => {
  const src = { ...(post?.data ?? {}), ...(post?.private ?? {}) }; const [title, setTitle] = useState(post?.title ?? '');
  const [f, setF] = useState<Record<string, any>>(() => Object.fromEntries(Object.entries(src).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]))); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [hidden, setHidden] = useState<string[]>(post?.hidden ?? []); const [contact, setContact] = useState(String(post?.private?.contact ?? '')); const [summary, setSummary] = useState(String(post?.data?.summary ?? ''));
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v }); const { busy, act } = useAct(); const fileRef = useRef<HTMLInputElement>(null); const [files, setFiles] = useState<LFile[]>(post?.files ?? []); const [id, setId] = useState(post?.id ?? '');
  const body = (submit: boolean) => {
    const o: Record<string, unknown> = { kind, title, summary, contact, hidden, submit, city: f.city, country: f.country, stage: f.stage, remote: f.remote === true, industry: String(f.industry ?? '').split(','), coop: f.coop ? [f.coop] : [] };
    for (const fd of FIELDS[kind]) o[fd.k] = fd.list ? String(f[fd.k] ?? '').split(',') : f[fd.k];
    return o;
  };
  const save = async (submit: boolean) => { const r = await act(() => (id ? J<{ id: string }>(`/api/life/biz/posts/${id}`, 'PUT', body(submit)) : J<{ id: string }>('/api/life/biz/posts', 'POST', body(submit))), submit ? 'Отправлено на проверку' : 'Черновик сохранён'); if (r?.ok) { if (r.data?.id) setId(r.data.id); onSaved(); if (submit) onClose(); } };
  const upload = async (file?: File) => { if (!file) return; let pid = id; if (!pid) { const r = await J<{ id: string }>('/api/life/biz/posts', 'POST', body(false)); if (!r.ok || !r.data?.id) return flash(errText(r.error)); pid = r.data.id; setId(pid); onSaved(); } const r = await uploadLife({ postId: pid }, file); if (r.ok) { flash('Файл добавлен'); setFiles([...files, r.data as LFile]); onSaved(); } else flash(errText(r.error)); if (fileRef.current) fileRef.current.value = ''; };
  return (
    <Sheet title={`${post ? 'Изменить' : 'Новая публикация'}: ${KIND[kind]}`} onClose={onClose} wide>
      <NoticeBox />
      <Field label="Заголовок"><TextIn value={title} onChange={setTitle} max={140} /></Field>
      <Field label="Кратко о предложении" hint="Не указывайте телефон, почту и ссылки на мессенджеры в открытом тексте — для связи есть отдельное поле."><Area value={summary} onChange={setSummary} rows={3} max={4000} /></Field>
      {FIELDS[kind].map((fd) => (
        <div key={fd.k}><Field label={LABEL[fd.k] ?? fd.k} hint={fd.list ? 'Через запятую' : undefined}>{fd.area ? <Area value={String(f[fd.k] ?? '')} onChange={(v) => set(fd.k, v)} rows={2} max={1500} /> : <TextIn type={fd.num ? 'number' : 'text'} value={String(f[fd.k] ?? '')} onChange={(v) => set(fd.k, v)} />}</Field>
          {HIDEABLE.includes(fd.k) && <div className="mt-1"><Check checked={hidden.includes(fd.k)} onChange={(v) => setHidden(v ? [...hidden, fd.k] : hidden.filter((x) => x !== fd.k))} label="Скрыть от публичного просмотра (открою сам после принятия предложения)" /></div>}</div>))}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Страна"><TextIn value={String(f.country ?? '')} onChange={(v) => set('country', v)} /></Field><Field label="Город"><TextIn value={String(f.city ?? '')} onChange={(v) => set('city', v)} /></Field>
        <Field label="Сфера"><TextIn value={String(f.industry ?? '')} onChange={(v) => set('industry', v)} /></Field>{kind !== 'investor' && <Field label="Стадия"><Pick value={String(f.stage ?? '')} onChange={(v) => set('stage', v)} options={STAGES} /></Field>}
        <Field label="Тип сотрудничества"><Pick value={String((Array.isArray(f.coop) ? f.coop[0] : f.coop) ?? 'any')} onChange={(v) => set('coop', v)} options={COOP} /></Field></div>
      <Check checked={f.remote === true} onChange={(v) => set('remote', v)} label="Возможен удалённый формат" />
      <Field label="Контакт для связи" hint="Скрыт. Откроется собеседнику, только когда вы примете его предложение и сами нажмёте «Открыть контакт»."><TextIn value={contact} onChange={setContact} max={300} placeholder="Телефон, почта или @ник" /></Field>
      <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Презентация, бизнес-план, документы</p><Btn small tone="plain" onClick={() => fileRef.current?.click()}><Paperclip size={12} className="mr-1 inline" />Прикрепить</Btn></div>
        <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.odp,.txt,.csv" onChange={(e) => void upload(e.target.files?.[0])} />
        {files.map((x) => <div key={x.id} className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}><button type="button" className="min-w-0 flex-1 truncate text-left text-sm" style={{ color: 'var(--t1)' }} onClick={() => void openLifeFile(x)} translate="no">{x.name}</button><span className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtSize(x.bytes)}</span><button type="button" aria-label="Удалить файл" onClick={async () => { await J(`/api/life/files/${x.id}`, 'DELETE'); setFiles(files.filter((y) => y.id !== x.id)); onSaved(); }}><Trash2 size={13} style={{ color: '#ef4444' }} /></button></div>)}
        <Note>Документы видны только тем, кому вы откроете доступ после принятия предложения.</Note></div>
      <div className="flex flex-wrap justify-end gap-2 pt-1"><Btn tone="plain" onClick={onClose}>Закрыть</Btn><Btn tone="plain" disabled={busy || title.trim().length < 5} onClick={() => void save(false)}>Сохранить черновик</Btn><Btn disabled={busy || title.trim().length < 5} onClick={() => void save(true)}>Отправить на проверку</Btn></div>
      <Note>Публикация появится в поиске после проверки модератором. Проверка не означает, что Sky подтверждает проект или его доходность.</Note>
    </Sheet>
  );
};

/* ─── карточка публикации ─────────────────────────────────────────── */
const openChat = (id: string, name: string, username?: string) => { const c = useMessengerStore.getState().startDM({ id, name, username: username ?? '' }); if (c) broadcast.newChat(c); useModuleStore.getState().setActiveModule('messages'); };
const Reasons: { v: string; l: string }[] = [{ v: 'scam', l: 'Мошенничество' }, { v: 'fake', l: 'Ложные сведения' }, { v: 'personal_data', l: 'Чужие персональные данные' }, { v: 'spam', l: 'Спам' }, { v: 'pressure', l: 'Давление или вымогательство' }, { v: 'other', l: 'Другое' }];
const ReportSheet = ({ path, onClose }: { path: string; onClose: () => void }) => {
  const [reason, setReason] = useState('scam'); const [text, setText] = useState(''); const { busy, act } = useAct();
  return <Sheet title="Пожаловаться" onClose={onClose}><Field label="Причина"><Pick value={reason} onChange={setReason} options={Reasons} /></Field><Field label="Комментарий"><Area value={text} onChange={setText} rows={3} max={600} /></Field>
    <div className="flex justify-end gap-2"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy} onClick={async () => { const r = await act(() => J(path, 'POST', { reason, text }), 'Жалоба отправлена'); if (r?.ok) onClose(); }}>Отправить</Btn></div></Sheet>;
};
export const PostDetail = ({ id, mine, onClose, onChanged, onEdit }: { id: string; mine?: boolean; onClose: () => void; onChanged: () => void; onEdit?: (p: Post) => void }) => {
  const d = useLoad(async () => { const r = await J<{ post: Post }>(`/api/life/biz/posts/${id}`); return r.ok ? r.data?.post ?? null : null; }, [id]); const [msg, setMsg] = useState(''); const [rep, setRep] = useState(false); const { busy, act } = useAct();
  const p = d.data;
  return (
    <Sheet title={p?.title ?? 'Публикация'} onClose={onClose} wide>
      {!p ? <Spinner /> : <>
        <div className="flex flex-wrap items-center gap-2"><Chip tone="acc">{KIND[p.kind]}</Chip>{p.status !== 'published' && <Chip tone="warn">{p.status}</Chip>}<Note>{p.publishedAt ? `Опубликовано ${fmtDate(p.publishedAt)}` : ''}</Note></div>
        {p.owner && <div className="rounded-2xl p-3" style={{ background: 'var(--bg-l2)' }}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.owner.card?.name ?? p.owner.name}</p>{p.owner.card ? <p className="text-[12px]" style={{ color: 'var(--t3)' }} translate="no">{[p.owner.card.city, p.owner.card.country].filter(Boolean).join(', ')}{p.owner.card.industries?.length ? ` · ${p.owner.card.industries.join(', ')}` : ''}</p> : <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Деловая карточка не опубликована</p>}{p.owner.card?.about && <p className="mt-1 text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{p.owner.card.about}</p>}</div>}
        {!mine && <MatchBadge m={p.match} />}
        <div className="space-y-2">{Object.entries({ ...p.data, ...(p.finance ?? {}) }).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => <div key={k}><p className="text-[10px] font-bold uppercase" style={{ color: 'var(--t3)' }}>{LABEL[k] ?? k}</p><p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t1)' }} translate="no">{show(k, v)}</p></div>)}
          {!mine && (p.hidden ?? []).filter((k) => !p.finance || !(k in p.finance)).length > 0 && <Note>Скрыто автором до принятия предложения: {(p.hidden ?? []).map((k) => LABEL[k] ?? k).join(', ')}</Note>}</div>
        {p.contact && <div className="rounded-2xl p-3" style={{ background: 'rgba(16,185,129,.1)' }}><p className="text-[10px] font-bold" style={{ color: '#10b981' }}>КОНТАКТ ОТКРЫТ АВТОРОМ</p><p className="text-sm" style={{ color: 'var(--t1)' }} translate="no">{p.contact}</p></div>}
        {(p.files?.length ?? 0) > 0 && <div className="space-y-1.5"><p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Документы</p>{p.files!.map((x) => <button key={x.id} type="button" onClick={() => void openLifeFile(x)} className="block w-full truncate rounded-2xl px-3 py-2 text-left text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }} translate="no">📎 {x.name}</button>)}</div>}
        {!mine && p.hasDocs && !p.files && <Note>У публикации есть документы — автор откроет их после принятия вашего предложения.</Note>}
        {mine ? <div className="flex flex-wrap gap-2">{onEdit && <Btn tone="plain" onClick={() => onEdit(p)}>Изменить</Btn>}{p.status === 'published' && <Btn tone="plain" onClick={async () => { await J(`/api/life/biz/posts/${id}/close`, 'POST', {}); onChanged(); onClose(); }}>Закрыть публикацию</Btn>}<Btn tone="red" onClick={async () => { if (window.confirm('Удалить публикацию?')) { await J(`/api/life/biz/posts/${id}`, 'DELETE'); onChanged(); onClose(); } }}>Удалить</Btn></div> : (
          <div className="space-y-2">
            {!p.proposal || ['declined', 'withdrawn'].includes(p.proposal.status) ? <><Field label="Предложение о сотрудничестве" hint="Первое сообщение. Ваши контакты автору не передаются."><Area value={msg} onChange={setMsg} rows={3} max={2000} placeholder="Кто вы и что предлагаете" /></Field>
              <Btn disabled={busy || msg.trim().length < 10} onClick={async () => { const r = await act(() => J(`/api/life/biz/posts/${id}/proposal`, 'POST', { message: msg }), 'Предложение отправлено'); if (r?.ok) { setMsg(''); void d.reload(); onChanged(); } }}>Отправить предложение</Btn></> : <Chip tone={p.proposal.status === 'accepted' ? 'ok' : 'warn'}>{p.proposal.status === 'accepted' ? 'Предложение принято' : 'Предложение отправлено'}</Chip>}
            <div className="flex gap-2"><Btn small tone="plain" onClick={async () => { const r = await J<{ favorite: boolean }>(`/api/life/biz/posts/${id}/favorite`, 'POST', {}); if (r.ok) { flash(r.data?.favorite ? 'В избранном' : 'Убрано из избранного'); onChanged(); } }}><Star size={12} className="mr-1 inline" />В избранное</Btn><Btn small tone="plain" onClick={() => setRep(true)}><Flag size={12} className="mr-1 inline" />Пожаловаться</Btn></div>
            <NoticeBox text={p.notice} /></div>)}
        {rep && <ReportSheet path={`/api/life/biz/posts/${id}/report`} onClose={() => setRep(false)} />}</>}
    </Sheet>
  );
};

/* ─── поиск и подбор ──────────────────────────────────────────────── */
const SearchTab = ({ tab, createKind }: { tab: 'partners' | 'investors' | 'cofounders' | 'investees'; createKind: string }) => {
  const [q, setQ] = useState(''); const [industry, setIndustry] = useState(''); const [city, setCity] = useState(''); const [stage, setStage] = useState(''); const [remote, setRemote] = useState(false); const [minMatch, setMinMatch] = useState(0); const [sort, setSort] = useState('match'); const [favOnly, setFavOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null); const [create, setCreate] = useState(false);
  const qs = new URLSearchParams({ tab, ...(q && { q }), ...(industry && { industry }), ...(city && { city }), ...(stage && { stage }), ...(remote && { remote: 'true' }), ...(minMatch && { minMatch: String(minMatch) }), sort, ...(favOnly && { favorites: 'true' }) }).toString();
  const s = useLoad(async () => { const r = await J<Search>(`/api/life/biz/search?${qs}`); return r.ok ? r.data : null; }, [qs]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2"><Note>{tab === 'investees' ? 'Проекты, которые ищут инвестора.' : tab === 'investors' ? 'Инвесторы, опубликовавшие карточку.' : tab === 'cofounders' ? 'Люди, которые ищут сооснователя.' : 'Предложения о партнёрстве.'}</Note><Btn small onClick={() => setCreate(true)}><Plus size={13} className="mr-1 inline" />{KIND[createKind]}</Btn></div>
      <Card className="!p-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><TextIn value={q} onChange={setQ} placeholder="Поиск" /><TextIn value={industry} onChange={setIndustry} placeholder="Сфера" /><TextIn value={city} onChange={setCity} placeholder="Город" /><Pick value={stage} onChange={setStage} options={STAGES} /></div>
        <div className="mt-2 flex flex-wrap items-center gap-3"><Check checked={remote} onChange={setRemote} label="Удалённо" /><Check checked={favOnly} onChange={setFavOnly} label="Только избранные" />
          <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>Совместимость от {minMatch}%<input type="range" min={0} max={90} step={10} value={minMatch} onChange={(e) => setMinMatch(Number(e.target.value))} className="accent-violet-500" /></label>
          <Pick value={sort} onChange={setSort} options={[{ v: 'match', l: 'По совместимости' }, { v: 'new', l: 'Сначала новые' }]} /></div></Card>
      {s.data && !s.data.myParams.hasProfile && !s.data.myParams.hasPost && <Card><p className="text-sm" style={{ color: 'var(--t2)' }}>Чтобы Sky Match мог посчитать совместимость, заполните <b>деловую карточку</b> (вкладка «Мои») или опубликуйте своё предложение.</p></Card>}
      {s.data && <NoticeBox text={s.data.notice} />}
      {!s.data ? <Spinner /> : !s.data.posts.length ? <Empty text="Ничего не найдено" hint="Измените фильтры или опубликуйте своё предложение — тогда его увидят другие." /> : <>
        {s.data.posts.map((p) => (
          <Card key={p.id} onClick={() => setOpen(p.id)}>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.title}</p><p className="truncate text-[12px]" style={{ color: 'var(--t3)' }} translate="no">{p.owner?.name}{p.data.city ? ` · ${p.data.city}` : ''}{p.data.stage ? ` · ${STAGES.find((x) => x.v === p.data.stage)?.l}` : ''}</p></div>{p.favorite && <Star size={15} fill="#f59e0b" style={{ color: '#f59e0b' }} />}</div>
            <p className="mt-1.5 line-clamp-2 text-[12px]" style={{ color: 'var(--t2)' }} translate="no">{p.data.summary ?? p.data.description ?? p.data.idea ?? ''}</p>
            <div className="mt-2" onClick={(e) => e.stopPropagation()}><MatchBadge m={p.match} /></div></Card>))}
        {s.data.total > s.data.shown && <Card><p className="text-sm" style={{ color: 'var(--t2)' }}>Показано {s.data.shown} из {s.data.total}. {s.data.prime ? '' : 'Расширенная выдача подбора — в Sky Prime.'}</p></Card>}
        </>}
      {open && <PostDetail id={open} onClose={() => setOpen(null)} onChanged={() => void s.reload()} />}
      {create && <PostEditor kind={createKind} post={null} onClose={() => setCreate(false)} onSaved={() => void s.reload()} />}
    </div>
  );
};

/* ─── моя карточка и публикации ───────────────────────────────────── */
const MyCard = () => {
  const o = useLoad(async () => (await J<{ profile: any; restriction?: { reason: string } | null }>('/api/life/biz/overview')).data, []); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [f, setF] = useState<Record<string, any> | null>(null); const { busy, act } = useAct(); const logoRef = useRef<HTMLInputElement>(null);
  const p = f ?? o.data?.profile ?? { name: '', country: '', city: '', industries: [], skills: [], interests: [], about: '', experience: '', coop: [], projects: [], links: [], contact: '' };
  if (!o.data) return <Spinner />;
  const set = (k: string, v: unknown) => setF({ ...p, [k]: v }); const lst = (k: string) => (Array.isArray(p[k]) ? p[k].join(', ') : '');
  const save = async (publish: boolean) => { const body = { ...p, industries: String(lst('industries')).split(','), skills: String(lst('skills')).split(','), interests: String(lst('interests')).split(','), coop: p.coop ?? [], publish };
    const r = await act(() => J('/api/life/biz/profile', 'PUT', body), publish ? 'Карточка отправлена на проверку' : 'Черновик сохранён'); if (r?.ok) { setF(null); void o.reload(); } };
  const st = o.data.profile?.status;
  return (
    <div className="space-y-3">
      <NoticeBox />
      {o.data.restriction && <Card><p className="text-sm" style={{ color: '#ef4444' }}>Деловые функции ограничены: {o.data.restriction.reason}</p></Card>}
      <Card className="space-y-3">
        <div className="flex items-center justify-between"><H>Деловая карточка</H>{st && <Chip tone={st === 'published' ? 'ok' : st === 'pending' ? 'warn' : st === 'blocked' || st === 'rejected' ? 'bad' : undefined}>{{ published: 'опубликована', pending: 'на проверке', draft: 'черновик', rejected: 'отклонена', blocked: 'заблокирована' }[st as string]}</Chip>}</div>
        {o.data.profile?.reason && <Note>Причина: {o.data.profile.reason}</Note>}
        <Note>Карточка связана с вашим Sky ID. Личные данные (телефон, почта, настоящее имя) в ней не показываются — только то, что вы напишете сами.</Note>
        <Field label="Имя или название компании"><TextIn value={p.name ?? ''} onChange={(v) => set('name', v)} max={80} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="Страна"><TextIn value={p.country ?? ''} onChange={(v) => set('country', v)} /></Field><Field label="Город"><TextIn value={p.city ?? ''} onChange={(v) => set('city', v)} /></Field></div>
        <Field label="Сферы деятельности" hint="Через запятую"><TextIn value={lst('industries')} onChange={(v) => set('industries', v.split(','))} /></Field>
        <Field label="Навыки" hint="Через запятую"><TextIn value={lst('skills')} onChange={(v) => set('skills', v.split(','))} /></Field>
        <Field label="Интересы" hint="Через запятую"><TextIn value={lst('interests')} onChange={(v) => set('interests', v.split(','))} /></Field>
        <Field label="Опыт"><Area value={p.experience ?? ''} onChange={(v) => set('experience', v)} rows={2} max={1500} /></Field>
        <Field label="Описание деятельности"><Area value={p.about ?? ''} onChange={(v) => set('about', v)} rows={3} max={3000} /></Field>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Тип сотрудничества"><Pick value={(p.coop ?? [])[0] ?? 'any'} onChange={(v) => set('coop', [v])} options={COOP} /></Field><Field label="Формат"><Pick value={p.format ?? ''} onChange={(v) => set('format', v || null)} options={[{ v: '', l: 'Не указан' }, { v: 'remote', l: 'Удалённо' }, { v: 'offline', l: 'Очно' }, { v: 'both', l: 'Любой' }]} /></Field></div>
        <Field label="Ссылка на Sky Business (по желанию)"><TextIn value={p.skyBusinessUrl ?? ''} onChange={(v) => set('skyBusinessUrl', v)} placeholder="https://" /></Field>
        <Field label="Контакт для связи" hint="Скрыт, не публикуется. Откроется только по вашему решению после принятия предложения."><TextIn value={p.contact ?? ''} onChange={(v) => set('contact', v)} max={300} /></Field>
        <div className="flex flex-wrap items-center gap-2"><Btn small tone="plain" onClick={() => logoRef.current?.click()}>Логотип или фото</Btn><input ref={logoRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const r = await uploadLife({ logo: '1' }, file); flash(r.ok ? 'Логотип сохранён' : errText(r.error)); e.target.value = ''; }} /><Note>до 400 КБ, PNG/JPEG/WebP</Note></div>
        <div className="flex flex-wrap justify-end gap-2"><Btn tone="plain" disabled={busy} onClick={() => void save(false)}>Сохранить черновик</Btn><Btn disabled={busy || String(p.name ?? '').trim().length < 2} onClick={() => void save(true)}>Опубликовать (на проверку)</Btn>{st === 'published' && <Btn tone="red" onClick={async () => { await J('/api/life/biz/profile', 'DELETE'); void o.reload(); }}>Снять с публикации</Btn>}</div>
      </Card>
    </div>
  );
};
const MyPosts = () => {
  const l = useLoad(async () => (await J<{ posts: Post[] }>('/api/life/biz/posts')).data, []); const [open, setOpen] = useState<string | null>(null); const [edit, setEdit] = useState<{ kind: string; post: Post | null } | null>(null);
  const ST: Record<string, string> = { draft: 'черновик', pending: 'на проверке', published: 'опубликовано', rejected: 'отклонено', blocked: 'заблокировано', closed: 'закрыто' };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{Object.keys(KIND).map((k) => <Btn key={k} small tone="plain" onClick={() => setEdit({ kind: k, post: null })}><Plus size={12} className="mr-1 inline" />{KIND[k]}</Btn>)}</div>
      {!l.data ? <Spinner /> : !l.data.posts.length ? <Empty text="Публикаций пока нет" hint="Опубликуйте предложение — оно появится в поиске после проверки." /> : l.data.posts.map((p) => (
        <Card key={p.id} onClick={() => setOpen(p.id)}><div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.title}</p><Chip tone={p.status === 'published' ? 'ok' : p.status === 'pending' ? 'warn' : p.status === 'blocked' || p.status === 'rejected' ? 'bad' : undefined}>{ST[p.status]}</Chip></div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>{KIND[p.kind]} · предложений {p.proposals?.total ?? 0}{p.proposals?.sent ? ` (новых ${p.proposals.sent})` : ''}</p>{p.reason && p.status !== 'published' && <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>Причина: {p.reason}</p>}</Card>))}
      {open && <PostDetail id={open} mine onClose={() => setOpen(null)} onChanged={() => void l.reload()} onEdit={(p) => { setOpen(null); setEdit({ kind: p.kind, post: p }); }} />}
      {edit && <PostEditor kind={edit.kind} post={edit.post} onClose={() => setEdit(null)} onSaved={() => void l.reload()} />}
    </div>
  );
};

/* ─── предложения ─────────────────────────────────────────────────── */
type Prop = { id: string; postId: string; postTitle: string; kind: string; status: string; message: string; peer: { id: string; name: string; username: string }; createdAt: string; decidedAt: string | null; contactShared: boolean; docsShared: boolean; financeShared: boolean };
const PST: Record<string, { l: string; tone?: 'ok' | 'warn' | 'bad' }> = { sent: { l: 'Ждёт ответа', tone: 'warn' }, accepted: { l: 'Принято', tone: 'ok' }, declined: { l: 'Отклонено', tone: 'bad' }, withdrawn: { l: 'Отозвано' } };
const Proposals = () => {
  const [box, setBox] = useState<'in' | 'out'>('in'); const l = useLoad(async () => (await J<{ proposals: Prop[] }>(`/api/life/biz/proposals?box=${box}`)).data, [box]); const [hist, setHist] = useState<{ event: string; byMe: boolean; at: string }[] | null>(null); const [rep, setRep] = useState<string | null>(null);
  const { act } = useAct(); const EV: Record<string, string> = { sent: 'Предложение отправлено', accepted: 'Принято', declined: 'Отклонено', withdrawn: 'Отозвано' };
  const evText = (e: string) => EV[e] ?? (e.startsWith('share:') ? `Решение об открытии: ${e.slice(6).replace('contact', 'контакт').replace('docs', 'документы').replace('finance', 'финансы').replace(/=true/g, ' — открыто').replace(/=false/g, ' — закрыто')}` : e);
  const answer = async (id: string, a: string) => { const r = await act(() => J(`/api/life/biz/proposals/${id}/${a}`, 'POST', {}), a === 'accept' ? 'Предложение принято' : 'Готово'); if (r?.ok) void l.reload(); };
  const share = async (p: Prop, k: 'contact' | 'docs' | 'finance') => { const cur = { contact: p.contactShared, docs: p.docsShared, finance: p.financeShared }[k]; if (!cur && !window.confirm(k === 'contact' ? 'Открыть собеседнику ваш контакт для связи?' : k === 'docs' ? 'Открыть собеседнику документы публикации?' : 'Открыть скрытые финансовые параметры?')) return; const r = await act(() => J(`/api/life/biz/proposals/${p.id}/share`, 'POST', { [k]: !cur })); if (r?.ok) void l.reload(); };
  return (
    <div className="space-y-3">
      <Seg id="pbox" value={box} onChange={setBox} items={[{ v: 'in', l: 'Входящие' }, { v: 'out', l: 'Мои отправленные' }]} />
      {!l.data ? <Spinner /> : !l.data.proposals.length ? <Empty text="Предложений нет" /> : l.data.proposals.map((p) => (
        <Card key={p.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.postTitle}</p><Chip tone={PST[p.status].tone}>{PST[p.status].l}</Chip></div>
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>{box === 'in' ? 'От' : 'Кому'}: <span translate="no">{p.peer.name} @{p.peer.username}</span> · {fmtDate(p.createdAt)}</p>
          <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--t2)' }} translate="no">{p.message}</p>
          <div className="flex flex-wrap gap-2">
            {box === 'in' && p.status === 'sent' && <><Btn small onClick={() => void answer(p.id, 'accept')}>Принять</Btn><Btn small tone="plain" onClick={() => void answer(p.id, 'decline')}>Отклонить</Btn></>}
            {box === 'out' && ['sent', 'accepted'].includes(p.status) && <Btn small tone="plain" onClick={() => void answer(p.id, 'withdraw')}>Отозвать</Btn>}
            {p.status === 'accepted' && <Btn small onClick={() => openChat(p.peer.id, p.peer.name, p.peer.username)}><MessageCircle size={12} className="mr-1 inline" />Открыть чат</Btn>}
            <Btn small tone="plain" onClick={async () => { const r = await J<{ history: { event: string; byMe: boolean; at: string }[] }>(`/api/life/biz/proposals/${p.id}/history`); if (r.ok) setHist(r.data?.history ?? []); }}>История</Btn>
            <Btn small tone="plain" onClick={() => setRep(p.id)}><Flag size={12} className="mr-1 inline" />Пожаловаться</Btn></div>
          {box === 'in' && p.status === 'accepted' && <div className="space-y-1 rounded-2xl p-3" style={{ background: 'var(--bg-l2)' }}><p className="text-[11px] font-bold" style={{ color: 'var(--t3)' }}>ЧТО ОТКРЫТО ЭТОМУ ЧЕЛОВЕКУ</p>
            <Check checked={p.contactShared} onChange={() => void share(p, 'contact')} label="Мой контакт для связи" /><Check checked={p.docsShared} onChange={() => void share(p, 'docs')} label="Документы публикации" /><Check checked={p.financeShared} onChange={() => void share(p, 'finance')} label="Скрытые финансовые параметры" /><Note>Ничего не открывается автоматически. Закрыть можно в любой момент.</Note></div>}
        </Card>))}
      {hist && <Sheet title="История переговоров" onClose={() => setHist(null)}>{hist.map((h, i) => <p key={i} className="text-sm" style={{ color: 'var(--t2)' }}><span style={{ color: 'var(--t3)' }}>{new Date(h.at).toLocaleString('ru-RU')}</span> · {h.byMe ? 'Вы' : 'Собеседник'}: {evText(h.event)}</p>)}</Sheet>}
      {rep && <ReportSheet path={`/api/life/biz/proposals/${rep}/report`} onClose={() => setRep(null)} />}
    </div>
  );
};
const Favorites = () => {
  const f = useLoad(async () => (await J<{ posts: { id: string; kind: string; title: string }[]; profiles: { ownerId: string; name: string; city?: string; industries?: string[] }[] }>('/api/life/biz/favorites')).data, []);
  const c = useLoad(async () => (await J<{ contacts: { proposalId: string; postTitle: string; name: string; username: string; contact: string | null }[] }>('/api/life/biz/contacts')).data, []); const [open, setOpen] = useState<string | null>(null);
  if (!f.data) return <Spinner />;
  return (
    <div className="space-y-3">
      <H>Избранное</H>
      {!f.data.posts.length && !f.data.profiles.length ? <Empty text="В избранном пока ничего" hint="Нажмите звезду в публикации, чтобы сохранить кандидата." /> : <>
        {f.data.posts.map((p) => <Card key={p.id} onClick={() => setOpen(p.id)}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.title}</p><p className="text-[11px]" style={{ color: 'var(--t3)' }}>{KIND[p.kind]}</p></Card>)}
        {f.data.profiles.map((p) => <Card key={p.ownerId}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{p.name}</p><p className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">{p.city} {(p.industries ?? []).join(', ')}</p></Card>)}</>}
      <H>Сохранённые контакты</H><Note>Здесь контакты, которые авторы сами открыли вам после принятия вашего предложения.</Note>
      {!c.data?.contacts.length ? <Empty text="Открытых контактов пока нет" /> : c.data.contacts.map((x) => <Card key={x.proposalId}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{x.name} @{x.username}</p><p className="text-sm" style={{ color: 'var(--t2)' }} translate="no">{x.contact}</p><p className="text-[11px]" style={{ color: 'var(--t3)' }} translate="no">по публикации «{x.postTitle}»</p></Card>)}
      {open && <PostDetail id={open} onClose={() => setOpen(null)} onChanged={() => void f.reload()} />}
    </div>
  );
};

export const BusinessScreen = () => {
  const [tab, setTab] = useState<'partners' | 'investors' | 'cofounders' | 'investees' | 'offers' | 'favs' | 'mine'>('partners');
  const inbox = useLoad(async () => (await J<{ proposals: Prop[] }>('/api/life/biz/proposals?box=in')).data, [tab]);
  const newOffers = (inbox.data?.proposals ?? []).filter((p) => p.status === 'sent').length;
  return (
    <div className="space-y-3">
      <H>Бизнес-связи</H>
      <Seg id="biz" value={tab} onChange={setTab} items={[{ v: 'partners', l: 'Поиск партнёров' }, { v: 'investors', l: 'Поиск инвесторов' }, { v: 'cofounders', l: 'Ищу сооснователя' }, { v: 'investees', l: 'Я инвестор' }, { v: 'offers', l: 'Предложения', badge: newOffers }, { v: 'favs', l: 'Избранное' }, { v: 'mine', l: 'Мои' }]} />
      {tab === 'partners' && <SearchTab tab="partners" createKind="partner" />}
      {tab === 'investors' && <SearchTab tab="investors" createKind="investor_ask" />}
      {tab === 'cofounders' && <SearchTab tab="cofounders" createKind="cofounder" />}
      {tab === 'investees' && <SearchTab tab="investees" createKind="investor" />}
      {tab === 'offers' && <Proposals />}{tab === 'favs' && <Favorites />}
      {tab === 'mine' && <><MyCard /><H>Мои публикации</H><MyPosts /></>}
    </div>
  );
};
