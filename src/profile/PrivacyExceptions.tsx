/** Исключения из конфиденциальности по людям: для конкретного человека можно разрешить или запретить писать, звонить, видеть «в сети», подарки и музыку. Решает сервер. */
import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiCall, apiSearchPeople, type DirectoryPerson } from '@/core/auth/api';
import { flash } from '@/shared/flash';

type Scope = 'write' | 'call' | 'online' | 'gifts' | 'music';
interface Item { otherId: string; username: string; name: string; scope: Scope; mode: 'allow' | 'deny' }
const SCOPES: { k: Scope; label: string }[] = [
  { k: 'write', label: 'Писать мне' }, { k: 'call', label: 'Звонить мне' }, { k: 'online', label: 'Видеть, что я в сети' },
  { k: 'gifts', label: 'Видеть мои подарки' }, { k: 'music', label: 'Видеть мою музыку' },
];
const ERR: Record<string, string> = { user_not_found: 'Человек не найден.', self: 'Нельзя добавить себя.', too_many: 'Слишком много исключений (до 300).' };

export const PrivacyExceptions = () => {
  const [items, setItems] = useState<Item[]>([]); const [q, setQ] = useState(''); const [found, setFound] = useState<DirectoryPerson[]>([]);
  const [pick, setPick] = useState<DirectoryPerson | null>(null); const [scope, setScope] = useState<Scope>('write'); const [mode, setMode] = useState<'allow' | 'deny'>('deny');
  const load = useCallback(async () => { const r = await apiCall<{ items: Item[] }>('/api/privacy/exceptions'); if (r.ok) setItems(r.data!.items); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => { void apiSearchPeople(q.trim()).then((r) => setFound(r.ok ? (r.data?.people ?? []).slice(0, 6) : [])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const put = async (otherId: string, sc: Scope, md: string) => {
    const r = await apiCall('/api/privacy/exceptions', { method: 'PUT', body: JSON.stringify({ otherId, scope: sc, mode: md }) });
    if (!r.ok) return flash(ERR[r.error ?? ''] ?? 'Не получилось сохранить.');
    void load();
  };
  const add = async () => { if (!pick) return; await put(pick.id, scope, mode); setPick(null); setQ(''); setFound([]); };
  const sel = 'rounded-lg px-2 py-1.5 text-xs outline-none';
  const st = { background: 'var(--bg-l3)', border: '1px solid var(--border)', color: 'var(--t1)' } as const;
  return (
    <div className="mt-4 space-y-2 rounded-xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
      <h4 className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Исключения для людей</h4>
      <p className="text-xs" style={{ color: 'var(--t3)' }}>Для отдельного человека можно сделать иначе, чем в общих настройках: «Запретить» перекрывает «Все», «Разрешить» перекрывает «Никто» и «Контакты».</p>
      {items.map((i) => (
        <div key={i.otherId + i.scope} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--bg-l3)' }}>
          <p className="min-w-0 flex-1 text-[12.5px]" style={{ color: 'var(--t1)' }}><span translate="no">{i.name || i.username} @{i.username}</span> — <b style={{ color: i.mode === 'deny' ? 'var(--red)' : 'var(--accent)' }}>{i.mode === 'deny' ? 'запретить' : 'разрешить'}</b>: {SCOPES.find((s) => s.k === i.scope)?.label}</p>
          <button type="button" aria-label="Убрать исключение" onClick={() => void put(i.otherId, i.scope, 'none')} className="grid h-7 w-7 place-items-center rounded-lg"><Trash2 size={13} style={{ color: 'var(--t3)' }} /></button>
        </div>))}
      {!items.length && <p className="text-xs" style={{ color: 'var(--t3)' }}>Исключений нет.</p>}
      <div className="space-y-2 pt-1">
        <input value={pick ? `@${pick.username}` : q} onChange={(e) => { setPick(null); setQ(e.target.value); }} placeholder="Найти человека по имени или @нику" className={sel + ' w-full'} style={st} translate="no" />
        {!pick && found.map((p) => (
          <button key={p.id} type="button" onClick={() => setPick(p)} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px]" style={{ background: 'var(--bg-l3)', color: 'var(--t1)' }} translate="no">{p.name} @{p.username}</button>))}
        <div className="flex flex-wrap gap-2">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'allow' | 'deny')} className={sel} style={st}><option value="deny">Запретить</option><option value="allow">Разрешить</option></select>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className={sel} style={st}>{SCOPES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select>
          <button type="button" disabled={!pick} onClick={() => void add()} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>Добавить</button>
        </div>
      </div>
    </div>
  );
};
