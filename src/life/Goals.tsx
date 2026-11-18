/** Sky Goals: цели, этапы, шкала прогресса, история; финансовые цели (Sky Finance Life — без списаний и переводов). */
import { useState } from 'react';
import { Plus, Check as CheckIcon, Trash2, Sparkles, Wallet } from 'lucide-react';
import { flash } from '@/shared/flash';
import { J, errText, fmtDate, toLocalInput, fromLocalInput, type Item } from './api';
import { Card, H, Btn, Chip, Empty, Field, TextIn, Area, Pick, Sheet, Spinner, Note, Progress, Check, BackBar, useLoad, useAct } from './ui';
import { FilesBox } from './Items';

export const GOAL_TYPES = [{ v: 'personal', l: 'Личная' }, { v: 'finance', l: 'Финансовая' }, { v: 'career', l: 'Карьерная' }, { v: 'education', l: 'Образовательная' }, { v: 'sport', l: 'Спортивная' }, { v: 'family', l: 'Семейная' }, { v: 'business', l: 'Бизнес-цель' }];
const STATE: Record<string, { l: string; tone?: 'ok' | 'bad' | 'acc' }> = { achieved: { l: 'Достигнута', tone: 'ok' }, overdue: { l: 'Просрочена', tone: 'bad' }, active: { l: 'В процессе', tone: 'acc' }, other: { l: 'Архив' } };
type Overview = { goals: Item[]; history: { d: string; p: number }[] };

const Spark = ({ points }: { points: { progress: number; at: string }[] }) => {
  if (points.length < 2) return <Note>История появится, когда прогресс изменится несколько раз.</Note>;
  const w = 280; const h = 56; const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 8) + 4); const ys = points.map((p) => h - 6 - (p.progress / 100) * (h - 12));
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="График прогресса"><polyline fill="none" stroke="#8b5cf6" strokeWidth="2.5" strokeLinejoin="round" points={xs.map((x, i) => `${x},${ys[i]}`).join(' ')} />{xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="#a78bfa" />)}</svg>;
};

export const GoalEditor = ({ goal, onClose, onSaved }: { goal: Item | null; onClose: () => void; onSaved: () => void }) => {
  const [title, setTitle] = useState(goal?.title ?? ''); const [desc, setDesc] = useState(goal?.description ?? ''); const [res, setRes] = useState(goal?.extra?.result ?? ''); const [type, setType] = useState(goal?.extra?.goalType ?? 'personal');
  const [due, setDue] = useState(toLocalInput(goal?.dueAt)); const [rem, setRem] = useState(toLocalInput(goal?.remindAt)); const { busy, act } = useAct();
  const save = async () => {
    const body = { kind: 'goal', title, description: desc, dueAt: fromLocalInput(due), remindAt: fromLocalInput(rem), extra: { goalType: type, result: res } };
    const r = await act(() => (goal ? J(`/api/life/items/${goal.id}`, 'PUT', body) : J('/api/life/items', 'POST', body)), 'Цель сохранена'); if (r?.ok) { onSaved(); onClose(); }
  };
  return (
    <Sheet title={goal ? 'Изменить цель' : 'Новая цель'} onClose={onClose}>
      <Field label="Название цели"><TextIn value={title} onChange={setTitle} max={200} placeholder="Например: Накопить на первый взнос" /></Field>
      <Field label="Тип"><Pick value={type} onChange={setType} options={GOAL_TYPES} /></Field>
      <Field label="Желаемый результат" hint="Как вы поймёте, что цель достигнута?"><Area value={res} onChange={setRes} rows={2} max={1000} /></Field>
      <Field label="Описание"><Area value={desc} onChange={setDesc} rows={3} max={5000} /></Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Срок достижения"><TextIn type="datetime-local" value={due} onChange={setDue} /></Field><Field label="Напомнить"><TextIn type="datetime-local" value={rem} onChange={setRem} /></Field></div>
      <div className="flex justify-end gap-2"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy || !title.trim()} onClick={() => void save()}>Сохранить</Btn></div>
    </Sheet>
  );
};

