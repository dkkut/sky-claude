/**
 * «Обновления» — окно со скачиванием приложений. Данные те же, что на сайте: админка «Сайт» → «Скачивание»
 * (версия, описание, статус, внешняя ссылка или загруженный файл), публичный ответ `GET /api/site/public`.
 * Отдельного списка нет: поменяли в админке — поменялось и здесь, и на сайте.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, X, RefreshCw, Clock } from 'lucide-react';
import { APP_VERSION_LABEL } from '../core/version';
import { API_ORIGIN } from '../core/nativeApp';

interface Item { platform: string; title: string; info: string; version: string; button: string; status: string; href: string; file: { name: string; size: number; sha256: string } | null }

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`);
const absolute = (href: string) => (href.startsWith('/') ? `${API_ORIGIN || window.location.origin}${href}` : href);

export function UpdatesDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await fetch(`${API_ORIGIN}/api/site/public`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setItems(Array.isArray(d.downloads) ? d.downloads : []);
    } catch (e) {
      setItems(null);
      setErr(e instanceof Error && e.message ? e.message : 'network');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Обновления" className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <div>
            <p className="text-base font-bold">Обновления</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>Ваша версия: <span translate="no">{APP_VERSION_LABEL}</span></p>
          </div>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.06))' }}><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-5 pb-5 pt-2">
          {!items && !err && <div role="status" className="grid place-items-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
          {err && (
            <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm font-semibold">Не удалось загрузить список</p>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>Проверьте соединение. Код: {err}</p>
              <button type="button" onClick={() => void load()} className="mt-1 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold" style={{ background: 'var(--t1)', color: 'var(--bg-l1, #fff)' }}><RefreshCw size={13} />Повторить</button>
            </div>
          )}
          {items && items.length === 0 && <p className="py-8 text-center text-sm" style={{ color: 'var(--t3)' }}>Пока нет доступных приложений.</p>}
          {items?.map((it) => {
            const ready = it.status === 'available' && Boolean(it.href);
            return (
              <div key={it.platform} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.05))' }}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" translate="no">{it.title}{it.version ? ` · ${it.version}` : ''}</p>
                  {it.info && <p className="text-xs" style={{ color: 'var(--t3)' }} translate="no">{it.info}</p>}
                  {it.file && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--t3)' }}><span translate="no">{it.file.name}</span> · {mb(it.file.size)}</p>}
                </div>
                {ready ? (
                  <a href={absolute(it.href)} target="_blank" rel="noopener noreferrer" className="flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-bold" style={{ background: 'var(--t1)', color: 'var(--bg-l1, #fff)', minHeight: 44 }}>
                    <Download size={14} />Скачать
                  </a>
                ) : (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold" style={{ color: 'var(--t3)' }}><Clock size={13} />Скоро</span>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[11px]" style={{ color: 'var(--t3)' }}>Новая версия ставится поверх прежней: данные аккаунта остаются на сервере.</p>
        </div>
      </div>
    </div>
  );
}
