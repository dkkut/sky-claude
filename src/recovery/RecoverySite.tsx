/**
 * Сайт восстановления доступа Sky (recovery.skymessenger.online).
 * Экраны: главная, восстановление Sky ID / администратора / владельца, бланк для поддержки, чат заявки, ссылки из писем, справка.
 * Секреты (запрос восстановления, ключ чата, токены ссылок) в адресе не передаются: ссылки несут их во фрагменте (#…), который читается и сразу стирается;
 * запрос и ключ лежат в sessionStorage/localStorage только на этом устройстве.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ShieldCheck, KeyRound, Crown, LifeBuoy, ArrowLeft, Mail, Smartphone, Loader2, CheckCircle2, Send, Lock, Info } from 'lucide-react';

const BASE = typeof location !== 'undefined' && (location.pathname === '/recovery-site' || location.pathname.startsWith('/recovery-site/')) ? '/recovery-site' : '';
const APP_URL = (() => { try { const h = location.hostname; return h.startsWith('recovery.') ? `https://${h.replace(/^recovery\./, 'web.')}` : location.origin; } catch { return ''; } })();

type R = { ok: boolean; status: number; data: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const rc = async (path: string, body?: unknown, headers: Record<string, string> = {}): Promise<R> => {
  try {
    const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store' });
    let data: unknown = {}; try { data = await r.json(); } catch { /* пустой ответ */ }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { error: 'network' } }; }
};

const ERR: Record<string, string> = {
  too_many_requests: 'Слишком много попыток. Подождите и попробуйте позже.', verification_failed: 'Значение не подошло. Проверьте и попробуйте ещё раз.',
  invalid_request: 'Сеанс восстановления истёк. Начните заново.', not_enough_factors: 'Пока недостаточно подтверждений для этого сценария.',
  wrong_account_type: 'Для этого аккаунта восстановление идёт другим сценарием.', invalid_link: 'Ссылка недействительна или уже использована.', not_ready: 'Ожидание ещё не закончилось.',
  bad_password: 'Пароль — от 8 до 200 знаков.', invalid_email: 'Проверьте адрес почты.', same_as_primary: 'Резервная почта должна отличаться от основной.',
  email_unavailable: 'Этот адрес использовать нельзя.', network: 'Нет связи с сервером.', bad_field: 'Проверьте заполнение полей.', not_found: 'Не найдено.', closed: 'Обращение закрыто.',
  limited_only: 'Одного этого фактора недостаточно, чтобы открыть аккаунт.', empty: 'Введите текст.',
};
const errText = (d: { error?: string }) => ERR[d?.error ?? ''] ?? 'Не получилось. Попробуйте ещё раз.';

/** Прочитать секрет из фрагмента адреса и стереть его из адресной строки. */
const takeFragment = (key: string): string => {
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const v = h.get(key) ?? '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return v;
  } catch { return ''; }
};

const css = `
.rcv-bg{min-height:100vh;color:#e8eaff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(1200px 700px at 10% -10%,rgba(99,102,241,.35),transparent 60%),radial-gradient(900px 600px at 100% 10%,rgba(168,85,247,.28),transparent 55%),radial-gradient(900px 700px at 50% 120%,rgba(37,99,235,.28),transparent 60%),#070816;position:relative;overflow-x:hidden}
.rcv-stars{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1px 1px at 20% 30%,#fff9,transparent),radial-gradient(1px 1px at 70% 20%,#fff8,transparent),radial-gradient(1.5px 1.5px at 40% 70%,#fff7,transparent),radial-gradient(1px 1px at 85% 60%,#fff8,transparent),radial-gradient(1px 1px at 10% 85%,#fff6,transparent);background-size:480px 480px;opacity:.7;animation:rcvtw 9s ease-in-out infinite alternate}
@keyframes rcvtw{from{opacity:.4}to{opacity:.85}}
.rcv-glass{background:linear-gradient(160deg,rgba(255,255,255,.075),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.13);box-shadow:0 18px 60px rgba(4,6,30,.55),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);border-radius:24px}
.rcv-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 20px;border-radius:16px;font-weight:700;font-size:14px;color:#fff;background:linear-gradient(135deg,#4f46e5,#7c3aed 60%,#2563eb);box-shadow:0 8px 28px rgba(79,70,229,.45);border:0;cursor:pointer;transition:transform .15s,filter .15s}
.rcv-btn:hover{filter:brightness(1.1);transform:translateY(-1px)}.rcv-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.rcv-btn.plain{background:rgba(255,255,255,.08);box-shadow:none;border:1px solid rgba(255,255,255,.15)}
.rcv-in{width:100%;min-height:46px;padding:0 14px;border-radius:14px;color:#fff;background:rgba(5,8,32,.6);border:1px solid rgba(255,255,255,.16);outline:none;font-size:15px}
.rcv-in:focus{border-color:#8b8cf8;box-shadow:0 0 0 3px rgba(129,140,248,.25)}textarea.rcv-in{padding:12px 14px;min-height:96px;resize:vertical}
.rcv-card{transition:transform .2s,border-color .2s}.rcv-card:hover{transform:translateY(-3px);border-color:rgba(165,167,255,.5)}
@media (prefers-reduced-motion:reduce){.rcv-stars{animation:none}.rcv-card:hover,.rcv-btn:hover{transform:none}}
`;

