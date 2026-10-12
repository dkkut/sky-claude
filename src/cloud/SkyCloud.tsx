/**
 * Sky Cloud — заглушка будущей облачной платформы Sky: четыре направления, ни одно ещё не запущено.
 * Карточки открывают только информационную панель; страниц и инструментов за ними нет.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Server, Mail, HardDrive, BarChart3, Cloud, Bell, X, Check } from 'lucide-react';
import { CLOUD_SERVICES, useCloudNotice } from './cloudNotice';

interface Dir { key: string; Icon: typeof Server; name: string; status: 'Скоро' | 'В разработке'; color: string; text: string; plans: string[] }

const DIRECTIONS: Dir[] = [
  { key: 'vps', Icon: Server, name: 'Sky VPS', status: 'В разработке', color: '#4f6ef7',
    text: 'Аренда виртуальных серверов на инфраструктуре Sky.',
    plans: ['Выбор конфигурации сервера', 'Панель управления VPS'] },
  { key: 'mail', Icon: Mail, name: 'Sky Mail', status: 'Скоро', color: '#a855f7',
    text: 'Электронная почта для бизнеса и личного пользования.',
    plans: ['Почтовые ящики на инфраструктуре Sky', 'Управление почтой'] },
  { key: 'drive', Icon: HardDrive, name: 'Sky Drive', status: 'Скоро', color: '#14b8a6',
    text: 'Облачное хранение файлов.',
    plans: ['Синхронизация файлов между устройствами', 'Управление хранилищем'] },
  { key: 'analytics', Icon: BarChart3, name: 'Sky Business Analytics', status: 'В разработке', color: '#f59e0b',
    text: 'Аналитика для бизнеса и облачная бухгалтерия.',
    plans: ['Учёт и отчётность', 'Анализ показателей бизнеса'] },
];

const Panel = ({ d, onClose }: { d: Dir; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [onClose]);
  return (
    <motion.div className="absolute inset-0 z-20 flex items-end justify-center sm:items-center" style={{ background: 'rgba(4,3,10,.7)', backdropFilter: 'blur(6px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={d.name} onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-[28px] p-6 outline-none sm:rounded-[28px]"
        style={{ background: 'linear-gradient(160deg, rgba(40,26,80,.96), rgba(14,10,30,.98))', border: '1px solid rgba(255,255,255,.12)', boxShadow: `0 30px 80px ${d.color}44` }}
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 32 }}>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full"
          style={{ background: 'rgba(255,255,255,.08)', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={15} /></button>
        <div className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: `${d.color}26`, border: `1px solid ${d.color}66`, color: d.color }}><d.Icon size={26} /></div>
        <h3 className="mt-4 text-xl font-black text-white" translate="no">{d.name}</h3>
        <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,.7)' }}>{d.text}</p>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,.45)' }}>Что планируется</p>
        <ul className="mt-2 space-y-2">
          {d.plans.map((p) => <li key={p} className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,.85)' }}><Check size={14} style={{ color: d.color }} />{p}</li>)}
        </ul>
        <p className="mt-5 rounded-2xl px-4 py-3 text-sm" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.8)' }}>
          {CLOUD_SERVICES.cloud.body}
        </p>
      </motion.div>
    </motion.div>
  );
};

export const SkyCloud = () => {
  const calm = !!useReducedMotion();
  const showNotice = useCloudNotice('cloud');
  const [open, setOpen] = useState<Dir | null>(null);
  return (
    <div data-keep-dark className="relative h-full overflow-hidden" style={{ background: 'radial-gradient(110% 70% at 20% 0%, #14264f 0%, #0b0c1f 50%, #06060d 100%)', color: '#fff' }}>
      <div className="h-full overflow-y-auto overflow-x-hidden px-5 pt-8" style={{ scrollbarWidth: "none", paddingBottom: 110 }}>
        <div className="mx-auto max-w-4xl">
          <motion.div className="flex flex-col items-center text-center" initial={calm ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
            <div className="grid h-16 w-16 place-items-center rounded-3xl" style={{ background: 'linear-gradient(145deg, rgba(79,110,247,.4), rgba(168,85,247,.3))', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 16px 50px rgba(79,110,247,.4)' }}>
              <Cloud size={30} />
            </div>
            <h1 className="mt-4 font-black" style={{ fontSize: 'clamp(28px, 5vw, 44px)', letterSpacing: '-0.02em' }}>Sky Cloud</h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,.68)' }}>
              Облачная платформа экосистемы Sky: серверы, почта, хранилище и аналитика для бизнеса. Сервисы готовятся к запуску.
            </p>
            <p role="status" className="mt-3 text-xs" style={{ color: 'rgba(255,255,255,.5)' }}>{CLOUD_SERVICES.cloud.body}</p>
            <button type="button" onClick={showNotice} className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
              style={{ background: 'rgba(79,110,247,.18)', border: '1px solid rgba(79,110,247,.45)', color: '#c7d2fe', cursor: 'pointer' }}>
              <Bell size={13} /> Показать уведомление
            </button>
          </motion.div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {DIRECTIONS.map((d, i) => (
              <motion.button key={d.key} type="button" onClick={() => setOpen(d)} data-cloud-card={d.key}
                className="group relative overflow-hidden rounded-[26px] p-5 text-left"
                style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02))', border: '1px solid rgba(255,255,255,.1)', backdropFilter: 'blur(14px)', cursor: 'pointer' }}
                initial={calm ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i, duration: 0.5 }}
                whileHover={calm ? undefined : { y: -3 }} whileTap={{ scale: 0.98 }}>
                <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full" style={{ background: d.color, opacity: 0.18, filter: 'blur(40px)' }} />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `${d.color}26`, border: `1px solid ${d.color}66`, color: d.color }}><d.Icon size={22} /></div>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: 'rgba(251,191,36,.14)', border: '1px solid rgba(251,191,36,.35)', color: '#fcd34d' }}>{d.status}</span>
                </div>
                <h3 className="relative mt-4 text-lg font-black" translate="no">{d.name}</h3>
                <p className="relative mt-1 text-sm leading-snug" style={{ color: 'rgba(255,255,255,.66)' }}>{d.text}</p>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
      <AnimatePresence>{open && <Panel d={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
};
