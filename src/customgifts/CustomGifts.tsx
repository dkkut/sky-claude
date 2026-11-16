/**
 * Свои подарки (вкладка «Свои» в Sky Gifts): каталог разрешённых, «Создать подарок» с предпросмотром, мои подарки со статусами, полученные, отправка.
 * Сервер: server/customgifts.mjs. Файл проверяется по содержимому; одобряет модератор. Дарение бесплатное, но ограничено по числу в сутки.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StoryImg, StoryVideo } from '@/stories/StoryMedia';
import { SkyLoader } from '@/shared/SkyLoader';
import { flash } from '@/shared/flash';
import { apiCall, apiRawAuthed, apiSearchPeople, type DirectoryPerson } from '@/core/auth/api';

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const FRAME: Record<string, { label: string; bg: string; border: string }> = {
  classic: { label: 'Классика', bg: 'linear-gradient(135deg,#1f2937,#111827)', border: '#4b5563' },
  aurora: { label: 'Сияние', bg: 'linear-gradient(135deg,#312e81,#0e7490)', border: '#22d3ee' },
  sunset: { label: 'Закат', bg: 'linear-gradient(135deg,#9a3412,#be185d)', border: '#fb923c' },
  mint: { label: 'Мята', bg: 'linear-gradient(135deg,#065f46,#0f766e)', border: '#34d399' },
  gold: { label: 'Золото', bg: 'linear-gradient(135deg,#78350f,#a16207)', border: '#fbbf24' },
  night: { label: 'Ночь', bg: 'linear-gradient(135deg,#0f172a,#1e1b4b)', border: '#818cf8' },
};
const STATUS: Record<string, string> = { draft: 'Черновик', pending: 'На проверке', extra_review: 'На дополнительной проверке', approved: 'В каталоге', rejected: 'Отклонён', withdrawn: 'Снят', removed: 'Убран модерацией' };
const ERR: Record<string, string> = {
  unsupported_media: 'Нужно фото (PNG, JPEG, WebP, GIF) или видео (MP4, WebM).', too_large: 'Файл слишком большой: фото до 3 МБ, видео до 12 МБ.', file_blocked: 'Файл похож на опасный и отклонён.', scan_unavailable: 'Проверка файлов сейчас недоступна, попробуйте позже.',
  media_required: 'Сначала добавьте фото или видео.', not_editable: 'После отправки на проверку подарок не меняется.', bad_state: 'В этом статусе так сделать нельзя.', too_many_gifts: 'Слишком много подарков.', too_many_submissions: 'Слишком много отправок на проверку за сутки.',
  daily_limit: 'Лимит подарков на сегодня исчерпан.', pair_limit: 'Одному человеку можно подарить не больше 3 подарков в сутки.', recipient_not_accepting: 'Человек не принимает сообщения от вас.', recipient_not_found: 'Человек не найден.', invalid_recipient: 'Выберите другого человека.',
  not_found: 'Не найдено.', bad_field: 'Проверьте поле.', too_many_requests: 'Слишком часто, подождите.',
};
const errText = (d?: Data, e?: string) => (d?.message as string) || ERR[d?.error ?? e ?? ''] || `Не получилось (${d?.error ?? e})`;
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'plain' | 'red' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-2xl px-4 py-2 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);

/** Оформленная карточка подарка: рамка по стилю, файл — через запрос с токеном (теги не шлют Authorization). */
export const GiftFace = ({ g, src, kind, size = 120 }: { g: { name: string; style: string; mediaKind?: string | null }; src?: string; kind?: string | null; size?: number }) => {
  const f = FRAME[g.style] ?? FRAME.classic; const k = kind ?? g.mediaKind;
  return (
    <div className="overflow-hidden rounded-3xl" style={{ width: size, background: f.bg, border: `2px solid ${f.border}`, boxShadow: `0 6px 24px ${f.border}33` }}>
      <div className="aspect-square w-full" style={{ background: 'rgba(0,0,0,.25)' }}>
        {src && (k === 'video' ? <StoryVideo src={src} className="h-full w-full object-cover" muted loop autoPlay /> : <StoryImg src={src} className="h-full w-full object-cover" />)}
      </div>
      <p translate="no" className="truncate px-2 py-1.5 text-center text-[11px] font-bold text-white">{g.name || 'Без названия'}</p>
    </div>
  );
};