const GoalDetail = ({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) => {
  const d = useLoad(async () => (await J<{ item: Item }>(`/api/life/items/${id}`)).data?.item ?? null, [id]); const [stage, setStage] = useState(''); const [edit, setEdit] = useState(false); const [ai, setAi] = useState<string[] | null>(null); const [aiBusy, setAiBusy] = useState(false);
  const { busy, act } = useAct(); const g = d.data;
  if (!g) return <Spinner />;
  const refresh = () => { void d.reload(); onChanged(); };
  const addStage = async (t: string) => { const r = await act(() => J('/api/life/items', 'POST', { kind: 'task', title: t, parentId: id })); return r?.ok; };
  const askAi = async () => { setAiBusy(true); const r = await J<{ text: string }>('/api/life/ai', 'POST', { task: 'break_down', itemId: id }); setAiBusy(false); if (!r.ok) return flash(errText(r.error)); const lines = (r.data?.text ?? '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim()).filter((l) => l.length > 3 && l.length < 160 && !/[:：]$/.test(l)).slice(0, 8); setAi(lines); };
  const done = g.status === 'done'; const overdue = !done && g.dueAt && new Date(g.dueAt) < new Date();
  return (
    <div className="space-y-3">
      <BackBar onBack={onBack} title={g.title} right={<Btn small tone="plain" onClick={() => setEdit(true)}>Изменить</Btn>} />
      <Card>
        <div className="flex flex-wrap items-center gap-2"><Chip tone={done ? 'ok' : overdue ? 'bad' : 'acc'}>{done ? 'Достигнута' : overdue ? 'Просрочена' : 'В процессе'}</Chip><Chip>{GOAL_TYPES.find((t) => t.v === g.extra?.goalType)?.l ?? 'Личная'}</Chip>{g.dueAt && <Chip>срок {fmtDate(g.dueAt)}</Chip>}</div>
        <div className="mt-3 flex items-center gap-3"><div className="flex-1"><Progress value={g.progress} tone={done ? 'ok' : overdue ? 'bad' : undefined} /></div><span className="text-sm font-black" style={{ color: 'var(--t1)' }}>{g.progress}%</span></div>
        {g.extra?.result && <p className="mt-3 text-sm" style={{ color: 'var(--t2)' }} translate="no"><b>Результат:</b> {g.extra.result}</p>}
        {g.description && <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: 'var(--t2)' }} translate="no">{g.description}</p>}
        {!(g.children?.length) && <div className="mt-3 flex items-center gap-2"><input type="range" min={0} max={100} step={5} value={g.progress} aria-label="Прогресс" onChange={(e) => void d.setData({ ...g, progress: Number(e.target.value) })} onMouseUp={async (e) => { await J(`/api/life/items/${id}`, 'PUT', { progress: Number((e.target as HTMLInputElement).value) }); refresh(); }} onTouchEnd={async (e) => { await J(`/api/life/items/${id}`, 'PUT', { progress: Number((e.target as HTMLInputElement).value) }); refresh(); }} className="flex-1 accent-violet-500" /><Note>Без этапов прогресс ставите вы</Note></div>}
      </Card>
      <Card>
        <H right={<Btn small tone="plain" disabled={aiBusy} onClick={() => void askAi()}><Sparkles size={12} className="mr-1 inline" />{aiBusy ? 'Думаю…' : 'Разбить с Sky AI'}</Btn>}>Этапы и задачи</H>
        <Note>Большую цель разбейте на небольшие шаги — прогресс считается по выполненным этапам.</Note>
        <div className="mt-2 space-y-1.5">
          {(g.children ?? []).map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'var(--bg-l2)' }}>
              <button type="button" aria-label="Отметить" onClick={async () => { await J(`/api/life/items/${c.id}`, 'PUT', { status: c.status === 'done' ? 'open' : 'done' }); refresh(); }} className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ border: '2px solid #8b5cf6', background: c.status === 'done' ? '#8b5cf6' : 'transparent' }}>{c.status === 'done' && <CheckIcon size={11} color="#fff" />}</button>
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: 'var(--t1)', textDecoration: c.status === 'done' ? 'line-through' : 'none' }} translate="no">{c.title}</span>
              <button type="button" aria-label="Удалить этап" onClick={async () => { await J(`/api/life/items/${c.id}`, 'DELETE'); refresh(); }}><Trash2 size={13} style={{ color: 'var(--t3)' }} /></button>
            </div>))}
        </div>
        <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (stage.trim() && (await addStage(stage.trim()))) { setStage(''); refresh(); } }}>
          <input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="Новый этап" maxLength={200} className="min-w-0 flex-1 rounded-2xl px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
          <Btn type="submit" small disabled={busy || !stage.trim()}>Добавить</Btn></form>
        {ai && (
          <div className="mt-3 space-y-2 rounded-2xl p-3" style={{ background: 'rgba(139,92,246,.1)' }}>
            <p className="text-[12px] font-bold" style={{ color: '#a78bfa' }}>Sky AI предлагает этапы — ничего не добавлено, пока вы не подтвердите</p>
            {ai.length ? ai.map((l, i) => <p key={i} className="text-sm" style={{ color: 'var(--t1)' }} translate="no">• {l}</p>) : <Note>Не удалось выделить этапы из ответа.</Note>}
            <div className="flex gap-2"><Btn small disabled={busy || !ai.length} onClick={async () => { for (const l of ai) await addStage(l); setAi(null); refresh(); flash('Этапы добавлены'); }}>Добавить все как этапы</Btn><Btn small tone="plain" onClick={() => setAi(null)}>Отклонить</Btn></div>
          </div>)}
      </Card>
      <Card><H>Как менялся прогресс</H><Spark points={g.history ?? []} /></Card>
      <Card><FilesBox itemId={id} files={g.fileList ?? []} onChange={refresh} /></Card>
      <div className="flex flex-wrap gap-2">
        <Btn tone="plain" onClick={async () => { await J(`/api/life/items/${id}`, 'PUT', { status: done ? 'open' : 'done' }); refresh(); }}>{done ? 'Вернуть в работу' : 'Отметить достигнутой'}</Btn>
        <Btn tone="red" onClick={async () => { if (window.confirm('Удалить цель, её этапы и файлы навсегда?')) { await J(`/api/life/items/${id}`, 'DELETE'); onChanged(); onBack(); } }}>Удалить цель</Btn>
      </div>
      {edit && <GoalEditor goal={g} onClose={() => setEdit(false)} onSaved={refresh} />}
    </div>
  );
};

