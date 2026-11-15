/** Профиль → Настройки: капсула Sky Island на рабочем столе (только Windows-приложение). */
import React, { useEffect, useState } from 'react';
import { isElectron, type IslandConfig } from '@/core/nativeApp';
import { flash } from '@/shared/flash';

export const IslandDesktopSettings = () => {
  const [cfg, setCfg] = useState<IslandConfig | null>(null);
  const [accel, setAccel] = useState('');
  useEffect(() => { void window.sky?.island?.getConfig().then(c => { if (c) { setCfg(c); setAccel(c.accel); } }); }, []);
  if (!isElectron() || !window.sky?.island || !cfg) return null;
  const apply = async (patch: Partial<Pick<IslandConfig, 'enabled' | 'timerEnabled' | 'accel'>>) => {
    const c = await window.sky!.island!.setConfig(patch); if (c) setCfg(c); return c;
  };
  const Row = ({ label, hint, on, toggle }: { label: string; hint: string; on: boolean; toggle: () => void }) => (
    <button type="button" role="switch" aria-checked={on} onClick={toggle} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left">
      <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold" style={{ color: 'var(--t1)' }}>{label}</span><span className="block text-[11.5px]" style={{ color: 'var(--t3)' }}>{hint}</span></span>
      <span className="relative h-6 w-11 shrink-0 rounded-full" style={{ background: on ? 'var(--accent)' : 'rgba(255,255,255,0.18)' }}><span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} /></span>
    </button>
  );
  return (
    <div className="px-2 pb-2">
      <p className="px-3 pb-1 pt-2 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Остров на рабочем столе (Windows)</p>
      <Row label="Капсула Sky Island" hint="Окно сверху экрана: запуск программ, музыка, система. Появляется по сочетанию клавиш" on={cfg.enabled} toggle={() => void apply({ enabled: !cfg.enabled })} />
      <Row label="Показать через 5 минут после сворачивания" hint="Если вернуться раньше — ничего не появится" on={cfg.timerEnabled} toggle={() => void apply({ timerEnabled: !cfg.timerEnabled })} />
      <div className="px-3 pt-1">
        <label className="block text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Сочетание клавиш</label>
        <div className="mt-1 flex gap-2">
          <input value={accel} onChange={e => setAccel(e.target.value)} maxLength={40} aria-label="Сочетание клавиш острова" translate="no" placeholder="CommandOrControl+Alt+I"
            className="min-w-0 flex-1 rounded-xl px-3 py-2 text-[13px] outline-none" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--t1)', border: '1px solid rgba(255,255,255,0.1)' }} />
          <button type="button" onClick={async () => { const c = await apply({ accel }); if (c && !c.accelOk && accel.trim()) flash('Сочетание занято или записано неверно. Пример: CommandOrControl+Alt+I'); }}
            className="rounded-xl px-3.5 py-2 text-[12.5px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Применить</button>
        </div>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--t3)' }}>{cfg.accelOk ? 'Сочетание работает.' : 'Сочетание не зарегистрировано (занято другой программой или не задано).'}</p>
      </div>
    </div>
  );
};
