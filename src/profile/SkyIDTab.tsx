/**
 * SkyIDTab — вкладка «Sky ID» в профиле
 * Разделы: Sky ID · 2FA · Устройства · Смена пароля · Лог безопасности
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Copy, Check, Smartphone, Monitor, Globe,
  LogOut, Trash2, Key, Lock, Unlock, Eye, EyeOff,
  Clock, AlertTriangle, CheckCircle2, ChevronRight,
  Fingerprint, Hash, RefreshCw, Send, XCircle,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';

/* ── helpers ─────────────────────────────────────────────────── */
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

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
  password_change:  <Key size={13} />,
  '2fa_enable':     <Lock size={13} />,
  '2fa_disable':    <Unlock size={13} />,
  logout_all:       <LogOut size={13} />,
};

/* ── sub-sections ────────────────────────────────────────────── */
type SubTab = 'skyid' | '2fa' | 'devices' | 'password' | 'log';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'skyid',    label: 'Sky ID'    },
  { key: '2fa',      label: '2FA'       },
  { key: 'devices',  label: 'Устройства'},
  { key: 'password', label: 'Пароль'    },
  { key: 'log',      label: 'История'   },
];

/* ════════════════════════════════════════════════════════════ */
export const SkyIDTab = () => {
  const {
    accounts, currentUserId,
    enable2FA, disable2FA, send2FACode, verify2FA,
    changePassword, terminateDevice, logoutAll,
  } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const [sub,     setSub]     = useState<SubTab>('skyid');
  const [copied,  setCopied]  = useState(false);

  if (!me) return null;

  const copyId = () => {
    navigator.clipboard.writeText(me.skyId ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-nav */}
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

            {/* ── SKY ID ─────────────────────────────────── */}
            {sub === 'skyid' && <SkyIdSection me={me} copied={copied} onCopy={copyId} />}

            {/* ── 2FA ────────────────────────────────────── */}
            {sub === '2fa' && <TwoFASection me={me} />}

            {/* ── DEVICES ────────────────────────────────── */}
            {sub === 'devices' && (
              <DevicesSection me={me}
                onTerminate={id => terminateDevice(me.id, id)}
                onLogoutAll={() => logoutAll(me.id)} />
            )}

            {/* ── PASSWORD ───────────────────────────────── */}
            {sub === 'password' && <PasswordSection userId={me.id} />}

            {/* ── LOG ────────────────────────────────────── */}
            {sub === 'log' && <SecurityLogSection me={me} />}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

/* ── Sky ID card ─────────────────────────────────────────────── */
const SkyIdSection = ({ me, copied, onCopy }: { me: any; copied: boolean; onCopy: () => void }) => {
  const { findBySkyId } = useAuthStore();
  const [query,  setQuery]  = useState('');
  const [result, setResult] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  const search = () => {
    const r = findBySkyId(query);
    setResult(r ?? null);
    setNotFound(!r);
  };

  return (
    <div className="space-y-4">
      {/* Card */}
      <div className="rounded-2xl p-5"
        style={{ background: 'linear-gradient(135deg,rgba(79,110,247,0.14),rgba(129,140,248,0.07))', border: '1px solid rgba(79,110,247,0.22)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Fingerprint size={16} style={{ color: 'var(--accent)' }} />
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Твой Sky ID</p>
        </div>
        <p className="text-2xl font-black font-mono tracking-widest" style={{ color: 'var(--t1)' }}>
          {me.skyId ?? '—'}
        </p>
        <p className="text-[11px] mt-1" style={{ color: 'var(--t3)' }}>
          Уникальный идентификатор · Можно использовать для поиска
        </p>
        <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={onCopy}
          className="flex items-center gap-2 mt-3 rounded-xl px-4 py-2 text-xs font-bold transition-all"
          style={{
            background: copied ? 'rgba(52,211,153,0.12)' : 'rgba(79,110,247,0.12)',
            border:     copied ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(79,110,247,0.25)',
            color:      copied ? 'var(--green)' : 'var(--accent)',
          }}>
          {copied ? <><Check size={13} />Скопировано!</> : <><Copy size={13} />Копировать Sky ID</>}
        </motion.button>
      </div>

      {/* Search by Sky ID */}
      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--t2)' }}>
          <Hash size={12} className="inline mr-1" />Найти по Sky ID
        </p>
        <div className="flex gap-2">
          <input value={query} onChange={e => { setQuery(e.target.value); setResult(null); setNotFound(false); }}
            placeholder="SKY-A1B2C3" onKeyDown={e => e.key === 'Enter' && search()}
            className="flex-1 rounded-xl px-3 py-2 text-sm font-mono outline-none"
            style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }} />
          <button type="button" onClick={search}
            className="rounded-xl px-4 py-2 text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff' }}>
            Найти
          </button>
        </div>
        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-center gap-3 mt-3 rounded-xl px-3 py-2.5"
              style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
              <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shrink-0"
                style={{ background: 'linear-gradient(135deg,var(--accent),#818cf8)' }}>
                {result.name[0]}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{result.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--t3)' }}>@{result.username} · {result.skyId}</p>
              </div>
              <CheckCircle2 size={16} className="ml-auto shrink-0" style={{ color: 'var(--green)' }} />
            </motion.div>
          )}
          {notFound && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--red)' }}>
              <XCircle size={13} /> Пользователь не найден
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Info */}
      <div className="rounded-2xl px-4 py-3"
        style={{ background: 'rgba(79,110,247,0.05)', border: '1px solid rgba(79,110,247,0.12)' }}>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
          Sky ID генерируется автоматически при регистрации и не изменяется. Используется для идентификации аккаунта вне зависимости от имени пользователя.
        </p>
      </div>
    </div>
  );
};

