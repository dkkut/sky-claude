/* ===============================================================
   ОБЩИЙ ТИП ИКОНКИ

   Иконки lucide-react объявлены как ForwardRefExoticComponent<LucideProps>,
   где size и strokeWidth — это string | number. Локальные описания вида
   ComponentType<{ size?: number }> под них не подходят, поэтому пропсы
   здесь совпадают с lucide по ширине типов.
=============================================================== */
import type { ComponentType, CSSProperties } from 'react';

export interface IconProps {
  size?:        string | number;
  className?:   string;
  style?:       CSSProperties;
  strokeWidth?: string | number;
  color?:       string;
}

/** Компонент иконки — подходит любая иконка lucide-react. */
export type IconComponent = ComponentType<IconProps>;
