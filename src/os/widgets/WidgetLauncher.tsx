/** Профиль → Настройки → «Виджеты Sky»: открыть любой виджет (также — сочетанием клавиш, см. «Горячие клавиши»). */
import React from 'react';
import { useWidgets, WIDGET_IDS, WIDGET_TITLES } from './widgetStore';

export const WidgetLauncher = () => {
  const open = useWidgets(s => s.open); const toggle = useWidgets(s => s.toggle);
  return (
    <div className="px-3 pb-3">
      <p className="pb-2 pt-1 text-[12px] leading-snug" style={{ color: 'var(--t3)' }}>Небольшие окна поверх Sky: погода, музыка, уведомления, ресурсы, быстрые настройки, Sky AI и кошелёк. Их можно двигать (на компьютере) и закрыть крестиком или Esc.</p>
      <div className="flex flex-wrap gap-2">
        {WIDGET_IDS.map(id => (
          <button key={id} type="button" aria-pressed={open.includes(id)} onClick={() => toggle(id)} className="rounded-2xl px-3.5 py-2 text-[12.5px] font-bold"
            style={{ background: open.includes(id) ? 'var(--accent)' : 'rgba(255,255,255,0.07)', color: open.includes(id) ? '#fff' : 'var(--t1)', border: '1px solid rgba(255,255,255,0.1)' }}>{WIDGET_TITLES[id]}</button>
        ))}
      </div>
    </div>
  );
};
