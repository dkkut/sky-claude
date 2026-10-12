/* ===========================================================
   SKY TV — вход с пульта, без мыши и без физической клавиатуры.

   Обычный AuthScreen (src/auth/AuthScreen.tsx) — мышь/тач/реальная
   клавиатура: поля, ссылки-переключатели способа входа, галочка.
   На настоящем ТВ ничего этого нет, только стрелки+OK на пульте —
   и до этого экрана человек вообще не мог войти в TV-режиме.

   Использует ТУ ЖЕ реальную серверную логику входа, что и обычный
   вход (useAuthStore — requestCode/verifyCode/selectProfile/
   createProfile и т.д.), просто с TV-навигацией (TVFocusable +
   focusManager, как в остальном Sky TV) и экранной клавиатурой
   вместо текстовых полей.

   Сознательно урезан способ входа до "почта → код": пароль/SMS
   набирать пультом через экранную клавиатуру мучительно и менее
   безопасно (пароль видно на экране телевизора), а код на почту —
   уже основной путь в самом приложении. Кто хочет войти иначе —
   входит с телефона/компьютера, здесь ограничение только UI.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Crown, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import type { ServerProfile } from '@/core/auth/api';
import { TVFocusable } from '../TVFocusable';
import { tvFocusManager } from '../focusManager';
import { useTVKeyBindings } from '../useTVKeyBindings';
import { TVKeyboard, TVKeypad } from './TVKeyboard';
import { DeviceLinkLogin, type LinkAction } from '@/auth/DeviceLinkLogin';

const useCountdown = (seconds: number) => {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
};

const Frame = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="flex h-full flex-col items-center justify-center gap-6 px-10">
    <img src="/logo.png" alt="Sky" style={{ width: 56, height: 56, objectFit: 'contain' }}/>
    <div className="text-center">
      <h1 className="text-[28px] font-extrabold" style={{ color: 'var(--t1)' }}>{title}</h1>
      {subtitle && <p className="mt-2 text-[16px]" style={{ color: 'var(--t3)' }}>{subtitle}</p>}
    </div>
    {children}
  </div>
);

const ErrorLine = ({ text }: { text?: string }) =>
  text ? <p className="text-[14px]" style={{ color: 'var(--red)' }}>{text}</p> : null;

/* ── шаг 1: почта ─────────────────────────────────────────────── */

const tvAction: LinkAction = (label, onClick, id) => (
  <TVFocusable key={id} id={id} onEnter={onClick}>
    {({ focused }) => (
      <div className="text-[16px] font-semibold" style={{ color: focused ? '#fff' : 'var(--accent)', background: focused ? 'var(--accent)' : 'var(--bg-l2)', padding: '10px 22px', borderRadius: 14 }}>
        {label}
      </div>
    )}
  </TVFocusable>
);

/* Основной путь на ТВ: QR и код на экране, подтверждение с телефона. Почта с экранной клавиатурой — запасной. */
const TVLoginStep = () => {
  const [byMail, setByMail] = useState(false);
  useEffect(() => { tvFocusManager.focusDefault(); }, [byMail]);
  if (byMail) return <TVMailStep onBack={() => setByMail(false)}/>;
  return (
    <Frame title="Вход в Sky" subtitle="Подтвердите вход на телефоне">
      <DeviceLinkLogin kind="tv" big action={tvAction}
        extra={tvAction('Войти по почте', () => setByMail(true), 'login-by-mail')}/>
    </Frame>
  );
};

const TVMailStep = ({ onBack }: { onBack: () => void }) => {
  const { emailInput, setEmailInput, setLoginChannel, requestCode } = useAuthStore();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailInput.trim());

  useEffect(() => { setLoginChannel('email'); tvFocusManager.focusDefault(); }, []);

  const submit = async () => {
    if (busy || !ready) return;
    setErr(undefined); setBusy(true);
    const res = await requestCode();
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };

  useTVKeyBindings({ mode: 'nav', enabled: true });

  return (
    <Frame title="Sky ID" subtitle="Введите почту — пришлём код для входа">
      <p className="min-h-[28px] text-[22px] font-semibold tabular-nums" style={{ color: 'var(--t1)' }}>
        {emailInput || <span style={{ color: 'var(--t3)' }}>you@example.com</span>}
      </p>
      <ErrorLine text={err}/>
      <TVKeyboard idPrefix="login" mode="email"
        onChar={c => setEmailInput(emailInput + c)}
        onBackspace={() => setEmailInput(emailInput.slice(0, -1))}
        onSubmit={submit} submitLabel={busy ? 'Отправляем…' : 'Получить код'} submitDisabled={busy || !ready}/>
      {tvAction('Войти по QR с телефона', onBack, 'login-by-qr')}
    </Frame>
  );
};

