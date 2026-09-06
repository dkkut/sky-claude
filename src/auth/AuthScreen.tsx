/**
 * Вход в Sky ID.
 *
 * Порядок экранов:
 *   телефон → код из SMS → (если включена) защита Sky ID →
 *   меню профилей → приложение
 *
 * Ни один шаг здесь ничего не решает: экран показывает то, что ответил
 * сервер. Даже список профилей и признак Prime приходят оттуда, поэтому
 * подправить их в браузере бессмысленно.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ChevronRight, Crown, LogOut, Plus, ShieldCheck, Smartphone, X,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import type { ServerProfile } from '@/core/auth/api';

/* ── мелочи оформления ─────────────────────────────────────────── */

const avatarGrad = (n: string) => {
  const h = [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg,hsl(${h},65%,46%),hsl(${(h + 40) % 360},70%,38%))`;
};
const initials = (n: string) =>
  n.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/** Телефон как +7 900 123-45-67 — читать вслух проще, чем сплошную строку. */
const prettyPhone = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11) return raw;
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
};

/* ── поле для кода ─────────────────────────────────────────────── */

const CodeInput = ({
  value, onChange, onComplete, disabled, length = 6,
}: {
  value: string; onChange: (v: string) => void; onComplete?: (v: string) => void;
  disabled?: boolean; length?: number;
}) => {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { boxes.current[0]?.focus(); }, []);

  const put = (i: number, chunk: string) => {
    const digits = chunk.replace(/\D/g, '');
    if (!digits) return;
    const next = (value.slice(0, i) + digits + value.slice(i + digits.length))
      .replace(/\D/g, '').slice(0, length);
    onChange(next);
    const at = Math.min(i + digits.length, length - 1);
    boxes.current[at]?.focus();
    if (next.length === length) onComplete?.(next);
  };

  return (
    <div className="flex justify-center gap-2" dir="ltr">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => { boxes.current[i] = el; }}
          value={value[i] ?? ''}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`Цифра ${i + 1}`}
          onChange={e => put(i, e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (value[i]) onChange(value.slice(0, i) + value.slice(i + 1));
              else if (i > 0) { onChange(value.slice(0, i - 1) + value.slice(i)); boxes.current[i - 1]?.focus(); }
            }
            if (e.key === 'ArrowLeft'  && i > 0) boxes.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < length - 1) boxes.current[i + 1]?.focus();
          }}
          onPaste={e => { e.preventDefault(); put(0, e.clipboardData.getData('text')); }}
          className="text-center font-semibold tabular-nums"
          style={{
            width: 'clamp(38px, 12vw, 52px)', height: 'clamp(46px, 14vw, 60px)',
            fontSize: 'clamp(18px, 5vw, 24px)',
            background: value[i] ? 'var(--bg-l3)' : 'var(--bg-l2)',
            border: `1px solid ${value[i] ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 14, color: 'var(--t1)', outline: 'none',
            transition: 'border-color .15s, background .15s',
          }}
        />
      ))}
    </div>
  );
};

/* ── обратный отсчёт до повторной отправки ─────────────────────── */

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

/* ── общая рамка экрана ────────────────────────────────────────── */

const Shell = ({
  title, subtitle, onBack, children,
}: { title: string; subtitle?: string; onBack?: () => void; children: React.ReactNode }) => (
  <div
    className="flex items-center justify-center px-4 py-8"
    style={{
      minHeight: '100dvh', overflowX: 'hidden',
      background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79,110,247,0.10) 0%, var(--bg) 70%)',
    }}
  >
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
      style={{ maxWidth: 400 }}
    >
      {onBack && (
        <button
          type="button" onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--t2)' }}
        >
          <ArrowLeft size={16} /> Назад
        </button>
      )}

      <div className="mb-7 text-center">
        <div
          className="mx-auto mb-4 grid place-items-center"
          style={{
            width: 64, height: 64,
            filter: 'drop-shadow(0 0 14px rgba(79,110,247,0.55))',
          }}
        >
          <img src="/logo.png" alt="Sky" style={{ width: 64, height: 64, objectFit: 'contain' }} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--t1)' }}>{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-sm leading-snug" style={{ color: 'var(--t2)' }}>{subtitle}</p>
        )}
      </div>

      {children}
    </motion.div>
  </div>
);

