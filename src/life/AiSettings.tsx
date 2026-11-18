/** Sky Life → «Sky AI» и «Настройки приватности»: помощник предлагает, но ничего не публикует и не отправляет; человек выбирает, какие данные ему доступны. */
import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Trash2, Send } from 'lucide-react';
import { SkyCloud } from '@/os/SkyCloud';
import { ThinkingIndicator } from '@/ai/ThinkingIndicator';
import { flash } from '@/shared/flash';
import { apiText } from '@/core/auth/api';
import { J, errText } from './api';
import { Card, H, Btn, Spinner, Note, Check, useLoad, useAct } from './ui';

const TASKS: { v: string; l: string; prime: boolean; hint: string }[] = [
  { v: 'goal_plan', l: 'Сформулировать цель', prime: false, hint: 'Опишите, чего хотите — помощник предложит чёткую формулировку и срок.' },
  { v: 'break_down', l: 'Разбить на этапы', prime: false, hint: 'Вставьте цель или большую задачу.' },
  { v: 'action_plan', l: 'План действий на 2 недели', prime: false, hint: 'Опишите цель и текущую ситуацию.' },
  { v: 'partner_ideas', l: 'Подобрать партнёра и роли', prime: false, hint: 'Опишите проект — подскажем, кого и по каким навыкам искать.' },
  { v: 'progress_review', l: 'Проанализировать прогресс', prime: true, hint: 'Можно оставить поле пустым: помощник возьмёт ваши цели, если вы разрешили это в настройках.' },
  { v: 'business_plan', l: 'Помочь с бизнес-планом', prime: true, hint: 'Опишите идею бизнеса.' },
  { v: 'improve_pitch', l: 'Улучшить презентацию проекта', prime: true, hint: 'Вставьте текст презентации или описания проекта.' },
  { v: 'negotiation_prep', l: 'Подготовиться к переговорам', prime: true, hint: 'С кем и о чём переговоры?' },
  { v: 'business_ideas', l: 'Идеи развития бизнеса', prime: true, hint: 'Опишите текущий бизнес.' },
  { v: 'time_plan', l: 'Спланировать время', prime: true, hint: 'Перечислите задачи и сроки.' },
];
type Msg = { id: number; role: 'me' | 'ai' | 'err'; text: string; used?: Record<string, boolean>; task?: string };
const USED: Record<string, string> = { goals: 'цели', projects: 'проекты', business: 'деловая карточка', item: 'выбранная запись' };

