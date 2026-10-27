import { apiCall, apiBlob, apiRawAuthed } from '@/core/auth/api';

export type ServerKind = 'gta' | 'minecraft';
export interface LServer {
  id: string; kind: ServerKind; platform: string; name: string; descr: string; host: string; port: number; version: string; mode: string; region: string;
  statusKnown: boolean; online: boolean | null; players: number | null; maxPlayers: number | null; motd: string; checkedAt: string | null; passwordRequired: boolean; note: string; favorite: boolean;
  lastAt?: string; count?: number;
}
export interface ConnectInfo { address: string; host: string; port: number; passwordRequired: boolean; launchSupported: boolean; uri: string | null; instructions: string }
export interface LProfile { id: string; kind: ServerKind; name: string; data: Record<string, any>; updatedAt: string }

const q = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
const post = (path: string, b: unknown = {}) => apiCall<any>(path, { method: 'POST', body: JSON.stringify(b) });
const put = (path: string, b: unknown = {}) => apiCall<any>(path, { method: 'PUT', body: JSON.stringify(b) });
const del = (path: string) => apiCall<any>(path, { method: 'DELETE' });

export const lApi = {
  servers: (o: Record<string, unknown>) => apiCall<{ servers: LServer[] }>(`/api/launcher/servers${q(o)}`),
  facets: (kind: ServerKind) => apiCall<{ modes: string[]; regions: string[]; platforms: string[] }>(`/api/launcher/servers/facets${q({ kind })}`),
  history: () => apiCall<{ history: LServer[] }>('/api/launcher/servers/history'),
  clearHistory: () => del('/api/launcher/servers/history'),
  favorite: (id: string, on: boolean) => post(`/api/launcher/servers/${id}/favorite`, { on }),
  connect: (id: string) => post(`/api/launcher/servers/${id}/connect`),
  profiles: (kind: ServerKind) => apiCall<{ profiles: LProfile[] }>(`/api/launcher/profiles${q({ kind })}`),
  saveProfile: (b: { id?: string; kind: ServerKind; name: string; data: unknown }) => post('/api/launcher/profiles', b),
  deleteProfile: (id: string) => del(`/api/launcher/profiles/${id}`),
  resetProfile: (id: string) => post(`/api/launcher/profiles/${id}/reset`),
  // игры
  terms: () => apiCall<{ terms: any }>('/api/launcher/terms'),
  catalog: (o: Record<string, unknown>) => apiCall<{ games: GameCard[]; genres: string[] }>(`/api/launcher/catalog${q(o)}`),
  game: (id: string) => apiCall<{ game: GameFull }>(`/api/launcher/games/${id}`),
  library: () => apiCall<{ library: GameCard[] }>('/api/launcher/library'),
  addLib: (id: string) => post(`/api/launcher/library/${id}`),
  removeLib: (id: string) => del(`/api/launcher/library/${id}`),
  favGame: (id: string, on: boolean) => post(`/api/launcher/library/${id}/favorite`, { on }),
  event: (gameId: string, kind: string) => post('/api/launcher/events', { gameId, kind }),
  media: async (id: string) => { const r = await apiBlob(`/api/launcher/media/${id}`); return r.ok && r.blob ? URL.createObjectURL(r.blob) : null; },
  // кабинет
  myGames: () => apiCall<{ games: GameCard[] }>('/api/launcher/dev/games'),
  createGame: (b: unknown) => post('/api/launcher/dev/games', b),
  myGame: (id: string) => apiCall<MyGame>(`/api/launcher/dev/games/${id}`),
  saveGame: (id: string, b: unknown) => put(`/api/launcher/dev/games/${id}`, b),
  uploadMedia: async (id: string, kind: 'cover' | 'screenshot', file: File) => { const r = await apiRawAuthed(`/api/launcher/dev/games/${id}/media/${kind}`, { method: 'PUT', body: file }); return { ok: r.ok, data: await r.json().catch(() => ({})) }; },
  deleteMedia: (id: string, mid: string) => del(`/api/launcher/dev/games/${id}/media/${mid}`),
  placement: (id: string) => apiCall<any>(`/api/launcher/dev/games/${id}/placement`),
  submit: (id: string, idemKey: string) => post(`/api/launcher/dev/games/${id}/submit`, { idemKey }),
  createBuild: (id: string, b: unknown) => post(`/api/launcher/dev/games/${id}/builds`, b),
  /** Загрузка одного файла сборки потоком (File передаётся как тело — браузер не читает его в память целиком). */
  uploadFile: async (bid: string, path: string, file: File) => { const r = await apiRawAuthed(`/api/launcher/dev/builds/${bid}/file?path=${encodeURIComponent(path)}`, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }; },
  finalize: (bid: string, b: unknown) => post(`/api/launcher/dev/builds/${bid}/finalize`, b),
  submitBuild: (bid: string) => post(`/api/launcher/dev/builds/${bid}/submit`),
  publishBuild: (bid: string) => post(`/api/launcher/dev/builds/${bid}/publish`),
  deleteBuild: (bid: string) => del(`/api/launcher/dev/builds/${bid}`),
  news: (id: string, title: string, body: string) => post(`/api/launcher/dev/games/${id}/news`, { title, body }),
  stats: (id: string) => apiCall<{ days: number; inLibrary: number; events: Record<string, number> }>(`/api/launcher/dev/games/${id}/stats`),
  addMember: (id: string, username: string, role: string) => post(`/api/launcher/dev/games/${id}/members`, { username, role }),
  removeMember: (id: string, pid: string) => del(`/api/launcher/dev/games/${id}/members/${pid}`),
  transfer: (id: string, username: string, confirmTitle: string) => post(`/api/launcher/dev/games/${id}/transfer`, { username, confirmTitle }),
  incomingTransfers: () => apiCall<{ transfers: { id: string; title: string; username: string }[] }>('/api/launcher/dev/transfers'),
  answerTransfer: (id: string, accept: boolean) => post(`/api/launcher/dev/transfers/${id}/${accept ? 'accept' : 'decline'}`),
};

export interface GameCard { id: string; title: string; shortDescr: string; genres: string[]; developer: string; os: string[]; cover: string | null; featured: boolean; publishedAt: string | null; updatedAt: string; inLibrary?: boolean; favorite?: boolean; version?: string | null; sizeBytes?: number | null; status?: string; statusNote?: string; myRole?: string; lastPlayedAt?: string | null; playCount?: number; addedAt?: string; available?: boolean; buildId?: string | null }
export interface GameFull { id: string; title: string; shortDescr: string; descr: string; genres: string[]; developer: string; publisher: string; requirements: Record<string, string>; os: string[]; links: Record<string, string>; status: string; statusNote: string; cover: string | null; screenshots: string[];
  build: { id: string; version: string; sizeBytes: number; fileCount: number; updatedAt: string | null } | null; history: { version: string; notes: string; at: string; sizeBytes: number }[]; news: { id: string; title: string; body: string; at: string }[]; inLibrary: boolean; favorite: boolean; myRole: string | null }
export interface BuildRow { id: string; version: string; channel: string; status: string; launchExe: string; launchArgs: string[]; notes: string; totalBytes: number; fileCount: number; scanStatus: string; scanDetail: string; reviewNote: string; blocked: boolean; error: string; createdAt: string; publishedAt: string | null }
export interface MyGame { game: GameFull; members: { id: string; role: string; username: string; name: string }[]; can: string[]; builds: BuildRow[]; modLog: { action: string; note: string; at: string }[] }

export const fmtBytes = (b?: number | null) => { if (!b && b !== 0) return '—'; const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0; let v = b; while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; } return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`; };
