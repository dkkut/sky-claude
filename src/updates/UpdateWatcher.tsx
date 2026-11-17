/**
 * Проверка новых версий Sky. Только в родных приложениях (Android / iOS / Windows): браузер всегда открывает свежую версию сайта.
 * Что установлено (APP_BUILD) и какая платформа — определяет клиент, решение «есть ли обновление, обязательное ли оно, какой текст,
 * какие магазины» принимает сервер (/api/site/app-version). Ссылки только на те магазины, которые сервер вернул для этой платформы.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { APP_BUILD } from '../core/version';
import { NATIVE_APP, API_ORIGIN, isElectron } from '../core/nativeApp';
import { UpdatesDialog } from './UpdatesDialog';

interface Store { id: string; label: string; url: string }
interface Check { platform: string; updateAvailable: boolean; supported: boolean; mandatory: boolean; message: string; latestVersion?: string; latestBuild?: number; stores: Store[]; updatesPage: boolean }

export const detectPlatform = (): 'android' | 'ios' | 'windows' | 'web' => {
  if (!NATIVE_APP) return 'web';
  if (isElectron()) return 'windows';
  const p = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'web';
};

const KEY = 'sky:update-dismissed';
const EVERY = 6 * 3600 * 1000;

export function UpdateWatcher() {
  const [info, setInfo] = useState<Check | null>(null);
  const [hidden, setHidden] = useState(false);
  const [page, setPage] = useState(false);

  const load = useCallback(async () => {
    const platform = detectPlatform();
    if (platform === 'web') return;
    try {
      const lang = document.documentElement.lang?.startsWith('en') ? 'en' : 'ru';
      const r = await fetch(`${API_ORIGIN}/api/site/app-version?platform=${platform}&build=${APP_BUILD}&lang=${lang}`, { cache: 'no-store' });
      if (!r.ok) return;
      const d = (await r.json()) as Check;
      setInfo(d);
      setHidden(!d.mandatory && localStorage.getItem(KEY) === String(d.latestBuild ?? ''));
    } catch { /* без связи — без уведомления */ }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, EVERY);
    const v = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', v);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [load]);

  if (!info || (!info.updateAvailable && info.supported)) return null;
  const dismiss = () => { localStorage.setItem(KEY, String(info.latestBuild ?? '')); setHidden(true); };

  const actions = (
    <div className="mt-2 flex flex-wrap gap-2">
      {info.stores.map((s) => (
        <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>
          <ExternalLink size={12} /><span translate="no">{s.label}</span>
        </a>
      ))}
      {info.updatesPage && (
        <button type="button" onClick={() => setPage(true)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'var(--bg-l3, rgba(127,127,127,0.18))', color: 'var(--t1)' }}>
          <Download size={12} />Обновления
        </button>
      )}
    </div>
  );

  if (info.mandatory) {
    return (
      <div className="fixed inset-0 z-[100004] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.85)' }} role="alertdialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-[24px] p-5" style={{ background: 'var(--bg-l1, #111)', color: 'var(--t1, #fff)' }}>
          <p className="text-base font-bold">Требуется обновление</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--t2)' }} translate="no">{info.message}</p>
          {actions}
        </div>
        {page && <UpdatesDialog onClose={() => setPage(false)} />}
      </div>
    );
  }
  if (hidden) return page ? <UpdatesDialog onClose={() => setPage(false)} /> : null;
  return (
    <>
      <div className="fixed left-3 right-3 z-[10040] rounded-2xl p-3 shadow-xl" style={{ top: 'calc(env(safe-area-inset-top) + 8px)', background: 'var(--bg-l2, #1c1c1e)', color: 'var(--t1, #fff)', border: '1px solid var(--border, rgba(255,255,255,0.1))' }} role="status">
        <button type="button" onClick={dismiss} aria-label="Закрыть" className="absolute right-2 top-2 p-1" style={{ color: 'var(--t3)' }}><X size={14} /></button>
        <p className="pr-6 text-sm" translate="no">{info.message}</p>
        {actions}
      </div>
      {page && <UpdatesDialog onClose={() => setPage(false)} />}
    </>
  );
}
