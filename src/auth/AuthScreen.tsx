import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/core/auth/store';


const avatarGrad = (n: string) => { const h = [...n].reduce((a,c)=>a+c.charCodeAt(0),0)%360; return `linear-gradient(135deg,hsl(${h},65%,42%),hsl(${(h+40)%360},70%,36%))`; };

export const AuthScreen = () => {
  const { accounts, login, register } = useAuthStore();
  const [mode, setMode] = useState<'pick' | 'login' | 'register'>(
    accounts.length ? 'pick' : 'register'
  );
  const [name, setName] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err,  setErr]  = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setErr(''); setBusy(true);
    await new Promise(r => setTimeout(r, 180));
    if (mode === 'login') {
      const res = await login(user.trim(), pass);
      if (!res.ok) setErr(res.reason ?? 'Неверный логин или пароль');
    } else {
      if (!name.trim() || !user.trim() || !pass) {
        setErr('Заполни все поля'); setBusy(false); return;
      }
      const res = await register(name.trim(), user.trim().toLowerCase(), pass);
      if (!res.ok) setErr(res.reason ?? 'Не удалось зарегистрироваться');
    }
    setBusy(false);
  };

  const pickAccount = (username: string) => {
    setUser(username);
    // Пароль больше не подставляем: он проверяется на сервере и
    // в браузере не хранится.
    setPass('');
    setMode('login');
  };

  return (
    <div className="flex h-screen items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, rgba(79,110,247,0.08) 0%, var(--bg) 70%)', height: '100dvh' }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="w-full max-w-sm"
        style={{ position: "relative" }}
      >
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center"
            style={{ filter: 'drop-shadow(0 0 12px rgba(79,110,247,0.6)) drop-shadow(0 0 6px rgba(196,80,247,0.4))' }}>
            <img src={'/logo.png'} alt="Sky" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--t1)' }}>Sky</h1>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] mt-1" style={{ color: 'var(--accent)' }}>ECOSYSTEM</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--t2)' }}>
            {mode === 'pick' ? 'Выбери аккаунт' : mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}
          </p>
        </div>

        <AnimatePresence mode="wait">

          {/* -- Account picker -- */}
          {mode === 'pick' && (
            <motion.div key="pick"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="space-y-2">
              {accounts.map(acc => (
                <motion.button key={acc.id} type="button" whileTap={{ scale: 0.98 }}
                  onClick={() => pickAccount(acc.username)}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                  style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: avatarGrad(acc.name) }}>
                    {acc.name.split(' ').map((w:string)=>w[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--t1)' }}>{acc.name}</p>
                    <p className="text-xs" style={{ color: 'var(--t3)' }}>@{acc.username}</p>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--t3)' }}>›</span>
                </motion.button>
              ))}
              <button type="button" onClick={() => { setUser(''); setPass(''); setMode('register'); }}
                className="w-full rounded-xl px-4 py-3 text-sm transition-colors"
                style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--t2)' }}>
                + Новый аккаунт
              </button>

            </motion.div>
          )}

          {/* -- Login -- */}
          {mode === 'login' && (
            <motion.div key="login"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="space-y-3">
              <input className="sky-input" placeholder="Имя пользователя"
                value={user} onChange={e => setUser(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && go()} autoFocus />
              <input className="sky-input" type="password" placeholder="Пароль"
                value={pass} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && go()} />
              {err && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-xs" style={{ color: 'var(--red)' }}>{err}</motion.p>
              )}
              <button className="sky-btn-primary w-full" onClick={go} disabled={busy}>
                {busy ? '...' : 'Войти'}
              </button>
              {accounts.length > 0 && (
                <button type="button" onClick={() => setMode('pick')}
                  className="w-full text-center text-sm" style={{ color: 'var(--t3)' }}>
                  ← Выбрать аккаунт
                </button>
              )}
              <button type="button" onClick={() => { setMode('register'); setPass(''); }}
                className="w-full text-center text-sm" style={{ color: 'var(--accent)' }}>
                Нет аккаунта? Создать
              </button>
            </motion.div>
          )}

          {/* -- Register -- */}
          {mode === 'register' && (
            <motion.div key="reg"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="space-y-3">
              <input className="sky-input" placeholder="Имя"
                value={name} onChange={e => setName(e.target.value)} autoFocus />
              <input className="sky-input" placeholder="Имя пользователя (a-z, 0-9, _)"
                value={user} onChange={e => setUser(e.target.value)} />
              <input className="sky-input" type="password" placeholder="Пароль"
                value={pass} onChange={e => setPass(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && go()} />
              {err && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-xs" style={{ color: 'var(--red)' }}>{err}</motion.p>
              )}
              <button className="sky-btn-primary w-full" onClick={go} disabled={busy}>
                {busy ? '...' : 'Зарегистрироваться'}
              </button>
              {accounts.length > 0 && (
                <button type="button" onClick={() => setMode('pick')}
                  className="w-full text-center text-sm" style={{ color: 'var(--t3)' }}>
                  ← Уже есть аккаунт
                </button>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </motion.div>
    </div>
  );
};
