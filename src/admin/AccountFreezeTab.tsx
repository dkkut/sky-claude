/**
 * Вкладка «Заморозка» (право `account_freeze`): заморозить аккаунт (по @нику) или канал (по id чата), выбрать, что показывать человеку, срок и разрешённые чаты, очередь апелляций, восстановление, журнал.
 * Сервер: server/acctfreeze.mjs. Заморозка ничего не удаляет и денег не двигает; возврат — отдельная финансовая процедура.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/account-freeze';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ERR: Record<string, string> = { not_allowed: 'Недостаточно прав.', reason_required: 'Причина — не короче 10 знаков (для решений — 5).', person_not_found: 'Человек не найден.', chat_not_found: 'Канал или группа не найдены.', already_frozen: 'Уже заморожено.', cannot_freeze_self: 'Себя замораживать нельзя.', owner_protected: 'Владельца сервиса замораживать нельзя.', admin_target_owner_only: 'Администратора замораживает только владелец сервиса.', self_review: 'Апелляцию на вашу заморозку решает другой сотрудник.', bad_state: 'Уже решено.', bad_field: 'Проверьте поле.', too_many_requests: 'Слишком много заморозок за час.', not_found: 'Не найдено.' };
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Box = ({ title, children }: { title: string; children: ReactNode }) => <div className="space-y-2 rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</div>;
const In = ({ label, value, onChange, w = 'w-full' }: { label: string; value: string; onChange: (v: string) => void; w?: string }) => <label className="block text-[11px]" style={{ color: C.t3 }}>{label}<input value={value} onChange={(e) => onChange(e.target.value)} className={`mt-0.5 block ${w} rounded-lg px-2 py-1.5 text-sm`} style={field} /></label>;

export const AccountFreezeTab = () => {
  const [status, setStatus] = useState('active'); const [d, setD] = useState<Data | null>(null); const [note, setNote] = useState(''); const [log, setLog] = useState<{ id: string; rows: Data[] } | null>(null);
  const [f, setF] = useState({ kind: 'account', target: '', reason: '', publicReason: '', showReason: false, days: '', chats: '' });
  const load = useCallback(async () => { const r = await apiCall<Data>(`${A}?status=${status}`); if (r.ok) setD(r.data ?? {}); }, [status]);
  useEffect(() => { void load(); }, [load]);
  const post = async (path: string, body: unknown, okText = 'Готово') => { const r = await apiCall<Data>(path, { method: 'POST', body: JSON.stringify(body) }); if (!r.ok || r.data?.error) { flash(ERR[r.data?.error ?? r.error ?? ''] ?? `Не получилось (${r.data?.error ?? r.error})`); return false; } flash(okText); void load(); return true; };
  const create = async () => {
    const expiresAt = f.days ? new Date(Date.now() + Number(f.days) * 86400e3).toISOString() : null;
    const common = { reason: f.reason, publicReason: f.publicReason, showReason: f.showReason, expiresAt };
    const ok = f.kind === 'account' ? await post(A, { ...common, username: f.target, allowedChatIds: f.chats.split(/[\s,]+/).filter(Boolean) }, 'Аккаунт заморожен') : await post(`${A}/channel`, { ...common, chatId: f.target }, 'Канал заморожен');
    if (ok) setF({ ...f, target: '', reason: '', publicReason: '', chats: '' });
  };
  if (!d) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  return (
    <div className="space-y-4">
      <Box title="Заморозить">
        <div className="flex flex-wrap gap-2"><Btn tone={f.kind === 'account' ? 'acc' : 'plain'} onClick={() => setF({ ...f, kind: 'account' })}>Аккаунт</Btn><Btn tone={f.kind === 'channel' ? 'acc' : 'plain'} onClick={() => setF({ ...f, kind: 'channel' })}>Канал / группа</Btn></div>
        <In label={f.kind === 'account' ? '@ник человека' : 'ID канала или группы'} value={f.target} onChange={(v) => setF({ ...f, target: v })} />
        <In label="Причина (для сотрудников, от 10 знаков)" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} />
        <In label="Что можно показать человеку (необязательно)" value={f.publicReason} onChange={(v) => setF({ ...f, publicReason: v })} />
        <label className="flex items-center gap-2 text-xs" style={{ color: C.t2 }}><input type="checkbox" checked={f.showReason} disabled={!f.publicReason} onChange={(e) => setF({ ...f, showReason: e.target.checked })} />Показывать причину человеку (иначе скрыта)</label>
        <div className="flex flex-wrap gap-2"><In label="Срок, дней (пусто — до снятия)" value={f.days} onChange={(v) => setF({ ...f, days: v.replace(/\D/g, '') })} w="w-44" />{f.kind === 'account' && <In label="Разрешённые чаты (id через запятую)" value={f.chats} onChange={(v) => setF({ ...f, chats: v })} w="w-72" />}</div>
        <Btn tone="red" disabled={!f.target || f.reason.length < 10} onClick={() => void create()}>Заморозить</Btn>
        <p className="text-[11px]" style={{ color: C.t3 }}>Данные не удаляются, деньги не списываются и не возвращаются. Не больше 30 заморозок в час на сотрудника. Администратора замораживает только владелец сервиса.</p>
      </Box>
      <Box title={`Апелляции (${(d.appeals as Data[]).length})`}>
        {(d.appeals as Data[]).map((a) => (
          <div key={a.id} className="space-y-1 rounded-xl p-3 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <p>{a.type === 'channel' ? 'Канал' : 'Аккаунт'} · {new Date(a.at).toLocaleString('ru-RU')}</p><p translate="no" className="whitespace-pre-line">{a.text}</p>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Решение (от 5 знаков)" className="w-full rounded-lg px-2 py-1.5 text-sm" style={field} />
            <div className="flex gap-2"><Btn onClick={() => void post(`${A}/appeals/${a.id}/decide`, { outcome: 'accepted', note }).then((ok) => ok && setNote(''))}>Принять и снять заморозку</Btn><Btn tone="red" onClick={() => void post(`${A}/appeals/${a.id}/decide`, { outcome: 'rejected', note }).then((ok) => ok && setNote(''))}>Отклонить</Btn></div>
          </div>))}
        {(d.appeals as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Апелляций нет.</p>}
      </Box>
      <Box title="Заморозки">
        <div className="flex gap-2">{[['active', 'Действуют'], ['lifted', 'Сняты'], ['expired', 'Истекли']].map(([k, l]) => <Btn key={k} tone={status === k ? 'acc' : 'plain'} onClick={() => setStatus(k)}>{l}</Btn>)}</div>
        {(d.freezes as Data[]).map((x) => (
          <div key={x.id} className="space-y-1 rounded-xl p-3 text-xs" style={{ background: C.l2, color: C.t2 }}>
            <p className="font-bold" style={{ color: C.t1 }} translate="no">{`${x.type === 'channel' ? 'Канал' : 'Аккаунт'}: ${x.label ?? x.targetId}`}</p>
            <p translate="no">{`Причина: ${x.reason}`}</p><p>{`С ${new Date(x.startedAt).toLocaleString('ru-RU')}${x.expiresAt ? ` до ${new Date(x.expiresAt).toLocaleString('ru-RU')}` : ''} · ${x.showReason ? 'причина показывается' : 'причина скрыта'}`}</p>{x.liftNote && <p translate="no">{`Снято: ${x.liftNote}`}</p>}
            <div className="flex gap-2">{x.status === 'active' && <><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Основание снятия (от 5 знаков)" className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm" style={field} /><Btn onClick={() => void post(`${A}/${x.id}/lift`, { note }).then((ok) => ok && setNote(''))}>Восстановить доступ</Btn></>}
              <Btn tone="plain" onClick={() => void apiCall<Data>(`${A}/${x.id}/log`).then((r) => setLog({ id: x.id, rows: r.data?.log ?? [] }))}>Журнал</Btn></div>
            {log && log.id === x.id && log.rows.map((l, i) => <p key={i} className="text-[11px]" translate="no">{`${new Date(l.at).toLocaleString('ru-RU')} · ${l.action}${l.detail ? ` — ${l.detail}` : ''}`}</p>)}
          </div>))}
        {(d.freezes as Data[]).length === 0 && <p className="text-xs" style={{ color: C.t3 }}>Пусто.</p>}
      </Box>
    </div>
  );
};
