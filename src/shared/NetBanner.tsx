import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

/** Не блокирует экран: сообщает о потере соединения, остальное работает из уже загруженного. */
export const NetBanner = () => {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true); const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return (
    <div role="alert" className="pointer-events-none fixed right-10 top-6 z-[400] flex items-center gap-3 rounded-full px-6 py-3 text-[20px] font-semibold text-white"
      style={{ background: 'rgba(180,40,60,0.92)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
      <WifiOff size={24} /> Нет соединения с сервером
    </div>
  );
};