export const AiScreen = () => {
  const [task, setTask] = useState('goal_plan'); const [text, setText] = useState(''); const [msgs, setMsgs] = useState<Msg[]>([]); const [busy, setBusy] = useState(false);
  const t = TASKS.find((x) => x.v === task)!; const end = useRef<HTMLDivElement>(null); const idRef = useRef(0);
  const prefs = useLoad(async () => (await J<{ prefs: { ai: { goals: boolean; projects: boolean; business: boolean } } }>('/api/life/prefs')).data?.prefs, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy]);
  const send = async () => {
    const q = text.trim(); if (busy || (!q && !t.prime)) return;
    setMsgs((m) => [...m, { id: ++idRef.current, role: 'me', text: q || t.l, task: t.l }]); setText(''); setBusy(true);
    const r = await J<{ text: string; usedData: Record<string, boolean> }>('/api/life/ai', 'POST', { task, text: q }); setBusy(false);
    if (r.ok && r.data) setMsgs((m) => [...m, { id: ++idRef.current, role: 'ai', text: r.data!.text, used: r.data!.usedData }]);
    else setMsgs((m) => [...m, { id: ++idRef.current, role: 'err', text: errText(r.error) }]);
  };
  const allowed = prefs.data ? [prefs.data.ai.goals && 'цели', prefs.data.ai.projects && 'проекты', prefs.data.ai.business && 'деловая карточка'].filter(Boolean) as string[] : [];
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <H>Sky AI в Sky Life</H>
      <div className="flex min-h-[420px] flex-col overflow-hidden rounded-[26px]" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'linear-gradient(120deg, rgba(139,92,246,.28), rgba(236,72,153,.16))', borderBottom: '1px solid var(--border)' }}>
          <SkyCloud state={busy ? 'waiting' : msgs.length ? 'joy' : 'greeting'} size={44} />
          <div className="min-w-0 flex-1"><p className="text-sm font-black" style={{ color: 'var(--t1)' }}>Sky AI</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{allowed.length ? `Видит: ${allowed.join(', ')}` : 'Видит только ваш запрос'}</p></div>
          {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ border: '1px solid var(--border)', color: 'var(--t2)' }}>Новый диалог</button>}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4" style={{ maxHeight: 'min(56vh, 520px)' }} role="log" aria-live="polite">
          {!msgs.length && !busy && (
            <div className="mx-auto max-w-md space-y-3 py-4 text-center">
              <SkyCloud state="wave" size={92} className="mx-auto" />
              <p className="text-base font-black" style={{ color: 'var(--t1)' }}>Чем помочь сегодня?</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--t3)' }}>Выберите задание ниже и опишите, что нужно. Помощник предлагает варианты — решения всегда за вами.</p>
              <div className="flex flex-wrap justify-center gap-2">{TASKS.slice(0, 4).map((x) => <button key={x.v} type="button" onClick={() => setTask(x.v)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>{x.l}</button>)}</div>
            </div>)}
          {msgs.map((m) => m.role === 'me' ? (
            <div key={m.id} className="flex justify-end"><div className="max-w-[85%] rounded-[22px] rounded-br-md px-4 py-2.5 text-sm leading-relaxed text-white" style={{ background: 'linear-gradient(135deg,#7c3aed,#db2777)' }}>
              {m.task && <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-75">{m.task}</p>}<p className="whitespace-pre-wrap" translate="no">{m.text}</p></div></div>
          ) : (
            <div key={m.id} className="flex items-end gap-2"><SkyCloud state={m.role === 'err' ? 'error' : 'joy'} size={30} className="shrink-0" />
              <div className="max-w-[88%] rounded-[22px] rounded-bl-md px-4 py-3" style={{ background: m.role === 'err' ? 'rgba(239,68,68,.12)' : 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: m.role === 'err' ? '#ef4444' : 'var(--t1)' }} translate={m.role === 'err' ? undefined : 'no'}>{m.text}</p>
                {m.role === 'ai' && <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { void navigator.clipboard.writeText(m.text); flash('Скопировано'); }} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ border: '1px solid var(--border)', color: 'var(--t2)' }}><Copy size={11} />Копировать</button>
                  <span className="text-[10px]" style={{ color: 'var(--t3)' }}>Использовано: {Object.entries(m.used ?? {}).filter(([, v]) => v).map(([k]) => USED[k] ?? k).join(', ') || 'только ваш запрос'}</span></div>}
              </div></div>))}
          {busy && <div className="flex items-end gap-2"><SkyCloud state="waiting" size={30} className="shrink-0" /><div className="rounded-[22px] rounded-bl-md px-4 py-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}><ThinkingIndicator /></div></div>}
          <div ref={end} />
        </div>
        <div className="space-y-2 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }} role="radiogroup" aria-label="Задание">{TASKS.map((x) => (
            <button key={x.v} type="button" role="radio" aria-checked={task === x.v} onClick={() => setTask(x.v)} className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition" style={task === x.v ? { background: 'linear-gradient(135deg,#7c3aed,#db2777)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)' }}>{x.l}{x.prime ? ' ★' : ''}</button>))}</div>
          <p className="px-2 text-[11px] leading-snug" style={{ color: 'var(--t3)' }}>{t.hint}</p>
          <div className="flex items-end gap-2 rounded-[26px] px-3 py-2" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 6000))} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} rows={1} placeholder="Напишите запрос…" aria-label="Ваш запрос" className="max-h-32 min-h-[36px] min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none" style={{ color: 'var(--t1)' }} />
            <button type="button" onClick={() => void send()} disabled={busy || (!text.trim() && !t.prime)} aria-label="Отправить" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition active:scale-95 disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#7c3aed,#db2777)' }}><Send size={16} /></button>
          </div>
          <p className="px-1 text-[10px] leading-snug" style={{ color: 'var(--t3)' }}>Sky AI может ошибаться и ничего не публикует, не отправляет и не переводит за вас. ★ — с Sky Prime. Данные для помощника — в «Настройках».</p>
        </div>
      </div>
    </div>
  );
};

