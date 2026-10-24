/* Профиль → Настройки → «Тема оформления» → «Свои темы»: список, создание, правка (цвета + код), импорт и экспорт. */
import { useRef, useState } from 'react';
import { Check, Code2, Copy, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useSettings } from './store';
import {
  BASE_DEFAULTS, GLASS_KEYS, deriveVars, mix, rgba, parseTheme, previewCustomTheme, resolveVars, restoreCustomTheme, setThemeEditing, themeToJson, useCustomThemes, type CustomTheme, type ThemeBase,
} from './customThemes';

const FIELDS: [keyof ThemeBase, string][] = [['bg', 'Фон'], ['panel', 'Панели'], ['text', 'Текст'], ['accent', 'Акцент']];

/** rgba()/hex → {hex, alpha}: чтобы цветом и прозрачностью панели управлять отдельными элементами. */
const splitColor = (v: string | undefined, fallback: string): { hex: string; a: number } => {
  const m = String(v ?? '').match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/i);
  if (m) return { hex: `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`, a: m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4]))) };
  if (/^#[0-9a-f]{6}$/i.test(String(v))) return { hex: String(v), a: 1 };
  return { hex: fallback, a: 1 };
};

const swatch = (t: CustomTheme) => { const v = resolveVars(t); return [v['--bg'], v['--bg-l2'], v['--accent']]; };

