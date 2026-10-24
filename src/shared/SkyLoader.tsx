/**
 * Единый индикатор загрузки: четыре «столбика» эквалайзера и подпись.
 * Показывается там, где раньше был пустой экран или одна строка «Ищем…».
 * `prefers-reduced-motion` и выключенные анимации — статичные столбики.
 */
export const SkyLoader = ({ label, color = '#a78bfa', size = 'md', className = '' }: {
  label?: string; color?: string; size?: 'sm' | 'md'; className?: string;
}) => {
  const h = size === 'sm' ? 18 : 30;
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className="flex items-end gap-[5px]" style={{ height: h }} aria-hidden="true">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className="sky-loader-bar block rounded-full"
            style={{ width: size === 'sm' ? 3 : 5, height: h, background: color, animationDelay: `${i * 0.14}s` }}/>
        ))}
      </div>
      {label && <p className="text-[13px]" style={{ color: 'var(--t3, #7d818c)' }}>{label}</p>}
    </div>
  );
};
