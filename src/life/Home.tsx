/** Sky Life → «Главная»: приветствие, сегодняшние дела, события, планы, цели, проекты, возможности, напоминания, прогресс. Состав и порядок блоков настраивает человек. */
import { useState } from 'react';
import { Check as CheckIcon, SlidersHorizontal, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import { flash } from '@/shared/flash';
import { J, errText, fmtDate, type Item } from './api';
import { Card, H, Btn, Chip, Empty, Sheet, Spinner, Note, Progress, Check, useLoad } from './ui';
import type { Section } from './LifeModule';

type Home = { name: string; prefs: { home: { order?: string[]; hidden?: string[] } }; tasks: Item[]; events: Item[]; plans: Item[]; goals: Item[]; projects: { id: string; title: string }[]; reminders: Item[]; saved: { target_type: string; target_id: string }[]; offers: number;
  stats: { openTasks: number; tasksDone30: number; goalsActive: number; goalsOverdue: number; goalsDone: number; overdue: number; total: number }; limits: { items: number; prime: boolean } };
const TITLES: Record<string, string> = { tasks: 'Сегодняшние задачи', events: 'Важные события', plans: 'Ближайшие планы', goals: 'Личные цели', projects: 'Активные проекты', opportunities: 'Деловые возможности', reminders: 'Важные напоминания', saved: 'Сохранённое', stats: 'Мой прогресс' };
const DEFAULT = ['tasks', 'events', 'plans', 'goals', 'projects', 'opportunities', 'reminders', 'saved', 'stats'];
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };

