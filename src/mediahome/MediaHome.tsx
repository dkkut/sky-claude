import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { Settings2, X, GripVertical, Undo2, RotateCcw } from 'lucide-react';
import { apiHome, apiLayoutActivate, apiLayoutCreate, apiLayoutDelete, apiLayoutSave, type HomeLayout, type HomeState, type LayoutRow, type WidgetDef, type WidgetSize } from './api';
import { ALL_ACTIONS, CATEGORIES, WIDGET_META, WidgetBody, WidgetBoundary } from './widgets';
import { WaveShelves } from './WaveShelves';
import { visibleTick } from '@/shared/visibleTick';

const LOCAL_KEY = 'sky:mediahome:local:v1';
const uid = (t: string) => `${t}-${Math.random().toString(36).slice(2, 10)}`;
const mk = (type: string, size: WidgetSize = 'standard'): WidgetDef => ({ id: uid(type), type, size, cfg: {} });
const defaultLayout = (): HomeLayout => ({ v: 1, density: 'normal', surface: 'glass', accent: null, widgets: [mk('clock'), mk('weather', 'compact'), mk('nowplaying'), mk('wave', 'wide'), mk('continue', 'wide'), mk('unread', 'compact'), mk('points', 'compact'), mk('quick', 'wide')] });
const SIZE_LABEL: Record<WidgetSize, string> = { compact: 'Компактный', standard: 'Стандартный', wide: 'Расширенный' };
const SPAN: Record<WidgetSize, string> = { compact: 'col-span-1', standard: 'col-span-1 sm:col-span-2', wide: 'col-span-1 sm:col-span-2 lg:col-span-4' };
const PAD = { cozy: 'p-5', normal: 'p-4', dense: 'p-3' } as const;
const SURF = {
  glass: { background: 'var(--glass-bg, rgba(255,255,255,.05))', backdropFilter: 'blur(14px)', border: '1px solid var(--border)' },
  solid: { background: 'var(--bg-l2, #14141c)', border: '1px solid var(--border)' },
  clear: { background: 'transparent', border: '1px dashed var(--border)' },
} as const;

const readLocal = (): HomeLayout | null => { try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); return v?.widgets ? v : null; } catch { return null; } };
const writeLocal = (l: HomeLayout) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(l)); } catch { /* память недоступна */ } };

