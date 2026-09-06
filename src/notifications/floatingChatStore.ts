/**
 * floatingChatStore
 * ─────────────────────────────────────────────────────────────────────────────
 * Zustand store: управляет набором открытых плавающих мини-чатов.
 * До 3 одновременных окон (как в LinkedIn/Telegram Web).
 */

import { create } from 'zustand';

export interface FloatingChatEntry {
  chatId:       string;
  senderName:   string;
  senderLetter: string;
  minimized:    boolean;
}

interface FloatingChatState {
  chats:      FloatingChatEntry[];
  openChat:   (chatId: string, senderName: string, senderLetter: string) => void;
  closeChat:  (chatId: string) => void;
  toggleMin:  (chatId: string) => void;
}

const MAX_OPEN = 3;

export const useFloatingChatStore = create<FloatingChatState>((set, get) => ({
  chats: [],

  openChat: (chatId, senderName, senderLetter) => {
    const existing = get().chats.find(c => c.chatId === chatId);
    if (existing) {
      // Уже открыт — разворачиваем если свёрнут
      set(s => ({
        chats: s.chats.map(c =>
          c.chatId === chatId ? { ...c, minimized: false } : c
        ),
      }));
      return;
    }
    const entry: FloatingChatEntry = { chatId, senderName, senderLetter, minimized: false };
    set(s => ({
      chats: [entry, ...s.chats].slice(0, MAX_OPEN),
    }));
  },

  closeChat: (chatId) =>
    set(s => ({ chats: s.chats.filter(c => c.chatId !== chatId) })),

  toggleMin: (chatId) =>
    set(s => ({
      chats: s.chats.map(c =>
        c.chatId === chatId ? { ...c, minimized: !c.minimized } : c
      ),
    })),
}));
