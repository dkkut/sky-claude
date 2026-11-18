/** Sky Life → «Sky AI» и «Настройки приватности»: помощник предлагает, но ничего не публикует и не отправляет; человек выбирает, какие данные ему доступны. */
import { useState } from 'react';
import { Sparkles, Copy, Download, Trash2 } from 'lucide-react';
import { flash } from '@/shared/flash';
import { apiText } from '@/core/auth/api';
import { J, errText } from './api';
import { Card, H, Btn, Chip, Field, Area, Pick, Spinner, Note, Check, useLoad, useAct } from './ui';

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
export const AiScreen = () => {
  const [task, setTask] = useState('goal_plan'); const [text, setText] = useState(''); const [out, setOut] = useState<{ text: string; usedData: Record<string, boolean> } | null>(null); const [busy, setBusy] = useState(false); const t = TASKS.find((x) => x.v === task)!;
  const prefs = useLoad(async () => (await J<{ prefs: { ai: { goals: boolean; projects: boolean; business: boolean } } }>('/api/life/prefs')).data?.prefs, []);
  const run = async () => { setBusy(true); setOut(null); const r = await J<{ text: string; usedData: Record<string, boolean> }>('/api/life/ai', 'POST', { task, text }); setBusy(false); if (r.ok && r.data) setOut(r.data); else flash(errText(r.error)); };
  return (
    <div className="space-y-3">
      <H>Sky AI в Sky Life</H>
      <Note>Помощник только предлагает варианты. Он ничего не публикует, не отправляет документы, не переводит деньги и не договаривается за вас — все действия вы подтверждаете сами. Не доверяйте его ответам вслепую: он может ошибаться.</Note>
      <Card className="space-y-3">
        <Field label="Что сделать"><Pick value={task} onChange={setTask} options={TASKS.map((x) => ({ v: x.v, l: `${x.l}${x.prime ? ' · Prime' : ''}` }))} /></Field>
        <Field label="Ваш запрос" hint={t.hint}><Area value={text} onChange={setText} rows={5} max={6000} /></Field>
        {prefs.data && <Note>Данные Sky Life для помощника: цели — {prefs.data.ai.goals ? 'разрешены' : 'не разрешены'}, проекты — {prefs.data.ai.projects ? 'разрешены' : 'не разрешены'}, деловая карточка — {prefs.data.ai.business ? 'разрешена' : 'не разрешена'}. Менять — в «Настройках».</Note>}
        <div className="flex items-center gap-2"><Btn disabled={busy} onClick={() => void run()}><Sparkles size={14} className="mr-1.5 inline" />{busy ? 'Думаю…' : 'Спросить Sky AI'}</Btn>{t.prime && <Chip tone="acc">Sky Prime</Chip>}</div>
      </Card>
      {out && <Card className="space-y-2"><div className="flex items-center justify-between"><p className="text-sm font-bold" style={{ color: '#a78bfa' }}>Предложение Sky AI</p><Btn small tone="plain" onClick={() => { void navigator.clipboard.writeText(out.text); flash('Скопировано'); }}><Copy size={12} className="mr-1 inline" />Копировать</Btn></div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--t1)' }} translate="no">{out.text}</p>
        <Note>Использовано из Sky Life: {Object.entries(out.usedData).filter(([, v]) => v).map(([k]) => ({ goals: 'цели', projects: 'проекты', business: 'деловая карточка', item: 'выбранная запись' }[k] ?? k)).join(', ') || 'только ваш запрос'}.</Note></Card>}
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
