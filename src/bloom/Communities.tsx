/** Bloom → «Сообщества»: каталог, мои сообщества, создание, страница сообщества (посты, правила, участники, модерация, настройки). Права и видимость решает сервер (server/bloomcommunities.mjs). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Plus, Search, Lock, Globe2, Users, Pin, Flag, ShieldCheck, Loader2, ChevronLeft } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { useBloomStore } from './store';
import { PostCard } from './components/PostCard';
import { CreatePost } from './components/CreatePost';

type Mine = { role: 'owner' | 'mod' | 'member'; status: 'active' | 'pending' | 'banned' } | null;
type Comm = { id: string; slug: string; name: string; description: string; emoji: string; color: string; privacy: 'public' | 'closed'; postPolicy: 'all' | 'mods'; members: number; posts: number; mine: Mine; rules?: { title: string; text: string }[]; ownerId?: string;
  owner?: { id: string; name: string; username: string }; mods?: { id: string; name: string; username: string; role: string }[]; contentVisible?: boolean; blocked?: boolean; blockReason?: string };
type Member = { id: string; name: string; username: string; role: string; status: string; banReason?: string };
const ERR: Record<string, string> = { bad_name: 'Название — от 3 знаков.', bad_slug: 'Адрес: 3–30 знаков a–z, 0–9, _ (слова admin, sky и подобные заняты).', slug_taken: 'Такой адрес уже занят.', too_many_communities: 'Можно владеть не более чем 5 сообществами.', daily_limit: 'Слишком много за сутки.',
  banned: 'Вам закрыт доступ к этому сообществу.', not_member: 'Сначала вступите в сообщество.', mods_only: 'Здесь пишут только модераторы.', forbidden: 'Недостаточно прав.', reason_required: 'Укажите причину.', owner_cannot_leave: 'Владелец не может выйти — удалите сообщество или передайте его.', already_reported: 'Вы уже жаловались.', too_many_pinned: 'Закреплено уже 3 поста.', not_found: 'Не найдено.' };
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const inp = { background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
const Btn = ({ children, onClick, tone = 'acc', disabled }: { children: ReactNode; onClick: () => void; tone?: 'acc' | 'plain' | 'red'; disabled?: boolean }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-40"
    style={tone === 'acc' ? { background: 'var(--accent)', color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.14)', color: '#ef4444' } : { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>{children}</button>
);
const call = async <T,>(path: string, method = 'GET', body?: unknown) => { const r = await apiCall<T & { error?: string }>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); if (!r.ok) flash(ERR[r.error ?? ''] ?? 'Не получилось. Попробуйте ещё раз.'); return r.ok ? (r.data ?? ({} as T)) : null; };
const Cover = ({ c, size = 44 }: { c: Pick<Comm, 'emoji' | 'color'>; size?: number }) => <div className="grid shrink-0 place-items-center rounded-2xl" style={{ width: size, height: size, background: `linear-gradient(135deg, ${c.color}, color-mix(in srgb, ${c.color} 40%, #000))`, fontSize: size * 0.5 }}>{c.emoji}</div>;

/* ─── создание ────────────────────────────────────────────────────── */
const CreateForm = ({ onClose, onCreated }: { onClose: () => void; onCreated: (slug: string) => void }) => {
  const [f, setF] = useState({ name: '', slug: '', description: '', emoji: '🌸', privacy: 'public', postPolicy: 'all', rules: [{ title: '', text: '' }] }); const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <div className="fixed inset-0 z-[210] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Новое сообщество">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl" style={card}>
        <p className="text-base font-black" style={{ color: 'var(--t1)' }}>Новое сообщество</p>
        <div className="flex gap-2"><input value={f.emoji} onChange={(e) => set('emoji', e.target.value)} maxLength={4} aria-label="Значок" className="w-14 rounded-xl px-2 py-2 text-center text-xl outline-none" style={inp} /><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={50} placeholder="Название" className="min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none" style={inp} /></div>
        <div><input value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={30} placeholder="адрес_латиницей" className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} /><p className="mt-1 text-[10px]" style={{ color: 'var(--t3)' }}>3–30 знаков: a–z, 0–9 и _. Изменить потом нельзя.</p></div>
        <textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={3} placeholder="О чём это сообщество" className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none" style={inp} />
        <div className="grid grid-cols-2 gap-2">
          <select value={f.privacy} onChange={(e) => set('privacy', e.target.value)} aria-label="Доступ" className="rounded-xl px-3 py-2 text-sm outline-none" style={inp}><option value="public">Открытое — вступает любой</option><option value="closed">Закрытое — по заявке</option></select>
          <select value={f.postPolicy} onChange={(e) => set('postPolicy', e.target.value)} aria-label="Кто пишет" className="rounded-xl px-3 py-2 text-sm outline-none" style={inp}><option value="all">Пишут все участники</option><option value="mods">Пишут только модераторы</option></select>
        </div>
        <p className="text-[11px] font-bold" style={{ color: 'var(--t3)' }}>Правила</p>
        {f.rules.map((r, i) => <div key={i} className="space-y-1"><input value={r.title} onChange={(e) => set('rules', f.rules.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder={`Правило ${i + 1}`} maxLength={80} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} /><input value={r.text} onChange={(e) => set('rules', f.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="Пояснение" maxLength={400} className="w-full rounded-xl px-3 py-1.5 text-xs outline-none" style={inp} /></div>)}
        {f.rules.length < 10 && <Btn tone="plain" onClick={() => set('rules', [...f.rules, { title: '', text: '' }])}>+ правило</Btn>}
        <div className="flex justify-end gap-2"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy || f.name.trim().length < 3 || f.slug.length < 3} onClick={async () => { setBusy(true); const r = await call<{ slug: string }>('/api/bloom/communities', 'POST', { ...f, rules: f.rules.filter((x) => x.title.trim()) }); setBusy(false); if (r) onCreated(r.slug); }}>Создать</Btn></div>
      </div>
    </div>
  );
};