export const SettingsScreen = () => {
  const p = useLoad(async () => (await J<{ prefs: { notif: Record<string, boolean>; ai: Record<string, boolean>; finLink: boolean }; notifLabels: Record<string, string>; limits: { items: number; storageBytes: number; posts: number; projects: number; match: number; prime: boolean } }>('/api/life/prefs')).data, []);
  const a = useLoad(async () => (await J<{ log: { action: string; target: string | null; byMe: boolean; at: string }[] }>('/api/life/audit')).data, []); const { busy, act } = useAct(); const [log, setLog] = useState(false);
  if (!p.data) return <Spinner />; const d = p.data;
  const save = async (patch: Record<string, unknown>) => { const r = await J('/api/life/prefs', 'PUT', patch); if (r.ok) void p.reload(); else flash(errText(r.error)); };
  const doExport = async () => { const r = await apiText('/api/life/export'); if (!r.ok) return flash('Не удалось выгрузить данные'); const url = URL.createObjectURL(new Blob([r.text], { type: 'application/json' })); const el = document.createElement('a'); el.href = url; el.download = 'sky-life-export.json'; el.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); flash('Файл выгружен'); void a.reload(); };
  const cal = async () => { const r = await apiText('/api/life/calendar.ics'); if (!r.ok) return flash('Не удалось выгрузить календарь'); const url = URL.createObjectURL(new Blob([r.text], { type: 'text/calendar' })); const el = document.createElement('a'); el.href = url; el.download = 'sky-life.ics'; el.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000); };
  const AL: Record<string, string> = { item_created: 'создана запись', item_deleted: 'удалена запись', file_added: 'добавлен файл', file_deleted: 'удалён файл', file_opened_by_other: 'файл открыт другим человеком (по вашему доступу)', data_exported: 'выгрузка данных', all_data_erased: 'удалены все данные', prefs_saved: 'изменены настройки', project_created: 'создан проект', project_deleted: 'удалён проект', biz_profile_saved: 'сохранена деловая карточка', biz_share: 'изменён доступ к контактам/документам', ai_used: 'запрос к Sky AI', calendar_exported: 'выгружен календарь', post_saved: 'сохранена публикация', post_submitted: 'публикация отправлена на проверку' };
  return (
    <div className="space-y-3">
      <H>Настройки и приватность</H>
      <Card className="space-y-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Уведомления</p>{Object.entries(d.notifLabels).map(([k, l]) => <Check key={k} checked={d.prefs.notif[k] !== false} onChange={(v) => void save({ notif: { [k]: v } })} label={l} />)}<Note>Тексты ваших записей в уведомления не попадают.</Note></Card>
      <Card className="space-y-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Что может читать Sky AI</p><Check checked={d.prefs.ai.goals} onChange={(v) => void save({ ai: { goals: v } })} label="Мои цели" /><Check checked={d.prefs.ai.projects} onChange={(v) => void save({ ai: { projects: v } })} label="Названия моих проектов" /><Check checked={d.prefs.ai.business} onChange={(v) => void save({ ai: { business: v } })} label="Мою деловую карточку" />
        <Note>По умолчанию всё выключено. Личные заметки, важные документы и воспоминания помощнику не передаются никогда.</Note></Card>
      <Card className="space-y-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Данные Sky Money</p><Check checked={d.prefs.finLink} onChange={(v) => void save({ finLink: v })} label="Показывать баланс в финансовых целях (только чтение)" /></Card>
      <Card className="space-y-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Ваш тариф</p><p className="text-sm" style={{ color: 'var(--t2)' }}>{d.limits.prime ? 'Sky Prime' : 'Sky Free'}: записей до {d.limits.items}, хранилище {Math.round(d.limits.storageBytes / 1048576)} МБ, публикаций {d.limits.posts}, проектов {d.limits.projects}, выдача подбора {d.limits.match}.</p><Note>Если подписка закончится, ваши данные не блокируются: их можно читать, менять, выгружать и удалять. Ограничивается только создание сверх лимита.</Note></Card>
      <Card className="space-y-2"><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Ваши данные</p><div className="flex flex-wrap gap-2"><Btn tone="plain" onClick={() => void doExport()}><Download size={13} className="mr-1 inline" />Экспорт всех данных (JSON)</Btn><Btn tone="plain" onClick={() => void cal()}>Календарь (.ics)</Btn><Btn tone="plain" onClick={() => setLog(!log)}>Журнал действий</Btn></div>
        {log && <div className="space-y-1 pt-1">{!a.data ? <Spinner /> : a.data.log.map((l, i) => <p key={i} className="text-[12px]" style={{ color: 'var(--t2)' }}><span style={{ color: 'var(--t3)' }}>{new Date(l.at).toLocaleString('ru-RU')}</span> · {AL[l.action] ?? l.action}{l.byMe ? '' : ' — другим человеком'}</p>)}</div>}
        <Note>Администрация Sky не читает ваши личные записи, документы и приватные данные: у неё нет такого доступа.</Note></Card>
      <Card className="space-y-2" style={{ borderColor: 'rgba(239,68,68,.4)' }}><p className="text-sm font-bold" style={{ color: '#ef4444' }}>Удалить все данные Sky Life</p><Note>Будут безвозвратно удалены записи, цели, файлы, проекты (где вы владелец), деловая карточка и публикации. Сначала сделайте экспорт.</Note>
        <Btn tone="red" disabled={busy} onClick={async () => { { const v = (window.prompt('Для подтверждения введите УДАЛИТЬ') ?? '').trim().toUpperCase(); if (v !== 'УДАЛИТЬ' && v !== 'DELETE') return; } const r = await act(() => J('/api/life/erase', 'POST', { confirm: 'DELETE' }), 'Все данные Sky Life удалены'); if (r?.ok) void p.reload(); }}><Trash2 size={13} className="mr-1 inline" />Удалить всё</Btn></Card>
    </div>
  );
};
