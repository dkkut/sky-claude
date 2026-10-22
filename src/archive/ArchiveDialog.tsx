/** «Архив материалов»: удалённое своё (музыка, кино, книги, видео) хранится 20 дней — можно вернуть. Сервер — server/contentarchive.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { tr, trf } from '@/i18n';
import { requestDelete } from '@/island/deleteFlow';

interface Item { id: string; kind: 'track' | 'movie' | 'book' | 'video'; title: string; daysLeft: number }
const NOUN: Record<Item['kind'], string> = { track: 'Трек', movie: 'Фильм', book: 'Книга', video: 'Видео' };

export function ArchiveDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [days, setDays] = useState(20);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const r = await apiCall<{ days: number; items: Item[] }>('/api/archive');
    if (!r.ok || !r.data) { setErr(r.reason ?? 'Не удалось загрузить'); return; }
    setItems(r.data.items); setDays(r.data.days);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const restore = async (it: Item) => {
    const r = await apiCall(`/api/archive/${encodeURIComponent(it.id)}/restore`, { method: 'POST', body: '{}' });
    if (!r.ok) { flash('Не удалось вернуть. Попробуйте ещё раз.'); return; }
    flash('Возвращено в вашу коллекцию'); void load();
  };
  const purge = (it: Item) => requestDelete({
    id: `arc-${it.id}`, title: it.title, noun: NOUN[it.kind].toLowerCase(),
    run: async () => { const r = await apiCall(`/api/archive/${encodeURIComponent(it.id)}/purge`, { method: 'POST', body: '{}' }); if (!r.ok) throw new Error('Не удалось удалить'); },
    done: () => void load(),
  });

  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Архив материалов" className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="text-base font-bold">Архив материалов</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.06))' }}><X size={18} /></button>
        </div>
        <div className="space-y-2 overflow-y-auto px-5 pb-5 pt-1">
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>{trf('Удалённые материалы хранятся {0} дн., затем стираются окончательно. За 2 дня до этого придёт уведомление.', days)}</p>
          {!items && !err && <div role="status" className="grid place-items-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
          {err && <div role="alert" className="py-6 text-center text-sm"><p className="font-semibold">{err}</p><button type="button" onClick={() => void load()} className="mt-2 rounded-full px-4 py-2 text-sm font-semibold" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.06))' }}>Повторить</button></div>}
          {items && items.length === 0 && <p className="py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>Архив пуст</p>}
          {items?.map((it) => (
            <div key={it.id} className="flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.05))' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" translate="no">{it.title || '—'}</p>
                <p className="text-[11px]" style={{ color: it.daysLeft <= 2 ? '#ef4444' : 'var(--t3)' }}>{trf('{0} · осталось дн.: {1}', tr(NOUN[it.kind]), it.daysLeft)}</p>
              </div>
              <button type="button" aria-label="Вернуть" title="Вернуть" onClick={() => void restore(it)} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(52,211,153,0.18)', color: '#10b981' }}><RotateCcw size={16} /></button>
              <button type="button" aria-label="Удалить сейчас" title="Удалить сейчас" onClick={() => purge(it)} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
