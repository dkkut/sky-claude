/**
 * Двухэтапный вход в панель администратора — сторона панели и страница ссылки.
 * Сервер: server/admingate.mjs. Панель закрыта, пока сессию не подтвердят:
 * ссылка на почту → страница «Авторизоваться» → код из аутентификатора.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, Mail, Loader2, ShieldAlert, ShieldCheck, Power, Siren } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

interface Status { admin: boolean; enabled?: boolean; canPass?: boolean; open?: boolean; pending?: boolean; missing?: { email: boolean; twoFactor: boolean; token?: boolean }; emailHint?: string | null }

const REQ_ERR: Record<string, string> = {
  email_required: 'К аккаунту не привязана подтверждённая почта.',
  two_factor_required: 'Не включён аутентификатор (двухэтапная защита) в настройках Sky ID.',
  too_many_requests: 'Слишком много запросов. Попробуйте через час.',
  email_failed: 'Не удалось отправить письмо. Попробуйте ещё раз.',
  public_url_missing: 'На сервере не задан адрес сайта (DOMAIN) — ссылку собрать нельзя.',
  not_allowed: 'Доступ закрыт.',
};

/** Экран «Подтвердите вход» внутри панели. */
export const AdminGateScreen = ({ onOpened }: { onOpened: () => void }) => {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const sent = useRef(false);

  const load = useCallback(async () => {
    const r = await apiCall<Status>('/api/admin/gate');
    if (r.ok && r.data) { setSt(r.data); if (r.data.open) onOpened(); }
  }, [onOpened]);
  useEffect(() => { void load(); const t = setInterval(() => { if (!document.hidden) void load(); }, 3000); return () => clearInterval(t); }, [load]);

  const send = useCallback(async () => {
    setBusy(true); setMsg('');
    const r = await apiCall('/api/admin/gate/request', { method: 'POST' });
    setBusy(false);
    if (!r.ok) setMsg(REQ_ERR[r.error ?? ''] ?? 'Не удалось отправить ссылку.');
    else void load();
  }, [load]);

  // Ссылка уходит сама при первом открытии панели.
  useEffect(() => { if (st && st.canPass && !st.pending && !st.open && !sent.current) { sent.current = true; void send(); } }, [st, send]);

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <ShieldAlert size={26} style={{ color: 'var(--accent)' }} />
      <p className="text-[15px] font-bold" style={{ color: 'var(--t1)' }}>Подтвердите вход в панель</p>
      {!st ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--t3)' }} /> : (
        <>
          <p className="max-w-[320px] text-[12.5px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            Мы отправили ссылку на почту {st.emailHint ? <b translate="no">{st.emailHint}</b> : 'аккаунта'}. Откройте её, нажмите «Авторизоваться» и введите код из аутентификатора и личный токен администратора.
            Эта страница откроется сама.
          </p>
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--t3)' }}><Loader2 size={13} className="animate-spin" /> Ждём подтверждения…</div>
          <button type="button" disabled={busy} onClick={() => void send()} className="mt-1 flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
            <Mail size={14} /> Отправить ссылку ещё раз
          </button>
          {st.canPass === false && (
            <p className="max-w-[320px] text-[12px]" style={{ color: 'var(--red)' }}>
              {st.missing?.email ? 'Привяжите и подтвердите почту. ' : ''}{st.missing?.twoFactor ? 'Включите аутентификатор в настройках Sky ID. ' : ''}{st.missing?.token ? 'Создайте личный токен: Профиль → Sky ID → «Токен администратора».' : ''}
            </p>
          )}
        </>
      )}
      {msg && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{msg}</p>}
    </div>
  );
};

/* ───────── Страница ссылки: /admin-verify?t=… (без входа в аккаунт) ───────── */

interface LinkInfo { requestedAt: string; device: string; ip: string; owner: boolean; needToken?: boolean }
type Phase = 'loading' | 'invalid' | 'ready' | 'code' | 'done' | 'panic' | 'panicDone';

