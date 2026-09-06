/* ===========================================================
   VOICE PARTY  —  типы
=========================================================== */

export type VPRole = 'owner'|'admin'|'moderator'|'speaker'|'listener';
export type VPCategory = 'interests'|'gaming'|'study'|'music'|'business'|'public';

export const CATEGORY_LABEL: Record<VPCategory,string> = {
  interests:'По интересам', gaming:'Игровая', study:'Учебная', music:'Музыкальная вечеринка', business:'Бизнес-встреча', public:'Публичное мероприятие',
};
export const CATEGORY_ICON: Record<VPCategory,string> = {
  interests:'💬', gaming:'🎮', study:'📚', music:'🎧', business:'💼', public:'📣',
};

export interface VPParticipant {
  id: string;             // = accountId для реальных участников
  name: string;
  avatarColor: string;
  role: VPRole;
  muted: boolean;
  handRaised: boolean;
  speaking: boolean;
  joinedAt: string;
  isReal: boolean;        // подключён по-настоящему (WebRTC) или это демо-слушатель для атмосферы
}

export interface VPChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
  pinned: boolean;
}

export interface VPReaction {
  id: string;
  emoji: string;
  memberId: string;
  memberName: string;
  createdAt: string;
}

export interface VPRoomPermissions {
  whoCanSpeak: 'everyone'|'speakersOnly';
  whoCanReact: 'everyone'|'speakersOnly';
  requireApprovalToSpeak: boolean;
}

export interface VPRoom {
  id: string;
  title: string;
  description: string;
  category: VPCategory;
  isPrivate: boolean;
  inviteCode: string;
  ownerId: string;
  maxParticipants: number;
  participants: VPParticipant[];
  messages: VPChatMessage[];
  permissions: VPRoomPermissions;
  createdAt: string;
  scheduledFor?: string;
  ended: boolean;
  screenSharingBy?: string;
  coListening?: { title: string; author: string };
  banned: string[]; // memberIds
}

export const REACTIONS = ['❤️','😂','👏','🔥','😮','🎉'];
