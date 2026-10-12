/**
 * Вкладка «Сайт»: лендинг на корневом домене управляется отсюда. Скачивание (версии и загрузка файлов apk/exe/…),
 * ссылки, статус сервисов, апелляции и заявки на релиз контента, поданные с сайта. Сервер — server/sitecms.mjs, право `site`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Trash2, Save, Plus, Paperclip, Check, Wrench } from 'lucide-react';
import { apiCall, getAccessToken, uploadUrl, nativeXhrHeaders } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', l3: 'var(--bg-l3)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const card = { background: C.l1, border: `1px solid ${C.brd}` };
const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none';

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', bad_url: 'Адрес должен начинаться с https:// (или mailto:).', bad_key: 'Ключ: латиница, цифры и _, от 2 знаков.', bad_extension: 'Файл не того типа: нужны apk, exe, msi, dmg, deb, ipa, zip или AppImage.',
  file_too_large: 'Файл слишком большой (до 600 МБ).', upload_interrupted: 'Загрузка оборвалась — повторите.', empty_file: 'Файл пустой.', answer_required: 'Напишите ответ человеку (от 3 знаков).',
  bad_until: 'Не удалось разобрать дату окончания.', until_in_past: 'Время окончания уже прошло.', bad_status: 'Неизвестный статус.', bad_state: 'Неизвестное состояние сервиса.', too_many_requests: 'Слишком часто. Подождите минуту.', name_required: 'У сервиса должно быть название.',
};
const msg = (r: { error?: string; reason?: string; status: number }) => (r.status === 413 ? ERR.file_too_large : ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось');
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const fmtDt = (iso: string) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ── Скачивание ───────────────────────────────────────────────── */
interface Dl { platform: string; title: string; icon: string; info: string; version: string; button: string; status: 'available' | 'soon' | 'hidden'; url: string;
  file: { name: string; size: number; sha256: string; downloads: number; uploadedAt: string } | null }
const DL_STATUS: Record<string, string> = { available: 'Доступно', soon: 'Скоро', hidden: 'Скрыто с сайта' };

