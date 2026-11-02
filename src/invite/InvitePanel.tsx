/** Вкладка «Приглашения» (Профиль): личная ссылка, настоящие регистрации по ней и награды по порогам (Prime и баллы; бизнес-тарифа нет). Сервер — server/invites.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { Copy, Share2, Loader2, RefreshCw, Users, Link2, Gift, Check } from 'lucide-react';
import { apiCall } from '@/core/auth/api';
import { flash } from '@/shared/flash';
import { shareOrigin } from '@/core/nativeApp';

interface Milestone { count: number; primeDays: number; points: number; reached: boolean; claimed: boolean }
interface Invite { code: string; link: string; count: number; milestones: Milestone[]; recent: { username: string | null; at: string }[] }

export function InvitePanel() {
  const [inv, setInv] = useState<Invite | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const r = await apiCall<Invite>('/api/invite/me');
    if (!r.ok || !r.data) { setErr(r.reason ?? 'Не удалось загрузить'); return; }
    setInv(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const [busy, setBusy] = useState<number | null>(null);
  const claim = async (count: number) => {
    setBusy(count);
    const r = await apiCall<{ primeDays: number; points: number }>('/api/invite/claim', { method: 'POST', body: JSON.stringify({ count }) });
    setBusy(null);
    if (!r.ok) { flash(r.reason === 'already_claimed' ? 'Награда уже получена' : r.reason === 'not_reached' ? 'Порог ещё не достигнут' : 'Не удалось получить награду'); void load(); return; }
    flash(`+${r.data?.primeDays ?? 0} дн. Prime и ${r.data?.points ?? 0} баллов`);
    void load();
  };

  const link = inv ? (inv.link.startsWith('/') ? `${shareOrigin()}${inv.link}` : inv.link) : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); flash('Ссылка скопирована'); } catch { flash('Не удалось скопировать'); } };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: 'Sky', text: 'Заходи в Sky — одна экосистема для всего:', url: link }); return; } catch { return; } }
    void copy();
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-5" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}><Users size={22} /></div>
        <div className="min-w-0">
          <p className="text-[20px] font-black" style={{ color: 'var(--t1)' }}>Пригласи друзей</p>
          <p className="text-[13px]" style={{ color: 'var(--t3)' }}>Отправь ссылку — когда человек зарегистрируется, ты увидишь его здесь</p>
        </div>
      </div>

      {!inv && !err && <div role="status" className="grid place-items-center py-10"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
      {err && (
        <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{err}</p>
          <button type="button" onClick={() => void load()} className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold" style={{ background: 'var(--t1)', color: 'var(--bg-l1, #fff)' }}><RefreshCw size={13} />Повторить</button>
        </div>
      )}

      {inv && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--bg-l2)' }}>
              <p className="text-[28px] font-black" style={{ color: 'var(--accent)' }}>{inv.count}</p>
              <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Зарегистрировалось</p>
            </div>
            <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--bg-l2)' }}>
              <p className="text-[18px] font-black tracking-wider" style={{ color: 'var(--t1)' }} translate="no">{inv.code}</p>
              <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Твой код</p>
            </div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'var(--bg-l2)' }}>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}><Link2 size={12} />Твоя ссылка</p>
            <p className="break-all text-[14px] font-semibold select-all" style={{ color: 'var(--t1)' }} translate="no">{link}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void copy()} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--bg-l1)', color: 'var(--t1)', minHeight: 44 }}><Copy size={15} />Копировать</button>
              <button type="button" onClick={() => void share()} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold text-white" style={{ background: 'var(--accent)', minHeight: 44 }}><Share2 size={15} />Поделиться</button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Кто пришёл</p>
            {inv.recent.length === 0
              ? <p className="text-[13px]" style={{ color: 'var(--t3)' }}>Пока никто не зарегистрировался по твоей ссылке.</p>
              : <ul className="space-y-1.5">
                  {inv.recent.map((r, i) => (
                    <li key={i} className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px]" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
                      <span translate="no">{r.username ? `@${r.username}` : 'новый человек'}</span>
                      <span style={{ color: 'var(--t3)' }}>{new Date(r.at).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>}
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}><Gift size={13} />Награды</p>
            <div className="space-y-2">
              {inv.milestones.map((m) => (
                <div key={m.count} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)', opacity: m.reached || m.claimed ? 1 : 0.7 }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold" style={{ color: 'var(--t1)' }}>{m.count} чел.</p>
                    <p className="text-[12px]" style={{ color: 'var(--t3)' }}>{`${m.primeDays} дн. Prime + ${m.points} баллов`}</p>
                    {!m.reached && <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-l1)' }}><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(inv.count / m.count * 100))}%`, background: 'var(--accent)' }} /></div>}
                  </div>
                  {m.claimed
                    ? <span className="flex shrink-0 items-center gap-1 text-[12px] font-bold" style={{ color: 'var(--green, #22c55e)' }}><Check size={14} />Получено</span>
                    : <button type="button" disabled={!m.reached || busy === m.count} onClick={() => void claim(m.count)}
                        className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40" style={{ background: 'var(--accent)', minHeight: 36 }}>
                        {busy === m.count ? '…' : m.reached ? 'Забрать' : `ещё ${m.count - inv.count}`}
                      </button>}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Считаются только новые регистрации. Приглашение с того же устройства, что и у тебя, не засчитывается.</p>
        </>
      )}
    </div>
  );
}