/* ── общий блок ввода кода (используется в трёх шагах) ──────────── */

const TVCodeBlock = ({
  idPrefix, length = 6, onComplete, busy,
}: { idPrefix: string; length?: number; onComplete: (code: string) => void; busy: boolean }) => {
  const [code, setCode] = useState('');

  useEffect(() => { tvFocusManager.focusDefault(); }, []);

  const digit = (d: string) => {
    if (code.length >= length) return;
    const next = code + d;
    setCode(next);
    if (next.length === length) onComplete(next);
  };
  const backspace = () => setCode(c => c.slice(0, -1));

  return (
    <>
      <div className="flex justify-center gap-2">
        {Array.from({ length }).map((_, i) => (
          <div key={i} className="grid place-items-center rounded-2xl text-[24px] font-semibold tabular-nums"
            style={{
              width: 52, height: 60,
              background: code[i] ? 'var(--bg-l3)' : 'var(--bg-l2)',
              border: `1px solid ${code[i] ? 'var(--accent)' : 'var(--border)'}`,
              color: 'var(--t1)',
            }}>
            {code[i] ?? ''}
          </div>
        ))}
      </div>
      <TVKeypad idPrefix={idPrefix} onDigit={digit} onBackspace={backspace}
        onSubmit={() => onComplete(code)} submitLabel={busy ? 'Проверяем…' : 'Подтвердить'} submitDisabled={busy || code.length < length}/>
    </>
  );
};

/* ── шаг 2: код входа ─────────────────────────────────────────── */

const TVCodeStep = () => {
  const { pendingEmail, codeInfo, verifyCode, requestCode } = useAuthStore();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useCountdown(codeInfo?.retryAfter ?? 60);

  const submit = async (value: string) => {
    if (busy) return;
    setErr(undefined); setBusy(true);
    const res = await verifyCode(value);
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };
  const resend = async () => {
    setErr(undefined);
    const res = await requestCode();
    setLeft(res.retryAfter ?? 60);
    if (!res.ok) setErr(res.reason);
  };

  useTVKeyBindings({ mode: 'nav', enabled: true, onBack: () => useAuthStore.setState({ step: 'login' }) });

  return (
    <Frame title="Код из письма" subtitle={`Отправили на ${pendingEmail}`}>
      <ErrorLine text={err}/>
      <TVCodeBlock idPrefix="code" onComplete={submit} busy={busy}/>
      <TVFocusable id="code-resend" disabled={left > 0} onEnter={resend}>
        {({ focused }) => (
          <div className="text-[14px] font-semibold" style={{ color: left > 0 ? 'var(--t3)' : focused ? '#fff' : 'var(--accent)', background: focused && left <= 0 ? 'var(--accent)' : 'transparent', padding: '6px 14px', borderRadius: 10 }}>
            {left > 0 ? `Отправить ещё раз через ${left} с` : 'Отправить код ещё раз'}
          </div>
        )}
      </TVFocusable>
    </Frame>
  );
};

/* ── шаг 3: защита Sky ID (2FA) ───────────────────────────────── */

