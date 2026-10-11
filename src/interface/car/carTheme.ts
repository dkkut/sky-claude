/* Единые токены Sky Car: тёмная тема Sky, стеклянные панели, крупные цели касания. */
export const CAR_BG = 'radial-gradient(120% 100% at 85% -10%, #231a52 0%, #0d0b20 50%, #07070f 100%)';
export const CAR_GLASS = 'rgba(255,255,255,0.07)';
export const CAR_GLASS_BORDER = '1px solid rgba(255,255,255,0.11)';
export const CAR_BLUR = 'blur(26px) saturate(160%)';
export const CAR_ACCENT = '#8b7cff';
/** Минимальная сторона цели касания в машине — заметно крупнее, чем в обычном интерфейсе. */
export const CAR_TAP = 72;

export const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