/* ─── страница сообщества ─────────────────────────────────────────── */
const ManagePanel = ({ c, onChanged }: { c: Comm; onChanged: () => void }) => {
  const [m, setM] = useState<{ members: Member[]; canModerate: boolean } | null>(null); const [log, setLog] = useState<{ action: string; reason: string | null; at: string; actor: string | null }[] | null>(null);
  const load = useCallback(async () => { setM(await call<{ members: Member[]; canModerate: boolean }>(`/api/bloom/communities/${c.id}/members`)); }, [c.id]);
  useEffect(() => { void load(); }, [load]);
  const isOwner = c.mine?.role === 'owner';
  const act = async (id: string, action: string, ask?: string) => { let reason: string | undefined; if (ask) { reason = window.prompt(ask) ?? ''; if (reason.trim().length < 3) return; } const r = await call(`/api/bloom/communities/${c.id}/members/${encodeURIComponent(id)}`, 'POST', { action, reason }); if (r) { void load(); onChanged(); } };
  const [edit, setEdit] = useState({ name: c.name, description: c.description, privacy: c.privacy, postPolicy: c.postPolicy, rules: c.rules ?? [] });
  if (!m) return <div className="grid h-24 place-items-center"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--t3)' }} /></div>;
  const pending = m.members.filter((x) => x.status === 'pending'); const banned = m.members.filter((x) => x.status === 'banned'); const active = m.members.filter((x) => x.status === 'active');
  const Row = ({ x }: { x: Member }) => (
    <div className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
      <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--t1)' }} translate="no">{x.name} <span style={{ color: 'var(--t3)' }}>@{x.username}</span>{x.role !== 'member' ? ` · ${x.role === 'owner' ? 'владелец' : 'модератор'}` : ''}{x.banReason ? ` · ${x.banReason}` : ''}</span>
      {x.role !== 'owner' && (<>
        {x.status === 'pending' && <><Btn onClick={() => void act(x.id, 'approve')}>Принять</Btn><Btn tone="plain" onClick={() => void act(x.id, 'reject')}>Отклонить</Btn></>}
        {x.status === 'active' && (x.role === 'member' || isOwner) && <><Btn tone="plain" onClick={() => void act(x.id, 'kick', 'Причина исключения (необязательно, мин. 3 знака)')}>Исключить</Btn><Btn tone="red" onClick={() => void act(x.id, 'ban', 'Причина блокировки')}>Бан</Btn></>}
        {x.status === 'active' && isOwner && <Btn tone="plain" onClick={() => void act(x.id, x.role === 'mod' ? 'demote' : 'promote')}>{x.role === 'mod' ? 'Снять модератора' : 'Сделать модератором'}</Btn>}
        {x.status === 'banned' && <Btn tone="plain" onClick={() => void act(x.id, 'unban')}>Разбанить</Btn>}
      </>)}
    </div>
  );
  return (
    <div className="space-y-3">
      {pending.length > 0 && <div className="space-y-1.5 rounded-2xl p-3" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Заявки ({pending.length})</p>{pending.map((x) => <Row key={x.id} x={x} />)}</div>}
      <div className="space-y-1.5 rounded-2xl p-3" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Участники ({active.length})</p>{active.map((x) => <Row key={x.id} x={x} />)}</div>
      {banned.length > 0 && <div className="space-y-1.5 rounded-2xl p-3" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Заблокированные ({banned.length})</p>{banned.map((x) => <Row key={x.id} x={x} />)}</div>}
      <div className="space-y-2 rounded-2xl p-3" style={card}><div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Журнал модерации</p><Btn tone="plain" onClick={async () => setLog((await call<{ log: typeof log }>(`/api/bloom/communities/${c.id}/log`))?.log ?? null)}>Показать</Btn></div>
        {log?.map((l, i) => <p key={i} className="text-[11px]" style={{ color: 'var(--t2)' }}>{new Date(l.at).toLocaleString('ru-RU')} · <span translate="no">{l.actor ?? '—'}</span> · {l.action}{l.reason ? ` — ${l.reason}` : ''}</p>)}</div>
      {isOwner && <div className="space-y-2 rounded-2xl p-3" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Настройки</p>
        <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={50} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={inp} aria-label="Название" />
        <textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} maxLength={500} rows={3} className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none" style={inp} aria-label="Описание" />
        <div className="grid grid-cols-2 gap-2"><select value={edit.privacy} onChange={(e) => setEdit({ ...edit, privacy: e.target.value as Comm['privacy'] })} className="rounded-xl px-3 py-2 text-sm outline-none" style={inp}><option value="public">Открытое</option><option value="closed">Закрытое</option></select><select value={edit.postPolicy} onChange={(e) => setEdit({ ...edit, postPolicy: e.target.value as Comm['postPolicy'] })} className="rounded-xl px-3 py-2 text-sm outline-none" style={inp}><option value="all">Пишут все</option><option value="mods">Только модераторы</option></select></div>
        {edit.rules.map((r, i) => <div key={i} className="flex gap-1.5"><input value={r.title} onChange={(e) => setEdit({ ...edit, rules: edit.rules.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-sm outline-none" style={inp} aria-label={`Правило ${i + 1}`} /><input value={r.text} onChange={(e) => setEdit({ ...edit, rules: edit.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} className="min-w-0 flex-[2] rounded-xl px-3 py-1.5 text-xs outline-none" style={inp} aria-label="Пояснение" /><Btn tone="plain" onClick={() => setEdit({ ...edit, rules: edit.rules.filter((_, j) => j !== i) })}>×</Btn></div>)}
        {edit.rules.length < 10 && <Btn tone="plain" onClick={() => setEdit({ ...edit, rules: [...edit.rules, { title: '', text: '' }] })}>+ правило</Btn>}
        <div className="flex flex-wrap gap-2"><Btn onClick={async () => { if (await call(`/api/bloom/communities/${c.id}`, 'PUT', edit)) { flash('Сохранено'); onChanged(); } }}>Сохранить</Btn>
          <Btn tone="red" onClick={async () => { if (window.confirm('Удалить сообщество вместе со всеми его постами? Это нельзя отменить.') && (await call(`/api/bloom/communities/${c.id}`, 'DELETE'))) { flash('Сообщество удалено'); window.dispatchEvent(new CustomEvent('sky:bloom-community', { detail: '' })); } }}>Удалить сообщество</Btn></div></div>}
    </div>
  );
};

const CommunityPage = ({ slug, onBack, onAuthorClick, onTagClick }: { slug: string; onBack: () => void; onAuthorClick: (id: string) => void; onTagClick: (t: string) => void }) => {
  const [c, setC] = useState<Comm | null | false>(null); const [sub, setSub] = useState<'posts' | 'about' | 'manage'>('posts'); const [create, setCreate] = useState(false);
  const loadCommunityPosts = useBloomStore((s) => s.loadCommunityPosts); const feedVersion = useBloomStore((s) => s.feedVersion);
  const key = c ? `c:${c.id}` : ''; const posts = useBloomStore((s) => (key ? s.authorPostsCache[key] : undefined));
  const load = useCallback(async () => { const r = await apiCall<{ community: Comm }>(`/api/bloom/communities/${encodeURIComponent(slug)}`); if (!r.ok || !r.data) { setC(false); return; } setC(r.data.community); await loadCommunityPosts(r.data.community.id); }, [slug, loadCommunityPosts]);
  useEffect(() => { void load(); }, [load, feedVersion]);
  if (c === null) return <div className="grid h-40 place-items-center"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--t3)' }} /></div>;
  if (c === false) return <div className="space-y-3 p-4"><Btn tone="plain" onClick={onBack}>‹ Назад</Btn><p className="text-sm" style={{ color: 'var(--t2)' }}>Сообщество не найдено или недоступно.</p></div>;
  const m = c.mine; const mod = m?.status === 'active' && (m.role === 'owner' || m.role === 'mod'); const canWrite = m?.status === 'active' && (c.postPolicy === 'all' || mod);
  const join = async () => { const r = await call<{ status: string }>(`/api/bloom/communities/${c.id}/join`, 'POST', {}); if (r) { flash(r.status === 'pending' ? 'Заявка отправлена — ждите решения модератора' : 'Вы вступили'); void load(); } };
  const pinOrRemove = async (id: string, pinned: boolean) => { const r = await call(`/api/bloom/community-posts/${id}/pin`, 'POST', { on: !pinned }); if (r) void load(); };
  const removeBy = async (id: string) => { const reason = window.prompt('Причина удаления поста (будет видна автору)') ?? ''; if (reason.trim().length < 3) return; if (await call(`/api/bloom/community-posts/${id}/remove`, 'POST', { reason })) void load(); };
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--t3)' }}><ChevronLeft size={14} />Все сообщества</button>
      <div className="rounded-3xl p-4" style={{ ...card, background: `linear-gradient(135deg, color-mix(in srgb, ${c.color} 22%, var(--bg-l1)), var(--bg-l1))` }}>
        <div className="flex items-start gap-3"><Cover c={c} size={56} /><div className="min-w-0 flex-1"><p className="truncate text-lg font-black" style={{ color: 'var(--t1)' }} translate="no">{c.name}</p>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>@{c.slug} · {c.privacy === 'closed' ? 'закрытое' : 'открытое'} · {c.members} участн. · {c.posts} постов</p></div></div>
        {c.description && <p className="mt-3 whitespace-pre-wrap text-sm" style={{ color: 'var(--t2)' }} translate="no">{c.description}</p>}
        {c.blocked && <p className="mt-2 text-xs font-bold" style={{ color: '#ef4444' }}>Заблокировано администрацией: {c.blockReason}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {!m && <Btn onClick={() => void join()}>{c.privacy === 'closed' ? 'Подать заявку' : 'Вступить'}</Btn>}
          {m?.status === 'pending' && <Btn tone="plain" onClick={async () => { if (await call(`/api/bloom/communities/${c.id}/leave`, 'POST', {})) void load(); }}>Заявка отправлена · отозвать</Btn>}
          {m?.status === 'active' && m.role !== 'owner' && <Btn tone="plain" onClick={async () => { if (window.confirm('Выйти из сообщества?') && (await call(`/api/bloom/communities/${c.id}/leave`, 'POST', {}))) void load(); }}>Выйти</Btn>}
          {m?.status === 'banned' && <span className="text-xs font-bold" style={{ color: '#ef4444' }}>Вам закрыт доступ</span>}
          {canWrite && <Btn onClick={() => setCreate(true)}><Plus size={12} className="mr-1 inline" />Пост в сообществе</Btn>}
          {m && m.role !== 'owner' && <Btn tone="plain" onClick={async () => { const reason = window.prompt('Причина жалобы: spam, scam, hate, illegal, adult, other', 'spam'); if (reason && (await call(`/api/bloom/communities/${c.id}/report`, 'POST', { reason: reason.trim().toLowerCase() }))) flash('Жалоба отправлена'); }}><Flag size={12} className="mr-1 inline" />Пожаловаться</Btn>}
        </div>
        {c.postPolicy === 'mods' && <p className="mt-2 text-[11px]" style={{ color: 'var(--t3)' }}>Публикуют только модераторы.</p>}
      </div>
      <div className="glass-pill flex w-fit gap-1 p-1" role="tablist">{([['posts', 'Посты'], ['about', 'О сообществе'], ...(mod ? [['manage', 'Управление']] : [])] as [string, string][]).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sub === k} onClick={() => setSub(k as typeof sub)} className="rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={{ color: sub === k ? 'var(--t1)' : 'var(--t3)', background: sub === k ? 'var(--bg-l2)' : 'transparent' }}>{l}</button>)}</div>
      {sub === 'posts' && (!c.contentVisible ? <div className="rounded-3xl p-6 text-center" style={card}><Lock size={22} className="mx-auto" style={{ color: 'var(--t3)' }} /><p className="mt-2 text-sm font-semibold" style={{ color: 'var(--t2)' }}>Посты видят только участники</p><p className="text-[11px]" style={{ color: 'var(--t3)' }}>Подайте заявку — модератор её рассмотрит.</p></div>
        : !(posts?.length) ? <div className="rounded-3xl p-6 text-center text-sm" style={{ ...card, color: 'var(--t3)' }}>В сообществе пока нет постов.</div>
        : <div className="space-y-3">{posts.map((p) => <div key={p.id}><PostCard post={p} onAuthorClick={onAuthorClick} onTagClick={onTagClick} />
          {mod && <div className="mt-1 flex gap-2 pl-1"><Btn tone="plain" onClick={() => void pinOrRemove(p.id, p.communityPinned === true)}><Pin size={11} className="mr-1 inline" />{p.communityPinned ? 'Открепить' : 'Закрепить'}</Btn><Btn tone="red" onClick={() => void removeBy(p.id)}>Удалить как модератор</Btn></div>}</div>)}</div>)}
      {sub === 'about' && <div className="space-y-3"><div className="space-y-2 rounded-2xl p-4" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Правила</p>{!(c.rules?.length) ? <p className="text-xs" style={{ color: 'var(--t3)' }}>Правила не заданы.</p> : c.rules.map((r, i) => <div key={i}><p className="text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{i + 1}. {r.title}</p>{r.text && <p className="text-xs" style={{ color: 'var(--t2)' }} translate="no">{r.text}</p>}</div>)}</div>
        <div className="space-y-1 rounded-2xl p-4" style={card}><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Владелец и модераторы</p>{c.mods?.map((x) => <p key={x.id} className="text-sm" style={{ color: 'var(--t2)' }} translate="no"><ShieldCheck size={12} className="mr-1 inline" />{x.name} @{x.username}{x.role === 'owner' ? ' · владелец' : ''}</p>)}</div></div>}
      {sub === 'manage' && mod && <ManagePanel c={c} onChanged={() => void load()} />}
      {create && <CreatePost communityId={c.id} onClose={() => { setCreate(false); void load(); }} />}
    </div>
  );
};

/* ─── каталог ─────────────────────────────────────────────────────── */
export const CommunitiesView = ({ openSlug, onOpen, onAuthorClick, onTagClick }: { openSlug: string | null; onOpen: (slug: string | null) => void; onAuthorClick: (id: string) => void; onTagClick: (t: string) => void }) => {
  const [list, setList] = useState<Comm[] | null>(null); const [q, setQ] = useState(''); const [sort, setSort] = useState<'popular' | 'new' | 'mine'>('popular'); const [create, setCreate] = useState(false);
  const load = useCallback(async () => { const r = await apiCall<{ communities: Comm[] }>(`/api/bloom/communities?sort=${sort}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`); setList(r.ok ? (r.data?.communities ?? []) : []); }, [q, sort]);
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  if (openSlug) return <CommunityPage slug={openSlug} onBack={() => { onOpen(null); void load(); }} onAuthorClick={onAuthorClick} onTagClick={onTagClick} />;
  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="flex items-center gap-2"><div className="relative min-w-0 flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--t3)' }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти сообщество" className="w-full rounded-2xl py-2.5 pl-9 pr-3 text-sm outline-none" style={inp} /></div><Btn onClick={() => setCreate(true)}><Plus size={13} className="mr-1 inline" />Создать</Btn></div>
      <div className="flex gap-1.5">{([['popular', 'Популярные'], ['new', 'Новые'], ['mine', 'Мои']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setSort(k)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: sort === k ? 'var(--accent-bg)' : 'var(--bg-l2)', color: sort === k ? 'var(--accent)' : 'var(--t2)', border: '1px solid var(--border)' }}>{l}</button>)}</div>
      {!list ? <div className="grid h-32 place-items-center"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--t3)' }} /></div> : !list.length ? (
        <div className="rounded-3xl p-8 text-center" style={{ ...card, border: '1px dashed var(--border)' }}><Users size={26} className="mx-auto" style={{ color: 'var(--t3)' }} /><p className="mt-2 text-sm font-semibold" style={{ color: 'var(--t2)' }}>{sort === 'mine' ? 'Вы пока не состоите ни в одном сообществе' : 'Ничего не найдено'}</p><p className="text-[11px]" style={{ color: 'var(--t3)' }}>Создайте своё — это бесплатно.</p></div>
      ) : list.map((c) => (
        <button key={c.id} type="button" onClick={() => onOpen(c.slug)} className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition active:scale-[.99]" style={card}>
          <Cover c={c} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{c.name}</p>
            <p className="truncate text-[12px]" style={{ color: 'var(--t3)' }} translate="no">{c.description || `@${c.slug}`}</p>
            <p className="mt-0.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--t3)' }}>{c.privacy === 'closed' ? <Lock size={10} /> : <Globe2 size={10} />}{c.members} участн.{c.mine?.status === 'active' ? ' · вы в сообществе' : c.mine?.status === 'pending' ? ' · заявка отправлена' : ''}</p></div></button>))}
      {create && <CreateForm onClose={() => setCreate(false)} onCreated={(slug) => { setCreate(false); onOpen(slug); }} />}
    </div>
  );
};
