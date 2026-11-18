/** Sky Life: записи («Моя жизнь», «Важные вещи», «Воспоминания»), редактор записи, файлы записи. Текст хранится на сервере зашифрованным. */
import { useRef, useState } from 'react';
import { Plus, Paperclip, Trash2, Search, Check as CheckIcon, Shield } from 'lucide-react';
import { flash } from '@/shared/flash';
import { J, uploadLife, openLifeFile, errText, fmtDate, fmtSize, toLocalInput, fromLocalInput, type Item, type LFile } from './api';
import { Card, H, Btn, Chip, Empty, Field, TextIn, Area, Pick, Sheet, Spinner, Note, Seg, useLoad, useAct } from './ui';

type Cats = { system: { id: string; name: string }[]; custom: { id: string; name: string }[] };
const PRIO = [{ v: 0, l: 'Низкий' }, { v: 1, l: 'Обычный' }, { v: 2, l: 'Высокий' }, { v: 3, l: 'Срочно' }];
export const DOC_TYPES = ['Договор', 'Гарантия', 'Чек / покупка', 'Страховка', 'Инструкция', 'Документ', 'Обязательство', 'Экстренный контакт'];

export const FilesBox = ({ itemId, files, onChange }: { itemId: string; files: LFile[]; onChange: () => void }) => {
  const ref = useRef<HTMLInputElement>(null); const { busy, act } = useAct();
  const pick = async (f?: File) => { if (!f) return; await act(async () => { const r = await uploadLife({ itemId }, f); if (r.ok) onChange(); return r as { ok: boolean; error?: string }; }, 'Файл добавлен'); if (ref.current) ref.current.value = ''; };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>Файлы и фото</p>
        <Btn small tone="plain" disabled={busy} onClick={() => ref.current?.click()}><Paperclip size={12} className="mr-1 inline" />Добавить</Btn></div>
      <input ref={ref} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.odp" onChange={(e) => void pick(e.target.files?.[0])} />
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
          <button type="button" className="min-w-0 flex-1 truncate text-left text-sm" style={{ color: 'var(--t1)' }} onClick={() => void openLifeFile(f).then((ok) => !ok && flash('Не удалось открыть файл'))} translate="no">{f.name}</button>
          <span className="text-[10px]" style={{ color: 'var(--t3)' }}>{fmtSize(f.bytes)}</span>
          <button type="button" aria-label="Удалить файл" onClick={async () => { if (window.confirm('Удалить файл навсегда?')) { const r = await J(`/api/life/files/${f.id}`, 'DELETE'); if (r.ok) onChange(); else flash(errText(r.error)); } }}><Trash2 size={14} style={{ color: '#ef4444' }} /></button>
        </div>
      ))}
      <Note>Файлы шифруются и проверяются на вредоносное содержимое. Их видите только вы.</Note>
    </div>
  );
};

