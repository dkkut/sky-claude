/* ===============================================================
   PROFILE VIEWER — общие типы
=============================================================== */
import type { ComponentType, CSSProperties } from 'react';

/** Достаточно узкий тип, под который подходит любая иконка lucide-react. */
export interface IconProps {
  size?:        number;
  className?:   string;
  style?:       CSSProperties;
  strokeWidth?: number;
}

/** Лёгкая карточка человека для списков (друзья, подписчики, участники…) */
export interface PersonEntry {
  id:       string;
  name:     string;
  username: string;
  avatar?:  string;
  sub?:     string;   // подпись под именем (например «Взаимный друг», «Автор группы»)
}

export type QuickActionId =
  | 'message' | 'call' | 'videoCall'
  | 'addFriend' | 'removeFriend' | 'acceptFriend'
  | 'follow'
  | 'gift' | 'transfer'
  | 'inviteGroup' | 'inviteChannel' | 'inviteCall'
  | 'share' | 'copyLink'
  | 'report' | 'block' | 'hide'
  | 'editProfile';

export interface QuickAction {
  id:       QuickActionId;
  label:    string;
  icon:     ComponentType<IconProps>;
  onClick:  () => void;
  danger?:  boolean;
  primary?: boolean;
  disabled?: boolean;
}
