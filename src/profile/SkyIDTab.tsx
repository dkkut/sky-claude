/**
 * Вкладка «Sky ID» в профиле.
 *
 * Разделы: Sky ID (номер, почта) · Профили · Защита · Устройства · История.
 *
 * Всё, что здесь меняется, меняется на сервере: экран только показывает
 * его ответ. Включить себе Prime или снять защиту, поправив что-то в
 * браузере, нельзя.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Copy, Check, Smartphone, Monitor, Globe,
  LogOut, Trash2, Lock, Unlock, Mail, Crown, Plus,
  Clock, AlertTriangle, CheckCircle2, KeyRound,
  Fingerprint, XCircle, Users, ArrowLeftRight,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { ConfirmExit } from '@/auth/AuthScreen';
import type { ServerProfile, TwoFactorMethod } from '@/core/auth/api';

/* ── helpers ─────────────────────────────────────────────────── */
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

const prettyPhone = (raw: string) => {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length !== 11) return raw || '—';
  return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
};

const DevIcon = ({ os }: { os: string }) => {
  if (os === 'Android' || os === 'iOS') return <Smartphone size={14} />;
  return <Monitor size={14} />;
};

const EVT_COLOR: Record<string, string> = {
  login:            'var(--green)',
  login_new_device: 'var(--amber)',
  login_fail:       'var(--red)',
  password_change:  'var(--accent)',
  '2fa_enable':     'var(--green)',
  '2fa_disable':    'var(--amber)',
  logout_all:       'var(--red)',
};
const EVT_ICON: Record<string, React.ReactNode> = {
  login:            <CheckCircle2 size={13} />,
  login_new_device: <AlertTriangle size={13} />,
  login_fail:       <XCircle size={13} />,
  password_change:  <KeyRound size={13} />,
  '2fa_enable':     <Lock size={13} />,
  '2fa_disable':    <Unlock size={13} />,
  logout_all:       <LogOut size={13} />,
};

