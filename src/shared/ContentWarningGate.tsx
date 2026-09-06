import { AlertTriangle, ShieldOff } from 'lucide-react';
import { useModerationStore, type ModDomain, type WarningKind } from './moderationStore';

const CASINO_POINTS = [
  'Азартные игры вызывают финансовые потери — выигрыш никогда не гарантирован',
  'Формируют игровую зависимость, от которой сложно избавиться самостоятельно',
  'Часто сопровождаются недобросовестной рекламой и обманом со стороны организаторов',
  'Не регулируются и не защищены платформой Sky — экосистема не несёт ответственности за исход',
];
const ADULT_POINTS = [
  'Контент предназначен только для лиц старше 18 лет',
  'Может содержать нецензурную лексику и материалы не для всех',
  'Экосистема не несёт ответственности за содержание — оцените уместность просмотра самостоятельно',
];

const pointsFor = (kind: WarningKind): string[] => {
  if (kind === 'casino') return CASINO_POINTS;
  if (kind === '18+') return ADULT_POINTS;
  if (kind === 'casino18') return [...CASINO_POINTS, ...ADULT_POINTS];
  return [];
};

/** Баннер с предупреждением (казино / 18+) и кнопкой "Я понял, продолжить".
 *  Рендерит children только после подтверждения — размещайте прямо
 *  вокруг контента канала/фильма, который нужно прикрыть. */
export const ContentWarningGate = ({ domain, targetId, children }: {
  domain: ModDomain; targetId: string; children: React.ReactNode;
}) => {
  const { warningFor, isAcknowledged, acknowledge } = useModerationStore();
  const warning = warningFor(domain, targetId);
  const acked = isAcknowledged(domain, targetId);

  if (!warning || acked) return <>{children}</>;

  const points = pointsFor(warning);
  const title = warning === 'casino' ? 'Контент об азартных играх' : warning === '18+' ? 'Контент 18+' : 'Азартные игры · 18+';

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center" style={{ background: 'var(--bg)' }}>
      <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)' }}>
        <AlertTriangle size={28} color="#ef4444"/>
      </div>
      <p className="text-[15px] font-bold" style={{ color: 'var(--t1)' }}>{title}</p>
      <ul className="max-w-xs space-y-1.5 text-left text-[12px]" style={{ color: 'var(--t3)' }}>
        {points.map(p => (
          <li key={p} className="flex items-start gap-1.5">
            <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ background: '#ef4444' }}/>{p}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => acknowledge(domain, targetId)}
        className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: '#ef4444' }}>
        Я понял, продолжить
      </button>
    </div>
  );
};

/** Маленькая плашка вместо контента заблокированного модерацией канала. */
export const BlockedChannelBadge = ({ reason, size = 'md' }: { reason?: string; size?: 'sm'|'md' }) => (
  <div className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl text-center ${size === 'sm' ? 'p-3' : 'p-6'}`}
    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
    <ShieldOff size={size === 'sm' ? 16 : 24} color="#ef4444"/>
    <p className={size === 'sm' ? 'text-[10px] font-semibold' : 'text-[12.5px] font-semibold'} style={{ color: '#ef4444' }}>
      Данный канал заблокирован по решению модерации Sky о нарушении правил платформы
    </p>
    {reason && size !== 'sm' && <p className="text-[11px]" style={{ color: 'var(--t3)' }}>{reason}</p>}
  </div>
);