const ErrorLine = ({ text }: { text?: string }) =>
  text ? (
    <motion.p
      initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
      className="text-center text-xs leading-snug" style={{ color: 'var(--red)' }}
      role="alert"
    >
      {text}
    </motion.p>
  ) : null;

/* ═══ Шаг 1: телефон ═══════════════════════════════════════════ */

const PhoneStep = () => {
  const { phoneInput, setPhoneInput, requestCode } = useAuthStore();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setErr(undefined); setBusy(true);
    const res = await requestCode();
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };

  const digits = phoneInput.replace(/\D/g, '').length;

  return (
    <Shell title="Sky ID" subtitle="Один аккаунт для всей экосистемы. Вход по номеру телефона.">
      <div className="space-y-3">
        <div className="relative">
          <Smartphone
            size={17}
            style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)' }}
          />
          <input
            className="sky-input"
            style={{ paddingLeft: 38, height: 46, fontSize: 16 }}
            placeholder="+7 900 000-00-00"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            value={phoneInput}
            onChange={e => setPhoneInput(e.target.value.replace(/[^\d+\s()-]/g, ''))}
            onKeyDown={e => e.key === 'Enter' && go()}
          />
        </div>
        <ErrorLine text={err} />
        <button
          className="sky-btn-primary w-full"
          style={{ height: 46 }}
          onClick={go}
          disabled={busy || digits < 10}
        >
          {busy ? 'Отправляем…' : 'Получить код'}
        </button>
        <p className="text-center text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          Отправим код в SMS. Пароль не нужен — его в Sky ID больше нет.
        </p>
      </div>
    </Shell>
  );
};

/* ═══ Шаг 2: код из SMS ════════════════════════════════════════ */

const CodeStep = () => {
  const { pendingPhone, codeInfo, verifyCode, requestCode, setPhoneInput } = useAuthStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useCountdown(codeInfo?.retryAfter ?? 60);

  const submit = async (value = code) => {
    if (busy || value.length < 6) return;
    setErr(undefined); setBusy(true);
    const res = await verifyCode(value);
    if (!res.ok) { setErr(res.reason); setCode(''); }
    setBusy(false);
  };

  const resend = async () => {
    setErr(undefined);
    const res = await requestCode(pendingPhone);
    setLeft(res.retryAfter ?? 60);
    if (!res.ok) setErr(res.reason);
  };

  return (
    <Shell
      title="Код из SMS"
      subtitle={`Отправили на ${prettyPhone(pendingPhone)}`}
      onBack={() => { setPhoneInput(pendingPhone); useAuthStore.setState({ step: 'phone' }); }}
    >
      <div className="space-y-4">
        <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} />
        <ErrorLine text={err} />
        <button
          className="sky-btn-primary w-full"
          style={{ height: 46 }}
          onClick={() => submit()}
          disabled={busy || code.length < 6}
        >
          {busy ? 'Проверяем…' : 'Войти'}
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={left > 0}
          className="w-full text-center text-sm"
          style={{ color: left > 0 ? 'var(--t3)' : 'var(--accent)' }}
        >
          {left > 0 ? `Отправить ещё раз через ${left} с` : 'Отправить код ещё раз'}
        </button>
      </div>
    </Shell>
  );
};

/* ═══ Шаг 3: защита самого Sky ID ══════════════════════════════ */

const SkyTwoFactorStep = () => {
  const { verifySkyTwoFactor, logout } = useAuthStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (value = code) => {
    if (busy || value.length < 6) return;
    setErr(undefined); setBusy(true);
    const res = await verifySkyTwoFactor(value);
    if (!res.ok) { setErr(res.reason); setCode(''); }
    setBusy(false);
  };

  return (
    <Shell
      title="Подтверждение входа"
      subtitle="У этого Sky ID включена двухэтапная защита. Введите код из приложения-аутентификатора."
      onBack={logout}
    >
      <div className="space-y-4">
        <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} />
        <ErrorLine text={err} />
        <button
          className="sky-btn-primary w-full" style={{ height: 46 }}
          onClick={() => submit()} disabled={busy || code.length < 6}
        >
          {busy ? 'Проверяем…' : 'Подтвердить'}
        </button>
      </div>
    </Shell>
  );
};