const Send = ({ gift, onClose }: { gift: Data; onClose: () => void }) => {
  const [q, setQ] = useState(''); const [people, setPeople] = useState<DirectoryPerson[]>([]); const [to, setTo] = useState<DirectoryPerson | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.trim().length < 2) { setPeople([]); return; } const t = setTimeout(() => void apiSearchPeople(q.trim()).then((r) => setPeople(r.ok ? r.data?.people ?? [] : [])), 250); return () => clearTimeout(t); }, [q]);
  const send = async () => {
    if (!to) return; setBusy(true);
    const r = await apiCall<Data>(`/api/custom-gifts/${gift.id}/send`, { method: 'POST', body: JSON.stringify({ recipientId: to.id, message: msg }) }); setBusy(false);
    if (!r.ok || r.data?.error) { flash(errText(r.data, r.error)); return; } flash('Подарок отправлен'); onClose();
  };
  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <p className="text-sm font-bold" style={{ color: C.t1 }}>{`Подарить «${gift.name}»`}</p>
      <input value={q} onChange={(e) => { setQ(e.target.value); setTo(null); }} placeholder="Имя или @ник" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
      {!to && people.map((p) => <button key={p.id} type="button" onClick={() => { setTo(p); setPeople([]); }} className="block w-full rounded-xl px-3 py-1.5 text-left text-sm" style={{ background: C.l2, color: C.t1 }}><span translate="no">{p.name} @{p.username}</span></button>)}
      {to && <p className="text-xs" style={{ color: C.green }}><span translate="no">{to.name}</span></p>}
      <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} placeholder="Сообщение (необязательно)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
      <p className="text-[11px]" style={{ color: C.t3 }}>Дарение бесплатное; не больше 20 подарков в сутки и 3 одному человеку.</p>
      <div className="flex gap-2"><Btn disabled={!to || busy} onClick={() => void send()}>Отправить</Btn><Btn tone="plain" onClick={onClose}>Отмена</Btn></div>
    </div>
  );
};

const Creator = ({ editId, onDone }: { editId?: string; onDone: () => void }) => {
  const [id, setId] = useState(editId ?? ''); const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [style, setStyle] = useState('classic');
  const [preview, setPreview] = useState<{ url: string; kind: string } | null>(null); const [busy, setBusy] = useState(false); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const save = async (): Promise<string | null> => {
    const body = JSON.stringify({ name, description: desc, style });
    if (id) { const r = await apiCall<Data>(`/api/custom-gifts/${id}`, { method: 'PUT', body }); if (!r.ok || r.data?.error) { flash(errText(r.data, r.error)); return null; } return id; }
    const r = await apiCall<Data>('/api/custom-gifts', { method: 'POST', body }); if (!r.ok || r.data?.error) { flash(errText(r.data, r.error)); return null; } setId(r.data?.id); return r.data?.id;
  };
  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    if (file.size > 12 * 1024 * 1024) { flash(ERR.too_large); return; }
    setBusy(true); const gid = await save(); if (!gid) { setBusy(false); return; }
    const res = await apiRawAuthed(`/api/custom-gifts/${gid}/media`, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
    const data = await res.json().catch(() => ({})); setBusy(false);
    if (!res.ok || data?.error) { flash(errText(data)); return; }
    setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return { url: URL.createObjectURL(file), kind: data.kind }; });
  };
  const submit = async () => {
    setBusy(true); const gid = await save(); if (!gid) { setBusy(false); return; }
    const r = await apiCall<Data>(`/api/custom-gifts/${gid}/submit`, { method: 'POST', body: '{}' }); setBusy(false);
    if (!r.ok || r.data?.error) { flash(errText(r.data, r.error)); return; } flash('Отправлено на проверку'); onDone();
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <label className="block text-[11px]" style={{ color: C.t3 }}>Название<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field} /></label>
          <label className="block text-[11px]" style={{ color: C.t3 }}>Описание<textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={400} rows={3} className="mt-0.5 block w-full rounded-xl px-3 py-2 text-sm" style={field} /></label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Оформление">{Object.entries(FRAME).map(([k, f]) => <button key={k} type="button" role="radio" aria-checked={style === k} onClick={() => setStyle(k)} className="rounded-full px-3 py-1 text-[11px] font-bold text-white" style={{ background: f.bg, border: `2px solid ${style === k ? '#fff' : f.border}` }}>{f.label}</button>)}</div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" className="hidden" onChange={(e) => void pick(e)} />
          <Btn tone="plain" disabled={busy || name.trim().length < 2} onClick={() => fileRef.current?.click()}>{preview ? 'Заменить фото или видео' : 'Выбрать фото или видео'}</Btn>
          <p className="text-[11px]" style={{ color: C.t3 }}>Фото до 3 МБ, видео до 12 МБ. Файл проверяется по содержимому и на вредоносный код; программы и скрипты под видом фото не принимаются. Подарок появится в каталоге только после одобрения модератора.</p>
        </div>
        <div><p className="mb-1 text-[11px]" style={{ color: C.t3 }}>Предпросмотр</p><GiftFace g={{ name, style }} src={preview?.url} kind={preview?.kind} /></div>
      </div>
      <div className="flex gap-2"><Btn disabled={busy || !preview} onClick={() => void submit()}>Отправить на проверку</Btn><Btn tone="plain" disabled={busy || name.trim().length < 2} onClick={() => void save().then((g) => { if (g) { flash('Черновик сохранён'); onDone(); } })}>Сохранить черновик</Btn></div>
    </div>
  );
};

