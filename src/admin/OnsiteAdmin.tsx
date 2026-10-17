/** Админка: жалобы на объявления Market «На месте» (право market_moderation). Решение — только с причиной; снятие уведомляет продавца и покупателей. */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

const C = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)', red: 'var(--red)' };
const box = { background: C.l1, border: `1px solid ${C.brd}`, borderRadius: 14, padding: 12 } as const;
const inp = { background: C.l2, border: `1px solid ${C.brd}`, color: C.t1, borderRadius: 10, padding: '7px 10px', fontSize: 13 } as const;
const btn = (bg: string = C.acc, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }) as const;
const REASON: Record<string, string> = { forbidden: 'Запрещённый товар', fraud: 'Похоже на обман', wrong_info: 'Неверное описание', spam: 'Спам', other: 'Другое' };

export const OnsiteAdmin = () => {
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<any[] | null>(null);
  const [sel, setSel] = useState<string | null>(null); const [note, setNote] = useState('');
  const load = useCallback(async () => { const r = await apiCall<{ items: any[] }>(`/api/admin/onsite/reports?status=${status}`); if (r.ok) setItems(r.data!.items); else { setItems([]); flash('Не удалось загрузить жалобы'); } }, [status]);
  useEffect(() => { void load(); }, [load]);
  const decide = async (id: string, action: 'remove' | 'dismiss') => {
    const r = await apiCall(`/api/admin/onsite/reports/${id}/decide`, { method: 'POST', body: JSON.stringify({ action, note }) });
    if (!r.ok) return flash(r.error === 'note_required' ? 'Укажите причину (от 5 знаков).' : r.error === 'self_review' ? 'Своё объявление решать нельзя.' : 'Не получилось.');
    flash('Решение принято'); setSel(null); setNote(''); void load();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ ...box, fontSize: 13, color: C.t2 }}>Жалобы на объявления «На месте». Sky не принимает деньги за вещи и не проверяет их: модерация снимает запрещённые и недостоверные объявления, отменяя связанные встречи.</div>
      <select aria-label="Статус" style={inp} value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Открытые</option><option value="removed">Снято</option><option value="dismissed">Отклонено</option></select>
      {items === null ? <div style={{ color: C.t3 }}>Загрузка…</div> : items.length === 0 ? <div style={{ color: C.t3 }}>Жалоб нет.</div> : items.map((x) => (
        <div key={x.id} style={box}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b translate="no" style={{ color: C.t1 }}>{x.title}</b><span style={{ fontSize: 12.5, color: C.t2 }}>{REASON[x.reason] ?? x.reason}</span></div>
          <div translate="no" style={{ fontSize: 12.5, color: C.t2 }}>Продавец @{x.seller} · жаловался @{x.reporter} · всего жалоб на объявление: {x.total}</div>
          {x.text && <div translate="no" style={{ fontSize: 13, color: C.t1, margin: '4px 0' }}>{x.text}</div>}
          {x.note && <div translate="no" style={{ fontSize: 12.5, color: C.t3 }}>Решение: {x.note}</div>}
          {x.status === 'open' && (sel === x.id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <textarea style={inp} rows={2} placeholder="Обоснование решения (от 5 знаков)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 8 }}><button type="button" style={btn(C.red)} onClick={() => decide(x.id, 'remove')}>Снять объявление</button><button type="button" style={btn(C.l2, C.t1)} onClick={() => decide(x.id, 'dismiss')}>Отклонить жалобу</button><button type="button" style={btn(C.l2, C.t1)} onClick={() => setSel(null)}>Отмена</button></div>
            </div>) : <button type="button" style={{ ...btn(), marginTop: 8 }} onClick={() => { setSel(x.id); setNote(''); }}>Решить</button>)}
        </div>))}
    </div>
  );
};
