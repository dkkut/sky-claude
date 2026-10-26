/** Шрифты интерфейса на выбор. Только Inter лежит у нас файлами; остальные — системные стеки (ничего не качается). */
export interface AppFont { id: string; name: string; stack: string }

export const APP_FONTS: AppFont[] = [
  { id: 'inter',   name: 'Inter',        stack: '' },
  { id: 'system',  name: 'Системный',    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif" },
  { id: 'rounded', name: 'Округлый',     stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Segoe UI', system-ui, sans-serif" },
  { id: 'humanist', name: 'Мягкий',      stack: "'Segoe UI', 'Trebuchet MS', 'Gill Sans', Candara, Verdana, sans-serif" },
  { id: 'serif',   name: 'С засечками',  stack: "'Iowan Old Style', Georgia, Cambria, 'Times New Roman', serif" },
  { id: 'mono',    name: 'Моноширинный', stack: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" },
];
