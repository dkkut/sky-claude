/**
 * Вкладка «Самозащита»: уровень защиты, инциденты и их действия (с отменой), настройки порогов, приманки (canary), заблокированные адреса, сторож хоста.
 * Просмотр — право security; изменения — только владелец и с кодом подтверждения (step-up `defense_settings`). Сервер — server/selfdefense.mjs, routes/defense.mjs.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, Shield, ShieldAlert, Server, Bug, Ban } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/defense';
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ERR: Record<string, string> = { owner_only: 'Только владелец.', step_up_required: 'Нужен код подтверждения.', step_up_invalid: 'Код не подошёл.', step_up_exhausted: 'Слишком много неверных кодов.', not_allowed: 'Недостаточно прав.', bad_field: 'Значение вне допустимого диапазона.', bad_label: 'Название от 3 знаков.' };
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const LEVEL = ['Спокойно', 'Повышенная', 'Высокая', 'Максимальная'];
const AST: Record<string, string> = { done: 'выполнено', simulated: 'учебное', skipped: 'пропущено', failed: 'не вышло', undone: 'отменено', pending: 'в работе' };
const ACT: Record<string, string> = { block_ip: 'Блокировка адреса', hold_account: 'Замораживание аккаунта', revoke_sessions: 'Завершение сессий', raise_level: 'Повышение уровня', host_restore_code: 'Восстановление кода (сторож)', host_recreate: 'Пересоздание контейнеров (сторож)', host_rotate_jwt: 'Смена ключа сессий (сторож)', panel_lockdown: 'Закрытие панели' };
const TH: Record<string, string> = { reqPerMin: 'Запросов в минуту от одного человека/адреса', bytes5min: 'Байт JSON-ответов за 5 минут', distinctUsers10min: 'Разных записей за 10 минут', exports10min: 'Обращений к выгрузкам за 10 минут', adminActions10min: 'Действий администратора за 10 минут', adminPriv10min: 'Выдач прав за 10 минут', probing4xxPerMin: 'Отказов 4xx с адреса в минуту' };

const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1 }}>{children}</button>);
const Card = ({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) => (
  <section className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
    <h3 className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>{icon}{title}</h3>{children}</section>);

export const DefenseTab = () => {
  const [d, setD] = useState<D | null>(null); const [failed, setFailed] = useState('');
  const [open, setOpen] = useState<D | null>(null);
  const [pending, setPending] = useState<null | { run: (code: string) => Promise<void>; title: string }>(null); const [code, setCode] = useState('');
  const [draft, setDraft] = useState<D | null>(null); const [label, setLabel] = useState(''); const [secret, setSecret] = useState('');

  const load = useCallback(async () => {
    const r = await apiCall<D>(A);
    if (r.ok) { setD(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 30000); return () => clearInterval(t); }, [load]);

  const needCode = async (title: string, run: (code: string) => Promise<void>) => {
    const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash(errText(r.error)); return; }
    setCode(''); setPending({ title, run });
  };
  const confirm = async () => { if (!pending) return; await pending.run(code.trim()); setPending(null); };
  const send = async (path: string, method: string, body: D, ok: string, stepUpCode?: string) => {
    const r = await apiCall<D>(`${A}${path}`, { method, body: method === 'DELETE' ? undefined : JSON.stringify({ ...body, ...(stepUpCode ? { stepUpCode } : {}) }) });
    flash(r.ok ? ok : errText(r.error)); await load(); return r;
  };
  const show = async (id: string) => { const r = await apiCall<D>(`${A}/incidents/${id}`); if (r.ok) setOpen(r.data ?? null); };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const edit = Boolean(d.canEdit); const lv = d.level.level as number;
  const s = draft ?? d.settings;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ background: lv ? 'rgba(239,68,68,.12)' : C.l1, border: `1px solid ${lv ? C.red : C.brd}` }}>
        <div className="flex items-center gap-2 text-base font-bold" style={{ color: lv ? C.red : C.green }}>{lv ? <ShieldAlert size={20} /> : <Shield size={20} />}Уровень защиты: {LEVEL[lv]}</div>
        {lv > 0 && <p className="mt-1 text-xs" style={{ color: C.t2 }}>{d.level.reason}. Действует до {dt(d.level.until)}, затем снижается сам.{lv >= 2 ? ' Панель администрации закрыта для всех, кроме владельца.' : ''}</p>}
        <p className="mt-1 text-xs" style={{ color: C.t3 }}>Новых сигналов за 7 дней: {d.openLeaks}. Режим: {d.settings.enabled ? (d.settings.mode === 'auto' ? 'полностью автоматический' : 'только оповещение') : 'выключено'}.</p>
        {edit && <div className="mt-2 flex flex-wrap gap-2">
          {lv > 0 && <Btn tone="plain" onClick={() => void needCode('Снять повышенный уровень', async (c) => { await send('/level', 'POST', { level: 0, reason: 'снято владельцем' }, 'Уровень снят', c); })}>Снять уровень</Btn>}
          {lv < 3 && <Btn tone="red" onClick={() => void needCode('Поднять уровень защиты', async (c) => { await send('/level', 'POST', { level: Math.max(2, lv + 1), hours: 3, reason: 'включено владельцем' }, 'Уровень повышен', c); })}>Поднять уровень</Btn>}
          <Btn tone="plain" onClick={() => void send('/drill', 'POST', {}, 'Учебная тревога запущена — проверьте почту')}>Учебная тревога</Btn>
        </div>}
      </div>

      {pending && <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.acc}` }}>
        <b className="text-sm" style={{ color: C.t1 }}>{pending.title}</b>
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Код подтверждения" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
        <div className="flex gap-2"><Btn disabled={code.length < 6} onClick={() => void confirm()}>Подтвердить</Btn><Btn tone="plain" onClick={() => setPending(null)}>Отмена</Btn></div></div>}

      <Card title="Инциденты" icon={<ShieldAlert size={15} />}>
        {d.incidents.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Инцидентов не было.</p> : d.incidents.map((i: D) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl p-2 text-sm" style={{ background: C.l2 }}>
            <div><b style={{ color: C.t1 }}>{i.title}</b><div className="text-[11px]" style={{ color: C.t3 }}>{dt(i.createdAt)} · {i.severity} · {i.status === 'active' ? 'активен' : i.status === 'cancelled' ? 'отменён' : 'закрыт'}</div></div>
            <Btn tone="plain" onClick={() => void show(i.id)}>Подробнее</Btn></div>))}
        {open && <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
          <div className="flex justify-between"><b className="text-sm" style={{ color: C.t1 }}>{open.title}</b><button type="button" onClick={() => setOpen(null)} className="text-xs" style={{ color: C.t3 }}>закрыть</button></div>
          {open.events.map((e: D) => <div key={e.id} className="text-xs" style={{ color: C.t2 }}>• {e.label} · {e.ip || '—'} · {dt(e.at)}</div>)}
          <div className="text-xs font-bold" style={{ color: C.t3 }}>Действия</div>
          {open.actions.length === 0 && <div className="text-xs" style={{ color: C.t3 }}>Нет.</div>}
          {open.actions.map((a: D) => <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: C.t1 }}>
            <span>{ACT[a.kind] ?? a.kind}{a.target && a.target !== a.kind ? ` — ${a.target}` : ''} <i style={{ color: C.t3 }}>({AST[a.status] ?? a.status}{a.error ? `: ${a.error}` : ''}{a.status === 'done' && !a.reversible ? ', необратимо' : ''})</i></span>
            {edit && ['done', 'simulated'].includes(a.status) && (a.reversible || a.status === 'simulated') && <Btn tone="plain" onClick={() => void needCode('Отменить действие', async (c) => { await send(`/actions/${a.id}/undo`, 'POST', {}, 'Отменено', c); await show(open.id); })}>Отменить</Btn>}</div>)}
          <p className="text-[11px]" style={{ color: C.t3 }}>Владелец может отменить и по ссылке из письма (код аутентификатора).</p></div>}
      </Card>

      <Card title="Сторож хоста" icon={<Server size={15} />}>
        <p className="text-xs" style={{ color: d.guard.alive ? C.green : C.amber }}>{d.guard.alive ? 'На связи' : 'Не на связи'}{d.guard.lastSeen ? ` · последний отчёт ${dt(d.guard.lastSeen)}` : ''}</p>
        {!d.secretConfigured && <p className="text-xs" style={{ color: C.amber }}>GUARD_SECRET не задан на сервере — сторож отключён. Установка: <code>bash scripts/sky-guard.sh --install</code> (см. DEPLOY.md).</p>}
        <p className="text-xs" style={{ color: C.t3 }}>Сторож работает вне Docker: сверяет конфигурацию и скрипты с эталоном, возвращает файлы, пересоздаёт контейнеры. Без него хостовые действия не выполняются (в инциденте они «пропущены»).</p>
      </Card>

      <Card title="Заблокированные адреса" icon={<Ban size={15} />}>
        {d.blocks.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Нет.</p> : d.blocks.map((b: D) => (
          <div key={b.ipFp} className="flex items-center justify-between gap-2 text-xs" style={{ color: C.t1 }}><span translate="no">{b.ip || b.ipFp.slice(0, 8)} · {b.reason} · до {dt(b.expiresAt)}</span>
            {edit && <Btn tone="plain" onClick={() => void send(`/blocks/${b.ipFp}`, 'DELETE', {}, 'Адрес разблокирован')}>Снять</Btn>}</div>))}
      </Card>

      <Card title="Приманки (canary-токены)" icon={<Bug size={15} />}>
        <p className="text-xs" style={{ color: C.t3 }}>Приманка — ненастоящий ключ, который никто не должен использовать. Положите её туда, откуда обычно утекают секреты (старый репозиторий, заметка, документ). Если ключ предъявят серверу — это почти наверняка утечка: защита сработает на максимум.</p>
        {d.canaries.map((c: D) => <div key={c.id} className="flex items-center justify-between gap-2 text-xs" style={{ color: c.active ? C.t1 : C.t3 }}><span>{c.label} · срабатываний: {c.hits}{c.lastHitAt ? ` (${dt(c.lastHitAt)})` : ''}{c.active ? '' : ' · отключена'}</span>
          {edit && c.active && <Btn tone="plain" onClick={() => void send(`/canaries/${c.id}`, 'DELETE', {}, 'Отключена')}>Отключить</Btn>}</div>)}
        {secret && <div className="rounded-xl p-2 text-xs" style={{ background: C.l2, color: C.t1 }}>Токен показан один раз — скопируйте: <code className="break-all" translate="no">{secret}</code></div>}
        {edit && <div className="flex gap-2"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Где положите (название)" className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-xs" style={field} />
          <Btn disabled={label.trim().length < 3} onClick={() => void needCode('Создать приманку', async (c) => { const r = await send('/canaries', 'POST', { label: label.trim() }, 'Приманка создана', c); if (r.ok) { setSecret(String(r.data?.token ?? '')); setLabel(''); } })}>Создать</Btn></div>}
      </Card>

      <Card title="Настройки" icon={<Shield size={15} />}>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!edit} checked={s.enabled} onChange={(e) => setDraft({ ...s, enabled: e.target.checked })} />Защита включена</label>
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}>Режим
          <select disabled={!edit} value={s.mode} onChange={(e) => setDraft({ ...s, mode: e.target.value })} className="rounded-lg px-2 py-1" style={field}><option value="auto">Полностью автоматически</option><option value="notify">Только оповещать</option></select></label>
        <div className="grid gap-2 sm:grid-cols-2">{Object.keys(TH).map((k) => (
          <label key={k} className="text-[11px]" style={{ color: C.t2 }}>{TH[k]}
            <input type="number" disabled={!edit} value={s.thresholds[k]} onChange={(e) => setDraft({ ...s, thresholds: { ...s.thresholds, [k]: Number(e.target.value) } })} className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs" style={field} /></label>))}</div>
        <div className="text-[11px] font-bold" style={{ color: C.t3 }}>Разрешённые автоматические действия</div>
        <div className="grid gap-1 sm:grid-cols-2">{Object.keys(s.actions).map((k) => (
          <label key={k} className="flex items-center gap-2 text-xs" style={{ color: C.t1 }}><input type="checkbox" disabled={!edit} checked={s.actions[k]} onChange={(e) => setDraft({ ...s, actions: { ...s.actions, [k]: e.target.checked } })} />{ACT[k] ?? k}</label>))}</div>
        <div className="grid gap-2 sm:grid-cols-3">{(['blockHours', 'holdHours', 'undoLinkDays'] as const).map((k) => (
          <label key={k} className="text-[11px]" style={{ color: C.t2 }}>{k === 'blockHours' ? 'Блокировка адреса, часов' : k === 'holdHours' ? 'Заморозка аккаунта, часов' : 'Ссылка отмены, дней'}
            <input type="number" disabled={!edit} value={s[k]} onChange={(e) => setDraft({ ...s, [k]: Number(e.target.value) })} className="mt-0.5 w-full rounded-lg px-2 py-1 text-xs" style={field} /></label>))}</div>
        {edit ? <div className="flex gap-2"><Btn disabled={!draft} onClick={() => void needCode('Сохранить настройки самозащиты', async (c) => { const r = await send('/settings', 'PUT', { settings: draft }, 'Сохранено', c); if (r.ok) setDraft(null); })}>Сохранить</Btn>{draft && <Btn tone="plain" onClick={() => setDraft(null)}>Сбросить</Btn>}
          <Btn tone="plain" onClick={() => void needCode('Принять текущий код за эталон', async (c) => { await send('/integrity/rebaseline', 'POST', {}, 'Эталон обновлён', c); })}>Обновить эталон кода</Btn></div>
          : <p className="text-xs" style={{ color: C.t3 }}>Менять настройки может только владелец.</p>}
      </Card>
    </div>
  );
};