export const GoalsScreen = () => {
  const [open, setOpen] = useState<string | null>(null); const [edit, setEdit] = useState(false); const [f, setF] = useState<'all' | 'active' | 'overdue' | 'achieved'>('all');
  const o = useLoad(async () => (await J<Overview>('/api/life/goals')).data, []);
  if (open) return <GoalDetail id={open} onBack={() => setOpen(null)} onChanged={() => void o.reload()} />;
  const goals = (o.data?.goals ?? []).filter((g) => f === 'all' || g.state === f); const all = o.data?.goals ?? [];
  const cnt = (s: string) => all.filter((g) => g.state === s).length;
  return (
    <div className="space-y-3">
      <H right={<Btn small onClick={() => setEdit(true)}><Plus size={13} className="mr-1 inline" />Цель</Btn>}>Мои цели</H>
      <div className="grid grid-cols-3 gap-2">{[['Активные', cnt('active'), '#8b5cf6'], ['Просрочены', cnt('overdue'), '#ef4444'], ['Достигнуты', cnt('achieved'), '#10b981']].map(([l, n, c]) => <Card key={String(l)} className="!p-3 text-center"><p className="text-xl font-black" style={{ color: c as string }}>{n}</p><p className="text-[10px]" style={{ color: 'var(--t3)' }}>{l}</p></Card>)}</div>
      <div className="flex flex-wrap gap-1.5">{([['all', 'Все'], ['active', 'В процессе'], ['overdue', 'Просрочены'], ['achieved', 'Достигнуты']] as const).map(([v, l]) => <button key={v} type="button" onClick={() => setF(v)} className="rounded-full px-3 py-1 text-[12px] font-semibold" style={{ background: f === v ? 'rgba(139,92,246,.2)' : 'var(--bg-l2)', color: f === v ? '#a78bfa' : 'var(--t2)', border: '1px solid var(--border)' }}>{l}</button>)}</div>
      {!o.data ? <Spinner /> : !goals.length ? <Empty text="Целей пока нет" hint="Поставьте цель, разбейте её на этапы и следите за прогрессом." action={<Btn small onClick={() => setEdit(true)}>Поставить цель</Btn>} /> : goals.map((g) => {
        const s = STATE[g.state ?? 'other']; return (
          <Card key={g.id} onClick={() => setOpen(g.id)}>
            <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{g.title}</p><Chip tone={s.tone}>{s.l}</Chip></div>
            <div className="mt-2 flex items-center gap-3"><div className="flex-1"><Progress value={g.progress} tone={g.state === 'achieved' ? 'ok' : g.state === 'overdue' ? 'bad' : undefined} /></div><span className="text-xs font-bold" style={{ color: 'var(--t2)' }}>{g.progress}%</span></div>
            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--t3)' }}>{GOAL_TYPES.find((t) => t.v === g.extra?.goalType)?.l ?? 'Личная'}{g.dueAt ? ` · срок ${fmtDate(g.dueAt)}` : ''}{g.subTotal ? ` · этапов ${g.subDone}/${g.subTotal}` : ''}</p>
          </Card>); })}
      {edit && <GoalEditor goal={null} onClose={() => setEdit(false)} onSaved={() => void o.reload()} />}
    </div>
  );
};

