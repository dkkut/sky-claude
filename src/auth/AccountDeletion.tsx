/* Удаление аккаунта (Профиль → Sky ID → «Удаление аккаунта») и восстановление на экране входа.
   Серверная часть — server/accountdeletion.mjs: удаление идёт 30 дней, до этого срока аккаунт можно вернуть кодом с почты. */
import { useCallback, useEffect, useState } from 'react';
import { Trash2, Download, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Preview {
  ok?: boolean; scope: 'account' | 'profile'; profiles: { id: string; username: string; name: string }[];
  blockers: { code: string; text: string }[]; warnings: { code: string; text: string }[];
  counts: Record<string, number>; wallet: { rub: number; points: number }; hasPrime: boolean; canRequest: boolean; retentionDays: number;
}
interface Status { pending: { id: string; scope: 'account' | 'profile'; profileId: string | null; purgeAt: string; daysLeft: number }[]; hasEmail: boolean; needsTotp: boolean; retentionDays: number }

const ERR: Record<string, string> = {
  email_required: 'Для удаления нужна подтверждённая почта: привяжите её в разделе Sky ID.', two_factor_required: 'Введите код из приложения-аутентификатора.',
  email_code_required: 'Введите код из письма.', invalid_code: 'Код неверный или устарел.', too_many_attempts: 'Слишком много попыток. Подождите.',
  blocked: 'Сначала закройте незавершённые дела (см. список).', ack_required: 'Подтвердите, что понимаете последствия.', ack_wallet_required: 'Подтвердите потерю баланса.',
  ack_prime_required: 'Подтвердите потерю подписки.', last_profile: 'Это единственный профиль — удалите весь Sky ID.', already_pending: 'Удаление уже запрошено.',
  too_many_requests: 'Слишком часто. Попробуйте позже.', not_pending: 'Удаление этого профиля не запрошено.',
};
const msg = (e?: string) => ERR[e ?? ''] ?? 'Не получилось. Попробуйте ещё раз.';
const fmt = (iso: string) => new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'long', year: 'numeric' });

const box = { background: 'var(--bg-l1)', border: '1px solid var(--border)' };
const field = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' };

const CodeFields = ({ needsTotp, code, setCode, totp, setTotp, onSend, sent, busy }: { needsTotp: boolean; code: string; setCode: (v: string) => void; totp: string; setTotp: (v: string) => void; onSend: () => void; sent: boolean; busy: boolean }) => (
  <div className="space-y-2">
    <button type="button" disabled={busy} onClick={onSend} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}>{sent ? 'Отправить код ещё раз' : 'Отправить код на почту'}</button>
    <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Код из письма" aria-label="Код из письма" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
    {needsTotp && <input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Код аутентификатора" aria-label="Код аутентификатора" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />}
  </div>
);

