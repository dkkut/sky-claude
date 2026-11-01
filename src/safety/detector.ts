/**
 * Sky Safety: чистая логика обнаружения «быстрая езда → резкая остановка → удар/вращение».
 * Без браузерных API — проверяется обычным тестом (scripts/audit/safety-detector-test.mjs).
 *
 * Событие рождается только когда сошлись ВСЕ условия:
 *  1) недавно (≤ 6 с назад) скорость по GPS была не ниже 30 км/ч;
 *  2) теперь скорость ≤ 5 км/ч два замера подряд (одиночный «скачок» GPS не считается);
 *  3) в окне ±5 с вокруг остановки был резкий удар (перегрузка ≥ 2,5 g) или быстрое вращение (≥ 300°/с).
 * Обычное торможение, остановка у светофора, потеря GPS (замеров нет — ничего не происходит) и «нулевая» скорость при плохой точности
 * (точность хуже 100 м — замер отбрасывается) событием НЕ являются. Без датчика движения событие не создаётся вовсе — это сказано в интерфейсе.
 */
export interface Trigger { speedBeforeKmh: number; dropKmh: number; signals: string; at: number }

export const FAST_KMH = 30;
export const STOP_KMH = 5;
export const IMPACT_G = 2.5;
export const SPIN_DPS = 300;
const FAST_WINDOW_MS = 6000;
const LINK_MS = 5000;
const COOLDOWN_MS = 10 * 60_000;

export class CrashDetector {
  private fast: { kmh: number; t: number }[] = [];
  private slowRun = 0;
  private slowSince = 0;
  private impactAt = 0;
  private spinAt = 0;
  private lastFire = -Infinity;

  /** Замер GPS: скорость в м/с (null — неизвестна), точность в метрах. */
  gps(speedMs: number | null, accuracyM: number | null, t: number): Trigger | null {
    if (speedMs == null || !Number.isFinite(speedMs) || speedMs < 0) return null;          // потеря скорости ≠ остановка
    if (accuracyM != null && accuracyM > 100) return null;                                  // грубый замер не используем
    const kmh = speedMs * 3.6;
    this.fast = this.fast.filter((f) => t - f.t <= FAST_WINDOW_MS);
    if (kmh >= FAST_KMH) { this.fast.push({ kmh, t }); this.slowRun = 0; return null; }
    if (kmh > STOP_KMH) { this.slowRun = 0; return null; }
    if (this.slowRun === 0) this.slowSince = t;
    this.slowRun += 1;
    if (this.slowRun < 2 || !this.fast.length) return null;
    return this.decide(t);
  }

  /** Перегрузка в g (с учётом силы тяжести) из акселерометра. */
  motion(totalG: number, rotationDps: number | null, t: number): Trigger | null {
    if (Number.isFinite(totalG) && totalG >= IMPACT_G) this.impactAt = t;
    if (rotationDps != null && Number.isFinite(rotationDps) && rotationDps >= SPIN_DPS) this.spinAt = t;
    if (this.slowRun >= 2 && this.fast.length) return this.decide(t);
    return null;
  }

  private decide(t: number): Trigger | null {
    if (t - this.lastFire < COOLDOWN_MS) return null;
    const near = (x: number) => x > 0 && Math.abs(x - this.slowSince) <= LINK_MS || (x > 0 && Math.abs(x - t) <= LINK_MS);
    const impact = near(this.impactAt); const spin = near(this.spinAt);
    if (!impact && !spin) return null;                                                      // только GPS — не повод
    const peak = Math.max(...this.fast.map((f) => f.kmh));
    this.lastFire = t; this.fast = []; this.slowRun = 0;
    return { speedBeforeKmh: Math.round(peak), dropKmh: Math.round(peak), signals: ['gps', impact ? 'impact' : '', spin ? 'spin' : ''].filter(Boolean).join(','), at: t };
  }
}