const fmt = (iso: string) => new Date(iso).toLocaleString();
const CONFIRM_ERR: Record<string, string> = {
  bad_code: 'Код не подошёл.', admin_token_required: 'Введите токен администратора.', admin_token_invalid: 'Токен администратора не подошёл.', admin_token_missing: 'Токен ещё не создан: Профиль → Sky ID → «Токен администратора».', admin_token_blocked: 'Слишком много неверных токенов — подождите.', code_exhausted: 'Слишком много попыток — запросите новую ссылку.',
  two_factor_required: 'У аккаунта не включён аутентификатор.', session_gone: 'Сессия, из которой запрошен вход, уже закрыта.',
  too_many_requests: 'Слишком часто. Подождите минуту.', rate_limited: 'Слишком много запросов с вашего адреса. Подождите минуту.',
  firewall_restricted: 'Сервер в режиме усиленной защиты (файлвол): подтверждение временно закрыто. Снимите режим в админке (Файрвол) или на хосте: sky-heal.sh --unlock.',
  limited_session: 'Эта сессия ограничена: подтвердите устройство на другом вашем устройстве.', module_closed: 'Раздел закрыт администрацией.',
};

/** Один экран для двух входов: в панель (kind='admin') и по SSH (kind='ssh'). */
export const AdminVerifyPage = ({ kind = 'admin' }: { kind?: 'admin' | 'ssh' }) => {
  const base = kind === 'ssh' ? '/api/ssh-gate' : '/api/admin/gate';
  const ssh = kind === 'ssh';
  // Токен берём из адреса один раз и убираем из строки браузера: он не должен остаться в истории и уйти в Referer
  const tokenRef = useRef(new URLSearchParams(location.search).get('t') ?? '');
  const token = tokenRef.current;
  useEffect(() => { try { history.replaceState(null, '', location.pathname); } catch { /* не критично */ } }, []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [code, setCode] = useState('');
  const [tok, setTok] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiCall<LinkInfo>(`${base}/link?t=${encodeURIComponent(token)}`).then((r) => {
      if (r.ok && r.data) { setInfo(r.data); setPhase('ready'); } else setPhase('invalid');
    });
  }, [token]);

  const confirm = async () => {
    setBusy(true); setErr('');
    const r = await apiCall<{ left?: number }>(`${base}/confirm`, { method: 'POST', body: JSON.stringify({ t: token, code: code.trim(), adminToken: tok.trim() }) });
    setBusy(false);
    if (r.ok) { setPhase('done'); return; }
    if (r.error === 'invalid_link') { setPhase('invalid'); return; }
    setErr((CONFIRM_ERR[r.error ?? ''] ?? 'Не удалось подтвердить' + (r.error ? ` (${r.error})` : r.status ? ` (${r.status})` : '') + '.') + (r.error === 'bad_code' && r.data?.left != null ? ` Осталось попыток: ${r.data.left}.` : ''));
  };
  const panic = async (action: 'lockdown' | 'shutdown' | 'deny') => {
    if (action !== 'deny' && !window.confirm(action === 'shutdown' ? 'Выключить сервер для всех пользователей? Сессии администраторов будут завершены.' : 'Включить аварийные работы? Панель закроется, сессии администраторов будут завершены.')) return;
    setBusy(true); setErr('');
    const r = await apiCall(`${base}/panic`, { method: 'POST', body: JSON.stringify({ t: token, action }) });
    setBusy(false);
    if (r.ok) { setPhase('panicDone'); return; }
    if (r.error === 'invalid_link') { setPhase('invalid'); return; }
    setErr(r.error === 'owner_only' ? 'Выключить сервер может только владелец.' : 'Не удалось включить режим. Попробуйте ещё раз.');
  };

  const needTok = !ssh || Boolean(info?.needToken);
  const card = (children: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[420px] rounded-[28px] p-6" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>{children}</div>
  );
  const btn = 'flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold disabled:opacity-50';

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-10" style={{ background: 'var(--bg)' }}>
      {card(<>
        <div className="mb-4 flex items-center gap-2"><Shield size={20} style={{ color: 'var(--accent)' }} /><p className="text-[16px] font-bold">{ssh ? 'Вход на сервер по SSH' : 'Вход в панель администратора'}</p></div>
        {phase === 'loading' && <Loader2 size={18} className="animate-spin" />}
        {phase === 'invalid' && <p className="text-[13px]" style={{ color: 'var(--t2)' }}>{ssh ? 'Ссылка недействительна: она уже использована, устарела (живёт 5 минут) или вход отклонён. Войдите по SSH заново — придёт новое письмо.' : 'Ссылка недействительна: она уже использована, устарела или доступ к панели закрыт. Откройте панель и запросите новую.'}</p>}
        {(phase === 'ready' || phase === 'code' || phase === 'panic') && info && (
          <>
            <div className="mb-4 space-y-1 rounded-2xl p-3 text-[12.5px]" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
              <p>Запрошен: <b>{fmt(info.requestedAt)}</b></p>
              <p>Устройство: <b translate="no">{info.device || 'неизвестно'}</b></p>
              <p>Адрес: <b translate="no">{info.ip || 'неизвестен'}</b></p>
            </div>
            {phase === 'ready' && (
              <div className="space-y-2">
                <button type="button" onClick={() => setPhase('code')} className={btn} style={{ background: 'var(--accent)', color: '#fff' }}><ShieldCheck size={16} /> Авторизоваться</button>
                <button type="button" onClick={() => setPhase('panic')} className={btn} style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}><Siren size={16} /> Это не я, включить систему безопасности</button>
              </div>
            )}
            {phase === 'code' && (
              <div className="space-y-3">
                <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>{!ssh ? 'Введите шестизначный код из приложения-аутентификатора и личный токен администратора.' : info.needToken ? 'Введите шестизначный код из приложения-аутентификатора и личный токен администратора. Это вся проверка: в терминале ничего вводить не нужно.' : 'Введите шестизначный код из приложения-аутентификатора.'}</p>
                <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus placeholder="000000" aria-label="Код из аутентификатора"
                  className="w-full rounded-full px-5 py-3 text-center text-[20px] font-bold tracking-[0.4em] outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && (!needTok || tok.trim())) void confirm(); }} />
                {needTok && <input value={tok} onChange={(e) => setTok(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Токен администратора" aria-label="Токен администратора" translate="no"
                  className="w-full rounded-full px-5 py-3 text-center text-[14px] font-semibold outline-none" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)', letterSpacing: '.04em' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6 && tok.trim()) void confirm(); }} />}
                <button type="button" disabled={busy || code.length !== 6 || (needTok && !tok.trim())} onClick={() => void confirm()} className={btn} style={{ background: 'var(--accent)', color: '#fff' }}>{busy ? 'Проверяем…' : 'Подтвердить вход'}</button>
                <button type="button" onClick={() => { setPhase('ready'); setErr(''); }} className="w-full text-[12.5px]" style={{ color: 'var(--t3)' }}>Назад</button>
              </div>
            )}
            {phase === 'panic' && (
              <div className="space-y-2">
                <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>{ssh ? 'Вход по SSH будет отклонён. Дальше выберите, нужно ли закрыть панель и сервер.' : 'Выберите, что сделать. Все сессии вашего аккаунта и других администраторов будут завершены.'}</p>
                {ssh && <button type="button" disabled={busy} onClick={() => void panic('deny')} className={btn} style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}><ShieldAlert size={16} /> Только отклонить вход</button>}
                {info.owner && <button type="button" disabled={busy} onClick={() => void panic('shutdown')} className={btn} style={{ background: 'var(--red)', color: '#fff' }}><Power size={16} /> Выключить сервер</button>}
                <button type="button" disabled={busy} onClick={() => void panic('lockdown')} className={btn} style={{ background: 'rgba(239,68,68,0.14)', color: 'var(--red)' }}><Siren size={16} /> Ввести аварийные работы</button>
                {!info.owner && <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>Выключить сервер может только владелец.</p>}
                <button type="button" onClick={() => { setPhase('ready'); setErr(''); }} className="w-full text-[12.5px]" style={{ color: 'var(--t3)' }}>Назад</button>
              </div>
            )}
            {err && <p className="mt-3 text-[12.5px]" style={{ color: 'var(--red)' }}>{err}</p>}
          </>
        )}
        {phase === 'done' && <p className="text-[13.5px]" style={{ color: 'var(--t1)' }}>{ssh ? 'Вход подтверждён. SSH-сессия откроется сама в течение нескольких секунд.' : 'Вход подтверждён. Вернитесь в панель — она откроется сама.'}</p>}
        {phase === 'panicDone' && <p className="text-[13.5px]" style={{ color: 'var(--t1)' }}>{ssh ? 'Вход по SSH отклонён. Если вы выбрали аварийный режим, панель закрыта, сессии администраторов завершены.' : 'Система безопасности включена, сессии администраторов завершены. Владелец уведомлён.'}</p>}
      </>)}
    </div>
  );
};