/* ═══ Шаг 4: меню профилей ═════════════════════════════════════ */

const ProfileCard = ({ profile, onPick }: { profile: ServerProfile; onPick: () => void }) => (
  <motion.button
    type="button" whileTap={{ scale: 0.985 }} onClick={onPick}
    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
    style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}
  >
    <div
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{
        width: 46, height: 46, fontSize: 16,
        background: profile.avatar ? `center/cover url(${profile.avatar})` : avatarGrad(profile.name),
      }}
    >
      {!profile.avatar && initials(profile.name)}
    </div>

    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <p className="truncate text-[15px] font-semibold" style={{ color: 'var(--t1)' }}>{profile.name}</p>
        {profile.isPrime && <Crown size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
      </div>
      <p className="truncate text-xs" style={{ color: 'var(--t3)' }}>@{profile.username}</p>

      {(profile.isPrime || profile.twoFactorEnabled) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {profile.isPrime && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
            >
              Prime
            </span>
          )}
          {profile.twoFactorEnabled && (
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
            >
              <ShieldCheck size={10} /> Защищён
            </span>
          )}
        </div>
      )}
    </div>

    <ChevronRight size={16} style={{ color: 'var(--t3)', flexShrink: 0 }} />
  </motion.button>
);

const ProfilesStep = () => {
  const { sky, profiles, maxProfiles, selectProfile, logout } = useAuthStore();
  const [mode, setMode] = useState<'list' | 'create'>(profiles.length ? 'list' : 'create');
  const [codeFor, setCodeFor] = useState<ServerProfile | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [err, setErr] = useState<string>();

  const canAdd = profiles.length < (maxProfiles || 2);

  if (codeFor) return <ProfileCodeStep profile={codeFor} onBack={() => setCodeFor(null)} />;
  if (mode === 'create') {
    return (
      <CreateProfileStep
        first={profiles.length === 0}
        onBack={profiles.length ? () => setMode('list') : undefined}
      />
    );
  }

  const pick = async (p: ServerProfile) => {
    setErr(undefined);
    const res = await selectProfile(p.id);
    if (res.ok) return;
    // Защищённый профиль — спрашиваем код; всё прочее показываем словами,
    // иначе нажатие просто ничего не делает и непонятно почему.
    if (res.needsCode) setCodeFor(p); else setErr(res.reason ?? 'Не удалось открыть профиль');
  };

  return (
    <Shell
      title="Ваши профили"
      subtitle={sky ? `Sky ID · ${prettyPhone(sky.phone)}` : undefined}
    >
      <div className="space-y-2.5">
        {profiles.map(p => <ProfileCard key={p.id} profile={p} onPick={() => pick(p)} />)}

        <ErrorLine text={err} />

        {canAdd ? (
          <button
            type="button" onClick={() => setMode('create')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-medium"
            style={{ background: 'transparent', border: '1px dashed var(--border-m)', color: 'var(--t2)' }}
          >
            <Plus size={16} /> Создать профиль
          </button>
        ) : (
          <p className="pt-1 text-center text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            На один Sky ID можно завести не больше {maxProfiles} профилей.
          </p>
        )}

        <div className="pt-3">
          <button
            type="button" onClick={() => setConfirmExit(true)}
            className="mx-auto flex items-center gap-1.5 text-sm"
            style={{ color: 'var(--t3)' }}
          >
            <LogOut size={14} /> Выйти из Sky ID
          </button>
        </div>
      </div>

      <AnimatePresence>
        {confirmExit && (
          <ConfirmExit onCancel={() => setConfirmExit(false)} onConfirm={logout} />
        )}
      </AnimatePresence>
    </Shell>
  );
};

/* ── подтверждение выхода ──────────────────────────────────────── */

export const ConfirmExit = ({
  onCancel, onConfirm,
}: { onCancel: () => void; onConfirm: () => void }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', padding: 16 }}
    onClick={onCancel}
  >
    <motion.div
      initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      onClick={e => e.stopPropagation()}
      className="w-full rounded-3xl p-5"
      style={{ maxWidth: 380, background: 'var(--bg-l1)', border: '1px solid var(--border)' }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold" style={{ color: 'var(--t1)' }}>Выйти из Sky ID?</h2>
        <button type="button" onClick={onCancel} style={{ color: 'var(--t3)' }} aria-label="Закрыть">
          <X size={18} />
        </button>
      </div>
      <p className="mb-5 text-sm leading-relaxed" style={{ color: 'var(--t2)' }}>
        Выйдут все профили этого Sky ID. Чтобы вернуться, понадобится код из SMS.
        Данные профилей никуда не денутся.
      </p>
      <div className="flex gap-2">
        <button type="button" className="sky-btn-ghost flex-1" onClick={onCancel}>Остаться</button>
        <button
          type="button" className="flex-1 rounded-[10px] px-4 py-2.5 text-sm font-semibold"
          style={{ background: 'var(--red-bg)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.25)' }}
          onClick={onConfirm}
        >
          Выйти
        </button>
      </div>
    </motion.div>
  </motion.div>
);

/* ── код защищённого профиля ───────────────────────────────────── */

const ProfileCodeStep = ({
  profile, onBack,
}: { profile: ServerProfile; onBack: () => void }) => {
  const { selectProfile } = useAuthStore();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (value = code) => {
    if (busy || value.length < 6) return;
    setErr(undefined); setBusy(true);
    const res = await selectProfile(profile.id, value);
    if (!res.ok) { setErr(res.reason ?? 'Неверный код'); setCode(''); }
    setBusy(false);
  };

  return (
    <Shell
      title={profile.name}
      subtitle="Профиль защищён. Введите код из приложения-аутентификатора."
      onBack={onBack}
    >
      <div className="space-y-4">
        <CodeInput value={code} onChange={setCode} onComplete={submit} disabled={busy} />
        <ErrorLine text={err} />
        <button
          className="sky-btn-primary w-full" style={{ height: 46 }}
          onClick={() => submit()} disabled={busy || code.length < 6}
        >
          {busy ? 'Проверяем…' : 'Открыть профиль'}
        </button>
      </div>
    </Shell>
  );
};

/* ── создание профиля ──────────────────────────────────────────── */

const CreateProfileStep = ({
  first, onBack,
}: { first: boolean; onBack?: () => void }) => {
  const { createProfile } = useAuthStore();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  const cleanUser = useMemo(() => username.trim().toLowerCase().replace(/^@/, ''), [username]);
  const ready = name.trim().length >= 2 && /^[a-z0-9_]{3,32}$/.test(cleanUser);

  const go = async () => {
    if (busy || !ready) return;
    setErr(undefined); setBusy(true);
    const res = await createProfile({ name, username: cleanUser });
    if (!res.ok) setErr(res.reason);
    setBusy(false);
  };

  return (
    <Shell
      title={first ? 'Создайте профиль' : 'Второй профиль'}
      subtitle={first
        ? 'Профиль — это то, каким вас видят в Sky: имя, ник и аватар.'
        : 'У второго профиля свои Prime, кошелёк и защита — они не связаны с первым.'}
      onBack={onBack}
    >
      <div className="space-y-3">
        <input
          className="sky-input" style={{ height: 46, fontSize: 16 }}
          placeholder="Имя" autoFocus maxLength={64}
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && go()}
        />
        <div className="relative">
          <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--t3)', fontSize: 16 }}>@</span>
          <input
            className="sky-input" style={{ height: 46, fontSize: 16, paddingLeft: 28 }}
            placeholder="ник" maxLength={32} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            value={username} onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && go()}
          />
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          Ник: 3–32 символа, латиница, цифры и подчёркивание.
        </p>
        <ErrorLine text={err} />
        <button
          className="sky-btn-primary w-full" style={{ height: 46 }}
          onClick={go} disabled={busy || !ready}
        >
          {busy ? 'Создаём…' : 'Создать профиль'}
        </button>
      </div>
    </Shell>
  );
};

/* ═══ Точка входа ══════════════════════════════════════════════ */

export const AuthScreen = () => {
  const step = useAuthStore(s => s.step);

  return (
    <AnimatePresence mode="wait">
      <div key={step}>
        {step === 'twofa'    ? <SkyTwoFactorStep /> :
         step === 'profiles' ? <ProfilesStep /> :
         step === 'code'     ? <CodeStep /> :
                               <PhoneStep />}
      </div>
    </AnimatePresence>
  );
};