export const CustomThemeEditor = () => {
  const { themes, activeId, add, update, remove, activate } = useCustomThemes();
  const setSettings = useSettings((s) => s.set);
  const scheme0 = useRef<'dark' | 'light'>('dark');
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const accent = 'var(--accent)';

  const open = (t: CustomTheme | null) => {
    scheme0.current = useSettings.getState().settings.colorScheme;
    const d: CustomTheme = t ? { ...t, base: { ...t.base }, vars: { ...t.vars } }
      : { id: '', name: 'Моя тема', scheme: scheme0.current, base: { ...BASE_DEFAULTS[scheme0.current] }, vars: {}, css: '' };
    setThemeEditing(true); setDraft(d); setCode(themeToJson(d)); setCodeErr(''); setMsg(''); setImporting(false);
    previewCustomTheme(d);
  };
  const close = (keep: boolean) => {
    setThemeEditing(false);
    if (!keep) { setSettings({ colorScheme: scheme0.current }); }
    setDraft(null);
    setTimeout(restoreCustomTheme, 0);
  };
  const change = (d: CustomTheme, schemeChanged = false) => {
    setDraft(d); setCode(themeToJson(d)); setCodeErr('');
    if (schemeChanged) { setSettings({ colorScheme: d.scheme }); setTimeout(() => previewCustomTheme(d), 0); } else previewCustomTheme(d);
  };
  const setScheme = (scheme: 'dark' | 'light') => {
    if (!draft || draft.scheme === scheme) return;
    // при смене основы берём её базовые цвета, пока человек не успел их настроить
    const untouched = JSON.stringify(draft.base) === JSON.stringify(BASE_DEFAULTS[draft.scheme]) && !Object.keys(draft.vars).length;
    change({ ...draft, scheme, base: untouched ? { ...BASE_DEFAULTS[scheme] } : draft.base }, true);
  };
  const editCode = (txt: string) => {
    setCode(txt);
    const r = parseTheme(txt);
    if (!r.ok) { setCodeErr(r.reason); return; }
    setCodeErr('');
    const next = { ...r.theme, id: draft?.id ?? '' };
    const schemeChanged = draft && next.scheme !== draft.scheme;
    setDraft(next);
    if (schemeChanged) { setSettings({ colorScheme: next.scheme }); setTimeout(() => previewCustomTheme(next), 0); } else previewCustomTheme(next);
  };
  const save = () => {
    if (!draft) return;
    if (draft.id) { update(draft); close(true); return; }
    const r = parseTheme(themeToJson(draft));
    if (!r.ok) { setMsg(r.reason); return; }
    const a = add(r.theme);
    if (!a.ok) { setMsg(a.reason); return; }
    close(true); activate(r.theme.id);
  };
  const doImport = (txt: string) => {
    const r = parseTheme(txt);
    if (!r.ok) { setMsg(r.reason); return; }
    const a = add(r.theme);
    if (!a.ok) { setMsg(a.reason); return; }
    setImporting(false); setImportText(''); setMsg(r.theme.css ? 'Тема добавлена. В ней есть свой CSS — проверьте её перед применением.' : 'Тема добавлена.');
  };
  const copy = async (t: CustomTheme) => {
    try { await navigator.clipboard.writeText(themeToJson(t)); setMsg('Код темы скопирован.'); } catch { setMsg('Не удалось скопировать — откройте «Изменить → Код» и скопируйте вручную.'); }
  };
  const download = (t: CustomTheme) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([themeToJson(t)], { type: 'application/json' }));
    a.download = `sky-theme-${t.name.replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 30) || 'theme'}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const btn = 'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold';
  const ghost = { background: 'rgba(128,128,128,0.12)', color: 'var(--t2)' } as const;

  return (
    <div className="mb-4 px-1">
      <p className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--t2)' }}>Свои темы</p>

      {!draft && (
        <>
          {themes.length === 0 && <p className="mb-2 text-[12px]" style={{ color: 'var(--t3)' }}>Своих тем пока нет. Соберите тему из четырёх цветов или вставьте код.</p>}
          <div className="space-y-2">
            {themes.map((t) => {
              const on = t.id === activeId; const sw = swatch(t);
              return (
                <div key={t.id} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ border: `1.5px solid ${on ? accent : 'var(--border)'}`, background: on ? 'var(--accent-bg)' : 'transparent' }}>
                  <span className="flex shrink-0 overflow-hidden rounded-lg" style={{ width: 44, height: 30, border: '1px solid rgba(128,128,128,.3)' }}>
                    {sw.map((c, i) => <span key={i} style={{ background: c, flex: 1 }} />)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }} translate="no">{t.name}</span>
                  <button type="button" className={btn} style={on ? { background: accent, color: '#fff' } : ghost} onClick={() => activate(on ? null : t.id)}>{on ? 'Снять' : 'Применить'}</button>
                  <button type="button" aria-label="Изменить" className={btn} style={ghost} onClick={() => open(t)}><Pencil size={12} /></button>
                  <button type="button" aria-label="Копировать код" className={btn} style={ghost} onClick={() => void copy(t)}><Copy size={12} /></button>
                  <button type="button" aria-label="Скачать файл" className={btn} style={ghost} onClick={() => download(t)}><Download size={12} /></button>
                  <button type="button" aria-label="Удалить" className={btn} style={{ ...ghost, color: 'var(--red)' }} onClick={() => { if (window.confirm('Удалить тему?')) remove(t.id); }}><Trash2 size={12} /></button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={`${btn} flex items-center gap-1`} style={{ background: accent, color: '#fff' }} onClick={() => open(null)}><Plus size={12} /> Создать тему</button>
            <button type="button" className={`${btn} flex items-center gap-1`} style={ghost} onClick={() => { setImporting((v) => !v); setMsg(''); }}><Upload size={12} /> Импорт</button>
          </div>
          {importing && (
            <div className="mt-2 space-y-2">
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6} spellCheck={false} placeholder='{ "sky-theme": 1, "name": "…", … }'
                className="w-full rounded-xl p-2.5 font-mono text-[11px]" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} />
              <div className="flex gap-2">
                <button type="button" className={btn} style={{ background: accent, color: '#fff' }} onClick={() => doImport(importText)}>Добавить тему</button>
                <button type="button" className={btn} style={ghost} onClick={() => file.current?.click()}>Из файла…</button>
                <input ref={file} type="file" accept="application/json,.json,.txt" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; if (f.size > 100_000) { setMsg('Файл слишком большой для темы.'); return; } void f.text().then(doImport); }} />
              </div>
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Импортируйте темы только от тех, кому доверяете: в теме может быть свой CSS. Если интерфейс стал неудобным — откройте Sky с адресом, оканчивающимся на ?safe_theme=1.</p>
            </div>
          )}
        </>
      )}

      {draft && (
        <div className="space-y-3 rounded-xl p-3" style={{ border: '1.5px solid var(--accent)', background: 'var(--bg-l1)' }}>
          <input value={draft.name} maxLength={40} onChange={(e) => change({ ...draft, name: e.target.value })} aria-label="Название темы"
            className="w-full rounded-lg px-2.5 py-2 text-[13px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: '1px solid var(--border)' }} translate="no" />
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Основа темы">
            {([['dark', 'Тёмная основа'], ['light', 'Светлая основа']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={draft.scheme === k} onClick={() => setScheme(k)} className={btn}
                style={draft.scheme === k ? { background: 'var(--accent-bg)', color: accent, border: `1.5px solid ${accent}` } : { ...ghost, border: '1.5px solid transparent' }}>{label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {FIELDS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-l2)' }}>
                <input type="color" value={draft.base[k]} onChange={(e) => change({ ...draft, base: { ...draft.base, [k]: e.target.value }, vars: Object.fromEntries(Object.entries(draft.vars).filter(([key]) => (GLASS_KEYS as readonly string[]).includes(key))) })}
                  style={{ width: 28, height: 28, border: 'none', background: 'none', padding: 0 }} />
                <span className="text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</span>
                <span className="ml-auto font-mono text-[10px]" style={{ color: 'var(--t3)' }}>{draft.base[k]}</span>
              </label>
            ))}
          </div>
          {(() => {
            const auto = deriveVars(draft.base);
            const panel = splitColor(draft.vars['--glass-bg'] ?? auto['--glass-bg'], draft.base.panel);
            const lens = splitColor(draft.vars['--glass-lens'] ?? auto['--glass-lens'], draft.base.accent);
            const setPanel = (hex: string, a: number) => change({ ...draft, vars: { ...draft.vars, '--glass-bg': rgba(hex, a), '--glass-border': rgba(mix(hex, draft.base.text, 0.55), 0.45) } });
            const setLens = (hex: string, a: number) => change({ ...draft, vars: { ...draft.vars, '--glass-lens': rgba(hex, a), '--glass-lens-border': rgba(mix(hex, '#ffffff', 0.55), 0.75) } });
            const hasGlass = (GLASS_KEYS as readonly string[]).some((k) => draft.vars[k]);
            return (
              <div className="space-y-2 rounded-lg p-2" style={{ background: 'var(--bg-l2)' }}>
                <p className="text-[12px] font-bold" style={{ color: 'var(--t1)' }}>Панели: нижняя панель и ленты вкладок</p>
                {([['Цвет панели', panel, setPanel, 0.2], ['Цвет выбранного пункта', lens, setLens, 0.05]] as const).map(([label, c, set, min]) => (
                  <div key={label} className="flex items-center gap-2">
                    <input type="color" value={c.hex} aria-label={label} onChange={(e) => set(e.target.value, c.a)} style={{ width: 28, height: 28, border: 'none', background: 'none', padding: 0 }} />
                    <span className="min-w-0 flex-1 text-[12px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</span>
                    <input type="range" min={min} max={1} step={0.05} value={c.a} aria-label={`${label}: непрозрачность`} onChange={(e) => set(c.hex, Number(e.target.value))} style={{ width: 90 }} />
                  </div>
                ))}
                {hasGlass && (
                  <button type="button" className={btn} style={ghost}
                    onClick={() => change({ ...draft, vars: Object.fromEntries(Object.entries(draft.vars).filter(([k]) => !(GLASS_KEYS as readonly string[]).includes(k))) })}>
                    Вернуть цвета панелей по палитре темы
                  </button>
                )}
              </div>
            );
          })()}
          <p className="text-[11px]" style={{ color: 'var(--t3)' }}>Остальные оттенки (границы, второй текст, карточки) считаются сами. Точные значения и свой CSS — в «Коде».</p>
          <button type="button" className={`${btn} flex items-center gap-1`} style={ghost} onClick={() => setShowCode((v) => !v)}><Code2 size={12} /> {showCode ? 'Скрыть код' : 'Код темы'}</button>
          {showCode && (
            <div className="space-y-1">
              <textarea value={code} onChange={(e) => editCode(e.target.value)} rows={12} spellCheck={false} aria-label="Код темы"
                className="w-full rounded-xl p-2.5 font-mono text-[11px]" style={{ background: 'var(--bg-l2)', color: 'var(--t1)', border: `1px solid ${codeErr ? 'var(--red)' : 'var(--border)'}` }} />
              {codeErr && <p role="alert" className="text-[11px]" style={{ color: 'var(--red)' }}>{codeErr}</p>}
              <p className="text-[11px]" style={{ color: 'var(--t3)' }}>В "vars" можно переопределить любую из переменных: --bg, --bg-l1…l4, --t1…t4, --border*, --accent*. В "css" — свои правила; внешние адреса и @import вырезаются.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className={`${btn} flex items-center gap-1`} style={{ background: accent, color: '#fff' }} disabled={!!codeErr} onClick={save}><Check size={12} /> Сохранить</button>
            <button type="button" className={`${btn} flex items-center gap-1`} style={ghost} onClick={() => close(false)}><X size={12} /> Отмена</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-[11px]" style={{ color: 'var(--t2)' }}>{msg}</p>}
    </div>
  );
};