/**
 * Страница ссылки из прежнего письма «Зафиксирован успешный вход по SSH — подтвердите за 10 минут» (/ssh-confirm?token=…,
 * хук ssh-login-hook.sh). Две кнопки: «Это я» и «Это не я» (сразу аварийный режим и сигнал на выключение сервера).
 * Сервер: server/breach.mjs, /api/ssh-gate/legacy*.
 */
export const SshLegacyConfirmPage = () => {
  const tokenRef = useRef(new URLSearchParams(location.search).get('token') ?? '');
  const token = tokenRef.current;
  useEffect(() => { try { history.replaceState(null, '', location.pathname); } catch { /* не критично */ } }, []);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'ok' | 'denied'>('loading');
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    void apiCall<{ secondsLeft: number }>(`/api/ssh-gate/legacy?token=${encodeURIComponent(token)}`).then((r) => {
      if (r.ok && r.data) { setLeft(r.data.secondsLeft); setPhase('ready'); } else setPhase('invalid');
    });
  }, [token]);
  const act = async (what: 'confirm' | 'deny') => {
    if (what === 'deny' && !window.confirm('Это не вы? Будет включён аварийный режим, сессии администраторов завершатся, сервер выключится.')) return;
    setBusy(true); setErr('');
    const r = await apiCall(`/api/ssh-gate/legacy/${what}`, { method: 'POST', body: JSON.stringify({ token }) });
    setBusy(false);
    if (r.ok) { setPhase(what === 'confirm' ? 'ok' : 'denied'); return; }
    if (r.error === 'invalid_link') { setPhase('invalid'); return; }
    setErr('Не удалось выполнить действие. Попробуйте ещё раз.');
  };
  const btn = 'flex w-full items-center justify-center gap-2 rounded-full py-3 text-[14px] font-bold disabled:opacity-50';
  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-10" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[420px] rounded-[28px] p-6" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
        <div className="mb-4 flex items-center gap-2"><Shield size={20} style={{ color: 'var(--accent)' }} /><p className="text-[16px] font-bold">Вход на сервер по SSH</p></div>
        {phase === 'loading' && <Loader2 size={18} className="animate-spin" />}
        {phase === 'invalid' && <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Ссылка недействительна: она уже использована или прошло больше 10 минут. Если вход был не вашим, сервер выключится автоматически по истечении этого времени.</p>}
        {phase === 'ready' && (
          <div className="space-y-2">
            <p className="mb-3 text-[12.5px]" style={{ color: 'var(--t2)' }}>{`Зафиксирован вход по SSH. Подтвердите, что это вы, — осталось примерно ${Math.max(1, Math.ceil(left / 60))} мин. Без подтверждения сервер будет выключен.`}</p>
            <button type="button" disabled={busy} onClick={() => void act('confirm')} className={btn} style={{ background: 'var(--accent)', color: '#fff' }}><ShieldCheck size={16} /> Это я, подтвердить</button>
            <button type="button" disabled={busy} onClick={() => void act('deny')} className={btn} style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)' }}><Siren size={16} /> Это не я, включить систему безопасности</button>
            {err && <p className="mt-2 text-[12.5px]" style={{ color: 'var(--red)' }}>{err}</p>}
          </div>
        )}
        {phase === 'ok' && <p className="text-[13.5px]">Подтверждено: вход по SSH — это были вы. Автоматическое выключение сервера отменено.</p>}
        {phase === 'denied' && <p className="text-[13.5px]">Принято: вход отмечен как чужой. Аварийный режим включён, сервер будет выключен, владелец уведомлён.</p>}
      </div>
    </div>
  );
};
