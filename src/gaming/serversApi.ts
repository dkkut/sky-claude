/* ===============================================================
   ИГРОВЫЕ СЕРВЕРЫ — разговор с сервером (server/gameservers.mjs,
   routes/gameservers.mjs). Права и роли решает только сервер.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export type GRole = 'owner' | 'moderator' | 'member';
export type GChannelType = 'text' | 'voice' | 'announce';

export interface ServerLite {
  id: string; name: string; icon: string; description: string;
  ownerId: string; isPublic: boolean; members: number;
}
export interface ServerFull extends ServerLite { myRole: GRole; inviteCode?: string }
export interface GCategory { id: string; name: string; position: number }
export interface GChannel {
  id: string; name: string; type: GChannelType; categoryId: string; position: number;
  voiceMembers: { id: string; name: string }[];
}
export interface GMember { id: string; role: GRole; name: string; username?: string; avatar?: string | null }
export interface GMessage { id: string; channelId: string; authorId: string; authorName: string; text: string; createdAt: string }

export interface ServerDetail { server: ServerFull; categories: GCategory[]; channels: GChannel[]; members: GMember[] }

const enc = encodeURIComponent;
const post = (path: string, body: unknown = {}) => apiCall<any>(path, { method: 'POST', body: JSON.stringify(body) });

export const apiServers = () => apiCall<{ mine: ServerLite[]; open: ServerLite[] }>('/api/gaming/servers');
export const apiCreateServer = (b: { name: string; icon: string; description?: string; isPublic: boolean }) =>
  post('/api/gaming/servers', b) as Promise<{ ok: boolean; data?: { id: string }; error?: string; reason?: string }>;
export const apiServer = (id: string) => apiCall<ServerDetail>(`/api/gaming/servers/${enc(id)}`);
export const apiJoinServer = (id: string, code?: string) => post(`/api/gaming/servers/${enc(id)}/join`, { code });
export const apiJoinByCode = (code: string) => post('/api/gaming/servers/join-code', { code }) as Promise<{ ok: boolean; data?: { serverId: string }; error?: string }>;
export const apiLeaveServer = (id: string) => post(`/api/gaming/servers/${enc(id)}/leave`);
export const apiDeleteServer = (id: string) => apiCall(`/api/gaming/servers/${enc(id)}`, { method: 'DELETE' });
export const apiCreateChannel = (serverId: string, b: { name: string; type: GChannelType }) =>
  post(`/api/gaming/servers/${enc(serverId)}/channels`, b) as Promise<{ ok: boolean; data?: { id: string }; error?: string }>;
export const apiDeleteChannel = (id: string) => apiCall(`/api/gaming/channels/${enc(id)}`, { method: 'DELETE' });
export const apiChannelMessages = (id: string, before?: string) =>
  apiCall<{ messages: GMessage[]; hasMore?: boolean }>(`/api/gaming/channels/${enc(id)}/messages${before ? `?before=${enc(before)}` : ''}`);
export const apiSendMessage = (id: string, text: string) =>
  post(`/api/gaming/channels/${enc(id)}/messages`, { text }) as Promise<{ ok: boolean; data?: { message: GMessage }; error?: string }>;
export const apiDeleteMessage = (id: string) => apiCall(`/api/gaming/messages/${enc(id)}`, { method: 'DELETE' });
export const apiChannelVoice = (id: string) =>
  post(`/api/gaming/channels/${enc(id)}/voice`) as Promise<{ ok: boolean; data?: { roomId: string }; error?: string }>;
export const apiKickMember = (serverId: string, userId: string, ban: boolean) =>
  apiCall(`/api/gaming/servers/${enc(serverId)}/members/${enc(userId)}${ban ? '?ban=1' : ''}`, { method: 'DELETE' });
export const apiSetMemberRole = (serverId: string, userId: string, role: 'moderator' | 'member') =>
  post(`/api/gaming/servers/${enc(serverId)}/members/${enc(userId)}/role`, { role });

export const GS_ERRORS: Record<string, string> = {
  not_found: 'Сервер или канал не найден — возможно, его удалили.',
  not_member: 'Вы не участник этого сервера.',
  not_allowed: 'Это действие доступно только владельцу или модератору.',
  banned: 'Вас исключили с этого сервера.',
  private_server: 'Сервер закрытый — нужен код приглашения.',
  too_many_servers: 'Достигнут предел числа серверов.',
  too_many_channels: 'На сервере уже максимум каналов (40).',
  owner_cannot_leave: 'Владелец не может уйти: удалите сервер или передайте его.',
  last_text_channel: 'Нельзя удалить последний текстовый канал.',
  invalid_name: 'Название слишком короткое.',
  bad_code: 'Код приглашения не подошёл.',
  empty: 'Введите сообщение.',
  too_long: 'Сообщение длиннее 2000 символов.',
  announce_only: 'В этот канал пишут только владелец и модераторы.',
  voice_channel: 'В голосовой канал нельзя писать сообщения.',
  rate_limited: 'Слишком часто. Подождите немного.',
  room_full: 'В голосовом канале нет мест.',
};
export const gsError = (code?: string) => (code && GS_ERRORS[code]) || 'Не получилось. Попробуйте ещё раз.';
