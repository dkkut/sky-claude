/* ===============================================================
   СВОИ ТЕМЫ — настраиваемая тема приложения: четыре базовых цвета (фон, панели, текст, акцент) → остальная палитра
   считается сама; точные значения любых переменных и свой CSS можно задать «кодом» (JSON). Тема переносится текстом:
   экспорт/импорт JSON-строки.

   Формат (поле "sky-theme": 1 обязательно):
   { "sky-theme": 1, "name": "Моя", "scheme": "dark|light",
     "base": { "bg": "#0e0e11", "panel": "#131316", "text": "#ebebed", "accent": "#4f6ef7" },   // необязательно
     "vars": { "--bg-l2": "#1c1c20", … },        // точечные переопределения, только из списка VAR_KEYS
     "css": "…" }                                  // свой CSS, очищается sanitizeCss

   Безопасность: допускаются только перечисленные переменные и цветовые значения; в CSS вырезаются @import,
   внешние url(), expression/javascript:, теги. Тема живёт только на этом устройстве. Свой CSS всё же способен
   перекрыть интерфейс — импортируйте темы только тем, кому доверяете; аварийно отключить: адрес с ?safe_theme=1.
=============================================================== */
import { create } from 'zustand';
import { onAfterApply, useSettings } from './store';

export interface ThemeBase { bg: string; panel: string; text: string; accent: string }
export interface CustomTheme {
  id: string;
  name: string;
  scheme: 'dark' | 'light';
  base: ThemeBase;
  vars: Record<string, string>;
  css: string;
}

export const VAR_KEYS = [
  '--bg', '--bg-l1', '--bg-l2', '--bg-l3', '--bg-l4',
  '--t1', '--t2', '--t3', '--t4',
  '--border', '--border-m', '--border-s',
  '--accent', '--accent-hover', '--accent-active', '--accent-bg', '--accent-bg-m',
] as const;

export const BASE_DEFAULTS: Record<'dark' | 'light', ThemeBase> = {
  dark:  { bg: '#0e0e11', panel: '#131316', text: '#ebebed', accent: '#4f6ef7' },
  light: { bg: '#f4f5f7', panel: '#ffffff', text: '#15161a', accent: '#4f6ef7' },
};

const MAX_THEMES = 20;
const MAX_CSS = 20000;
const SK = 'sky:custom-themes:v1';
const W = typeof window !== 'undefined';

/* ─── цвет ─── */
const HEX = /^#([0-9a-f]{6})$/i;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%deg/]+\))$/i;
const rgb = (h: string): [number, number, number] => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const hex = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
export const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const rgba = (h: string, a: number) => { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; };

/** Полная палитра из четырёх цветов. */
export const deriveVars = (b: ThemeBase): Record<string, string> => ({
  '--bg': b.bg, '--bg-l1': b.panel,
  '--bg-l2': mix(b.panel, b.text, 0.05), '--bg-l3': mix(b.panel, b.text, 0.10), '--bg-l4': mix(b.panel, b.text, 0.16),
  '--t1': b.text, '--t2': mix(b.bg, b.text, 0.62), '--t3': mix(b.bg, b.text, 0.42), '--t4': mix(b.bg, b.text, 0.2),
  '--border': rgba(b.text, 0.08), '--border-m': rgba(b.text, 0.14), '--border-s': rgba(b.text, 0.22),
  '--accent': b.accent, '--accent-hover': mix(b.accent, '#ffffff', 0.12), '--accent-active': mix(b.accent, '#000000', 0.15),
  '--accent-bg': rgba(b.accent, 0.12), '--accent-bg-m': rgba(b.accent, 0.2),
});

export const resolveVars = (t: CustomTheme): Record<string, string> => ({ ...deriveVars(t.base), ...t.vars });

/* ─── очистка ─── */
export const sanitizeCss = (css: string): string => {
  let s = String(css ?? '').slice(0, MAX_CSS);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/@(import|charset|namespace)[^;]*;?/gi, '');
  s = s.replace(/<[^>]*>?/g, '');
  s = s.replace(/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/gi, '');
  // url(): только встроенные картинки data:image/…, никаких внешних адресов (иначе тема следила бы за человеком)
  s = s.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, _q, u: string) => (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(u.trim()) ? m : 'none'));
  return s.trim();
};

