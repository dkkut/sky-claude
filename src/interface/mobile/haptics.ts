/* ===========================================================
   HAPTICS
   navigator.vibrate() реально поддержан в Chrome/Android.
   iOS Safari эту API не реализует вообще (ограничение WebKit) —
   поэтому на iPhone вызовы будут тихо no-op, а не «поддельной»
   вибрацией. Честная деградация, а не имитация.
=========================================================== */

const supported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

const PATTERNS = {
  light:    10,
  medium:   20,
  heavy:    35,
  success:  [10, 40, 10],
  warning:  [15, 60, 15, 60],
  error:    [30, 80, 30, 80, 30],
  selection: 6,
} as const;

export type HapticKind = keyof typeof PATTERNS;

export const haptic = (kind: HapticKind = 'light') => {
  if (!supported) return;
  try { navigator.vibrate(PATTERNS[kind] as number | number[]); } catch {}
};

export const hapticsSupported = () => supported;