/* ─── Финансовые цели ─────────────────────────────────────────────── */
type Fin = { goals: (Item & { monthsLeft: number | null; needMonthly: number | null })[]; finLink: boolean; wallet: { balanceRub: number; points: number } | null };
const FIN_TYPES = [{ v: 'saving', l: 'Накопление' }, { v: 'purchase', l: 'Крупная покупка' }, { v: 'budget', l: 'Бюджет' }, { v: 'expense', l: 'Планирование расходов' }];
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
export const FinanceScreen = () => {
  const f = useLoad(async () => (await J<Fin>('/api/life/finance')).data, []); const [edit, setEdit] = useState<Item | null | 'new'>(null); const { busy, act } = useAct();
  if (!f.data) return <Spinner />; const d = f.data;
  return (
    <div className="space-y-3">
      <H right={<Btn small onClick={() => setEdit('new')}><Plus size={13} className="mr-1 inline" />Цель</Btn>}>Финансовые цели</H>
      <Note>Это личный план, а не банковская система: Sky Life ничего не списывает и не переводит. Суммы вы вносите сами.</Note>
      <Card>
        <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Wallet size={16} style={{ color: '#a78bfa' }} /><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Данные из Sky Money</p></div>
          <Check checked={d.finLink} label="Показывать" onChange={async (v) => { await act(() => J('/api/life/prefs', 'PUT', { finLink: v })); void f.reload(); }} /></div>
        {d.wallet ? <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }}>Баланс: <b>{rub(d.wallet.balanceRub)}</b> · Prime Points: <b>{d.wallet.points}</b> <Chip>только чтение</Chip></p> : <Note>По умолчанию отключено. Если включить, здесь появится ваш баланс — только для просмотра, без операций.</Note>}
      </Card>
      {!d.goals.length ? <Empty text="Финансовых целей пока нет" hint="Добавьте цель накопления или крупную покупку — Sky Life посчитает, сколько откладывать в месяц." /> : d.goals.map((g) => (
        <Card key={g.id} onClick={() => setEdit(g)}>
          <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-sm font-bold" style={{ color: 'var(--t1)' }} translate="no">{g.title}</p><Chip tone="acc">{FIN_TYPES.find((t) => t.v === g.extra?.type)?.l ?? 'Цель'}</Chip></div>
          <div className="mt-2 flex items-center gap-3"><div className="flex-1"><Progress value={g.progress} tone={g.progress >= 100 ? 'ok' : undefined} /></div><span className="text-xs font-bold" style={{ color: 'var(--t2)' }}>{g.progress}%</span></div>
          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--t2)' }}>{rub(g.extra?.saved ?? 0)} из {rub(g.extra?.target ?? 0)}{g.needMonthly != null ? ` · нужно откладывать ≈ ${rub(g.needMonthly)} в месяц (${g.monthsLeft} мес.)` : ''}</p>
        </Card>))}
      {edit && <FinEditor item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => void f.reload()} busy={busy} />}
    </div>
  );
};
const FinEditor = ({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void; busy: boolean }) => {
  const [title, setTitle] = useState(item?.title ?? ''); const [type, setType] = useState(item?.extra?.type ?? 'saving'); const [target, setTarget] = useState(String(item?.extra?.target ?? '')); const [saved, setSaved] = useState(String(item?.extra?.saved ?? ''));
  const [due, setDue] = useState(toLocalInput(item?.dueAt)); const [rem, setRem] = useState(toLocalInput(item?.remindAt)); const { busy, act } = useAct();
  const save = async () => { const body = { kind: 'fin_goal', title, dueAt: fromLocalInput(due), remindAt: fromLocalInput(rem), extra: { type, target: Number(target) || 0, saved: Number(saved) || 0 } }; const r = await act(() => (item ? J(`/api/life/items/${item.id}`, 'PUT', body) : J('/api/life/items', 'POST', body)), 'Сохранено'); if (r?.ok) { onSaved(); onClose(); } };
  return (
    <Sheet title={item ? 'Финансовая цель' : 'Новая финансовая цель'} onClose={onClose}>
      <Field label="Название"><TextIn value={title} onChange={setTitle} max={200} placeholder="Например: Ноутбук" /></Field>
      <Field label="Тип"><Pick value={type} onChange={setType} options={FIN_TYPES} /></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="Нужная сумма, ₽"><TextIn type="number" value={target} onChange={setTarget} /></Field><Field label="Накоплено, ₽" hint="Обновляйте сами"><TextIn type="number" value={saved} onChange={setSaved} /></Field></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><Field label="Срок"><TextIn type="datetime-local" value={due} onChange={setDue} /></Field><Field label="Напомнить"><TextIn type="datetime-local" value={rem} onChange={setRem} /></Field></div>
      <div className="flex justify-between gap-2">{item ? <Btn tone="red" onClick={async () => { if (window.confirm('Удалить цель?')) { await J(`/api/life/items/${item.id}`, 'DELETE'); onSaved(); onClose(); } }}>Удалить</Btn> : <span />}<div className="flex gap-2"><Btn tone="plain" onClick={onClose}>Отмена</Btn><Btn disabled={busy || !title.trim()} onClick={() => void save()}>Сохранить</Btn></div></div>
    </Sheet>
  );
};
