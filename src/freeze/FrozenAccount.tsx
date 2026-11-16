/**
 * Экран замороженного аккаунта (Sky Account) и баннер замороженного канала. Сервер: server/acctfreeze.mjs.
 *  • Аккаунт: поверх приложения — уведомление, причина (только если сотрудник разрешил её показывать), дата, обращение в поддержку, апелляция, доступные чаты,
 *    просмотр баланса, выгрузка своих данных, информация о деньгах («заморозка ничего не возвращает и не списывает автоматически»), выход.
 *  • Канал: баннер над перепиской — статус, причина, дата, как обжаловать (владелец канала подаёт апелляцию здесь же); писать в канал нельзя, читать можно.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Snowflake, Loader2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';
import { useMessengerStore } from '@/messenger/store';
import { useModuleStore } from '@/data/state/modules';
import { apiCreateTicket } from '@/moderation/supportApi';
import { flash } from '@/shared/flash';

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)', green: 'var(--green)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const ERR: Record<string, string> = { appeal_too_short: 'Опишите ситуацию подробнее — не меньше 20 знаков.', appeal_open: 'Ваша апелляция уже на рассмотрении.', too_many_appeals: 'Достигнут предел апелляций.', only_owner_can_appeal: 'Апелляцию подаёт владелец канала.', too_many_requests: 'Слишком часто, подождите.', not_found: 'Заморозка уже снята.' };
const when = (s?: string | null) => (s ? new Date(s).toLocaleString() : '');
const Btn = ({ children, onClick, disabled, tone = 'acc' }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone?: 'acc' | 'plain' }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="rounded-2xl px-4 py-2 text-xs font-bold disabled:opacity-40" style={tone === 'acc' ? { background: C.acc, color: '#fff' } : { background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>{children}</button>
);
const Card = ({ title, children }: { title: string; children: ReactNode }) => <section className="space-y-2 rounded-[22px] p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}><p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>{children}</section>;

const AppealBlock = ({ st, path, onSent }: { st: Data; path: string; onSent: () => void }) => {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); const r = await apiCall<Data>(path, { method: 'POST', body: JSON.stringify({ text }) }); setBusy(false); if (!r.ok || r.data?.error) { flash(ERR[r.data?.error ?? r.error ?? ''] ?? 'Не получилось'); return; } flash('Апелляция отправлена'); setText(''); onSent(); };
  return (
    <div className="space-y-2">
      {(st.appeals as Data[]).map((a) => <p key={a.id} className="text-xs" style={{ color: a.status === 'accepted' ? C.green : a.status === 'rejected' ? C.red : C.t2 }}>{`${when(a.at)} · ${a.status === 'open' ? 'на рассмотрении' : a.status === 'accepted' ? 'принята' : 'отклонена'}${a.decision ? ` — ${a.decision}` : ''}`}</p>)}
      {st.canAppeal && <><textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="Опишите, почему заморозка ошибочна (от 20 знаков)" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
        <Btn disabled={busy || text.trim().length < 20} onClick={() => void send()}>Подать апелляцию</Btn></>}
    </div>
  );
};

const FrozenScreen = ({ st, reload, onClose }: { st: Data; reload: () => void; onClose: () => void }) => {
  const logout = useAuthStore((s) => s.logout as undefined | (() => void));
  const [bal, setBal] = useState<Data | null>(null); const [sub, setSub] = useState(''); const [body, setBody] = useState('');
  const [exp, setExp] = useState<{ hasEmail: boolean; needsTotp: boolean } | null>(null); const [code, setCode] = useState(''); const [totp, setTotp] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { void apiCall<Data>('/api/wallet/balance').then((r) => setBal(r.ok ? r.data ?? null : null)); }, []);
  const f = st.freeze as Data;
  const openChat = (id: string) => { useMessengerStore.getState().setActiveChat(id); useModuleStore.getState().setActiveModule('messages'); onClose(); };
  const ticket = async () => { const r = await apiCreateTicket({ subject: sub || 'Заморожен аккаунт', body, kind: 'appeal' }); if (r.ok) { flash('Обращение отправлено'); setBody(''); } else flash(r.reason ?? 'Не получилось'); };
  const openExport = async () => { const r = await apiCall<Data>('/api/skyid/deletion'); setExp({ hasEmail: Boolean(r.data?.hasEmail), needsTotp: Boolean(r.data?.needsTotp) }); };
  const sendCode = async () => { const r = await apiCall<Data>('/api/skyid/export/code', { method: 'POST', body: '{}' }); if (r.ok) { setSent(true); flash('Код отправлен на почту'); } else flash('Не удалось отправить код'); };
  const doExport = async () => {
    setBusy(true); const r = await apiCall<{ data: unknown }>('/api/skyid/export', { method: 'POST', body: JSON.stringify({ emailCode: code, twoFactorCode: totp || undefined }) }); setBusy(false);
    if (!r.ok || !r.data) { flash('Код не подошёл или выгрузка недоступна'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data.data, null, 2)], { type: 'application/json' })); a.download = 'sky-data.json'; a.click(); URL.revokeObjectURL(a.href); setExp(null); setCode(''); flash('Данные выгружены');
  };
  return (
    <div className="fixed inset-0 z-[100002] overflow-y-auto" style={{ background: 'var(--bg)' }} role="dialog" aria-label="Аккаунт заморожен">
      <div className="mx-auto max-w-xl space-y-3 px-4 py-8" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 24px)' }}>
        <div className="space-y-1 text-center"><Snowflake size={40} style={{ color: C.acc, margin: '0 auto' }} /><h1 className="text-xl font-bold" style={{ color: C.t1 }}>Аккаунт заморожен</h1>
          <p className="text-sm" style={{ color: C.t2 }}>Администрация Sky временно ограничила доступ к аккаунту. Ваши данные не удалены.</p></div>
        <Card title="Что произошло">
          <p className="text-sm" style={{ color: C.t2 }}>{`Дата ограничения: ${when(f.since)}`}</p>{f.until && <p className="text-sm" style={{ color: C.t2 }}>{`Действует до: ${when(f.until)}`}</p>}
          <p className="text-sm" style={{ color: C.t2 }}>{f.reason ? <>Причина: <span translate="no">{f.reason}</span></> : 'Причина в этом окне не раскрывается. Подробности можно запросить в поддержке.'}</p>
        </Card>
        <Card title="Обжалование"><AppealBlock st={st} path="/api/skyid/freeze/appeal" onSent={reload} /></Card>
        <Card title="Поддержка">
          <input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Тема" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Опишите вопрос" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
          <Btn disabled={body.trim().length < 5} onClick={() => void ticket()}>Написать в поддержку</Btn></Card>
        <Card title="Доступные чаты">
          {(st.allowedChats as Data[]).length === 0 ? <p className="text-xs" style={{ color: C.t3 }}>Сотрудник не открыл вам ни одного чата: пока заморозка действует, переписка недоступна.</p>
            : (st.allowedChats as Data[]).map((c) => <button key={c.id} type="button" onClick={() => openChat(c.id)} className="block w-full rounded-xl px-3 py-2 text-left text-sm" style={{ background: C.l2, color: C.t1 }}><span translate="no">{c.title || 'Чат'}</span></button>)}</Card>
        <Card title="Баланс (только просмотр)">
          {bal ? <p className="text-sm" style={{ color: C.t1 }}>{`${Number(bal.balance ?? 0).toLocaleString('ru-RU')} ₽ · ${Number(bal.points ?? 0).toLocaleString('ru-RU')} баллов`}</p> : <Loader2 size={14} className="animate-spin" style={{ color: C.t3 }} />}
          <p className="text-xs" style={{ color: C.t3 }}>{st.refundInfo}</p></Card>
        <Card title="Выгрузка ваших данных">
          {!exp ? <Btn tone="plain" onClick={() => void openExport()}>Скачать мои данные</Btn> : !exp.hasEmail ? <p className="text-xs" style={{ color: C.t3 }}>Для выгрузки нужна подтверждённая почта.</p> : (
            <div className="space-y-2"><Btn tone="plain" onClick={() => void sendCode()}>{sent ? 'Отправить код ещё раз' : 'Отправить код на почту'}</Btn>
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Код из письма" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />
              {exp.needsTotp && <input value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Код аутентификатора" className="w-full rounded-xl px-3 py-2 text-sm" style={field} />}
              <Btn disabled={busy || code.length < 6 || (exp.needsTotp && totp.length < 6)} onClick={() => void doExport()}>Скачать</Btn></div>)}</Card>
        <div className="flex gap-2"><Btn tone="plain" onClick={reload}>Обновить статус</Btn>{logout && <Btn tone="plain" onClick={() => logout()}>Выйти из аккаунта</Btn>}<Btn tone="plain" onClick={onClose}>Свернуть</Btn></div>
      </div>
    </div>
  );
};

/** Монтируется один раз в main.tsx: спрашивает статус после входа и при ответе сервера 403 account_frozen. */
export const FrozenAccountGate = () => {
  const uid = useAuthStore((s) => s.currentUserId); const [st, setSt] = useState<Data | null>(null); const [min, setMin] = useState(false); const last = useRef(0);
  const load = useCallback(async () => {
    if (!uid || Date.now() - last.current < 1500) return; last.current = Date.now();
    const r = await apiCall<Data>('/api/skyid/freeze'); setSt(r.ok && r.data?.frozen ? r.data : null);
  }, [uid]);
  useEffect(() => { setMin(false); void load(); }, [load]);
  useEffect(() => { const h = () => { setMin(false); void load(); }; window.addEventListener('sky:accountfrozen', h); return () => window.removeEventListener('sky:accountfrozen', h); }, [load]);
  useEffect(() => { if (!st) return; const t = setInterval(() => { if (!document.hidden) { last.current = 0; void load(); } }, 30000); return () => clearInterval(t); }, [st, load]);
  if (!st) return null;
  if (min) return <button type="button" onClick={() => setMin(false)} className="fixed left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-bold" style={{ background: C.acc, color: '#fff', marginTop: 'env(safe-area-inset-top)' }}>Аккаунт заморожен — подробности</button>;
  return <FrozenScreen st={st} reload={() => { last.current = 0; void load(); }} onClose={() => setMin(true)} />;
};