/** Плашка с результатом действия. */
const Note = ({ ok, text }: { ok: boolean; text: string }) => (
  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
    className="rounded-xl px-3 py-2 text-xs leading-snug"
    style={{
      background: ok ? 'var(--green-bg)' : 'var(--red-bg)',
      border:     `1px solid ${ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
      color:      ok ? 'var(--green)' : 'var(--red)',
    }}>
    {text}
  </motion.div>
);

const Field = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
    style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)', ...(p.style ?? {}) }} />
);

/* ── sub-sections ────────────────────────────────────────────── */
type SubTab = 'skyid' | 'profiles' | 'security' | 'devices' | 'log';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'skyid',    label: 'Sky ID'    },
  { key: 'profiles', label: 'Профили'   },
  { key: 'security', label: 'Защита'    },
  { key: 'devices',  label: 'Устройства'},
  { key: 'log',      label: 'История'   },
];

/* ════════════════════════════════════════════════════════════ */
export const SkyIDTab = () => {
  const { accounts, currentUserId, terminateDevice, logoutAll, reloadSession } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const [sub, setSub] = useState<SubTab>('skyid');

  // Состояние Sky ID могло измениться в другой вкладке — перечитываем.
  useEffect(() => { void reloadSession(); }, [reloadSession]);

  if (!me) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex gap-1 px-4 pt-3 pb-0 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
        {SUB_TABS.map(({ key, label }) => (
          <button key={key} type="button" onClick={() => setSub(key)}
            className="shrink-0 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all"
            style={{
              background: sub === key ? 'var(--accent-bg)' : 'rgba(0,0,0,0)',
              color:      sub === key ? 'var(--accent)'    : 'var(--t3)',
              border:     sub === key ? '1px solid rgba(79,110,247,0.2)' : '1px solid transparent',
            }}>
            {label}
          </button>
        ))}
      </div>
      <div className="h-px mx-4 mt-2 mb-0 shrink-0" style={{ background: 'var(--border)' }} />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
        <AnimatePresence mode="wait">
          <motion.div key={sub}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}>

            {sub === 'skyid'    && <SkyIdSection />}
            {sub === 'profiles' && <ProfilesSection />}
            {sub === 'security' && <SecuritySection />}
            {sub === 'devices'  && (
              <DevicesSection me={me}
                onTerminate={id => terminateDevice(me.id, id)}
                onLogoutAll={() => logoutAll()} />
            )}
            {sub === 'log'      && <SecurityLogSection me={me} />}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

/* ── Sky ID: номер, идентификатор, почта ─────────────────────── */
const SkyIdSection = () => {
  const { sky } = useAuthStore();
  const [copied, setCopied] = useState(false);

  if (!sky) return null;

  const copy = () => {
    navigator.clipboard.writeText(sky.id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5"
        style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.14),rgba(129,140,248,0.07))', border: '1px solid rgba(79,110,247,0.22)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Fingerprint size={16} style={{ color: 'var(--accent)' }} />
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Ваш Sky ID</p>
        </div>
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>{prettyPhone(sky.phone)}</p>
        <p className="mt-1 break-all font-mono text-[11px]" style={{ color: 'var(--t3)' }}>{sky.id}</p>
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--t3)' }}>
          Один аккаунт для всей экосистемы. Профили внутри него — разные, а вход общий.
        </p>
        <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={copy}
          className="flex items-center gap-2 mt-3 rounded-xl px-4 py-2 text-xs font-bold transition-all"
          style={{
            background: copied ? 'var(--green-bg)' : 'var(--accent-bg)',
            border:     `1px solid ${copied ? 'rgba(52,211,153,0.3)' : 'rgba(79,110,247,0.25)'}`,
            color:      copied ? 'var(--green)' : 'var(--accent)',
          }}>
          {copied ? <><Check size={13} />Скопировано</> : <><Copy size={13} />Копировать Sky ID</>}
        </motion.button>
      </div>

      <EmailSection />
    </div>
  );
};

/* ── Почта: запасной способ связи ────────────────────────────── */
const EmailSection = () => {
  const { sky, startEmailLink, confirmEmailLink } = useAuthStore();
  const [email, setEmail] = useState('');
  const [code, setCode]   = useState('');
  const [stage, setStage] = useState<'idle' | 'code'>('idle');
  const [msg, setMsg]     = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy]   = useState(false);

  const send = async () => {
    setBusy(true); setMsg(null);
    const r = await startEmailLink(email);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason ?? 'Не получилось' }); return; }
    setStage('code');
    setMsg({ ok: true, text: 'Код отправлен на почту' });
  };

  const confirm = async () => {
    setBusy(true); setMsg(null);
    const r = await confirmEmailLink(email, code);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason ?? 'Неверный код' }); return; }
    setStage('idle'); setCode(''); setEmail('');
    setMsg({ ok: true, text: 'Почта привязана' });
  };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <Mail size={14} style={{ color: 'var(--t2)' }} />
        <p className="text-xs font-bold" style={{ color: 'var(--t2)' }}>Почта</p>
        {sky?.emailVerified && (
          <span className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>подтверждена</span>
        )}
      </div>

      {sky?.email && (
        <p className="text-sm" style={{ color: 'var(--t1)' }}>{sky.email}</p>
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        Необязательна. Пригодится, чтобы получать уведомления безопасности и
        восстанавливать доступ, если потеряется номер.
      </p>

      {stage === 'idle' ? (
        <>
          <Field type="email" inputMode="email" autoComplete="email"
            placeholder={sky?.email ? 'Новый адрес' : 'you@example.com'}
            value={email} onChange={e => setEmail(e.target.value)} />
          <button type="button" onClick={send} disabled={busy || !email.includes('@')}
            className="w-full rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? 'Отправляем…' : sky?.email ? 'Привязать другую' : 'Привязать почту'}
          </button>
        </>
      ) : (
        <>
          <Field inputMode="numeric" maxLength={6} placeholder="Код из письма"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="flex gap-2">
            <button type="button" onClick={() => { setStage('idle'); setCode(''); }}
              className="sky-btn-ghost flex-1">Отмена</button>
            <button type="button" onClick={confirm} disabled={busy || code.length < 6}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              Подтвердить
            </button>
          </div>
        </>
      )}

      {msg && <Note ok={msg.ok} text={msg.text} />}
    </div>
  );
};

/* ── Профили: список, смена, создание, выход ─────────────────── */
const ProfilesSection = () => {
  const { profiles, activeProfileId, maxProfiles, switchProfile, logout } = useAuthStore();
  const [confirmExit, setConfirmExit] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users size={14} style={{ color: 'var(--t3)' }} />
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Профили · {profiles.length} из {maxProfiles}
        </p>
      </div>

      {profiles.map(p => (
        <div key={p.id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{
            background: p.id === activeProfileId ? 'var(--accent-bg)' : 'var(--bg-l2)',
            border: `1px solid ${p.id === activeProfileId ? 'rgba(79,110,247,0.2)' : 'var(--border)'}`,
          }}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
            style={{ background: p.avatar ? `center/cover url(${p.avatar})` : 'linear-gradient(135deg,var(--accent),#818cf8)' }}>
            {!p.avatar && p.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }}>{p.name}</p>
              {p.isPrime && <Crown size={12} style={{ color: 'var(--amber)' }} />}
              {p.twoFactorEnabled && <Shield size={12} style={{ color: 'var(--green)' }} />}
            </div>
            <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>@{p.username}</p>
          </div>
          {p.id === activeProfileId && (
            <span className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold"
              style={{ background: 'rgba(79,110,247,0.18)', color: 'var(--accent)' }}>СЕЙЧАС</span>
          )}
        </div>
      ))}

      <button type="button" onClick={switchProfile}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold"
        style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }}>
        <ArrowLeftRight size={15} /> Сменить профиль
      </button>

      {profiles.length < maxProfiles && (
        <button type="button" onClick={switchProfile}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm"
          style={{ background: 'transparent', border: '1px dashed var(--border-m)', color: 'var(--t2)' }}>
          <Plus size={15} /> Создать второй профиль
        </button>
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        У каждого профиля свои Prime, кошелёк и защита. Смена профиля не выходит
        из Sky ID — код из SMS заново не понадобится.
      </p>

      <button type="button" onClick={() => setConfirmExit(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold"
        style={{ background: 'var(--red-bg)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--red)' }}>
        <LogOut size={14} /> Выйти из Sky ID
      </button>

      <AnimatePresence>
        {confirmExit && <ConfirmExit onCancel={() => setConfirmExit(false)} onConfirm={logout} />}
      </AnimatePresence>
    </div>
  );
};

/* ── Защита: две независимые двухэтапные проверки ────────────── */

/**
 * Один блок включения защиты. Порядок один и тот же для Sky ID и для
 * профиля, различается только тем, куда уходят вызовы.
 */
const TwoFactorBlock = ({
  title, hint, enabled, method, emailReady, begin, confirm, disable, resend,
}: {
  title: string; hint: string; enabled: boolean;
  method: TwoFactorMethod; emailReady: boolean;
  begin: (m: TwoFactorMethod) => Promise<{ ok: boolean; method?: TwoFactorMethod; secret?: string; email?: string; reason?: string }>;
  confirm: (code: string) => Promise<{ ok: boolean; reason?: string }>;
  disable: (code: string) => Promise<{ ok: boolean; reason?: string }>;
  resend: () => Promise<{ ok: boolean; reason?: string; retryAfter?: number }>;
}) => {
  const [stage, setStage] = useState<'idle' | 'setup' | 'off'>('idle');
  const [pick, setPick] = useState<TwoFactorMethod>('app');
  const [secret, setSecret] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reset = () => { setStage('idle'); setCode(''); setSecret(''); setSentTo(''); };

  const start = async () => {
    setBusy(true); setMsg(null);
    const r = await begin(pick);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason ?? 'Не получилось' }); return; }
    setSecret(r.secret ?? ''); setSentTo(r.email ?? ''); setStage('setup');
  };

  const finish = async () => {
    setBusy(true); setMsg(null);
    const r = await confirm(code);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason ?? 'Неверный код' }); return; }
    reset(); setMsg({ ok: true, text: 'Защита включена' });
  };

  const off = async () => {
    setBusy(true); setMsg(null);
    const r = await disable(code);
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason ?? 'Неверный код' }); return; }
    reset(); setMsg({ ok: true, text: 'Защита отключена' });
  };

  const askCode = async () => {
    setBusy(true); setMsg(null);
    const r = await resend();
    setBusy(false);
    setMsg(r.ok
      ? { ok: true, text: 'Код отправлен на почту' }
      : { ok: false, text: r.reason ?? 'Не получилось отправить' });
  };

  /* Какой способ настраивается сейчас: при включённой защите — тот, что
     записан, при настройке — выбранный. */
  const active = stage === 'setup' ? pick : method;
  const byEmail = active === 'email';

  return (
    <div className="rounded-2xl p-4 space-y-3"
      style={{
        background: enabled ? 'var(--green-bg)' : 'var(--bg-l2)',
        border: `1px solid ${enabled ? 'rgba(52,211,153,0.2)' : 'var(--border)'}`,
      }}>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl"
          style={{ background: enabled ? 'rgba(52,211,153,0.12)' : 'var(--bg-l3)' }}>
          {enabled ? <Lock size={17} style={{ color: 'var(--green)' }} />
                   : <Unlock size={17} style={{ color: 'var(--t3)' }} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>{title}</p>
          <p className="text-[11px] leading-snug mt-0.5" style={{ color: 'var(--t3)' }}>{hint}</p>
          {enabled && (
            <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: 'var(--green)' }}>
              {method === 'email' ? <Mail size={11} /> : <Smartphone size={11} />}
              {method === 'email' ? 'код приходит на почту' : 'код из приложения'}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold"
          style={{
            background: enabled ? 'rgba(52,211,153,0.15)' : 'var(--bg-l3)',
            color: enabled ? 'var(--green)' : 'var(--t3)',
          }}>
          {enabled ? 'вкл' : 'выкл'}
        </span>
      </div>

      {stage === 'idle' && !enabled && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
            Чем подтверждать
          </p>
          <div className="flex gap-2">
            {([
              { key: 'app'   as const, icon: Smartphone, label: 'Приложение', note: 'Google Authenticator и подобные' },
              { key: 'email' as const, icon: Mail,       label: 'Почта',      note: emailReady ? 'код письмом' : 'нужна привязанная почта' },
            ]).map(({ key, icon: Icon, label, note }) => {
              const off = key === 'email' && !emailReady;
              return (
                <button key={key} type="button" disabled={off}
                  onClick={() => setPick(key)}
                  className="flex-1 rounded-xl px-3 py-2.5 text-left"
                  style={{
                    background: pick === key ? 'var(--accent-bg)' : 'var(--bg-l3)',
                    border: `1px solid ${pick === key ? 'rgba(79,110,247,0.35)' : 'var(--border)'}`,
                    opacity: off ? 0.45 : 1,
                  }}>
                  <Icon size={14} style={{ color: pick === key ? 'var(--accent)' : 'var(--t3)' }} />
                  <p className="text-[12px] font-semibold mt-1" style={{ color: 'var(--t1)' }}>{label}</p>
                  <p className="text-[10px] leading-snug" style={{ color: 'var(--t3)' }}>{note}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--t3)' }}>
            SMS вторым способом нет намеренно: вход и так идёт по коду из SMS,
            и второй код на тот же номер ничего не добавит.
          </p>
          <button type="button" onClick={start} disabled={busy}
            className="w-full rounded-xl py-2.5 text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            {busy ? 'Готовим…' : 'Включить защиту'}
          </button>
        </>
      )}

      {stage === 'idle' && enabled && (
        <button type="button" onClick={() => { setStage('off'); setMsg(null); }}
          className="w-full rounded-xl py-2.5 text-sm font-semibold"
          style={{ background: 'var(--red-bg)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--red)' }}>
          Отключить защиту
        </button>
      )}

      {stage === 'setup' && (
        <div className="space-y-3">
          {byEmail ? (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
              Отправили код на {sentTo || 'вашу почту'}. Введите его, чтобы включить защиту.
            </p>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
                Добавьте этот ключ в приложение-аутентификатор (Google Authenticator,
                Aegis, 1Password) и введите код, который оно покажет.
              </p>
              <button type="button"
                onClick={() => { navigator.clipboard.writeText(secret).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left font-mono text-[12px] break-all"
                style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }}>
                <span className="min-w-0 flex-1 break-all">{secret}</span>
                {copied ? <Check size={13} style={{ color: 'var(--green)' }} /> : <Copy size={13} style={{ color: 'var(--t3)' }} />}
              </button>
            </>
          )}
          <Field inputMode="numeric" maxLength={6} placeholder="Код"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="sky-btn-ghost flex-1">Отмена</button>
            <button type="button" onClick={finish} disabled={busy || code.length < 6}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              Включить
            </button>
          </div>
          {byEmail && (
            <button type="button" onClick={askCode} disabled={busy}
              className="w-full text-center text-[12px]" style={{ color: 'var(--accent)' }}>
              Отправить код ещё раз
            </button>
          )}
        </div>
      )}

      {stage === 'off' && (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t2)' }}>
            Чтобы отключить защиту, введите действующий код. Так тот, кто
            дорвался до открытой вкладки, не сможет снять её одной кнопкой.
          </p>
          <Field inputMode="numeric" maxLength={6} placeholder="Код"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          <div className="flex gap-2">
            <button type="button" onClick={reset} className="sky-btn-ghost flex-1">Отмена</button>
            <button type="button" onClick={off} disabled={busy || code.length < 6}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--red-bg)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--red)' }}>
              Отключить
            </button>
          </div>
          {byEmail && (
            <button type="button" onClick={askCode} disabled={busy}
              className="w-full text-center text-[12px]" style={{ color: 'var(--accent)' }}>
              Прислать код на почту
            </button>
          )}
        </div>
      )}

      {msg && <Note ok={msg.ok} text={msg.text} />}
    </div>
  );
};

const SecuritySection = () => {
  const {
    sky, profiles, activeProfileId,
    beginSkyTwoFactor, confirmSkyTwoFactor, disableSkyTwoFactor, sendSkyTwoFactorCode,
    beginProfileTwoFactor, confirmProfileTwoFactor, disableProfileTwoFactor, sendProfileTwoFactorCode,
  } = useAuthStore();

  const active: ServerProfile | undefined = profiles.find(p => p.id === activeProfileId);
  const emailReady = Boolean(sky?.emailVerified);

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
        Двухэтапная защита
      </p>

      {!emailReady && (
        <p className="rounded-xl px-3 py-2 text-[11px] leading-relaxed"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t3)' }}>
          Чтобы получать коды письмом, привяжите почту на вкладке «Sky ID».
          Без неё доступен только код из приложения.
        </p>
      )}

      <TwoFactorBlock
        title="Вход в Sky ID"
        hint="Спрашивается при входе по номеру — после кода из SMS."
        enabled={Boolean(sky?.twoFactorEnabled)}
        method={sky?.twoFactorMethod ?? 'app'}
        emailReady={emailReady}
        begin={m => beginSkyTwoFactor(m)}
        confirm={confirmSkyTwoFactor}
        disable={disableSkyTwoFactor}
        resend={sendSkyTwoFactorCode}
      />

      {active && (
        <TwoFactorBlock
          title={`Профиль «${active.name}»`}
          hint="Спрашивается при открытии этого профиля. Не связана с защитой Sky ID."
          enabled={active.twoFactorEnabled}
          method={active.twoFactorMethod ?? 'app'}
          emailReady={emailReady}
          begin={m => beginProfileTwoFactor(active.id, m)}
          confirm={code => confirmProfileTwoFactor(active.id, code)}
          disable={code => disableProfileTwoFactor(active.id, code)}
          resend={() => sendProfileTwoFactorCode(active.id)}
        />
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        Две защиты независимы: можно включить только на профиль, только на вход
        в Sky ID или на оба сразу. Второй профиль защищается отдельно — откройте
        его и включите защиту там.
      </p>
    </div>
  );
};

/* ── Устройства этого браузера ───────────────────────────────── */
const DevicesSection = ({ me, onTerminate, onLogoutAll }: { me: any; onTerminate: (id: string) => void; onLogoutAll: () => void }) => {
  const devs: any[] = me.devices ?? [];
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Входы с этого устройства · {devs.length}
        </p>
        <button type="button" onClick={() => setConfirm(true)}
          className="text-[11px] font-semibold flex items-center gap-1"
          style={{ color: 'var(--red)' }}>
          <LogOut size={11} /> Выйти
        </button>
      </div>

      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-3 flex items-center gap-3"
            style={{ background: 'var(--red-bg)', border: '1px solid rgba(248,113,113,0.18)' }}>
            <p className="text-xs flex-1" style={{ color: 'var(--t1)' }}>Завершить эту сессию?</p>
            <button type="button" onClick={() => { onLogoutAll(); setConfirm(false); }}
              className="rounded-xl px-3 py-1.5 text-[11px] font-bold"
              style={{ background: 'rgba(248,113,113,0.18)', color: 'var(--red)' }}>Да</button>
            <button type="button" onClick={() => setConfirm(false)}
              className="rounded-xl px-3 py-1.5 text-[11px] font-semibold"
              style={{ background: 'var(--bg-l3)', color: 'var(--t2)' }}>Нет</button>
          </motion.div>
        )}
      </AnimatePresence>

      {devs.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-3 opacity-50">
          <Globe size={28} style={{ color: 'var(--t3)' }} />
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Записей пока нет</p>
        </div>
      ) : devs.map((d, i) => (
        <motion.div key={d.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{
            background: d.isCurrent ? 'var(--accent-bg)' : 'var(--bg-l2)',
            border: `1px solid ${d.isCurrent ? 'rgba(79,110,247,0.2)' : 'var(--border)'}`,
          }}>
          <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0 mt-0.5"
            style={{ background: d.isCurrent ? 'rgba(79,110,247,0.12)' : 'var(--bg-l3)' }}>
            <DevIcon os={d.os} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>{d.browser} · {d.os}</p>
              {d.isCurrent && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(79,110,247,0.18)', color: 'var(--accent)' }}>ТЕКУЩЕЕ</span>
              )}
            </div>
            <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--t3)' }}>
              <Clock size={9} /> Вход: {fmtDt(d.loginAt)}
            </p>
          </div>
          {!d.isCurrent && (
            <button type="button" onClick={() => onTerminate(d.id)}
              className="grid h-7 w-7 place-items-center rounded-xl transition-colors shrink-0"
              style={{ color: 'var(--t3)' }}>
              <Trash2 size={13} />
            </button>
          )}
        </motion.div>
      ))}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        Это записи входов, сделанных в этом браузере. Чтобы закрыть доступ
        везде, выйдите из Sky ID и смените код доступа к номеру.
      </p>
    </div>
  );
};

/* ── История безопасности ────────────────────────────────────── */
const SecurityLogSection = ({ me }: { me: any }) => {
  const log: any[] = me.securityLog ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
        История · {log.length}
      </p>

      {log.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-3 opacity-50">
          <Clock size={28} style={{ color: 'var(--t3)' }} />
          <p className="text-sm" style={{ color: 'var(--t2)' }}>История пуста</p>
        </div>
      ) : log.map((e, i) => (
        <motion.div key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.04 }}
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="grid h-7 w-7 place-items-center rounded-xl shrink-0 mt-0.5"
            style={{ background: `${EVT_COLOR[e.type]}14`, color: EVT_COLOR[e.type] }}>
            {EVT_ICON[e.type]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--t1)' }}>{e.text}</p>
            <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--t3)' }}>
              <Clock size={9} /> {fmtDt(e.at)}
            </p>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