/* ── 2FA section ─────────────────────────────────────────────── */
const TwoFASection = ({ me }: { me: any }) => {
  const { enable2FA, disable2FA, send2FACode, verify2FA } = useAuthStore();
  const tfa = me.twoFA;
  const [method, setMethod]   = useState<'sms'|'email'>('sms');
  const [secret, setSecret]   = useState('');
  const [step,   setStep]     = useState<'idle'|'setup'|'verify'>('idle');
  const [otp,    setOtp]      = useState('');
  const [demoCode, setDemo]   = useState('');
  const [err,    setErr]      = useState('');
  const [ok,     setOk]       = useState(false);
  const [showSec, setShowSec] = useState(false);

  const startSetup = () => { setStep('setup'); setErr(''); setOk(false); };

  const sendCode = () => {
    const code = send2FACode(me.id);
    setDemo(code); setStep('verify'); setErr('');
  };

  const verify = () => {
    const r = verify2FA(me.id, otp);
    if (r.ok) { setOk(true); setStep('idle'); }
    else setErr(r.reason ?? 'Ошибка');
  };

  const enableWithSecret = () => {
    if (!secret.trim() || secret.length < 4) { setErr('Пин минимум 4 символа'); return; }
    enable2FA(me.id, method, secret);
    setOk(true); setStep('idle'); setSecret('');
  };

  const disable = () => { disable2FA(me.id); setOk(false); };

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="rounded-2xl p-4 flex items-center gap-4"
        style={{
          background: tfa?.enabled ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
          border:     `1px solid ${tfa?.enabled ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
        }}>
        <div className="grid h-11 w-11 place-items-center rounded-2xl shrink-0"
          style={{ background: tfa?.enabled ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)' }}>
          {tfa?.enabled ? <Lock size={18} style={{ color: 'var(--green)' }} /> : <Unlock size={18} style={{ color: 'var(--red)' }} />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>
            {tfa?.enabled ? '2FA включена' : '2FA отключена'}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>
            {tfa?.enabled ? `Метод: ${tfa.method === 'sms' ? 'SMS-код' : 'Email-код'} · Двойная защита активна` : 'Включите для дополнительной защиты'}
          </p>
        </div>
      </div>

      {/* Controls */}
      {!tfa?.enabled && step === 'idle' && (
        <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={startSetup}
          className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          <Shield size={15} /> Включить 2FA
        </motion.button>
      )}

      {tfa?.enabled && step === 'idle' && (
        <button type="button" onClick={disable}
          className="w-full flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold"
          style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: 'var(--red)' }}>
          <Unlock size={14} /> Отключить 2FA
        </button>
      )}

      {/* Setup */}
      <AnimatePresence>
        {step === 'setup' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-4 space-y-4"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>

            {/* Method */}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--t3)' }}>Метод</p>
              <div className="flex gap-2">
                {(['sms','email'] as const).map(m => (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all"
                    style={{
                      background: method === m ? 'var(--accent-bg)' : 'var(--bg-l3)',
                      border: `1px solid ${method === m ? 'rgba(79,110,247,0.3)' : 'var(--border)'}`,
                      color: method === m ? 'var(--accent)' : 'var(--t2)',
                    }}>
                    {m === 'sms' ? '📱 SMS-код' : '📧 Email-код'}
                  </button>
                ))}
              </div>
            </div>

            {/* Secret pin */}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--t3)' }}>Двухэтапный пароль (пин)</p>
              <div className="flex gap-2">
                <input
                  type={showSec ? 'text' : 'password'}
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Минимум 4 символа"
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }}
                />
                <button type="button" onClick={() => setShowSec(s => !s)}
                  className="grid h-10 w-10 place-items-center rounded-xl"
                  style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t3)' }}>
                  {showSec ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--t3)' }}>
                Этот пин будет запрашиваться при каждом входе
              </p>
            </div>

            {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}

            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep('idle'); setErr(''); }}
                className="rounded-xl px-4 py-2 text-xs font-semibold"
                style={{ background: 'var(--bg-l3)', color: 'var(--t2)', border: '1px solid var(--border)' }}>
                Отмена
              </button>
              <button type="button" onClick={enableWithSecret}
                className="flex-1 rounded-xl py-2 text-xs font-bold"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                Включить 2FA
              </button>
            </div>

            <div className="h-px" style={{ background: 'var(--border)' }} />

            <div>
              <p className="text-[11px] mb-2" style={{ color: 'var(--t3)' }}>
                Или отправить одноразовый код (демо):
              </p>
              <button type="button" onClick={sendCode}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold"
                style={{ background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t2)' }}>
                <Send size={12} /> Получить код
              </button>
            </div>
          </motion.div>
        )}

        {step === 'verify' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            {demoCode && (
              <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                <p className="text-[11px]" style={{ color: 'var(--amber)' }}>
                  🔔 Демо-режим: твой код <strong className="font-mono text-sm">{demoCode}</strong>
                </p>
              </div>
            )}
            <input value={otp} onChange={e => setOtp(e.target.value)} placeholder="Введи код"
              className="w-full rounded-xl px-4 py-2.5 text-sm font-mono outline-none text-center tracking-widest"
              style={{ background: 'var(--bg-l3)', border: '1px solid var(--border-m)', color: 'var(--t1)' }} />
            {err && <p className="text-xs" style={{ color: 'var(--red)' }}>{err}</p>}
            <button type="button" onClick={verify}
              className="w-full rounded-xl py-2.5 text-sm font-bold"
              style={{ background: 'var(--accent)', color: '#fff' }}>
              Подтвердить
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {ok && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: 'var(--green)' }}>
          <CheckCircle2 size={14} /> Изменения сохранены
        </motion.div>
      )}
    </div>
  );
};

/* ── Devices section ─────────────────────────────────────────── */
const DevicesSection = ({ me, onTerminate, onLogoutAll }: { me: any; onTerminate: (id: string) => void; onLogoutAll: () => void }) => {
  const devs: any[] = me.devices ?? [];
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
          Активные устройства · {devs.length}
        </p>
        <button type="button" onClick={() => setConfirm(true)}
          className="text-[11px] font-semibold flex items-center gap-1"
          style={{ color: 'var(--red)' }}>
          <LogOut size={11} /> Выйти везде
        </button>
      </div>

      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl p-3 flex items-center gap-3"
            style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.18)' }}>
            <p className="text-xs flex-1" style={{ color: 'var(--t1)' }}>Завершить все сессии?</p>
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
          <p className="text-sm" style={{ color: 'var(--t2)' }}>Нет активных устройств</p>
        </div>
      ) : devs.map((d, i) => (
        <motion.div key={d.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{
            background: d.isCurrent ? 'rgba(79,110,247,0.06)' : 'var(--bg-l2)',
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
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--t3)' }}>
              {d.ip} · {d.city}
            </p>
            <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--t3)' }}>
              <Clock size={9} /> Вход: {fmtDt(d.loginAt)}
            </p>
          </div>
          {!d.isCurrent && (
            <button type="button" onClick={() => onTerminate(d.id)}
              className="grid h-7 w-7 place-items-center rounded-xl hover:bg-red-500/10 transition-colors shrink-0"
              style={{ color: 'var(--t3)' }}>
              <Trash2 size={13} />
            </button>
          )}
        </motion.div>
      ))}
    </div>
  );
};

/* ── Change password ─────────────────────────────────────────── */
const PasswordSection = ({ userId }: { userId: string }) => {
  const { changePassword } = useAuthStore();
  const [oldPw,  setOld]  = useState('');
  const [newPw,  setNew]  = useState('');
  const [newPw2, setNew2] = useState('');
  const [show,   setShow] = useState(false);
  const [msg,    setMsg]  = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    if (newPw !== newPw2) { setMsg({ ok: false, text: 'Пароли не совпадают' }); return; }
    const r = changePassword(userId, oldPw, newPw);
    setMsg({ ok: r.ok, text: r.ok ? 'Пароль изменён ✓' : r.reason ?? 'Ошибка' });
    if (r.ok) { setOld(''); setNew(''); setNew2(''); }
  };

  const iSty = { background: 'var(--bg-l2)', border: '1px solid var(--border-m)', color: 'var(--t1)' };
  const iCls = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Смена пароля</p>

      {(['Текущий пароль', 'Новый пароль', 'Повторите новый'] as const).map((label, idx) => {
        const val  = idx === 0 ? oldPw  : idx === 1 ? newPw  : newPw2;
        const setV = idx === 0 ? setOld : idx === 1 ? setNew : setNew2;
        return (
          <div key={label} className="relative">
            <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--t2)' }}>{label}</p>
            <div className="flex gap-2">
              <input type={show ? 'text' : 'password'} value={val} onChange={e => setV(e.target.value)}
                placeholder="••••••••" className={iCls} style={iSty} />
              {idx === 0 && (
                <button type="button" onClick={() => setShow(s => !s)}
                  className="grid h-10 w-10 place-items-center rounded-2xl shrink-0"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t3)' }}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {msg && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="rounded-xl px-3 py-2 text-xs"
          style={{
            background: msg.ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)',
            border:     `1px solid ${msg.ok ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
            color:      msg.ok ? 'var(--green)' : 'var(--red)',
          }}>
          {msg.text}
        </motion.div>
      )}

      <motion.button whileTap={{ scale: 0.97 }} type="button" onClick={submit}
        className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold"
        style={{ background: 'var(--accent)', color: '#fff' }}>
        <Key size={14} /> Изменить пароль
      </motion.button>

      <p className="text-[11px] text-center" style={{ color: 'var(--t3)' }}>
        Демо-пароль: <span className="font-mono font-bold">0000</span>
      </p>
    </div>
  );
};

/* ── Security log ────────────────────────────────────────────── */
const SecurityLogSection = ({ me }: { me: any }) => {
  const log: any[] = me.securityLog ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>
        История безопасности · {log.length} событий
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
