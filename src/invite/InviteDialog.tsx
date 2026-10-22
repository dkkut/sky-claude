/** «Пригласить друзей»: личная ссылка, копирование/отправка, число зарегистрировавшихся по ней. Сервер — server/invites.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { X, Copy, Share2, Loader2, RefreshCw, Users } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';

interface Invite { code: string; link: string; count: number; recent: { username: string | null; at: string }[] }

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [inv, setInv] = useState<Invite | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const r = await apiCall<Invite>('/api/invite/me');
    if (!r.ok || !r.data) { setErr(r.reason ?? 'Не удалось загрузить'); return; }
    setInv(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const link = inv ? (inv.link.startsWith('/') ? `${window.location.origin}${inv.link}` : inv.link) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); flash('Ссылка скопирована'); } catch { flash('Не удалось скопировать'); } };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: 'Sky', text: 'Заходи в Sky — одна экосистема для всего:', url: link }); return; } catch { return; } }
    void copy();
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Пригласить друзей" className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="text-base font-bold">Пригласить друзей</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.06))' }}><X size={18} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 pb-5 pt-2">
          {!inv && !err && <div role="status" className="grid place-items-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
          {err && (
            <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm font-semibold">{err}</p>
              <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold" style={{ background: 'var(--t1)', color: 'var(--bg-l1, #fff)' }}><RefreshCw size={13} />Повторить</button>
            </div>
          )}
          {inv && (
            <>
              <p className="text-sm" style={{ color: 'var(--t2)' }}>Отправьте ссылку человеку, которого хотите позвать. Когда он зарегистрируется по ней, вы увидите его здесь.</p>
              <div className="break-all rounded-2xl p-3 text-sm font-semibold select-all" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.05))' }} translate="no">{link}</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void copy()} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--bg-l2, rgba(0,0,0,0.06))', minHeight: 44 }}><Copy size={15} />Скопировать</button>
                <button type="button" onClick={() => void share()} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--t1)', color: 'var(--bg-l1, #fff)', minHeight: 44 }}><Share2 size={15} />Отправить</button>
              </div>
              <div className="flex items-center gap-2 text-sm"><Users size={15} style={{ color: 'var(--t3)' }} /><span>Зарегистрировалось по вашей ссылке: <b>{inv.count}</b></span></div>
              {inv.recent.length > 0 && (
                <ul className="space-y-1 text-xs" style={{ color: 'var(--t2)' }}>
                  {inv.recent.map((r, i) => <li key={i} className="flex justify-between"><span translate="no">{r.username ? `@${r.username}` : 'новый человек'}</span><span>{new Date(r.at).toLocaleDateString()}</span></li>)}
                </ul>
              )}
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Считаются только новые регистрации. Приглашение с того же устройства, что и у вас, не засчитывается.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