const TVTwoFactorStep = () => {
  const { verifySkyTwoFactor, resendLoginTwoFactor, logout, twoFactorMethod, twoFactorEmail, twoFactorPhone, codeInfo } = useAuthStore();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sentToSomewhere = twoFactorMethod !== 'app';
  const [left, setLeft] = useCountdown(sentToSomewhere ? (codeInfo?.retryAfter ?? 60) : 0);

  const submit = async (value: string) => {
    if (busy) return;
    setErr(undefined); setBusy(true);
    const res = await verifySkyTwoFactor(value);
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };
  const resend = async () => {
    setErr(undefined);
    const res = await resendLoginTwoFactor();
    setLeft(res.retryAfter ?? 60);
    if (!res.ok) setErr(res.reason);
  };

  useTVKeyBindings({ mode: 'nav', enabled: true, onBack: logout });

  return (
    <Frame title="Подтверждение входа" subtitle={
      twoFactorMethod === 'sms' ? `Код отправлен на ${twoFactorPhone ?? 'ваш телефон'}`
      : twoFactorMethod === 'email' ? `Код отправлен на ${twoFactorEmail ?? 'вашу почту'}`
      : 'Введите код из приложения-аутентификатора'
    }>
      <ErrorLine text={err}/>
      <TVCodeBlock idPrefix="twofa" onComplete={submit} busy={busy}/>
      {sentToSomewhere && (
        <TVFocusable id="twofa-resend" disabled={left > 0} onEnter={resend}>
          {({ focused }) => (
            <div className="text-[14px] font-semibold" style={{ color: left > 0 ? 'var(--t3)' : focused ? '#fff' : 'var(--accent)', background: focused && left <= 0 ? 'var(--accent)' : 'transparent', padding: '6px 14px', borderRadius: 10 }}>
              {left > 0 ? `Отправить ещё раз через ${left} с` : 'Отправить код ещё раз'}
            </div>
          )}
        </TVFocusable>
      )}
    </Frame>
  );
};

/* ── код защищённого профиля ──────────────────────────────────── */

const TVProfileCodeStep = ({ profile, onBack }: { profile: ServerProfile; onBack: () => void }) => {
  const { selectProfile, sendProfileTwoFactorCode } = useAuthStore();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sentToSomewhere = profile.twoFactorMethod !== 'app';
  const [left, setLeft] = useCountdown(sentToSomewhere ? 60 : 0);

  const submit = async (value: string) => {
    if (busy) return;
    setErr(undefined); setBusy(true);
    const res = await selectProfile(profile.id, value);
    if (!res.ok) setErr(res.reason ?? 'Неверный код');
    setBusy(false);
  };
  const resend = async () => {
    setErr(undefined);
    const res = await sendProfileTwoFactorCode(profile.id);
    setLeft(res.retryAfter ?? 60);
    if (!res.ok) setErr(res.reason);
  };

  useTVKeyBindings({ mode: 'nav', enabled: true, onBack });

  return (
    <Frame title={profile.name} subtitle={
      profile.twoFactorMethod === 'sms' ? 'Профиль защищён. Код отправлен на ваш телефон.'
      : profile.twoFactorMethod === 'email' ? 'Профиль защищён. Код отправлен на почту Sky ID.'
      : 'Профиль защищён. Введите код из приложения-аутентификатора.'
    }>
      <ErrorLine text={err}/>
      <TVCodeBlock idPrefix="pcode" onComplete={submit} busy={busy}/>
      {sentToSomewhere && (
        <TVFocusable id="pcode-resend" disabled={left > 0} onEnter={resend}>
          {({ focused }) => (
            <div className="text-[14px] font-semibold" style={{ color: left > 0 ? 'var(--t3)' : focused ? '#fff' : 'var(--accent)', background: focused && left <= 0 ? 'var(--accent)' : 'transparent', padding: '6px 14px', borderRadius: 10 }}>
              {left > 0 ? `Отправить ещё раз через ${left} с` : 'Отправить код ещё раз'}
            </div>
          )}
        </TVFocusable>
      )}
    </Frame>
  );
};

/* ── создание профиля ─────────────────────────────────────────── */

