/* ===========================================================
   PC Quick Actions — вкладка Sky AI.
   Просто встраивает существующий SkyAITab — тот же чат/бэкенд/история,
   что и в обычном интерфейсе, второй ИИ-системы здесь нет.
=========================================================== */
import { SkyAITab } from '@/ai/SkyAITab';

export const QuickActionsAI = () => (
  <div className="h-full overflow-hidden">
    <SkyAITab />
  </div>
);
