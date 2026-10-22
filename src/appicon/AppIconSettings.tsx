/** Профиль → Настройки → «Иконка приложения». Логика — appIcon.ts. */
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { flash } from '@/shared/flash';
import { ICON_VARIANTS, currentIconId, applyIcon, drawIcon } from './appIcon';

export function AppIconSettings() {
  const [cur, setCur] = useState(currentIconId);
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => { void Promise.all(ICON_VARIANTS.map(async (v) => [v.id, await drawIcon(v, 96)] as const)).then((a) => setPics(Object.fromEntries(a))); }, []);
  const pick = async (id: string) => {
    const r = await applyIcon(id);
    if (!r.ok) { flash(r.note ?? 'Не удалось сменить иконку'); return; }
    setCur(id); flash(`Иконка изменена: ${r.where.join(', ')}`);
  };
  return (
    <div className="px-4 py-3">
      <p className="text-sm font-semibold" style={{ color: 'var(--t1)' }}>Иконка приложения</p>
      <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--t3)' }}>Значок вкладки в браузере, окна и трея в Windows и иконка на рабочем столе Android. Уже установленное веб-приложение и файл .exe сохраняют иконку установки.</p>
      <div className="flex flex-wrap gap-3">
        {ICON_VARIANTS.map((v) => (
          <button key={v.id} type="button" aria-label={v.name} aria-pressed={cur === v.id} onClick={() => void pick(v.id)} className="flex flex-col items-center gap-1">
            <span className="relative block h-14 w-14 overflow-hidden rounded-2xl" style={{ outline: cur === v.id ? '2px solid var(--accent)' : '1px solid var(--border)', outlineOffset: 2, background: v.bg }}>
              {pics[v.id] && <img src={pics[v.id]} alt="" className="h-full w-full" />}
              {cur === v.id && <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full" style={{ background: 'var(--accent)', color: '#fff' }}><Check size={10} /></span>}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--t2)' }}>{v.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