const avatarGrad = (n: string) => {
  const h = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg,hsl(${h},65%,46%),hsl(${(h + 40) % 360},70%,38%))`;
};
const initials = (n: string) => n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

const TVCreateProfileStep = ({ first, onBack }: { first: boolean; onBack?: () => void }) => {
  const { createProfile } = useAuthStore();
  const [field, setField] = useState<'name' | 'username'>('name');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const cleanUser = useMemo(() => username.trim().toLowerCase().replace(/^@/, ''), [username]);
  const ready = name.trim().length >= 2 && /^[a-z0-9_]{3,32}$/.test(cleanUser) && (!first || accepted);

  useEffect(() => { tvFocusManager.focusDefault(); }, [field]);

  const submit = async () => {
    if (busy || !ready) return;
    setErr(undefined); setBusy(true);
    const res = await createProfile({ name, username: cleanUser, acceptLegal: first ? accepted : undefined });
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };

  useTVKeyBindings({ mode: 'nav', enabled: true, onBack });

  return (
    <Frame title={first ? 'Создайте профиль' : 'Второй профиль'}
      subtitle={first ? 'Имя и ник — как вас видят в Sky' : 'У второго профиля свои Prime и защита'}>
      <div className="flex gap-3">
        <TVFocusable id="field-name" onEnter={() => setField('name')}>
          {({ focused }) => (
            <div className="rounded-xl px-4 py-2 text-[15px] font-semibold" style={{ background: field === 'name' ? 'var(--bg-l3)' : 'transparent', outline: focused ? '2px solid var(--accent)' : 'none' }}>
              <span style={{ color: 'var(--t3)' }}>Имя: </span>
              <span style={{ color: 'var(--t1)' }}>{name || '—'}</span>
            </div>
          )}
        </TVFocusable>
        <TVFocusable id="field-username" onEnter={() => setField('username')}>
          {({ focused }) => (
            <div className="rounded-xl px-4 py-2 text-[15px] font-semibold" style={{ background: field === 'username' ? 'var(--bg-l3)' : 'transparent', outline: focused ? '2px solid var(--accent)' : 'none' }}>
              <span style={{ color: 'var(--t3)' }}>Ник: </span>
              <span style={{ color: 'var(--t1)' }}>@{cleanUser || '—'}</span>
            </div>
          )}
        </TVFocusable>
      </div>

      {first && (
        <TVFocusable id="field-legal" onEnter={() => setAccepted(v => !v)}>
          {({ focused }) => (
            <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ outline: focused ? '2px solid var(--accent)' : 'none' }}>
              <div className="grid h-5 w-5 place-items-center rounded-md" style={{ background: accepted ? 'var(--accent)' : 'transparent', border: `1.5px solid ${accepted ? 'var(--accent)' : 'var(--border-s)'}` }}>
                {accepted && <div style={{ width: 8, height: 8, borderRadius: 2, background: '#fff' }}/>}
              </div>
              <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Принимаю правила и условия Sky</p>
            </div>
          )}
        </TVFocusable>
      )}

      <ErrorLine text={err}/>

      {field === 'name' ? (
        <TVKeyboard idPrefix="cpname" mode="name"
          onChar={c => setName(name + c)} onBackspace={() => setName(name.slice(0, -1))}
          onSubmit={() => setField('username')} submitLabel="Дальше: ник" submitDisabled={name.trim().length < 2}/>
      ) : (
        <TVKeyboard idPrefix="cpuser" mode="username"
          onChar={c => setUsername(username + c)} onBackspace={() => setUsername(username.slice(0, -1))}
          onSubmit={submit} submitLabel={busy ? 'Создаём…' : 'Создать профиль'} submitDisabled={busy || !ready}/>
      )}
    </Frame>
  );
};

/* ── шаг 4: список профилей ───────────────────────────────────── */

const TVProfilesStep = () => {
  const { sky, profiles, maxProfiles, selectProfile, logout } = useAuthStore();
  const [mode, setMode] = useState<'list' | 'create'>(profiles.length ? 'list' : 'create');
  const [codeFor, setCodeFor] = useState<ServerProfile | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [err, setErr] = useState<string>();
  const canAdd = profiles.length < (maxProfiles || 2);

  useEffect(() => { if (mode === 'list' && !codeFor) tvFocusManager.focusDefault(); }, [mode, codeFor]);
  // Выход роняет все профили этого Sky ID и требует кода из письма для
  // возврата — то же самое подтверждение, что в обычном AuthScreen
  // (ConfirmExit), только через scope вместо модалки поверх мыши.
  useEffect(() => {
    if (!confirmExit) return;
    tvFocusManager.setScope('confirm-exit');
    return () => tvFocusManager.setScope(null);
  }, [confirmExit]);

  const pick = async (p: ServerProfile) => {
    setErr(undefined);
    const res = await selectProfile(p.id);
    if (res.ok) return;
    if (res.needsCode) setCodeFor(p); else setErr(res.reason ?? 'Не удалось открыть профиль');
  };

  useTVKeyBindings({ mode: 'nav', enabled: mode === 'list' && !codeFor, onBack: confirmExit ? () => setConfirmExit(false) : undefined });

  if (codeFor) return <TVProfileCodeStep profile={codeFor} onBack={() => setCodeFor(null)}/>;
  if (mode === 'create') return <TVCreateProfileStep first={profiles.length === 0} onBack={profiles.length ? () => setMode('list') : undefined}/>;

  return (
    <Frame title="Ваши профили" subtitle={sky ? `Sky ID · ${sky.email ?? ''}` : undefined}>
      <div className="flex flex-col gap-2.5" style={{ width: 380 }}>
        {profiles.map((p, i) => (
          <TVFocusable key={p.id} id={`profile-${p.id}`} autoFocusPriority={i} onEnter={() => pick(p)}>
            {({ focused }) => (
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l1)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}>
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-bold text-white" style={{ background: p.avatar ? `center/cover url(${p.avatar})` : avatarGrad(p.name) }}>
                  {!p.avatar && initials(p.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-[15px] font-semibold" style={{ color: focused ? '#fff' : 'var(--t1)' }}>{p.name}</p>
                    {p.isPrime && <Crown size={13} color={focused ? '#fff' : 'var(--amber)'}/>}
                    {p.twoFactorEnabled && <ShieldCheck size={13} color={focused ? '#fff' : 'var(--green)'}/>}
                  </div>
                  <p className="truncate text-xs" style={{ color: focused ? 'rgba(255,255,255,0.8)' : 'var(--t3)' }}>@{p.username}</p>
                </div>
              </div>
            )}
          </TVFocusable>
        ))}

        <ErrorLine text={err}/>

        {canAdd && (
          <TVFocusable id="profile-create" onEnter={() => setMode('create')}>
            {({ focused }) => (
              <div className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-[14px] font-medium" style={{ background: focused ? 'var(--accent)' : 'transparent', border: '1px dashed var(--border-m)', color: focused ? '#fff' : 'var(--t2)' }}>
                <Plus size={16}/> Создать профиль
              </div>
            )}
          </TVFocusable>
        )}

        <TVFocusable id="profile-logout" onEnter={() => setConfirmExit(true)}>
          {({ focused }) => (
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[14px]" style={{ background: focused ? 'var(--red-bg)' : 'transparent', color: focused ? 'var(--red)' : 'var(--t3)' }}>
              <LogOut size={14}/> Выйти из Sky ID
            </div>
          )}
        </TVFocusable>
      </div>

      {confirmExit && (
        <div className="fixed inset-0 z-[10] grid place-items-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-3xl p-5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <h2 className="mb-2 text-[17px] font-semibold" style={{ color: 'var(--t1)' }}>Выйти из Sky ID?</h2>
            <p className="mb-5 text-[13px] leading-relaxed" style={{ color: 'var(--t2)' }}>
              Выйдут все профили этого Sky ID. Чтобы вернуться, понадобится код с почты.
            </p>
            <div className="flex gap-2">
              <TVFocusable id="confirm-exit-cancel" scope="confirm-exit" autoFocusPriority={0} onEnter={() => setConfirmExit(false)}>
                {({ focused }) => (
                  <div className="flex-1 rounded-xl px-4 py-2.5 text-center text-[14px] font-semibold" style={{ background: focused ? 'var(--bg-l3)' : 'var(--bg-l2)', color: 'var(--t1)', outline: focused ? '2px solid var(--accent)' : 'none' }}>
                    Остаться
                  </div>
                )}
              </TVFocusable>
              <TVFocusable id="confirm-exit-ok" scope="confirm-exit" onEnter={logout}>
                {({ focused }) => (
                  <div className="flex-1 rounded-xl px-4 py-2.5 text-center text-[14px] font-semibold" style={{ background: 'var(--red-bg)', color: 'var(--red)', outline: focused ? '2px solid var(--red)' : 'none' }}>
                    Выйти
                  </div>
                )}
              </TVFocusable>
            </div>
          </div>
        </div>
      )}
    </Frame>
  );
};

/* ═══ Точка входа ══════════════════════════════════════════════ */

export const TVAuthScreen = () => {
  const step = useAuthStore(s => s.step);

  // Между шагами меняется весь набор TVFocusable — фокус пересчитывается
  // заново в каждом шаге через tvFocusManager.focusDefault(), здесь
  // достаточно просто гарантировать чистый DOM-контейнер на TV.
  return (
    <div className="fixed inset-0 z-[500] overflow-y-auto" style={{ background: 'var(--bg)' }}>
      <div className="grid h-full place-items-center py-10">
        {step === 'twofa' ? <TVTwoFactorStep/> :
         step === 'profiles' ? <TVProfilesStep/> :
         step === 'code' ? <TVCodeStep/> :
         <TVLoginStep/>}
      </div>
    </div>
  );
};