const go = (to: string) => { history.pushState(null, '', BASE + to); window.dispatchEvent(new Event('rcv:nav')); window.scrollTo({ top: 0 }); };
const A = ({ to, children, className, style }: { to: string; children: ReactNode; className?: string; style?: React.CSSProperties }) => (
  <a href={BASE + to} className={className} style={style} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to); }}>{children}</a>
);

const Shell = ({ children, back }: { children: ReactNode; back?: boolean }) => (
  <div className="rcv-bg">
    <style>{css}</style><div className="rcv-stars" aria-hidden />
    <header style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
      {back && <button type="button" className="rcv-btn plain" style={{ minHeight: 40, padding: '0 12px' }} onClick={() => history.length > 1 ? history.back() : go('/')} aria-label="Назад"><ArrowLeft size={16} /></button>}
      <A to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', textDecoration: 'none', fontWeight: 800, letterSpacing: .3 }}>
        <img src="/logo.png" alt="" width={30} height={30} style={{ borderRadius: 9 }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />Sky Recovery
      </A>
      <span style={{ marginLeft: 'auto', fontSize: 12, opacity: .6 }}>Восстановление доступа</span>
    </header>
    <main style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '8px 16px 56px' }}>{children}</main>
    <footer style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '0 16px 36px', fontSize: 12, opacity: .7, display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <a href={APP_URL || '/'} style={{ color: '#c7c9ff' }}>Вернуться в Sky Messenger</a>
      <A to="/how" style={{ color: '#c7c9ff' }}>Как работает восстановление</A>
      <A to="/protect" style={{ color: '#c7c9ff' }}>Как защитить аккаунт</A>
      <span>Мы никогда не просим пароль, коды из приложений и резервные коды в чате или по почте.</span>
    </footer>
  </div>
);

const Card = ({ children, style }: { children: ReactNode; style?: React.CSSProperties }) => <section className="rcv-glass" style={{ padding: 22, ...style }}>{children}</section>;
const H1 = ({ children }: { children: ReactNode }) => <h1 style={{ fontSize: 'clamp(26px,5vw,40px)', fontWeight: 800, lineHeight: 1.1, margin: '8px 0 10px', background: 'linear-gradient(120deg,#fff,#c4b5fd 60%,#93c5fd)', WebkitBackgroundClip: 'text', color: 'transparent' }}>{children}</h1>;
const Note = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' | 'bad' }) => {
  const c = { info: '#93c5fd', warn: '#fbbf24', ok: '#6ee7b7', bad: '#fca5a5' }[tone];
  return <p role={tone === 'bad' ? 'alert' : 'status'} style={{ margin: '12px 0 0', padding: '10px 14px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, color: c, background: 'rgba(255,255,255,.05)', border: `1px solid ${c}55` }}>{children}</p>;
};
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label style={{ display: 'block', margin: '12px 0 0' }}><span style={{ display: 'block', fontSize: 12.5, opacity: .75, marginBottom: 6 }}>{label}</span>{children}{hint && <span style={{ display: 'block', fontSize: 11.5, opacity: .55, marginTop: 5 }}>{hint}</span>}</label>
);

/* ─── Главная ─── */
const Home = () => (
  <Shell>
    <div style={{ textAlign: 'center', padding: '26px 0 22px' }}>
      <H1>Вернём доступ к вашему Sky</H1>
      <p style={{ maxWidth: 620, margin: '0 auto', opacity: .8, lineHeight: 1.6 }}>Потеряли пароль, почту или приложение-аутентификатор? Выберите сценарий. Восстановление помогает настоящему владельцу и не открывает дорогу злоумышленнику — поэтому иногда нужно подождать и подтвердить себя несколькими способами.</p>
    </div>
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))' }}>
      {[
        { to: '/user', icon: <ShieldCheck size={22} />, title: 'Восстановить доступ к Sky ID', text: 'Для обычных аккаунтов: резервная почта, приложение-аутентификатор, резервные коды.' },
        { to: '/admin', icon: <KeyRound size={22} />, title: 'Восстановить доступ администратора', text: 'Нужен токен восстановления, выданный при назначении, и ещё один фактор.' },
        { to: '/owner', icon: <Crown size={22} />, title: 'Экстренное восстановление владельца', text: 'Отдельная процедура с секретом владельца и обязательным ожиданием.' },
      ].map((c) => (
        <A key={c.to} to={c.to} className="rcv-glass rcv-card" style={{ padding: 22, color: '#fff', textDecoration: 'none', display: 'block' }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 44, height: 44, borderRadius: 14, background: 'rgba(129,140,248,.2)', marginBottom: 12 }}>{c.icon}</span>
          <strong style={{ display: 'block', fontSize: 17, marginBottom: 6 }}>{c.title}</strong><span style={{ fontSize: 13.5, opacity: .75, lineHeight: 1.5 }}>{c.text}</span>
        </A>
      ))}
    </div>
    <Card style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
      <LifeBuoy size={22} /><div style={{ flex: '1 1 260px' }}><strong>Не получается восстановить доступ?</strong><div style={{ fontSize: 13, opacity: .7, marginTop: 4 }}>Заполните бланк — обращение попадёт в техническую поддержку Sky, а переписка будет вестись в чате заявки.</div></div>
      <A to="/case/new" className="rcv-btn">Обратиться в поддержку</A>
      <A to="/case" className="rcv-btn plain">У меня уже есть обращение</A>
    </Card>
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', marginTop: 16 }}>
      <A to="/how" className="rcv-glass rcv-card" style={{ padding: 18, color: '#fff', textDecoration: 'none' }}><Info size={18} /> <strong>Как работает восстановление</strong></A>
      <A to="/protect" className="rcv-glass rcv-card" style={{ padding: 18, color: '#fff', textDecoration: 'none' }}><Lock size={18} /> <strong>Как защитить свой аккаунт</strong></A>
      <a href={APP_URL || '/'} className="rcv-glass rcv-card" style={{ padding: 18, color: '#fff', textDecoration: 'none' }}><ArrowLeft size={18} /> <strong>Вернуться в Sky Messenger</strong></a>
    </div>
  </Shell>
);

