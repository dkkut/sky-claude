/** Предупреждение перед видео и чтением в машине. Подтверждается на каждый запуск Car (sessionStorage). */
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { WARNING_TEXT } from './driveLogic';
import { CAR_GLASS, CAR_GLASS_BORDER } from './carTheme';

const KEY = 'sky:car:warn:v1';
const acked = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };

export const CarWarningGate = ({ children }: { children: React.ReactNode }) => {
  const [ok, setOk] = useState(acked);
  if (ok) return <>{children}</>;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-10 text-center" role="alertdialog" aria-label="Предупреждение" data-car-warning>
      <AlertTriangle size={72} color="#fbbf24" />
      <p className="max-w-[760px] text-[30px] font-extrabold leading-snug text-white">{WARNING_TEXT}</p>
      <button type="button" onClick={() => { try { sessionStorage.setItem(KEY, '1'); } catch { /* память недоступна — спросим снова */ } setOk(true); }}
        className="rounded-3xl px-12 text-[28px] font-extrabold text-[#0b0b14]" style={{ minHeight: 92, background: '#fff' }}>Понятно</button>
    </div>
  );
};

export const DriveBadge = ({ state }: { state: 'driving' | 'parked' | 'unknown' }) => (
  <span className="rounded-full px-4 py-1.5 text-[17px] font-bold" data-drive-state={state}
    style={{ background: state === 'parked' ? 'rgba(16,185,129,0.25)' : 'rgba(251,191,36,0.2)', color: state === 'parked' ? '#6ee7b7' : '#fcd34d', border: CAR_GLASS_BORDER }}>
    {state === 'parked' ? 'Автомобиль стоит' : state === 'driving' ? 'Автомобиль в движении' : 'Состояние автомобиля неизвестно'}
  </span>
);

export const LockedNote = ({ state, what }: { state: 'driving' | 'unknown'; what: string }) => (
  <div className="flex flex-col items-center gap-4 rounded-[36px] px-10 py-12 text-center" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER }} data-car-locked>
    <AlertTriangle size={56} color="#fbbf24" />
    <p className="text-[28px] font-extrabold text-white">{state === 'driving' ? `${what} недоступно: автомобиль в движении` : `${what} недоступно: не удаётся определить, стоит ли автомобиль`}</p>
    {state === 'unknown' && <p className="max-w-[680px] text-[20px] text-white/60">Нужен доступ к геолокации (для скорости). Пока Sky не знает состояние автомобиля, видео и чтение закрыты.</p>}
    <p className="text-[20px] text-white/60">Остановитесь в безопасном месте — экран откроется сам.</p>
  </div>
);