export const MediaHome = ({ onNav, onClassic }: { onNav: (t: string) => void; onClassic: () => void }) => {
  const [state, setState] = useState<HomeState | null>(null);
  const [offline, setOffline] = useState(false);
  const [layout, setLayout] = useState<HomeLayout>(() => readLocal() ?? defaultLayout());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<HomeLayout[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [catOpen, setCatOpen] = useState(false);
  const editingRef = useRef(false); editingRef.current = editing;

  const apply = useCallback((s: HomeState) => {
    setState(s); const act = s.layouts.find((l) => l.active) ?? s.layouts[0];
    if (act) { setActiveId(act.id); if (!editingRef.current) { setLayout(act.layout); writeLocal(act.layout); } }
  }, []);
  const load = useCallback(async () => { const s = await apiHome(); if (s) { setOffline(false); apply(s); } else setOffline(true); }, [apply]);
  useEffect(() => { void load(); const t = window.setInterval(visibleTick(() => void load()), 300000); return () => window.clearInterval(t); }, [load]);

  const change = (fn: (l: HomeLayout) => HomeLayout) => { setHistory((h) => [...h.slice(-19), layout]); setLayout((l) => fn(l)); };
  const undo = () => setHistory((h) => { const p = h[h.length - 1]; if (p) setLayout(p); return h.slice(0, -1); });
  const limits = state?.limits ?? { widgets: 24, layouts: 8, custom: 12 };
  const registry = state?.registry ?? [];

  const save = async () => {
    setSaving(true); setMsg('');
    writeLocal(layout);
    if (activeId) {
      const r = await apiLayoutSave(activeId, { layout });
      if (r.ok) { setMsg('Сохранено'); setHistory([]); setEditing(false); await load(); } else setMsg('Не удалось сохранить на сервере — экран сохранён на этом устройстве.');
    } else { setMsg('Сохранено на этом устройстве'); setEditing(false); }
    setSaving(false);
  };
  const cancel = () => { const act = state?.layouts.find((l) => l.id === activeId); setLayout(act?.layout ?? readLocal() ?? defaultLayout()); setHistory([]); setEditing(false); };

  const variantAct = async (kind: 'create' | 'copy' | 'rename' | 'delete' | 'switch', id?: string) => {
    if (kind === 'create' || kind === 'copy') {
      const name = window.prompt('Название экрана', kind === 'copy' ? 'Копия' : 'Новый экран'); if (!name) return;
      const r = await apiLayoutCreate(kind === 'copy' ? { name, copyOf: activeId ?? undefined } : { name });
      if (!r.ok) setMsg(r.data?.error === 'too_many_layouts' ? `Не больше ${limits.layouts} экранов` : 'Не удалось создать экран');
    } else if (kind === 'rename' && id) {
      const cur = state?.layouts.find((l) => l.id === id); const name = window.prompt('Новое название', cur?.name ?? ''); if (!name) return; await apiLayoutSave(id, { name });
    } else if (kind === 'delete' && id) {
      if (!window.confirm('Удалить этот вариант экрана?')) return;
      const r = await apiLayoutDelete(id); if (!r.ok) setMsg('Нельзя удалить последний экран');
    } else if (kind === 'switch' && id) await apiLayoutActivate(id);
    setHistory([]); setEditing(false); await load();
  };

  const update = (id: string, p: Partial<WidgetDef>) => change((l) => ({ ...l, widgets: l.widgets.map((w) => (w.id === id ? { ...w, ...p, cfg: { ...w.cfg, ...(p.cfg ?? {}) } } : w)) }));
  const remove = (id: string) => change((l) => ({ ...l, widgets: l.widgets.filter((w) => w.id !== id) }));
  const add = (type: string) => {
    if (layout.widgets.length >= limits.widgets) { setMsg(`Не больше ${limits.widgets} виджетов`); return; }
    if (type === 'custom' && layout.widgets.filter((w) => w.type === 'custom').length >= limits.custom) { setMsg(`Не больше ${limits.custom} своих виджетов`); return; }
    const sizes = registry.find((r) => r.type === type)?.sizes ?? ['standard'];
    const w = mk(type, sizes.includes('standard') ? 'standard' : sizes[0]);
    if (type === 'custom') w.cfg = { template: 'note', title: 'Мой виджет' };
    change((l) => ({ ...l, widgets: [...l.widgets, w] })); setCatOpen(false);
  };

  const catalog = useMemo(() => {
    const by: Record<string, string[]> = {};
    for (const r of registry) (by[WIDGET_META[r.type]?.cat ?? r.cat] ||= []).push(r.type);
    return by;
  }, [registry]);

  const gridCls = layout.density === 'dense' ? 'gap-2' : layout.density === 'cozy' ? 'gap-5' : 'gap-3';

  return (
    <div data-mediahome className="h-full overflow-y-auto overflow-x-hidden px-3 pb-24 pt-3 md:px-6" style={layout.accent ? ({ ['--accent' as string]: layout.accent } as React.CSSProperties) : undefined}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[18px] font-extrabold" style={{ color: 'var(--t1)' }}>Главная Sky Media</h2>
        {!editing && <button type="button" onClick={onClassic} className="rounded-full border px-3 py-1.5 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--t2)' }}>Классический вид</button>}
        {!editing ? <button type="button" onClick={() => setEditing(true)} className="glass-btn flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--t1)' }}><Settings2 size={14} /> Настроить экран</button>
          : <><button type="button" onClick={undo} disabled={!history.length} aria-label="Отменить последнее" className="grid h-8 w-8 place-items-center rounded-full border disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}><Undo2 size={14} /></button>
              <button type="button" onClick={() => { if (window.confirm('Вернуть экран по умолчанию?')) change(() => defaultLayout()); }} className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--t2)' }}><RotateCcw size={12} /> Сбросить</button>
              <button type="button" onClick={cancel} className="rounded-full border px-3 py-1.5 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--t2)' }}>Отмена</button>
              <button type="button" onClick={() => void save()} disabled={saving} className="rounded-full px-4 py-1.5 text-[12px] font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></>}
      </div>
      {offline && <p className="mb-2 text-[12px]" style={{ color: 'var(--t3)' }}>Нет связи с сервером — показан экран, сохранённый на этом устройстве.</p>}
      {msg && <p role="status" className="mb-2 text-[12px]" style={{ color: 'var(--t2)' }}>{msg}</p>}

      {editing && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
            <span>Варианты экрана:</span>
            {(state?.layouts ?? []).map((l: LayoutRow) => (
              <span key={l.id} className="flex items-center gap-1 rounded-full border px-2 py-1" style={{ borderColor: l.id === activeId ? 'var(--accent)' : 'var(--border)' }}>
                <button type="button" onClick={() => void variantAct('switch', l.id)} style={{ color: 'var(--t1)' }} translate="no">{l.name}</button>
                <button type="button" aria-label="Переименовать" onClick={() => void variantAct('rename', l.id)}>✎</button>
                <button type="button" aria-label="Удалить" onClick={() => void variantAct('delete', l.id)}><X size={11} /></button>
              </span>))}
            <button type="button" className="underline" onClick={() => void variantAct('create')}>+ Новый</button>
            <button type="button" className="underline" onClick={() => void variantAct('copy')}>Копировать</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--t2)' }}>
            <label className="flex items-center gap-1">Плотность
              <select value={layout.density} onChange={(e) => change((l) => ({ ...l, density: e.target.value as HomeLayout['density'] }))} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}>
                <option value="cozy">Свободно</option><option value="normal">Обычная</option><option value="dense">Плотно</option></select></label>
            <label className="flex items-center gap-1">Оформление
              <select value={layout.surface} onChange={(e) => change((l) => ({ ...l, surface: e.target.value as HomeLayout['surface'] }))} className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}>
                <option value="glass">Стекло</option><option value="solid">Сплошное</option><option value="clear">Прозрачное</option></select></label>
            <label className="flex items-center gap-1">Акцент
              <input type="color" value={layout.accent ?? '#6366f1'} onChange={(e) => change((l) => ({ ...l, accent: e.target.value }))} aria-label="Цвет акцента" />
              {layout.accent && <button type="button" className="underline" onClick={() => change((l) => ({ ...l, accent: null }))}>тема</button>}</label>
            <button type="button" onClick={() => setCatOpen((v) => !v)} className="ml-auto rounded-full px-3 py-1.5 font-semibold" style={{ background: 'var(--accent)', color: '#fff' }}>+ Добавить виджет</button>
          </div>
          {catOpen && (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(catalog).map(([cat, types]) => (
                <div key={cat}><div className="mb-1 text-[11px] font-semibold uppercase" style={{ color: 'var(--t3)' }}>{CATEGORIES[cat] ?? cat}</div>
                  {types.map((t) => <button key={t} type="button" onClick={() => add(t)} className="mb-1 block w-full rounded-xl border px-3 py-2 text-left text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}>
                    {WIDGET_META[t]?.label ?? t}<span className="block text-[11px]" style={{ color: 'var(--t3)' }}>{WIDGET_META[t]?.hint}</span></button>)}
                </div>))}
            </div>)}
        </div>)}

      {editing ? (
        <Reorder.Group axis="y" values={layout.widgets} onReorder={(v) => change((l) => ({ ...l, widgets: v }))} className="flex flex-col gap-3">
          {layout.widgets.map((w) => {
            const sizes = registry.find((r) => r.type === w.type)?.sizes ?? ['standard'];
            return (
              <Reorder.Item key={w.id} value={w} className={`rounded-2xl ${PAD[layout.density]}`} style={SURF[layout.surface]}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
                  <GripVertical size={16} aria-label="Перетащить" style={{ cursor: 'grab' }} />
                  <b className="flex-1" style={{ color: 'var(--t1)' }}>{WIDGET_META[w.type]?.label ?? w.type}</b>
                  <select value={w.size} onChange={(e) => update(w.id, { size: e.target.value as WidgetSize })} aria-label="Размер" className="rounded-lg border bg-transparent px-2 py-1" style={{ borderColor: 'var(--border)', color: 'var(--t1)' }}>
                    {sizes.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}</select>
                  <button type="button" aria-label="Убрать виджет" onClick={() => remove(w.id)}><X size={16} /></button>
                </div>
                <WidgetConfig w={w} onChange={(cfg) => update(w.id, { cfg })} />
                <div className="pointer-events-none opacity-90"><WidgetBoundary><WidgetBody w={w} onNav={onNav} /></WidgetBoundary></div>
              </Reorder.Item>);
          })}
        </Reorder.Group>
      ) : (
        <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${gridCls}`}>
          {layout.widgets.map((w) => (
            <div key={w.id} className={`min-w-0 rounded-2xl ${PAD[layout.density]} ${SPAN[w.size]}`} style={SURF[layout.surface]}><WidgetBoundary><WidgetBody w={w} onNav={onNav} /></WidgetBoundary></div>))}
        </div>)}
      {!editing && layout.widgets.length === 0 && <p className="text-[13px]" style={{ color: 'var(--t2)' }}>Экран пуст. Нажмите «Настроить экран» и добавьте виджеты.</p>}

      {!editing && (
        <div className="mt-6"><h2 className="mb-3 text-[16px] font-extrabold" style={{ color: 'var(--t1)' }}>SkyWave</h2><WaveShelves onNav={onNav} manage /></div>)}
    </div>
  );
};

/** Настройки конкретного виджета — только поля из схемы сервера. */
const WidgetConfig = ({ w, onChange }: { w: WidgetDef; onChange: (cfg: Record<string, unknown>) => void }) => {
  const inp = 'rounded-lg border bg-transparent px-2 py-1 text-[12px]';
  const st = { borderColor: 'var(--border)', color: 'var(--t1)' } as const;
  if (w.type === 'clock') return <div className="mb-2 flex gap-4 text-[12px]" style={{ color: 'var(--t2)' }}>
    <label><input type="checkbox" checked={w.cfg.format24 !== false} onChange={(e) => onChange({ format24: e.target.checked })} /> 24 часа</label>
    <label><input type="checkbox" checked={w.cfg.seconds === true} onChange={(e) => onChange({ seconds: e.target.checked })} /> Секунды</label></div>;
  if (w.type === 'analytics') return <label className="mb-2 block text-[12px]" style={{ color: 'var(--t2)' }}>Период{' '}
    <select value={String(w.cfg.period ?? 'month')} onChange={(e) => onChange({ period: e.target.value })} className={inp} style={st}><option value="day">День</option><option value="week">Неделя</option><option value="month">Месяц</option></select></label>;
  if (w.type === 'unread') return <label className="mb-2 block text-[12px]" style={{ color: 'var(--t2)' }}><input type="checkbox" checked={w.cfg.showText === true} onChange={(e) => onChange({ showText: e.target.checked })} /> Показывать названия чатов</label>;
  if (w.type === 'wave') return <label className="mb-2 block text-[12px]" style={{ color: 'var(--t2)' }}>Подборка{' '}
    <select value={String(w.cfg.shelf ?? 'for_you')} onChange={(e) => onChange({ shelf: e.target.value })} className={inp} style={st}>
      {[['for_you', 'Для тебя'], ['new', 'Новое в Sky'], ['trending', 'В тренде'], ['similar', 'Похожие на любимые'], ['discover', 'Открой новое'], ['evening', 'На вечер'], ['short', 'Короткий перерыв'], ['collection', 'Твоя коллекция'], ['recent', 'Недавно добавлено'], ['return', 'Вернись к этому'], ['together', 'Вместе интереснее']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  if (w.type === 'quick') return <div className="mb-2 flex flex-wrap gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>{ALL_ACTIONS.map((a) => { const cur = (Array.isArray(w.cfg.actions) ? w.cfg.actions as string[] : ['music', 'film', 'video', 'messenger', 'go', 'ai']); const on = cur.includes(a);
    return <label key={a}><input type="checkbox" checked={on} onChange={() => onChange({ actions: on ? cur.filter((x) => x !== a) : [...cur, a] })} /> {a}</label>; })}</div>;
  if (w.type === 'worldtime') return <label className="mb-2 block text-[12px]" style={{ color: 'var(--t2)' }}>Пояса (через запятую, например Europe/Berlin)
    <input className={`${inp} mt-1 w-full`} style={st} defaultValue={(Array.isArray(w.cfg.zones) ? w.cfg.zones as string[] : []).join(', ')} onBlur={(e) => onChange({ zones: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>;
  if (w.type === 'custom') return (
    <div className="mb-2 grid gap-2 text-[12px]" style={{ color: 'var(--t2)' }}>
      <select value={String(w.cfg.template ?? 'note')} onChange={(e) => onChange({ template: e.target.value })} className={inp} style={st}><option value="note">Заметка</option><option value="counter">Счётчик</option><option value="link">Ссылка (https)</option><option value="progress">Прогресс</option></select>
      <input className={inp} style={st} maxLength={40} placeholder="Заголовок" value={String(w.cfg.title ?? '')} onChange={(e) => onChange({ title: e.target.value })} />
      <input className={inp} style={st} maxLength={80} placeholder="Текст" value={String(w.cfg.value ?? '')} onChange={(e) => onChange({ value: e.target.value })} />
      {w.cfg.template === 'link' && <input className={inp} style={st} placeholder="https://…" defaultValue={String(w.cfg.url ?? '')} onBlur={(e) => onChange({ url: e.target.value })} />}
      <p className="text-[10px]" style={{ color: 'var(--t3)' }}>Только безопасные шаблоны — свой код выполнить нельзя.</p>
    </div>);
  return null;
};