export const AccountDeletion = () => {
  const [st, setSt] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'account' | 'profile'>('account');
  const [profileId, setProfileId] = useState('');
  const [pre, setPre] = useState<Preview | null>(null);
  const [ack, setAck] = useState({ understood: false, wallet: false, prime: false });
  const [code, setCode] = useState(''); const [totp, setTotp] = useState(''); const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [exp, setExp] = useState(false);

  const load = useCallback(async () => { const r = await apiCall<Status>('/api/skyid/deletion'); if (r.ok && r.data) setSt(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  const loadPreview = useCallback(async () => {
    setPre(null); setErr('');
    const q = scope === 'profile' ? `?scope=profile&profileId=${encodeURIComponent(profileId)}` : '';
    const r = await apiCall<Preview>(`/api/skyid/deletion/preview${q}`);
    if (r.ok && r.data) setPre(r.data); else setErr(msg(r.error));
  }, [scope, profileId]);
  useEffect(() => { if (open && (scope === 'account' || profileId)) void loadPreview(); }, [open, scope, profileId, loadPreview]);

  const sendCode = async (path = '/api/skyid/deletion/code') => {
    setBusy(true); setErr('');
    const r = await apiCall(path, { method: 'POST', body: '{}' });
    setBusy(false);
    if (!r.ok) { setErr(msg(r.error)); return; }
    setSent(true); flash('Код отправлен на почту');
  };
  const request = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ purgeAt: string }>('/api/skyid/deletion/request', { method: 'POST', body: JSON.stringify({ scope, profileId: scope === 'profile' ? profileId : undefined, ack, emailCode: code, twoFactorCode: totp || undefined }) });
    setBusy(false);
    if (!r.ok) { setErr(msg(r.error)); return; }
    if (scope === 'account') { flash('Удаление запрошено. Вы вышли из аккаунта.'); window.location.reload(); return; }
    flash('Профиль будет удалён через 30 дней'); setOpen(false); setCode(''); setSent(false); void load();
  };
  const cancelProfile = async (pid: string) => {
    if (code.length !== 6) { setErr('Введите код из письма — сначала нажмите «Отправить код».'); return; }
    setBusy(true); setErr('');
    const r = await apiCall('/api/skyid/deletion/cancel-profile', { method: 'POST', body: JSON.stringify({ profileId: pid, emailCode: code, twoFactorCode: totp || undefined }) });
    setBusy(false);
    if (!r.ok) { setErr(msg(r.error)); return; }
    flash('Удаление профиля отменено'); setCode(''); setSent(false); void load();
  };
  const doExport = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ data: unknown }>('/api/skyid/export', { method: 'POST', body: JSON.stringify({ emailCode: code, twoFactorCode: totp || undefined }) });
    setBusy(false);
    if (!r.ok || !r.data) { setErr(msg(r.error)); return; }
    const blob = new Blob([JSON.stringify(r.data.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sky-data.json'; a.click(); URL.revokeObjectURL(a.href);
    setExp(false); setCode(''); setSent(false); flash('Данные выгружены');
  };

  if (!st) return null;
  const canSubmit = pre?.canRequest && ack.understood && (!(pre.wallet.rub || pre.wallet.points) || ack.wallet) && (!pre.hasPrime || ack.prime) && code.length === 6 && (!st.needsTotp || totp.length === 6);

  return (
    <section className="space-y-3 rounded-2xl p-4" style={box} data-account-deletion>
      <p className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--t1)' }}><Trash2 size={15} style={{ color: 'var(--red)' }} />Удаление аккаунта</p>

      {st.pending.filter((p) => p.scope === 'profile').map((p) => (
        <div key={p.id} className="space-y-2 rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <p className="text-[13px]" style={{ color: 'var(--t1)' }}>Профиль будет удалён {fmt(p.purgeAt)} (осталось дней: {p.daysLeft}).</p>
          <CodeFields needsTotp={st.needsTotp} code={code} setCode={setCode} totp={totp} setTotp={setTotp} onSend={() => void sendCode()} sent={sent} busy={busy} />
          <button type="button" disabled={busy} onClick={() => { if (p.profileId) void cancelProfile(p.profileId); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }}><RotateCcw size={13} />Отменить удаление профиля</button>
        </div>
      ))}

      <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Удалённый аккаунт можно вернуть в течение {st.retentionDays} дней. Потом данные стираются окончательно; финансовые записи хранятся обезличенно, как требует закон.</p>
      {!st.hasEmail && <p className="text-[12px]" style={{ color: 'var(--amber, #f59e0b)' }}>Чтобы удалить аккаунт или выгрузить данные, привяжите и подтвердите почту.</p>}

      {!open && !exp && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!st.hasEmail} onClick={() => setOpen(true)} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)' }}>Удалить аккаунт…</button>
          <button type="button" disabled={!st.hasEmail} onClick={() => { setExp(true); setErr(''); setCode(''); setSent(false); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}><Download size={13} />Выгрузить мои данные</button>
        </div>
      )}

      {exp && (
        <div className="space-y-2">
          <p className="text-[12px]" style={{ color: 'var(--t2)' }}>Файл JSON с вашими данными (профиль, настройки, коллекции, транзакции). Сообщения чатов не входят. Нужен код с почты.</p>
          <CodeFields needsTotp={st.needsTotp} code={code} setCode={setCode} totp={totp} setTotp={setTotp} onSend={() => void sendCode('/api/skyid/export/code')} sent={sent} busy={busy} />
          <div className="flex gap-2"><button type="button" disabled={busy || code.length !== 6 || (st.needsTotp && totp.length !== 6)} onClick={() => void doExport()} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Скачать</button>
            <button type="button" onClick={() => setExp(false)} className="min-h-[36px] rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Отмена</button></div>
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(['account', 'profile'] as const).map((s) => (
              <button key={s} type="button" onClick={() => { setScope(s); setPre(null); }} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={scope === s ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-l2)', color: 'var(--t2)' }}>{s === 'account' ? 'Весь Sky ID' : 'Один профиль'}</button>))}
          </div>
          {scope === 'profile' && <ProfilePicker value={profileId} onChange={setProfileId} />}
          {!pre && !err && <Loader2 size={14} className="animate-spin" />}
          {pre && (<>
            {pre.blockers.length > 0 && <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}><p className="mb-1 flex items-center gap-1 text-[12px] font-bold" style={{ color: 'var(--red)' }}><AlertTriangle size={13} />Сначала нужно закрыть:</p><ul className="list-disc pl-5 text-[12px]" style={{ color: 'var(--t1)' }}>{pre.blockers.map((b) => <li key={b.code}>{b.text}</li>)}</ul></div>}
            <ul className="list-disc space-y-1 pl-5 text-[12px]" style={{ color: 'var(--t2)' }}>{pre.warnings.map((w) => <li key={w.code}>{w.text}</li>)}</ul>
            <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Затронет: {Object.entries(pre.counts).filter(([, v]) => v > 0).map(([k, v]) => `${COUNT_LABEL[k] ?? k}: ${v}`).join(' · ') || 'личные данные профиля'}</p>
            <label className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--t1)' }}><input type="checkbox" checked={ack.understood} onChange={(e) => setAck({ ...ack, understood: e.target.checked })} />Я понимаю последствия; данные будут удалены через {pre.retentionDays} дней, до этого срока аккаунт можно вернуть</label>
            {(pre.wallet.rub > 0 || pre.wallet.points > 0) && <label className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--red)' }}><input type="checkbox" checked={ack.wallet} onChange={(e) => setAck({ ...ack, wallet: e.target.checked })} />Баланс ({pre.wallet.rub} ₽, {pre.wallet.points} баллов) будет потерян</label>}
            {pre.hasPrime && <label className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--red)' }}><input type="checkbox" checked={ack.prime} onChange={(e) => setAck({ ...ack, prime: e.target.checked })} />Подписка Sky Prime пропадёт без возврата</label>}
            <CodeFields needsTotp={st.needsTotp} code={code} setCode={setCode} totp={totp} setTotp={setTotp} onSend={() => void sendCode()} sent={sent} busy={busy} />
          </>)}
          {err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy || !canSubmit} onClick={() => void request()} className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--red)', color: '#fff' }}>Удалить аккаунт</button>
            <button type="button" onClick={() => { setOpen(false); setErr(''); }} className="min-h-[36px] rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Отмена</button>
          </div>
        </div>
      )}
      {!open && err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
    </section>
  );
};

