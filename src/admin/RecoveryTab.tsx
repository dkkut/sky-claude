/**
 * Админка: «Восстановление доступа». Две части:
 *  • «Обращения на восстановление» — очередь заявок из бланка (право `support`; заявки администраторов и владельца видит только `security`);
 *  • «Безопасность» — отзыв токена восстановления администратора и история восстановления по Sky ID (право `security`).
 * Сервер: server/routes/recovery.mjs (/api/admin/recovery/*), server/recoverycases.mjs. Секретов (токенов, факторов) здесь нет и быть не может.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, Search } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { ScrollTabs } from './ScrollTabs';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const A = '/api/admin/recovery';
const ERR: Record<string, string> = { not_allowed: 'Недостаточно прав для этого действия.', console_only: 'Заявки владельца разрешаются только с консоли сервера (scripts/recover-owner.mjs).', account_not_linked: 'Заявка не привязана к аккаунту.', step_up_required: 'Нужен код подтверждения личности.', step_up_invalid: 'Код не подошёл.', closed: 'Обращение закрыто.', reason_required: 'Укажите причину (от 5 знаков).', not_found: 'Не найдено.', too_many_requests: 'Слишком часто.' };
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const Btn = ({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'plain' | 'red' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'plain' ? { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` } : tone === 'red' ? { background: 'rgba(239,68,68,.15)', color: C.red } : { background: C.acc, color: '#fff' }}>{children}</button>
);
const TABS = [['all', 'Все обращения'], ['new', 'Новые'], ['review', 'На рассмотрении'], ['waiting_user', 'Ожидают ответа пользователя'], ['security_check', 'Ожидают проверки'], ['allowed', 'Разрешены'], ['resolved', 'Решённые'], ['closed', 'Закрытые']] as const;
const KIND: Record<string, string> = { user: 'Пользователь', admin: 'Администратор', owner: 'Владелец' };

const Cases = () => {
  const [tab, setTab] = useState<string>('new');
  const [type, setType] = useState(''); const [q, setQ] = useState(''); const [sort, setSort] = useState('activity');
  const [list, setList] = useState<D[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const p = new URLSearchParams({ tab, sort }); if (type) p.set('type', type); if (q.trim()) p.set('q', q.trim());
    const r = await apiCall<{ items: D[] }>(`${A}/cases?${p}`); setList(r.ok ? r.data?.items ?? [] : []);
  }, [tab, type, q, sort]);
  useEffect(() => { void load(); }, [load]);
  if (open) return <CaseView id={open} onBack={() => { setOpen(null); void load(); }} />;
  return (
    <div className="space-y-3">
      <ScrollTabs>{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: tab === k ? C.acc : C.l2, color: tab === k ? '#fff' : C.t2 }}>{l}</button>)}</ScrollTabs>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]"><Search size={13} className="absolute left-2.5 top-2.5" style={{ color: C.t3 }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Номер обращения или Sky ID" aria-label="Поиск" className="w-full rounded-lg py-2 pl-8 pr-2 text-sm" style={field} /></div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип аккаунта" className="rounded-lg px-2 py-2 text-sm" style={field}><option value="">Все типы</option><option value="user">Пользователь</option><option value="admin">Администратор</option><option value="owner">Владелец</option></select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка" className="rounded-lg px-2 py-2 text-sm" style={field}><option value="activity">По активности</option><option value="created">По дате создания</option></select>
      </div>
      {!list ? <Loader2 className="animate-spin" size={16} style={{ color: C.t3 }} /> : list.length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Обращений нет.</p> : (
        <div className="overflow-x-auto rounded-2xl" style={{ border: `1px solid ${C.brd}` }}>
          <table className="w-full text-xs" style={{ color: C.t2 }}>
            <thead><tr style={{ background: C.l2, color: C.t3 }}>{['Номер', 'Sky ID', 'Тип', 'Причина', 'Создано', 'Последнее сообщение', 'Статус', 'Ответственный', 'Непрочит.'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c.id)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.brd}` }}>
                <td className="px-3 py-2 font-bold" style={{ color: C.t1 }}>{c.number}</td><td className="px-3 py-2" translate="no">{c.skyId ? `${String(c.skyId).slice(0, 12)}…` : '—'}</td>
                <td className="px-3 py-2">{KIND[c.accountKind]}</td><td className="px-3 py-2">{c.reason}</td><td className="px-3 py-2 whitespace-nowrap">{dt(c.createdAt)}</td><td className="px-3 py-2 whitespace-nowrap">{dt(c.lastMessageAt)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{c.statusLabel}</td><td className="px-3 py-2" translate="no">{c.assigneeId ? String(c.assigneeId).slice(-6) : '—'}</td>
                <td className="px-3 py-2">{c.unread ? <b style={{ color: C.acc }}>{c.unread}</b> : 0}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const CaseView = ({ id, onBack }: { id: string; onBack: () => void }) => {
  const [d, setD] = useState<D | null>(null);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(''); const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await apiCall<D>(`${A}/cases/${id}`); if (r.ok) setD(r.data ?? null); else flash(ERR[r.error ?? ''] ?? 'Не удалось загрузить'); }, [id]);
  useEffect(() => { void load(); }, [load]);
  const reply = async () => { setBusy(true); const r = await apiCall<D>(`${A}/cases/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) }); setBusy(false); if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не отправлено'); setText(''); flash(r.data?.mail === 'failed' ? 'Ответ сохранён, но письмо-уведомление не ушло (будет повтор)' : 'Ответ отправлен'); void load(); };
  const setStatus = async (status: string, stepUpCode?: string) => {
    const r = await apiCall(`${A}/cases/${id}/status`, { method: 'POST', body: JSON.stringify({ status, stepUpCode }) });
    if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не удалось');
    flash('Статус изменён'); setPendingStatus(null); setCode(''); void load();
  };
  const choose = async (status: string) => {
    if (status === 'allowed' || status === 'rejected') {
      const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' });
      if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не удалось запросить код'); setPendingStatus(status); return;
    }
    void setStatus(status);
  };
  if (!d) return <Loader2 className="animate-spin" size={16} style={{ color: C.t3 }} />;
  const f = d.form ?? {};
  return (
    <div className="space-y-3">
      <Btn tone="plain" onClick={onBack}>← К списку</Btn>
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-black" style={{ color: C.t1 }}>Обращение №{d.number} · {KIND[d.accountKind]} · {d.statusLabel}</p>
        <p className="text-xs mt-1" style={{ color: C.t3 }}>Sky ID: <span translate="no">{d.skyId ?? 'не привязан'}</span> · контакт {d.contactEmail} {d.contactConfirmed ? '(подтверждён)' : '(не подтверждён — уведомления не уходят)'}</p>
        <div className="mt-3 grid gap-1 text-xs" style={{ color: C.t2 }}>
          <span>Причина: {d.reasonLabel ?? f.reason}</span><span>Недоступно: {(f.lost ?? []).join(', ') || '—'}</span><span>Последний вход: {f.lastLogin || '—'} · Проблема с: {f.whenStarted || '—'}</span>
          <span>Прежняя почта доступна: {f.oldMailAccess === 'yes' ? 'да' : 'нет'}</span>
          <span translate="no">Описание: {f.description}</span>{f.attempts && <span translate="no">Попытки: {f.attempts}</span>}{f.extra && <span translate="no">Дополнительно: {f.extra}</span>}
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Чат</p>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">{(d.messages as D[]).map((m) => (
          <div key={m.id} className="rounded-xl px-3 py-2 text-sm" style={{ background: m.fromStaff ? 'rgba(79,70,229,.2)' : C.l2, color: C.t1 }}>
            <div className="text-[11px]" style={{ color: C.t3 }}>{m.fromStaff ? 'Поддержка' : 'Пользователь'} · {dt(m.at)}</div><div className="whitespace-pre-wrap break-words" translate="no">{m.body}</div></div>))}</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder="Ответ пользователю" aria-label="Ответ пользователю" className="mt-3 w-full rounded-lg px-3 py-2 text-sm" style={field} />
        <div className="mt-2"><Btn disabled={busy || !text.trim()} onClick={() => void reply()}>Ответить</Btn></div>
        <p className="text-[11px] mt-2" style={{ color: C.t3 }}>Ответ появится в чате пользователя; на его подтверждённую почту уйдёт только уведомление — без текста.</p>
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>Статус</p>
        <div className="flex flex-wrap gap-2">{(d.statuses as D[]).filter((s) => s.key !== d.status).map((s) => <Btn key={s.key} tone={s.key === 'rejected' ? 'red' : 'plain'} onClick={() => void choose(s.key)}>{s.label}</Btn>)}</div>
        {pendingStatus && (
          <div className="mt-3 flex flex-wrap items-center gap-2"><KeyRound size={13} style={{ color: C.acc }} />
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Код подтверждения" aria-label="Код подтверждения" className="rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
            <Btn disabled={code.length < 6} onClick={() => void setStatus(pendingStatus, code)}>Подтвердить</Btn><Btn tone="plain" onClick={() => setPendingStatus(null)}>Отмена</Btn></div>
        )}
        <p className="text-[11px] mt-2" style={{ color: C.t3 }}>«Восстановление разрешено» доступа само не выдаёт: оно лишь открывает пользователю защищённую процедуру с ожиданием. Заявки администраторов разрешает только владелец; заявки владельца — только консоль сервера.</p>
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-xs font-bold mb-2" style={{ color: C.t1 }}>История изменений и события безопасности</p>
        <ul className="space-y-1 text-xs" style={{ color: C.t2 }}>
          {(d.events as D[]).map((e, i) => <li key={`e${i}`}>{dt(e.at)} · {e.event}{e.detail ? ` — ${e.detail}` : ''}</li>)}
          {(d.securityHistory as D[]).map((h, i) => <li key={`h${i}`} style={{ color: h.result === 'ok' ? C.t2 : C.red }}>{dt(h.at)} · {h.event}{h.factor ? ` (${h.factor})` : ''} · {h.result}</li>)}
        </ul>
        {(d.mail as D[]).length > 0 && <p className="text-[11px] mt-2" style={{ color: C.t3 }}>Письма-уведомления: {(d.mail as D[]).map((m) => `${m.kind}: ${m.status}${m.last_error ? ` (${m.last_error})` : ''}`).join('; ')}</p>}
      </div>
    </div>
  );
};

const Security = () => {
  const [pid, setPid] = useState(''); const [reason, setReason] = useState(''); const [code, setCode] = useState(''); const [asked, setAsked] = useState(false);
  const [sky, setSky] = useState(''); const [hist, setHist] = useState<D[] | null>(null);
  const ask = async () => { const r = await apiCall(`${A}/step-up`, { method: 'POST', body: '{}' }); if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не удалось'); setAsked(true); };
  const revoke = async () => { const r = await apiCall(`${A}/admin-token/revoke`, { method: 'POST', body: JSON.stringify({ profileId: pid.trim(), reason, stepUpCode: code }) }); if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не получилось'); flash('Токен отозван'); setAsked(false); setCode(''); setPid(''); setReason(''); };
  const loadHist = async () => { const r = await apiCall<{ items: D[] }>(`${A}/history?skyId=${encodeURIComponent(sky.trim())}`); setHist(r.ok ? r.data?.items ?? [] : []); };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-black mb-1" style={{ color: C.t1 }}>Отозвать токен восстановления администратора</p>
        <p className="text-[11px] mb-2" style={{ color: C.t3 }}>Значение токена вам недоступно и недоступно никому: в базе только хеш. Отзыв действует сразу; новый токен администратор выпускает себе сам после проверки личности.</p>
        <input value={pid} onChange={(e) => setPid(e.target.value)} placeholder="Идентификатор профиля администратора" aria-label="Профиль" className="w-full rounded-lg px-3 py-2 text-sm mb-2" style={field} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина (от 5 знаков)" aria-label="Причина" className="w-full rounded-lg px-3 py-2 text-sm mb-2" style={field} />
        {!asked ? <Btn tone="red" disabled={!pid.trim() || reason.trim().length < 5} onClick={() => void ask()}>Запросить код подтверждения</Btn> : (
          <div className="flex flex-wrap gap-2 items-center"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код" className="rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} /><Btn tone="red" disabled={code.length < 6} onClick={() => void revoke()}>Отозвать токен</Btn></div>
        )}
      </div>
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-sm font-black mb-2" style={{ color: C.t1 }}>История восстановления по аккаунту</p>
        <div className="flex gap-2"><input value={sky} onChange={(e) => setSky(e.target.value)} placeholder="Sky ID (sky-…)" aria-label="Sky ID" className="flex-1 rounded-lg px-3 py-2 text-sm" style={field} /><Btn disabled={!sky.trim()} onClick={() => void loadHist()}>Показать</Btn></div>
        {hist && (hist.length === 0 ? <p className="text-xs mt-2" style={{ color: C.t3 }}>Событий нет.</p> : <ul className="mt-2 space-y-1 text-xs" style={{ color: C.t2 }}>{hist.map((h, i) => <li key={i} style={{ color: h.result === 'ok' ? C.t2 : C.red }}>{dt(h.at)} · {KIND[h.kind] ?? h.kind} · {h.event}{h.factor ? ` (${h.factor})` : ''} · {h.result}</li>)}</ul>)}
      </div>
    </div>
  );
};

export const RecoveryTab = ({ canSecurity }: { canSecurity: boolean }) => {
  const [sub, setSub] = useState<'cases' | 'security'>('cases');
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold" style={{ color: C.t1 }}>Восстановление доступа</p>
      <ScrollTabs>
        <button type="button" onClick={() => setSub('cases')} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: sub === 'cases' ? C.acc : C.l2, color: sub === 'cases' ? '#fff' : C.t2 }}>Поддержка → Обращения на восстановление</button>
        {canSecurity && <button type="button" onClick={() => setSub('security')} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: sub === 'security' ? C.acc : C.l2, color: sub === 'security' ? '#fff' : C.t2 }}>Безопасность → Токены и история</button>}
      </ScrollTabs>
      {sub === 'cases' ? <Cases /> : <Security />}
    </div>
  );
};
