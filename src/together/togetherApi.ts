/**
 * Sky «Вместе»: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается.
 *
 * В частности, `canControl` и `isOwner` ниже — то, что сервер УЖЕ
 * решил. Поставить их себе в true можно, и кнопки нарисуются; нажатие
 * всё равно уйдёт на сервер, а тот спросит роль по своей таблице и
 * ответит отказом.
 *
 * Ни одного байта фильма или трека через эти вызовы не идёт. Файл
 * тянет обычный плеер из своего модуля — здесь только состояние.
 */
import { apiCall } from '@/core/auth/api';

/* ─── Что приходит с сервера ────────────────────────────────────── */

export type SessionType = 'watch' | 'listen';
export type ContentKind = 'movie' | 'track' | 'album' | 'playlist';
export type SessionStatus = 'planned' | 'live' | 'ended';
export type Role = 'owner' | 'participant' | 'moderator' | 'host';
export type PartStatus = 'invited' | 'joined' | 'declined' | 'left' | 'removed';

export interface QueueItem { id: string; ms: number }

/** Часть состояния, одинаковая у всех: что играет, где и как быстро. */
export interface Playback {
  sessionId?: string;
  status: SessionStatus;
  queue: QueueItem[];
  queueIndex: number;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  rate: number;
  seq: number;
  /** Время сервера в миг ответа. По нему считается поправка на задержку. */
  serverTime: number;
}

export interface TogetherSession extends Playback {
  id: string;
  type: SessionType;
  contentKind: ContentKind;
  contentId: string;
  title: string;
  ownerId: string;
  control: 'owner' | 'all';
  maxParticipants: number;
  createdAt?: string;
  startedAt?: string;
  endedAt?: string;
  myRole?: Role;
  myStatus?: PartStatus;
  isOwner: boolean;
  canControl: boolean;
  liveCount?: number;
}

export interface Participant {
  id: string;
  name: string;
  username: string;
  role: Role;
  status: PartStatus;
  invitedAt?: string;
  joinedAt?: string;
  leftAt?: string;
}

export interface Invitation {
  id: string;
  sessionId: string;
  type: SessionType;
  contentKind: ContentKind;
  contentId: string;
  title: string;
  sessionStatus: SessionStatus;
  invitedBy: { id: string; name: string; username: string };
  createdAt?: string;
  expiresAt?: string;
}

export interface Limits {
  types: SessionType[];
  maxParticipantsDefault: number;
  maxParticipantsHard: number;
  maxQueue: number;
}

/** Кого позвать не вышло и почему. */
export interface Skipped { id: string; reason: string }

/* ─── Вызовы ────────────────────────────────────────────────────── */

export const apiTogetherLimits = () =>
  apiCall<Limits>('/api/together/limits');

export const apiTogetherSessions = (status?: 'live' | 'ended') =>
  apiCall<{ sessions: TogetherSession[] }>(
    `/api/together/sessions${status ? `?status=${status}` : ''}`);

export const apiTogetherCreate = (input: {
  type: SessionType;
  contentKind: ContentKind;
  contentId: string;
  title?: string;
  maxParticipants?: number;
  control?: 'owner' | 'all';
}) => apiCall<{ session: TogetherSession }>('/api/together/sessions',
  { method: 'POST', body: JSON.stringify(input) });

export const apiTogetherRead = (sessionId: string) =>
  apiCall<{ session: TogetherSession }>(`/api/together/session/${encodeURIComponent(sessionId)}`);

export const apiTogetherParticipants = (sessionId: string) =>
  apiCall<{ participants: Participant[] }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/participants`);

export const apiTogetherInvite = (sessionId: string, userIds: string[]) =>
  apiCall<{ invited: string[]; skipped: Skipped[] }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/invite`,
    { method: 'POST', body: JSON.stringify({ userIds }) });

export const apiTogetherRemove = (sessionId: string, userId: string) =>
  apiCall<{ ok: true }>(`/api/together/session/${encodeURIComponent(sessionId)}/remove`,
    { method: 'POST', body: JSON.stringify({ userId }) });

