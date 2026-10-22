/** Сканер Sky QR: камера (или ввод ника вручную) → карточка человека → «Добавить в контакты» / «Открыть профиль». */
import { useCallback, useEffect, useState } from 'react';
import { X, ScanLine, Loader2 } from 'lucide-react';
import { Scanner } from '@/auth/DeviceLinkPhone';
import { apiQrCard, apiQrUser, codeFromText, qrReason, type QrCard } from './qrApi';
import { ContactCard } from './ContactCard';

export function ScanContact({ onClose, code: initial }: { onClose: () => void; code?: string }) {
  const [card, setCard] = useState<QrCard | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [nick, setNick] = useState('');

  const openCode = useCallback(async (code: string) => {
    setBusy(true); setMsg('');
    const r = await apiQrCard(code);
    setBusy(false);
    if (!r.ok || !r.data) { setMsg(qrReason(r)); return; }
    setCard(r.data);
  }, []);
  const onScan = useCallback((text: string) => {
    const c = codeFromText(text);
    if (!c) { setMsg('Это не QR-код Sky. Откройте код из Профиль → «Мой QR-код».'); return; }
    void openCode(c);
  }, [openCode]);
  useEffect(() => { if (initial) void openCode(initial); }, [initial, openCode]);
  const byNick = async () => {
    setBusy(true); setMsg('');
    const r = await apiQrUser(nick);
    setBusy(false);
    if (!r.ok || !r.data) { setMsg(qrReason(r)); return; }
    setCard(r.data);
  };

  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Сканировать QR" className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="flex items-center gap-2 text-base font-bold"><ScanLine size={16} />{card ? 'Добавить в контакты' : 'Сканировать QR'}</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><X size={18} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 pb-5 pt-2">
          {card ? (
            <>
              <ContactCard card={card} onDone={onClose} />
              <button type="button" onClick={() => { setCard(null); setMsg(''); }} className="w-full text-center text-sm underline" style={{ color: 'var(--t3)' }}>Сканировать другой код</button>
            </>
          ) : (
            <>
              <p className="text-xs" style={{ color: 'var(--t3)' }}>Наведите камеру на QR-код Sky другого человека. Перед добавлением вы увидите, кто это.</p>
              {!busy && !initial && <Scanner onCode={onScan} />}
              {busy && <div role="status" className="grid place-items-center py-6"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
              {msg && <p role="alert" className="text-sm" style={{ color: 'var(--red)' }}>{msg}</p>}
              <div>
                <p className="mb-1 text-[11px]" style={{ color: 'var(--t3)' }}>Или введите ник (Sky ID) вручную</p>
                <div className="flex gap-2">
                  <input value={nick} onChange={(e) => setNick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && nick.trim() && void byNick()} placeholder="@ник" autoCapitalize="none" translate="no"
                    className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }} />
                  <button type="button" disabled={!nick.trim() || busy} onClick={() => void byNick()} className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: '#fff' }}>Найти</button>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>По нику показываются только имя, ник и аватар — то же, что и в поиске людей.</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