export const HomeScreen = ({ go }: { go: (s: Section) => void }) => {
  const h = useLoad(async () => (await J<Home>('/api/life/home')).data, []); const [cfg, setCfg] = useState(false); const [quick, setQuick] = useState('');
  if (!h.data) return <Spinner />; const d = h.data;
  const order = [...(d.prefs.home.order ?? []), ...DEFAULT.filter((x) => !(d.prefs.home.order ?? []).includes(x))]; const hidden = d.prefs.home.hidden ?? [];
  const toggle = async (it: Item) => { const r = await J(`/api/life/items/${it.id}`, 'PUT', { status: it.status === 'done' ? 'open' : 'done' }); if (r.ok) void h.reload(); else flash(errText(r.error)); };
  const Row = ({ it }: { it: Item }) => (
    <div className="flex items-center gap-2.5 py-1.5">
      <button type="button" aria-label="Выполнено" onClick={() => void toggle(it)} className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ border: '2px solid #8b5cf6', background: it.status === 'done' ? '#8b5cf6' : 'transparent' }}>{it.status === 'done' && <CheckIcon size={11} color="#fff" />}</button>
      <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--t1)' }} translate="no">{it.title}</span>
      {(it.dueAt || it.eventAt) && <Chip tone={it.dueAt && it.status === 'open' && new Date(it.dueAt) < new Date() ? 'bad' : undefined}>{fmtDate(it.eventAt ?? it.dueAt)}</Chip>}
    </div>
  );
  const block = (id: string) => {
    const wrap = (children: React.ReactNode, link?: Section) => <Card key={id}><H right={link ? <button type="button" onClick={() => go(link)} className="text-[12px] font-semibold" style={{ color: '#a78bfa' }}>Все ›</button> : undefined}>{TITLES[id]}</H><div className="mt-1.5">{children}</div></Card>;
    if (id === 'tasks') return wrap(<>{!d.tasks.length ? <Note>На сегодня задач нет. Добавьте первую ниже.</Note> : d.tasks.map((t) => <Row key={t.id} it={t} />)}
      <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!quick.trim()) return; const due = new Date(); due.setHours(23, 59, 0, 0); const r = await J('/api/life/items', 'POST', { kind: 'task', title: quick, dueAt: due.toISOString() }); if (r.ok) { setQuick(''); void h.reload(); } else flash(errText(r.error)); }}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Быстрая задача на сегодня" maxLength={200} className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} /><Btn type="submit" small disabled={!quick.trim()}><Plus size={13} /></Btn></form></>);
    if (id === 'events') return wrap(!d.events.length ? <Note>Ближайших событий нет.</Note> : d.events.map((t) => <Row key={t.id} it={t} />), 'life');
    if (id === 'plans') return wrap(!d.plans.length ? <Note>Планов с датами пока нет.</Note> : d.plans.map((t) => <Row key={t.id} it={t} />), 'life');
    if (id === 'reminders') return wrap(!d.reminders.length ? <Note>Напоминаний на ближайшие 2 дня нет.</Note> : d.reminders.map((t) => <div key={t.id} className="flex items-center gap-2 py-1.5"><span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--t1)' }} translate="no">{t.title}</span><Chip tone="warn">{t.remindAt ? new Date(t.remindAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</Chip></div>));
    if (id === 'goals') return wrap(!d.goals.length ? <Note>Поставьте первую цель в разделе «Цели».</Note> : d.goals.map((g) => <div key={g.id} className="py-1.5"><div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm" style={{ color: 'var(--t1)' }} translate="no">{g.title}</span><span className="text-xs font-bold" style={{ color: 'var(--t2)' }}>{g.progress}%</span></div><div className="mt-1"><Progress value={g.progress} /></div></div>), 'goals');
    if (id === 'projects') return wrap(!d.projects.length ? <Note>Активных проектов нет.</Note> : d.projects.map((p) => <button key={p.id} type="button" onClick={() => go('projects')} className="block w-full truncate py-1.5 text-left text-sm" style={{ color: 'var(--t1)' }} translate="no">• {p.title}</button>), 'projects');
    if (id === 'opportunities') return wrap(<><p className="text-sm" style={{ color: 'var(--t2)' }}>{d.offers ? <>Новых предложений о сотрудничестве: <b style={{ color: '#a78bfa' }}>{d.offers}</b></> : 'Новых предложений нет.'}</p><div className="mt-2 flex gap-2"><Btn small tone="plain" onClick={() => go('business')}>Бизнес-связи</Btn></div></>);
    if (id === 'saved') return wrap(<p className="text-sm" style={{ color: 'var(--t2)' }}>{d.saved.length ? `Избранных кандидатов и публикаций: ${d.saved.length}` : 'Сохранённых материалов пока нет.'}</p>, 'business');
    if (id === 'stats') return wrap(<div className="grid grid-cols-3 gap-2 text-center">{[['Открыто', d.stats.openTasks, '#8b5cf6'], ['Сделано за 30 дн.', d.stats.tasksDone30, '#10b981'], ['Просрочено', d.stats.overdue, '#ef4444'], ['Целей в работе', d.stats.goalsActive, '#8b5cf6'], ['Достигнуто', d.stats.goalsDone, '#10b981'], ['Записей', d.stats.total, 'var(--t2)']].map(([l, n, c]) => <div key={String(l)}><p className="text-xl font-black" style={{ color: c as string }}>{n}</p><p className="text-[10px]" style={{ color: 'var(--t3)' }}>{l}</p></div>)}</div>);
    return null;
  };
  const move = async (id: string, dir: number) => { const o = order.slice(); const i = o.indexOf(id); const j = i + dir; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; await J('/api/life/prefs', 'PUT', { home: { order: o, hidden } }); void h.reload(); };
  const vis = async (id: string, on: boolean) => { await J('/api/life/prefs', 'PUT', { home: { order, hidden: on ? hidden.filter((x) => x !== id) : [...hidden, id] } }); void h.reload(); };
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[28px] p-5" style={{ background: 'linear-gradient(135deg,#1e1b4b,#4c1d95 55%,#6d28d9)' }} data-keep-dark>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full" style={{ background: 'radial-gradient(circle,rgba(167,139,250,.45),transparent 70%)' }} />
        <p className="text-[12px] font-semibold text-white/70">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="mt-1 text-2xl font-black text-white" translate="no">{greet()}, {d.name.split(' ')[0] || 'друг'}</p>
        <p className="mt-1 text-[13px] text-white/75">{d.stats.overdue ? `Просрочено задач: ${d.stats.overdue}. ` : ''}{d.tasks.length ? `На сегодня дел: ${d.tasks.length}.` : 'Сегодня свободно — самое время поставить цель.'}</p>
        <button type="button" onClick={() => setCfg(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white"><SlidersHorizontal size={13} />Настроить главный экран</button>
      </div>
      {!d.stats.total && <Empty text="Пока в Sky Life пусто" hint="Начните с цели или первой записи — всё сохранится на сервере и будет на всех ваших устройствах." action={<div className="flex gap-2"><Btn small onClick={() => go('goals')}>Поставить цель</Btn><Btn small tone="plain" onClick={() => go('life')}>Добавить запись</Btn></div>} />}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{order.filter((id) => !hidden.includes(id)).map((id) => block(id))}</div>
      {cfg && <Sheet title="Главный экран" onClose={() => setCfg(false)}><Note>Включайте нужные блоки и меняйте порядок. Настройки сохраняются в вашем аккаунте.</Note>
        {order.map((id, i) => <div key={id} className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}><div className="flex-1"><Check checked={!hidden.includes(id)} onChange={(v) => void vis(id, v)} label={TITLES[id]} /></div>
          <button type="button" aria-label="Выше" disabled={i === 0} onClick={() => void move(id, -1)}><ChevronUp size={16} style={{ color: 'var(--t2)', opacity: i === 0 ? 0.3 : 1 }} /></button><button type="button" aria-label="Ниже" disabled={i === order.length - 1} onClick={() => void move(id, 1)}><ChevronDown size={16} style={{ color: 'var(--t2)', opacity: i === order.length - 1 ? 0.3 : 1 }} /></button></div>)}</Sheet>}
    </div>
  );
};