/* ─── Справка ─── */
const How = () => (
  <Shell back>
    <H1>Как работает восстановление</H1>
    <Card>
      <ol style={{ lineHeight: 1.75, paddingLeft: 20, margin: 0 }}>
        <li>Вы указываете почту, телефон, @ник или Sky ID. Мы <b>не говорим</b>, существует ли аккаунт, — ответ всегда одинаковый.</li>
        <li>Вы подтверждаете себя: код на <b>резервную почту</b>, код <b>приложения-аутентификатора</b> или <b>резервный код</b>. Для администраторов — ещё токен восстановления, для владельца — секрет владельца.</li>
        <li>Если подтверждений достаточно — доступ открывается. Если подтверждена только почта, включается <b>ожидание</b> (сутки): за это время настоящий владелец получит письма и сможет отменить запрос.</li>
        <li>После восстановления все прежние сессии завершаются, а для аккаунта предлагается заново настроить защиту.</li>
      </ol>
      <Note tone="warn">Восстановление не возвращает отозванные права, не меняет баланс, Prime и подписки и никогда не делает обычный аккаунт администратором или владельцем.</Note>
      <Note>Новая резервная почта начинает работать для восстановления только через 24 часа после подтверждения.</Note>
    </Card>
  </Shell>
);

const Protect = () => (
  <Shell back>
    <H1>Как защитить свой аккаунт</H1>
    <Card>
      <ul style={{ lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
        <li>Добавьте <b>резервную почту</b> в Профиль → Sky ID → «Безопасность и восстановление» и подтвердите её.</li>
        <li>Включите <b>приложение-аутентификатор</b> и создайте <b>резервные коды</b> — сохраните их отдельно от телефона.</li>
        <li>Администраторам: сохраните <b>токен восстановления</b> (он показывается один раз), владельцу — задайте <b>секрет владельца</b>.</li>
        <li>Иногда заходите в «Безопасность и восстановление» и завершайте незнакомые сессии.</li>
        <li>Никому не сообщайте коды, токены и пароли — сотрудники Sky их не спрашивают.</li>
      </ul>
    </Card>
  </Shell>
);

/* ─── Мастер восстановления ─── */
type Kind = 'user' | 'admin' | 'owner';
interface Req { requestId: string; secret: string; kind: Kind }
const REQ_KEY = 'sky:rcv:req';
const saveReq = (r: Req | null) => { try { if (r) sessionStorage.setItem(REQ_KEY, JSON.stringify(r)); else sessionStorage.removeItem(REQ_KEY); } catch { /* нет хранилища */ } };
const loadReq = (kind: Kind): Req | null => { try { const r = JSON.parse(sessionStorage.getItem(REQ_KEY) ?? 'null'); return r && r.kind === kind ? r : null; } catch { return null; } };

const FACTOR_TEXT: Record<string, { title: string; hint: string; secret?: boolean; mask?: string }> = {
  email: { title: 'Код с резервной почты', hint: '6 цифр из письма' },
  totp: { title: 'Код приложения-аутентификатора', hint: '6 цифр' },
  backup_code: { title: 'Резервный код', hint: 'Формат XXXXX-XXXXX' },
  admin_token: { title: 'Токен восстановления администратора', hint: 'SKYADM-…', secret: true },
  owner_secret: { title: 'Секрет владельца', hint: 'Фраза, заданная заранее', secret: true },
  support_case: { title: 'Ключ разрешённой заявки', hint: 'Ключ чата обращения, по которому поддержка разрешила восстановление', secret: true },
};

const Wizard = ({ kind }: { kind: Kind }) => {
  const title = { user: 'Восстановить доступ к Sky ID', admin: 'Восстановить доступ администратора', owner: 'Экстренное восстановление владельца' }[kind];
  const [req, setReq] = useState<Req | null>(() => loadReq(kind));
  const [ident, setIdent] = useState('');
  const [methods, setMethods] = useState<string[]>([]);
  const [proven, setProven] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pwd, setPwd] = useState('');
  const [limited, setLimited] = useState(false);
  const [newMail, setNewMail] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const [mailSent, setMailSent] = useState(false);

  const refresh = useCallback(async (r: Req) => {
    const s = await rc('/api/recovery/status', { requestId: r.requestId, secret: r.secret });
    if (!s.ok) { saveReq(null); setReq(null); return; }
    setMethods(s.data.methods ?? []); setProven(s.data.factors ?? []);
    if (s.data.status === 'waiting') setWaiting(s.data.readyAt ?? '');
  }, []);
  useEffect(() => { if (req) void refresh(req); }, [req, refresh]);

  const start = async () => {
    setBusy(true); setMsg(null);
    const r = await rc('/api/recovery/start', { identifier: ident.trim(), kind });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: 'bad', text: errText(r.data) });
    const next = { requestId: r.data.requestId, secret: r.data.secret, kind };
    saveReq(next); setReq(next); setMethods(r.data.methods ?? []); setProven([]);
    setMsg({ tone: 'info', text: r.data.message });
  };
  const sendMail = async () => {
    if (!req) return; setBusy(true);
    const r = await rc('/api/recovery/email/send', { requestId: req.requestId, secret: req.secret }); setBusy(false);
    if (!r.ok) return setMsg({ tone: 'bad', text: errText(r.data) });
    setMailSent(true); setMsg({ tone: 'info', text: r.data.message });
  };
  const verify = async (factor: string) => {
    if (!req) return; setBusy(true); setMsg(null);
    const r = await rc('/api/recovery/verify', { requestId: req.requestId, secret: req.secret, factor, value: vals[factor] ?? '' }); setBusy(false);
    if (!r.ok) return setMsg({ tone: 'bad', text: errText(r.data) });
    setVals((v) => ({ ...v, [factor]: '' })); setProven((p) => [...new Set([...p, factor])]); setMsg({ tone: 'ok', text: 'Подтверждено.' });
  };
  const complete = async () => {
    if (!req) return; setBusy(true); setMsg(null);
    const r = await rc('/api/recovery/complete', { requestId: req.requestId, secret: req.secret, ...(pwd ? { newPassword: pwd } : {}) }); setBusy(false);
    if (r.data?.error === 'limited_only') { setLimited(true); return setMsg({ tone: 'warn', text: 'Этого фактора недостаточно, чтобы открыть аккаунт, но можно заменить резервную почту.' }); }
    if (!r.ok) return setMsg({ tone: 'bad', text: errText(r.data) });
    if (r.data.waiting) { setWaiting(r.data.readyAt ?? ''); return setMsg({ tone: 'warn', text: r.data.message ?? 'Назначено ожидание.' }); }
    if (r.data.handoff) { saveReq(null); location.href = `${r.data.appUrl || APP_URL}/?recovery_handoff=${encodeURIComponent(r.data.handoff)}`; }
  };
  const setBackup = async () => {
    if (!req) return; setBusy(true);
    const r = await rc('/api/recovery/backup-email', { requestId: req.requestId, secret: req.secret, email: newMail.trim() }); setBusy(false);
    setMsg(r.ok ? { tone: 'ok', text: `Письмо со ссылкой отправлено на ${r.data.masked}. Адрес заработает для восстановления через 24 часа после подтверждения.` } : { tone: 'bad', text: errText(r.data) });
  };

  const ready = useMemo(() => proven.length > 0, [proven]);
  return (
    <Shell back>
      <H1>{title}</H1>
      {!req ? (
        <Card>
          <p style={{ margin: 0, opacity: .8, lineHeight: 1.55 }}>Введите то, что помните: почту, телефон, @ник или Sky ID. {kind !== 'user' && <b>Для этого сценария аккаунт должен быть {kind === 'admin' ? 'администраторским' : 'аккаунтом владельца'}.</b>}</p>
          <Field label="Почта, телефон, @ник или Sky ID"><input className="rcv-in" value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" onKeyDown={(e) => { if (e.key === 'Enter' && ident.trim()) void start(); }} /></Field>
          <div style={{ marginTop: 16 }}><button type="button" className="rcv-btn" disabled={busy || !ident.trim()} onClick={() => void start()}>{busy ? <Loader2 className="animate-spin" size={16} /> : null}Продолжить</button></div>
          <Note>Если аккаунт существует и данные указаны верно, мы предложим доступные способы восстановления.</Note>
          {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        </Card>
      ) : waiting !== null ? (
        <Card>
          <CheckCircle2 size={28} color="#fbbf24" />
          <h2 style={{ margin: '8px 0' }}>Восстановление ожидает завершения</h2>
          <p style={{ lineHeight: 1.6, opacity: .85 }}>Мы отправили ссылки «Завершить» и «Отменить» на почты аккаунта. Завершить восстановление можно после {waiting ? new Date(waiting).toLocaleString('ru-RU') : 'окончания ожидания'}. Если запрос сделали не вы — отмените его по ссылке из письма.</p>
          <Note tone="warn">Ожидание защищает аккаунт: настоящий владелец успевает заметить и отменить чужой запрос.</Note>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card>
            <strong>Подтвердите себя</strong>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, opacity: .75 }}>Подтверждено: {proven.length ? proven.map((p) => FACTOR_TEXT[p]?.title ?? p).join(', ') : 'пока ничего'}.</p>
            {msg && <Note tone={msg.tone}>{msg.text}</Note>}
          </Card>
          {methods.map((f) => {
            const t = FACTOR_TEXT[f]; if (!t) return null; const done = proven.includes(f);
            return (
              <Card key={f}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {f === 'email' ? <Mail size={18} /> : f === 'totp' ? <Smartphone size={18} /> : <KeyRound size={18} />}<strong>{t.title}</strong>{done && <CheckCircle2 size={16} color="#6ee7b7" />}
                </div>
                {!done && (
                  <>
                    {f === 'email' && <div style={{ marginTop: 10 }}><button type="button" className="rcv-btn plain" disabled={busy} onClick={() => void sendMail()}>{mailSent ? 'Отправить ещё раз' : 'Отправить код на резервную почту'}</button></div>}
                    <Field label={t.hint}><input className="rcv-in" type={t.secret ? 'password' : 'text'} inputMode={f === 'email' || f === 'totp' ? 'numeric' : 'text'} value={vals[f] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [f]: e.target.value }))} autoComplete="one-time-code" /></Field>
                    <div style={{ marginTop: 12 }}><button type="button" className="rcv-btn" disabled={busy || !(vals[f] ?? '').trim()} onClick={() => void verify(f)}>Проверить</button></div>
                  </>
                )}
              </Card>
            );
          })}
          {ready && (
            <Card>
              <strong>Завершить</strong>
              <Field label="Новый пароль (необязательно — только если у аккаунта есть пароль)"><input className="rcv-in" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
              <div style={{ marginTop: 14 }}><button type="button" className="rcv-btn" disabled={busy} onClick={() => void complete()}>Восстановить доступ</button></div>
              {limited && (
                <div style={{ marginTop: 18 }}>
                  <strong>Заменить резервную почту</strong>
                  <Field label="Новый адрес" hint="Отправим одноразовую ссылку. Для восстановления адрес заработает через 24 часа."><input className="rcv-in" type="email" value={newMail} onChange={(e) => setNewMail(e.target.value)} /></Field>
                  <div style={{ marginTop: 12 }}><button type="button" className="rcv-btn plain" disabled={busy || !newMail.trim()} onClick={() => void setBackup()}>Отправить ссылку</button></div>
                </div>
              )}
            </Card>
          )}
          <Card style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <LifeBuoy size={18} /><span style={{ flex: '1 1 220px', fontSize: 13.5, opacity: .8 }}>Нет доступа к нужным факторам?</span>
            <A to="/case/new" className="rcv-btn plain">Обратиться в поддержку</A>
            <button type="button" className="rcv-btn plain" onClick={() => { saveReq(null); setReq(null); setProven([]); setMsg(null); }}>Начать заново</button>
          </Card>
        </div>
      )}
    </Shell>
  );
};

