/**
 * Вкладка «Доступ по SSH»: журнал запросов на вход по SSH (подтверждает владелец ссылкой из письма + кодом) и рубильник новых входов.
 * Рубильник — только владелец и с подтверждением личности; он закрывает НОВЫЕ входы, уже открытые сессии не обрывает.
 * Сервер — server/sshgate.mjs, server/routes/sshadmin.mjs, право `security`.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)', amber: 'var(--amber)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const A = '/api/admin/ssh';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', not_found: 'Человек с таким @ником не найден.', target_not_admin: 'Доступ можно выдать только администратору.', owner_has_access: 'У владельца доступ есть всегда.', owner_only: 'Рубильник доступен только владельцу.', step_up_required: 'Нужно подтверждение личности.', step_up_invalid: 'Код не подошёл.',
  step_up_exhausted: 'Слишком много неверных кодов — запросите новый.', no_second_factor: 'Нужен аутентификатор: включите его в Профиль → Sky ID.', lockdown: 'Панель закрыта.', too_many_requests: 'Слишком часто, подождите минуту.',
};
const errText = (e?: string) => (e && ERR[e]) || `Не получилось${e ? ` (${e})` : ''}`;
const STATUS: Record<string, string> = { revoked: 'отменён владельцем («Это не я»)', pending: 'ждёт подтверждения', approved: 'подтверждён', denied: 'отклонён', expired: 'истёк', consumed: 'вход выполнен' };
const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'red' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
    style={tone === 'acc' ? { background: C.acc, color: '#fff' } : { background: 'rgba(239,68,68,.15)', color: C.red }}>{children}</button>
);

export const SshTab = () => {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState('');
  const [ask, setAsk] = useState<'pause' | 'resume' | 'access/grant' | 'access/revoke' | null>(null);
  const [nick, setNick] = useState(''); const [note, setNote] = useState(''); const [target, setTarget] = useState('');
  const [method, setMethod] = useState('');
  const [code, setCode] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiCall<Data>(A);
    if (r.ok) { setData(r.data ?? {}); setFailed(''); } else setFailed(errText(r.error));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const begin = async (what: 'pause' | 'resume' | 'access/grant' | 'access/revoke') => {
    const r = await apiCall<Data>(`${A}/step-up`, { method: 'POST', body: JSON.stringify({}) });
    if (!r.ok) { flash(errText(r.error)); return; }
    setMethod(String(r.data?.method ?? 'app')); setCode(''); setAsk(what);
  };
  const run = async () => {
    if (!ask) return; setBusy(true);
    const r = await apiCall<Data>(`${A}/${ask}`, { method: 'POST', body: JSON.stringify({ stepUpCode: code, reason, username: nick, note, profileId: target }) });
    setBusy(false);
    if (!r.ok) { flash(errText(r.error)); return; }
    flash(ask === 'pause' ? 'Новые входы по SSH закрыты' : ask === 'resume' ? 'Входы по SSH снова разрешены' : ask === 'access/grant' ? 'Доступ к SSH выдан' : 'Доступ к SSH отозван'); setAsk(null); setReason(''); setNick(''); setNote(''); setTarget(''); await load();
  };

  if (failed) return <p className="text-sm" style={{ color: C.red }}>{failed}</p>;
  if (!data) return <Loader2 size={16} className="animate-spin" style={{ color: C.t3 }} />;
  const paused = Boolean(data.state?.paused);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${paused ? C.red : C.brd}` }}>
        <p className="flex items-center gap-2 text-sm font-bold" style={{ color: C.t1 }}>
          {paused ? <ShieldAlert size={16} style={{ color: C.red }} /> : <ShieldCheck size={16} style={{ color: C.green }} />}
          {paused ? 'Новые входы по SSH закрыты' : data.enabled ? 'Вход по SSH: @ник и личный токен администратора, владелец может отменить вход 25 минут' : 'Шлюз SSH не настроен на сервере'}
        </p>
        <p className="mt-1 text-xs" style={{ color: C.t3 }}>
          На сервере спрашиваются @ник и личный токен администратора (SKA-…); пускают владельца и тех, кому владелец выдал доступ ниже. Владельцу сразу приходит сообщение от Sky, и 25 минут он может отменить вход ползунком «Это не я». Рубильник закрывает только НОВЫЕ входы — уже открытые сессии он не обрывает.
          {paused && data.state?.reason ? ` Причина: ${data.state.reason}.` : ''} Если закрыт и этот путь, вход возможен только через консоль хостера.
        </p>
        {!ask && (
          <div className="mt-3">
            {paused ? <Btn onClick={() => void begin('resume')}>Снова разрешить входы</Btn> : <Btn tone="red" onClick={() => void begin('pause')}>Закрыть новые входы</Btn>}
          </div>
        )}
        {ask && !ask.startsWith('access/') && (
          <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
            <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>{'Введите код из приложения-аутентификатора.'}</p>
            {ask === 'pause' && <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} placeholder="Причина (видна в журнале)" aria-label="Причина" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />}
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
              <Btn disabled={code.length < 6 || busy} onClick={() => void run()}>Подтвердить</Btn>
            </div>
            <button type="button" onClick={() => setAsk(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
          </div>
        )}
      </div>

      {data.mode !== 'owner' && (
        <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="mb-1 text-sm font-bold" style={{ color: C.t1 }}>Доступ к SSH по токену</p>
          <p className="mb-2 text-xs" style={{ color: C.t3 }}>Владелец входит по SSH всегда (со своим токеном). Остальным администраторам доступ выдаёт только владелец; у человека должен быть созданный токен администратора (Профиль → Sky ID).</p>
          {(data.access as Data[] | undefined)?.length ? (
            <ul className="mb-2 space-y-1.5">
              {(data.access as Data[]).map((a) => (
                <li key={a.profileId} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
                  <span className="min-w-0 flex-1"><span translate="no" style={{ color: C.t1 }}>@{a.username}</span> · {a.revokedAt ? `отозван (${a.revokedReason || '—'})` : a.hasToken ? 'доступ есть' : 'доступ есть, токен ещё не создан'} · {dt(a.grantedAt)}</span>
                  {!a.revokedAt && data.owner !== false && <Btn tone="red" onClick={() => { setTarget(a.profileId); void begin('access/revoke'); }}>Отозвать</Btn>}
                </li>
              ))}
            </ul>
          ) : <p className="mb-2 text-xs" style={{ color: C.t3 }}>Доступ пока никому не выдан.</p>}
          {!ask && (
            <div className="flex flex-wrap items-center gap-2">
              <input value={nick} onChange={(e) => setNick(e.target.value.slice(0, 40))} placeholder="@ник администратора" aria-label="Ник администратора" translate="no" className="rounded-xl px-3 py-1.5 text-xs outline-none" style={field} />
              <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 120))} placeholder="Заметка (необязательно)" aria-label="Заметка" className="min-w-0 flex-1 rounded-xl px-3 py-1.5 text-xs outline-none" style={field} />
              <Btn disabled={!nick.trim()} onClick={() => void begin('access/grant')}>Выдать доступ</Btn>
            </div>
          )}
        {ask?.startsWith('access/') && (
          <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: C.l2, border: `1px solid ${C.acc}` }}>
            <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: C.t1 }}><KeyRound size={13} style={{ color: C.acc }} />Подтвердите личность</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>{'Введите код из приложения-аутентификатора.'}</p>
            {ask === 'pause' && <input value={reason} onChange={(e) => setReason(e.target.value.slice(0, 160))} placeholder="Причина (видна в журнале)" aria-label="Причина" className="w-full rounded-lg px-3 py-2 text-sm" style={field} />}
            <div className="flex gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="000000" aria-label="Код подтверждения" className="flex-1 rounded-lg px-3 py-2 text-sm tracking-[0.3em]" style={field} />
              <Btn disabled={code.length < 6 || busy} onClick={() => void run()}>Подтвердить</Btn>
            </div>
            <button type="button" onClick={() => setAsk(null)} className="text-[11px]" style={{ color: C.t3 }}>Отмена</button>
          </div>
        )}
        </div>
      )}

      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="mb-2 text-sm font-bold" style={{ color: C.t1 }}>Запросы на вход</p>
        {(data.requests as Data[]).length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Запросов ещё не было.</p> : (
          <ul className="space-y-1.5">
            {(data.requests as Data[]).map((q) => (
              <li key={q.id} className="rounded-lg px-3 py-2 text-xs" style={{ background: C.l2, color: C.t2 }}>
                <span translate="no" className="font-mono" style={{ color: C.t1 }}>{q.user}@{q.host}</span> · <span translate="no">{q.ip}</span> · {STATUS[q.status] ?? q.status} · {dt(q.createdAt)}
                {q.device ? <span translate="no" className="block text-[11px]" style={{ color: C.t3 }}>{q.device}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
