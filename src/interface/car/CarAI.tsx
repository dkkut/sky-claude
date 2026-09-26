/* ===========================================================
   SKY CAR MODE — Sky AI (черновик, работа приостановлена).
   Просто встраивает существующий SkyAITab — тот же чат/бэкенд/история,
   что и в обычном интерфейсе, без второй ИИ-системы.
=========================================================== */
import { SkyAITab } from '@/ai/SkyAITab';

export const CarAI = () => (
  <div className="h-full overflow-hidden rounded-3xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
    <SkyAITab />
  </div>
);
