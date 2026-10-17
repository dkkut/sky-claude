/* Сканер QR в SkyMoney: открывает страницу оплаты SkyKassa Business прямо в приложении. Открываются только наши страницы /p/<id> —
   чужие ссылки из QR не открываем. Вошедшему человеку с Prime за сканирование начисляются баллы по правилу «Сканирование QR SkyKassa»
   (правила задаёт администрация; нет правила — нет баллов). Для тех, кто не пользуется Sky, QR открывается обычной камерой на веб-странице. */
import { useCallback, useState } from 'react';
import { X, ScanLine, Crown } from 'lucide-react';
import { Scanner } from '@/auth/DeviceLinkPhone';
import { flash } from '@/shared/flash';
import { useMoney } from '@/wallet/store';
import { kbScan } from './api';
import { PayPage } from './PayPage';

const ERR: Record<string, string> = {
  not_skykassa_qr: 'Это не QR-код SkyKassa. Открываются только страницы оплаты SkyKassa.', not_found: 'Такой страницы оплаты нет.',
  too_many_requests: 'Слишком часто. Подождите немного.',
};

export const ScanQr = ({ onClose }: { onClose: () => void }) => {
  const [pid, setPid] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [bonus, setBonus] = useState<{ points: number } | null>(null);

  const handle = useCallback(async (text: string) => {
    setBusy(true); setMsg('');
    const r = await kbScan(text);
    setBusy(false);
    if (!r.ok) { setMsg(ERR[r.error ?? ''] ?? 'Не получилось открыть QR. Повторите.'); return; }
    if (r.data.state !== 'open') setMsg('Эта страница оплаты сейчас недоступна.');
    const pts = r.data.granted.filter((g) => g.status === 'paid').reduce((a, g) => a + g.points, 0);
    if (pts > 0) { setBonus({ points: pts }); flash(`Кэшбэк за сканирование: +${pts} баллов`); void useMoney.getState().refresh(); }
    setPid(r.data.publicId);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <button type="button" aria-label="Закрыть" onClick={pid ? () => { setPid(null); setBonus(null); } : onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5"><X size={16} style={{ color: 'var(--t2)' }} /></button>
        <ScanLine size={16} style={{ color: 'var(--accent)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>{pid ? 'Страница оплаты' : 'Сканер QR · SkyKassa'}</span>
      </div>
      {bonus && <p role="status" className="shrink-0 px-4 py-2 text-xs font-semibold" style={{ background: 'color-mix(in srgb, var(--green) 14%, transparent)', color: 'var(--green)' }}><Crown size={12} className="inline" /> Prime: +{bonus.points} баллов за сканирование</p>}
      {pid ? <div className="min-h-0 flex-1"><PayPage pid={pid} embedded /></div> : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs" style={{ color: 'var(--t3)' }}>Наведите камеру на QR-код SkyKassa. Откроется страница оплаты бизнеса. Подписчикам Prime за сканирование могут начисляться баллы — если сейчас действует такая акция.</p>
          {!busy && <Scanner onCode={(t) => void handle(t)} />}
          {msg && <p role="alert" className="text-sm" style={{ color: 'var(--red)' }}>{msg}</p>}
          <div>
            <p className="mb-1 text-[11px]" style={{ color: 'var(--t3)' }}>Или вставьте ссылку из QR</p>
            <div className="flex gap-2">
              <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="https://…/p/…" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
              <button type="button" disabled={!manual.trim() || busy} onClick={() => void handle(manual)} className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Открыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
