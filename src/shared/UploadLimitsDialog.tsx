/**
 * Окно «Лимиты загрузки»: что действует именно для вас (размер файла, число файлов, длительность, одновременные загрузки, массовая
 * загрузка, место в личном хранилище, пределы публикации). Всё от сервера (GET /api/upload-limits); цифры меняет администрация.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gauge, X, Upload } from 'lucide-react';
import { apiCall } from '@/core/auth/api';

interface Lim { maxFileBytes: number; maxFiles: number; formats: string[] | null; maxDurationSec: number; maxConcurrent: number; speedKbps: number; maxBatch: number; totalBytes: number; totalBytesPrime: number }
interface Data { personal: Record<string, Lim>; public: Record<string, Lim>; personalQuotaBytes?: number; personalUsedBytes?: number | null }

const bytes = (n: number) => (n >= 1073741824 ? `${+(n / 1073741824).toFixed(2)} ГБ` : n >= 1048576 ? `${Math.round(n / 1048576)} МБ` : `${Math.round(n / 1024)} КБ`);
const dur = (s: number) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} ч` : s >= 60 ? `${Math.round(s / 60)} мин` : `${s} с`);
const NAME: Record<string, string> = { music: 'Музыка', film: 'Кино' };

const Row = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-3 py-0.5 text-[13px]"><span style={{ color: 'var(--t3)' }}>{k}</span><b className="text-right">{v}</b></div>;

export const UploadLimitsDialog = ({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: 'music' | 'film' }) => {
  const [d, setD] = useState<Data | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { if (!open) return; let alive = true; setErr(false); void apiCall<Data>('/api/upload-limits').then((r) => { if (!alive) return; if (r.ok && r.data) setD(r.data); else setErr(true); }); return () => { alive = false; }; }, [open]);
  const p = d?.personal?.[kind]; const pub = d?.public?.[kind];
  const used = d?.personalUsedBytes ?? null; const quota = d?.personalQuotaBytes ?? 0; const pct = quota > 0 && used != null ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[9000] grid place-items-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
          <motion.div role="dialog" aria-label="Лимиты загрузки" initial={{ y: 20, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.97 }} onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl p-5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-bold"><Gauge size={18} style={{ color: '#a855f7' }} />{`Лимиты загрузки: ${NAME[kind]}`}</h3>
              <button type="button" onClick={onClose} aria-label="Закрыть" style={{ color: 'var(--t3)' }}><X size={18} /></button>
            </div>
            {err && <p className="mt-3 text-sm" style={{ color: '#ef4444' }}>Не удалось получить лимиты. Попробуйте ещё раз.</p>}
            {!d && !err && <p className="mt-3 text-sm" style={{ color: 'var(--t3)' }}>Загрузка…</p>}
            {p && (
              <>
                {quota > 0 && (
                  <div className="mt-3 rounded-2xl p-3" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
                    <div className="flex justify-between text-[13px]"><span style={{ color: 'var(--t3)' }}>Место в личном хранилище</span><b>{used != null ? `${bytes(used)} из ${bytes(quota)}` : bytes(quota)}</b></div>
                    {used != null && <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? '#ef4444' : pct >= 80 ? '#f59e0b' : 'linear-gradient(90deg,#a855f7,#6366f1)' }} /></div>}
                  </div>)}
                <p className="mb-1 mt-4 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: '#a855f7' }}><Upload size={12} />Личная загрузка</p>
                <Row k="Размер одного файла" v={p.maxFileBytes ? `до ${bytes(p.maxFileBytes)}` : 'без предела'} />
                <Row k="Файлов в коллекции" v={p.maxFiles ? `до ${p.maxFiles}` : 'без предела'} />
                <Row k="Длительность" v={p.maxDurationSec ? `до ${dur(p.maxDurationSec)}` : 'без предела'} />
                <Row k="Одновременных загрузок" v={String(p.maxConcurrent || 'без предела')} />
                <Row k="Файлов за один раз" v={p.maxBatch ? `до ${p.maxBatch}` : 'без предела'} />
                {p.speedKbps > 0 && <Row k="Скорость приёма" v={`до ${Math.round(p.speedKbps / 8)} КБ/с`} />}
                {p.formats?.length ? <Row k="Форматы" v={p.formats.join(', ')} /> : null}
                {pub && (
                  <>
                    <p className="mb-1 mt-4 text-xs font-bold uppercase tracking-wider" style={{ color: '#a855f7' }}>Публикация в каталоге</p>
                    <Row k="Размер одного файла" v={pub.maxFileBytes ? `до ${bytes(pub.maxFileBytes)}` : 'без предела'} />
                    <Row k="Опубликованных файлов" v={pub.maxFiles ? `до ${pub.maxFiles}` : 'без предела'} />
                    <Row k="Длительность" v={pub.maxDurationSec ? `до ${dur(pub.maxDurationSec)}` : 'без предела'} />
                    {(pub.totalBytes || pub.totalBytesPrime) ? <Row k="Общий объём опубликованного" v={`${bytes(pub.totalBytes || pub.totalBytesPrime)}${pub.totalBytesPrime && pub.totalBytesPrime !== pub.totalBytes ? ` (Prime: ${bytes(pub.totalBytesPrime)})` : ''}`} /> : null}
                  </>)}
                <p className="mt-3 text-[11px]" style={{ color: 'var(--t3)' }}>Пределы задаёт администрация Sky и может менять. Файл сверх предела сервер отклонит с причиной.</p>
              </>)}
          </motion.div>
        </motion.div>)}
    </AnimatePresence>
  );
};

export const UploadLimitsButton = ({ kind }: { kind: 'music' | 'film' }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)', border: '1px solid var(--border)', cursor: 'pointer' }}><Gauge size={13} />Лимиты загрузки</button>
      <UploadLimitsDialog open={open} onClose={() => setOpen(false)} kind={kind} />
    </>
  );
};
