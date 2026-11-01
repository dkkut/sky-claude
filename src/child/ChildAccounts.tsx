/** Детские профили внутри Sky ID: создание, что закрыто, PIN опекуна. Ограничения проверяет сервер (server/childaccount.mjs). */
import { useCallback, useEffect, useState } from 'react';
import { Baby, Plus, Trash2 } from 'lucide-react';
import { apiChildList, apiChildCreate, apiChildUpdate, apiChildRemove, apiChildMe, type ChildView } from '@/core/auth/api';
import { useAuthStore } from '@/core/auth/store';

const LABELS: Record<string, string> = {
  market: 'Sky Market', pvz: 'Пункты выдачи', garant: 'Sky Garant', go: 'Sky GO и парковки', kbiz: 'Sky для бизнеса', tickets: 'Билеты',
  blox: 'Sky Blox', ads: 'Реклама', nftgifts: 'Подарки', bots: 'Боты', partners: 'Партнёры', friendsmap: 'Карта друзей и Safety',
  launcher: 'Лаунчер', campaigns: 'Кампании', prime: 'Sky Prime', ai: 'Sky AI', gaming: 'Игры', bloom: 'Bloom',
};
const card = { background: 'var(--bg-l1)', border: '1px solid var(--border)' } as const;
const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
const inpStyle = { background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' } as const;

export const ChildAccounts = () => {
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const [isChild, setIsChild] = useState(false);
  const [data, setData] = useState<{ modules: string[]; defaults: string[]; children: ChildView[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', username: '', birthYear: '', pin: '' });

  const load = useCallback(async () => {
    const me = await apiChildMe();
    if (me.ok && me.data?.child) { setIsChild(true); return; }
    setIsChild(false);
    const r = await apiChildList();
    if (r.ok && r.data) setData(r.data); else setErr(r.reason ?? 'Не удалось загрузить');
  }, []);
  useEffect(() => { void load(); }, [load, currentUserId]);

  if (isChild) {
    return <div className="rounded-2xl p-4" style={card}><div className="flex items-center gap-2"><Baby size={15} style={{ color: 'var(--accent)' }} /><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Детский профиль</p></div>
      <p className="mt-1 text-xs" style={{ color: 'var(--t2)' }}>Настройки этого профиля меняет опекун из взрослого профиля. Чтобы выйти из детского профиля, нужен PIN опекуна.</p></div>;
  }
  if (!data) return null;

  const create = async () => {
    setBusy(true); setErr('');
    const r = await apiChildCreate({ name: f.name, username: f.username.replace(/^@/, '').toLowerCase(), birthYear: f.birthYear ? Number(f.birthYear) : undefined, pin: f.pin });
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось создать'); return; }
    setOpen(false); setF({ name: '', username: '', birthYear: '', pin: '' }); void load();
  };
  const save = async (c: ChildView, patch: Partial<ChildView['settings']>) => {
    const s = { ...c.settings, ...patch };
    setData((d) => d && { ...d, children: d.children.map((x) => (x.profileId === c.profileId ? { ...x, settings: s } : x)) });
    const r = await apiChildUpdate(c.profileId, s);
    if (!r.ok) { setErr(r.reason ?? 'Не удалось сохранить'); void load(); }
  };
  const changePin = async (c: ChildView) => {
    const pin = window.prompt('Новый PIN опекуна (4–8 цифр)'); if (!pin) return;
    const r = await apiChildUpdate(c.profileId, { pin });
    setErr(r.ok ? '' : (r.reason ?? 'Не удалось сменить PIN'));
  };
  const remove = async (c: ChildView) => {
    if (!window.confirm('Снять детский режим с этого профиля? Профиль и его данные останутся.')) return;
    const r = await apiChildRemove(c.profileId);
    if (!r.ok) setErr(r.reason ?? 'Не удалось снять'); else void load();
  };

  return (
    <div className="rounded-2xl p-4" style={card} data-child-accounts>
      <div className="mb-1 flex items-center gap-2"><Baby size={15} style={{ color: 'var(--accent)' }} /><p className="text-sm font-bold" style={{ color: 'var(--t1)' }}>Детский аккаунт</p></div>
      <p className="mb-3 text-xs" style={{ color: 'var(--t2)' }}>Отдельный профиль ребёнка в вашем Sky ID. Закрытые вами разделы и деньги недоступны ему на сервере, а выйти из детского профиля можно только с PIN опекуна. Переписку Sky не просматривает.</p>
      {err && <p className="mb-2 text-xs" style={{ color: 'var(--red)' }} role="alert">{err}</p>}
      {data.children.map((c) => (
        <div key={c.profileId} className="mb-3 rounded-xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-semibold" style={{ color: 'var(--t1)' }} translate="no">{c.name} · @{c.username}</p>
            <button type="button" onClick={() => void remove(c)} aria-label="Снять детский режим" className="shrink-0 p-1" style={{ color: 'var(--red)' }}><Trash2 size={15} /></button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--t1)' }}>
            <input type="checkbox" checked={c.settings.money} onChange={(e) => void save(c, { money: e.target.checked })} />Разрешить кошелёк и пополнения
          </label>
          <p className="mb-1 mt-2 text-xs font-semibold" style={{ color: 'var(--t2)' }}>Закрыто для ребёнка</p>
          <div className="grid grid-cols-2 gap-1">
            {data.modules.map((m) => (
              <label key={m} className="flex items-center gap-2 text-xs" style={{ color: 'var(--t1)' }}>
                <input type="checkbox" checked={c.settings.modules.includes(m)}
                  onChange={(e) => void save(c, { modules: e.target.checked ? [...c.settings.modules, m] : c.settings.modules.filter((x) => x !== m) })} />{LABELS[m] ?? m}
              </label>
            ))}
          </div>
          <button type="button" onClick={() => void changePin(c)} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>Сменить PIN опекуна</button>
        </div>
      ))}
      {open ? (
        <div className="space-y-2">
          <input className={inp} style={inpStyle} placeholder="Имя ребёнка" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input className={inp} style={inpStyle} placeholder="Ник (латиницей)" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="off" />
          <input className={inp} style={inpStyle} placeholder="Год рождения (необязательно)" inputMode="numeric" value={f.birthYear} onChange={(e) => setF({ ...f, birthYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          <input className={inp} style={inpStyle} placeholder="PIN опекуна, 4–8 цифр" inputMode="numeric" type="password" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || f.name.trim().length < 2 || f.username.length < 3 || f.pin.length < 4} onClick={() => void create()}
              className="rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Создать</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-sm" style={{ color: 'var(--t2)' }}>Отмена</button>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>В Sky ID не больше двух профилей: если второй уже занят, освободите место или превратите его в детский.</p>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}><Plus size={14} />Добавить ребёнка</button>
      )}
    </div>
  );
};