const COUNT_LABEL: Record<string, string> = { tracks: 'треки', movies: 'фильмы', books: 'книги', videos: 'видео', posts: 'посты', followers: 'подписчики', chats: 'чаты' };

const ProfilePicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [list, setList] = useState<{ id: string; name: string; username: string }[]>([]);
  useEffect(() => { void apiCall<{ profiles: { id: string; name: string; username: string }[] }>('/api/skyid/profiles').then((r) => { if (r.ok && r.data) setList(r.data.profiles); }); }, []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Профиль" className="w-full rounded-xl px-3 py-2.5 text-sm" style={field}>
      <option value="">Выберите профиль</option>
      {list.map((p) => <option key={p.id} value={p.id}>{p.name} (@{p.username})</option>)}
    </select>
  );
};

/** Экран входа: аккаунт ждёт удаления — вернуть его можно кодом с почты. */
export const RestoreAccount = ({ onClose, purgeAt }: { onClose: () => void; purgeAt?: string }) => {
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [code, setCode] = useState(''); const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const start = async () => { setBusy(true); setErr(''); await apiCall('/api/auth/deletion/restore/start', { method: 'POST', body: JSON.stringify({ identifier: email }) }); setBusy(false); setSent(true); };
  const finish = async () => {
    setBusy(true); setErr('');
    const r = await apiCall('/api/auth/deletion/restore/finish', { method: 'POST', body: JSON.stringify({ identifier: email, emailCode: code, twoFactorCode: totp || undefined }) });
    setBusy(false);
    if (r.ok) { setDone(true); return; }
    if (r.error === 'two_factor_required') setNeedsTotp(true);
    setErr(msg(r.error));
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm space-y-3 rounded-3xl p-5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
        <p className="text-base font-bold" style={{ color: 'var(--t1)' }}>Восстановить аккаунт</p>
        {done ? (<>
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Аккаунт восстановлен. Теперь можно войти как обычно.</p>
          <button type="button" onClick={onClose} className="w-full rounded-2xl py-2.5 text-sm font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Войти</button>
        </>) : (<>
          <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{purgeAt ? `Аккаунт будет удалён ${fmt(purgeAt)}. ` : ''}Укажите почту аккаунта — мы отправим код. Данные не потеряны, пока не пройдёт срок удаления.</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Почта аккаунта" aria-label="Почта аккаунта" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
          {!sent ? <button type="button" disabled={busy || !email.includes('@')} onClick={() => void start()} className="w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Отправить код</button> : (<>
            <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Если такой аккаунт ждёт удаления, код отправлен на его почту.</p>
            <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Код из письма" aria-label="Код из письма" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />
            {needsTotp && <input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Код аутентификатора" aria-label="Код аутентификатора" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={field} />}
            <button type="button" disabled={busy || code.length !== 6} onClick={() => void finish()} className="w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40" style={{ background: 'var(--accent)', color: '#fff' }}>Восстановить</button>
          </>)}
          {err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
          <button type="button" onClick={onClose} className="min-h-[36px] w-full rounded-xl px-4 py-2 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Закрыть</button>
        </>)}
      </div>
    </div>
  );
};
