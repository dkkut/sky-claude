/** Админка → «Обновления»: версия для проверки обновлений в приложениях, тексты уведомления, магазины, обязательность и минимальная сборка (server/appupdate.mjs). */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t3: 'var(--t3)', acc: 'var(--accent)' };
const field = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1 };
const inp = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
interface S { latestVersion: string; latestBuild: number; minBuild: number; mandatory: boolean; messageRu: string; messageEn: string; forcedRu: string; forcedEn: string; stores: Record<string, string> }
interface Cat { id: string; label: string; platform: string; hosts: string[] }
const ERR: Record<string, string> = {
  not_allowed: 'Недостаточно прав.', owner_only: 'Обязательное обновление и минимальную сборку меняет только владелец.', code_required: 'Нужен код подтверждения.',
  min_above_latest: 'Минимальная сборка не может быть выше последней.', latest_required: 'Сначала укажите последнюю сборку.', text_required: 'Текст слишком короткий.',
  bad_store_url: 'Ссылка не подходит: нужен https-адрес именно этого магазина.', unsupported_store: 'Такой магазин не поддерживается.',
};

export const AppVersionCard = () => {
  const [s, setS] = useState<S | null>(null); const [cat, setCat] = useState<Cat[]>([]); const [canForce, setCanForce] = useState(false);
  const [busy, setBusy] = useState(false); const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const load = useCallback(async () => {
    const r = await apiCall<{ settings: S; storeCatalog: Cat[]; canForce: boolean }>('/api/admin/app-update');
    if (r.ok && r.data) { setS(r.data.settings); setCat(r.data.storeCatalog); setCanForce(r.data.canForce); } else flash(ERR[r.error ?? ''] ?? 'Не получилось');
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return null;
  const set = <K extends keyof S>(k: K, v: S[K]) => setS({ ...s, [k]: v });
  const save = async () => {
    setBusy(true);
    const r = await apiCall<{ settings: S }>('/api/admin/app-update', { method: 'PUT', body: JSON.stringify({ ...s, stepUpCode: code || undefined }) });
    setBusy(false);
    if (r.ok && r.data) { setS(r.data.settings); setCode(''); setSent(false); flash('Сохранено'); } else flash(ERR[r.error ?? ''] ?? r.reason ?? 'Не получилось');
  };
  const askCode = async () => { const r = await apiCall('/api/admin/app-update/step-up', { method: 'POST', body: '{}' }); setSent(r.ok); flash(r.ok ? 'Введите код из приложения-аутентификатора' : ERR[r.error ?? ''] ?? 'Не получилось'); };
  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <h3 className="text-sm font-bold" style={{ color: C.t1 }}>Проверка новых версий</h3>
      <p className="text-[11px]" style={{ color: C.t3 }}>Приложения (Android, iOS, Windows) спрашивают сервер, нет ли версии новее установленной. Ссылки на магазины показываются только для подходящей платформы; в браузере проверки нет.</p>
      <div className="grid grid-cols-2 gap-2">
        <input className={inp} style={field} value={s.latestVersion} maxLength={40} placeholder="Последняя версия, 5.1.3" onChange={(e) => set('latestVersion', e.target.value)} />
        <input className={inp} style={field} type="number" min={0} value={s.latestBuild} placeholder="Последняя сборка" onChange={(e) => set('latestBuild', Number(e.target.value) || 0)} />
      </div>
      <textarea className={inp} style={field} rows={2} maxLength={300} value={s.messageRu} onChange={(e) => set('messageRu', e.target.value)} />
      <textarea className={inp} style={field} rows={2} maxLength={300} value={s.messageEn} onChange={(e) => set('messageEn', e.target.value)} />
      <textarea className={inp} style={field} rows={2} maxLength={300} value={s.forcedRu} onChange={(e) => set('forcedRu', e.target.value)} />
      <textarea className={inp} style={field} rows={2} maxLength={300} value={s.forcedEn} onChange={(e) => set('forcedEn', e.target.value)} />
      <p className="text-[11px]" style={{ color: C.t3 }}>Тексты: уведомление (рус., англ.), затем обязательное обновление (рус., англ.).</p>
      <div className="space-y-1">
        {cat.map((c) => (
          <input key={c.id} className={inp} style={field} value={s.stores[c.id] ?? ''} placeholder={`${c.label} — ${c.platform}, https://${c.hosts[0]}/…`} onChange={(e) => set('stores', { ...s.stores, [c.id]: e.target.value })} />
        ))}
      </div>
      <div className="space-y-2 rounded-xl p-3" style={{ background: C.l2 }}>
        <p className="text-[12px] font-semibold" style={{ color: C.t1 }}>Обязательное обновление</p>
        <label className="flex items-center gap-2 text-[12px]" style={{ color: C.t1 }}>
          <input type="checkbox" checked={s.mandatory} disabled={!canForce} onChange={(e) => set('mandatory', e.target.checked)} />Обновление обязательно: пока не обновятся — экран закрыт
        </label>
        <input className={inp} style={field} type="number" min={0} disabled={!canForce} value={s.minBuild} placeholder="Минимальная поддерживаемая сборка (0 — без ограничения)" onChange={(e) => set('minBuild', Number(e.target.value) || 0)} />
        <p className="text-[11px]" style={{ color: C.t3 }}>Приложения ниже минимальной сборки перестанут работать, пока не обновятся. Меняет только владелец, с кодом подтверждения. Сначала выложите новую сборку.</p>
        {canForce && (sent
          ? <input className={inp} style={field} value={code} inputMode="numeric" maxLength={8} placeholder="Код подтверждения" onChange={(e) => setCode(e.target.value)} />
          : <button type="button" className="w-full rounded-xl py-2 text-xs font-semibold" style={{ background: C.l1, color: C.t1 }} onClick={() => void askCode()}>Запросить код подтверждения</button>)}
      </div>
      <button type="button" disabled={busy} className="w-full rounded-xl py-2.5 text-sm font-bold text-white disabled:opacity-40" style={{ background: C.acc }} onClick={() => void save()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
    </div>
  );
};
