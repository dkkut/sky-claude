/** Ключи доступа: кнопка входа на экране входа и управление ключами в Профиль → Sky ID. Сервер — server/passkeys.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { Key, Smartphone, Laptop, Tablet, Shield, Star, Heart, Zap, Globe, Home, Plus, Trash2, Snowflake, Loader2, Pencil } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { flash } from '@/shared/flash';
import {
  passkeysAvailable, inNativeShell, apiPasskeys, apiPasskeyUpdate, apiPasskeyFreeze, apiPasskeyDelete, createPasskey, passkeyReason,
  type PasskeyList, type PasskeyInfo,
} from './passkeyApi';

export const KEY_ICONS: Record<string, typeof Key> = { key: Key, phone: Smartphone, laptop: Laptop, tablet: Tablet, shield: Shield, star: Star, heart: Heart, bolt: Zap, globe: Globe, home: Home };
export const KeyIcon = ({ icon, size = 18 }: { icon: string; size?: number }) => { const I = KEY_ICONS[icon] ?? Key; return <I size={size} />; };

/** Кнопка на экране входа. В приложениях .apk/.exe ключ сайта не работает — там вход по QR. */
export function PasskeyLoginButton({ onError }: { onError: (t?: string) => void }) {
  const loginWithPasskey = useAuthStore((s) => s.loginWithPasskey);
  const [busy, setBusy] = useState(false);
  if (!passkeysAvailable()) return null;
  const go = async () => {
    if (busy) return; setBusy(true); onError(undefined);
    const r = await loginWithPasskey();
    if (!r.ok && r.reason) onError(r.reason);
    setBusy(false);
  };
  return (
    <button type="button" onClick={() => void go()} disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold"
      style={{ height: 46, background: 'var(--bg-l3)', color: 'var(--t1)', border: '1px solid var(--border)' }}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : <Key size={16} />}Войти с ключом доступа (Face ID)
    </button>
  );
}

type Ask = { title: string; run: (code: string) => Promise<{ ok: boolean; reason?: string }>; extra?: React.ReactNode };

