/* Переключатель языка RU / EN. Подписи не переводятся (translate="no"):
   «Русский» должен оставаться «Русский» для того, кто ищет свой язык. */
import { Languages, Sun, Moon } from 'lucide-react';
import { useSettings } from '@/settings/store';
import { getLang, chooseLang, type Lang } from './lang';

const LANGS: [Lang, string][] = [['ru', 'Русский'], ['en', 'English']];

/** Две крупные кнопки — для экрана настроек. */
export const LanguageButtons = () => {
  const cur = getLang();
  return (
    <div translate="no" className="grid grid-cols-2 gap-2.5 px-4 pb-3 pt-1">
      {LANGS.map(([code, label]) => (
        <button key={code} type="button" onClick={() => { if (code !== cur) chooseLang(code); }}
          className="flex items-center justify-center gap-2 rounded-2xl py-3 text-[13px] font-semibold transition-all"
          style={{
            background: code === cur ? 'var(--accent-bg)' : 'var(--bg-l2)',
            border: `2px solid ${code === cur ? 'var(--accent)' : 'var(--border)'}`,
            color: code === cur ? 'var(--accent)' : 'var(--t2)',
          }}>
          <Languages size={14} /> {label}
        </button>
      ))}
    </div>
  );
};

/** Компактная «таблетка» RU | EN — для экрана входа. */
export const LanguagePill = () => {
  const cur = getLang();
  return (
    <div translate="no" className="fixed right-3 top-3 z-[1100] flex overflow-hidden rounded-full text-[11px] font-bold"
      style={{ background: 'var(--bg-l2)', border: '1px solid var(--border-m)' }}>
      {LANGS.map(([code]) => (
        <button key={code} type="button" onClick={() => { if (code !== cur) chooseLang(code); }}
          aria-label={code === 'ru' ? 'Русский' : 'English'}
          className="px-3 py-1.5"
          style={{ background: code === cur ? 'var(--accent)' : 'transparent', color: code === cur ? '#fff' : 'var(--t2)' }}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

/** Светлая / тёмная тема — рядом с переключателем языка на экранах входа и технических работ. */
export const ThemePill = () => {
  const scheme = useSettings((s) => s.settings.colorScheme);
  const set = useSettings((s) => s.set);
  const light = scheme === 'light';
  return (
    <button type="button" onClick={() => set({ colorScheme: light ? 'dark' : 'light' })}
      aria-label={light ? 'Тёмная тема' : 'Светлая тема'} title={light ? 'Тёмная тема' : 'Светлая тема'}
      className="fixed right-[104px] top-3 z-[1100] grid h-[30px] w-[30px] place-items-center rounded-full"
      style={{ background: 'var(--bg-l2)', border: '1px solid var(--border-m)', color: 'var(--t2)' }}>
      {light ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
};
