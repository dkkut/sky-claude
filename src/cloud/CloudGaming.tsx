/**
 * Sky Gaming Cloud — заглушка будущего сервиса облачного запуска игр.
 * Здесь нет каталога игр, стриминга, очередей и серверов: только витрина и честное сообщение, что сервис ещё не запущен.
 * Запуск — заменить экран в `ExtrasModule` на настоящий, навигацию трогать не нужно.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { Cloud, Gamepad2, Bell, Sparkles } from 'lucide-react';
import { CLOUD_SERVICES, useCloudNotice } from './cloudNotice';

const Orbit = ({ calm }: { calm: boolean }) => (
  <div className="relative mx-auto grid place-items-center" style={{ width: 'min(300px, 70vw)', aspectRatio: '1' }} aria-hidden>
    {[1, 0.74, 0.5].map((k, i) => (
      <motion.div key={k} className="absolute rounded-full"
        style={{ width: `${k * 100}%`, height: `${k * 100}%`, border: `1px solid rgba(139,92,246,${0.22 + i * 0.1})`, boxShadow: i === 2 ? '0 0 40px rgba(139,92,246,.25) inset' : undefined }}
        animate={calm ? undefined : { rotate: i % 2 ? -360 : 360 }} transition={{ duration: 60 - i * 12, repeat: Infinity, ease: 'linear' }}>
        <span className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: i === 1 ? '#4f6ef7' : '#a855f7', boxShadow: `0 0 14px ${i === 1 ? '#4f6ef7' : '#a855f7'}` }} />
      </motion.div>
    ))}
    <motion.div className="relative grid place-items-center rounded-[34px]"
      style={{ width: '38%', aspectRatio: '1', background: 'linear-gradient(145deg, rgba(139,92,246,.35), rgba(79,110,247,.2))', border: '1px solid rgba(255,255,255,.18)', backdropFilter: 'blur(18px)', boxShadow: '0 20px 60px rgba(139,92,246,.45), inset 0 1px 0 rgba(255,255,255,.25)' }}
      animate={calm ? undefined : { y: [0, -6, 0] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}>
      <Cloud size={70} strokeWidth={1.2} style={{ color: 'rgba(255,255,255,.9)' }} />
      <Gamepad2 size={30} className="absolute" style={{ bottom: '24%', color: '#fff', filter: 'drop-shadow(0 0 8px rgba(255,255,255,.6))' }} />
    </motion.div>
  </div>
);

export const CloudGaming = () => {
  const calm = !!useReducedMotion();
  const showNotice = useCloudNotice('gaming');
  const s = CLOUD_SERVICES.gaming;
  return (
    <div data-keep-dark className="relative h-full overflow-y-auto overflow-x-hidden"
      style={{ background: 'radial-gradient(120% 80% at 70% 0%, #2a1458 0%, #120a26 45%, #07060f 100%)', color: '#fff', scrollbarWidth: 'none' }}>
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(1.5px 1.5px at 20% 30%, #fff8, transparent), radial-gradient(1px 1px at 70% 20%, #fff6, transparent), radial-gradient(1.5px 1.5px at 85% 65%, #fff7, transparent), radial-gradient(1px 1px at 35% 80%, #fff5, transparent)' }} />
      <div className="relative mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center gap-8 px-6 pt-10 md:flex-row md:gap-14" style={{ paddingBottom: 110 }}>
        <motion.div className="order-2 flex flex-1 flex-col items-center text-center md:order-1 md:items-start md:text-left"
          initial={calm ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
            style={{ background: 'rgba(139,92,246,.18)', border: '1px solid rgba(168,85,247,.4)', color: '#d8b4fe' }}>
            <Sparkles size={12} /> Скоро в Sky
          </span>
          <h1 className="font-black leading-[1.05]" style={{ fontSize: 'clamp(30px, 6vw, 54px)', letterSpacing: '-0.02em' }}>{s.title}</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed" style={{ color: 'rgba(255,255,255,.72)' }}>
            Играйте в любимые игры там, где удобно — без загрузки и мощного железа. Сервис облачного запуска игр{' '}
            <span style={{ color: '#fbbf24', fontWeight: 700 }}>готовится к запуску</span>.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <span className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold"
              style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', color: 'rgba(255,255,255,.65)' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: '#fbbf24', boxShadow: '0 0 8px #fbbf24' }} /> Скоро
            </span>
            <button type="button" onClick={showNotice}
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold"
              style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(168,85,247,.45)', color: '#e9d5ff', cursor: 'pointer' }}>
              <Bell size={14} /> Показать уведомление
            </button>
          </div>
          <p role="status" className="mt-5 max-w-md text-sm" style={{ color: 'rgba(255,255,255,.55)' }}>{s.body}</p>
        </motion.div>
        <div className="order-1 flex-1 md:order-2"><Orbit calm={calm} /></div>
      </div>
    </div>
  );
};