const cleanColor = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length <= 64 && COLOR.test(s) ? s : null;
};
const cleanHex = (v: unknown, d: string) => { const s = String(v ?? '').trim(); return HEX.test(s) ? s.toLowerCase() : d; };

const uid = () => `ct-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

/** Разбор темы из объекта/JSON. Возвращает очищенную тему или причину отказа. */
export const parseTheme = (input: unknown): { ok: true; theme: CustomTheme } | { ok: false; reason: string } => {
  let o: unknown = input;
  if (typeof input === 'string') { try { o = JSON.parse(input); } catch { return { ok: false, reason: 'Это не JSON: проверьте запятые и кавычки.' }; } }
  if (!o || typeof o !== 'object') return { ok: false, reason: 'Ожидается объект темы.' };
  const j = o as Record<string, unknown>;
  if (j['sky-theme'] !== 1) return { ok: false, reason: 'Нет поля "sky-theme": 1 — это не тема Sky.' };
  const scheme = j.scheme === 'light' ? 'light' : 'dark';
  const bj = (j.base && typeof j.base === 'object' ? j.base : {}) as Record<string, unknown>;
  const d = BASE_DEFAULTS[scheme];
  const base: ThemeBase = { bg: cleanHex(bj.bg, d.bg), panel: cleanHex(bj.panel, d.panel), text: cleanHex(bj.text, d.text), accent: cleanHex(bj.accent, d.accent) };
  const vars: Record<string, string> = {};
  if (j.vars && typeof j.vars === 'object') {
    for (const [k, v] of Object.entries(j.vars as Record<string, unknown>)) {
      if (!(VAR_KEYS as readonly string[]).includes(k)) continue;
      const c = cleanColor(v);
      if (c) vars[k] = c;
    }
  }
  const name = String(j.name ?? '').replace(/[<>]/g, '').trim().slice(0, 40) || 'Моя тема';
  return { ok: true, theme: { id: uid(), name, scheme, base, vars, css: sanitizeCss(String(j.css ?? '')) } };
};

export const themeToJson = (t: CustomTheme): string => JSON.stringify({
  'sky-theme': 1, name: t.name, scheme: t.scheme, base: t.base,
  ...(Object.keys(t.vars).length ? { vars: t.vars } : {}),
  ...(t.css ? { css: t.css } : {}),
}, null, 2);

/* ─── хранилище ─── */
interface Stored { themes: CustomTheme[]; activeId: string | null }
const load = (): Stored => {
  if (!W) return { themes: [], activeId: null };
  try {
    const j = JSON.parse(localStorage.getItem(SK) || '{}');
    const themes: CustomTheme[] = [];
    for (const t of (Array.isArray(j.themes) ? j.themes : []).slice(0, MAX_THEMES)) {
      const r = parseTheme({ ...t, 'sky-theme': 1 });
      if (r.ok) themes.push({ ...r.theme, id: typeof t.id === 'string' ? t.id.slice(0, 40) : r.theme.id });
    }
    const activeId = themes.some((t) => t.id === j.activeId) ? j.activeId : null;
    return { themes, activeId };
  } catch { return { themes: [], activeId: null }; }
};
const save = (s: Stored) => { try { localStorage.setItem(SK, JSON.stringify(s)); } catch { /* приватный режим */ } };

interface CtState extends Stored {
  add: (t: CustomTheme) => { ok: true } | { ok: false; reason: string };
  update: (t: CustomTheme) => void;
  remove: (id: string) => void;
  activate: (id: string | null) => void;
}

export const useCustomThemes = create<CtState>((set, get) => ({
  ...load(),
  add: (t) => {
    if (get().themes.length >= MAX_THEMES) return { ok: false, reason: `Можно хранить до ${MAX_THEMES} тем — удалите ненужные.` };
    const next = { themes: [...get().themes, t], activeId: get().activeId };
    save(next); set(next); return { ok: true };
  },
  update: (t) => { const next = { themes: get().themes.map((x) => (x.id === t.id ? t : x)), activeId: get().activeId }; save(next); set(next); if (next.activeId === t.id) applyCustomTheme(t); },
  remove: (id) => {
    const activeId = get().activeId === id ? null : get().activeId;
    const next = { themes: get().themes.filter((x) => x.id !== id), activeId }; save(next); set(next);
    if (get().activeId === null) applyCustomTheme(null);
  },
  activate: (id) => {
    const t = id ? get().themes.find((x) => x.id === id) ?? null : null;
    const next = { themes: get().themes, activeId: t ? t.id : null }; save(next); set(next);
    if (t) {
      // тема задаёт светлую/тёмную основу; сезонная тема и автопереключение с ней не ужились бы
      useSettings.getState().set({ colorScheme: t.scheme, season: 'none', autoTheme: false });
    }
    applyCustomTheme(t);
  },
}));

/* ─── применение ─── */
let appliedVars: string[] = [];
/** Пока открыт редактор, действует предпросмотр черновика: подписчик не снимает и не возвращает сохранённую тему. */
let editing = false;
export const setThemeEditing = (v: boolean) => { editing = v; };
const STYLE_ID = 'sky-custom-theme-css';

/** Накладывает тему поверх применённых настроек; null — снимает. Безопасно вызывать сколько угодно раз. */
export const applyCustomTheme = (t: CustomTheme | null) => {
  if (!W) return;
  const root = document.documentElement;
  appliedVars.forEach((k) => root.style.removeProperty(k)); appliedVars = [];
  document.getElementById(STYLE_ID)?.remove();
  if (!t || root.dataset.forceDark === '1') { delete root.dataset.customTheme; if (!t) useSettings.getState().set({}); return; }
  for (const [k, v] of Object.entries(resolveVars(t))) { root.style.setProperty(k, v); appliedVars.push(k); }
  root.dataset.customTheme = t.id;
  if (t.css) { const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = sanitizeCss(t.css); document.head.appendChild(el); }
};

/** Предпросмотр черновика без сохранения. */
export const previewCustomTheme = (t: CustomTheme | null) => applyCustomTheme(t);
/** Вернуть то, что действительно выбрано (после отмены предпросмотра). */
export const restoreCustomTheme = () => {
  const { themes, activeId } = useCustomThemes.getState();
  applyCustomTheme(themes.find((x) => x.id === activeId) ?? null);
};

if (W) {
  // Каждый раз, когда applySettings переставляет переменные, возвращаем свою тему; сменил светлую/тёмную вручную — тему снимаем.
  onAfterApply(() => {
    if (editing) return;
    const { themes, activeId } = useCustomThemes.getState();
    const t = themes.find((x) => x.id === activeId);
    if (!t) return;
    if (document.documentElement.dataset.forceDark !== '1' && useSettings.getState().settings.colorScheme !== t.scheme) {
      useCustomThemes.setState({ activeId: null }); save({ themes, activeId: null });
      document.getElementById(STYLE_ID)?.remove(); appliedVars = []; delete document.documentElement.dataset.customTheme;
      return;
    }
    // applySettings только что перезаписал/убрал свои переменные — ставим наши заново, не трогая список снятия
    const root = document.documentElement;
    for (const [k, v] of Object.entries(resolveVars(t))) { root.style.setProperty(k, v); if (!appliedVars.includes(k)) appliedVars.push(k); }
    root.dataset.customTheme = t.id;
    if (!document.getElementById(STYLE_ID) && t.css) { const el = document.createElement('style'); el.id = STYLE_ID; el.textContent = sanitizeCss(t.css); document.head.appendChild(el); }
  });
  if (/[?&]safe_theme=1\b/.test(location.search)) { useCustomThemes.setState({ activeId: null }); save({ themes: useCustomThemes.getState().themes, activeId: null }); }
  setTimeout(restoreCustomTheme, 0);
}