export const ItemEditor = ({ kind, item, cats, defaults, onClose, onSaved }: { kind: string; item: Item | null; cats?: Cats; defaults?: Partial<Item>; onClose: () => void; onSaved: () => void }) => {
  const [title, setTitle] = useState(item?.title ?? ''); const [desc, setDesc] = useState(item?.description ?? ''); const [cat, setCat] = useState(item?.category ?? defaults?.category ?? '');
  const [due, setDue] = useState(toLocalInput(item?.dueAt)); const [ev, setEv] = useState(toLocalInput(item?.eventAt)); const [rem, setRem] = useState(toLocalInput(item?.remindAt));
  const [prio, setPrio] = useState(item?.priority ?? 1); const [tags, setTags] = useState((item?.tags ?? []).join(', ')); const [place, setPlace] = useState(item?.extra?.place ?? '');
  const [docType, setDocType] = useState(item?.extra?.docType ?? DOC_TYPES[0]); const [em, setEm] = useState(item?.extra?.emergency ?? { name: '', phone: '', relation: '' });
  const [full, setFull] = useState<Item | null>(item); const { busy, act } = useAct();
  const reload = async () => { if (item) { const r = await J<{ item: Item }>(`/api/life/items/${item.id}`); if (r.ok && r.data) setFull(r.data.item); } onSaved(); };
  const extra: Record<string, unknown> = kind === 'important' ? { docType, ...(docType === 'Экстренный контакт' ? { emergency: em } : {}) } : (kind === 'memory' || kind === 'entry') ? { place } : {};
  const save = async () => {
    const body = { kind, title, description: desc, tags: tags.split(',').map((x) => x.trim()).filter(Boolean), priority: prio, dueAt: fromLocalInput(due), eventAt: fromLocalInput(ev), remindAt: fromLocalInput(rem), category: kind === 'entry' ? (cat || null) : undefined, extra };
    const r = await act(() => (item ? J(`/api/life/items/${item.id}`, 'PUT', body) : J('/api/life/items', 'POST', body)), 'Сохранено'); if (r?.ok) { onSaved(); onClose(); }
  };
  const label = kind === 'important' ? 'важное' : kind === 'memory' ? 'воспоминание' : 'запись';
  return (
    <Sheet title={item ? `Изменить: ${label}` : `Новая запись: ${label}`} onClose={onClose}>
      <Field label="Название"><TextIn value={title} onChange={setTitle} max={200} placeholder={kind === 'important' ? 'Например: Гарантия на ноутбук' : 'О чём запись'} /></Field>
      <Field label="Описание"><Area value={desc} onChange={setDesc} rows={4} max={5000} /></Field>
      {kind === 'entry' && cats && <Field label="Категория"><Pick value={cat} onChange={setCat} options={[{ v: '', l: 'Без категории' }, ...cats.system.map((c) => ({ v: c.id, l: c.name })), ...cats.custom.map((c) => ({ v: c.id, l: `${c.name} (моя)` }))]} /></Field>}
      {kind === 'important' && <Field label="Тип"><Pick value={docType} onChange={setDocType} options={DOC_TYPES.map((d) => ({ v: d, l: d }))} /></Field>}
      {kind === 'important' && docType === 'Экстренный контакт' && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Имя"><TextIn value={em.name} onChange={(v) => setEm({ ...em, name: v })} /></Field><Field label="Телефон"><TextIn value={em.phone} onChange={(v) => setEm({ ...em, phone: v })} /></Field><Field label="Кем приходится"><TextIn value={em.relation} onChange={(v) => setEm({ ...em, relation: v })} /></Field></div>)}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {kind === 'memory' ? <Field label="Когда это было"><TextIn type="date" value={ev.slice(0, 10)} onChange={(v) => setEv(v ? `${v}T12:00` : '')} /></Field>
          : <Field label={kind === 'important' ? 'Срок действия до' : 'Срок / дата'}><TextIn type="datetime-local" value={due} onChange={setDue} /></Field>}
        {kind !== 'memory' && kind !== 'important' && <Field label="Событие (если отличается)"><TextIn type="datetime-local" value={ev} onChange={setEv} /></Field>}
        {kind !== 'memory' && <Field label="Напомнить"><TextIn type="datetime-local" value={rem} onChange={setRem} /></Field>}
        {kind !== 'memory' && <Field label="Приоритет"><Pick value={prio} onChange={setPrio} options={PRIO} /></Field>}
      </div>
      {(kind === 'memory' || kind === 'entry') && <Field label="Место"><TextIn value={place} onChange={setPlace} max={120} /></Field>}
      <Field label="Теги (через запятую)"><TextIn value={tags} onChange={setTags} /></Field>
      {kind === 'important' && <div className="flex gap-2 rounded-2xl p-3 text-[12px]" style={{ background: 'rgba(245,158,11,.1)', color: 'var(--t2)' }}><Shield size={15} className="shrink-0" style={{ color: '#f59e0b' }} /><span>Не сохраняйте здесь банковские пароли, коды подтверждения, номера карт и секретные ключи — Sky Life не хранилище паролей, такие записи будут отклонены.</span></div>}
      {item && full && <FilesBox itemId={item.id} files={full.fileList ?? []} onChange={() => void reload()} />}
      {!item && <Note>Файлы можно добавить после первого сохранения.</Note>}
      <div className="flex justify-end gap-2 pt-1"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy || !title.trim()} onClick={() => void save()}>Сохранить</Btn></div>
    </Sheet>
  );
};