/** Состояние заморозки канала/группы (для баннера и запрета ввода). null — не заморожен или не канал. */
export const useChannelFreeze = (chatId: string | null | undefined, type?: string): Data | null => {
  const [st, setSt] = useState<Data | null>(null);
  const load = useCallback(async () => { if (!chatId || (type !== 'channel' && type !== 'group')) { setSt(null); return; } const r = await apiCall<Data>(`/api/skyid/freeze/channel/${encodeURIComponent(chatId)}`); setSt(r.ok && r.data?.frozen ? r.data : null); }, [chatId, type]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = (e: Event) => { if ((e as CustomEvent).detail?.chatId === chatId) void load(); }; window.addEventListener('sky:chatfrozen', h); return () => window.removeEventListener('sky:chatfrozen', h); }, [chatId, load]);
  return st;
};
export const ChannelFreezeBanner = ({ chatId, st, reload }: { chatId: string; st: Data | null; reload?: () => void }) => {
  const [open, setOpen] = useState(false);
  if (!st?.frozen) return null; const f = st.freeze as Data;
  return (
    <div className="shrink-0 space-y-1 px-3 py-2 text-xs" style={{ background: 'rgba(59,130,246,.14)', borderBottom: `1px solid ${C.brd}`, color: C.t1 }}>
      <p className="font-bold">Канал заморожен администрацией — писать нельзя, читать можно</p>
      <p style={{ color: C.t2 }}>{`С ${when(f.since)}${f.until ? ` до ${when(f.until)}` : ''}. ${f.reason ? `Причина: ${f.reason}.` : 'Причина не раскрывается.'}`}</p>
      <p style={{ color: C.t3 }}>{st.howToAppeal}</p>
      {st.isOwner && <button type="button" onClick={() => setOpen((v) => !v)} className="font-bold" style={{ color: C.acc }}>{open ? 'Скрыть' : 'Подать апелляцию'}</button>}
      {open && st.isOwner && <AppealBlock st={st} path={`/api/skyid/freeze/channel/${encodeURIComponent(chatId)}/appeal`} onSent={() => { setOpen(false); reload?.(); }} />}
    </div>
  );
};