export const apiTogetherJoin = (sessionId: string) =>
  apiCall<{ session: TogetherSession }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/join`, { method: 'POST', body: '{}' });

export const apiTogetherLeave = (sessionId: string) =>
  apiCall<{ ok: true; ended: boolean; newOwnerId?: string }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/leave`, { method: 'POST', body: '{}' });

export const apiTogetherEnd = (sessionId: string) =>
  apiCall<{ ok: true }>(`/api/together/session/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST', body: '{}' });

export const apiTogetherSettings = (sessionId: string,
  patch: { control?: 'owner' | 'all'; maxParticipants?: number }) =>
  apiCall<{ session: TogetherSession }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/settings`,
    { method: 'POST', body: JSON.stringify(patch) });

export const apiTogetherInvitations = () =>
  apiCall<{ invitations: Invitation[] }>('/api/together/invitations');

export const apiTogetherAnswer = (invitationId: string, accept: boolean) =>
  apiCall<{ ok: true; accepted: boolean; sessionId: string }>(
    `/api/together/invitation/${encodeURIComponent(invitationId)}/${accept ? 'accept' : 'decline'}`,
    { method: 'POST', body: '{}' });

/** Поиск людей — общий справочник Sky ID, тот же, что в переписке. */
export const apiFindPeople = (q: string) =>
  apiCall<{ people: { id: string; name: string; username: string }[] }>(
    `/api/directory/search?q=${encodeURIComponent(q)}`);

/* ─── Чат комнаты ───────────────────────────────────────────────────
   Отправка — только по сокету (sendRoomMessage в useTogetherSync),
   здесь только история для только что открытого экрана. */

export interface RoomMessage { id: string; senderId: string; text: string; createdAt: string }

export const apiTogetherMessages = (sessionId: string) =>
  apiCall<{ messages: RoomMessage[] }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/messages`);

/* ─── TV-код ─────────────────────────────────────────────────────── */

export const apiTogetherJoinCode = (sessionId: string) =>
  apiCall<{ code: string; expiresInSec: number }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/join-code`,
    { method: 'POST', body: '{}' });

export const apiTogetherRevokeJoinCode = (sessionId: string) =>
  apiCall<{ ok: true }>(
    `/api/together/session/${encodeURIComponent(sessionId)}/join-code`, { method: 'DELETE' });

export const apiTogetherRedeemJoinCode = (code: string) =>
  apiCall<{ session: TogetherSession }>('/api/together/join-code',
    { method: 'POST', body: JSON.stringify({ code }) });

/* ─── Понятные объяснения отказов ───────────────────────────────
   Коды приходят с сервера; человеку показывается то, что можно
   прочитать, а не machine-readable строка.                        */

export const TOGETHER_ERRORS: Record<string, string> = {
  not_found: 'Сессия не найдена или вас в неё не звали.',
  forbidden: 'Это может только владелец сессии.',
  not_controller: 'Воспроизведением управляет владелец.',
  prime_required: 'Кино и музыка в Sky доступны по подписке Sky Prime.',
  content_forbidden: 'У вас нет доступа к этому фильму или треку.',
  content_private: 'Личное содержимое нельзя смотреть вместе: оно видно только владельцу.',
  content_not_found: 'Содержимое не найдено.',
  content_not_ready: 'Файл ещё не загружен.',
  session_ended: 'Сессия уже завершена.',
  session_not_live: 'Сессия ещё не началась.',
  session_full: 'В сессии больше нет мест.',
  invitation_pending: 'Сначала примите приглашение.',
  too_many_sessions: 'У вас слишком много незавершённых сессий.',
  limit_below_current: 'Столько мест уже занято.',
  queue_end: 'Это последняя запись.',
  queue_start: 'Это первая запись.',
  rate_limited: 'Слишком часто. Подождите немного.',
  network: 'Нет связи с сервером.',
  invalid_code: 'Код неверный, устарел или уже использован.',
  empty_message: 'Сообщение пустое.',
};

export const explainTogether = (code?: string) =>
  (code && TOGETHER_ERRORS[code]) || 'Не получилось. Попробуйте ещё раз.';