export const CustomGifts = () => {
  const [tab, setTab] = useState<'catalog' | 'mine' | 'received' | 'create'>('catalog'); const [list, setList] = useState<Data[] | null>(null); const [send, setSend] = useState<Data | null>(null); const [q, setQ] = useState('');
  const load = useCallback(async () => {
    setList(null);
    const path = tab === 'catalog' ? `/api/custom-gifts/catalog?q=${encodeURIComponent(q)}` : tab === 'mine' ? '/api/custom-gifts/mine' : '/api/custom-gifts/received';
    if (tab === 'create') return;
    const r = await apiCall<Data>(path); setList(r.ok ? (r.data?.gifts ?? r.data?.sends ?? []) : []);
  }, [tab, q]);
  useEffect(() => { const t = setTimeout(() => void load(), tab === 'catalog' ? 250 : 0); return () => clearTimeout(t); }, [load, tab]);
  const withdraw = async (id: string) => { const r = await apiCall<Data>(`/api/custom-gifts/${id}/withdraw`, { method: 'POST', body: '{}' }); if (!r.ok || r.data?.error) flash(errText(r.data, r.error)); else void load(); };
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="glass-pill flex gap-1 p-1" role="tablist">{([['catalog', 'Каталог'], ['mine', 'Мои'], ['received', 'Полученные'], ['create', 'Создать подарок']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSend(null); }} className="relative isolate min-w-0 flex-1 rounded-full px-2 py-1.5 text-[11px] font-bold" style={{ color: tab === k ? C.t1 : C.t3 }}>
            {tab === k && <span className="glass-lens absolute inset-0 -z-10 rounded-full" />}{l}</button>))}</div>
        {tab === 'create' ? <Creator onDone={() => setTab('mine')} /> : (
          <>
            {tab === 'catalog' && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию" className="w-full rounded-2xl px-3 py-2 text-sm" style={field} />}
            {send && <Send gift={send} onClose={() => setSend(null)} />}
            {!list ? <SkyLoader /> : list.length === 0 ? <p className="text-sm" style={{ color: C.t3 }}>{tab === 'catalog' ? 'В каталоге пока нет подарков.' : tab === 'mine' ? 'Вы ещё не создавали подарки.' : 'Полученных подарков нет.'}</p> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.map((g) => tab === 'received' ? (
                <div key={g.id} className="space-y-1">{g.removed ? <div className="rounded-3xl p-3 text-center text-[11px]" style={{ background: C.l2, color: C.t3 }}>Подарок убран модерацией</div> : <GiftFace g={{ name: g.giftName, style: g.style, mediaKind: g.mediaKind }} src={`/api/custom-gifts/${g.giftId}/media`} />}
                  <p className="text-[11px]" style={{ color: C.t3 }}>От <span translate="no">{g.fromName}</span></p>{g.message && <p translate="no" className="text-[11px]" style={{ color: C.t2 }}>{g.message}</p>}</div>
              ) : (
                <div key={g.id} className="space-y-1"><GiftFace g={g as { name: string; style: string; mediaKind?: string }} src={g.hasMedia ? `/api/custom-gifts/${g.id}/media` : undefined} />
                  {tab === 'mine' && <p className="text-[11px]" style={{ color: g.status === 'approved' ? C.green : g.status === 'rejected' || g.status === 'removed' ? C.red : C.amber }}>{STATUS[g.status]}</p>}
                  {tab === 'mine' && g.reason && <p translate="no" className="text-[11px]" style={{ color: C.t3 }}>{`Причина: ${g.reason}`}</p>}
                  {tab === 'catalog' && <p className="text-[11px]" style={{ color: C.t3 }}>Автор: <span translate="no">{g.authorName}</span></p>}
                  <div className="flex flex-wrap gap-1">{g.status === 'approved' && <Btn onClick={() => setSend(g)}>Подарить</Btn>}{tab === 'mine' && ['draft', 'pending', 'approved', 'rejected', 'extra_review'].includes(g.status) && <Btn tone="plain" onClick={() => void withdraw(g.id)}>Снять</Btn>}</div></div>))}</div>)}
          </>)}
      </div>
    </div>
  );
};
export default CustomGifts;
