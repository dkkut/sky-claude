/** «Мой QR-код»: показать, сохранить картинкой, выбрать, что видно после сканирования, обновить или отозвать. Сервер — server/skyqr.mjs. */
import { useCallback, useEffect, useState } from 'react';
import { X, Download, RefreshCw, Ban, Loader2, Copy } from 'lucide-react';
import { flash } from '@/shared/flash';
import { qrSvg, downloadPng } from '@/kassabiz/qr';
import { apiMyQr, apiSaveMyQr, apiRotateQr, apiRevokeQr, qrReason, type MyQr, type QrFields } from './qrApi';

const LABELS: Record<keyof QrFields, string> = { bio: 'О себе', links: 'Ссылки из профиля', status: 'Статус', country: 'Страна' };

export function MyQrDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState<MyQr | null>(null);
  const [svg, setSvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { setErr(''); const r = await apiMyQr(); if (!r.ok || !r.data) { setErr(qrReason(r)); return; } setQ(r.data); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let on = true; if (q?.exists && q.enabled && q.url) void qrSvg(q.url, 260).then((s) => { if (on) setSvg(s); }); else setSvg(''); return () => { on = false; }; }, [q?.url, q?.enabled, q?.exists]);

  const run = async (f: () => ReturnType<typeof apiMyQr>, ok?: string) => {
    setBusy(true); const r = await f(); setBusy(false);
    if (!r.ok || !r.data) { flash(qrReason(r)); return; }
    setQ(r.data); if (ok) flash(ok);
  };
  const toggleField = (k: keyof QrFields) => run(() => apiSaveMyQr({ fields: { ...q!.fields, [k]: !q!.fields[k] } }));

  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" style={{ background: 'rgba(0,0,0,0.5)', paddingTop: 'env(safe-area-inset-top)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Мой QR-код" className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: 'var(--bg-l1, #fff)', color: 'var(--t1)', paddingBottom: 'env(safe-area-inset-bottom)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <p className="text-base font-bold">Мой QR-код</p>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: 'var(--bg-l2)' }}><X size={18} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 pb-5 pt-2">
          {!q && !err && <div role="status" className="grid place-items-center py-8"><Loader2 size={20} className="animate-spin" style={{ color: 'var(--t3)' }} /></div>}
          {err && <p role="alert" className="text-sm" style={{ color: 'var(--red)' }}>{err}</p>}
          {q && !q.exists && (
            <div className="space-y-3 text-center">
              <p className="text-sm" style={{ color: 'var(--t2)' }}>Создайте личный QR-код: человек наведёт камеру в Sky и сможет добавить вас в контакты. В коде нет паролей и закрытых данных — только случайный код, который вы можете отозвать.</p>
              <button type="button" disabled={busy} onClick={() => void run(() => apiSaveMyQr({ enabled: true }), 'QR-код создан')} className="rounded-full px-6 py-3 text-sm font-bold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff' }}>Создать QR-код</button>
            </div>
          )}
          {q?.exists && (
            <>
              {q.enabled ? (
                <div className="grid place-items-center rounded-3xl p-3" style={{ background: '#fff' }}>
                  {svg ? <div aria-label="QR-код Sky" role="img" dangerouslySetInnerHTML={{ __html: svg }} /> : <Loader2 size={20} className="animate-spin" />}
                </div>
              ) : <p className="rounded-2xl p-4 text-center text-sm" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>Код отозван — по нему никто не откроет вашу карточку. Нажмите «Новый код», чтобы создать новый.</p>}
              {q.enabled && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void downloadPng(q.url!, 'sky-qr')} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--bg-l2)', minHeight: 44 }}><Download size={15} />Сохранить</button>
                  <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(q.url!); flash('Ссылка скопирована'); } catch { flash('Не удалось скопировать'); } }} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold" style={{ background: 'var(--bg-l2)', minHeight: 44 }}><Copy size={15} />Ссылка</button>
                </div>
              )}
              <div className="rounded-2xl p-3" style={{ background: 'var(--bg-l2)' }}>
                <p className="mb-2 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>Что увидит сканирующий</p>
                <p className="mb-2 text-[11px]" style={{ color: 'var(--t3)' }}>Всегда: аватар, имя и ник. Дополнительно:</p>
                {(Object.keys(LABELS) as (keyof QrFields)[]).map((k) => (
                  <label key={k} className="flex items-center justify-between py-1.5 text-sm"><span>{LABELS[k]}</span>
                    <input type="checkbox" disabled={busy} checked={q.fields[k]} onChange={() => void toggleField(k)} /></label>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void run(() => apiRotateQr(), 'Новый код создан, прежний больше не работает')} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-60" style={{ background: 'var(--bg-l2)', minHeight: 44 }}><RefreshCw size={15} />Новый код</button>
                {q.enabled && <button type="button" disabled={busy} onClick={() => void run(() => apiRevokeQr(), 'Код отозван')} className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-60" style={{ background: 'rgba(224,90,90,0.16)', color: '#e05a5a', minHeight: 44 }}><Ban size={15} />Отозвать</button>}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Новый код делает недействительными все ранее сохранённые и напечатанные изображения.</p>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{`Открывших вашу карточку: ${q.scans ?? 0}`}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