const DownloadCard = ({ d, onChanged }: { d: Dl; onChanged: () => void }) => {
  const [f, setF] = useState(d); const [busy, setBusy] = useState(false); const [pct, setPct] = useState<number | null>(null);
  const pick = useRef<HTMLInputElement>(null); const xhr = useRef<XMLHttpRequest | null>(null);
  useEffect(() => setF(d), [d]);
  const dirty = JSON.stringify({ ...f, file: null }) !== JSON.stringify({ ...d, file: null });
  const save = async () => {
    setBusy(true);
    const r = await apiCall(`/api/admin/site/downloads/${d.platform}`, { method: 'PUT', body: JSON.stringify({ title: f.title, info: f.info, version: f.version, button: f.button, status: f.status, url: f.url }) });
    setBusy(false);
    if (!r.ok) { flash(msg(r)); return; }
    flash('Сохранено'); onChanged();
  };
  const upload = (file: File) => {
    const x = new XMLHttpRequest(); xhr.current = x; setPct(0);
    x.open('POST', uploadUrl(`/api/admin/site/downloads/${d.platform}/file?name=${encodeURIComponent(file.name)}`));
    x.withCredentials = !NATIVE_APP; x.setRequestHeader('Content-Type', 'application/octet-stream');
    Object.entries(nativeXhrHeaders()).forEach(([k, v]) => x.setRequestHeader(k, v));
    const tok = getAccessToken(); if (tok) x.setRequestHeader('Authorization', `Bearer ${tok}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) setPct(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    x.onload = () => {
      setPct(null); xhr.current = null;
      let data: { error?: string } = {}; try { data = JSON.parse(x.responseText); } catch { /* нет тела */ }
      if (x.status === 200) { flash('Файл загружен'); onChanged(); return; }
      flash(x.status === 413 ? ERR.file_too_large : ERR[data.error ?? ''] ?? `Не получилось (${x.status})`);
    };
    x.onerror = () => { setPct(null); flash('Нет связи с сервером'); };
    x.onabort = () => { setPct(null); flash('Загрузка отменена'); };
    x.send(file);
  };
  const drop = async () => {
    if (!window.confirm('Удалить загруженный файл? На сайте останется внешняя ссылка (если она задана).')) return;
    const r = await apiCall(`/api/admin/site/downloads/${d.platform}/file`, { method: 'DELETE' });
    if (!r.ok) { flash(msg(r)); return; } flash('Файл удалён'); onChanged();
  };
  return (
    <div className="space-y-2 rounded-2xl p-3" style={card}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold" style={{ color: C.t1 }}><span translate="no">{d.icon} {d.title}</span></p>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Dl['status'] })} className="rounded-lg px-2 py-1 text-xs" style={field} aria-label={`Статус ${d.title}`}>
          {Object.entries(DL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="Версия (например, 4.0.1)" className={inp} style={field} aria-label={`Версия ${d.title}`} />
        <input value={f.button} onChange={(e) => setF({ ...f, button: e.target.value })} placeholder="Текст кнопки" className={inp} style={field} aria-label={`Кнопка ${d.title}`} />
      </div>
      <input value={f.info} onChange={(e) => setF({ ...f, info: e.target.value })} placeholder="Описание (например, Android 8+ · .apk)" className={inp} style={field} aria-label={`Описание ${d.title}`} />
      <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="Внешняя ссылка (https://…) — если файл не загружен" className={inp} style={field} aria-label={`Ссылка ${d.title}`} />
      <div className="rounded-xl p-2.5" style={{ background: C.l2 }}>
        {d.file ? (
          <div className="space-y-1 text-xs" style={{ color: C.t2 }}>
            <p className="flex items-center gap-1.5 font-semibold" style={{ color: C.t1 }}><Paperclip size={12} /> <span translate="no">{d.file.name}</span> · {fmtSize(d.file.size)}</p>
            <p>Загружен {fmtDt(d.file.uploadedAt)} · скачали {d.file.downloads}</p>
            <p className="break-all" translate="no" style={{ color: C.t3 }}>SHA-256: {d.file.sha256}</p>
          </div>
        ) : <p className="text-xs" style={{ color: C.t3 }}>Файл не загружен — на сайте будет внешняя ссылка.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={pct !== null} onClick={() => pick.current?.click()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>
            {pct !== null ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {d.file ? 'Заменить файл' : 'Загрузить файл'}
          </button>
          {d.file && <button type="button" onClick={() => void drop()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold" style={{ background: C.l3, color: C.red }}><Trash2 size={12} /> Удалить</button>}
          {pct !== null && <button type="button" onClick={() => xhr.current?.abort()} className="rounded-lg px-3 py-1.5 text-xs" style={{ background: C.l3, color: C.t2 }}>Отмена</button>}
        </div>
        {pct !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: C.l3 }}><div className="h-full" style={{ width: `${pct}%`, background: C.acc }} /></div>}
        <input ref={pick} type="file" hidden onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) upload(fl); }} />
      </div>
      <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить карточку
      </button>
    </div>
  );
};

const DownloadsPane = () => {
  const [items, setItems] = useState<Dl[] | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ items: Dl[] }>('/api/admin/site/downloads'); if (r.ok && r.data) setItems(r.data.items); else flash(msg(r)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!items) return <Wait />;
  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: C.t3 }}>Файл, загруженный здесь, отдаётся с сайта нашим адресом (с докачкой и счётчиком скачиваний) и заменяет внешнюю ссылку. Версия и статус видны на странице «Скачать» сразу.</p>
      {items.map((d) => <DownloadCard key={d.platform} d={d} onChanged={() => void load()} />)}
    </div>
  );
};

/* ── Ссылки ───────────────────────────────────────────────────── */
interface Lk { key: string; label: string; url: string }
const LinksPane = () => {
  const [links, setLinks] = useState<Lk[] | null>(null); const [orig, setOrig] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ links: Lk[] }>('/api/admin/site/links'); if (r.ok && r.data) { setLinks(r.data.links); setOrig(JSON.stringify(r.data.links)); } else flash(msg(r)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!links) return <Wait />;
  const set = (i: number, p: Partial<Lk>) => setLinks(links.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async () => {
    const r = await apiCall('/api/admin/site/links', { method: 'PUT', body: JSON.stringify({ links }) });
    if (!r.ok) { flash(msg(r)); return; } flash('Ссылки сохранены'); void load();
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px]" style={{ color: C.t3 }}>Ключ <b>web</b> — адрес веб-версии (кнопка «Веб-версия» на сайте). Остальные подставляются в соцсети и «Связь с менеджером».</p>
      {links.map((l, i) => (
        <div key={i} className="space-y-1.5 rounded-xl p-2.5" style={card}>
          <div className="grid grid-cols-2 gap-2">
            <input value={l.label} onChange={(e) => set(i, { label: e.target.value })} className={inp} style={field} aria-label={`Название ${l.key}`} />
            <input value={l.key} onChange={(e) => set(i, { key: e.target.value })} className={inp} style={field} aria-label={`Ключ ${l.key}`} translate="no" />
          </div>
          <div className="flex gap-2">
            <input value={l.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://…" className={inp} style={field} aria-label={`Ссылка ${l.key}`} translate="no" />
            <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label={`Убрать ${l.key}`} className="rounded-xl px-3" style={{ background: C.l3, color: C.red }}><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setLinks([...links, { key: '', label: '', url: '' }])} className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.acc }}><Plus size={13} /> Добавить ссылку</button>
      <button type="button" disabled={JSON.stringify(links) === orig} onClick={() => void save()} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}><Save size={14} /> Сохранить ссылки</button>
    </div>
  );
};

/* ── Статус ───────────────────────────────────────────────────── */
interface Comp { id: string; name: string; icon: string; state: string; note: string }
const STATES: Record<string, string> = { operational: 'Работает', degraded: 'Сбои', outage: 'Не работает', maintenance: 'Работы', dev: 'В разработке' };
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* Технические работы на сайте: баннер закрывает лендинг, приложение не затрагивается. */
const MaintenancePane = () => {
  const [m, setM] = useState<{ active: boolean; enabled: boolean; expired: boolean; title: string; text: string; until: string | null } | null>(null);
  const [f, setF] = useState({ title: '', text: '', until: '' }); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await apiCall<NonNullable<typeof m>>('/api/admin/site/maintenance');
    if (!r.ok || !r.data) { flash(msg(r)); return; }
    setM(r.data); setF({ title: r.data.title, text: r.data.text, until: toLocalInput(r.data.until) });
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!m) return <Wait />;
  const send = async (active: boolean) => {
    if (active && !window.confirm('Включить технические работы? Сайт скроется за баннером для всех посетителей.')) return;
    setBusy(true);
    const r = await apiCall('/api/admin/site/maintenance', { method: 'PUT', body: JSON.stringify({ active, title: f.title, text: f.text, until: f.until ? new Date(f.until).toISOString() : null }) });
    setBusy(false);
    if (!r.ok) { flash(msg(r)); return; }
    flash(active ? 'Технические работы включены на сайте' : 'Технические работы выключены'); void load();
  };
  return (
    <div className="mb-3 space-y-2 rounded-2xl p-3" style={{ ...card, borderColor: m.active ? C.acc : C.brd }}>
      <div className="flex items-center gap-2">
        <Wrench size={15} style={{ color: C.acc }} />
        <p className="flex-1 text-sm font-bold" style={{ color: C.t1 }}>Технические работы на сайте</p>
        <span className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: m.active ? C.acc : C.l2, color: m.active ? '#fff' : C.t3 }}>{m.active ? 'Идут' : m.expired ? 'Срок вышел' : 'Выключены'}</span>
      </div>
      <p className="text-[11px]" style={{ color: C.t3 }}>Посетители сайта увидят баннер вместо страниц. Приложение Sky это не затрагивает — для него есть общий режим работ на вкладке платформы.</p>
      <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Заголовок (по умолчанию «Технические работы»)" className={inp} style={field} aria-label="Заголовок работ" />
      <textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={2} placeholder="Что происходит и когда вернёмся (необязательно)" className={inp} style={field} aria-label="Текст работ" />
      <label className="flex items-center gap-2 text-[11px]" style={{ color: C.t2 }}>Закончить сами в
        <input type="datetime-local" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} className="rounded-lg px-2 py-1 text-xs" style={field} aria-label="Время окончания работ" />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void send(true)} className="flex-1 rounded-xl py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}>{m.active ? 'Обновить баннер' : 'Включить работы'}</button>
        {(m.active || m.enabled) && <button type="button" disabled={busy} onClick={() => void send(false)} className="rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40" style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>Выключить</button>}
      </div>
    </div>
  );
};

const StatusPane = () => {
  const [st, setSt] = useState<{ headline: string; note: string; components: Comp[] } | null>(null); const [orig, setOrig] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ headline: string; note: string; components: Comp[] }>('/api/admin/site/status'); if (r.ok && r.data) { setSt(r.data); setOrig(JSON.stringify(r.data)); } else flash(msg(r)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (!st) return <Wait />;
  const setC = (i: number, p: Partial<Comp>) => setSt({ ...st, components: st.components.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const save = async () => {
    const r = await apiCall('/api/admin/site/status', { method: 'PUT', body: JSON.stringify(st) });
    if (!r.ok) { flash(msg(r)); return; } flash('Статус обновлён на сайте'); void load();
  };
  return (
    <div className="space-y-2">
      <MaintenancePane />
      <input value={st.headline} onChange={(e) => setSt({ ...st, headline: e.target.value })} placeholder="Заголовок (необязательно): например, «Плановые работы»" className={inp} style={field} aria-label="Заголовок статуса" />
      <textarea value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} rows={2} placeholder="Что происходит (необязательно)" className={inp} style={field} aria-label="Заметка статуса" />
      {st.components.map((c, i) => (
        <div key={c.id} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl p-2.5" style={card}>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold" style={{ color: C.t1 }} translate="no">{c.icon} {c.name}</p>
            <input value={c.note} onChange={(e) => setC(i, { note: e.target.value })} placeholder="Пояснение (необязательно)" className={inp} style={field} aria-label={`Пояснение ${c.name}`} />
          </div>
          <select value={c.state} onChange={(e) => setC(i, { state: e.target.value })} className="self-start rounded-lg px-2 py-1.5 text-xs" style={field} aria-label={`Состояние ${c.name}`}>
            {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      ))}
      <button type="button" disabled={JSON.stringify(st) === orig} onClick={() => void save()} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: C.acc, color: '#fff' }}><Save size={14} /> Опубликовать статус</button>
    </div>
  );
};

/* ── Апелляции и заявки на релиз ──────────────────────────────── */
interface Item { id: string; code: string; kind: string; username?: string; title?: string; email: string; ref?: string; body?: string; data?: Record<string, string>; status: string; answer: string; createdAt: string; answeredAt: string | null }
interface Att { id: string; role: string; name: string; mime: string; size: number }
const APPEAL_KIND: Record<string, string> = { account_block: 'Блокировка аккаунта', content_removal: 'Удаление контента', order: 'Проблема с заказом', finance: 'Финансовый спор', release_rejected: 'Отклонение релиза', other: 'Другое' };
const ST_LABEL: Record<string, string> = { new: 'Новая', review: 'На рассмотрении', accepted: 'Удовлетворена', approved: 'Одобрена', rejected: 'Отклонена', closed: 'Закрыта' };

const download = async (a: Att) => {
  const r = await fetch(uploadUrl(`/api/admin/site/attachments/${a.id}`), { headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}), ...nativeXhrHeaders() }, credentials: NATIVE_APP ? 'omit' : 'same-origin' });
  if (!r.ok) { flash('Не удалось скачать файл'); return; }
  const url = URL.createObjectURL(await r.blob()); const el = document.createElement('a'); el.href = url; el.download = a.name; el.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const QueuePane = ({ kind }: { kind: 'appeals' | 'releases' }) => {
  const [status, setStatus] = useState(''); const [data, setData] = useState<{ items: Item[]; counts: Record<string, number> } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await apiCall<{ items: Item[]; counts: Record<string, number> }>(`/api/admin/site/${kind}${status ? `?status=${status}` : ''}`); if (r.ok && r.data) setData(r.data); else flash(msg(r)); }, [kind, status]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const statuses = kind === 'appeals' ? ['new', 'review', 'accepted', 'rejected', 'closed'] : ['new', 'review', 'approved', 'rejected'];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {[['', 'Открытые'], ...statuses.map((s) => [s, ST_LABEL[s]])].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className="rounded-lg px-2.5 py-1 text-[11px] font-semibold" style={{ background: status === k ? C.acc : C.l2, color: status === k ? '#fff' : C.t3 }}>
            {l}{k && data?.counts[k] ? ` · ${data.counts[k]}` : ''}
          </button>
        ))}
      </div>
      {!data ? <Wait /> : data.items.length === 0 ? <p className="py-6 text-center text-xs" style={{ color: C.t3 }}>Заявок нет.</p> : data.items.map((it) => (
        <div key={it.id} className="rounded-xl" style={card}>
          <button type="button" onClick={() => setOpen(open === it.id ? null : it.id)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" style={{ color: C.t1 }} translate="no">{it.code} · {kind === 'appeals' ? (APPEAL_KIND[it.kind] ?? it.kind) : it.title}</span>
              <span className="block truncate text-[11px]" style={{ color: C.t3 }} translate="no">{it.username ? `@${it.username} · ` : ''}{it.email} · {fmtDt(it.createdAt)}</span>
            </span>
            <span className="shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: C.l2, color: it.status === 'new' ? C.acc : C.t2 }}>{ST_LABEL[it.status] ?? it.status}</span>
          </button>
          {open === it.id && <ItemDetail kind={kind} item={it} statuses={statuses} onDone={() => { setOpen(null); void load(); }} />}
        </div>
      ))}
    </div>
  );
};

const ItemDetail = ({ kind, item, statuses, onDone }: { kind: 'appeals' | 'releases'; item: Item; statuses: string[]; onDone: () => void }) => {
  const [att, setAtt] = useState<Att[] | null>(null); const [status, setStatus] = useState(item.status); const [answer, setAnswer] = useState(item.answer); const [busy, setBusy] = useState(false);
  useEffect(() => { void apiCall<{ attachments: Att[] }>(`/api/admin/site/${kind}/${item.id}`).then((r) => setAtt(r.ok ? (r.data?.attachments ?? []) : [])); }, [kind, item.id]);
  const save = async () => {
    setBusy(true);
    const r = await apiCall(`/api/admin/site/${kind}/${item.id}/decide`, { method: 'POST', body: JSON.stringify({ status, answer }) });
    setBusy(false);
    if (!r.ok) { flash(msg(r)); return; } flash('Сохранено, человеку отправлено письмо'); onDone();
  };
  return (
    <div className="space-y-2 px-3 pb-3 text-sm" style={{ color: C.t2 }}>
      {kind === 'appeals' ? (
        <>{item.ref && <p className="text-xs" translate="no">Номер решения: {item.ref}</p>}<p className="whitespace-pre-wrap" translate="no">{item.body}</p></>
      ) : (
        <div className="space-y-0.5 text-xs" translate="no">{Object.entries(item.data ?? {}).map(([k, v]) => <p key={k}><span style={{ color: C.t3 }}>{k}:</span> {v}</p>)}</div>
      )}
      {att && att.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{att.map((a) => (
          <button key={a.id} type="button" onClick={() => void download(a)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px]" style={{ background: C.l2, color: C.t1 }}><Paperclip size={11} /> <span translate="no">{a.name}</span> · {fmtSize(a.size)}</button>
        ))}</div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg px-2 py-2 text-xs" style={field} aria-label="Статус заявки">
          {statuses.map((s) => <option key={s} value={s}>{ST_LABEL[s]}</option>)}
        </select>
        <button type="button" disabled={busy} onClick={() => void save()} className="flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold" style={{ background: C.acc, color: '#fff' }}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Сохранить и ответить</button>
      </div>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} placeholder="Ответ человеку (уйдёт на его почту; обязателен для итогового решения)" className={inp} style={field} aria-label="Ответ человеку" />
    </div>
  );
};

const Wait = () => <p className="flex items-center gap-2 text-sm" style={{ color: C.t3 }}><Loader2 size={14} className="animate-spin" /> Загрузка…</p>;

type Sub = 'downloads' | 'links' | 'status' | 'appeals' | 'releases';
export const SiteTab = () => {
  const [sub, setSub] = useState<Sub>('downloads'); const [ov, setOv] = useState<{ appealsOpen: number; releasesOpen: number; downloads: number } | null>(null);
  useEffect(() => { void apiCall<{ appealsOpen: number; releasesOpen: number; downloads: number }>('/api/admin/site/overview').then((r) => r.ok && setOv(r.data ?? null)); }, [sub]);
  const tabs: [Sub, string][] = [['downloads', 'Скачивание'], ['links', 'Ссылки'], ['status', 'Статус'], ['appeals', `Апелляции${ov?.appealsOpen ? ` · ${ov.appealsOpen}` : ''}`], ['releases', `Релиз контента${ov?.releasesOpen ? ` · ${ov.releasesOpen}` : ''}`]];
  return (
    <div className="space-y-3">
      <ScrollTabs>
        {tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setSub(k)} className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold" style={{ background: sub === k ? C.acc : C.l2, color: sub === k ? '#fff' : C.t3 }}>{l}</button>)}
      </ScrollTabs>
      {ov && <p className="text-[11px]" style={{ color: C.t3 }}>Скачиваний с сайта всего: {ov.downloads}</p>}
      {sub === 'downloads' && <DownloadsPane />}
      {sub === 'links' && <LinksPane />}
      {sub === 'status' && <StatusPane />}
      {sub === 'appeals' && <QueuePane kind="appeals" />}
      {sub === 'releases' && <QueuePane kind="releases" />}
    </div>
  );
};