/* ─── Бланк обращения ─── */
const REASONS: [string, string][] = [['forgot_password', 'Забыл пароль'], ['lost_backup_email', 'Потерял доступ к резервной почте'], ['lost_authenticator', 'Потерял доступ к приложению-аутентификатору'], ['lost_both', 'Потерял доступ к обоим факторам'], ['lost_backup_codes', 'Потерял резервные коды'], ['suspected_hack', 'Подозреваю взлом аккаунта'], ['auto_failed', 'Не работает автоматическое восстановление'], ['other', 'Другая причина']];
const LOST: [string, string][] = [['password', 'Пароль'], ['primary_email', 'Основная почта'], ['phone', 'Телефон'], ['backup_email', 'Резервная почта'], ['authenticator', 'Приложение-аутентификатор'], ['backup_codes', 'Резервные коды'], ['admin_token', 'Токен администратора'], ['owner_secret', 'Секрет владельца'], ['trusted_devices', 'Доверенные устройства']];
const CASE_KEY = 'sky:rcv:case';
const saveCaseKey = (k: string) => { try { localStorage.setItem(CASE_KEY, k); } catch { /* нет */ } };

const CaseForm = () => {
  const idem = useRef(`f-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  const [f, setF] = useState({ skyId: '', profileName: '', accountType: 'user', reason: 'lost_both', lastLogin: '', whenStarted: '', attempts: '', description: '', extra: '', contactEmail: '', oldMailAccess: 'no', newNotifyEmail: '', website: '' });
  const [lost, setLost] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ number: string; duplicate?: boolean; confirmed?: boolean } | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await rc('/api/recovery/case/create', { ...f, lostMethods: lost, idempotencyKey: idem.current, lang: 'ru' });
    setBusy(false);
    if (!r.ok) return setErr(r.data?.error === 'bad_field' ? `Проверьте поле «${({ description: 'Подробное описание (не короче 20 знаков)', contactEmail: 'Контактная почта', reason: 'Причина' } as Record<string, string>)[r.data.field] ?? r.data.field}».` : errText(r.data));
    if (r.data.accessKey) saveCaseKey(r.data.accessKey);
    setDone({ number: r.data.number, duplicate: r.data.duplicate, confirmed: r.data.contactConfirmed });
    if (r.data.accessKey) setTimeout(() => go('/case'), 2600);
  };
  if (done) return (
    <Shell>
      <Card style={{ textAlign: 'center', marginTop: 20 }}>
        <CheckCircle2 size={34} color="#6ee7b7" />
        <h2 style={{ margin: '10px 0' }}>{done.duplicate ? `Обращение №${done.number} уже создано` : `Обращение №${done.number} создано`}</h2>
        <p style={{ lineHeight: 1.6, opacity: .85, maxWidth: 560, margin: '0 auto' }}>
          {done.duplicate ? 'Откройте его по ссылке «У меня уже есть обращение» — ключ доступа можно запросить на подтверждённую почту. ' : 'Вы можете следить за статусом и общаться с технической поддержкой в чате обращения. '}
          {done.confirmed ? 'Когда специалист ответит, мы отправим уведомление на вашу электронную почту.' : 'Подтвердите контактную почту по ссылке из письма — только тогда мы сможем присылать уведомления об ответах.'}
        </p>
        <div style={{ marginTop: 16 }}><A to="/case" className="rcv-btn">Открыть чат обращения</A></div>
      </Card>
    </Shell>
  );
  return (
    <Shell back>
      <H1>Обращение по восстановлению доступа</H1>
      <Note tone="warn">Не вводите здесь пароли, коды из приложений и SMS, резервные коды и токены. Специалисты их не спрашивают.</Note>
      <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
        <Card>
          <strong>A. Данные аккаунта</strong>
          <Field label="Sky ID, почта, телефон или @ник"><input className="rcv-in" value={f.skyId} onChange={set('skyId')} /></Field>
          <Field label="Имя профиля"><input className="rcv-in" value={f.profileName} onChange={set('profileName')} /></Field>
          <Field label="Тип аккаунта"><select className="rcv-in" value={f.accountType} onChange={set('accountType')}><option value="user">Пользователь</option><option value="admin">Администратор</option><option value="owner">Владелец Sky</option></select></Field>
          <Field label="Примерная дата последнего успешного входа (если помните)"><input className="rcv-in" value={f.lastLogin} onChange={set('lastLogin')} placeholder="например, середина октября" /></Field>
        </Card>
        <Card>
          <strong>B. Причина обращения</strong>
          <Field label="Что случилось"><select className="rcv-in" value={f.reason} onChange={set('reason')}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <div style={{ marginTop: 12, fontSize: 12.5, opacity: .75 }}>Какие способы входа больше недоступны:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {LOST.map(([k, v]) => <button key={k} type="button" aria-pressed={lost.includes(k)} onClick={() => setLost((l) => l.includes(k) ? l.filter((x) => x !== k) : [...l, k])} className="rcv-btn plain" style={{ minHeight: 38, padding: '0 12px', background: lost.includes(k) ? 'rgba(99,102,241,.45)' : undefined }}>{v}</button>)}
          </div>
        </Card>
        <Card>
          <strong>C. Описание проблемы</strong>
          <Field label="Когда возникла проблема"><input className="rcv-in" value={f.whenStarted} onChange={set('whenStarted')} /></Field>
          <Field label="Какие попытки восстановления уже предпринимались"><textarea className="rcv-in" value={f.attempts} onChange={set('attempts')} /></Field>
          <Field label="Подробное описание ситуации" hint="Не короче 20 знаков"><textarea className="rcv-in" value={f.description} onChange={set('description')} /></Field>
          <Field label="Дополнительные сведения, которые помогут поддержке"><textarea className="rcv-in" value={f.extra} onChange={set('extra')} /></Field>
        </Card>
        <Card>
          <strong>D. Контактная информация</strong>
          <Field label="Контактная почта для уведомлений" hint="Мы отправим ссылку подтверждения. Подтверждение адреса не подтверждает владение аккаунтом."><input className="rcv-in" type="email" value={f.contactEmail} onChange={set('contactEmail')} /></Field>
          <Field label="Есть ли доступ к прежней почте аккаунта"><select className="rcv-in" value={f.oldMailAccess} onChange={set('oldMailAccess')}><option value="no">Нет</option><option value="yes">Да</option></select></Field>
          <Field label="Новый адрес для уведомлений (необязательно)"><input className="rcv-in" type="email" value={f.newNotifyEmail} onChange={set('newNotifyEmail')} /></Field>
          <input name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} aria-hidden style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
          {err && <Note tone="bad">{err}</Note>}
          <div style={{ marginTop: 16 }}><button type="button" className="rcv-btn" disabled={busy} onClick={() => void submit()}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}Создать обращение</button></div>
        </Card>
      </div>
    </Shell>
  );
};

/* ─── Чат обращения ─── */
interface CaseView { number: string; status: string; statusLabel: string; reason: string; contactConfirmed: boolean; canReply: boolean; canReopen: boolean; history: { label: string; at: string }[]; messages: { id: string; fromStaff: boolean; author: string; body: string; at: string }[] }
const CaseChat = () => {
  const [key, setKey] = useState(() => takeFragment('k') || (() => { try { return localStorage.getItem(CASE_KEY) ?? ''; } catch { return ''; } })());
  useEffect(() => { if (key) saveCaseKey(key); }, [key]);
  const [view, setView] = useState<CaseView | null>(null);
  const [state, setState] = useState<'load' | 'ok' | 'none'>('load');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [num, setNum] = useState(''); const [mail, setMail] = useState(''); const [sent, setSent] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    if (!key) { setState('none'); return; }
    const r = await rc('/api/recovery/case/view', undefined, { 'x-recovery-case': key });
    if (r.status === 404) { setState('none'); return; }
    if (r.ok) { setView(r.data); setState('ok'); }
  }, [key]);
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 8000); return () => clearInterval(t); }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [view?.messages.length]);
  const send = async () => {
    if (!text.trim()) return; setSending(true); setErr('');
    const r = await rc('/api/recovery/case/message', { text }, { 'x-recovery-case': key });
    setSending(false);
    if (!r.ok) return setErr(r.data?.error === 'too_many_requests' ? 'Слишком часто. Подождите немного.' : errText(r.data) + ' Сообщение не отправлено — попробуйте ещё раз.');
    setText(''); void load();
  };
  const reopen = async () => { const r = await rc('/api/recovery/case/reopen', {}, { 'x-recovery-case': key }); if (r.ok) void load(); else setErr('Это обращение нельзя открыть повторно.'); };
  const resend = async () => { await rc('/api/recovery/case/resend-access', { number: num.trim(), email: mail.trim() }); setSent(true); };
  return (
    <Shell back>
      {state === 'load' ? <Loader2 className="animate-spin" /> : state === 'none' || !view ? (
        <Card>
          <H1>Мои обращения</H1>
          <p style={{ opacity: .8, lineHeight: 1.6 }}>На этом устройстве нет ключа обращения. Введите номер и подтверждённую контактную почту — мы отправим новую ссылку для входа в чат.</p>
          <Field label="Номер обращения"><input className="rcv-in" value={num} onChange={(e) => setNum(e.target.value)} placeholder="SR-10482" /></Field>
          <Field label="Контактная почта"><input className="rcv-in" type="email" value={mail} onChange={(e) => setMail(e.target.value)} /></Field>
          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}><button type="button" className="rcv-btn" disabled={!num || !mail} onClick={() => void resend()}>Прислать ссылку</button><A to="/case/new" className="rcv-btn plain">Создать обращение</A></div>
          {sent && <Note>Если обращение найдено и почта подтверждена, мы отправили новую ссылку.</Note>}
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Обращение №{view.number}</h2>
              <span style={{ padding: '4px 12px', borderRadius: 99, background: 'rgba(129,140,248,.25)', fontSize: 12.5, fontWeight: 700 }}>{view.statusLabel}</span>
              <span style={{ opacity: .6, fontSize: 13 }}>{view.reason}</span>
            </div>
            {!view.contactConfirmed && <Note tone="warn">Контактная почта ещё не подтверждена: уведомления об ответах не приходят. Подтвердите её по ссылке из письма.</Note>}
          </Card>
          <Card style={{ padding: 0 }}>
            <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: 18, display: 'grid', gap: 10 }} aria-live="polite">
              {view.messages.map((m) => (
                <div key={m.id} style={{ justifySelf: m.fromStaff ? 'start' : 'end', maxWidth: '88%', padding: '10px 14px', borderRadius: 16, background: m.fromStaff ? 'rgba(99,102,241,.28)' : 'rgba(255,255,255,.09)', border: '1px solid rgba(255,255,255,.1)' }}>
                  <div style={{ fontSize: 11.5, opacity: .6, marginBottom: 3 }}>{m.author} · {new Date(m.at).toLocaleString('ru-RU')}</div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14.5, lineHeight: 1.5 }} translate="no">{m.body}</div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,.1)' }}>
              {view.canReply ? (
                <>
                  <textarea className="rcv-in" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ваше сообщение специалисту" maxLength={4000} style={{ minHeight: 70 }} />
                  {err && <Note tone="bad">{err}</Note>}
                  <div style={{ marginTop: 10 }}><button type="button" className="rcv-btn" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}Отправить</button></div>
                </>
              ) : <Note>Обращение закрыто.</Note>}
              {view.canReopen && <div style={{ marginTop: 10 }}><button type="button" className="rcv-btn plain" onClick={() => void reopen()}>Открыть повторно</button></div>}
            </div>
          </Card>
          {view.history.length > 0 && <Card><strong>История статусов</strong><ul style={{ margin: '8px 0 0', paddingLeft: 18, opacity: .8, fontSize: 13.5 }}>{view.history.map((h, i) => <li key={i}>{h.label} — {new Date(h.at).toLocaleString('ru-RU')}</li>)}</ul></Card>}
        </div>
      )}
    </Shell>
  );
};

/* ─── Страницы по ссылкам из писем ─── */
const LinkPage = ({ kind }: { kind: 'confirm-email' | 'cancel' | 'case-contact' }) => {
  const token = useRef(takeFragment('t')).current;
  const [state, setState] = useState<'ask' | 'busy' | 'ok' | 'bad'>('ask');
  const texts = {
    'confirm-email': { title: 'Подтвердить резервную почту', btn: 'Подтвердить адрес', ok: 'Резервная почта подтверждена. Для восстановления она заработает через 24 часа.', path: '/api/recovery/confirm-email' },
    cancel: { title: 'Отменить запрос восстановления', btn: 'Это не я — отменить запрос', ok: 'Запрос отменён, доступ к аккаунту остался прежним. Рекомендуем сменить пароль и завершить чужие сессии.', path: '/api/recovery/cancel' },
    'case-contact': { title: 'Подтвердить почту для уведомлений', btn: 'Подтвердить почту', ok: 'Почта подтверждена. Мы будем присылать уведомления об ответах поддержки.', path: '/api/recovery/case/confirm-contact' },
  }[kind];
  const run = async () => { setState('busy'); const r = await rc(texts.path, { token }); setState(r.ok ? 'ok' : 'bad'); };
  return (
    <Shell>
      <Card style={{ maxWidth: 560, margin: '30px auto', textAlign: 'center' }}>
        <h2>{texts.title}</h2>
        {state === 'ok' ? <Note tone="ok">{texts.ok}</Note> : state === 'bad' || !token ? <Note tone="bad">Ссылка недействительна или уже использована.</Note> : (
          <><p style={{ opacity: .75 }}>Подтверждение выполняется только по вашему нажатию — почтовые программы по ссылке ничего не меняют.</p><button type="button" className="rcv-btn" disabled={state === 'busy'} onClick={() => void run()}>{texts.btn}</button></>
        )}
        <div style={{ marginTop: 16 }}><A to="/" className="rcv-btn plain">На главную</A></div>
      </Card>
    </Shell>
  );
};

const Finish = () => {
  const token = useRef(takeFragment('t')).current;
  const [info, setInfo] = useState<{ ready: boolean; readyAt: string; needsOwnerSecret: boolean } | null>(null);
  const [bad, setBad] = useState(!token);
  const [code, setCode] = useState(''); const [secret, setSecret] = useState(''); const [caseKey, setCaseKey] = useState(''); const [pwd, setPwd] = useState('');
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  useEffect(() => { if (!token) return; void rc('/api/recovery/finish/info', { token }).then((r) => { if (r.ok) setInfo(r.data); else setBad(true); }); }, [token]);
  const sendCode = async () => { await rc('/api/recovery/finish/send-code', { token }); setSent(true); };
  const finish = async () => {
    setBusy(true); setMsg('');
    const r = await rc('/api/recovery/finish', { token, code, ownerSecret: secret, caseKey, ...(pwd ? { newPassword: pwd } : {}) }); setBusy(false);
    if (!r.ok) return setMsg(errText(r.data));
    location.href = `${r.data.appUrl || APP_URL}/?recovery_handoff=${encodeURIComponent(r.data.handoff)}`;
  };
  return (
    <Shell>
      <Card style={{ maxWidth: 600, margin: '30px auto' }}>
        <h2>Завершить восстановление</h2>
        {bad ? <Note tone="bad">Ссылка недействительна или уже использована.</Note> : !info ? <Loader2 className="animate-spin" /> : !info.ready ? <Note tone="warn">Ожидание ещё не закончилось. Вернитесь по этой ссылке после {new Date(info.readyAt).toLocaleString('ru-RU')}.</Note> : (
          <>
            <p style={{ opacity: .8, lineHeight: 1.55 }}>Ожидание закончилось. Подтвердите себя ещё раз кодом с резервной почты (или ключом разрешённой заявки).</p>
            <div style={{ marginTop: 8 }}><button type="button" className="rcv-btn plain" onClick={() => void sendCode()}>{sent ? 'Отправить код ещё раз' : 'Отправить код на резервную почту'}</button></div>
            <Field label="Код из письма"><input className="rcv-in" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Field label="Ключ разрешённой заявки (если восстановление идёт через поддержку)"><input className="rcv-in" type="password" value={caseKey} onChange={(e) => setCaseKey(e.target.value)} /></Field>
            {info.needsOwnerSecret && <Field label="Секрет владельца"><input className="rcv-in" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>}
            <Field label="Новый пароль (необязательно)"><input className="rcv-in" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
            {msg && <Note tone="bad">{msg}</Note>}
            <div style={{ marginTop: 16 }}><button type="button" className="rcv-btn" disabled={busy || (!code && !caseKey)} onClick={() => void finish()}>Восстановить доступ</button></div>
          </>
        )}
      </Card>
    </Shell>
  );
};

/* ─── Маршрутизация ─── */
export const RecoverySite = () => {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); window.addEventListener('rcv:nav', f); window.addEventListener('popstate', f); return () => { window.removeEventListener('rcv:nav', f); window.removeEventListener('popstate', f); }; }, []);
  const path = (location.pathname.slice(BASE.length).replace(/\/+$/, '') || '/');
  switch (path) {
    case '/user': return <Wizard kind="user" />;
    case '/admin': return <Wizard kind="admin" />;
    case '/owner': return <Wizard kind="owner" />;
    case '/how': return <How />;
    case '/protect': return <Protect />;
    case '/case/new': return <CaseForm />;
    case '/case': return <CaseChat />;
    case '/confirm-email': return <LinkPage kind="confirm-email" />;
    case '/cancel': return <LinkPage kind="cancel" />;
    case '/case-contact': return <LinkPage kind="case-contact" />;
    case '/finish': return <Finish />;
    default: return <Home />;
  }
};