export const ItemsScreen = ({ kind, heading, intro }: { kind: 'entry' | 'important' | 'memory'; heading: string; intro: string }) => {
  const [cat, setCat] = useState(''); const [q, setQ] = useState(''); const [status, setStatus] = useState<'open' | 'done' | 'all'>('all'); const [year, setYear] = useState('');
  const [edit, setEdit] = useState<Item | null | 'new'>(null); const [newCat, setNewCat] = useState(false); const [catName, setCatName] = useState(''); const { busy, act } = useAct();
  const cats = useLoad(async () => (await J<Cats>('/api/life/categories')).data, []);
  const list = useLoad(async () => (await J<{ items: Item[]; total: number }>(`/api/life/items?kind=${kind}${cat ? `&category=${encodeURIComponent(cat)}` : ''}${status !== 'all' ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${year ? `&year=${year}` : ''}&parentId=none&limit=200`)).data, [kind, cat, q, status, year]);
  const src = useLoad(async () => (kind === 'memory' ? (await J<{ sources: { id: string; title: string; at: string; added: boolean }[] }>('/api/life/memory/sources')).data : null), [kind]);
  const toggle = async (it: Item) => { const r = await J(`/api/life/items/${it.id}`, 'PUT', { status: it.status === 'done' ? 'open' : 'done' }); if (r.ok) void list.reload(); else flash(errText(r.error)); };
  const items = list.data?.items ?? []; const years = [...new Set(items.map((i) => new Date(i.eventAt ?? i.createdAt).getFullYear()))].sort((a, b) => b - a);
  const byYear = kind === 'memory' ? years.map((y) => ({ y, items: items.filter((i) => new Date(i.eventAt ?? i.createdAt).getFullYear() === y) })) : [{ y: 0, items }];
  return (
    <div className="space-y-3">
      <H right={<Btn small onClick={() => setEdit('new')}><Plus size={13} className="mr-1 inline" />Добавить</Btn>}>{heading}</H>
      <Note>{intro}</Note>
      <div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--t3)' }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по записям" className="w-full rounded-2xl py-2.5 pl-9 pr-3 text-sm outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} /></div>
      {kind === 'entry' && cats.data && (
        <div className="flex flex-wrap gap-1.5">
          {[{ id: '', name: 'Все' }, ...cats.data.system, ...cats.data.custom].map((c) => (
            <button key={c.id || 'all'} type="button" onClick={() => setCat(c.id)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: cat === c.id ? 'rgba(139,92,246,.2)' : 'var(--bg-l2)', color: cat === c.id ? '#a78bfa' : 'var(--t2)', border: '1px solid var(--border)' }} translate="no">{c.name}</button>))}
          <button type="button" onClick={() => setNewCat(true)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ border: '1px dashed var(--border)', color: 'var(--t3)' }}>+ своя категория</button>
        </div>)}
      {kind !== 'memory' && <Seg id={`st-${kind}`} value={status} onChange={setStatus} items={[{ v: 'all', l: 'Все' }, { v: 'open', l: 'В работе' }, { v: 'done', l: 'Выполнено' }]} />}
      {kind === 'memory' && years.length > 1 && <Seg id="yr" value={year || 'all'} onChange={(v) => setYear(v === 'all' ? '' : v)} items={[{ v: 'all', l: 'Все годы' }, ...years.map((y) => ({ v: String(y), l: String(y) }))]} />}
      {kind === 'memory' && src.data?.sources?.some((s) => !s.added) && (
        <Card><p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Добавить из Sky</p><Note>Только то, что Sky реально знает о вас. Добавляется по вашему нажатию.</Note>
          <div className="mt-2 space-y-1.5">{src.data.sources.filter((s) => !s.added).map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2"><span className="text-sm" style={{ color: 'var(--t2)' }}>{s.title} · {fmtDate(s.at)}</span><Btn small tone="plain" disabled={busy} onClick={async () => { const r = await act(() => J('/api/life/memory/import', 'POST', { source: s.id }), 'Добавлено'); if (r?.ok) { void list.reload(); void src.reload(); } }}>Добавить</Btn></div>))}</div></Card>)}
      {!list.data ? <Spinner /> : !items.length ? <Empty text="Здесь пока пусто" hint="Добавьте первую запись — она сохранится на сервере и будет доступна на всех ваших устройствах." action={<Btn small onClick={() => setEdit('new')}>Добавить</Btn>} /> : byYear.map((g) => (
        <div key={g.y} className="space-y-2">{kind === 'memory' && <p className="pt-1 text-sm font-black" style={{ color: '#a78bfa' }}>{g.y}</p>}
          {g.items.map((it) => (
            <Card key={it.id}>
              <div className="flex items-start gap-3">
                {kind !== 'memory' && kind !== 'important' && <button type="button" aria-label={it.status === 'done' ? 'Вернуть в работу' : 'Отметить выполненным'} onClick={() => void toggle(it)} className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ border: '2px solid #8b5cf6', background: it.status === 'done' ? '#8b5cf6' : 'transparent' }}>{it.status === 'done' && <CheckIcon size={13} color="#fff" />}</button>}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(it)}>
                  <p className="truncate text-sm font-bold" style={{ color: 'var(--t1)', textDecoration: it.status === 'done' ? 'line-through' : 'none' }} translate="no">{it.title}</p>
                  {it.description && <p className="mt-0.5 line-clamp-2 text-[12px]" style={{ color: 'var(--t3)' }} translate="no">{it.description}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {it.dueAt && <Chip tone={it.status === 'open' && new Date(it.dueAt) < new Date() ? 'bad' : undefined}>{kind === 'important' ? 'до ' : ''}{fmtDate(it.dueAt)}</Chip>}
                    {it.eventAt && kind !== 'memory' && <Chip>{fmtDate(it.eventAt)}</Chip>}
                    {it.priority >= 2 && <Chip tone="warn">{it.priority === 3 ? 'срочно' : 'важно'}</Chip>}
                    {kind === 'important' && it.extra?.docType && <Chip tone="acc">{it.extra.docType}</Chip>}
                    {(it.files ?? 0) > 0 && <Chip>📎 {it.files}</Chip>}
                    {it.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
                  </div>
                </button>
                <button type="button" aria-label="Удалить" onClick={async () => { if (window.confirm('Удалить запись и её файлы навсегда?')) { const r = await J(`/api/life/items/${it.id}`, 'DELETE'); if (r.ok) void list.reload(); else flash(errText(r.error)); } }}><Trash2 size={15} style={{ color: 'var(--t3)' }} /></button>
              </div>
            </Card>))}
        </div>))}
      {edit && <ItemEditor kind={kind} item={edit === 'new' ? null : edit} cats={cats.data ?? undefined} defaults={{ category: cat }} onClose={() => setEdit(null)} onSaved={() => void list.reload()} />}
      {newCat && <Sheet title="Своя категория" onClose={() => setNewCat(false)}><Field label="Название"><TextIn value={catName} onChange={setCatName} max={30} /></Field>
        <div className="flex justify-end"><Btn disabled={busy || catName.trim().length < 2} onClick={async () => { const r = await act(() => J('/api/life/categories', 'POST', { name: catName }), 'Категория создана'); if (r?.ok) { setCatName(''); setNewCat(false); void cats.reload(); } }}>Создать</Btn></div></Sheet>}
    </div>
  );
};