export function PasskeySettings() {
  const [data, setData] = useState<PasskeyList | null>(null);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('phone');
  const [creating, setCreating] = useState(false);
  const [edit, setEdit] = useState<PasskeyInfo | null>(null);

  const load = useCallback(async () => {
    const r = await apiPasskeys();
    if (!r.ok || !r.data) { setErr(r.reason ?? 'Не удалось загрузить ключи'); return; }
    setErr(''); setData(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const confirm = async () => {
    if (!ask || busy) return; setBusy(true);
    const r = await ask.run(code.trim());
    setBusy(false);
    if (!r.ok) { flash(r.reason ?? 'Не удалось'); return; }
    setAsk(null); setCode(''); setCreating(false); void load();
  };
  const act = (a: Ask) => { setCode(''); setAsk(a); };

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <Key size={17} style={{ color: 'var(--accent)' }} />
        <p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Ключи доступа</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>
        Вход в Sky ID по Face ID, отпечатку или Windows Hello вместо кода на почту. Ключ создаётся в браузере и хранится на вашем устройстве.
        Создание, заморозка и удаление — с кодом аутентификатора, а после входа по ключу код аутентификатора спрашивается всегда.
      </p>
      {inNativeShell() && <p className="mt-2 text-[11px]" style={{ color: 'var(--amber)' }}>В приложении ключи доступа создаются и используются только в браузере. В приложении вход — по QR с телефона; Face ID для приложения включается в Настройках («Блокировка приложения»).</p>}
      {err && <p role="alert" className="mt-2 text-xs" style={{ color: '#ef4444' }}>{err}</p>}
      {!data && !err && <div className="grid place-items-center py-4"><Loader2 size={18} className="animate-spin" /></div>}
      {data && !data.twoFactorEnabled && <p className="mt-2 text-[11px]" style={{ color: 'var(--amber)' }}>Ключ доступа можно создать только после включения аутентификатора (Безопасность → Двухэтапная проверка).</p>}
      <div className="mt-3 space-y-2">
        {data?.keys.map((k) => (
          <div key={k.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-l1)', opacity: k.status === 'frozen' ? 0.7 : 1 }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'var(--accent-muted, rgba(79,140,255,0.15))', color: 'var(--accent)' }}><KeyIcon icon={k.icon} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{k.name}</p>
              <p className="text-[11px]" style={{ color: k.status === 'frozen' ? '#0ea5e9' : 'var(--t3)' }}>
                {k.status === 'frozen' ? 'Заморожен' : k.lastUsedAt ? `Использован ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Ещё не использовался'}
              </p>
            </div>
            <button type="button" aria-label="Изменить" onClick={() => setEdit(k)} className="grid h-9 w-9 place-items-center rounded-full" style={{ color: 'var(--t2)' }}><Pencil size={15} /></button>
            <button type="button" aria-label={k.status === 'frozen' ? 'Разморозить' : 'Заморозить'} onClick={() => act({ title: k.status === 'frozen' ? `Разморозить «${k.name}»` : `Заморозить «${k.name}»`, run: async (c) => { const r = await apiPasskeyFreeze(k.id, k.status !== 'frozen', c); return r.ok ? { ok: true } : { ok: false, reason: passkeyReason((r.data as any)?.error ?? r.reason) }; } })}
              className="grid h-9 w-9 place-items-center rounded-full" style={{ color: '#0ea5e9' }}><Snowflake size={15} /></button>
            <button type="button" aria-label="Удалить" onClick={() => act({ title: `Удалить «${k.name}»`, run: async (c) => { const r = await apiPasskeyDelete(k.id, c); return r.ok ? { ok: true } : { ok: false, reason: passkeyReason((r.data as any)?.error ?? r.reason) }; } })}
              className="grid h-9 w-9 place-items-center rounded-full" style={{ color: '#ef4444' }}><Trash2 size={15} /></button>
          </div>
        ))}
        {data && data.keys.length === 0 && <p className="py-2 text-center text-xs" style={{ color: 'var(--t3)' }}>Ключей пока нет</p>}
      </div>
      {data && passkeysAvailable() && data.twoFactorEnabled && data.keys.length < data.max && !creating && (
        <button type="button" onClick={() => { setCreating(true); setNewName(''); setNewIcon('phone'); setCode(''); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}><Plus size={16} />Создать ключ доступа</button>
      )}
      {creating && data && (
        <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l1)' }}>
          <input className="sky-input" placeholder="Название (например, «Мой iPhone»)" maxLength={40} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <div className="flex flex-wrap gap-2">{data.icons.map((ic) => (
            <button key={ic} type="button" aria-label={ic} aria-pressed={newIcon === ic} onClick={() => setNewIcon(ic)} className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: newIcon === ic ? 'var(--accent)' : 'var(--bg-l3)', color: newIcon === ic ? '#fff' : 'var(--t2)' }}><KeyIcon icon={ic} /></button>))}</div>
          <input className="sky-input" inputMode="numeric" autoComplete="one-time-code" placeholder="Код аутентификатора" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setCreating(false)} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
            <button type="button" disabled={busy || code.trim().length < 6} onClick={async () => { setBusy(true); const r = await createPasskey(code.trim(), newName.trim() || 'Ключ доступа', newIcon); setBusy(false); if (!r.ok) { flash(r.reason ?? 'Не удалось'); return; } flash('Ключ доступа создан'); setCreating(false); setCode(''); void load(); }}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: busy || code.trim().length < 6 ? 0.5 : 1 }}>{busy ? 'Создаём…' : 'Создать (Face ID)'}</button>
          </div>
        </div>
      )}
      {ask && (
        <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l1)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{ask.title}</p>
          <input className="sky-input" inputMode="numeric" autoComplete="one-time-code" autoFocus placeholder="Код аутентификатора" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setAsk(null)} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
            <button type="button" disabled={busy || code.trim().length < 6} onClick={() => void confirm()} className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff', opacity: busy || code.trim().length < 6 ? 0.5 : 1 }}>Подтвердить</button>
          </div>
        </div>
      )}
      {edit && data && (
        <div className="mt-3 space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l1)' }}>
          <input className="sky-input" maxLength={40} defaultValue={edit.name} id="pk-edit-name" />
          <div className="flex flex-wrap gap-2">{data.icons.map((ic) => (
            <button key={ic} type="button" aria-label={ic} aria-pressed={edit.icon === ic} onClick={() => setEdit({ ...edit, icon: ic })} className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: edit.icon === ic ? 'var(--accent)' : 'var(--bg-l3)', color: edit.icon === ic ? '#fff' : 'var(--t2)' }}><KeyIcon icon={ic} /></button>))}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEdit(null)} className="flex-1 rounded-xl py-2.5 text-sm" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }}>Отмена</button>
            <button type="button" onClick={async () => { const name = (document.getElementById('pk-edit-name') as HTMLInputElement)?.value ?? edit.name; const r = await apiPasskeyUpdate(edit.id, { name, icon: edit.icon }); if (!r.ok) { flash('Не удалось сохранить'); return; } setEdit(null); void load(); }}
              className="flex-1 rounded-xl py-2.5 text-sm font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>Сохранить</button>
          </div>
        </div>
      )}
    </div>
  );
}
