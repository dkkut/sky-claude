/* ===============================================================
   MOBILE DESIGN TOKENS
   Единая система компактных размеров для мобильной адаптации.
   Никогда не меняет desktop — только предоставляет готовые
   className-строки, которые компонент выбирает по isMobile.

   Использование:
     import { mt } from '@/interface/mobile/tokens';
     const isMobile = useIsMobile();
     <div className={mt(isMobile).cardPad}>...

   Принцип: тот же дизайн, тот же компонент — просто более плотные
   отступы/шрифты/иконки на мобильном. Никакого scale(), никакой
   отдельной мобильной версии контента.
=============================================================== */

export interface MobileTokens {
  // -- Контейнеры и карточки --
  pagePad:      string; // горизонтальный отступ страницы/экрана
  cardPad:      string; // внутренний отступ обычной карточки
  cardPadSm:    string; // внутренний отступ компактной карточки (виджеты, чипы)
  cardGap:      string; // расстояние между карточками в списке/сетке
  sectionGap:   string; // вертикальный отступ между секциями страницы
  radiusLg:     string; // крупный радиус скругления (héro, модалки)
  radiusMd:     string; // обычный радиус карточки

  // -- Типографика --
  h1:           string; // главный заголовок экрана
  h2:           string; // заголовок секции
  h3:           string; // подзаголовок / заголовок карточки
  body:         string; // обычный текст
  caption:      string; // второстепенный текст / подписи
  micro:        string; // самый мелкий текст (метки, бейджи)

  // -- Иконки и аватары --
  iconLg:       number; // крупная декоративная иконка (héro)
  iconMd:       number; // обычная иконка в карточке
  iconSm:       number; // иконка в списке/кнопке
  avatarLg:     number; // крупный аватар (профиль, héro)
  avatarMd:     number; // обычный аватар (списки)
  avatarSm:     number; // мелкий аватар (комментарии, мини-профили)

  // -- Кнопки --
  btnPad:       string; // padding обычной кнопки
  btnPadSm:     string; // padding компактной кнопки
  btnText:      string; // размер текста кнопки
  btnHeight:    number; // высота стандартной кнопки, px

  // -- Списки --
  listItemPad:  string; // padding строки списка
  listGap:      string; // расстояние между строками списка

  // -- Header / нижняя навигация --
  headerH:      number; // высота верхней панели, px
  tabBarH:      number; // высота нижней навигации, px
}

const MOBILE: MobileTokens = {
  pagePad:    'px-3',
  cardPad:    'p-3',
  cardPadSm:  'px-2.5 py-2',
  cardGap:    'gap-2',
  sectionGap: 'gap-3',
  radiusLg:   'rounded-2xl',
  radiusMd:   'rounded-xl',

  h1:      'text-lg font-extrabold',
  h2:      'text-sm font-bold',
  h3:      'text-[13px] font-bold',
  body:    'text-[13px]',
  caption: 'text-[11px]',
  micro:   'text-[10px]',

  iconLg: 22, iconMd: 17, iconSm: 14,
  avatarLg: 64, avatarMd: 40, avatarSm: 28,

  btnPad:   'px-3.5 py-2',
  btnPadSm: 'px-2.5 py-1.5',
  btnText:  'text-[13px] font-semibold',
  btnHeight: 38,

  listItemPad: 'px-3 py-2',
  listGap:     'gap-1.5',

  headerH: 52,
  tabBarH: 56,
};

const DESKTOP: MobileTokens = {
  pagePad:    'px-6',
  cardPad:    'p-5',
  cardPadSm:  'px-3.5 py-2.5',
  cardGap:    'gap-3',
  sectionGap: 'gap-5',
  radiusLg:   'rounded-3xl',
  radiusMd:   'rounded-2xl',

  h1:      'text-2xl font-extrabold',
  h2:      'text-lg font-bold',
  h3:      'text-base font-bold',
  body:    'text-sm',
  caption: 'text-xs',
  micro:   'text-[11px]',

  iconLg: 32, iconMd: 22, iconSm: 16,
  avatarLg: 96, avatarMd: 52, avatarSm: 36,

  btnPad:   'px-5 py-3',
  btnPadSm: 'px-3.5 py-2',
  btnText:  'text-sm font-semibold',
  btnHeight: 46,

  listItemPad: 'px-4 py-3',
  listGap:     'gap-2.5',

  headerH: 64,
  tabBarH: 0,
};

/** Возвращает набор токенов под текущий режим. Использование: mt(isMobile).cardPad */
export const mt = (isMobile: boolean): MobileTokens => isMobile ? MOBILE : DESKTOP;
